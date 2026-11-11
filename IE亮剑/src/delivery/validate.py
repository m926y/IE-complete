"""Strict four-file delivery acceptance; no network and no publishing."""
import argparse
import hashlib
import json
from pathlib import Path, PurePosixPath
import zipfile

import numpy as np
import pandas as pd
from pypdf import PdfReader
from src.prediction.validate_submission import validate_submission
from src.scoring.score_core import DIMS

EXPECTED = {'forecast_result.csv', 'safety_scores.csv', 'method_report.pdf', 'source_code.zip'}


def digest(data):
    return hashlib.sha256(data).hexdigest()


def allowed_archive_name(name):
    path = PurePosixPath(name)
    if path.is_absolute() or '..' in path.parts or '\\' in name or ':' in name:
        return False
    if name in {'README.md', 'requirements.txt', 'requirements-lock.txt', 'MANIFEST.json'}:
        return True
    return ((path.parts[0] in {'src', 'tests'} and path.suffix == '.py')
            or (path.parts[0] == 'src' and path.name == 'README.md')
            or (path.parts[0] == 'docs' and path.suffix in {'.md', '.tex'})
            or (path.parts[0] in {'configs', 'evidence'} and path.suffix == '.json'))


def validate(folder, expected_ids=None):
    folder = Path(folder)
    if {p.name for p in folder.iterdir()} != EXPECTED:
        raise ValueError('Submission folder must contain exactly the four official files')
    files = {}
    for name in sorted(EXPECTED):
        data = (folder / name).read_bytes()
        if not 0 < len(data) < 50_000_000:
            raise ValueError(f'Invalid size: {name}')
        files[name] = {'bytes': len(data), 'sha256': digest(data)}
        if name.endswith('.csv'):
            if data.startswith(b'\xef\xbb\xbf') or b'\r' in data:
                raise ValueError('CSV must use UTF-8 without BOM and LF line endings')
            data.decode('utf-8')
    prediction = pd.read_csv(folder / 'forecast_result.csv', dtype={'gpsno': str})
    result = validate_submission(prediction, expected_ids=expected_ids)
    if not pd.api.types.is_integer_dtype(prediction.accident.dtype):
        raise ValueError('accident must be an integer column')
    scores = pd.read_csv(folder / 'safety_scores.csv', dtype={'gpsno': str})
    if len(scores) != 500 or scores.gpsno.nunique() != 500 or set(scores.gpsno) != set(prediction.gpsno):
        raise ValueError('Task two vehicle set mismatch')
    if not np.isfinite(scores.safety_score).all() or not scores.safety_score.between(0, 100).all():
        raise ValueError('Invalid scores')
    if sorted(scores['rank']) != list(range(1, 501)) or not scores.risk_level.isin(list('ABCD')).all():
        raise ValueError('Invalid ranks or levels')
    ordered = scores.sort_values('rank')
    if not ordered.safety_score.is_monotonic_decreasing:
        raise ValueError('Ranking inconsistent with score')
    contribution = scores[[d + '_contribution' for d in DIMS]].sum(axis=1)
    if not np.allclose(contribution, scores.observed_behavior_deduction, atol=1e-8):
        raise ValueError('Dimension contributions do not reconcile')
    if not np.allclose(100 - scores.safety_score, contribution, atol=1e-6):
        raise ValueError('Score decomposition does not reconcile')
    if not np.allclose(scores.confidence_adjusted_floor,
                       (scores.safety_score - scores.uncertainty_reserve).clip(0, 100), atol=1e-6):
        raise ValueError('Uncertainty floor does not reconcile')
    if not np.allclose(scores.behavior_safety_score, scores.safety_score, atol=1e-6):
        raise ValueError('Behavior score differs from reported safety score')
    percentile = scores['rank']/len(scores)
    levels = np.select([percentile <= .2, percentile <= .6, percentile <= .9], ['A', 'B', 'C'], default='D')
    if not np.allclose(scores.risk_rank_percentile, percentile) or not np.array_equal(scores.risk_level, levels):
        raise ValueError('Capacity-based levels inconsistent with rank')
    if not scores[[f'top_reason_{i}' for i in range(1, 4)]].notna().all().all():
        raise ValueError('Missing score explanations')
    reader = PdfReader(folder / 'method_report.pdf')
    pdf_text = '\n'.join(page.extract_text() or '' for page in reader.pages)
    if len(reader.pages) < 5 or 'risk_prob' not in pdf_text or '11804' not in pdf_text:
        raise ValueError('Missing PDF content')
    with zipfile.ZipFile(folder / 'source_code.zip') as archive:
        names = archive.namelist()
        if len(names) != len(set(names)) or not all(allowed_archive_name(n) for n in names):
            raise ValueError('Unsafe or non-whitelisted archive member')
        if archive.testzip() is not None:
            raise ValueError('ZIP integrity error')
        manifest = json.loads(archive.read('MANIFEST.json'))
        if set(manifest['files']) != set(names) - {'MANIFEST.json'}:
            raise ValueError('ZIP manifest membership mismatch')
        for name, fingerprint in manifest['files'].items():
            if digest(archive.read(name)) != fingerprint:
                raise ValueError(f'ZIP manifest hash mismatch: {name}')
        required = {'src/reproduce_submission.py', 'README.md', 'requirements-lock.txt',
                    'configs/submission/prediction_features.json',
                    'configs/submission/scoring_reference.json', 'docs/method_report.tex'}
        if not required.issubset(names):
            raise ValueError('Missing reproduction files')
    return {'status': 'pass', 'files': files, 'task1': result, 'task2_rows': len(scores),
            'score_decomposition': 'pass', 'pdf_pages': len(reader.pages), 'zip_files': len(names),
            'privacy': 'Code ZIP excludes raw/cleaned data, vehicle features, models and official source PDFs',
            'caveat': 'Result CSVs contain competition IDs; only submit through authorized channels'}


if __name__ == '__main__':
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('folder', type=Path)
    args = parser.parse_args()
    print(json.dumps(validate(args.folder), ensure_ascii=False, indent=2))
