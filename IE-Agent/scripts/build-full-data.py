"""Build persistent platform data from supplied files; keep published scores unchanged."""
from pathlib import Path
import sys, json, sqlite3, csv, hashlib, math, datetime, os
import pandas as pd

ROOT = Path(__file__).resolve().parents[1]
WORKSPACE = ROOT.parent
VAR = ROOT / 'var'
VAR.mkdir(exist_ok=True)
DB = VAR / 'platform.sqlite'
HISTORY = WORKSPACE / 'driving-safety-agent/var/history.sqlite'
VERSION = 'submission_v2_local_20261028'
sys.path.insert(0, str(ROOT / 'scripts'))
from scoring_source.scoring import enhanced, evidence_score
from scoring_source.scoring.event_taxonomy import DIMENSION_LABELS, EVENT_TAXONOMY
enhanced.ROOT = WORKSPACE / 'IE-competition-main/IE-competition-main'

def clean(v):
    if hasattr(v, 'item'): v = v.item()
    if isinstance(v, (datetime.datetime, datetime.date, pd.Timestamp)): return str(v)[:10]
    if isinstance(v, float) and not math.isfinite(v): return None
    return v
def q(s): return '"' + s.replace('"', '""') + '"'
def load_csv(path):
    with open(path, encoding='utf-8-sig', newline='') as f: return list(csv.DictReader(f))

con = sqlite3.connect(DB)
con.execute('PRAGMA journal_mode=WAL')
con.execute('PRAGMA foreign_keys=ON')
if con.execute("SELECT 1 FROM sqlite_master WHERE name='scoring_versions'").fetchone():
    raise RuntimeError('评分版本服务已初始化：不能覆盖重建当前评分库，请使用独立数据库建立新数据基线')
dictionary = json.loads((ROOT/'scripts/contract/data_dictionary.json').read_text(encoding='utf-8'))
apps = json.loads((ROOT/'scripts/contract/app_tables.json').read_text(encoding='utf-8'))['tables']
resources = json.loads((ROOT/'scripts/local-resource-schema.json').read_text(encoding='utf-8'))
schema = {k: {x['field']: 'NUMERIC' if x.get('suggested_type') in ('number','numeric','integer','boolean') else 'TEXT' for x in v} for k,v in dictionary.items()}
for name, spec in apps.items(): schema.setdefault(name, {}).update({k: 'NUMERIC' if 'number' in v or 'boolean' in v else 'TEXT' for k,v in spec['fields'].items()})
for spec in resources.values():
    cols = schema.setdefault(spec['table'], {})
    for key in spec['cols'].split(','): cols.setdefault(key, 'TEXT')
schema.setdefault('app_users', {}).update({k:'TEXT' for k in ['password_hash','created_by','created_at','updated_at','avatar_url']})
schema['app_users'].update({k:'INTEGER' for k in ['binding_verified','must_change_password']})
schema['app_sessions'] = {k:'TEXT' for k in ['session_id','user_id','created_at','expires_at']}
schema['vehicle_labels'] = {'gpsno':'TEXT','display_no':'INTEGER'}
schema['data_metadata'] = {'key':'TEXT','value':'TEXT'}
for table in ['knowledge_articles','evaluation_rule_drafts','notification_templates','driver_profiles']:
    schema.setdefault(table, {})
