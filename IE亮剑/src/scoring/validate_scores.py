"""Static acceptance checks plus future-risk checks when member A labels exist."""

from __future__ import annotations

from datetime import datetime

import numpy as np
import pandas as pd


def _safe_float(value):
    return None if pd.isna(value) or not np.isfinite(value) else round(float(value), 6)


def _future_validation(details: pd.DataFrame, future_label: pd.Series | None) -> dict:
    if future_label is None:
        return {
            "status": "not_run_missing_a_label_interface",
            "required_files": [
                "outputs/features/risk_event_daily.parquet",
                "outputs/features/feature_dictionary.csv",
                "outputs/features/label_report.json",
            ],
            "pending_checks": [
                "A到D未来事故/未遂率单调上升",
                "最低20%与最高20%的未来风险差",
                "带未来标签的有限权重校准",
            ],
        }
    labels = pd.Series(future_label, index=details.index, dtype="float64")
    if labels.notna().sum() < 50 or labels.dropna().nunique() < 2:
        return {"status": "not_run_insufficient_labels", "labeled_rows": int(labels.notna().sum())}
    joined = details[["risk_level", "rank"]].copy()
    joined["future_label"] = labels
    level_rates = joined.groupby("risk_level")["future_label"].mean().reindex(list("ABCD"))
    n = len(joined)
    top = joined[joined["rank"] <= max(1, int(np.ceil(n * 0.20)))]["future_label"].mean()
    bottom = joined[joined["rank"] > int(np.floor(n * 0.80))]["future_label"].mean()
    monotonic = bool(level_rates.dropna().is_monotonic_increasing)
    return {
        "status": "pass" if monotonic and bottom > top else "review_required",
        "future_event_rate_by_level": {key: _safe_float(value) for key, value in level_rates.items()},
        "safest_20pct_future_rate": _safe_float(top),
        "riskiest_20pct_future_rate": _safe_float(bottom),
        "level_rate_monotonic": monotonic,
        "riskiest_minus_safest": _safe_float(bottom - top),
    }


def validate_score_frame(
    details: pd.DataFrame,
    weights: dict[str, float],
    calibration: dict,
    future_label: pd.Series | None = None,
) -> dict:
    score = details["safety_score"]
    expected_rank = score.rank(method="first", ascending=False).astype(int)
    core_checks = {
        "exactly_500_vehicles": len(details) == 500,
        "gpsno_unique": details["gpsno"].nunique() == len(details),
        "score_in_0_100": bool(score.between(0, 100).all()),
        "rank_is_1_to_n": sorted(details["rank"].tolist()) == list(range(1, len(details) + 1)),
        "score_rank_direction_consistent": bool((expected_rank == details["rank"]).all()),
        "risk_levels_complete": bool(details["risk_level"].isin(list("ABCD")).all()),
        "three_reasons_complete": bool(details[[f"top_reason_{i}" for i in range(1, 4)]].notna().all().all()),
        "confidence_in_0_100": bool(details["confidence_score"].between(0, 100).all()),
    }
    level_summary = (
        details.groupby("risk_level", observed=True)
        .agg(
            vehicles=("gpsno", "size"),
            mean_score=("safety_score", "mean"),
            mean_confidence=("confidence_score", "mean"),
            history_event_rate=("history_event_count", lambda values: float((values > 0).mean())),
        )
        .reindex(list("ABCD"))
        .reset_index()
    )
    with_history = details[details["history_event_count"] > 0]
    without_history = details[details["history_event_count"] == 0]
    history_check = bool(
        len(with_history) == 0 or len(without_history) == 0
        or with_history["safety_score"].mean() < without_history["safety_score"].mean()
    )
    imu_low = details[details["imu_days"] < 7]
    imu_sufficient = details[details["imu_days"] >= 7]
    imu_difference = imu_low["safety_score"].mean() - imu_sufficient["safety_score"].mean()
    imu_check = bool(pd.isna(imu_difference) or imu_difference <= weights["imu_evidence"] * 60 + 1e-9)
    energy = []
    for energy_type, group in details.groupby("energy_type", dropna=False):
        energy.append({
            "energy_type": str(energy_type),
            "vehicles": int(len(group)),
            "score_std": _safe_float(group["safety_score"].std(ddof=0)),
            "has_discrimination": bool(len(group) < 2 or group["safety_score"].nunique() > 1),
        })
    behavior_contribution = sum(details[f"{dimension}_contribution"] for dimension in weights if dimension != "history")
    behavior_check = bool(behavior_contribution.nunique() > 1)
    sensitivity = []
    base_rank = details["rank"].astype(float)
    for dimension in weights:
        for multiplier in (0.9, 1.1):
            changed = weights.copy()
            changed[dimension] *= multiplier
            total = sum(changed.values())
            changed = {key: value / total for key, value in changed.items()}
            alt_score = 100.0 - sum(changed[key] * details[f"{key}_penalty"].fillna(0.0) for key in changed)
            alt_rank = alt_score.rank(method="first", ascending=False)
            sensitivity.append({
                "dimension": dimension,
                "multiplier": multiplier,
                "rank_spearman": _safe_float(base_rank.corr(alt_rank)),
                "p95_absolute_rank_change": _safe_float((base_rank - alt_rank).abs().quantile(0.95)),
            })
    reasons_traceable = True
    for index in range(1, 4):
        columns = [
            f"top_reason_{index}_code", f"top_reason_{index}_dimension",
            f"top_reason_{index}_penalty_points", f"top_reason_{index}_event_count",
            f"top_reason_{index}_normalized_rate", f"top_reason_{index}_percentile",
        ]
        reasons_traceable &= all(column in details and details[column].notna().all() for column in columns)
    static_pass = bool(
        all(core_checks.values())
        and level_summary["mean_score"].is_monotonic_decreasing
        and history_check
        and imu_check
        and all(item["has_discrimination"] for item in energy)
        and behavior_check
        and reasons_traceable
    )
    return {
        "generated_at": datetime.now().astimezone().isoformat(timespec="seconds"),
        "validation_scope": "静态结构验证；未来区分度取决于A成员标签接口",
        "overall_static_status": "pass" if static_pass else "review_required",
        "core_checks": core_checks,
        "score_summary": {
            "min": _safe_float(score.min()), "max": _safe_float(score.max()),
            "mean": _safe_float(score.mean()), "std": _safe_float(score.std(ddof=0)),
        },
        "risk_level_summary": level_summary.round(6).to_dict("records"),
        "history_safety_check": {"pass_not_rewarded": history_check},
        "imu_missingness_check": {
            "vehicles_with_under_7_imu_days": int(len(imu_low)),
            "low_minus_sufficient_mean_score": _safe_float(imu_difference),
            "pass_not_systematically_higher": imu_check,
            "policy": "IMU缺失或低覆盖不扣安全分，只降低可信度；允许的机械分差上限等于IMU最大扣分。",
        },
        "energy_type_discrimination": energy,
        "behavior_without_history": {"pass_has_discrimination": behavior_check},
        "weight_sensitivity": sensitivity,
        "weight_sensitivity_min_spearman": min(item["rank_spearman"] for item in sensitivity),
        "deduction_reasons_traceable": reasons_traceable,
        "calibration": calibration,
        "future_validation": _future_validation(details, future_label),
    }
