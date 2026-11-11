"""Evidence-increment safety score and auditable operational outputs.

The score compares each observed dimension with the counterfactual of zero
events at the same exposure. Frozen reference rates and weights are reused.
The prior background is reported but cannot masquerade as an observed event.
"""
from __future__ import annotations

import argparse
import json
from datetime import timedelta
from pathlib import Path

import duckdb
import numpy as np
import pandas as pd
from sklearn.metrics import average_precision_score, roc_auc_score

from .enhanced import DIMS, DEFAULT_LEVEL_POLICY, ScoreSource, enhanced_score
from .event_taxonomy import DIMENSION_LABELS
from .exposure_adjustment import monotone_percentile_penalty
from .scoring_rules import default_rules_frame
from .risk_evidence import paired_comparison

ROOT = Path(__file__).resolve().parents[2]
OUT = ROOT / "outputs/scoring/v2"
FROZEN = ROOT / "configs/submission/scoring_frozen.json"


def write_json(path: Path, value: dict) -> None:
    path.write_text(json.dumps(value, ensure_ascii=False, indent=2, allow_nan=False), encoding="utf-8")


def evidence_increment(raw: pd.DataFrame, frozen: dict) -> pd.DataFrame:
    """Fixed-exposure zero-event counterfactual; no label-fitted coefficients."""
    result = raw.copy()
    for dim in DIMS:
        gross = result[f"{dim}_contribution"].fillna(0).to_numpy(dtype=float)
        if dim == "imu_evidence":
            background = np.zeros(len(result))
        else:
            ref = frozen["reference"][dim]
            exposure = result[f"{dim}_exposure"].to_numpy(dtype=float)
            zero_event_rate = ref["tau"] * ref["mu"] / (np.nan_to_num(exposure, nan=0) + ref["tau"])
            percentile = monotone_percentile_penalty(zero_event_rate, reference_rate=ref["rates"])
            background = frozen["weights"][dim] * percentile.fillna(0).to_numpy()
        increment = np.maximum(0.0, gross - background)
        result[f"{dim}_gross_points"] = gross
        result[f"{dim}_prior_background_points"] = background
        result[f"{dim}_contribution"] = increment
        missing = result[f"{dim}_penalty"].isna()
        result[f"{dim}_penalty"] = np.where(missing, np.nan, increment / frozen["weights"][dim])
    result["prior_background_deduction"] = sum(result[f"{d}_prior_background_points"] for d in DIMS)
    result["gross_reference_deduction"] = sum(result[f"{d}_gross_points"] for d in DIMS)
    result["score_method"] = "fixed_exposure_event_increment_v2"
    return result


def score_at(source: ScoreSource, end: str, frozen: dict) -> pd.DataFrame:
    raw = source.score(end, frozen["weights"], frozen["reference"])
    increment = evidence_increment(raw, frozen)
    result, _ = enhanced_score(increment, frozen["weights"], level_policy=DEFAULT_LEVEL_POLICY)
    for idx, row in result.iterrows():
        for k in range(1, 4):
            dim = row.get(f"top_reason_{k}_dimension", "")
            if not isinstance(dim, str) or dim not in DIMS:
                continue
            if row[f"{dim}_contribution"] <= 1e-12:
                result.at[idx, f"top_reason_{k}"] = "无可归因的新增扣分；请结合数据覆盖核验"
                continue
            count = int(row[f"{dim}_event_count"])
            unit = "异常采样点" if dim == "imu_evidence" else "事件记录"
            result.at[idx, f"top_reason_{k}"] = (
                f"{DIMENSION_LABELS[dim]}：{count}{unit}，相同暴露下较零事件增加"
                f"{row[f'{dim}_contribution']:.4f}分扣减")
    result["behavior_safety_score"] = result["safety_score"]
    result["observed_behavior_deduction"] = sum(result[f"{d}_contribution"] for d in DIMS)
    result["score_method"] = "fixed_exposure_event_increment_v2"
    return result


def aligned_target(daily: pd.DataFrame, ids: list[str], end: str, horizon: int = 14) -> np.ndarray:
    cutoff = pd.Timestamp(end)
    stop = cutoff + timedelta(days=horizon)
    counts = (daily.loc[daily.event_date.gt(cutoff) & daily.event_date.le(stop)]
              .groupby("gpsno")[["evt_11803_count", "evt_11804_count"]].sum()
              .reindex(ids, fill_value=0))
    return ((counts.evt_11803_count >= 1) | (counts.evt_11804_count >= 2)).astype(int).to_numpy()