schema['knowledge_articles'].update({k:'TEXT' for k in ['content','applicable_role','source_note','version','created_at','review_note']})
schema['knowledge_articles']['version_no']='INTEGER'
schema['evaluation_rule_drafts'].update({k:'TEXT' for k in ['proposal','base_version','review_note','effectuated_at','approved_by','approved_at','effectuated_by','new_source_version','updated_by','created_at']})
schema['notification_templates'].update({k:'TEXT' for k in ['template_id','scene','title','body','review_status','applicable_role','created_by','updated_at','reviewed_by','reviewed_at','content']})
schema['notification_templates']['version_no']='INTEGER'
schema['driver_profiles'].update({k:'TEXT' for k in ['user_id','phone','intro','prefs','updated_by','updated_at']})
schema['operation_config'].update({k:'TEXT' for k in ['effective_at']})
schema['user_bindings'].update({k:'TEXT' for k in ['user_id','identity_status','effective_start','effective_end','note','updated_at','created_by']})
schema['audit_logs'].update({k:'TEXT' for k in ['actor_role','detail_json','evidence_refs']})
schema['alerts'].update({k:'TEXT' for k in ['owner_user_id','due_at','close_reason','created_at']})
schema['training_courses'].update({k:'TEXT' for k in ['source_version','updated_at','reviewed_by','reviewed_at','review_note']})
schema['training_courses']['version_no']='INTEGER'
PK = {'drivers':'driver_id','risk_snapshots':'snapshot_id','score_snapshots':'score_id','score_history':'score_id','review_queue':'queue_id','deduction_ledger':'ledger_id','app_users':'user_id','app_sessions':'session_id','vehicle_labels':'gpsno','data_metadata':'key','user_bindings':'binding_id','driver_profiles':'user_id','alerts':'alert_id','interventions':'intervention_id','training_tasks':'task_id','audit_logs':'audit_id','notification_events':'notification_id','review_requests':'request_id','training_courses':'course_id','evaluation_rules':'dimension','operation_config':'config_id','import_runs':'run_id','evaluation_rule_drafts':'draft_id'}
for table, cols in schema.items():
    if table == 'replay_events' or table.startswith('local_'): continue # Read-only source views.
    if table in PK: cols.setdefault(PK[table], 'TEXT')
    parts=[q(k)+' '+v+(' PRIMARY KEY' if PK.get(table)==k else '') for k,v in cols.items()]
    con.execute(f'CREATE TABLE IF NOT EXISTS {q(table)} ({",".join(parts)})')
    existing={x[1] for x in con.execute(f'PRAGMA table_info({q(table)})')}
    for k,t in cols.items():
        if k not in existing: con.execute(f'ALTER TABLE {q(table)} ADD COLUMN {q(k)} {t}')

def insert(table, rows, replace=True):
    if not rows: return
    existing={x[1] for x in con.execute(f'PRAGMA table_info({q(table)})')}
    for key in set().union(*(r.keys() for r in rows)) - existing:
        con.execute(f'ALTER TABLE {q(table)} ADD COLUMN {q(key)} TEXT')
    cols=sorted(set().union(*(r.keys() for r in rows)))
    sql=f'INSERT {"OR REPLACE" if replace else "OR IGNORE"} INTO {q(table)} ({",".join(map(q,cols))}) VALUES ({",".join("?" for _ in cols)})'
    def val(x):
        x=clean(x)
        return json.dumps(x, ensure_ascii=False) if isinstance(x,(dict,list)) else x
    con.executemany(sql, [[val(r.get(k)) for k in cols] for r in rows])

scores = load_csv(WORKSPACE/'最终提交/safety_scores.csv')
forecasts=load_csv(WORKSPACE/'最终提交/forecast_result.csv')
gpss=sorted({r['gpsno'] for r in scores})
assert len(gpss)==len(scores)==len(forecasts)==500
driver=lambda g:'D-'+g
insert('drivers', [dict(driver_id=driver(g),gpsno=g,display_name=f'司机{i}',fleet_id='fleet-local',identity_status='演示映射，非真实身份核验',mapping_start='2026-06-01',mapping_end=None) for i,g in enumerate(gpss,1)])
existing_labels={x[0] for x in con.execute('SELECT gpsno FROM vehicle_labels')}
seq=con.execute('SELECT coalesce(max(display_no),0) FROM vehicle_labels').fetchone()[0]
insert('vehicle_labels', [dict(gpsno=g,display_no=seq+i) for i,g in enumerate([g for g in gpss if g not in existing_labels],1)], False)
ranked=sorted(forecasts,key=lambda r:(-float(r['risk_prob']),r['gpsno']))
insert('risk_snapshots',[dict(**r,snapshot_id=f'risk:{r["gpsno"]}:2026-07-31',risk_rank=i,driver_id=driver(r['gpsno']),as_of_date='2026-07-31',horizon_days=40,source_version=VERSION) for i,r in enumerate(ranked,1)])
insert('score_snapshots',[dict(**r,driver_id=driver(r['gpsno']),score_id=r['gpsno']+'_2026-07-31',source_version=VERSION) for r in scores])
insert('review_queue',[dict(**r,driver_id=driver(r['gpsno']),queue_id='queue:'+r['gpsno'],source_version=VERSION) for r in scores])

