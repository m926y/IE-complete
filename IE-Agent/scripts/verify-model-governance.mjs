import {DatabaseSync,backup} from 'node:sqlite';
import {readFile,mkdir,writeFile} from 'node:fs/promises';
import {createScoringEngine} from '../server/scoring-engine.mjs';
import assert from 'node:assert/strict';
import {fileURLToPath} from 'node:url';
const root=new URL('../',import.meta.url),dir=new URL('var/backups/model-governance-'+new Date().toISOString().replace(/[:.]/g,'-')+'/',root);await mkdir(dir,{recursive:true});
const db=new DatabaseSync(new URL('var/platform.sqlite',root));db.exec('PRAGMA busy_timeout=5000');await backup(db,fileURLToPath(new URL('platform.sqlite',dir)));
const frozen=JSON.parse(await readFile(new URL('scripts/scoring_source/scoring_frozen.json',root),'utf8')),engine=createScoringEngine(db,frozen),admin=db.prepare("SELECT user_id FROM app_users WHERE role='safety_admin' AND account_status='active' AND fleet_scope='*' LIMIT 1").get();assert(admin);
const actor={id:admin.user_id,role:'safety_admin',scope:'*'},initial=engine.state();
const normalRows=()=>db.prepare('SELECT row_json FROM scoring_version_rows WHERE version_id=? AND table_name=? ORDER BY row_no').all('original','score_snapshots').map(r=>JSON.parse(r.row_json));
const report={initial_version:initial.active_version,steps:[],restored:false};
try{
 const weights={...initial.weights};weights.history-=0.01;weights.driving_stability+=0.01;
 let d=engine.submit({actor,weights,base_version:engine.version(),label:'闭环验证：权重调整',reason:'验证保存、审核与正式生效，验证结束恢复原始模型'});await assert.rejects(()=>engine.activate({...d,actor}));
 engine.review({actor,id:d.id,decision:'approved',review_note:'已核查六维权重合计为1及调整依据'});let result=await engine.activate({actor,id:d.id});assert(result.summary.changed>0);report.steps.push({kind:'weights',draft:d.id,changed:result.summary.changed,version:result.version});
 const c=structuredClone(engine.state().model_config);c.factors[0].severity*=1.5;c.exposure_units={history:'per_100h',fatigue_distraction:'per_100h',driving_stability:'per_1000km',road_rule:'per_1000km',management:'per_active_day'};
 d=engine.submit({actor,weights,model_config:c,base_version:engine.version(),label:'闭环验证：严重度与暴露口径',reason:'事故严重度增加50%，事故维度改为每百小时；验证后恢复原始参数'});
 assert.equal(engine.state().active_version,result.version);engine.review({actor,id:d.id,decision:'approved',review_note:'已核查事件、严重度和暴露口径，批准重算验证'});result=await engine.activate({actor,id:d.id});assert(result.summary.changed>0);assert.equal(engine.state().model_config.exposure_units.history,'per_100h');report.steps.push({kind:'factors_and_exposure',draft:d.id,changed:result.summary.changed,version:result.version});
}finally{
 const p=engine.preview({actor,restore_version:'original',base_version:engine.version()});const restored=engine.apply({...p,actor,label:'恢复初始评分模型',reason:'权重、严重度、事件因子及暴露口径闭环验证完成，恢复原始参数',request_key:'restore-'+Date.now()});
 const baseline=normalRows(),live=db.prepare('SELECT * FROM score_snapshots ORDER BY gpsno').all();for(const row of live){const b=baseline.find(r=>r.gpsno===row.gpsno);for(const k of ['safety_score','risk_level','rank',...Object.keys(frozen.weights).map(d=>d+'_contribution')])assert.equal(row[k],b[k],row.gpsno+' '+k);}
 assert.deepEqual(engine.state().weights,engine.state().baseline_weights);assert.equal(engine.state().model_config.window_days,14);assert.equal(engine.state().model_config.exposure_units,undefined);
 report.restored=true;report.final_version=restored.version;report.restored_vehicles=live.length;await writeFile(new URL('verification.json',dir),JSON.stringify(report,null,2));console.log(JSON.stringify(report,null,2));db.close();
}
