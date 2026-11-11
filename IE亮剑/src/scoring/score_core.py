"""Fixed-reference 14-day scoring input and fleet ranking helpers."""
from __future__ import annotations

from datetime import timedelta
from pathlib import Path

import numpy as np
import pandas as pd

from .calculate_scores import collect_cleaned_frames, resolve_inputs, score_frames
from .event_taxonomy import DIMENSION_LABELS
from .reason_codes import REASON_CODES
from .scoring_rules import DEFAULT_WEIGHTS, default_rules_frame

ROOT = Path(__file__).resolve().parents[2]
DIMS = list(DEFAULT_WEIGHTS)
LEVEL_CUTOFFS = (0.20, 0.60, 0.90)


def decayed_exposure(daily: pd.DataFrame, start: str, end: str) -> pd.DataFrame:
    """Apply the same 14-day half-life to event numerator and exposure."""
    frame = daily[daily.event_date.between(pd.Timestamp(start), pd.Timestamp(end))].copy()
    age = (pd.Timestamp(end) - frame.event_date).dt.days + .5
    decay = np.power(2., -age / 14.)
    for col in ["distance_km", "run_time_hours"]:
        frame[col] *= decay
    frame["active_days"] = (frame.moving_rows > 0).astype(float) * decay
    return frame.groupby("gpsno")[["distance_km", "run_time_hours", "active_days"]].sum()


class ScoreSource:
    def __init__(self):
        self.paths = resolve_inputs(ROOT / "data/processed/cleaned")
        self.rules = default_rules_frame()
        self.daily = pd.read_parquet(self.paths["trajectory"])
        self.daily.event_date = pd.to_datetime(self.daily.event_date)
        self.daily.gpsno = self.daily.gpsno.astype(str)
        self.cache = {}

    def score(self, end: str, weights: dict, reference: dict) -> pd.DataFrame:
        start = str(pd.Timestamp(end).date() - timedelta(days=13))
        if end not in self.cache:
            frames = list(collect_cleaned_frames(self.paths, self.rules, end + " 23:59:59", start)[:4])
            exposure = decayed_exposure(self.daily, start, end)
            trajectory = frames[1].copy()
            trajectory.gpsno = trajectory.gpsno.astype(str)
            for col in ["distance_km", "run_time_hours", "active_days"]:
                trajectory["undecayed_" + col] = trajectory[col]
                trajectory[col] = trajectory.gpsno.map(exposure[col]).fillna(0)
            frames[1] = trajectory
            self.cache[end] = frames
        frames = [frame.copy() for frame in self.cache[end]]
        details, _, _ = score_frames(*frames, weights=weights, reference=reference,
                                     observation_days=14)
        details["as_of_date"] = end
        details["window_start"] = start
        return details


def rank_and_explain(details: pd.DataFrame, weights: dict,
                     level_cutoffs=LEVEL_CUTOFFS) -> pd.DataFrame:
    """Rank a fixed 500-vehicle cohort while retaining exact point accounting."""
    cuts = np.asarray(level_cutoffs, dtype=float)
    if len(cuts) != 3 or not np.all(np.isfinite(cuts)) or not (0 < cuts[0] < cuts[1] < cuts[2] < 1):
        raise ValueError("Risk level cutoffs must be three increasing values inside (0, 1)")
    result = details.copy()
    result["uncertainty_reserve"] = np.where(result.imu_evidence_penalty.isna(),
                                              30 * weights["imu_evidence"], 0.)
    result["observed_behavior_deduction"] = sum(result[d + "_contribution"] for d in DIMS)
    result["behavior_safety_score"] = (100 - result.observed_behavior_deduction).clip(0, 100)
    result["confidence_adjusted_floor"] = (
        result.behavior_safety_score - result.uncertainty_reserve).clip(0, 100)
    result["safety_score"] = result.behavior_safety_score
    result = result.sort_values(["safety_score", "gpsno"], ascending=[False, True]).reset_index(drop=True)
    result["rank"] = np.arange(1, len(result) + 1)
    result["risk_rank_percentile"] = result["rank"] / len(result)
    result["risk_level"] = np.select(
        [result.risk_rank_percentile <= cuts[0], result.risk_rank_percentile <= cuts[1],
         result.risk_rank_percentile <= cuts[2]], ["A", "B", "C"], default="D")
    result["score_status"] = np.where(result.confidence_level.eq("low"),
                                       "manual_review", "usable_with_review")
    for idx, row in result.iterrows():
        dims = sorted([d for d in DIMS if pd.notna(row[d + "_penalty"])],
                      key=lambda d: (-row[d + "_contribution"], d))[:3]
        for k, dim in enumerate(dims, 1):
            count = int(row[dim + "_event_count"])
            unit = "异常采样点" if dim == "imu_evidence" else "事件记录"
            points = row[dim + "_contribution"]
            reason = (f"{DIMENSION_LABELS[dim]}：{count}{unit}，相同暴露下较零事件增加{points:.4f}分扣减"
                      if points > 1e-12 else "无可归因的新增扣分；请结合数据覆盖核验")
            result.at[idx, f"top_reason_{k}"] = reason
            for suffix, value in {
                "code": REASON_CODES[dim], "dimension": dim,
                "penalty_points": round(points, 4), "event_count": count,
                "normalized_rate": row.get(dim + "_rate", np.nan),
                "percentile": row[dim + "_penalty"],
            }.items():
                result.at[idx, f"top_reason_{k}_{suffix}"] = value
        primary = dims[0]
        result.at[idx, "primary_risk_dimension"] = primary
        result.at[idx, "primary_risk_dimension_name"] = DIMENSION_LABELS[primary]
        result.at[idx, "recommended_action"] = (
            "先复核数据覆盖及设备，不自动奖惩" if row.confidence_level == "low" else
            {"A": "常规观察；人工审核后正向激励", "B": "月度行为复盘",
             "C": "定向培训并每周复查", "D": "优先事件复核、培训和每周跟踪"}[row.risk_level])
        result.at[idx, "review_cycle"] = "weekly" if row.risk_level in ["C", "D"] else "monthly"
    result["safety_score"] = result.safety_score.round(6)
    return result
