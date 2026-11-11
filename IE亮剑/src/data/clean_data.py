#!/usr/bin/env python3
"""Stream-clean the Crazy Logi-AI 2.0 competition data.

The raw gzip files are never unpacked to plain text. DuckDB reads them directly,
casts fields defensively, writes a compact risk-event table, and produces daily
trajectory/IMU aggregates suitable for vehicle-level feature engineering.
"""

from __future__ import annotations

import argparse
import csv
import json
import os
import shutil
import sys
import time
from pathlib import Path
from typing import Iterable


ROOT = Path(__file__).resolve().parents[2]
LOCAL_DEPS = ROOT / ".deps"
if LOCAL_DEPS.exists():
    sys.path.insert(0, str(LOCAL_DEPS))

try:
    import duckdb
except ImportError as exc:  # pragma: no cover - user-facing setup failure
    raise SystemExit(
        "缺少 DuckDB。请执行：python -m pip install --target .deps 'duckdb>=1.0,<2.0'"
    ) from exc

from openpyxl import load_workbook


START_TS = "2026-06-01 00:00:00"
END_TS_EXCLUSIVE = "2026-08-01 00:00:00"
KNOWN_EVENT_CODES = (
    11401, 11402, 11403, 11405, 11406,
    30000, 30002, 30003, 30005, 30017,
    41001, 41002, 41003, 41004, 41005, 41006, 41009, 41021, 41023, 41029,
    60292, 60294, 11803, 11804,
)


PROFILE_COLUMNS = [
    "gpsno", "energy_type", "monthly_mileage_km", "monthly_drive_hours",
    "monthly_stop_count", "highway_mileage_ratio", "morning_drive_time_ratio",
    "dusk_drive_time_ratio", "night_drive_time_ratio", "night_mileage_ratio",
]

RISK_COLUMNS = {
    "gpsno_raw": "VARCHAR", "lat_text": "VARCHAR", "lng_text": "VARCHAR",
    "event_type_text": "VARCHAR", "event_name": "VARCHAR", "speed_text": "VARCHAR",
    "start_time_text": "VARCHAR",
}

TRAJECTORY_COLUMNS = {
    "gpsno_raw": "VARCHAR", "distance_text": "VARCHAR", "run_time_text": "VARCHAR",
    "trigger_time_text": "VARCHAR", "speed_text": "VARCHAR", "course_text": "VARCHAR",
    "lat_text": "VARCHAR", "lng_text": "VARCHAR",
}

IMU_COLUMNS = {
    "gpsno_raw": "VARCHAR", "imei_raw": "VARCHAR", "data_time_text": "VARCHAR",
    "data_date_text": "VARCHAR", "ems_speed_text": "VARCHAR", "gps_speed_text": "VARCHAR",
    "accel_x_text": "VARCHAR", "accel_y_text": "VARCHAR", "accel_z_text": "VARCHAR",
    "gyro_x_text": "VARCHAR", "gyro_y_text": "VARCHAR", "gyro_z_text": "VARCHAR",
}


def sql_quote(value: str | Path) -> str:
    return "'" + str(value).replace("\\", "/").replace("'", "''") + "'"


def sql_file_list(files: Iterable[Path]) -> str:
    return "[" + ",".join(sql_quote(p) for p in files) + "]"


def sql_columns(columns: dict[str, str]) -> str:
    body = ",".join(f"{sql_quote(k)}:{sql_quote(v)}" for k, v in columns.items())
    return "{" + body + "}"


def read_csv_sql(files: list[Path], columns: dict[str, str], limit: int | None) -> str:
    parallel = "false" if limit else "true"
    source = (
        f"read_csv({sql_file_list(files)}, delim='\\t', header=false, "
        f"columns={sql_columns(columns)}, nullstr='\\N', compression='gzip', "
        f"strict_mode=false, ignore_errors=false, parallel={parallel})"
    )
    return f"SELECT * FROM {source}" + (f" LIMIT {limit}" if limit else "")


