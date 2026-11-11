"""Fixed-reference rolling score, matched decay and constrained pairwise learning."""
import argparse
import json
from datetime import timedelta
from pathlib import Path

import numpy as np
import pandas as pd
from scipy.optimize import minimize
from sklearn.metrics import roc_auc_score, average_precision_score

from .calculate_scores import collect_cleaned_frames, resolve_inputs, score_frames
from .integrated import make_reference, aligned_labels
from .scoring_rules import DEFAULT_WEIGHTS, default_rules_frame, validate_weights
from .event_taxonomy import DIMENSION_LABELS
from .reason_codes import REASON_CODES

ROOT = Path(__file__).resolve().parents[2]
OUT = ROOT / 'outputs/scoring'
DIMS = list(DEFAULT_WEIGHTS)
DEFAULT_LEVEL_POLICY = {
    'type': 'rank_percentile',
    'cutoffs': [0.20, 0.60, 0.90],
    'shares': {'A': 0.20, 'B': 0.40, 'C': 0.30, 'D': 0.10},
    'source': 'predefined_capacity_policy',
}



def dump(path, value):
    path.write_text(json.dumps(value, ensure_ascii=False, indent=2, allow_nan=False), encoding='utf-8')


def decayed_exposure(daily, start, end, half_life=14.):
    """End-of-day decay matches the event numerator, using day-midpoint exposure."""
    frame = daily[daily.event_date.between(pd.Timestamp(start), pd.Timestamp(end))].copy()
    age = (pd.Timestamp(end) - frame.event_date).dt.days + .5
    decay = np.power(2., -age / half_life)
    for col in ['distance_km', 'run_time_hours']:
        frame[col] = frame[col] * decay
    frame['active_days'] = (frame.moving_rows > 0).astype(float) * decay
    return frame.groupby('gpsno')[['distance_km', 'run_time_hours', 'active_days']].sum()


class ScoreSource:
    def __init__(self, window_days=14, half_life=14.):
        self.window_days=window_days
        self.half_life=half_life
        self.paths = resolve_inputs(ROOT / 'data/processed/cleaned')
        self.rules = default_rules_frame()
        self.daily = pd.read_parquet(self.paths['trajectory'])
        self.daily.event_date = pd.to_datetime(self.daily.event_date)
        self.daily.gpsno = self.daily.gpsno.astype(str)
        self.cache = {}

    def score(self, end, weights=None, reference=None, imu_mode='legacy'):
        start = str(pd.Timestamp(end).date()-timedelta(days=self.window_days-1))
        if end not in self.cache:
            frames = list(collect_cleaned_frames(self.paths, self.rules, end + ' 23:59:59', start)[:4])
            exposure = decayed_exposure(self.daily, start, end, self.half_life)
            trajectory = frames[1].copy()
            trajectory.gpsno = trajectory.gpsno.astype(str)
            for col in ['distance_km', 'run_time_hours', 'active_days']:
                trajectory['undecayed_' + col] = trajectory[col]
                trajectory[col] = trajectory.gpsno.map(exposure[col]).fillna(0)
            frames[1] = trajectory
            self.cache[end] = frames
        frames=[frame.copy() for frame in self.cache[end]]
        if imu_mode != 'legacy':
            raise ValueError('Only the frozen legacy IMU mode is retained')
        details, _, _ = score_frames(*frames, weights=weights or DEFAULT_WEIGHTS,
                                     reference=reference, observation_days=self.window_days, exposure_units=getattr(self,"exposure_units",None))
        details['as_of_date'] = end
        details['window_start'] = start
        return details


def penalty_matrix(details):
    values = details[[d + '_penalty' for d in DIMS]].copy()
    # A missing sensor is unknown, not evidence of perfect driving.
    values['imu_evidence_penalty'] = values['imu_evidence_penalty'].fillna(30.)
    return values.fillna(50.).to_numpy() / 100.


