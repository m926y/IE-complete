"""Prepare local Qianwen import data; never changes source model results."""
from pathlib import Path
import hashlib
import json
import sys

import duckdb
import numpy as np
import pandas as pd

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT))
from src.scoring.event_taxonomy import DIMENSION_LABELS, EVENT_TAXONOMY

OUT = ROOT / 'outputs/agent_starter'
DIMS = list(DIMENSION_LABELS)


def main():
    OUT.mkdir(parents=True, exist_ok=True)
    tables = OUT / 'import'
    tables.mkdir(exist_ok=True)
    manifest = {}

    def emit(name, df, pk):
        assert not df[pk].isna().any(), (name, 'null key')
        assert df[pk].is_unique, (name, 'duplicate key')
        df.to_csv(tables / f'{name}.csv', index=False, encoding='utf-8-sig')
        manifest[name] = {'rows': len(df), 'primary_key': pk, 'columns': list(df.columns)}

    scores = pd.read_csv(ROOT / 'outputs/scoring/v2/safety_scores.csv', dtype={'gpsno': str})
    forecast = pd.read_csv(ROOT / 'outputs/prediction/v2/forecast_result.csv', dtype={'gpsno': str})
    queue = pd.read_csv(ROOT / 'outputs/scoring/v2/review_queue.csv', dtype={'gpsno': str})
    assert len(scores) == len(forecast) == len(queue) == 500
    assert set(scores.gpsno) == set(forecast.gpsno) == set(queue.gpsno)
    assert forecast.risk_prob.between(0, 1).all()
    assert np.allclose(scores[DIMS[0] + '_contribution'] + scores[[d + '_contribution' for d in DIMS[1:]]].sum(axis=1), 100 - scores.safety_score, atol=1e-5)
    date = str(scores.as_of_date.iloc[0])
    assert scores.as_of_date.nunique() == 1
    assert np.allclose(scores.set_index('gpsno').forecast_40d_risk_prob.sort_index(), forecast.set_index('gpsno').risk_prob.sort_index(), atol=1e-10)
    source_files = ['outputs/scoring/v2/safety_scores.csv', 'outputs/prediction/v2/forecast_result.csv', 'outputs/scoring/v2/review_queue.csv', 'configs/submission/scoring_reference.json', 'outputs/scoring/v2/daily_scores.parquet', 'outputs/scoring/v2/event_contribution_ledger.csv', 'data/processed/cleaned/risk_events.parquet']
    hashes = {p: hashlib.sha256((ROOT / p).read_bytes()).hexdigest() for p in source_files}
    version = 'snapshot_' + hashlib.sha256(json.dumps(hashes, sort_keys=True).encode()).hexdigest()[:12]
    ids = sorted(scores.gpsno)
    drivers = pd.DataFrame({'driver_id': [f'DEMO_D{i:04}' for i in range(1, 501)], 'gpsno': ids})
    drivers['display_name'] = [f'演示司机{i:04}' for i in range(1, 501)]
    drivers['fleet_id'] = 'DEMO_FLEET'
    drivers['identity_status'] = 'synthetic_demo_mapping'
    drivers['mapping_start'] = '2026-06-01'
    drivers['mapping_end'] = date
    emit('drivers', drivers, 'driver_id')
    mapping = drivers.set_index('gpsno').driver_id
    forecast = forecast.sort_values(['risk_prob', 'gpsno'], ascending=[False, True]).reset_index(drop=True)
    forecast['risk_rank'] = np.arange(1, len(forecast) + 1)
    forecast['as_of_date'] = date
    forecast['horizon_days'] = 40
    forecast['source_version'] = version
    forecast['snapshot_id'] = forecast.gpsno + '_' + date
    emit('risk_snapshots', forecast.drop(columns=['accident']), 'snapshot_id')
    scores['driver_id'] = scores.gpsno.map(mapping)
    scores['score_id'] = scores.gpsno + '_' + scores.as_of_date
    scores['source_version'] = version
    emit('score_snapshots', scores, 'score_id')
    queue['queue_id'] = queue.gpsno + '_' + date
    queue['as_of_date'] = date
    queue['source_version'] = version
    emit('review_queue', queue, 'queue_id')
    con = duckdb.connect()
    daily = con.execute('select * from read_parquet(?)', [str(ROOT / 'outputs/scoring/v2/daily_scores.parquet')]).df()
    keep = ['gpsno', 'as_of_date', 'window_start', 'safety_score', 'rank', 'risk_level', 'confidence_score', 'confidence_level', 'score_method', 'score_status', 'confidence_adjusted_floor'] + [d + '_contribution' for d in DIMS]
    daily = daily[keep].copy()
    daily['as_of_date'] = daily.as_of_date.astype(str)
    daily['window_start'] = daily.window_start.astype(str)
    daily['driver_id'] = daily.gpsno.map(mapping)
    daily['score_id'] = daily.gpsno + '_' + daily.as_of_date
    daily['source_version'] = version
    assert np.allclose(daily[[d + '_contribution' for d in DIMS]].sum(axis=1), 100 - daily.safety_score, atol=1e-5)
    emit('score_history', daily, 'score_id')
    ledger = pd.read_csv(ROOT / 'outputs/scoring/v2/event_contribution_ledger.csv', dtype={'gpsno': str})
    ledger['ledger_id'] = ledger.gpsno + '_' + ledger.event_type.astype(str) + '_' + date
    ledger['as_of_date'] = date
    ledger['source_version'] = version
    allocated = ledger.groupby(['gpsno', 'dimension']).allocated_points.sum()
    for dim in DIMS:
        got = allocated.xs(dim, level='dimension') if dim in allocated.index.get_level_values('dimension') else pd.Series(dtype=float)
        assert np.allclose(got.reindex(scores.gpsno, fill_value=0), scores[f'{dim}_contribution'], atol=1e-5), dim
    emit('deduction_ledger', ledger, 'ledger_id')
    joined = scores.merge(forecast[['gpsno', 'risk_rank']], on='gpsno', validate='one_to_one')
    selections = []
    used = set()
    for label, mask in [('优先复核', (joined.risk_rank <= 100) & joined.risk_level.isin(['C', 'D']) & joined.confidence_level.ne('low')), ('低可信度', joined.confidence_level.eq('low')), ('常规观察', joined.risk_level.isin(['A', 'B']) & (joined.risk_rank > 100) & joined.confidence_level.ne('low'))]:
        subset = joined.loc[mask & ~joined.gpsno.isin(used)].sort_values(['risk_rank', 'gpsno'])
        if subset.empty:
            selections.append({'scenario': label, 'availability': 'not_available_in_snapshot'})
            continue
        row = subset.iloc[0]
        used.add(row.gpsno)
        selections.append({'scenario': label, 'gpsno': row.gpsno, 'driver_id': row.driver_id, 'display_name': drivers.set_index('gpsno').loc[row.gpsno, 'display_name'], 'risk_rank': int(row.risk_rank), 'risk_prob': float(row.forecast_40d_risk_prob), 'safety_score': float(row.safety_score), 'risk_level': row.risk_level, 'confidence_level': row.confidence_level, 'availability': 'available'})
    # Replay uses past-only daily scores. Final-date probabilities are NOT backfilled.
    start, end = daily.as_of_date.min(), daily.as_of_date.max()
    event_path = str(ROOT / 'data/processed/cleaned/risk_events.parquet')
    replay_day = con.execute('select cast(event_date as varchar) d from read_parquet(?) where event_date > cast(? as date) and event_date <= cast(? as date) and event_type in (11803,11804) group by d order by count(*) desc,d desc limit 1', [event_path, start, end]).fetchone()
    replay_day = replay_day[0] if replay_day else end
    replay_ids = [x['gpsno'] for x in selections if x.get('availability') == 'available']
    # Add a vehicle with an observed accident/near miss on the replay day.
    trigger = con.execute('select gpsno from read_parquet(?) where event_date=cast(? as date) and event_type in (11803,11804) order by event_time,gpsno limit 1', [event_path, replay_day]).fetchone()
    if trigger and trigger[0] not in replay_ids:
        replay_ids.append(trigger[0])
    marks = ','.join('?' for _ in replay_ids)
    events = con.execute(f'select gpsno,event_time,event_type,event_name,speed_kmh from read_parquet(?) where event_date=cast(? as date) and gpsno in ({marks}) order by event_time,gpsno,event_type,event_name,speed_kmh', [event_path, replay_day, *replay_ids]).df()
    events['event_time'] = events.event_time.astype(str)
    events['event_id'] = [f'REPLAY_{replay_day}_{i:07}' for i in range(1, len(events) + 1)]
    events['driver_id'] = events.gpsno.map(mapping)
    events['dimension'] = events.event_type.map(lambda c: EVENT_TAXONOMY.get(int(c), ('', 'unknown'))[1])
    events['replay_date'] = replay_day
    events['is_replay'] = True
    events['source_version'] = version
    emit('replay_events', events, 'event_id')
    frozen = json.loads((ROOT / 'configs/submission/scoring_reference.json').read_text(encoding='utf-8'))
    rules = pd.DataFrame([{'dimension': d, 'dimension_name': label, 'weight': frozen['weights'][d], 'window_days': 14, 'score_method': scores.score_method.iloc[0], 'editable': False, 'source_version': version} for d, label in DIMENSION_LABELS.items()])
    emit('evaluation_rules', rules, 'dimension')
    courses = pd.DataFrame([
        {'course_id': 'DEMO_C01', 'title': '跟车与车道保持复盘', 'dimension': 'driving_stability', 'content': '演示课程：回顾已核实事件，记录当时车距、道路及注意力情况；结合车队正式制度填写下次行程的检查清单。', 'completion_requirement': '提交一条事件复盘与两项行动；安全员复核', 'content_status': 'demo_draft_requires_team_review'},
        {'course_id': 'DEMO_C02', 'title': '疲劳与分心识别', 'dimension': 'fatigue_distraction', 'content': '演示课程：回顾相关证据，记录诱因，列出行前状态检查与途中异常处理计划；具体要求以车队正式制度为准。', 'completion_requirement': '填写学习记录与个人计划；安全员复核', 'content_status': 'demo_draft_requires_team_review'},
        {'course_id': 'DEMO_C03', 'title': '数据与设备核验清单', 'dimension': 'management', 'content': '演示清单：核对设备在线、数据覆盖和摄像头状态；记录检查结果并交安全员确认。数据不足不作为违规结论。', 'completion_requirement': '提交设备核验结果；安全员复核', 'content_status': 'demo_draft_requires_team_review'},
    ])
    courses['reviewed_by'] = ''
    courses['reviewed_at'] = ''
    emit('training_courses', courses, 'course_id')
    emit('operation_config', pd.DataFrame([
        {'config_id': 'drop_threshold', 'value': '10', 'unit': 'score_points', 'config_version': 'ops_v1', 'updated_by': '', 'updated_at': ''},
        {'config_id': 'priority_review_hours', 'value': '24', 'unit': 'hours', 'config_version': 'ops_v1', 'updated_by': '', 'updated_at': ''},
        {'config_id': 'training_start_days', 'value': '7', 'unit': 'days', 'config_version': 'ops_v1', 'updated_by': '', 'updated_at': ''},
    ]), 'config_id')
    # Empty templates: real account IDs and workflow records are created inside the platform.
    templates = {
        'user_bindings': ['binding_id', 'platform_user_id', 'role', 'driver_id', 'fleet_id', 'account_status'],
        'alerts': ['alert_id', 'gpsno', 'driver_id', 'rule_code', 'evidence_id', 'occurred_at', 'status', 'is_replay', 'replay_session_id', 'idempotency_key', 'rule_version', 'created_by', 'updated_at', 'resolution_note', 'resolved_by', 'resolved_at'],
        'interventions': ['intervention_id', 'alert_id', 'driver_id', 'status', 'draft_text', 'sent_text', 'sent_at', 'read_at', 'reply_text', 'replied_at', 'created_by', 'closed_by', 'closed_at', 'idempotency_key', 'updated_at', 'closure_note'],
        'training_tasks': ['task_id', 'driver_id', 'alert_id', 'course_id', 'goal', 'mandatory', 'due_at', 'status', 'started_at', 'submitted_at', 'learning_record', 'feedback', 'reviewer_id', 'review_note', 'reviewed_at', 'created_by', 'idempotency_key', 'updated_at'],
        'audit_logs': ['audit_id', 'actor_id', 'action', 'entity_type', 'entity_id', 'old_status', 'new_status', 'occurred_at', 'request_id'],
    }
    for name, fields in templates.items():
        emit(name, pd.DataFrame(columns=fields), fields[0])
    (OUT / 'demo_cases.json').write_text(json.dumps({'source_version': version, 'as_of_date': date, 'cases': selections, 'replay_date': replay_day, 'replay_vehicles': replay_ids, 'replay_scope': 'selected_vehicles_only', 'prediction_for_replay': 'unavailable_before_snapshot_date'}, ensure_ascii=False, indent=2), encoding='utf-8')
    dictionary = {}
    for name, info in manifest.items():
        df = pd.read_csv(tables / f'{name}.csv', dtype=str, keep_default_na=False)
        fields = []
        text_keys = {'gpsno', 'event_type', 'course_id', 'platform_user_id', 'rule_code', 'request_id'}
        for col in df.columns:
            if col.endswith('_id') or col.endswith('_by') or col in text_keys:
                kind = 'text'
            elif col.endswith('_at') or col in {'event_time', 'occurred_at'}:
                kind = 'datetime'
            elif col.endswith('_date') or col in {'window_start', 'mapping_start', 'mapping_end'}:
                kind = 'date'
            elif col in {'is_replay', 'mandatory', 'editable'}:
                kind = 'boolean'
            elif col.endswith(('_score', '_points', '_contribution', '_count', '_prob', '_rank', '_days', '_percentile', '_deduction', '_reserve', '_floor', '_severity')) or col in {'rank', 'weight', 'confidence_score', 'score_change_7d', 'speed_kmh'}:
                kind = 'number'
            else:
                kind = 'text'
            fields.append({'field': col, 'suggested_type': kind, 'primary_key': col == info['primary_key'], 'null_semantics': 'blank is unavailable, not zero'})
        dictionary[name] = fields
    (OUT / 'data_dictionary.json').write_text(json.dumps(dictionary, ensure_ascii=False, indent=2), encoding='utf-8')
    report = {'source_version': version, 'as_of_date': date, 'source_hashes': hashes, 'tables': manifest, 'checks': {'vehicle_keys': 'passed', 'probability_consistency': 'passed', 'score_reconciliation': 'passed', 'ledger_reconciliation': 'passed', 'history_reconciliation': 'passed', 'primary_keys': 'passed'}, 'limitations': ['司机映射及车队归属为演示数据；无真实个人身份', '平台导入、权限、AI读表及在线写入尚未验证', '历史回放仅含指定车辆；不得解释成车队全量监控', '40天概率仅为最终截止日快照；禁止用于更早回放日期的当时预测', 'score_history仅含源文件已有日期，不补造整段周历史', '课程为演示草稿，正式下发前需车队审核']}
    (OUT / 'manifest.json').write_text(json.dumps(report, ensure_ascii=False, indent=2), encoding='utf-8')
    print(json.dumps({'output': str(OUT), 'tables': {n: x['rows'] for n, x in manifest.items()}, 'cases': selections, 'replay_date': replay_day, 'checks': report['checks']}, ensure_ascii=False, indent=2))


if __name__ == '__main__':
    main()