def evaluate_pair(source: ScoreSource, daily: pd.DataFrame, frozen: dict, end: str, horizon: int = 14) -> dict:
    base = source.score(end, frozen["weights"], frozen["reference"])
    old, _ = enhanced_score(base, frozen["weights"], level_policy=DEFAULT_LEVEL_POLICY)
    new = score_at(source, end, frozen)
    ids = sorted(new.gpsno.astype(str))
    y = aligned_target(daily, ids, end, horizon)
    old = old.set_index("gpsno").reindex(ids)
    new = new.set_index("gpsno").reindex(ids)
    result = {"cutoff": end, "horizon_days": horizon, "positives": int(y.sum())}
    for name, scores in [("baseline", old), ("increment", new)]:
        risk = 100 - scores.safety_score.to_numpy()
        order = np.argsort(-risk, kind="stable")
        result[name] = {"auc": float(roc_auc_score(y, risk)),
                        "ap": float(average_precision_score(y, risk)),
                        "top50_recall": float(y[order[:50]].sum() / y.sum())}
    result["auc_delta"] = result["increment"]["auc"] - result["baseline"]["auc"]
    if end in {"2026-07-17", "2026-06-21"}:
        old_risk, new_risk = 100 - old.safety_score.to_numpy(), 100 - new.safety_score.to_numpy()
        result["paired_conditional"] = paired_comparison(y, old_risk, new_risk, draws=1000)
        exposure = new["run_time_hours"].to_numpy()
        masks = {"low_hours_half": exposure <= np.nanmedian(exposure),
                 "high_hours_half": exposure > np.nanmedian(exposure),
                 "imu_absent": new.imu_source_rows.to_numpy() == 0,
                 "imu_present": new.imu_source_rows.to_numpy() > 0}
        groups = {}
        for name, mask in masks.items():
            yy = y[mask]
            groups[name] = {"n": int(mask.sum()), "positives": int(yy.sum())}
            if len(np.unique(yy)) == 2:
                groups[name].update({"baseline_auc": float(roc_auc_score(yy, old_risk[mask])),
                                     "increment_auc": float(roc_auc_score(yy, new_risk[mask]))})
        result["subgroups"] = groups
    return result


def event_ledger(score: pd.DataFrame, end: str, source: ScoreSource) -> pd.DataFrame:
    start = (pd.Timestamp(end) - timedelta(days=getattr(source,"window_days",14)-1)).date()
    rules = source.rules.copy()
    con = duckdb.connect()
    con.register("rules", rules)
    path = source.paths["risk"].as_posix().replace("'", "''")
    rows = con.execute(f"""
        SELECT cast(e.gpsno AS VARCHAR) AS gpsno, cast(e.event_type AS INTEGER) AS event_type,
               r.dimension, count(*) AS event_count,
               sum(r.severity * pow(2.0, -date_diff('second', e.event_time,
                   TIMESTAMP '{end} 23:59:59') / 86400.0 / r.half_life_days)) AS decayed_severity
        FROM read_parquet('{path}') e JOIN rules r ON e.event_type = r.event_type
        WHERE e.event_time >= TIMESTAMP '{start} 00:00:00'
          AND e.event_time <= TIMESTAMP '{end} 23:59:59'
        GROUP BY 1, 2, 3
    """).df()
    con.close()
    rows["gpsno"] = rows.gpsno.astype(str)
    details = score.set_index("gpsno")
    rows["dimension_points"] = [details.at[g, d + "_contribution"] for g, d in zip(rows.gpsno, rows.dimension)]
    totals = rows.groupby(["gpsno", "dimension"]).decayed_severity.transform("sum")
    rows["allocated_points"] = rows.dimension_points * rows.decayed_severity / totals
    rows["allocation_rule"] = "dimension_increment_proportional_to_decayed_severity"
    # IMU is a sensor sample signal, never represented as independent events.
    imu = score.loc[score.imu_evidence_contribution.gt(0),
                    ["gpsno", "imu_evidence_event_count", "imu_evidence_contribution"]].copy()
    imu.columns = ["gpsno", "event_count", "allocated_points"]
    imu["event_type"] = "IMU_SAMPLE"
    imu["dimension"] = "imu_evidence"
    imu["decayed_severity"] = np.nan
    imu["dimension_points"] = imu.allocated_points
    imu["allocation_rule"] = "sensor_sample_dimension_total"
    rows["event_type"] = rows.event_type.astype(str)
    ledger = pd.concat([rows, imu[rows.columns]], ignore_index=True)
    return ledger.sort_values(["gpsno", "dimension", "event_type"]).reset_index(drop=True)


def attach_triage(scores: pd.DataFrame, forecast: pd.DataFrame) -> pd.DataFrame:
    if set(scores.gpsno) != set(forecast.gpsno):
        raise ValueError("Forecast and safety score vehicle cohorts disagree")
    result = scores.merge(forecast[["gpsno", "risk_prob"]], on="gpsno", validate="one_to_one")
    result = result.rename(columns={"risk_prob": "forecast_40d_risk_prob"})
    high_prediction = result.forecast_40d_risk_prob.rank(pct=True, method="average") > .8
    low_behavior = result.risk_level.isin(["C", "D"])
    result["review_queue"] = np.select(
        [high_prediction & low_behavior, high_prediction, low_behavior],
        ["priority_review", "prediction_review", "behavior_coaching"], default="routine")
    result.loc[result.confidence_level.eq("low"), "review_queue"] = "data_quality_review"
    result["action_deadline"] = result.review_queue.map({
        "priority_review": "within_24h", "prediction_review": "within_7d",
        "behavior_coaching": "within_7d", "data_quality_review": "before_action",
        "routine": "within_30d"})
    return result


