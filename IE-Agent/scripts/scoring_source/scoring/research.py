"""Bounded scoring research: freeze on development, report historical evidence."""
import json
from datetime import timedelta
from pathlib import Path
import numpy as np
import pandas as pd
from .enhanced import ScoreSource, enhanced_score, metrics, DIMS, DEFAULT_LEVEL_POLICY
from .integrated import aligned_labels
from .additive import fit, fit_scales, apply
from .risk_evidence import evidence, risk_stats, paired_comparison, clustered_auc_difference

ROOT = Path(__file__).resolve().parents[2]
OUT = ROOT / 'outputs/scoring_research'


def write(path, value):
    path.write_text(json.dumps(value, ensure_ascii=False, indent=2, allow_nan=False), encoding='utf-8')


def run():
    OUT.mkdir(parents=True, exist_ok=True)
    frozen = json.loads((ROOT / 'configs/submission/scoring_frozen.json').read_text(encoding='utf-8'))
    base_weights, reference = frozen['weights'], frozen['reference']
    source = ScoreSource()
    daily = pd.read_parquet(ROOT / 'outputs/features/risk_event_daily.parquet')
    daily.gpsno = daily.gpsno.astype(str)
    daily.event_date = pd.to_datetime(daily.event_date)
    cohort = sorted(pd.read_csv(ROOT / 'data/processed/cleaned/vehicle_profile.csv', dtype={'gpsno': str}).gpsno)
    def labels(end, horizon=14):
        end = pd.Timestamp(end)
        label_end = pd.Timestamp(end.date() + timedelta(days=horizon))
        counts = daily[daily.event_date.gt(end) & daily.event_date.le(label_end)]
        counts = counts.groupby('gpsno')[['evt_11803_count','evt_11804_count']].sum().reindex(cohort, fill_value=0)
        return pd.DataFrame({'gpsno': cohort, 'label': ((counts.evt_11803_count >= 1) | (counts.evt_11804_count >= 2)).astype(int).to_numpy(),
                             'auxiliary': ((counts.evt_11803_count + counts.evt_11804_count) > 0).astype(int).to_numpy()})
    def raw(end):
        return source.score(end, base_weights, reference)
    def score(end, config=None):
        details = raw(end)
        weights = base_weights
        if config is not None:
            details, weights = apply(details, config), config['weights']
        result, _ = enhanced_score(details, weights, level_policy=DEFAULT_LEVEL_POLICY)
        if config is not None:
            for k in range(1, 4):
                result[f'top_reason_{k}'] = result[f'top_reason_{k}'].str.replace('固定参考惩罚指数', '冻结单调函数惩罚指数', regex=False)
        result['risk_band'] = result.risk_level.map({'A': 'low', 'B': 'middle', 'C': 'middle', 'D': 'high'})
        return result
    training = raw('2026-06-14')
    target = labels('2026-06-14')
    y = aligned_labels(training, target)
    aux = training.gpsno.map(target.set_index('gpsno').auxiliary)
    scales = fit_scales(reference)
    candidates = {f'additive_{mapping}': fit(training, y, aux, mapping, scales, base_weights)
                  for mapping in ['percentile', 'rate']}
    comparisons = []
    for name, config in {'baseline': None, **candidates}.items():
        for end in ['2026-06-28','2026-06-30']:
            details = score(end, config)
            report = metrics(details, labels(end))
            comparisons.append({'candidate': name, 'date': end, **report})
    table = pd.DataFrame(comparisons)
    summary = table.groupby('candidate').agg(mean_auc=('auc','mean'), worst_auc=('auc','min'),
                                            mean_top50_recall=('top50_recall','mean'), mean_ap=('ap','mean'))
    base = summary.loc['baseline']
    eligible = summary[(summary.mean_auc >= base.mean_auc + .01) &
                       (summary.worst_auc >= base.worst_auc - .005) &
                       (summary.mean_top50_recall >= base.mean_top50_recall - 1e-9)]
    choice = eligible.mean_auc.idxmax() if len(eligible) else 'baseline'
    selected = candidates.get(choice)
    challenger_name = summary.drop(index='baseline').mean_auc.idxmax()
    challenger = candidates[challenger_name]
    selection = {'candidate': choice, 'model': selected, 'development': comparisons,
                 'selection_policy': {'mean_auc_gain': .01, 'worst_auc_tolerance': .005, 'top50_no_degradation': True},
                 'training_cutoff': '2026-06-14', 'training_label_end': '2026-06-28',
                 'selection_labels_available_at': '2026-07-14', 'selection_used_late_labels': False,
                 'diagnostic_challenger': challenger_name,
                 'challenger_policy': 'Highest development AUC among fixed candidates; diagnostic only; not promoted after failing gate',
                 'scope': 'All data previously viewed; bounded research, not new independent validation'}
    # Written before any late label/model comparison.
    write(OUT / 'selection_frozen.json', selection)
    write(OUT / 'candidate_models.json', candidates)
    summary.to_csv(OUT / 'development_summary.csv', encoding='utf-8', index=True)
    late_base, late_new = score('2026-07-17'), score('2026-07-17', selected)
    late_challenger = score('2026-07-17',challenger)
    late_target = labels('2026-07-17')
    base_y, new_y = aligned_labels(late_base,late_target), aligned_labels(late_new,late_target)
    write(OUT / 'baseline_evidence.json', evidence(late_base,base_y))
    write(OUT / 'selected_evidence.json', evidence(late_new,new_y))
    write(OUT / 'challenger_evidence.json', evidence(late_challenger,aligned_labels(late_challenger,late_target)))
    a = late_base.set_index('gpsno').reindex(cohort)
    b = late_challenger.set_index('gpsno').reindex(cohort)
    comparison = paired_comparison(late_target.label,100-a.safety_score,100-b.safety_score)
    write(OUT / 'paired_comparison.json', comparison)
    late_new.to_parquet(OUT / 'retrospective_scores.parquet', index=False)
    late_challenger.to_parquet(OUT / 'challenger_scores.parquet',index=False)
    panel = []
    for horizon, dates in [(14,['2026-07-14','2026-07-15','2026-07-16','2026-07-17']),
                           (7,['2026-07-14','2026-07-21'])]:
        outcomes, base_scores, new_scores = [], [], []
        reports = []
        for end in dates:
            target = labels(end,horizon)
            old = score(end).set_index('gpsno').reindex(cohort)
            new = score(end,challenger).set_index('gpsno').reindex(cohort)
            y = target.label.to_numpy()
            risks = [100-old.safety_score.to_numpy(),100-new.safety_score.to_numpy()]
            outcomes.append(y);base_scores.append(risks[0]);new_scores.append(risks[1])
            reports.append({'cutoff':end,'horizon':horizon,'positives':int(y.sum()),
                            'baseline':risk_stats(y,risks[0]),'selected':risk_stats(y,risks[1])})
            panel.append(pd.DataFrame({'gpsno':cohort,'cutoff':end,'horizon':horizon,'label':y,
                                       'baseline_risk':risks[0],'selected_risk':risks[1]}))
        write(OUT / f'cross_period_{horizon}d.json', {'windows':reports,
              'label_periods_overlap':horizon==14,
              'paired_vehicle_cluster_bootstrap':clustered_auc_difference(outcomes,base_scores,new_scores),
              'scope':'Retrospective existing data; seven-day horizon is auxiliary, not a 40-day validation'})
    pd.concat(panel).to_parquet(OUT / 'cross_period_panel.parquet', index=False)
    snapshots = [score(str(end.date()),selected) for end in pd.date_range('2026-07-24','2026-07-31')]
    pd.concat(snapshots).to_parquet(OUT / 'daily_scores.parquet',index=False)
    final = snapshots[-1].copy()
    final['score_change_7d'] = final.safety_score - final.gpsno.map(snapshots[0].set_index('gpsno').safety_score)
    final['reference_version'] = f'research_20260926_{choice}_fixed14'
    final.to_parquet(OUT / 'score_details.parquet',index=False)
    cols = pd.read_csv(ROOT / 'outputs/scoring/safety_scores.csv',nrows=0).columns.tolist()
    final[cols+['risk_band']].to_csv(OUT / 'safety_scores.csv',index=False,encoding='utf-8',lineterminator='\n')
    assert np.allclose(100-final.safety_score,final.observed_behavior_deduction,atol=1e-6)
    result = {'selected':choice,'diagnostic_challenger':challenger_name,'development':summary.reset_index().to_dict('records'),
              'late_paired_metrics':comparison,
              'new_independent_labels':'Unavailable; no new independent labels fabricated',
              'submission_change':'Research results separate; existing submission untouched pending evidence review'}
    write(OUT / 'result.json',result)
    print(json.dumps(result,ensure_ascii=False,indent=2),flush=True)


if __name__ == '__main__':
    run()
