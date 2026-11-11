"""Writers and public column contract for member C's fixed delivery interface."""

from __future__ import annotations

import json
from pathlib import Path

import pandas as pd

SAFETY_SCORE_COLUMNS = [
    "gpsno", "safety_score", "rank", "risk_level",
    "confidence_score", "confidence_level",
    "top_reason_1", "top_reason_2", "top_reason_3",
    "primary_risk_dimension", "primary_risk_dimension_name",
    "recommended_action", "training_topic", "review_cycle",
    "device_check_required", "next_cycle_goal",
]


def write_csv(frame: pd.DataFrame, path: Path, columns=None) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    frame.loc[:, columns or frame.columns].to_csv(path, index=False, encoding="utf-8-sig")


def write_parquet(frame: pd.DataFrame, path: Path, duckdb_module) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    connection = duckdb_module.connect()
    try:
        connection.register("score_frame", frame)
        quoted = str(path).replace("\\", "/").replace("'", "''")
        connection.execute(f"COPY score_frame TO '{quoted}' (FORMAT PARQUET, COMPRESSION ZSTD)")
    finally:
        connection.close()


def write_json(value: object, path: Path) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(json.dumps(value, ensure_ascii=False, indent=2, default=str), encoding="utf-8")