def attach_recent_alert(scores: pd.DataFrame, daily: pd.DataFrame, end: str) -> pd.DataFrame:
    result = scores.copy()
    today = daily.loc[daily.event_date.eq(pd.Timestamp(end)),
                      ["gpsno", "evt_11803_count", "evt_11804_count"]].set_index("gpsno")
    recent = today.reindex(result.gpsno, fill_value=0)
    incident = (recent.evt_11803_count.to_numpy() + recent.evt_11804_count.to_numpy()) > 0
    deterioration = result.score_change_7d.to_numpy() <= -10
    result["immediate_alert"] = np.select(
        [incident, deterioration], ["same_day_incident_review", "seven_day_score_drop"], default="none")
    return result


def run(output: Path = OUT) -> None:
    output.mkdir(parents=True, exist_ok=True)
    frozen = json.loads(FROZEN.read_text(encoding="utf-8"))
    source = ScoreSource()
    daily = pd.read_parquet(ROOT / "outputs/features/risk_event_daily.parquet")
    daily.gpsno = daily.gpsno.astype(str)
    daily.event_date = pd.to_datetime(daily.event_date)
    development = [evaluate_pair(source, daily, frozen, d) for d in ["2026-06-28", "2026-06-30"]]
    late = evaluate_pair(source, daily, frozen, "2026-07-17")
    forty = evaluate_pair(source, daily, frozen, "2026-06-21", 40)
    snapshots = [score_at(source, str(d.date()), frozen) for d in pd.date_range("2026-07-24", "2026-07-31")]
    history = pd.concat(snapshots, ignore_index=True)
    history.to_parquet(output / "daily_scores.parquet", index=False)
    final = snapshots[-1]
    previous = snapshots[0].set_index("gpsno").safety_score
    final["score_change_7d"] = final.safety_score - final.gpsno.map(previous)
    final = attach_recent_alert(final, daily, "2026-07-31")
    forecast = pd.read_csv(ROOT / "outputs/prediction/v2/forecast_result.csv", dtype={"gpsno": str})
    final = attach_triage(final, forecast)
    final["reference_version"] = "event_increment_v2_frozen_reference_20260928"
    final.to_parquet(output / "score_details.parquet", index=False)
    ledger = event_ledger(final, "2026-07-31", source)
    ledger.to_csv(output / "event_contribution_ledger.csv", index=False, encoding="utf-8", lineterminator="\n")
    allocated = ledger.groupby(["gpsno", "dimension"]).allocated_points.sum()
    for row in final.itertuples(index=False):
        for dim in DIMS:
            if not np.isclose(allocated.get((row.gpsno, dim), 0.), getattr(row, dim + "_contribution"), atol=1e-6):
                raise AssertionError(f"Event ledger mismatch: {row.gpsno} {dim}")
    if not np.allclose(100 - final.safety_score, final.observed_behavior_deduction, atol=1e-6):
        raise AssertionError("Score decomposition mismatch")
    export = ["gpsno", "safety_score", "rank", "risk_rank_percentile", "risk_level",
              "as_of_date", "window_start", "reference_version", "score_method",
              "confidence_score", "confidence_level", "score_status",
              "behavior_safety_score", "confidence_adjusted_floor",
              "observed_behavior_deduction", "prior_background_deduction",
              "gross_reference_deduction", "uncertainty_reserve", "score_change_7d",
              *[d + "_contribution" for d in DIMS],
              *[d + "_event_count" for d in DIMS],
              "top_reason_1", "top_reason_2", "top_reason_3", "primary_risk_dimension",
              "recommended_action", "review_cycle", "forecast_40d_risk_prob",
              "review_queue", "action_deadline", "immediate_alert"]
    final[export].to_csv(output / "safety_scores.csv", index=False, encoding="utf-8", lineterminator="\n")
    final[["gpsno", "safety_score", "risk_level", "forecast_40d_risk_prob", "review_queue",
           "action_deadline", "confidence_level", "top_reason_1"]].to_csv(
        output / "review_queue.csv", index=False, encoding="utf-8", lineterminator="\n")
    audit = {"method": "zero_event_counterfactual_at_equal_exposure; frozen weights/reference; no label fit",
             "development": development, "late_14d": late, "historical_40d": forty,
             "selection_caveat": "All historical labels have been viewed during prior work; comparisons are retrospective, not a fresh holdout",
             "future_40d_truth": "unavailable", "rows": len(final),
             "score_min": float(final.safety_score.min()), "score_max": float(final.safety_score.max()),
             "zero_deduction_vehicles": int(final.observed_behavior_deduction.eq(0).sum()),
             "queue_counts": final.review_queue.value_counts().to_dict(),
             "alert_counts": final.immediate_alert.value_counts().to_dict(),
             "ledger_rows": len(ledger), "ledger_reconciles": True}
    write_json(output / "evaluation.json", audit)
    print(json.dumps(audit, ensure_ascii=False, indent=2))


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--output", type=Path, default=OUT)
    args = parser.parse_args()
    run(args.output)
