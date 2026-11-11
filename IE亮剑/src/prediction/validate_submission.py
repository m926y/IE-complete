"""Strict validation for the task-one CSV submission."""

from __future__ import annotations

import argparse
from pathlib import Path

import numpy as np
import pandas as pd

EXPECTED_COLUMNS = ["gpsno", "accident", "risk_prob"]


def validate_submission(
    submission: pd.DataFrame,
    *,
    expected_ids=None,
    expected_rows: int = 500,
) -> dict[str, int | float | bool]:
    if list(submission.columns) != EXPECTED_COLUMNS:
        raise ValueError(f"提交字段及顺序必须为 {EXPECTED_COLUMNS}")
    if len(submission) != expected_rows:
        raise ValueError(f"提交文件应为 {expected_rows} 行，实际为 {len(submission)} 行")
    ids = submission["gpsno"].astype("string").str.strip()
    if ids.isna().any() or ids.eq("").any() or ids.duplicated().any():
        raise ValueError("gpsno 必须非空且唯一")
    accident = pd.to_numeric(submission["accident"], errors="coerce")
    if accident.isna().any() or not set(accident.unique()).issubset({0, 1}):
        raise ValueError("accident 必须只包含 0 和 1")
    probability = pd.to_numeric(submission["risk_prob"], errors="coerce")
    if probability.isna().any() or not np.isfinite(probability).all():
        raise ValueError("risk_prob 存在空值或无限值")
    if not probability.between(0, 1, inclusive="both").all():
        raise ValueError("risk_prob 必须位于 0 到 1")
    if probability.nunique() < 2:
        raise ValueError("risk_prob 不应全部相同")
    if expected_ids is not None:
        expected = {str(value).strip() for value in expected_ids}
        actual = set(ids.astype(str))
        if actual != expected:
            missing = sorted(expected - actual)[:10]
            extra = sorted(actual - expected)[:10]
            raise ValueError(f"车辆集合不一致；缺失={missing}，额外={extra}")
    return {
        "valid": True,
        "rows": int(len(submission)),
        "positive_predictions": int(accident.sum()),
        "probability_min": float(probability.min()),
        "probability_max": float(probability.max()),
        "probability_mean": float(probability.mean()),
    }


def main() -> None:
    parser = argparse.ArgumentParser(description="校验事故预测提交文件")
    parser.add_argument("submission", type=Path)
    parser.add_argument("--expected-ids", type=Path)
    parser.add_argument("--expected-rows", type=int, default=500)
    args = parser.parse_args()
    submission = pd.read_csv(args.submission, dtype={"gpsno": "string"})
    ids = None
    if args.expected_ids:
        source = (pd.read_parquet(args.expected_ids) if args.expected_ids.suffix == ".parquet"
                  else pd.read_csv(args.expected_ids, dtype={"gpsno": "string"}))
        ids = source["gpsno"].astype("string")
    result = validate_submission(
        submission, expected_ids=ids, expected_rows=args.expected_rows
    )
    print(result)


if __name__ == "__main__":
    main()