def choose_files(pattern: str, sample_files: int | None) -> list[Path]:
    files = sorted(ROOT.glob(pattern))
    if sample_files:
        files = files[:sample_files]
    if not files:
        raise FileNotFoundError(f"未找到输入文件：{pattern}")
    return files


def ensure_can_write(path: Path, overwrite: bool) -> bool:
    if not path.exists():
        return True
    if overwrite:
        if path.is_dir():
            shutil.rmtree(path)
        else:
            path.unlink()
        return True
    print(f"跳过已存在产物：{path}")
    return False


def write_json(path: Path, value: object) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(json.dumps(value, ensure_ascii=False, indent=2, default=str), encoding="utf-8")


def relation_as_dict(con, query: str) -> dict:
    cursor = con.execute(query)
    columns = [d[0] for d in cursor.description]
    row = cursor.fetchone()
    return dict(zip(columns, row))


def clean_profile(con, output_dir: Path, overwrite: bool) -> dict:
    source = ROOT / "data" / "raw" / "vehicle_profile.xlsx"
    csv_path = output_dir / "vehicle_profile.csv"
    parquet_path = output_dir / "vehicle_profile.parquet"
    if not ensure_can_write(csv_path, overwrite):
        return relation_as_dict(
            con,
            f"""
            SELECT count(*) AS rows,
                   count(DISTINCT gpsno) AS vehicles,
                   count(*) - count(DISTINCT gpsno) AS duplicate_ids,
                   count_if(gpsno IS NULL) AS missing_ids,
                   min(monthly_mileage_km) AS min_monthly_mileage_km,
                   max(monthly_mileage_km) AS max_monthly_mileage_km
            FROM read_parquet({sql_quote(parquet_path)})
            """,
        )
    ensure_can_write(parquet_path, overwrite)

    workbook = load_workbook(source, read_only=True, data_only=True)
    sheet = workbook[workbook.sheetnames[0]]
    rows = list(sheet.iter_rows(min_row=2, values_only=True))
    cleaned = []
    for row in rows:
        if len(row) != 10 or row[0] is None:
            continue
        cleaned.append([
            str(row[0]).strip(), str(row[1]).strip(),
            *[None if v is None else float(v) for v in row[2:]],
        ])
    output_dir.mkdir(parents=True, exist_ok=True)
    with csv_path.open("w", newline="", encoding="utf-8-sig") as stream:
        writer = csv.writer(stream)
        writer.writerow(PROFILE_COLUMNS)
        writer.writerows(cleaned)

    con.execute(
        f"COPY (SELECT cast(gpsno AS VARCHAR) AS gpsno, * EXCLUDE (gpsno) "
        f"FROM read_csv_auto({sql_quote(csv_path)}, header=true, all_varchar=false)) "
        f"TO {sql_quote(parquet_path)} (FORMAT PARQUET, COMPRESSION ZSTD)"
    )
    return relation_as_dict(
        con,
        f"""
        SELECT count(*) AS rows,
               count(DISTINCT gpsno) AS vehicles,
               count(*) - count(DISTINCT gpsno) AS duplicate_ids,
               count_if(gpsno IS NULL) AS missing_ids,
               min(monthly_mileage_km) AS min_monthly_mileage_km,
               max(monthly_mileage_km) AS max_monthly_mileage_km
        FROM read_parquet({sql_quote(parquet_path)})
        """,
    )


