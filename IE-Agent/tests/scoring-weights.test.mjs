import test from 'node:test';
import assert from 'node:assert/strict';
import {DatabaseSync,backup} from 'node:sqlite';
import {mkdtemp,rm} from 'node:fs/promises';
import {join,resolve,dirname,basename} from 'node:path';
import {tmpdir} from 'node:os';
import {fileURLToPath} from 'node:url';
import {createServer} from 'node:net';
import {spawn} from 'node:child_process';
import {once} from 'node:events';
import {startLocalDatabase} from '../server/local-database.mjs';
import {passwordHash} from './fixtures/account-db.mjs';
import {DIMENSIONS} from '../server/scoring-engine.mjs';
const root=new URL('../',import.meta.url);
test('weight editing recalculates every vehicle atomically with immutable version history',async t=>{
 const folder=await mkdtemp(join(tmpdir(),'ie-weights-')),path=join(folder,'data.sqlite');
 const source=new DatabaseSync(fileURLToPath(new URL('var/platform.sqlite',root)),{readOnly:true});await backup(source,path);source.close();
 const db=new DatabaseSync(path);
 for(const [id,role,scope] of [['weights-admin','safety_admin','*'],['weights-driver','driver','fleet-local'],['weights-scope','safety_admin','some-fleet']])db.prepare('INSERT INTO app_users(user_id,username,role,fleet_scope,account_status,password_hash,must_change_password) VALUES(?,?,?,?,?,?,0)').run(id,id,role,scope,'active',passwordHash('WeightsTest2026'));
 const gateway=await startLocalDatabase({path,manifestPath:new URL('var/data-manifest.json',root)});
 const socket=createServer();await new Promise(r=>socket.listen(0,'127.0.0.1',r));const port=socket.address().port;await new Promise(r=>socket.close(r));
 const child=spawn(process.execPath,['server.mjs'],{cwd:root,windowsHide:true,env:{HOST:'127.0.0.1',PORT:String(port),APP_DATA_MODE:'full',SUPABASE_URL:gateway.url,SUPABASE_ANON_KEY:gateway.token,SUPABASE_INSTANCE_ID:'qa'},stdio:['ignore','pipe','pipe']});
 const base=`http://127.0.0.1:${port}`;child.stderr.on('data',x=>process.stderr.write(x));
 async function call(path,cookie,body){const r=await fetch(base+path,{method:body?'POST':'GET',headers:{'content-type':'application/json',...(cookie?{cookie}:{})},body:body?JSON.stringify(body):undefined});return {status:r.status,data:await r.json(),cookie:r.headers.get('set-cookie')?.split(';')[0]};}
 const route='/api/admin/score-weights';const read=table=>db.prepare(`SELECT * FROM ${table} ORDER BY rowid`).all();
 const digest=()=>JSON.stringify(['score_snapshots','score_history','review_queue','deduction_ledger','evaluation_rules'].map(read));
 try{
  for(let i=0;i<100;i++){try{if((await fetch(base+'/healthz')).ok)break;}catch{}await new Promise(r=>setTimeout(r,50));}
  const auth=async name=>(await call('/api/auth/login',null,{username:name,password:'WeightsTest2026'})).cookie;
  const admin=await auth('weights-admin'),driver=await auth('weights-driver'),scoped=await auth('weights-scope');
  let state=(await call(route,admin)).data;
  const baseline=JSON.parse(db.prepare("SELECT row_json FROM scoring_version_rows WHERE version_id='original' AND table_name='score_snapshots' LIMIT 1").get().row_json);
  const risk=JSON.stringify(read('risk_snapshots'));
  await t.test('only full-scope safety administrators can edit global weights',async()=>{assert.equal((await call(route,null)).status,401);assert.equal((await call(route,driver)).status,403);assert.equal((await call(route,scoped)).status,403);});
  await t.test('invalid sums, missing dimensions and invalid values cannot change scores',async()=>{
    const before=digest();for(const weights of [{...state.weights,history:1},{...state.weights,history:-1},{history:1},{...state.weights,imu_evidence:'0.1'}])assert.equal((await call(route+'/preview',admin,{weights,base_version:state.active_version})).status,400);assert.equal(digest(),before);
  });
  await t.test('preview is read-only and original weights reproduce published scores',async()=>{
    const before=digest(),r=await call(route+'/preview',admin,{weights:state.weights,base_version:state.active_version});assert.equal(r.status,200);assert.equal(r.data.summary.changed,0);assert.equal(digest(),before);
  });
  const weights={history:.1,fatigue_distraction:.2,driving_stability:.4,road_rule:.1,management:.1,imu_evidence:.1};
  const preview=(await call(route+'/preview',admin,{weights,base_version:state.active_version})).data;
  const payload={weights:preview.weights,base_version:preview.base_version,preview_id:preview.preview_id,request_key:'qa-weight-request-0001'};
  const expectedHistoryCount=read('score_history').length;
  let version;
  await t.test('submission updates all 500 scores, all history rows and 6267 ledger rows',async()=>{
    const r=await call(route+'/apply',admin,payload);assert.equal(r.status,200);version=r.data.version;assert.equal(r.data.summary.count,500);assert.ok(r.data.summary.changed>100);
    for(const [table,n] of [['score_snapshots',500],['score_history',expectedHistoryCount],['deduction_ledger',6267],['review_queue',500],['evaluation_rules',6]]){const rows=read(table);assert.equal(rows.length,n);assert.ok(rows.every(x=>x.source_version===version));}
    for(const r of read('score_snapshots')){const sum=DIMENSIONS.reduce((s,d)=>s+r[d+'_contribution'],0);assert.ok(Math.abs(r.safety_score-(100-sum))<1e-6);assert.equal(r.window_start,'2026-07-18');}
    assert.equal(JSON.stringify(read('risk_snapshots')),risk);
  });
  await t.test('ledger totals, ranks, levels and seven-day changes use the new weights',async()=>{
    const scores=read('score_snapshots'),history=read('score_history');
    const sums=new Map();for(const r of read('deduction_ledger'))sums.set(r.gpsno,(sums.get(r.gpsno)||0)+r.allocated_points);
    for(const r of scores){assert.ok(Math.abs((sums.get(r.gpsno)||0)-r.observed_behavior_deduction)<1e-8);const old=history.find(x=>x.gpsno===r.gpsno&&x.as_of_date==='2026-07-24');assert.ok(Math.abs(r.score_change_7d-(r.safety_score-old.safety_score))<1e-9);}
    assert.deepEqual(Object.fromEntries(['A','B','C','D'].map(k=>[k,scores.filter(r=>r.risk_level===k).length])),{A:100,B:200,C:150,D:50});
    const q=new Map(read('review_queue').map(r=>[r.gpsno,r]));assert.ok(scores.every(r=>q.get(r.gpsno).safety_score===r.safety_score&&q.get(r.gpsno).risk_level===r.risk_level));
  });
  await t.test('retry is idempotent and stale proposals are rejected',async()=>{
    const count=db.prepare('SELECT count(*) n FROM scoring_versions').get().n;
    const repeated=await call(route+'/apply',admin,payload);assert.equal(repeated.status,200);assert.equal(repeated.data.version,version);assert.equal(repeated.data.idempotent_replay,true);assert.equal(db.prepare('SELECT count(*) n FROM scoring_versions').get().n,count);
    const stale=await call(route+'/apply',admin,{...payload,request_key:'qa-stale-request-0001'});assert.equal(stale.status,409);
  });
  await t.test('original scores remain accessible as an unchanged historical version',async()=>{const r=await call(route+'?version=original',admin);assert.equal(r.status,200);assert.equal(r.data.rows.length,500);assert.equal(r.data.rows.find(x=>x.gpsno===baseline.gpsno).safety_score,baseline.safety_score);});
  await t.test('a failure partway through saving rolls back scores, rules and active version',async()=>{
    state=(await call(route,admin)).data;const extreme={history:1,fatigue_distraction:0,driving_stability:0,road_rule:0,management:0,imu_evidence:0};const p=(await call(route+'/preview',admin,{weights:extreme,base_version:state.active_version})).data;
    const before=digest(),count=db.prepare('SELECT count(*) n FROM scoring_versions').get().n;
    db.exec("CREATE TRIGGER qa_fail_recompute BEFORE INSERT ON review_queue BEGIN SELECT RAISE(ABORT,'qa_failure'); END;");
    const r=await call(route+'/apply',admin,{...p,request_key:'qa-failure-request-0001'});assert.equal(r.status,500);db.exec('DROP TRIGGER qa_fail_recompute');assert.equal(digest(),before);assert.equal((await call('/api/score-version',driver)).data.version,version);assert.equal(db.prepare('SELECT count(*) n FROM scoring_versions').get().n,count);
  });
  await t.test('zero weights and restoring the original weights both work without cumulative drift',async()=>{
    for(const w of [{history:1,fatigue_distraction:0,driving_stability:0,road_rule:0,management:0,imu_evidence:0},state.baseline_weights]){const s=(await call(route,admin)).data;const p=(await call(route+'/preview',admin,{weights:w,base_version:s.active_version})).data;assert.equal((await call(route+'/apply',admin,{...p,request_key:'qa-restore-'+Math.random().toString(36).slice(2)})).status,200);assert.ok(read('score_snapshots').every(r=>Number.isFinite(r.safety_score)));}
    assert.equal(read('score_snapshots').find(r=>r.gpsno===baseline.gpsno).safety_score,baseline.safety_score);
    const originalRows=db.prepare("SELECT row_json FROM scoring_version_rows WHERE version_id='original' AND table_name='score_snapshots'").all().map(r=>JSON.parse(r.row_json));
    for(const r of read('score_snapshots')){const old=originalRows.find(x=>x.gpsno===r.gpsno);assert.equal(r.safety_score,old.safety_score);assert.equal(r.rank,old.rank);assert.equal(r.risk_level,old.risk_level);}
  });
 await t.test('rule drafts require validation, review, and explicit activation through HTTP',async()=>{
 const s=(await call(route,admin)).data,before=digest(),proposal={weights:{...s.weights,history:s.weights.history-.01,driving_stability:s.weights.driving_stability+.01},model_config:s.model_config,base_version:s.active_version,label:'API审核测试',reason:'隔离库验证'};
 assert.equal((await call(route+'/submit',driver,proposal)).status,403);
 for(const change of [{exposure_units:{history:'invalid'}},{factors:[{...s.model_config.factors[0],severity:-1}]},{factors:[{...s.model_config.factors[0],code:999999}]}])assert.equal((await call(route+'/submit',admin,{...proposal,model_config:{...s.model_config,...change}})).status,400);
 const d=await call(route+'/submit',admin,proposal);assert.equal(d.status,200);assert.equal(digest(),before);
 assert.equal((await call(route+'/activate',admin,{id:d.data.id})).status,409);
 assert.equal((await call(route+'/review',admin,{id:d.data.id,decision:'approved',review_note:''})).status,400);
 assert.equal((await call(route+'/review',admin,{id:d.data.id,decision:'approved',review_note:'已核查'})).status,200);assert.equal(digest(),before);
 const a=await call(route+'/activate',admin,{id:d.data.id});assert.equal(a.status,200);assert(a.data.summary.changed>0);assert.equal((await call(route+'/activate',admin,{id:d.data.id})).data.version,a.data.version);
 assert(db.prepare("SELECT 1 FROM audit_logs WHERE action='scoring.rule_review' AND entity_id=?").get(d.data.id));
 const restore=(await call(route+'/preview',admin,{base_version:a.data.version,restore_version:'original'})).data;assert.equal((await call(route+'/apply',admin,{...restore,request_key:'qa-governance-restore-1'})).status,200);
 });
 }finally{const stopped=once(child,'exit');child.kill();await stopped;await gateway.close();db.close();assert.equal(dirname(resolve(folder)),resolve(tmpdir()));assert.ok(basename(folder).startsWith('ie-weights-'));await rm(folder,{recursive:true,force:true});}
});
