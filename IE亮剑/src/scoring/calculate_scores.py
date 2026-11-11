#!/usr/bin/env python3
"""Generate member C's explainable 100-point safety score from cleaned data."""

from __future__ import annotations

import argparse
import os
import platform
import time
from datetime import datetime
from pathlib import Path

import numpy as np
import pandas as pd

try:
    import duckdb
except ImportError:  # pragma: no cover - score_frames itself does not need DuckDB
    duckdb = None

from .calibrate_weights import calibrate_weights
from .event_taxonomy import DIMENSION_LABELS
from .exposure_adjustment import empirical_bayes_rate, monotone_percentile_penalty
from .export_scores import SAFETY_SCORE_COLUMNS, write_csv, write_json, write_parquet
from .reason_codes import operational_action, reason_record
from .scoring_rules import default_rules_frame, validate_weights, write_rules
from .validate_scores import validate_score_frame

ROOT = Path(__file__).resolve().parents[2]
DEFAULT_CLEANED_DIR = ROOT / "data" / "processed" / "cleaned"
DEFAULT_OUTPUT_DIR = ROOT / "outputs" / "scoring"
DEFAULT_RUN_DIR = ROOT / "runs" / "member_c"
AS_OF_TS = "2026-07-31 23:59:59"
OBSERVATION_DAYS = 61
RANDOM_SEED = 20260923

REQUIRED_INPUTS = {
    "profile": "vehicle_profile.parquet",
    "risk": "risk_events.parquet",
    "trajectory": "trajectory_daily.parquet",
    "imu": "imu_daily.parquet",
}


def _sql_quote(value: str | Path) -> str:
    return "'" + str(value).replace("\\", "/").replace("'", "''") + "'"


def resolve_inputs(cleaned_dir: Path) -> dict[str, Path]:
    paths = {key: cleaned_dir / filename for key, filename in REQUIRED_INPUTS.items()}
    missing = [str(path) for path in paths.values() if not path.exists()]
    if missing:
        raise FileNotFoundError(
            "缺少公共清洗文件：" + ", ".join(missing)
            + "。先运行 src/data/clean_data.py；本评分器不需要等待A的特征字典。"
        )
    return paths


