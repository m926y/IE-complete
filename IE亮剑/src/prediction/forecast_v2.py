"""Train the competition's 40-day target and write the task-one submission.

The official 14-day feature definitions are reused at every historical cutoff.
Vehicle-grouped validation prevents overlapping 40-day labels from appearing on
both sides of a fold. All candidate weights are fixed before validation.
"""

from __future__ import annotations

import argparse
import csv
import json
from datetime import date, timedelta
from pathlib import Path

import duckdb
import numpy as np
import pandas as pd
from lightgbm import LGBMClassifier
from scipy.stats import rankdata
from sklearn.linear_model import LogisticRegression
from sklearn.metrics import average_precision_score, roc_auc_score, roc_curve
from sklearn.model_selection import StratifiedKFold

from src.features.build_window_features import Sources, build_window_features
from src.features.feature_contract import Registry
from src.features.window_definitions import Window
from src.prediction.validate_submission import validate_submission


ROOT = Path(__file__).resolve().parents[2]
CLEAN = ROOT / "data/processed/cleaned"
FEATURES = ROOT / "outputs/features"
OUTPUT = ROOT / "outputs/prediction/v2"
CUTOFFS = [date(2026, 6, d) for d in range(14, 22)]


def _extra_features(sources: Sources, row: dict, end: date) -> dict:
    gpsno = row["gpsno"]
    daily = sources.between("risk_daily", gpsno, end - timedelta(days=13), end)
    non_target = [
        max(0, d["total_count"] - d["evt_11803_count"] - d["evt_11804_count"] - d["evt_11401_count"])
        for d in daily
    ]
    total = sum(non_target)
    road_other = sum(
        sum(d[f"evt_{code}_count"] for code in (11402, 11403, 11405, 11406))
        for d in daily
    )
    cross_days = 0
    for d in daily:
        families = sum(d[f"{group}_count"] > 0 for group in
                       ("stability", "fatigue", "distraction", "management", "blind_spot"))
        families += sum(d[f"evt_{code}_count"] for code in (11402, 11403, 11405, 11406)) > 0
        cross_days += families >= 2
    km = row["distance_km_14d"]
    active = row["active_days_14d"]
    return {
        "non_target_burst": max(non_target) / total if total else 0.0,
        "cross_family_days_rate": (
            cross_days / active
            if active and active > 0 else np.nan
        ),
        "road_other_rate_1000km": road_other * 1000 / km if km and km > 0 else np.nan,
    }


def build_40d_panel(core: list[str]) -> pd.DataFrame:
    con = duckdb.connect()
    con.execute("SET threads=2")
    for table, filename in [
        ("profile", "vehicle_profile.parquet"),
        ("trajectory", "trajectory_daily.parquet"),
        ("imu", "imu_daily.parquet"),
        ("risk_events", "risk_events.parquet"),
    ]:
        path = (CLEAN / filename).as_posix().replace("'", "''")
        con.execute(f"CREATE VIEW {table} AS SELECT * FROM read_parquet('{path}')")
    path = (FEATURES / "risk_event_daily.parquet").as_posix().replace("'", "''")
    con.execute(f"CREATE VIEW risk_daily AS SELECT * FROM read_parquet('{path}')")
    sources = Sources(con)
    rows = []
    for cutoff in CUTOFFS:
        window = Window(cutoff - timedelta(days=13), cutoff, 40, "horizon40_v2")
        current = build_window_features(sources, window, Registry())
        start = cutoff + timedelta(days=1)
        end = start + timedelta(days=40)
        counts = {
            gpsno: (int(a), int(n))
            for gpsno, a, n in con.execute(
                """SELECT gpsno, count_if(event_type=11803), count_if(event_type=11804)
                   FROM risk_events WHERE event_time >= ? AND event_time < ?
                   GROUP BY gpsno""",
                [start, end],
            ).fetchall()
        }
        for row in current:
            a, n = counts.get(row["gpsno"], (0, 0))
            row["label"] = int(a >= 1 or n >= 2)
            row.update(_extra_features(sources, row, cutoff))
            fields = list(dict.fromkeys(["gpsno", "feature_end", "label", *core,
                                         "non_target_burst", "cross_family_days_rate", "road_other_rate_1000km"]))
            rows.append({k: row[k] for k in fields})
    con.close()
    panel = pd.DataFrame(rows)
    panel["feature_end"] = pd.to_datetime(panel["feature_end"])
    if len(panel) != 4000 or panel.duplicated(["gpsno", "feature_end"]).any():
        raise ValueError("40-day panel must contain eight unique 500-vehicle cutoffs")
    if not (panel["feature_end"].dt.date + timedelta(days=40) <= date(2026, 7, 31)).all():
        raise ValueError("Historical label extends beyond observed data")
    return panel


