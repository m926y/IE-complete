import {homedir} from 'node:os';
import {join} from 'node:path';
import {existsSync} from 'node:fs';
import {spawn,spawnSync} from 'node:child_process';
import {fileURLToPath} from 'node:url';
import {SCORING_FACTORS} from './scoring-factors.mjs';
import { createHash, randomUUID } from 'node:crypto';

export const DIMENSIONS=['history','fatigue_distraction','driving_stability','road_rule','management','imu_evidence'];
const NAMES=['历史事故与未遂','疲劳与分心','驾驶稳定性','道路规则','管理配合度','IMU 风险佐证'];
const TABLES=['score_snapshots','score_history','deduction_ledger','review_queue','evaluation_rules'];
const quote=s=>'"'+s.replaceAll('"','""')+'"';
const error=(status,code)=>{throw Object.assign(new Error(code),{status,code});};
const modelPython=()=>process.env.MODEL_PYTHON||[new URL('../.venv/Scripts/python.exe',import.meta.url),new URL('../.venv/bin/python',import.meta.url)].filter(existsSync).map(u=>fileURLToPath(u))[0]||(existsSync(join(homedir(),'.cache/codex-runtimes/codex-primary-runtime/dependencies/python/python.exe'))?join(homedir(),'.cache/codex-runtimes/codex-primary-runtime/dependencies/python/python.exe'):(process.platform==='win32'?'python':'python3'));
export function validateWeights(raw){
  if(!raw||typeof raw!=='object'||Array.isArray(raw)||Object.keys(raw).length!==6)error(400,'weights_invalid');
  const w={};let sum=0;
  for(const d of DIMENSIONS){const v=raw[d];if(typeof v!=='number'||!Number.isFinite(v)||v<0||v>1)error(400,'weights_invalid');w[d]=v;sum+=v;}
  if(Math.abs(sum-1)>1e-6)error(400,'weights_sum_invalid');
  for(const d of DIMENSIONS)w[d]/=sum;
  return w;
}

