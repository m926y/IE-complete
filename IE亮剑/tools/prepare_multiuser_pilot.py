"""Build three-row import samples from the frozen agent starter data."""

import csv
import json
from pathlib import Path


ROOT = Path(__file__).resolve().parents[1] / "outputs" / "agent_starter"
OUT = Path(__file__).resolve().parents[1] / "docs" / "competition" / "qwenwork_multiuser_input" / "pilot"
CASES = json.loads((ROOT / "demo_cases.json").read_text(encoding="utf-8"))["cases"]


def write_sample(table: str, key: str) -> None:
    source = ROOT / "import" / f"{table}.csv"
    with source.open(encoding="utf-8-sig", newline="") as handle:
        reader = csv.DictReader(handle)
        fields = reader.fieldnames
        wanted = {case[key] for case in CASES}
        rows = [row for row in reader if row[key] in wanted]

    if fields is None or len(rows) != len(wanted):
        raise ValueError(f"{table}: expected {len(wanted)} sample rows, got {len(rows)}")

    OUT.mkdir(parents=True, exist_ok=True)
    with (OUT / f"{table}.csv").open("w", encoding="utf-8", newline="") as handle:
        writer = csv.DictWriter(handle, fieldnames=fields)
        writer.writeheader()
        writer.writerows(rows)


for name, business_key in (
    ("drivers", "driver_id"),
    ("risk_snapshots", "gpsno"),
    ("score_snapshots", "gpsno"),
):
    write_sample(name, business_key)
