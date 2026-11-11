"""One-time migration of this user's existing local preview state; no score writes."""
from pathlib import Path
import sqlite3,json,datetime
ROOT=Path(__file__).resolve().parents[1]
db=sqlite3.connect(ROOT/'var/platform.sqlite')
stamp=datetime.datetime.now().strftime('%Y%m%d-%H%M%S')
archive=sqlite3.connect(ROOT/f'var/before-switch-{stamp}.sqlite')
db.backup(archive);archive.close()
state=json.loads((ROOT/'var/legacy-preview-backup.json').read_text(encoding='utf-8-sig'))
vehicles=[x[0] for x in db.execute('SELECT gpsno FROM drivers ORDER BY gpsno')]
mapping={'driver-one':'D-'+vehicles[0],'driver-two':'D-'+vehicles[1]}
allowed={'app_users','app_sessions','audit_logs','driver_profiles','user_bindings','alerts','interventions','training_tasks','notification_events','review_requests','knowledge_articles','evaluation_rule_drafts','operation_config','training_courses','notification_templates'}
quote=lambda x:'"'+x.replace('"','""')+'"'
for table,rows in state.items():
    if table not in allowed: continue
    while len(rows)==1 and isinstance(rows[0],list): rows=rows[0]
    rows=[r for r in rows if isinstance(r,dict)]
    if table=='app_sessions': db.execute('DELETE FROM app_sessions')
    for row in rows:
        if row.get('driver_id') in mapping:
            row['driver_id']=mapping[row['driver_id']]
            if table=='app_users': row['binding_note']='本地演示映射，非真实身份核验'
        if row.get('fleet_scope') in ['fleet-one','fleet-two']:row['fleet_scope']='fleet-local'
        cols={r[1] for r in db.execute(f'PRAGMA table_info({quote(table)})')}
        for k in row:
            if k not in cols:db.execute(f'ALTER TABLE {quote(table)} ADD COLUMN {quote(k)} TEXT')
        keys=list(row)
        values=[json.dumps(v,ensure_ascii=False) if isinstance(v,(dict,list)) else v for v in row.values()]
        db.execute(f'INSERT OR REPLACE INTO {quote(table)} ({",".join(map(quote,keys))}) VALUES ({",".join("?" for _ in keys)})',values)
db.commit()
print('Preserved accounts:',db.execute('SELECT count(*) FROM app_users').fetchone()[0])
db.close()
