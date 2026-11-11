"""Create the four-file competition submission from the current model outputs."""
from __future__ import annotations

import argparse
import hashlib
import json
from pathlib import Path
import platform
import shutil
import subprocess
import zipfile

import pandas as pd
import numpy as np

from .validate import allowed_archive_name, validate

ROOT = Path(__file__).resolve().parents[2]


def encoded(value: dict) -> bytes:
    return json.dumps(value, ensure_ascii=False, indent=2, allow_nan=False).encode("utf-8")


def compile_report() -> Path:
    output = ROOT / "tmp/report"
    output.mkdir(parents=True, exist_ok=True)
    subprocess.run(["xelatex", "-interaction=nonstopmode", "-halt-on-error",
                    f"-output-directory={output}", "docs/method_report.tex"],
                   check=True, cwd=ROOT, stdout=subprocess.DEVNULL)
    path = output / "method_report.pdf"
    if not path.exists():
        raise FileNotFoundError(path)
    return path


def build(precompiled_pdf: Path | None = None) -> dict:
    folder = ROOT / "submission/final"
    audit = ROOT / "outputs/delivery/current"
    for path in (folder, audit):
        path.mkdir(parents=True, exist_ok=True)
    sources = {
        "forecast_result.csv": ROOT / "outputs/prediction/v2/forecast_result.csv",
        "safety_scores.csv": ROOT / "outputs/scoring/v2/safety_scores.csv",
    }
    for name, source in sources.items():
        shutil.copyfile(source, folder / name)
    pdf = precompiled_pdf if precompiled_pdf is not None else compile_report()
    target_pdf = folder / "method_report.pdf"
    if pdf.resolve() != target_pdf.resolve():
        shutil.copyfile(pdf, target_pdf)
    members: dict[str, bytes] = {}
    for tree in ["src", "tests"]:
        for path in sorted((ROOT / tree).rglob("*.py")):
            members[path.relative_to(ROOT).as_posix()] = path.read_bytes()
    members["docs/method_report.tex"] = (ROOT / "docs/method_report.tex").read_bytes()
    members["README.md"] = (ROOT / "README.md").read_bytes()
    for name in ["requirements.txt", "requirements-lock.txt"]:
        members[name] = (ROOT / name).read_bytes()
    for path in sorted((ROOT / "configs/submission").glob("*.json")):
        members[path.relative_to(ROOT).as_posix()] = path.read_bytes()
    for name, relative in [
        ("prediction_v2", "outputs/prediction/v2/evaluation.json"),
        ("scoring_v2", "outputs/scoring/v2/evaluation.json"),
    ]:
        members[f"evidence/{name}.json"] = (ROOT / relative).read_bytes()
    if not all(allowed_archive_name(name) for name in members):
        raise ValueError("Package contains a non-whitelisted path")
    manifest = {
        "version": "competition_submission", "python": platform.python_version(),
        "files": {name: hashlib.sha256(content).hexdigest() for name, content in sorted(members.items())},
        "data_policy": "No raw or cleaned competition data, vehicle features, or model binaries",
    }
    members["MANIFEST.json"] = encoded(manifest)
    with zipfile.ZipFile(folder / "source_code.zip", "w", compression=zipfile.ZIP_DEFLATED,
                         compresslevel=9) as archive:
        for name, content in sorted(members.items()):
            info = zipfile.ZipInfo(name, date_time=(2026, 9, 28, 0, 0, 0))
            info.compress_type = zipfile.ZIP_DEFLATED
            archive.writestr(info, content)
    ids = pd.read_csv(ROOT / "data/processed/cleaned/vehicle_profile.csv", dtype={"gpsno": str}).gpsno
    result = validate(folder, ids)
    scores = pd.read_csv(folder / "safety_scores.csv", dtype={"gpsno": str})
    forecast = pd.read_csv(folder / "forecast_result.csv", dtype={"gpsno": str})
    if not scores.score_method.eq("fixed_exposure_event_increment_v2").all():
        raise ValueError("Submission contains a different scoring method")
    if not scores.prior_background_deduction.ge(0).all():
        raise ValueError("Prior background deduction must be nonnegative")
    aligned = scores.set_index("gpsno").reindex(forecast.gpsno)
    if not np.allclose(aligned.forecast_40d_risk_prob, forecast.risk_prob, atol=1e-12):
        raise ValueError("Cross-task forecast probability differs from task one")
    with zipfile.ZipFile(folder / "source_code.zip") as archive:
        if archive.read("docs/method_report.tex") != (ROOT / "docs/method_report.tex").read_bytes():
            raise ValueError("Packaged TeX differs from report source")
    result["method_and_cross_task_checks"] = "pass"
    (audit / "acceptance.json").write_bytes(encoded(result))
    return result


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--precompiled-pdf", type=Path)
    args = parser.parse_args()
    print(json.dumps(build(args.precompiled_pdf), ensure_ascii=False, indent=2))