def risk_typed_sql(files: list[Path], limit: int | None) -> str:
    raw = read_csv_sql(files, RISK_COLUMNS, limit)
    codes = ",".join(map(str, KNOWN_EVENT_CODES))
    return f"""
    WITH raw AS ({raw}), typed AS (
      SELECT trim(gpsno_raw) AS gpsno,
             try_cast(lat_text AS DOUBLE) AS lat_raw,
             try_cast(lng_text AS DOUBLE) AS lng_raw,
             try_cast(event_type_text AS INTEGER) AS event_type,
             trim(event_name) AS event_name,
             try_cast(speed_text AS DOUBLE) AS speed_raw,
             try_strptime(start_time_text, '%Y-%m-%d %H:%M:%S') AS event_time
      FROM raw
    )
    SELECT *,
           cast(event_time AS DATE) AS event_date,
           CASE WHEN lat_raw BETWEEN 3 AND 54 AND lng_raw BETWEEN 73 AND 136 THEN lat_raw END AS lat,
           CASE WHEN lat_raw BETWEEN 3 AND 54 AND lng_raw BETWEEN 73 AND 136 THEN lng_raw END AS lng,
           lat_raw BETWEEN 3 AND 54 AND lng_raw BETWEEN 73 AND 136 AS coordinate_valid,
           CASE WHEN speed_raw BETWEEN 0 AND 160 THEN speed_raw END AS speed_kmh,
           speed_raw IS NOT NULL AND NOT speed_raw BETWEEN 0 AND 160 AS speed_outlier,
           event_type IN ({codes}) AS known_event_code,
           gpsno IS NOT NULL AND gpsno <> '' AS valid_gpsno,
           event_time >= TIMESTAMP {sql_quote(START_TS)}
             AND event_time < TIMESTAMP {sql_quote(END_TS_EXCLUSIVE)} AS valid_time
    FROM typed
    """


def clean_risk(con, output_dir: Path, overwrite: bool, limit: int | None) -> dict:
    path = output_dir / "risk_events.parquet"
    if not ensure_can_write(path, overwrite):
        return relation_as_dict(
            con,
            f"""
            SELECT count(*) AS rows, count(DISTINCT gpsno) AS vehicles,
                   min(event_time) AS min_time, max(event_time) AS max_time,
                   count_if(speed_outlier) AS speed_outliers,
                   count_if(NOT coordinate_valid) AS invalid_coordinates,
                   count_if(NOT known_event_code) AS unknown_event_codes,
                   count_if(event_type=11803) AS accident_rows,
                   count_if(event_type=11804) AS near_miss_rows
            FROM read_parquet({sql_quote(path)})
            """,
        )
    files = [ROOT / "data" / "raw" / "risk_events.tsv.gz"]
    typed = risk_typed_sql(files, limit)
    con.execute(
        f"""
        COPY (
          SELECT gpsno, event_time, event_date, event_type, event_name,
                 speed_raw, speed_kmh, speed_outlier,
                 lat_raw, lng_raw, lat, lng, coordinate_valid, known_event_code
          FROM ({typed})
          WHERE valid_gpsno AND valid_time AND event_type IS NOT NULL
        ) TO {sql_quote(path)} (FORMAT PARQUET, COMPRESSION ZSTD)
        """
    )
    return relation_as_dict(
        con,
        f"""
        SELECT count(*) AS rows, count(DISTINCT gpsno) AS vehicles,
               min(event_time) AS min_time, max(event_time) AS max_time,
               count_if(speed_outlier) AS speed_outliers,
               count_if(NOT coordinate_valid) AS invalid_coordinates,
               count_if(NOT known_event_code) AS unknown_event_codes,
               count_if(event_type=11803) AS accident_rows,
               count_if(event_type=11804) AS near_miss_rows
        FROM read_parquet({sql_quote(path)})
        """,
    )


def trajectory_typed_sql(files: list[Path], limit: int | None) -> str:
    raw = read_csv_sql(files, TRAJECTORY_COLUMNS, limit)
    return f"""
    WITH raw AS ({raw})
    SELECT trim(gpsno_raw) AS gpsno,
           try_cast(distance_text AS BIGINT) AS distance_cm,
           try_cast(run_time_text AS BIGINT) AS run_time_seconds,
           try_strptime(trigger_time_text, '%Y-%m-%d %H:%M:%S') AS event_time,
           try_cast(speed_text AS DOUBLE) AS speed_raw,
           try_cast(course_text AS DOUBLE) AS course_raw,
           try_cast(lat_text AS DOUBLE) AS lat_raw,
           try_cast(lng_text AS DOUBLE) AS lng_raw
    FROM raw
    """


