// Fill missing observation dates from raw source using the active scoring model.
// Run with the service stopped; existing snapshots and archived reports are preserved.
import {DatabaseSync,backup} from 'node:sqlite';
import {readFileSync} from 'node:fs';
import {spawnSync} from 'node:child_process';
import {fileURLToPath} from 'node:url';
import {createScoringEngine} from '../server/scoring-engine.mjs';
const root=new URL('../',import.meta.url),db=new DatabaseSync(fileURLToPath(new URL('var/platform.sqlite',root)));
const frozen=JSON.parse(readFileSync(new URL('scripts/scoring_source/scoring_frozen.json',root),'utf8'));
try{
 const engine=createScoringEngine(db,frozen),state=engine.state(),active=state.active_version;
 const configRow=db.prepare('SELECT * FROM scoring_model_configs WHERE version_id=?').get(active);
 const source=configRow?JSON.parse(configRow.data):Object.fromEntries(['score_snapshots','score_history','review_queue','deduction_ledger','evaluation_rules'].map(t=>[t,db.prepare('SELECT row_json FROM scoring_version_rows WHERE version_id=? AND table_name=? ORDER BY row_no').all('original',t).map(r=>JSON.parse(r.row_json))]));
 const latest=source.score_snapshots[0].as_of_date,dates=Array.from({length:14},(_,i)=>new Date(Date.parse(latest+'T00:00:00Z')-(13-i)*86400000).toISOString().slice(0,10));
 const existing=new Set(source.score_history.map(r=>r.as_of_date));if(dates.every(d=>existing.has(d))){console.log('All 14 dates already present.');process.exit(0)}
 const actorId=db.prepare("SELECT user_id FROM app_users WHERE role='safety_admin' AND account_status='active' AND fleet_scope='*' LIMIT 1").get()?.user_id;if(!actorId)throw Error('Global administrator required');
 const config=state.model_config,python=process.env.MODEL_PYTHON||'python';
 const result=spawnSync(python,['-X','utf8',fileURLToPath(new URL('scripts/recompute-model.py',root))],{input:JSON.stringify({config,dates}),encoding:'utf8',windowsHide:true,timeout:240000,maxBuffer:80*1024*1024});if(result.status!==0)throw Error('Recompute failed: '+result.stderr);
 const out=JSON.parse(result.stdout),lookup=new Map(source.score_history.map(r=>[r.gpsno+':'+r.as_of_date,r])),templates=new Map(source.score_snapshots.map(r=>[r.gpsno,r]));
 for(const date of dates){const group=out.history.filter(r=>r.as_of_date===date);if(group.length!==500||new Set(group.map(r=>String(r.gpsno))).size!==500)throw Error('Incomplete date '+date)}
 for(const r of out.history){const old=lookup.get(String(r.gpsno)+':'+r.as_of_date);if(old&&Math.abs(old.safety_score-r.safety_score)>1e-5)throw Error('Existing source score mismatch');}
 const extra=out.history.filter(r=>!existing.has(r.as_of_date)).map(r=>({...templates.get(String(r.gpsno)),...r,gpsno:String(r.gpsno),score_id:'score:'+r.gpsno+':'+r.as_of_date,history_id:'history:'+r.gpsno+':'+r.as_of_date}));
 await backup(db,fileURLToPath(new URL('var/before-history-'+Date.now()+'.sqlite',root)));
 const priorScores=db.prepare('SELECT gpsno,safety_score FROM score_snapshots').all();
 db.prepare('INSERT INTO scoring_model_configs VALUES(?,?,?) ON CONFLICT(version_id) DO UPDATE SET data=excluded.data').run(active,JSON.stringify(config),JSON.stringify({...source,score_history:[...source.score_history,...extra]}));
 try{const next=createScoringEngine(db,frozen),body={actor:{id:actorId,role:'safety_admin',scope:'*'},base_version:active,weights:state.weights,request_key:'complete-history-'+Date.now(),label:'补全14天评分历史',reason:'以当前模型从原始数据重算，逐车校验已有评分一致；仅增加缺失观察日'};const plan=next.preview(body);const applied=next.apply({...body,preview_id:plan.preview_id});
 for(const r of priorScores)if(Math.abs(db.prepare('SELECT safety_score FROM score_snapshots WHERE gpsno=?').get(r.gpsno).safety_score-r.safety_score)>1e-5)throw Error('Current score changed');
 console.log(JSON.stringify({version:applied.version,added:extra.length,dates:db.prepare('SELECT as_of_date,count(*) n FROM score_history GROUP BY as_of_date ORDER BY as_of_date').all()}));
 }finally{if(configRow)db.prepare('UPDATE scoring_model_configs SET data=? WHERE version_id=?').run(configRow.data,active);else db.prepare('DELETE FROM scoring_model_configs WHERE version_id=?').run(active)}
}finally{db.close()}
