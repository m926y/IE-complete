import test from 'node:test';
import assert from 'node:assert/strict';
import {DatabaseSync,backup} from 'node:sqlite';
import {mkdtemp,rm} from 'node:fs/promises';
import {join,resolve,sep} from 'node:path';
import {tmpdir} from 'node:os';
import {fileURLToPath} from 'node:url';
import {createServer} from 'node:net';
import {spawn} from 'node:child_process';
import {once} from 'node:events';
import {startLocalDatabase} from '../server/local-database.mjs';
import {passwordHash} from './fixtures/account-db.mjs';
import {validateLevelRatios} from '../server/scoring-engine.mjs';
import {createDriverIntegration} from '../server/driver-integration.mjs';

const root=new URL('../',import.meta.url);
test('grade ratio validation rejects invalid totals and noninteger percentages',()=>{
  assert.deepEqual(validateLevelRatios(),{A:20,B:40,C:30,D:10});
  for(const value of [{A:20,B:40,C:30,D:20},{A:-1,B:51,C:40,D:10},{A:20.5,B:39.5,C:30,D:10},{A:100}])assert.throws(()=>validateLevelRatios(value));
});

test('overview updates keep role gates, published scores, pagination and schedule consistent',async t=>{
  const folder=await mkdtemp(join(tmpdir(),'ie-overview-')),path=join(folder,'platform.sqlite');
  const source=new DatabaseSync(fileURLToPath(new URL('var/platform.sqlite',root)),{readOnly:true});await backup(source,path);source.close();
  const seed=new DatabaseSync(path),bound=seed.prepare("SELECT * FROM app_users WHERE role='driver' AND driver_id IS NOT NULL LIMIT 1").get();
  for(const [id,role] of [['overview-admin','safety_admin'],['overview-officer','safety_officer'],['overview-driver','driver']])seed.prepare('INSERT INTO app_users(user_id,username,display_name,role,fleet_scope,account_status,password_hash,must_change_password,driver_id,binding_verified) VALUES(?,?,?,?,?,?,?,0,?,?)').run(id,id,id,role,'*','active',passwordHash('OverviewTest2026'),role==='driver'?bound.driver_id:null,role==='driver'?1:0);
  const date='2026-11-15';for(const d of seed.prepare('SELECT driver_id FROM drivers').all())seed.prepare("INSERT OR IGNORE INTO daily_report_jobs(driver_id,report_date,status) VALUES(?,?,'pending')").run(d.driver_id,date);
  seed.close();
  const gateway=await startLocalDatabase({path,manifestPath:new URL('var/data-manifest.json',root)}),socket=createServer();await new Promise(r=>socket.listen(0,'127.0.0.1',r));const port=socket.address().port;await new Promise(r=>socket.close(r));
  const child=spawn(process.execPath,['server.mjs'],{cwd:root,windowsHide:true,env:{HOST:'127.0.0.1',PORT:String(port),APP_DATA_MODE:'full',SUPABASE_URL:gateway.url,SUPABASE_ANON_KEY:gateway.token,SUPABASE_INSTANCE_ID:'qa'},stdio:['ignore','pipe','pipe']});child.stderr.on('data',()=>{});
  const call=async(path,cookie,body)=>{const r=await fetch('http://127.0.0.1:'+port+path,{method:body?'POST':'GET',headers:{'content-type':'application/json',...(cookie?{cookie}:{})},body:body?JSON.stringify(body):undefined});return {status:r.status,data:await r.json(),cookie:r.headers.get('set-cookie')?.split(';')[0]};};
  try{
    for(let i=0;i<100;i++){try{if((await fetch('http://127.0.0.1:'+port+'/healthz')).ok)break;}catch{}await new Promise(r=>setTimeout(r,50));}
    const cookies={};for(const role of ['admin','officer','driver'])cookies[role]=(await call('/api/auth/login',null,{username:'overview-'+role,password:'OverviewTest2026'})).cookie;
    const state=(await call('/api/admin/score-weights',cookies.admin)).data;
    let plan;
    await t.test('ratio preview changes grades while leaving every score unchanged',async()=>{
      const r=await call('/api/admin/score-weights/preview',cookies.admin,{weights:state.weights,base_version:state.active_version,model_config:{...state.model_config,level_ratios:{A:10,B:30,C:40,D:20}}});assert.equal(r.status,200);plan=r.data;assert.equal(plan.summary.changed,0);assert.equal(plan.summary.new_average,plan.summary.old_average);assert.ok(plan.summary.level_changed>0);
    });
    await t.test('officer and driver cannot change grade allocation',async()=>{for(const role of ['officer','driver'])assert.equal((await call('/api/admin/score-weights/apply',cookies[role],{...plan,request_key:'denied-ratio-1'})).status,403);});
    await t.test('published grade ratios propagate to staff, driver, history and risk queue',async()=>{
      const result=await call('/api/admin/score-weights/apply',cookies.admin,{...plan,request_key:'overview-ratio-apply-1'});assert.equal(result.status,200);
      const db=new DatabaseSync(path,{readOnly:true});const dist=Object.fromEntries(db.prepare('SELECT risk_level,count(*) n FROM score_snapshots GROUP BY risk_level').all().map(r=>[r.risk_level,r.n]));assert.deepEqual(dist,{A:50,B:150,C:200,D:100});
      assert.equal(db.prepare('SELECT count(*) n FROM review_queue q JOIN score_snapshots s ON q.gpsno=s.gpsno WHERE q.risk_level!=s.risk_level').get().n,0);
      const expected=db.prepare('SELECT risk_level FROM score_snapshots WHERE driver_id=?').get(bound.driver_id).risk_level;db.close();
      const me=await call('/api/data/my.score',cookies.driver);assert.equal(me.status,200);assert.equal(me.data.rows[0].risk_level,expected);
      for(const role of ['officer','driver'])assert.equal((await call('/api/score-version',cookies[role])).data.version,result.data.version);
      assert.deepEqual((await call('/api/admin/score-weights',cookies.admin)).data.model_config.level_ratios,{A:10,B:30,C:40,D:20});
      const replay=await call('/api/admin/score-weights/apply',cookies.admin,{...plan,request_key:'overview-ratio-apply-1'});assert.equal(replay.status,200);assert.equal(replay.data.idempotent_replay,true);
    });
    await t.test('jobs search and ten-row pages include all 500 vehicles without overlap',async()=>{
      const first=await call('/api/admin/daily-reports/jobs?date='+date,cookies.admin),second=await call('/api/admin/daily-reports/jobs?date='+date+'&offset=10',cookies.admin);assert.equal(first.data.total,500);assert.equal(first.data.rows.length,10);assert.equal(second.data.rows.length,10);assert.ok(!first.data.rows.some(a=>second.data.rows.some(b=>a.id===b.id)));
      const exact=first.data.rows[0].vehicle,found=await call('/api/admin/daily-reports/jobs?'+new URLSearchParams({date,search:exact}),cookies.officer);assert.ok(found.data.matchedTotal>0);assert.ok(found.data.rows.every(r=>r.vehicle.includes(exact)));
      assert.equal((await call('/api/admin/daily-reports/jobs?date='+date,cookies.driver)).status,403);
    });
    await t.test('schedule is persisted, validated, admin-only and respected by the worker',async()=>{
      assert.equal((await call('/api/admin/daily-reports/settings',cookies.officer,{time:'09:30'})).status,403);
      assert.equal((await call('/api/admin/daily-reports/settings',cookies.admin,{time:'25:99'})).status,400);
      assert.equal((await call('/api/admin/daily-reports/settings',cookies.admin,{time:'09:30'})).status,200);
      assert.equal((await call('/api/admin/daily-reports/settings',cookies.officer)).data.time,'09:30');
      const db=new DatabaseSync(path),worker=createDriverIntegration(db,{clock:()=>Date.parse('2026-11-20T09:29:00+08:00')});worker.pump();assert.equal(db.prepare("SELECT count(*) n FROM daily_report_jobs WHERE report_date='2026-11-20'").get().n,0);worker.close();db.close();
    });
    await t.test('handover preview uses selected or saved recipient without publishing a handover',async()=>{
      const before=(await call('/api/handover/data',cookies.admin)).data.total;
      const preview=await call('/api/handover/preview',cookies.admin,{recipient_id:'overview-officer'});assert.equal(preview.status,200);assert.equal(preview.data.recipient_id,'overview-officer');assert.ok(preview.data.recipient_name.includes('overview-officer'));
      assert.equal((await call('/api/handover/data',cookies.admin)).data.total,before);
      assert.equal((await call('/api/handover/preview',cookies.driver,{})).status,403);
    });
  }finally{if(child.exitCode===null){child.kill();await once(child,'exit');}await gateway.close();assert.ok(resolve(folder).startsWith(resolve(tmpdir())+sep));await rm(folder,{recursive:true,force:true});}
});