def stable_columns(core: list[str]) -> list[str]:
    # Event channel 11401 and IMU availability changed markedly across history.
    # The stable branch keeps other road event codes and all exposure features.
    return [c for c in core if not c.startswith(("imu_", "road_risk_", "evt_11401_", "risk_", "event_speed_",
                                                  "fatigue_rate_", "distraction_rate_"))
            and c not in ("multigroup_days_14d", "hour_peak_fraction_14d")] + [
        "non_target_burst", "cross_family_days_rate", "road_other_rate_1000km"
    ]


def _weights(frame: pd.DataFrame) -> np.ndarray:
    y = frame["label"].to_numpy()
    vehicle_mass = 1 / frame.groupby("gpsno").gpsno.transform("size").to_numpy()
    positive_weight = np.sqrt(max(1, (y == 0).sum()) / max(1, (y == 1).sum()))
    return vehicle_mass * np.where(y == 1, positive_weight, 1.0)


def _rank(values: np.ndarray) -> np.ndarray:
    return rankdata(values, method="average") / len(values)


def fit_direct(train: pd.DataFrame, valid: pd.DataFrame, cols: list[str]) -> np.ndarray:
    weights = _weights(train)
    tree = LGBMClassifier(
        n_estimators=85, learning_rate=0.035, max_depth=2, num_leaves=5,
        min_child_samples=45, reg_lambda=15.0, reg_alpha=0.5,
        colsample_bytree=0.8, subsample=0.85, subsample_freq=1,
        random_state=2026, deterministic=True, force_col_wise=True,
        n_jobs=2, verbosity=-1,
    )
    tree.fit(train[cols], train["label"], sample_weight=weights)
    return tree.predict_proba(valid[cols])[:, 1]