def clean_trajectory(con, output_dir: Path, overwrite: bool, limit: int | None,
                     sample_files: int | None, row_level: bool) -> dict:
    daily_path = output_dir / "trajectory_daily.parquet"
    files = choose_files("data/raw/trajectory/*.gz", sample_files)
    typed = trajectory_typed_sql(files, limit)
    if ensure_can_write(daily_path, overwrite):
        con.execute(
            f"""
            COPY (
              WITH typed AS ({typed}), valid AS (
                SELECT *, cast(event_time AS DATE) AS event_date,
                       speed_raw BETWEEN 0 AND 160 AS speed_valid,
                       course_raw BETWEEN 0 AND 360 AS course_valid,
                       lat_raw BETWEEN 3 AND 54 AND lng_raw BETWEEN 73 AND 136 AS coordinate_valid,
                       distance_cm IS NOT NULL AND distance_cm >= 0 AS distance_valid,
                       run_time_seconds IS NOT NULL AND run_time_seconds >= 0 AS run_time_valid
                FROM typed
                WHERE gpsno IS NOT NULL AND gpsno <> ''
                  AND event_time >= TIMESTAMP {sql_quote(START_TS)}
                  AND event_time < TIMESTAMP {sql_quote(END_TS_EXCLUSIVE)}
              )
              SELECT gpsno, event_date,
                     count(*) AS source_rows,
                     cast(count_if(speed_valid) AS BIGINT) AS valid_speed_rows,
                     cast(count_if(NOT speed_valid) AS BIGINT) AS invalid_speed_rows,
                     avg(speed_raw) FILTER (WHERE speed_valid) AS speed_mean_kmh,
                     stddev_pop(speed_raw) FILTER (WHERE speed_valid) AS speed_std_kmh,
                     max(speed_raw) FILTER (WHERE speed_valid) AS speed_max_kmh,
                     cast(count_if(speed_valid AND speed_raw > 0) AS BIGINT) AS moving_rows,
                     cast(count_if(coordinate_valid) AS BIGINT) AS valid_coordinate_rows,
                     cast(count_if(NOT coordinate_valid) AS BIGINT) AS invalid_coordinate_rows,
                     cast(count_if(NOT course_valid) AS BIGINT) AS invalid_course_rows,
                     cast(count_if(NOT distance_valid) AS BIGINT) AS invalid_distance_rows,
                     cast(count_if(distance_valid AND distance_cm > 500000) AS BIGINT) AS large_distance_gap_rows,
                     sum(distance_cm) FILTER (WHERE distance_valid) / 100000.0 AS distance_km,
                     cast(count_if(NOT run_time_valid) AS BIGINT) AS invalid_run_time_rows,
                     sum(run_time_seconds) FILTER (WHERE run_time_valid) / 3600.0 AS run_time_hours
              FROM valid GROUP BY gpsno, event_date
            ) TO {sql_quote(daily_path)} (FORMAT PARQUET, COMPRESSION ZSTD)
            """
        )

    if row_level:
        rows_dir = output_dir / "trajectory_rows"
        if ensure_can_write(rows_dir, overwrite):
            rows_dir.mkdir(parents=True, exist_ok=True)
            con.execute(
                f"""
                COPY (
                  WITH typed AS ({typed})
                  SELECT gpsno, event_time, cast(event_time AS DATE) AS event_date,
                         CASE WHEN distance_cm >= 0 THEN distance_cm END AS distance_cm,
                         CASE WHEN run_time_seconds >= 0 THEN run_time_seconds END AS run_time_seconds,
                         CASE WHEN speed_raw BETWEEN 0 AND 160 THEN speed_raw END AS speed_kmh,
                         CASE WHEN course_raw BETWEEN 0 AND 360 THEN course_raw END AS course_deg,
                         CASE WHEN lat_raw BETWEEN 3 AND 54 AND lng_raw BETWEEN 73 AND 136 THEN lat_raw END AS lat,
                         CASE WHEN lat_raw BETWEEN 3 AND 54 AND lng_raw BETWEEN 73 AND 136 THEN lng_raw END AS lng
                  FROM typed WHERE gpsno IS NOT NULL AND gpsno <> ''
                    AND event_time >= TIMESTAMP {sql_quote(START_TS)}
                    AND event_time < TIMESTAMP {sql_quote(END_TS_EXCLUSIVE)}
                ) TO {sql_quote(rows_dir)}
                (FORMAT PARQUET, COMPRESSION ZSTD, PARTITION_BY (event_date), OVERWRITE_OR_IGNORE)
                """
            )

    return relation_as_dict(
        con,
        f"""
        SELECT sum(source_rows) AS rows, count(DISTINCT gpsno) AS vehicles,
               min(event_date) AS min_date, max(event_date) AS max_date,
               sum(invalid_speed_rows) AS invalid_speed_rows,
               sum(invalid_coordinate_rows) AS invalid_coordinate_rows,
               sum(invalid_distance_rows) AS invalid_distance_rows,
               sum(large_distance_gap_rows) AS large_distance_gap_rows
        FROM read_parquet({sql_quote(daily_path)})
        """,
    )