export const DEFAULT_LEVEL_RATIOS={A:20,B:40,C:30,D:10};
export function validateLevelRatios(raw=DEFAULT_LEVEL_RATIOS){
 if(!raw||typeof raw!=='object'||Array.isArray(raw)||Object.keys(raw).sort().join()!=='A,B,C,D'||!Object.values(raw).every(v=>Number.isInteger(v)&&v>=0&&v<=100)||Object.values(raw).reduce((a,b)=>a+b,0)!==100)error(400,'level_ratios_invalid');
 return {...raw};
}
export function createScoringEngine(db,frozen){
  db.exec(`CREATE TABLE IF NOT EXISTS scoring_versions(version_id TEXT PRIMARY KEY,ordinal INTEGER UNIQUE,weights TEXT NOT NULL,created_at TEXT,actor_id TEXT,base_version TEXT,request_key TEXT,summary TEXT);
    CREATE UNIQUE INDEX IF NOT EXISTS uq_scoring_request ON scoring_versions(actor_id,request_key);
    CREATE TABLE IF NOT EXISTS scoring_version_rows(version_id TEXT,table_name TEXT,row_no INTEGER,row_json TEXT NOT NULL,PRIMARY KEY(version_id,table_name,row_no));`);
  db.exec(`CREATE TABLE IF NOT EXISTS scoring_designs(id TEXT PRIMARY KEY,version_id TEXT,label TEXT,reason TEXT,weights TEXT,actor_id TEXT,created_at TEXT,base_version TEXT,restored_from TEXT,status TEXT);`);
  const metaGet=key=>db.prepare('SELECT value FROM data_metadata WHERE key=?').get(key)?.value;
  const metaSet=(key,value)=>db.prepare('INSERT INTO data_metadata(key,value) VALUES(?,?) ON CONFLICT(key) DO UPDATE SET value=excluded.value').run(key,value);
  const record=id=>{const r=db.prepare('SELECT * FROM scoring_versions WHERE version_id=?').get(id);return r?{...r,weights:JSON.parse(r.weights),summary:JSON.parse(r.summary||'{}')}:null;};
  const current=()=>record(metaGet('active_score_version'));
  const archived=(id,table)=>db.prepare('SELECT row_json FROM scoring_version_rows WHERE version_id=? AND table_name=? ORDER BY row_no').all(id,table).map(x=>JSON.parse(x.row_json));
  const store=(id,table,rows)=>{const stmt=db.prepare('INSERT INTO scoring_version_rows VALUES(?,?,?,?)');rows.forEach((r,i)=>stmt.run(id,table,i,JSON.stringify(r)));};
  if(!metaGet('active_score_version')){
    const rows=db.prepare('SELECT * FROM score_snapshots').all();if(rows.length!==500)error(503,'scoring_baseline_incomplete');
    db.exec('BEGIN IMMEDIATE');
    try{
      db.prepare('INSERT INTO scoring_versions VALUES(?,?,?,?,?,?,?,?)').run('original',0,JSON.stringify(validateWeights(frozen.weights)),new Date().toISOString(),'system',null,null,JSON.stringify({count:rows.length,changed:0}));
      for(const t of TABLES)store('original',t,db.prepare(`SELECT * FROM ${quote(t)}`).all());
      metaSet('active_score_version','original');db.exec('COMMIT');
    }catch(e){db.exec('ROLLBACK');throw e;}
  }
  db.exec('CREATE TABLE IF NOT EXISTS scoring_rule_drafts(id TEXT PRIMARY KEY,payload TEXT,status TEXT,actor_id TEXT,created_at TEXT,review_note TEXT,version_id TEXT)');
  db.exec('CREATE TABLE IF NOT EXISTS scoring_model_configs(version_id TEXT PRIMARY KEY,config TEXT,data TEXT)');
  const initialBase={};for(const t of TABLES)initialBase[t]=archived('original',t);
  const defaultConfig={level_ratios:DEFAULT_LEVEL_RATIOS,window_days:14,half_life_days:14,factors:SCORING_FACTORS.flatMap(d=>d.events.map(e=>({...e,dimension:d.key}))),reference:Object.fromEntries(Object.entries(frozen.reference).filter(([d])=>d!=='imu_evidence').map(([d,r])=>[d,{tau:r.tau,mu:r.mu,rate_scale:1}]))};
  const modelAt=id=>{const r=db.prepare('SELECT * FROM scoring_model_configs WHERE version_id=?').get(id);return r?{config:JSON.parse(r.config),data:JSON.parse(r.data)}:{config:defaultConfig,data:initialBase}};
  let model=modelAt(current().version_id),base=model.data;let baseHistory;
  const prepared=new Map();
  function prepare(raw,supplied){if(raw===undefined)return model;const c=structuredClone(raw);c.level_ratios=validateLevelRatios(c.level_ratios);const codes=defaultConfig.factors.map(f=>f.code);if(c.exposure_units){if(Object.keys(c.exposure_units).sort().join()!==DIMENSIONS.slice(0,5).sort().join()||!Object.values(c.exposure_units).every(u=>["per_1000km","per_100h","per_active_day"].includes(u)))error(400,"model_exposure_invalid");}if(!Number.isInteger(c.window_days)||c.window_days<1||c.window_days>30||!Number.isFinite(c.half_life_days)||c.half_life_days<1||c.half_life_days>60||!Array.isArray(c.factors)||!c.factors.length||c.factors.length>codes.length||new Set(c.factors.map(f=>f.code)).size!==c.factors.length)error(400,'model_config_invalid');for(const f of c.factors)if(!codes.includes(f.code)||!DIMENSIONS.slice(0,5).includes(f.dimension)||typeof f.name!=='string'||!f.name.trim()||f.name.length>80||!Number.isFinite(f.severity)||f.severity<=0||f.severity>100)error(400,'model_factor_invalid');if(!c.reference||Object.keys(c.reference).sort().join()!==Object.keys(defaultConfig.reference).sort().join())error(400,'model_reference_invalid');for(const r of Object.values(c.reference))if(!r||!['tau','mu','rate_scale'].every(k=>typeof r[k]==='number'&&Number.isFinite(r[k])&&r[k]>0&&r[k]<=100000))error(400,'model_reference_invalid');const key=JSON.stringify(c);if(key===JSON.stringify(model.config))return model;if(prepared.has(key))return prepared.get(key);const withoutRatios=v=>JSON.stringify({...v,level_ratios:undefined});if(withoutRatios(c)===withoutRatios(model.config))return {config:c,data:base};
   if(supplied==='probe')return {needs:true,config:c};
   const python=modelPython();const r=supplied||spawnSync(python,['-X','utf8',fileURLToPath(new URL('../scripts/recompute-model.py',import.meta.url))],{input:JSON.stringify({config:c,dates:[...new Set(base.score_history.map(r=>r.as_of_date))].sort()}),encoding:'utf8',windowsHide:true,timeout:240000,maxBuffer:40*1024*1024});if(r.status!==0){console.error('Model recompute failed:',String(r.stderr||r.error?.message||'').slice(-2000));error(503,'model_recompute_failed');}let out;try{out=JSON.parse(r.stdout)}catch{error(503,'model_output_invalid')};if(out.history?.length!==base.score_history.length)error(503,'model_output_invalid');
   const merge=r=>({...base.score_history.find(x=>x.gpsno===String(r.gpsno)&&x.as_of_date===r.as_of_date),...r,gpsno:String(r.gpsno)});const history=out.history.map(merge);const latest=history.filter(r=>r.as_of_date===initialBase.score_snapshots[0].as_of_date).map(r=>({...initialBase.score_snapshots.find(x=>x.gpsno===r.gpsno),...r}));const ledger=out.ledger.map(r=>({...r,gpsno:String(r.gpsno),driver_id:latest.find(x=>x.gpsno===String(r.gpsno))?.driver_id,ledger_id:'ledger:'+r.gpsno+':'+r.dimension+':'+r.event_type+':'+latest[0].as_of_date,as_of_date:latest[0].as_of_date}));const result={config:c,data:{...initialBase,score_snapshots:latest,score_history:history,deduction_ledger:ledger}};prepared.clear();prepared.set(key,result);return result;
  }
  async function precompute(body){checkActor(body.actor);if(body.restore_version||body.model_config===undefined)return;const probe=prepare(body.model_config,'probe');if(!probe.needs)return;const result=await new Promise((resolve,reject)=>{const child=spawn(modelPython(),['-X','utf8',fileURLToPath(new URL('../scripts/recompute-model.py',import.meta.url))],{windowsHide:true,stdio:['pipe','pipe','pipe']});let stdout='',stderr='';const timer=setTimeout(()=>{child.kill();reject(Object.assign(new Error('model_recompute_timeout'),{status:503,code:'model_recompute_timeout'}))},240000);child.stdout.on('data',b=>{stdout+=b;if(stdout.length>40*1024*1024)child.kill()});child.stderr.on('data',b=>{stderr=(stderr+b).slice(-4000)});child.on('error',e=>{clearTimeout(timer);reject(e)});child.on('close',status=>{clearTimeout(timer);resolve({status,stdout,stderr})});child.stdin.end(JSON.stringify({config:probe.config,dates:[...new Set(base.score_history.map(r=>r.as_of_date))].sort()}));});prepare(body.model_config,result);}
  function useModel(next){next={...next,config:{...next.config,level_ratios:validateLevelRatios(next.config.level_ratios)}};model=next;base=next.data;baseHistory=new Map(base.score_history.map(r=>[r.gpsno+':'+r.as_of_date,r]));}
  useModel(model);
  const original=record('original').weights;

  for(const d of DIMENSIONS)if(!(original[d]>0))error(503,'scoring_baseline_weights_invalid');
  const currentRows=()=>db.prepare('SELECT * FROM score_snapshots').all();
  const scale=(r,d,w)=>Number(r[d+'_contribution']||0)*w[d]/original[d];
  function scoreRows(rows,w){
    return rows.map(r=>{
      const x={...r},basis=baseHistory.get(r.gpsno+':'+r.as_of_date)||r;let deduction=0,prior=0,gross=0;
      for(const d of DIMENSIONS){x[d+'_contribution']=scale(r,d,w);deduction+=x[d+'_contribution'];x[d+'_prior_background_points']=Number(basis[d+'_prior_background_points']||0)*w[d]/original[d];x[d+'_gross_points']=Number(basis[d+'_gross_points']||0)*w[d]/original[d];prior+=x[d+'_prior_background_points'];gross+=x[d+'_gross_points'];}
      x.prior_background_deduction=prior;x.gross_reference_deduction=gross;
      x.observed_behavior_deduction=deduction;x.behavior_safety_score=Math.max(0,Math.min(100,100-deduction));x.safety_score=Math.round(x.behavior_safety_score*1e6)/1e6;
      x.uncertainty_reserve=Number(r.uncertainty_reserve)>0?30*w.imu_evidence:0;
      x.confidence_adjusted_floor=Math.max(0,x.behavior_safety_score-x.uncertainty_reserve);
      const dims=[...DIMENSIONS].sort((a,b)=>x[b+'_contribution']-x[a+'_contribution']||a.localeCompare(b));
      x.primary_risk_dimension=deduction>1e-12?dims[0]:r.primary_risk_dimension;
      dims.slice(0,3).forEach((d,i)=>{
        const points=x[d+'_contribution'],k=i+1,count=Number(r[d+'_event_count']||0);
        x['top_reason_'+k]=points>1e-12?`${NAMES[DIMENSIONS.indexOf(d)]}：${count}${d==='imu_evidence'?'个异常采样点':'条事件记录'}，扣分 ${points.toFixed(4)}`:'无可归因的新增扣分；请结合数据覆盖核验';
        x['top_reason_'+k+'_dimension']=d;x['top_reason_'+k+'_penalty_points']=points;
      });
      return x;
    }).sort((a,b)=>b.behavior_safety_score-a.behavior_safety_score||a.gpsno.localeCompare(b.gpsno)).map((r,i,all)=>{
      const p=(i+1)/all.length,q=model.config.level_ratios;return {...r,rank:i+1,risk_rank_percentile:p,risk_level:p<=q.A/100?'A':p<=(q.A+q.B)/100?'B':p<=(q.A+q.B+q.C)/100?'C':'D'};
    });
  }
  const summaryFor=(rows)=>{
    const before=new Map(currentRows().map(x=>[x.gpsno,x]));
    const changes=rows.map(x=>({gpsno:x.gpsno,old_score:Number(before.get(x.gpsno).safety_score),new_score:x.safety_score,delta:x.safety_score-Number(before.get(x.gpsno).safety_score),old_level:before.get(x.gpsno).risk_level,new_level:x.risk_level}));
    return {rows,summary:{count:rows.length,changed:changes.filter(x=>Math.abs(x.delta)>1e-8).length,old_average:changes.reduce((s,x)=>s+x.old_score,0)/rows.length,new_average:rows.reduce((s,x)=>s+x.safety_score,0)/rows.length,level_changed:changes.filter(x=>x.old_level!==x.new_level).length,matrix:Object.fromEntries(['A','B','C','D'].map(a=>[a,Object.fromEntries(['A','B','C','D'].map(b=>[b,changes.filter(x=>x.old_level===a&&x.new_level===b).length]))])),entered_cd:changes.filter(x=>!['C','D'].includes(x.old_level)&&['C','D'].includes(x.new_level)).length,exited_cd:changes.filter(x=>['C','D'].includes(x.old_level)&&!['C','D'].includes(x.new_level)).length,dimensions:DIMENSIONS.map((d,i)=>({key:d,name:NAMES[i],before:currentRows().reduce((s,r)=>s+Number(r[d+'_contribution']||0),0)/rows.length,after:rows.reduce((s,r)=>s+Number(r[d+'_contribution']||0),0)/rows.length})),max_change:Math.max(...changes.map(x=>Math.abs(x.delta))),examples:changes.sort((a,b)=>Math.abs(b.delta)-Math.abs(a.delta)||a.gpsno.localeCompare(b.gpsno)).slice(0,12)}};
  };
  const currentSummary=w=>summaryFor(scoreRows(base.score_snapshots,w));
  const token=(version,w,restore='')=>createHash('sha256').update(JSON.stringify([version,DIMENSIONS.map(d=>w[d].toFixed(12)),restore])).digest('hex');
  function checkActor(actor){if(actor?.role!=='safety_admin'||String(actor.scope||'*')!=='*')error(403,'scoring_global_admin_required');}
  function state(){const active=current();return {rule_drafts:db.prepare("SELECT * FROM scoring_rule_drafts ORDER BY created_at DESC").all().map(r=>({...r,payload:JSON.parse(r.payload)})),model_config:model.config,factors:SCORING_FACTORS.map(d=>({...d,events:model.config.factors.filter(f=>f.dimension===d.key)})),designs:db.prepare('SELECT * FROM scoring_designs ORDER BY created_at DESC').all().map(r=>({...r,weights:JSON.parse(r.weights)})),... {active_version:active.version_id,ordinal:active.ordinal,weights:active.weights,baseline_weights:original,dimensions:DIMENSIONS.map((key,i)=>({key,name:NAMES[i]})),versions:db.prepare('SELECT version_id,ordinal,created_at,actor_id,weights,summary FROM scoring_versions ORDER BY ordinal DESC').all().map(r=>({...r,weights:JSON.parse(r.weights),summary:JSON.parse(r.summary),design:db.prepare('SELECT label,reason,restored_from FROM scoring_designs WHERE version_id=?').get(r.version_id)||null})),vehicle_count:500,window_days:model.config.window_days}};}
  function preview(body){const liveModel=model;try{
    checkActor(body.actor);const nextModel=body.restore_version?modelAt(body.restore_version):prepare(body.model_config);useModel(nextModel);const source=body.restore_version?record(body.restore_version):null;if(body.restore_version&&!source)error(404,'scoring_version_not_found');const w=source?source.weights:validateWeights(body.weights),active=current();
    if(body.base_version!==active.version_id)error(409,'scoring_version_conflict');
    const {summary}=source?summaryFor(archived(source.version_id,'score_snapshots')):currentSummary(w);return {base_version:active.version_id,weights:w,restore_version:source?.version_id||null,preview_id:token(active.version_id,w,(source?.version_id||'')+JSON.stringify(model.config)),model_config:model.config,summary};}finally{useModel(liveModel)}
  }
  function insertRows(table,rows){
    const existing=new Set(db.prepare(`PRAGMA table_info(${quote(table)})`).all().map(x=>x.name));
    for(const key of new Set(rows.flatMap(r=>Object.keys(r))))if(!existing.has(key)){
      const sample=rows.find(r=>r[key]!=null)?.[key];db.exec(`ALTER TABLE ${quote(table)} ADD COLUMN ${quote(key)} ${typeof sample==='number'?'NUMERIC':'TEXT'}`);existing.add(key);
    }
    db.exec(`DELETE FROM ${quote(table)}`);
    const cols=[...existing];const stmt=db.prepare(`INSERT INTO ${quote(table)} (${cols.map(quote).join(',')}) VALUES (${cols.map(()=>'?').join(',')})`);
    for(const row of rows)stmt.run(...cols.map(k=>row[k]===undefined?null:typeof row[k]==='boolean'?Number(row[k]):row[k]));
  }
  function apply(body){const liveModel=model;try{
    checkActor(body.actor);const nextModel=body.restore_version?modelAt(body.restore_version):prepare(body.model_config);useModel(nextModel);const source=body.restore_version?record(body.restore_version):null;if(body.restore_version&&!source)error(404,'scoring_version_not_found');const w=source?source.weights:validateWeights(body.weights);
    if(!/^[A-Za-z0-9_-]{8,100}$/.test(body.request_key||''))error(400,'scoring_request_key_required');
    const previous=db.prepare('SELECT version_id FROM scoring_versions WHERE actor_id=? AND request_key=?').get(body.actor.id,body.request_key);
    if(previous){const r=record(previous.version_id);if(JSON.stringify(modelAt(r.version_id).config)!==JSON.stringify(model.config)||token(r.base_version,w)!==token(r.base_version,r.weights)||(db.prepare('SELECT restored_from FROM scoring_designs WHERE version_id=?').get(r.version_id)?.restored_from||'')!==(source?.version_id||''))error(409,'scoring_request_conflict');return {ok:true,idempotent_replay:true,version:r.version_id,summary:r.summary};}
    const active=current();if(body.base_version!==active.version_id)error(409,'scoring_version_conflict');
    if(body.preview_id!==token(active.version_id,w,(source?.version_id||'')+JSON.stringify(model.config)))error(409,'scoring_preview_required');
    const id='weights-'+randomUUID(),at=new Date().toISOString();
    let {rows,summary}=currentSummary(w);let data={score_snapshots:rows};
    const groups=new Map();for(const r of base.score_history){if(!groups.has(r.as_of_date))groups.set(r.as_of_date,[]);groups.get(r.as_of_date).push(r);}
    data.score_history=[...groups.values()].flatMap(group=>scoreRows(group,w));
    const lookup=new Map(data.score_history.map(r=>[r.gpsno+':'+r.as_of_date,r]));
    for(const r of [...rows,...data.score_history]){const d=new Date(r.as_of_date+'T00:00:00Z');d.setUTCDate(d.getUTCDate()-7);const old=lookup.get(r.gpsno+':'+d.toISOString().slice(0,10));r.score_change_7d=old?r.safety_score-old.safety_score:null;}
    const forecasts=[...rows].sort((a,b)=>a.forecast_40d_risk_prob-b.forecast_40d_risk_prob),high=new Set();
    for(let i=0;i<forecasts.length;){let j=i+1;while(j<forecasts.length&&forecasts[j].forecast_40d_risk_prob===forecasts[i].forecast_40d_risk_prob)j++;if(((i+1)+j)/2/forecasts.length>.8)for(let k=i;k<j;k++)high.add(forecasts[k].gpsno);i=j;}
    for(const r of rows){const cd=['C','D'].includes(r.risk_level);r.review_queue=r.confidence_level==='low'?'data_quality_review':high.has(r.gpsno)?cd?'priority_review':'prediction_review':cd?'behavior_coaching':'routine';r.action_deadline=r.review_queue==='priority_review'?'within_24h':r.review_queue==='data_quality_review'?'before_action':r.review_queue==='routine'?'within_30d':'within_7d';r.immediate_alert=r.immediate_alert==='same_day_incident_review'?'same_day_incident_review':r.score_change_7d!==null&&r.score_change_7d<=-10?'seven_day_score_drop':'none';r.recommended_action=r.confidence_level==='low'?'先复核数据覆盖及设备，不自动奖惩':r.risk_level==='D'?'优先核查主要扣分证据，安排沟通与培训':r.risk_level==='C'?'结合主要风险安排针对性辅导':r.risk_level==='B'?'定期复盘与常规提醒':'保持安全驾驶，常规跟踪';r.review_cycle=cd?'weekly':'monthly';}
    const byGps=new Map(rows.map(r=>[r.gpsno,r]));
    data.review_queue=base.review_queue.map(r=>{const x=byGps.get(r.gpsno);return {...r,safety_score:x.safety_score,risk_level:x.risk_level,review_queue:x.review_queue,action_deadline:x.action_deadline,top_reason_1:x.top_reason_1};});
    data.deduction_ledger=base.deduction_ledger.map(r=>({...r,allocated_points:Number(r.allocated_points)*w[r.dimension]/original[r.dimension],dimension_points:Number(r.dimension_points)*w[r.dimension]/original[r.dimension]}));
    data.evaluation_rules=base.evaluation_rules.map(r=>({...r,weight:w[r.dimension],window_days:model.config.window_days,editable:1}));
    if(source){data=Object.fromEntries(TABLES.map(t=>[t,archived(source.version_id,t)]));for(const t of TABLES)if(!data[t].length)error(409,'scoring_archive_incomplete');rows=data.score_snapshots;summary=summaryFor(rows).summary;}
    for(const values of Object.values(data))for(const r of values)r.source_version=id;
    db.exec('BEGIN IMMEDIATE');
    try{
      if(current().version_id!==active.version_id)error(409,'scoring_version_conflict');
      db.prepare('INSERT INTO scoring_versions VALUES(?,?,?,?,?,?,?,?)').run(id,active.ordinal+1,JSON.stringify(w),at,body.actor.id,active.version_id,body.request_key,JSON.stringify(summary));
      db.prepare('INSERT INTO scoring_designs VALUES(?,?,?,?,?,?,?,?,?,?)').run('design-'+randomUUID(),id,String(body.label|| (source?'恢复历史权重':'权重调整')).slice(0,80),String(body.reason||'').slice(0,1000),JSON.stringify(w),body.actor.id,at,active.version_id,source?.version_id||null,'applied');
      for(const t of TABLES){insertRows(t,data[t]);store(id,t,data[t]);}
      db.prepare('INSERT INTO scoring_model_configs VALUES(?,?,?)').run(id,JSON.stringify(model.config),JSON.stringify(base));
      metaSet('active_score_version',id);
      const manifest=JSON.parse(metaGet('manifest'));manifest.active_score_version=id;manifest.window_days=model.config.window_days;if(manifest.counts)manifest.counts.deduction_ledger=data.deduction_ledger.length;manifest.baseline_verified_difference=0;manifest.published_score_max_difference=Math.max(...rows.map(r=>Math.abs(r.safety_score-base.score_snapshots.find(b=>b.gpsno===r.gpsno).safety_score)));metaSet('manifest',JSON.stringify(manifest));
      db.prepare('INSERT INTO audit_logs(audit_id,actor_id,actor_role,action,entity_type,entity_id,old_status,new_status,occurred_at,detail_json) VALUES(?,?,?,?,?,?,?,?,?,?)').run('aud-'+randomUUID(),body.actor.id,'safety_admin','scoring.weights_apply','score_version',id,active.version_id,id,at,JSON.stringify({weights:w,vehicle_count:rows.length,changed:summary.changed,restored_from:source?.version_id||null,label:String(body.label||'').slice(0,80),reason:String(body.reason||'').slice(0,1000)}));
      db.exec('COMMIT');
    }catch(e){db.exec('ROLLBACK');throw e;}
    return {ok:true,version:id,summary};}finally{useModel(modelAt(current().version_id))}
  }
  function history(id){const r=record(id);if(!r)error(404,'scoring_version_not_found');return {version:id,ordinal:r.ordinal,weights:r.weights,rows:archived(id,'score_snapshots').map(x=>({gpsno:x.gpsno,safety_score:x.safety_score,risk_level:x.risk_level,source_version:x.source_version}))};}
  function design(body){checkActor(body.actor);const w=validateWeights(body.weights);if(body.base_version!==current().version_id)error(409,'scoring_version_conflict');if(!String(body.label||'').trim()||!String(body.reason||'').trim())error(400,'scoring_design_note_required');const id='design-'+randomUUID();db.prepare('INSERT INTO scoring_designs VALUES(?,?,?,?,?,?,?,?,?,?)').run(id,null,String(body.label).slice(0,80),String(body.reason).slice(0,1000),JSON.stringify(w),body.actor.id,new Date().toISOString(),body.base_version,null,'draft');return {ok:true,id};}
  function compare(left,right){const a=record(left),b=record(right);if(!a||!b)error(404,'scoring_version_not_found');const before=new Map(archived(left,'score_snapshots').map(r=>[r.gpsno,r]));const changes=archived(right,'score_snapshots').map(r=>({gpsno:r.gpsno,old_score:before.get(r.gpsno).safety_score,new_score:r.safety_score,delta:r.safety_score-before.get(r.gpsno).safety_score,old_level:before.get(r.gpsno).risk_level,new_level:r.risk_level}));return {left,right,weights:DIMENSIONS.map((key,i)=>({key,name:NAMES[i],before:a.weights[key],after:b.weights[key],delta:b.weights[key]-a.weights[key]})),changed:changes.filter(r=>Math.abs(r.delta)>1e-8).length,level_changed:changes.filter(r=>r.old_level!==r.new_level).length,rows:changes};}

  function auditRule(actor,action,id,oldStatus,newStatus){db.prepare("INSERT INTO audit_logs(audit_id,actor_id,actor_role,action,entity_type,entity_id,old_status,new_status,occurred_at) VALUES(?,?,?,?,?,?,?,?,?)").run("aud-"+randomUUID(),actor.id,actor.role,action,"scoring_rule_draft",id,oldStatus,newStatus,new Date().toISOString());}
  function submit(body){checkActor(body.actor);const weights=validateWeights(body.weights);prepare(body.model_config,'probe');if(body.base_version!==current().version_id)error(409,'scoring_version_conflict');if(!String(body.label||'').trim()||!String(body.reason||'').trim())error(400,'scoring_design_note_required');const id='rule-'+randomUUID();const payload={weights,model_config:body.model_config||model.config,base_version:body.base_version,label:body.label,reason:body.reason};db.prepare("INSERT INTO scoring_rule_drafts VALUES(?,?,'pending_review',?,?,NULL,NULL)").run(id,JSON.stringify(payload),body.actor.id,new Date().toISOString());auditRule(body.actor,'scoring.rule_submit',id,null,'pending_review');return {ok:true,id};}
  function draft(id){const d=db.prepare('SELECT * FROM scoring_rule_drafts WHERE id=?').get(id);if(!d)error(404,'rule_draft_not_found');return {...d,payload:JSON.parse(d.payload)};}
  function review(body){checkActor(body.actor);const d=draft(body.id);if(d.status!=='pending_review')error(409,'rule_draft_state_invalid');if(!['approved','rejected'].includes(body.decision)||!String(body.review_note||'').trim())error(400,'rule_review_note_required');db.prepare('UPDATE scoring_rule_drafts SET status=?,review_note=? WHERE id=? AND status=?').run(body.decision,body.review_note,d.id,'pending_review');auditRule(body.actor,'scoring.rule_review',d.id,d.status,body.decision);return {ok:true};}
  async function activate(body){checkActor(body.actor);const d=draft(body.id);if(d.status==='applied')return {ok:true,version:d.version_id,idempotent_replay:true};if(d.status!=='approved')error(409,'rule_draft_not_approved');const b={...d.payload,actor:body.actor};await precompute(b);const p=preview(b);const result=apply({...b,...p,request_key:d.id});db.prepare("UPDATE scoring_rule_drafts SET status='applied',version_id=? WHERE id=?").run(result.version,d.id);return result;}
  return {submit,review,activate,precompute,state,preview,apply,history,compare,design,version:()=>current().version_id};
}