cache=VAR/'derived-scoring.json'
inputs=[WORKSPACE/'最终提交/safety_scores.csv', ROOT/'scripts/scoring_source/scoring_frozen.json']
fingerprint=hashlib.sha256(b''.join(p.read_bytes() for p in inputs)).hexdigest()
cached=json.loads(cache.read_text(encoding='utf-8')) if cache.exists() else None
if not cached or cached.get('fingerprint')!=fingerprint:
    frozen=json.loads(inputs[1].read_text(encoding='utf-8'))
    source=enhanced.ScoreSource()
    history=[]; final=None
    for d in pd.date_range('2026-07-24','2026-07-31'):
        date=str(d.date()); print('Computing frozen scoring history:',date,flush=True)
        frame=evidence_score.score_at(source,date,frozen)
        if date=='2026-07-31': final=frame
        history+= [{k:clean(v) for k,v in r.items()} for r in frame.to_dict('records')]
    published={r['gpsno']:r for r in scores}
    max_diff=max(abs(float(r['safety_score'])-float(published[r['gpsno']]['safety_score'])) for r in final.to_dict('records'))
    if max_diff>1e-5: raise RuntimeError(f'Frozen algorithm does not reproduce published scores: {max_diff}; stop without replacing scores')
    ledger=evidence_score.event_ledger(final,'2026-07-31',source)
    ledger=[{k:clean(v) for k,v in r.items()} for r in ledger.to_dict('records')]
    cached=dict(fingerprint=fingerprint,history=history,ledger=ledger,max_score_difference=max_diff)
    cache.write_text(json.dumps(cached,ensure_ascii=False,allow_nan=False),encoding='utf-8')
for r in cached['history']:
    r.update(driver_id=driver(r['gpsno']),score_id=r['gpsno']+'_'+r['as_of_date'],source_version=VERSION)
insert('score_history',cached['history'])
for r in cached['ledger']:
    r.update(ledger_id=f'ledger:{r["gpsno"]}:{r["dimension"]}:{r["event_type"]}:2026-07-31',as_of_date='2026-07-31',source_version=VERSION)
insert('deduction_ledger',cached['ledger'])
frozen=json.loads((ROOT/'scripts/scoring_source/scoring_frozen.json').read_text(encoding='utf-8'))
insert('evaluation_rules',[dict(dimension=d,dimension_name=DIMENSION_LABELS[d],weight=w,window_days=14,score_method='fixed_exposure_event_increment_v2',editable=False,source_version=VERSION) for d,w in frozen['weights'].items()],False)
now=datetime.datetime.now(datetime.timezone.utc).isoformat()
insert('operation_config',[dict(config_id='training_mandate_policy',value=json.dumps({'A':'optional','B':'optional','C':'optional','D':'mandatory'}),unit='json',config_version=1,updated_at=now),dict(config_id='training_start_days',value='7',unit='day',config_version=1,updated_at=now)],False)

backup=VAR/'legacy-preview-backup.json'
if backup.exists() and not con.execute("SELECT 1 FROM data_metadata WHERE key='legacy_accounts_migrated'").fetchone():
    legacy=json.loads(backup.read_text(encoding='utf-8-sig'))
    mapping={'driver-one':driver(gpss[0]),'driver-two':driver(gpss[1])}
    for table, rows in legacy.items():
        while len(rows)==1 and isinstance(rows[0],list): rows=rows[0]
        rows=[x for x in rows if isinstance(x,dict)]
        for row in rows:
            if row.get('driver_id') in mapping:
                row['driver_id']=mapping[row['driver_id']]
                if table=='app_users': row['binding_note']='本地演示映射，非真实身份核验'
            if row.get('fleet_scope') in ('fleet-one','fleet-two'): row['fleet_scope']='fleet-local'
        insert(table,rows,False)
    insert('data_metadata',[{'key':'legacy_accounts_migrated','value':now}])
