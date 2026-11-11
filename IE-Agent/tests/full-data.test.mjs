import test from 'node:test';
import assert from 'node:assert/strict';
import { DatabaseSync, backup } from 'node:sqlite';
import { mkdtemp, rm, readFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve, dirname, basename } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createServer } from 'node:net';
import { spawn } from 'node:child_process';
import { once } from 'node:events';
import { startLocalDatabase } from '../server/local-database.mjs';
import { passwordHash } from './fixtures/account-db.mjs';
import ts from 'typescript';
import vm from 'node:vm';
const root=new URL('../',import.meta.url);
test('full persistent data, 500-vehicle pagination and own-data boundaries',async t=>{
  const dir=await mkdtemp(join(tmpdir(),'ie-full-data-'));
  const dbPath=join(dir,'qa.sqlite');
  const source=new DatabaseSync(fileURLToPath(new URL('var/platform.sqlite',root)),{readOnly:true});
  await backup(source,dbPath);source.close();
  const setup=new DatabaseSync(dbPath);
  const gps=setup.prepare('SELECT gpsno FROM drivers ORDER BY gpsno').all().map(x=>x.gpsno);
  const occupied=new Set(setup.prepare('SELECT driver_id FROM app_users WHERE driver_id IS NOT NULL').all().map(x=>x.driver_id));
  const free=gps.filter(g=>!occupied.has('D-'+g)&&g!==gps[0]).slice(-2);
  for(const [id,role,scope,driver] of [['qa-admin','safety_admin','*',null],['qa-officer','safety_officer','*',null],['qa-driver','driver','fleet-local','D-'+gps[0]],['qa-other','driver','fleet-local',null],['qa-scope','team_leader','no-such-fleet',null]])
    setup.prepare('INSERT INTO app_users(user_id,username,display_name,role,fleet_scope,driver_id,binding_verified,account_status,password_hash,must_change_password) VALUES (?,?,?,?,?,?,1,?,?,0)').run(id,id,id,role,scope,driver,'active',passwordHash('DataTest2026'));
  setup.close();
  const gateway=await startLocalDatabase({path:dbPath,manifestPath:new URL('var/data-manifest.json',root)});
  let child,base;
  async function start(){
    const s=createServer();await new Promise(r=>s.listen(0,'127.0.0.1',r));const port=s.address().port;await new Promise(r=>s.close(r));base=`http://127.0.0.1:${port}`;
    child=spawn(process.execPath,['server.mjs'],{cwd:root,windowsHide:true,env:{HOST:'127.0.0.1',PORT:String(port),APP_DATA_MODE:'full',SUPABASE_URL:gateway.url,SUPABASE_ANON_KEY:gateway.token,SUPABASE_INSTANCE_ID:'qa'},stdio:['ignore','pipe','pipe']});
    child.stderr.on('data',x=>process.stderr.write(x));
    for(let n=0;n<100;n++){try{if((await fetch(base+'/healthz')).ok)return;}catch{} await new Promise(r=>setTimeout(r,50));}throw new Error('startup_timeout');
  }
  async function stop(){if(child&&child.exitCode===null){const done=once(child,'exit');child.kill();await done;}}
  async function call(path,cookie,method='GET',body){const r=await fetch(base+path,{method,headers:{'content-type':'application/json',...(cookie?{cookie}:{})},body:body===undefined?undefined:JSON.stringify(body)});return{status:r.status,data:await r.json(),cookie:r.headers.get('set-cookie')?.split(';')[0]};}
  const login=async name=>(await call('/api/auth/login',null,'POST',{username:name,password:'DataTest2026'})).cookie;
  const data=(resource,params,cookie)=>call('/api/data/'+resource+'?'+new URLSearchParams(params),cookie);
  try{
    await start();const admin=await login('qa-admin'),driver=await login('qa-driver'),scoped=await login('qa-scope');
    await t.test('Safety officers keep business access but cannot read/write model configuration or promote administrators',async()=>{const login=await call('/api/auth/login',null,'POST',{username:'qa-officer',password:'DataTest2026'});const officer=login.cookie;assert(officer);assert.equal((await call('/api/data/admin.score_snapshots',officer)).status,200);for(const path of ['/api/admin/score-weights','/api/admin/score-weights?version=original'])assert.equal((await call(path,officer)).status,403);for(const path of ['/api/admin/score-weights/preview','/api/admin/score-weights/apply'])assert.equal((await call(path,officer,'POST',{})).status,403);assert.equal((await call('/api/admin/users',officer,'POST',{username:'qa-promoted',role:'safety_admin'})).status,403);assert.equal((await call('/api/admin/duty-history',officer)).status,200);const links=await call('/api/admin/driver-accounts',officer);assert.equal(links.status,200);assert.equal(links.data.vehicle_count,500);assert(links.data.rows.some(r=>r.username==='qa-driver'));assert(links.data.rows.every(r=>!('password_hash' in r)&&!('avatar_url' in r)));assert.equal((await call('/api/admin/driver-accounts',driver)).status,403);assert.equal((await call('/api/admin/driver-accounts',scoped)).status,403);});
  await t.test('Handover HTTP authenticates officers, ignores forged actor, persists receipts and denies drivers',async()=>{const officer=await login('qa-officer');assert.equal((await call('/api/handover/data')).status,401);assert.equal((await call('/api/handover/data',driver)).status,403);assert.equal((await call('/api/handover/data',scoped)).status,403);assert.equal((await call('/api/handover/settings',officer,'POST',{end_time:'00:00',enabled:true,ai_enabled:false,recipient_id:'qa-admin',actor:{id:'qa-admin'}})).status,200);const generated=await call('/api/handover/generate',officer,'POST',{actor:{id:'qa-admin'}});assert.equal(generated.status,200);assert.equal(generated.data.owner_id,'qa-officer');assert.equal(generated.data.ai_status,'disabled');assert.equal(generated.data.recipient_id,'qa-admin');const id=generated.data.id;assert.equal((await call('/api/handover/generate',officer,'POST',{})).data.id,id);assert.equal((await call('/api/handover/view?id='+id,driver)).status,403);assert.equal((await call('/api/handover/accept',officer,'POST',{id})).status,403);assert.equal((await call('/api/handover/accept',admin,'POST',{id})).status,200);assert.equal((await call('/api/handover/view?id='+id,officer)).data.status,'accepted');assert.equal((await call('/api/handover/note',officer,'POST',{id,content:'下班交接补充'})).status,200);assert.equal((await call('/api/handover/view?id='+id,admin)).data.notes.length,1);assert.equal((await call('/api/center/data',officer)).status,200);});
  await t.test('manifest reports complete source counts and exact official score match',async()=>{const r=await call('/api/data-status',admin);assert.equal(r.status,200);assert.equal(r.data.counts.events,3152654);assert.equal(r.data.counts.drivers,500);assert.equal(r.data.published_score_max_difference,0);assert.ok(r.data.ledger_max_difference<1e-9);assert.deepEqual(r.data.level_counts,{A:100,B:200,C:150,D:50});assert.equal(r.data.history_database,undefined);});
    await t.test('all 500 scores are reachable beyond the first 200',async()=>{let rows=[];for(let offset=0;offset<600;offset+=200){const r=await data('admin.score_snapshots',{limit:200,offset},admin);assert.equal(r.status,200);assert.equal(r.data.total,500);rows.push(...r.data.rows);}assert.equal(rows.length,500);assert.equal(new Set(rows.map(x=>x.gpsno)).size,500);assert.deepEqual(Object.fromEntries(['A','B','C','D'].map(k=>[k,rows.filter(r=>r.risk_level===k).length])),{A:100,B:200,C:150,D:50});});
    await t.test('A-level filter and numeric descending order are correct',async()=>{const r=await data('admin.score_snapshots',{limit:200,risk_level:'A',order:'safety_score.desc'},admin);assert.equal(r.data.total,100);assert.ok(r.data.rows.every(x=>x.risk_level==='A'));assert.ok(r.data.rows.every((r,i,a)=>i===0||r.safety_score<=a[i-1].safety_score));});
    await t.test('14 dates and 7000 history rows are available',async()=>{const h=await call('/api/meta/history-dates',admin);assert.equal(h.status,200);assert.equal(h.data.dates.length,14);assert.ok(Object.values(h.data.counts).every(x=>x===500));const r=await data('admin.score_history',{limit:1,order:'as_of_date.desc'},admin);assert.equal(r.data.total,7000);assert.equal(r.data.rows[0].as_of_date,'2026-07-31');});
    await t.test('all evidence ledger rows and all forecasts are queryable',async()=>{assert.equal((await data('admin.deduction_ledger',{limit:1},admin)).data.total,6267);assert.equal((await data('admin.risk_snapshots',{limit:1},admin)).data.total,500);});
    await t.test('event evidence is full indexed data with date filtering',async()=>{const r=await data('admin.events',{gpsno:gps[0],event_date:'2026-07-31',limit:20,order:'event_time.asc'},admin);assert.equal(r.status,200);assert.ok(r.data.rows.length>0);assert.ok(r.data.rows.every(x=>x.gpsno===gps[0]&&x.event_date==='2026-07-31'));});
    await t.test('trajectory, IMU and profiles have full source coverage',async()=>{for(const [table,total] of [['trajectory_daily',28827],['imu_daily',14836],['profiles',500]]){const r=await data('admin.'+table,{limit:1},admin);assert.equal(r.status,200);assert.equal(r.data.total,total);}});
    await t.test('driver cannot read administrator data or another vehicle',async()=>{assert.equal((await data('admin.score_snapshots',{limit:1},driver)).status,403);const own=await data('my.events',{gpsno:gps[0],event_date:'2026-07-31',limit:10},driver);assert.equal(own.status,200);assert.ok(own.data.rows.length>0);assert.ok(own.data.rows.every(x=>x.driver_id==='D-'+gps[0]));const other=await data('my.events',{gpsno:gps[1],event_date:'2026-07-31',limit:10,driver_id:'D-'+gps[1]},driver);assert.equal(other.data.total,0);});
    await t.test('restricted staff scope is applied before querying and counting',async()=>{const r=await data('admin.score_snapshots',{limit:20},scoped);assert.equal(r.status,200);assert.equal(r.data.total,0);const status=await call('/api/data-status',scoped);assert.equal(status.status,200);assert.equal(status.data.counts.events,0);assert.equal(status.data.counts.drivers,0);});
    await t.test('private data gateway requires its token and blocks direct fact updates',async()=>{assert.equal((await fetch(gateway.url+'/rest/v1/app_users')).status,401);assert.equal((await fetch(gateway.url+'/rest/v1/score_snapshots',{method:'PATCH',headers:{apikey:gateway.token,'content-type':'application/json'},body:'{"safety_score":0}'})).status,403);});
    await t.test('AI data tool can page across all grades without any model call',async()=>{
      const source=await readFile(new URL('server.mjs',root),'utf8'),ast=ts.createSourceFile('server.mjs',source,ts.ScriptTarget.Latest,true);
      const snippets=[];
      for(const node of ast.statements){
        if(ts.isVariableStatement(node))for(const d of node.declarationList.declarations)if(['AI_TOOLS','AI_TOOL_CONTRACTS'].includes(d.name.getText(ast)))snippets.push(`const ${d.getText(ast)};`);
        if(ts.isFunctionDeclaration(node)&&['clampToolArgs','factPick'].includes(node.name?.text))snippets.push(node.getText(ast));
      }
      const scope={DENY:{status:'refused_no_scope'},aiQ:async(resource,params)=>{const r=await data(resource,params,admin);assert.equal(r.status,200);return r.data;}};
      const code=vm.runInNewContext(snippets.join('\n')+'\n({AI_TOOLS,clampToolArgs})',scope);
      const args=code.clampToolArgs('get_review_queue',{limit:200,offset:400,order:'safety_score.desc'});
      const result=await code.AI_TOOLS.get_review_queue(args,{user:{role:'safety_admin'}});
      assert.equal(result.data.length,100);assert.equal(result.total,500);assert.equal(result.next_offset,null);
      const a=await code.AI_TOOLS.get_review_queue(code.clampToolArgs('get_review_queue',{risk_level:'A',limit:200}),{user:{role:'safety_admin'}});
      assert.equal(a.data.length,100);assert.ok(a.data.every(x=>x.risk_level==='A'));
      assert.equal((await code.AI_TOOLS.get_review_queue({}, {user:{role:'driver'}})).status,'refused_no_scope');
    });
    await t.test('center API requires login and ignores forged actor on read',async()=>{const feed=await call('/api/center/data',admin);assert.equal(feed.status,200);assert.equal(feed.data.todo_count,feed.data.todos.length);assert.equal(feed.data.unread_notes,feed.data.notes.filter(n=>!n.read_at).length);assert.equal((await call('/api/center/data',null)).status,401);assert.equal((await call('/api/center/read',driver,'POST',{id:'note:foreign',actor:{id:'qa-admin'}})).status,404);});
    await t.test('offline HTTP booking authenticates, persists invitations atomically and supports cancellation',async()=>{const db=new DatabaseSync(dbPath);try{const target=db.prepare("SELECT driver_id FROM score_snapshots WHERE risk_level IN ('C','D') AND confidence_level IN ('high','medium') AND driver_id NOT IN (SELECT driver_id FROM app_users WHERE driver_id IS NOT NULL) LIMIT 1").get();assert(target);db.prepare("INSERT INTO app_users(user_id,username,role,driver_id,binding_verified,account_status) VALUES('qa-offline-person','qa-offline-person','driver',?,1,'active')").run(target.driver_id);const who={user_id:'qa-offline-person'};assert(who);const form={title:'隔离副本线下培训',content:'风险案例现场复盘',room:'会议室3',start_at:'2099-11-02T09:00',end_at:'2099-11-02T10:00',participants:[who.user_id],request_key:'offline-http-api-0001'};assert.equal((await call('/api/offline-training/data',null)).status,401);assert.equal((await call('/api/offline-training/create',driver,'POST',{...form,actor:{id:'qa-admin'}})).status,403);const r=await call('/api/offline-training/create',admin,'POST',form);assert.equal(r.status,200,JSON.stringify(r.data));assert.equal(r.data.notified,1);assert(db.prepare("SELECT 1 FROM notification_events WHERE source_entity_id=? AND target_user_id=? AND type='offline_created'").get(r.data.id,who.user_id));assert.equal((await call('/api/offline-training/create',admin,'POST',form)).data.idempotent_replay,true);assert((await call('/api/offline-training/data?month=2099-11',admin)).data.bookings.some(b=>b.id===r.data.id));assert.equal((await call('/api/offline-training/cancel',admin,'POST',{id:r.data.id})).status,200);}finally{db.close()}});
    await t.test('vehicle binding, replacement, conflict and unlink update live driver access',async()=>{
      const bind=(id,g,cookie=admin)=>call('/api/admin/vehicle-binding',cookie,'POST',{user_id:id,gpsno:g});
      assert.equal((await bind('qa-driver',free[0],driver)).status,403);
      assert.equal((await bind('qa-admin',free[0])).status,409);
      assert.equal((await bind('qa-driver',free[0])).status,200);
      assert.equal((await call('/api/me',driver)).data.user.driverId,'D-'+free[0]);
      const score=await data('my.score',{limit:1},driver);assert.equal(score.status,200);assert.equal(score.data.rows.length,1);
      assert.equal((await data('my.events',{gpsno:gps[0],limit:1},driver)).data.total,0);
      assert.equal((await bind('qa-other',free[0])).data.error,'vehicle_already_bound');
      assert.equal((await bind('qa-driver',free[1])).status,200);
      assert.equal((await call('/api/me',driver)).data.user.driverId,'D-'+free[1]);
      const rows=(await call('/api/admin/bindings',admin)).data.rows;
      assert.ok(rows.some(r=>r.user_id==='qa-driver'&&r.driver_id==='D-'+free[0]&&r.account_status==='inactive'));
      assert.equal((await bind('qa-driver',null)).status,200);
      assert.equal((await call('/api/me',driver)).data.user.bindingVerified,false);
      assert.equal((await data('my.score',{limit:1},driver)).status,409);
      assert.equal((await bind('qa-driver',free[0])).status,200);
      const active=(await call('/api/admin/bindings',admin)).data.rows.find(r=>r.user_id==='qa-driver'&&r.account_status==='active');
      assert.equal((await call('/api/admin/binding-delete',admin,'POST',{binding_id:active.binding_id})).status,200);
      assert.equal((await call('/api/me',driver)).data.user.driverId,null);
      assert.ok((await call('/api/admin/bindings',admin)).data.rows.some(r=>r.binding_id===active.binding_id&&r.account_status==='inactive'));
      assert.equal((await data('admin.score_snapshots',{limit:1},admin)).data.total,500);
    });
    await t.test('profile changes and sessions survive restarting the platform process',async()=>{assert.equal((await call('/api/me/account',driver,'PATCH',{display_name:'Persisted QA',avatar_url:'preset:2'})).status,200);await stop();await start();const r=await call('/api/me',driver);assert.equal(r.status,200);assert.equal(r.data.user.displayName,'Persisted QA');assert.equal(r.data.user.avatarUrl,'preset:2');});
  } finally{await stop();await gateway.close();assert.equal(dirname(resolve(dir)),resolve(tmpdir()));assert.ok(basename(dir).startsWith('ie-full-data-'));await rm(dir,{recursive:true,force:true});}
});