def collect_cleaned_frames(paths: dict[str, Path], rules: pd.DataFrame, as_of_ts: str = AS_OF_TS,
                           start_date: str = '2026-06-01'):
    cutoff=pd.Timestamp(as_of_ts)
    if cutoff.time().isoformat() != '23:59:59':
        raise ValueError('Daily sensor aggregates require an end-of-day cutoff 23:59:59')
    if pd.Timestamp(start_date)>cutoff:
        raise ValueError('start_date must not exceed as_of')
    if duckdb is None:
        raise RuntimeError("缺少DuckDB。请执行：python -m pip install -r requirements.txt")
    connection = duckdb.connect()
    connection.register("scoring_rules", rules)
    try:
        profile = connection.execute(
            f"SELECT * FROM read_parquet({_sql_quote(paths['profile'])})"
        ).df()
        trajectory = connection.execute(f"""
            SELECT gpsno,
                   count(*) AS trajectory_days,
                   count_if(moving_rows > 0) AS active_days,
                   sum(source_rows) AS trajectory_source_rows,
                   sum(valid_speed_rows) AS valid_speed_rows,
                   sum(invalid_speed_rows) AS invalid_speed_rows,
                   sum(valid_coordinate_rows) AS valid_coordinate_rows,
                   sum(invalid_coordinate_rows) AS invalid_coordinate_rows,
                   sum(distance_km) AS distance_km,
                   sum(run_time_hours) AS run_time_hours
            FROM read_parquet({_sql_quote(paths['trajectory'])})
            WHERE event_date BETWEEN CAST({_sql_quote(start_date)} AS DATE) AND CAST({_sql_quote(as_of_ts)} AS DATE)
            GROUP BY gpsno
        """).df()
        imu = connection.execute(f"""
            SELECT gpsno,
                   count(*) AS imu_days,
                   sum(source_rows) AS imu_source_rows,
                   sum(missing_ems_speed_rows) AS missing_ems_speed_rows,
                   sum(missing_gps_speed_rows) AS missing_gps_speed_rows,
                   sum(accel_norm_outlier_rows) AS accel_norm_outlier_rows,
                   sum(gyro_norm_gt20_rows) AS gyro_norm_gt20_rows,
                   avg(ems_gps_abs_diff_mean) AS ems_gps_abs_diff_mean
            FROM read_parquet({_sql_quote(paths['imu'])})
            WHERE event_date BETWEEN CAST({_sql_quote(start_date)} AS DATE) AND CAST({_sql_quote(as_of_ts)} AS DATE)
            GROUP BY gpsno
        """).df()
        risk = connection.execute(f"""
            WITH events AS (
              SELECT events.gpsno, events.event_type, events.event_time,
                     rules.dimension, rules.severity, rules.half_life_days,
                     greatest(
                       0.0,
                       date_diff('second', events.event_time, TIMESTAMP {_sql_quote(as_of_ts)}) / 86400.0
                     ) AS age_days
              FROM read_parquet({_sql_quote(paths['risk'])}) AS events
              JOIN scoring_rules AS rules
                ON events.event_type = cast(rules.event_type AS INTEGER)
              WHERE events.event_time <= TIMESTAMP {_sql_quote(as_of_ts)}
                AND events.event_time >= TIMESTAMP {_sql_quote(start_date)}
            )
            SELECT gpsno, dimension,
                   count(*) AS event_count,
                   count(DISTINCT cast(event_time AS DATE)) AS risk_event_days,
                   sum(severity * pow(2.0, -age_days / half_life_days)) AS decayed_severity_count,
                   max(event_time) AS most_recent_event_time
            FROM events
            GROUP BY gpsno, dimension
        """).df()
        quality = {
            "profile_rows": int(len(profile)),
            "profile_vehicles": int(profile["gpsno"].nunique()),
            "trajectory_vehicles": int(trajectory["gpsno"].nunique()),
            "imu_vehicles": int(imu["gpsno"].nunique()),
            "risk_vehicles": int(risk["gpsno"].nunique()),
            "as_of_timestamp": as_of_ts,
        }
        return profile, trajectory, imu, risk, quality
    finally:
        connection.close()


def _assign_risk_level(rank: pd.Series) -> np.ndarray:
    count = len(rank)
    a_end = int(np.ceil(count * 0.20))
    b_end = int(np.ceil(count * 0.60))
    c_end = int(np.ceil(count * 0.90))
    return np.select([rank <= a_end, rank <= b_end, rank <= c_end], ["A", "B", "C"], default="D")