def learn_weights(details, official, auxiliary, max_adjustment=.10):
    x = penalty_matrix(details)
    prior = np.array(list(DEFAULT_WEIGHTS.values()))
    differences = []
    for target in [official, auxiliary]:
        y = np.asarray(target, dtype=int)
        if len(np.unique(y)) == 2:
            differences.append((x[y == 1, None, :] - x[None, y == 0, :]).reshape(-1, len(DIMS)))
    if not differences:
        return DEFAULT_WEIGHTS.copy(), {'status': 'no_train_pairs'}

    def loss(w):
        return float(np.mean([np.logaddexp(0, -4 * delta.dot(w)).mean() for delta in differences])
                     + 2 * np.square(w - prior).sum())

    constraints = [{'type': 'eq', 'fun': lambda w: w.sum() - 1},
                   {'type': 'ineq', 'fun': lambda w: w[0] - w[1:]},
                   {'type': 'ineq', 'fun': lambda w: np.array([w[1] - w[3], w[2] - w[3]])}]
    bounds = [(max(.01, v - max_adjustment), min(.10 if i == 5 else 1., v + max_adjustment))
              for i, v in enumerate(prior)]
    fit = minimize(loss, prior, method='SLSQP', bounds=bounds, constraints=constraints,
                   options={'maxiter': 300, 'ftol': 1e-12})
    weights = dict(zip(DIMS, map(float, fit.x))) if fit.success else DEFAULT_WEIGHTS.copy()
    validate_weights(weights)
    return weights, {'status': 'fit' if fit.success else 'fallback', 'message': str(fit.message),
                     'objective': loss(np.array(list(weights.values()))),
                     'max_adjustment': max_adjustment,
                     'evidence_status': 'low_positive_count' if np.sum(official)<20 else 'adequate',
                     'training_positives': int(np.sum(official)),
                     'auxiliary_positives': int(np.sum(auxiliary))}


def _validate_level_policy(policy):
    if policy.get('type') != 'rank_percentile':
        raise ValueError(f"Unknown level policy: {policy.get('type')}")
    cuts = np.asarray(policy.get('cutoffs', []), dtype=float)
    if len(cuts) != 3 or not np.all(np.isfinite(cuts)):
        raise ValueError('Rank-percentile policy requires three finite cutoffs')
    if not (0 < cuts[0] < cuts[1] < cuts[2] < 1):
        raise ValueError('Level cutoffs must be strictly increasing inside (0, 1)')
    return cuts