def imu_typed_sql(files: list[Path], limit: int | None) -> str:
    raw = read_csv_sql(files, IMU_COLUMNS, limit)
    numeric = ["ems_speed", "gps_speed", "accel_x", "accel_y", "accel_z", "gyro_x", "gyro_y", "gyro_z"]
    casts = ",\n".join(f"try_cast({name}_text AS DOUBLE) AS {name}" for name in numeric)
    return f"""
    WITH raw AS ({raw})
    SELECT trim(gpsno_raw) AS gpsno, trim(imei_raw) AS imei,
           try_strptime(data_time_text, '%Y-%m-%d %H:%M:%S') AS event_time,
           try_strptime(data_date_text, '%Y%m%d')::DATE AS reported_date,
           {casts}
    FROM raw
    """


def clean_imu(con, output_dir: Path, overwrite: bool, limit: int | None,
              sample_files: int | None, row_level: bool) -> dict:
    daily_path = output_dir / "imu_daily.parquet"
    files = choose_files("data/raw/imu/*.gz", sample_files)
    typed = imu_typed_sql(files, limit)
    if ensure_can_write(daily_path, overwrite):
        con.execute(
            f"""
            COPY (
              WITH typed AS ({typed}), valid AS (
                SELECT *, cast(event_time AS DATE) AS event_date,
                       sqrt(accel_x*accel_x + accel_y*accel_y + accel_z*accel_z) AS accel_norm,
                       sqrt(gyro_x*gyro_x + gyro_y*gyro_y + gyro_z*gyro_z) AS gyro_norm
                FROM typed
                WHERE gpsno IS NOT NULL AND gpsno <> ''
                  AND event_time >= TIMESTAMP {sql_quote(START_TS)}
                  AND event_time < TIMESTAMP {sql_quote(END_TS_EXCLUSIVE)}
              )
              SELECT gpsno, event_date,
                     count(*) AS source_rows, count(DISTINCT imei) AS imei_count,
                     cast(count_if(reported_date IS DISTINCT FROM event_date) AS BIGINT) AS date_mismatch_rows,
                     cast(count_if(ems_speed IS NULL) AS BIGINT) AS missing_ems_speed_rows,
                     cast(count_if(gps_speed IS NULL) AS BIGINT) AS missing_gps_speed_rows,
                     avg(ems_speed) FILTER (WHERE ems_speed BETWEEN 0 AND 160) AS ems_speed_mean,
                     max(ems_speed) FILTER (WHERE ems_speed BETWEEN 0 AND 160) AS ems_speed_max,
                     avg(gps_speed) FILTER (WHERE gps_speed BETWEEN 0 AND 160) AS gps_speed_mean,
                     max(gps_speed) FILTER (WHERE gps_speed BETWEEN 0 AND 160) AS gps_speed_max,
                     avg(abs(ems_speed-gps_speed)) FILTER (
                       WHERE ems_speed BETWEEN 0 AND 160 AND gps_speed BETWEEN 0 AND 160
                     ) AS ems_gps_abs_diff_mean,
                     avg(accel_x) AS accel_x_mean, stddev_pop(accel_x) AS accel_x_std, max(abs(accel_x)) AS accel_x_abs_max,
                     avg(accel_y) AS accel_y_mean, stddev_pop(accel_y) AS accel_y_std, max(abs(accel_y)) AS accel_y_abs_max,
                     avg(accel_z) AS accel_z_mean, stddev_pop(accel_z) AS accel_z_std, max(abs(accel_z)) AS accel_z_abs_max,
                     avg(accel_norm) AS accel_norm_mean, stddev_pop(accel_norm) AS accel_norm_std, max(accel_norm) AS accel_norm_max,
                     avg(gyro_x) AS gyro_x_mean, stddev_pop(gyro_x) AS gyro_x_std, max(abs(gyro_x)) AS gyro_x_abs_max,
                     avg(gyro_y) AS gyro_y_mean, stddev_pop(gyro_y) AS gyro_y_std, max(abs(gyro_y)) AS gyro_y_abs_max,
                     avg(gyro_z) AS gyro_z_mean, stddev_pop(gyro_z) AS gyro_z_std, max(abs(gyro_z)) AS gyro_z_abs_max,
                     avg(gyro_norm) AS gyro_norm_mean, stddev_pop(gyro_norm) AS gyro_norm_std, max(gyro_norm) AS gyro_norm_max,
                     cast(count_if(accel_norm NOT BETWEEN 0.5 AND 1.5) AS BIGINT) AS accel_norm_outlier_rows,
                     cast(count_if(gyro_norm > 20) AS BIGINT) AS gyro_norm_gt20_rows
              FROM valid GROUP BY gpsno, event_date
            ) TO {sql_quote(daily_path)} (FORMAT PARQUET, COMPRESSION ZSTD)
            """
        )

    if row_level:
        rows_dir = output_dir / "imu_rows"
        if ensure_can_write(rows_dir, overwrite):
            rows_dir.mkdir(parents=True, exist_ok=True)
            con.execute(
                f"""
                COPY (
                  WITH typed AS ({typed})
                  SELECT *, cast(event_time AS DATE) AS event_date
                  FROM typed WHERE gpsno IS NOT NULL AND gpsno <> ''
                    AND event_time >= TIMESTAMP {sql_quote(START_TS)}
                    AND event_time < TIMESTAMP {sql_quote(END_TS_EXCLUSIVE)}
                ) TO {sql_quote(rows_dir)}
                (FORMAT PARQUET, COMPRESSION ZSTD, PARTITION_BY (event_date), OVERWRITE_OR_IGNORE)
                """
            )

    return relation_as_dict(
        con,
        f"""
        SELECT sum(source_rows) AS rows, count(DISTINCT gpsno) AS vehicles,
               min(event_date) AS min_date, max(event_date) AS max_date,
               sum(date_mismatch_rows) AS date_mismatch_rows,
               sum(missing_ems_speed_rows) AS missing_ems_speed_rows,
               sum(missing_gps_speed_rows) AS missing_gps_speed_rows,
               sum(accel_norm_outlier_rows) AS accel_norm_outlier_rows,
               sum(gyro_norm_gt20_rows) AS gyro_norm_gt20_rows
        FROM read_parquet({sql_quote(daily_path)})
        """,
    )