def score_frames(
    profile: pd.DataFrame,
    trajectory: pd.DataFrame,
    imu: pd.DataFrame,
    risk: pd.DataFrame,
    weights: dict[str, float] | None = None,
    reference: dict | None = None,
    observation_days: int = OBSERVATION_DAYS,
) -> tuple[pd.DataFrame, dict[str, float], dict]:
    """Score already aggregated frames; separated for deterministic unit tests."""
    if profile["gpsno"].duplicated().any():
        raise ValueError("vehicle_profile.parquet 的 gpsno 必须唯一")
    frame = profile.copy()
    frame["gpsno"] = frame["gpsno"].astype(str)
    frame = frame.merge(trajectory, on="gpsno", how="left").merge(imu, on="gpsno", how="left")
    speed_difference_available = frame.get('ems_gps_abs_diff_mean', pd.Series(np.nan,index=frame.index)).notna()
    numeric_fill = [
        "trajectory_days", "trajectory_source_rows", "valid_speed_rows", "invalid_speed_rows",
        "valid_coordinate_rows", "invalid_coordinate_rows", "distance_km", "run_time_hours",
        "imu_days", "imu_source_rows", "missing_ems_speed_rows", "missing_gps_speed_rows",
        "accel_norm_outlier_rows", "gyro_norm_gt20_rows", "ems_gps_abs_diff_mean",
    ]
    for column in numeric_fill:
        if column not in frame:
            frame[column] = 0.0
    frame[numeric_fill] = frame[numeric_fill].fillna(0.0)
    for dimension in [key for key in DIMENSION_LABELS if key != "imu_evidence"]:
        subset = risk[risk["dimension"] == dimension].set_index("gpsno")
        frame[f"{dimension}_event_count"] = frame["gpsno"].map(subset["event_count"]).fillna(0).astype(int)
        frame[f"{dimension}_risk_event_days"] = frame["gpsno"].map(subset["risk_event_days"]).fillna(0).astype(int)
        frame[f"{dimension}_decayed_severity_count"] = frame["gpsno"].map(
            subset["decayed_severity_count"]
        ).fillna(0.0)
        if dimension in {"history", "driving_stability", "road_rule"}:
            exposure = frame["distance_km"] / 1000.0
        elif dimension == "fatigue_distraction":
            exposure = frame["run_time_hours"] / 100.0
        else:
            exposure = frame.get('active_days', frame['trajectory_days']).astype(float)
        frame[f"{dimension}_exposure"] = exposure
        rate, prior_mean, prior_exposure = empirical_bayes_rate(
            frame[f"{dimension}_decayed_severity_count"], exposure,
            tau=None if reference is None else reference[dimension]['tau'],
            prior_mean=None if reference is None else reference[dimension]['mu'],
        )
        frame[f"{dimension}_rate"] = rate
        frame[f"{dimension}_prior_mean"] = prior_mean
        frame[f"{dimension}_prior_exposure"] = prior_exposure
        frame[f"{dimension}_penalty"] = monotone_percentile_penalty(rate,
            reference_rate=None if reference is None else reference[dimension]['rates']).to_numpy()

    imu_available = frame["imu_source_rows"] > 0
    imu_rate = pd.Series(np.nan, index=frame.index, dtype="float64")
    imu_rate.loc[imu_available] = (
        0.60 * frame.loc[imu_available, "accel_norm_outlier_rows"] / frame.loc[imu_available, "imu_source_rows"]
        + 0.30 * frame.loc[imu_available, "gyro_norm_gt20_rows"] / frame.loc[imu_available, "imu_source_rows"]
        + 0.10 * (frame.loc[imu_available, "ems_gps_abs_diff_mean"] / 20.0).clip(0, 1)
    ) / (0.90 + 0.10 * speed_difference_available.loc[imu_available].astype(float))
    frame["imu_evidence_event_count"] = (frame["accel_norm_outlier_rows"]+frame["gyro_norm_gt20_rows"]).fillna(0).astype(int)
    frame["imu_evidence_exposure"] = frame["imu_source_rows"]
    frame["imu_evidence_rate"] = imu_rate
    frame["imu_evidence_penalty"] = monotone_percentile_penalty(
        imu_rate, available=imu_available, cap=60.0,
        reference_rate=None if reference is None else reference['imu_evidence']['rates']
    ).to_numpy()

    calibration = {
        "status": "manual_weights" if weights is not None else "initial_weights_missing_future_labels",
        "message": "A成员未来标签未接入；使用仓库固定初始权重。" if weights is None else "使用显式传入权重。",
    }
    if weights is None:
        penalty_frame = frame[[f"{dimension}_penalty" for dimension in DIMENSION_LABELS]]
        weights, calibration = calibrate_weights(penalty_frame, None)
    validate_weights(weights)
    for dimension, weight in weights.items():
        frame[f"{dimension}_weight"] = weight
        frame[f"{dimension}_contribution"] = weight * frame[f"{dimension}_penalty"].fillna(0.0)
    frame["safety_score_raw"] = 100.0 - sum(frame[f"{dimension}_contribution"] for dimension in weights)
    frame["safety_score"] = frame["safety_score_raw"].clip(0, 100)
    frame = frame.sort_values(["safety_score", "gpsno"], ascending=[False, True]).reset_index(drop=True)
    frame["rank"] = np.arange(1, len(frame) + 1)
    frame["risk_level"] = _assign_risk_level(frame["rank"])

    trajectory_rows = frame["trajectory_source_rows"].replace(0, np.nan)
    frame["valid_speed_ratio"] = (frame["valid_speed_rows"] / trajectory_rows).fillna(0.0).clip(0, 1)
    frame["valid_coordinate_ratio"] = (frame["valid_coordinate_rows"] / trajectory_rows).fillna(0.0).clip(0, 1)
    frame["confidence_score"] = (
        25 * (frame["trajectory_days"] / observation_days).clip(0, 1)
        + 15 * (frame["imu_days"] / observation_days).clip(0, 1)
        + 15 * frame["valid_speed_ratio"]
        + 15 * frame["valid_coordinate_ratio"]
        + 10 * (frame["distance_km"] / 1000.0).clip(0, 1)
        + 10 * (frame["run_time_hours"] / 100.0).clip(0, 1)
        + 10  # the cleaned risk-event dataset itself is present and readable
    ).clip(0, 100)
    frame["confidence_level"] = np.select(
        [frame["confidence_score"] >= 80, frame["confidence_score"] >= 60],
        ["high", "medium"], default="low",
    )

    for index in range(1, 4):
        for suffix, default in [
            ("", ""), ("_code", ""), ("_dimension", ""),
            ("_penalty_points", np.nan), ("_event_count", np.nan),
            ("_normalized_rate", np.nan), ("_percentile", np.nan),
        ]:
            frame[f"top_reason_{index}{suffix}"] = default
    frame["primary_risk_dimension"] = ""
    frame["primary_risk_dimension_name"] = ""
    for row_index, row in frame.iterrows():
        candidates = [dimension for dimension in weights if pd.notna(row[f"{dimension}_penalty"])]
        top_dimensions = sorted(candidates, key=lambda key: (-row[f"{key}_contribution"], key))[:3]
        for reason_rank, dimension in enumerate(top_dimensions, start=1):
            record = reason_record(row, dimension, reason_rank)
            frame.at[row_index, f"top_reason_{reason_rank}"] = record["reason_text"]
            frame.at[row_index, f"top_reason_{reason_rank}_code"] = record["reason_code"]
            frame.at[row_index, f"top_reason_{reason_rank}_dimension"] = record["dimension"]
            frame.at[row_index, f"top_reason_{reason_rank}_penalty_points"] = record["penalty_points"]
            frame.at[row_index, f"top_reason_{reason_rank}_event_count"] = record["event_count"]
            frame.at[row_index, f"top_reason_{reason_rank}_normalized_rate"] = record["normalized_rate"]
            frame.at[row_index, f"top_reason_{reason_rank}_percentile"] = record["comparison_percentile"]
        frame.at[row_index, "primary_risk_dimension"] = top_dimensions[0]
        frame.at[row_index, "primary_risk_dimension_name"] = DIMENSION_LABELS[top_dimensions[0]]
    actions = frame.apply(
        lambda row: operational_action(
            row["risk_level"],
            row["primary_risk_dimension"],
            row["confidence_level"],
            int(row[f"{row['primary_risk_dimension']}_event_count"]),
        ),
        axis=1,
        result_type="expand",
    )
    frame = pd.concat([frame, actions], axis=1)
    frame["safety_score"] = frame["safety_score"].round(4)
    frame["confidence_score"] = frame["confidence_score"].round(2)
    return frame, weights, calibration