def validate(panel: pd.DataFrame, core: list[str], cols: list[str]) -> dict:
    all_reference = pd.read_parquet(FEATURES / "train_windows.parquet")
    current = panel.loc[panel.feature_end.eq(pd.Timestamp("2026-06-21"))].sort_values("gpsno")
    labels = current["label"].to_numpy()
    ids = current["gpsno"].to_numpy()
    historical = all_reference.loc[all_reference.window_id.eq("main_40d_21d_20260621_h40")]
    if current.set_index("gpsno")["label"].sort_index().tolist() != historical.set_index("gpsno")["label"].sort_index().tolist():
        raise ValueError("40-day labels disagree with independently built historical labels")
    for col in core:
        a = current.set_index("gpsno")[col].sort_index().to_numpy(dtype=float)
        b = historical.set_index("gpsno")[col].sort_index().to_numpy(dtype=float)
        if not np.allclose(a, b, equal_nan=True, rtol=1e-12, atol=1e-12):
            raise ValueError(f"Fixed-14 feature does not match existing historical build: {col}")
    folds = StratifiedKFold(n_splits=5, shuffle=True, random_state=20260928)
    report = []
    oof = np.full(len(current), np.nan)
    for fold, (train_idx, valid_idx) in enumerate(folds.split(ids, labels), 1):
        train_ids = set(ids[train_idx])
        valid_ids = set(ids[valid_idx])
        train40 = panel.loc[panel.gpsno.isin(train_ids)]
        valid40 = current.iloc[valid_idx]
        direct = fit_direct(train40, valid40, cols)
        fold_row = {"fold": fold, "n": len(valid_idx), "positive": int(labels[valid_idx].sum()),
                    "auc": float(roc_auc_score(labels[valid_idx], direct)),
                    "ap": float(average_precision_score(labels[valid_idx], direct))}
        oof[valid_idx] = _rank(direct)
        report.append(fold_row)
    summary = {"mean_auc": float(np.mean([f["auc"] for f in report])),
               "pooled_rank_auc": float(roc_auc_score(labels, oof)),
               "pooled_rank_ap": float(average_precision_score(labels, oof))}
    calibrator = LogisticRegression(C=1.0, max_iter=1000)
    calibrator.fit(oof.reshape(-1, 1), labels)
    slope = float(calibrator.coef_[0, 0])
    if slope <= 0:
        raise ValueError("40-day calibration slope must be positive")
    calibrated = calibrator.predict_proba(oof.reshape(-1, 1))[:, 1]
    fpr, tpr, thresholds = roc_curve(labels, calibrated)
    best = int(np.argmax(tpr - fpr))
    return {"protocol": "five vehicle-disjoint folds; eight overlapping 40-day cutoffs weighted per vehicle; no future blind labels",
            "folds": report, "summary": summary, "positive_vehicles": int(labels.sum()),
            "calibration": {"slope": slope, "intercept": float(calibrator.intercept_[0]),
                            "threshold": float(thresholds[best]),
                            "oof_base_rate": float(labels.mean()),
                            "limitation": "Fit on one historical 40-day period; future calibration unknown"}}


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--output", type=Path, default=OUTPUT)
    args = parser.parse_args()
    args.output.mkdir(parents=True, exist_ok=True)
    config = json.loads((ROOT / "configs/submission/prediction_features.json").read_text(encoding="utf-8"))
    core = config["core_features"]
    panel = build_40d_panel(core)
    cols = stable_columns(core)
    audit = validate(panel, core, cols)
    print(json.dumps(audit["summary"], ensure_ascii=False, indent=2), flush=True)
    full = pd.read_parquet(FEATURES / "full_61d_features.parquet")
    con = duckdb.connect()
    for table, filename in [
        ("profile", "vehicle_profile.parquet"),
        ("trajectory", "trajectory_daily.parquet"),
        ("imu", "imu_daily.parquet"),
    ]:
        path = (CLEAN / filename).as_posix().replace("'", "''")
        con.execute(f"CREATE VIEW {table} AS SELECT * FROM read_parquet('{path}')")
    path = (FEATURES / "risk_event_daily.parquet").as_posix().replace("'", "''")
    con.execute(f"CREATE VIEW risk_daily AS SELECT * FROM read_parquet('{path}')")
    sources = Sources(con)
    extras = [_extra_features(sources, row, date(2026, 7, 31)) for row in full.to_dict("records")]
    full = pd.concat([full.reset_index(drop=True), pd.DataFrame(extras)], axis=1)
    con.close()
    if set(full.gpsno) != set(panel.gpsno) or full.gpsno.duplicated().any():
        raise ValueError("Final cohort does not match historical cohort")
    direct = fit_direct(panel, full, cols)
    probability = 1 / (1 + np.exp(-(audit["calibration"]["intercept"] +
                                    audit["calibration"]["slope"] * _rank(direct))))
    threshold = audit["calibration"]["threshold"]
    forecast = pd.DataFrame({"gpsno": full.gpsno.astype(str), "accident": (probability >= threshold).astype(int),
                             "risk_prob": probability})
    expected = pd.read_csv(CLEAN / "vehicle_profile.csv", dtype={"gpsno": str}).gpsno
    audit["submission"] = validate_submission(forecast, expected_ids=expected)
    audit["model"] = "fixed shallow LightGBM using stable features and direct 40-day target"
    (args.output / "evaluation.json").write_text(json.dumps(audit, ensure_ascii=False, indent=2), encoding="utf-8")
    with (args.output / "forecast_result.csv").open("w", encoding="utf-8", newline="") as stream:
        writer = csv.DictWriter(stream, fieldnames=["gpsno", "accident", "risk_prob"], lineterminator="\n")
        writer.writeheader()
        for row in forecast.itertuples(index=False):
            writer.writerow({"gpsno": row.gpsno, "accident": int(row.accident), "risk_prob": format(row.risk_prob, ".12f")})


if __name__ == "__main__":
    main()