def build_vehicle_day(con, output_dir: Path, overwrite: bool) -> dict:
    path = output_dir / "vehicle_day.parquet"
    required = [output_dir / "trajectory_daily.parquet", output_dir / "imu_daily.parquet"]
    if not all(p.exists() for p in required):
        return {"skipped": "需要先生成 trajectory_daily.parquet 和 imu_daily.parquet"}
    if ensure_can_write(path, overwrite):
        con.execute(
            f"""
            COPY (
              SELECT coalesce(t.gpsno, i.gpsno) AS gpsno,
                     coalesce(t.event_date, i.event_date) AS event_date,
                     t.source_rows AS trajectory_source_rows,
                     t.* EXCLUDE (gpsno, event_date, source_rows),
                     i.source_rows AS imu_source_rows,
                     i.* EXCLUDE (gpsno, event_date, source_rows)
              FROM read_parquet({sql_quote(required[0])}) t
              FULL OUTER JOIN read_parquet({sql_quote(required[1])}) i
              USING (gpsno, event_date)
            ) TO {sql_quote(path)} (FORMAT PARQUET, COMPRESSION ZSTD)
            """
        )
    return relation_as_dict(
        con,
        f"SELECT count(*) AS row_count, count(DISTINCT gpsno) AS vehicles, "
        f"min(event_date) AS min_date, max(event_date) AS max_date "
        f"FROM read_parquet({sql_quote(path)})",
    )