def enhanced_score(details, weights, boundaries=None, level_policy=None):
    result = details.copy()
    result['uncertainty_reserve'] = np.where(result.imu_evidence_penalty.isna(), 30 * weights['imu_evidence'], 0.)
    result['observed_behavior_deduction'] = sum(result[d + '_contribution'] for d in DIMS)
    # Missing IMU is uncertainty, not observed unsafe behaviour. Keep the
    # published score behavioural and expose a conservative floor separately.
    result['behavior_safety_score'] = (100-result['observed_behavior_deduction']).clip(0,100)
    result['confidence_adjusted_floor'] = (
        result['behavior_safety_score']-result['uncertainty_reserve']).clip(0,100)
    result['safety_score'] = result['behavior_safety_score']
    result = result.sort_values(['safety_score', 'gpsno'], ascending=[False, True]).reset_index(drop=True)
    result['rank'] = np.arange(1, len(result) + 1)
    result['risk_rank_percentile'] = result['rank'] / len(result)
    if level_policy is not None:
        cuts = _validate_level_policy(level_policy)
        result['risk_level'] = np.select(
            [result.risk_rank_percentile <= cuts[0], result.risk_rank_percentile <= cuts[1],
             result.risk_rank_percentile <= cuts[2]], ['A', 'B', 'C'], default='D')
    else:
        if boundaries is None:
            boundaries = np.quantile(result.safety_score, [.1, .4, .8]).tolist()
        result['risk_level'] = np.select(
            [result.safety_score >= boundaries[2], result.safety_score >= boundaries[1],
             result.safety_score >= boundaries[0]], ['A', 'B', 'C'], default='D')
    result['score_status'] = np.where(result.confidence_level.eq('low'), 'manual_review', 'usable_with_review')
    # Rebuild reasons against the fixed reference, with exact point decomposition.
    for idx, row in result.iterrows():
        dims = sorted([d for d in DIMS if pd.notna(row[d + '_penalty'])],
                      key=lambda d: (-row[d + '_contribution'], d))[:3]
        for k, d in enumerate(dims, 1):
            count = int(row[d + '_event_count'])
            evidence = (f'IMU异常采样点{count}个（不是独立事件次数）' if d == 'imu_evidence'
                        else f'记录{count}条；含暴露量及先验收缩') if count else '未记录事件；含低暴露先验收缩'
            result.at[idx, f'top_reason_{k}'] = (
                f'{DIMENSION_LABELS[d]}：{evidence}；固定参考惩罚指数'
                f'{row[d + "_penalty"]:.2f}；扣{row[d + "_contribution"]:.4f}分')
            for suffix, value in {
                'code': REASON_CODES[d], 'dimension': d,
                'penalty_points': round(row[d + '_contribution'], 4),
                'event_count': count, 'normalized_rate': row.get(d + '_rate', np.nan),
                'percentile': row[d + '_penalty'],
            }.items():
                result.at[idx, f'top_reason_{k}_{suffix}'] = value
        primary = dims[0]
        result.at[idx, 'primary_risk_dimension'] = primary
        result.at[idx, 'primary_risk_dimension_name'] = DIMENSION_LABELS[primary]
        result.at[idx, 'recommended_action'] = (
            '先复核数据覆盖及设备，不自动奖惩' if row.confidence_level == 'low' else
            {'A': '常规观察；人工审核后正向激励', 'B': '月度行为复盘',
             'C': '定向培训并每周复查', 'D': '优先事件复核、培训和每周跟踪'}[row.risk_level])
        result.at[idx, 'review_cycle'] = 'weekly' if row.risk_level in ['C', 'D'] else 'monthly'
    result['safety_score'] = result.safety_score.round(6)
    return result, boundaries


def wilson_interval(positive, count):
    """Binomial interval describes sampling noise, not out-of-time validity."""
    if count == 0:
        return None
    z = 1.959963984540054
    p = positive / count
    denominator = 1 + z*z/count
    center = (p + z*z/(2*count))/denominator
    radius = z*np.sqrt(p*(1-p)/count + z*z/(4*count*count))/denominator
    return [float(max(0, center-radius)), float(min(1, center+radius))]


def metrics(details, labels):
    y = aligned_labels(details, labels).to_numpy(dtype=int)
    risk = 100 - details.safety_score.to_numpy()
    ordered = np.argsort(-risk, kind='stable')
    groups = {}
    for level in 'ABCD':
        group = y[details.risk_level.eq(level)]
        groups[level] = {'n': len(group), 'positive': int(group.sum()),
                         'rate': float(group.mean()) if len(group) else None}
    for group in groups.values():
        group['wilson_ci95'] = wilson_interval(group['positive'], group['n'])
    rates = [g['rate'] for g in groups.values() if g['rate'] is not None]
    return {'auc': float(roc_auc_score(y, risk)), 'ap': float(average_precision_score(y, risk)),
            'top50_recall': float(y[ordered[:50]].sum() / max(1, y.sum())),
            'level_rates': groups, 'level_rate_monotonic': bool(np.all(np.diff(rates) >= 0)),
            'rows': len(y), 'positives': int(y.sum())}