if not con.execute('SELECT 1 FROM app_users LIMIT 1').fetchone():
    raise RuntimeError('No account backup; initialize accounts explicitly before starting the platform')

seed=json.loads((WORKSPACE/'driving-safety-agent/data/training-seed.json').read_text(encoding='utf-8'))
courses=[]
for c in seed['courses']:
    content='\n'.join(['学习要点']+[p['text'] for p in c.get('knowledge_points',[])]+['学习步骤']+c.get('learning_steps',[]))
    courses.append(dict(course_id=c['course_id'],title=c['title'],dimension=c['dimension'],content=content,completion_requirement='阅读课程，记录本人复盘与行动计划；内容须经安全员审核后方可正式分配',content_status='demo_draft_requires_team_review',version_no=1,source_version='team_course_seed_1.0_draft',updated_at=now))
insert('training_courses',courses,False)

for table in ['drivers','score_snapshots','score_history','review_queue','risk_snapshots','deduction_ledger']:
    cols={x[1] for x in con.execute(f'PRAGMA table_info({q(table)})')}
    for col in ['gpsno','driver_id','as_of_date','fleet_id']:
        if col in cols: con.execute(f'CREATE INDEX IF NOT EXISTS {q("idx_"+table+"_"+col)} ON {q(table)}({q(col)})')
for table, cols in [('app_users','username'),('app_sessions','user_id'),('vehicle_labels','display_no')]:
    con.execute(f'CREATE {"UNIQUE " if cols!="user_id" else ""}INDEX IF NOT EXISTS {q("uq_"+table+"_"+cols)} ON {q(table)}({q(cols)})')
history_db=sqlite3.connect(f'file:{HISTORY.as_posix()}?mode=ro',uri=True)
counts={t:con.execute(f'SELECT count(*) FROM {q(t)}').fetchone()[0] for t in ['drivers','score_snapshots','risk_snapshots','score_history','review_queue','deduction_ledger']}
counts.update({t:history_db.execute(f'SELECT count(*) FROM {q(t)}').fetchone()[0] for t in ['events','profiles','event_daily','trajectory_daily','imu_daily']})
levels=dict(con.execute('SELECT risk_level,count(*) FROM score_snapshots GROUP BY risk_level').fetchall())
ledger_error=con.execute('''SELECT max(abs(s.observed_behavior_deduction-l.points)) FROM score_snapshots s JOIN (SELECT gpsno,sum(allocated_points) points FROM deduction_ledger GROUP BY gpsno) l USING(gpsno)''').fetchone()[0]
manifest=dict(version=VERSION,as_of_date='2026-07-31',event_start='2026-06-01',event_end='2026-07-31',history_start='2026-07-24',history_end='2026-07-31',counts=counts,level_counts=levels,published_score_max_difference=cached['max_score_difference'],ledger_max_difference=ledger_error,history_database=str(HISTORY.resolve()),raw_points_imported=False,notes=['事件全量索引；轨迹和IMU为全量源文件的日汇总，未复制原始逐点文件','历史评分使用随提交冻结的同一算法离线生成；7月31日已与正式CSV对账','司机姓名与账号为演示映射，不代表真实司机身份'])
insert('data_metadata',[{'key':'manifest','value':json.dumps(manifest,ensure_ascii=False)}])
con.commit(); con.close()
(VAR/'data-manifest.json').write_text(json.dumps(manifest,ensure_ascii=False,indent=2),encoding='utf-8')
print(json.dumps(dict(counts=counts,levels=levels,score_max_difference=cached['max_score_difference'],ledger_max_difference=ledger_error),ensure_ascii=True),flush=True)