def main() -> None:
    parser = argparse.ArgumentParser(description="流式清洗比赛数据，无需解压原始 gzip 文件")
    parser.add_argument("--stages", nargs="+", default=["profile", "risk", "trajectory", "imu", "vehicle_day"],
                        choices=["profile", "risk", "trajectory", "imu", "vehicle_day"])
    parser.add_argument("--output-dir", type=Path, default=ROOT / "data" / "processed" / "cleaned")
    parser.add_argument("--overwrite", action="store_true")
    parser.add_argument("--row-level", action="store_true",
                        help="额外物化轨迹和IMU逐行Parquet；需要大量磁盘，默认关闭")
    parser.add_argument("--sample-files", type=int, default=None,
                        help="仅使用每类前N个分片，用于冒烟测试")
    parser.add_argument("--limit", type=int, default=None,
                        help="每个阶段最多读取N行，仅用于冒烟测试")
    parser.add_argument("--threads", type=int, default=max(1, min(4, os.cpu_count() or 1)))
    parser.add_argument("--memory-limit", default="4GB")
    args = parser.parse_args()

    output_dir = args.output_dir.resolve()
    output_dir.mkdir(parents=True, exist_ok=True)
    temp_dir = output_dir / "_duckdb_tmp"
    temp_dir.mkdir(exist_ok=True)

    con = duckdb.connect()
    con.execute(f"SET threads={args.threads}")
    con.execute(f"SET memory_limit={sql_quote(args.memory_limit)}")
    con.execute(f"SET temp_directory={sql_quote(temp_dir)}")
    con.execute("SET preserve_insertion_order=false")

    started = time.time()
    report = {
        "generated_at": time.strftime("%Y-%m-%d %H:%M:%S"),
        "observation_window": {"start": START_TS, "end_exclusive": END_TS_EXCLUSIVE},
        "mode": {"sample_files": args.sample_files, "limit": args.limit, "row_level": args.row_level},
        "stages": {},
    }
    stage_functions = {
        "profile": lambda: clean_profile(con, output_dir, args.overwrite),
        "risk": lambda: clean_risk(con, output_dir, args.overwrite, args.limit),
        "trajectory": lambda: clean_trajectory(
            con, output_dir, args.overwrite, args.limit, args.sample_files, args.row_level
        ),
        "imu": lambda: clean_imu(
            con, output_dir, args.overwrite, args.limit, args.sample_files, args.row_level
        ),
        "vehicle_day": lambda: build_vehicle_day(con, output_dir, args.overwrite),
    }
    for stage in args.stages:
        print(f"[{time.strftime('%H:%M:%S')}] 开始：{stage}", flush=True)
        stage_started = time.time()
        result = stage_functions[stage]()
        result["elapsed_seconds"] = round(time.time() - stage_started, 2)
        report["stages"][stage] = result
        print(f"[{time.strftime('%H:%M:%S')}] 完成：{stage} -> {result}", flush=True)
        write_json(output_dir / "quality_report.json", report)

    report["elapsed_seconds"] = round(time.time() - started, 2)
    report["disk_free_gb_after"] = round(shutil.disk_usage(output_dir).free / 1024**3, 2)
    write_json(output_dir / "quality_report.json", report)
    try:
        temp_dir.rmdir()
    except OSError:
        pass
    print(f"质量报告：{output_dir / 'quality_report.json'}")


if __name__ == "__main__":
    main()