def run():
    OUT.mkdir(parents=True, exist_ok=True)
    source = ScoreSource()
    labels = pd.read_parquet(ROOT / 'outputs/features/train_windows.parquet')
    labels.gpsno = labels.gpsno.astype(str)
    def target(end):
        return labels[labels.window_id.eq('validation_extra_14d_20260630_h14' if end == '2026-06-30'
                                         else f'auxiliary_14d_{end.replace("-", "")}_h14')]
    frozen = json.loads((ROOT / 'configs/submission/scoring_frozen.json').read_text(encoding='utf-8'))
    name = frozen['candidate']
    weights, reference = frozen['weights'], frozen['reference']
    mode, boundaries = frozen['imu_mode'], frozen['boundaries']
    level_policy = frozen['level_policy']
    fit = frozen['fit']
    validate_weights(weights)
    dump(OUT / 'frozen_scoring.json', frozen)
    late, _ = enhanced_score(source.score('2026-07-17',weights,reference,mode),weights,
                             boundaries, level_policy)
    report = metrics(late, target('2026-07-17'))
    report['evaluation_kind'] = frozen['evaluation_kind']
    report['candidate'] = name
    report['weights'] = weights
    dump(OUT / 'evaluation.json', report)
    late.to_parquet(OUT / 'retrospective_scores.parquet', index=False)
    snapshots = []
    for end in pd.date_range('2026-07-24', '2026-07-31'):
        final,_=enhanced_score(source.score(str(end.date()),weights,reference,mode),weights,
                               boundaries, level_policy)
        snapshots.append(final)
    history = pd.concat(snapshots, ignore_index=True)
    history.to_parquet(OUT / 'daily_scores.parquet', index=False)
    prior = snapshots[0].set_index('gpsno').safety_score
    final['score_change_7d'] = final.safety_score - final.gpsno.map(prior)
    final['reference_version'] = 'final_20260925_fixed_reference_14d'
    final.to_parquet(OUT / 'score_details.parquet', index=False)
    export = ['gpsno', 'safety_score', 'rank', 'risk_rank_percentile', 'risk_level',
              'as_of_date', 'window_start',
              'reference_version', 'confidence_score', 'confidence_level', 'score_status',
              'behavior_safety_score', 'confidence_adjusted_floor',
              'observed_behavior_deduction', 'uncertainty_reserve', 'score_change_7d',
              *[d + '_contribution' for d in DIMS], 'top_reason_1', 'top_reason_2', 'top_reason_3',
              'primary_risk_dimension', 'recommended_action', 'review_cycle']
    final[export].to_csv(OUT / 'safety_scores.csv', index=False, encoding='utf-8', lineterminator='\n')
    assert final.gpsno.nunique() == len(final) == 500
    assert np.allclose(100-final.safety_score,final.observed_behavior_deduction,atol=1e-6)
    assert np.allclose(final.confidence_adjusted_floor,
                       final.safety_score-final.uncertainty_reserve,atol=1e-6)
    print(json.dumps(report, ensure_ascii=False, indent=2), flush=True)


def update(end):
    frozen = json.loads((OUT / 'frozen_scoring.json').read_text(encoding='utf-8'))
    if pd.Timestamp(end) < pd.Timestamp(frozen['selection_labels_available_at']):
        raise ValueError('Frozen configuration was not available at the requested date')
    source = ScoreSource()
    if pd.Timestamp(end) > source.daily.event_date.max():
        raise ValueError('Requested update exceeds available daily data; ingest new data first')
    mode=frozen.get('imu_mode','legacy')
    frame, _ = enhanced_score(source.score(end,frozen['weights'],frozen['reference'],mode),
                              frozen['weights'], frozen['boundaries'], frozen.get('level_policy'))
    frame.to_csv(OUT / f'update_{end}.csv', index=False, encoding='utf-8', lineterminator='\n')


if __name__ == '__main__':
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--as-of', help='Optional daily/weekly/monthly update date, YYYY-MM-DD')
    args = parser.parse_args()
    update(args.as_of) if args.as_of else run()
