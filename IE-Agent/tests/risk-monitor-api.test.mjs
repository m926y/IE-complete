import test from 'node:test';
import assert from 'node:assert/strict';
import {DatabaseSync,backup} from 'node:sqlite';
import {mkdtemp,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join,resolve} from 'node:path';
import {fileURLToPath} from 'node:url';
import {spawn} from 'node:child_process';
import {once} from 'node:events';
import {createServer} from 'node:net';
import {startLocalDatabase} from '../server/local-database.mjs';
import {passwordHash} from './fixtures/account-db.mjs';
test('Risk HTTP API uses real history and SQLite, never caller-supplied identity',async()=>{
 const root=new URL('../',import.meta.url),folder=await mkdtemp(join(tmpdir(),'ie-risk-api-')),path=join(folder,'platform.sqlite');let db,gateway,child;
 try{const source=new DatabaseSync(fileURLToPath(new URL('var/platform.sqlite',root)),{readOnly:true});await backup(source,path);source.close();db=new DatabaseSync(path);
 const driver=db.prepare("SELECT u.user_id,u.username,u.driver_id,d.gpsno FROM app_users u JOIN drivers d ON d.driver_id=u.driver_id WHERE role='driver' AND binding_verified=1 AND account_status='active' ORDER BY username='preview_driver' DESC LIMIT 1").get();assert(driver);
 db.prepare('UPDATE app_users SET password_hash=?,must_change_password=0 WHERE user_id=?').run(passwordHash('RiskApiQA2026'),driver.user_id);
 db.prepare("INSERT INTO app_users(user_id,username,role,fleet_scope,account_status,password_hash,must_change_password) VALUES('qa-risk-admin','qa-risk-admin','safety_admin','*','active',?,0)").run(passwordHash('RiskApiQA2026'));
 gateway=await startLocalDatabase({path,manifestPath:new URL('var/data-manifest.json',root)});const socket=createServer();await new Promise(r=>socket.listen(0,'127.0.0.1',r));const port=socket.address().port;await new Promise(r=>socket.close(r));
 child=spawn(process.execPath,['server.mjs'],{cwd:root,windowsHide:true,env:{HOST:'127.0.0.1',PORT:String(port),APP_DATA_MODE:'full',SUPABASE_URL:gateway.url,SUPABASE_ANON_KEY:gateway.token,SUPABASE_INSTANCE_ID:'risk-api-test'},stdio:['ignore','ignore','pipe']});let logs='';child.stderr.on('data',b=>logs+=b);
 const base='http://127.0.0.1:'+port;for(let i=0;i<100;i++){try{if((await fetch(base+'/healthz')).ok)break}catch{}await new Promise(r=>setTimeout(r,50))}
 async function call(path,cookie,body,method){const r=await fetch(base+path,{method:method||(body===undefined?'GET':'POST'),headers:{'content-type':'application/json',...(cookie?{cookie}:{})},body:body===undefined?undefined:JSON.stringify(body)});return {status:r.status,data:await r.json(),cookie:r.headers.get('set-cookie')?.split(';')[0]}}
 const auth=async username=>{const r=await call('/api/auth/login',null,{username,password:'RiskApiQA2026'});assert.equal(r.status,200,logs);return r.cookie},admin=await auth('qa-risk-admin'),mine=await auth(driver.username);
 assert.equal((await call('/api/risk/live')).status,401);assert.equal((await call('/api/risk/metadata',mine)).status,403);assert.equal((await call('/api/risk/create',mine,{actor:{id:'qa-risk-admin'},date:'2026-07-08',vehicles:[driver.gpsno]})).status,403);
 const created=await call('/api/risk/create',admin,{date:'2026-07-08',vehicles:[driver.gpsno]});assert.equal(created.status,200,JSON.stringify(created.data));const id=created.data.id;
 assert.equal((await call('/api/risk/control',mine,{id,action:'next',actor:{id:'qa-risk-admin'}})).status,403);
 const next=await call('/api/risk/control',admin,{id,action:'next'});assert.equal(next.status,200,JSON.stringify(next.data));const live=await call('/api/risk/live?id='+id,mine);assert.equal(live.status,200);assert(live.data.cases.length>0);assert(live.data.cases.every(c=>c.gpsno===driver.gpsno&&!c.shadow));assert(live.data.cases.every(c=>c.evidence.every(e=>e.event_time<=next.data.clock)));assert.equal(live.data.terminal_channel,'not_connected');assert(live.data.cases.every(c=>c.delivery.status==='platform_received'));
 const c=live.data.cases[0];assert.equal((await call('/api/risk/feedback',mine,{case_id:c.id,feedback:'test'})).status,409);for(const [status,decision] of [['confirmed','confirm'],['duplicate','false_alarm'],['supplement_data','insufficient']]){const reviewed=await call(`/api/alerts/${c.id}/status`,admin,{status},'PATCH');assert.equal(reviewed.status,200,JSON.stringify(reviewed.data));assert.equal(db.prepare('SELECT review_decision FROM risk_cases WHERE id=?').get(c.id).review_decision,decision);}
 assert.equal((await call(`/api/alerts/${c.id}/status`,mine,{status:'confirmed'},'PATCH')).status,403);
 const archive=await call('/api/cases/'+c.id,admin);assert.equal(archive.status,200);for(const action of ['risk.case_confirm','risk.case_false_alarm','risk.case_insufficient'])assert(archive.data.timeline.some(e=>e.action===action),action+' missing in archive timeline');
 assert.equal((await call('/api/risk/control',admin,{id,action:'parking',parking:true})).status,200);assert.equal((await call('/api/risk/feedback',mine,{case_id:c.id,feedback:'隔离副本停车反馈'})).status,200);assert.equal(db.prepare('SELECT feedback FROM risk_cases WHERE id=?').get(c.id).feedback,'隔离副本停车反馈');
 assert.equal((await call('/api/risk/actionPreview',mine,{case_id:c.id,actions:['message'],note:'越权伪造',actor:{id:'qa-risk-admin'}})).status,403);
 assert.equal((await call('/api/risk/handle',admin,{case_id:c.id,decision:'confirm',note:'隔离副本人工核查确认'})).status,200);
 const plan=await call('/api/risk/actionPreview',admin,{case_id:c.id,actions:['message','followup'],note:'隔离副本：发送停车后复盘提醒并安排回访。',due_at:'2099-01-01'});assert.equal(plan.status,200,JSON.stringify(plan.data));
 const executed=await call('/api/risk/actionApply',admin,{id:plan.data.id,confirm:true});assert.equal(executed.status,200,JSON.stringify(executed.data));assert.equal(db.prepare('SELECT recipient FROM chat_messages WHERE id=?').get(executed.data.message_id).recipient,driver.user_id);assert.equal((await call('/api/risk/actionApply',admin,{id:plan.data.id,confirm:true})).data.idempotent_replay,true);
 const updated=await call('/api/risk/live?id='+id,admin);assert(updated.data.cases.find(x=>x.id===c.id).action_state.followups.length);assert((await call('/api/center/data',admin)).data.todos.some(x=>x.kind==='followup'&&x.route.includes(c.id)));assert.equal((await call('/api/risk/handle',admin,{case_id:c.id,decision:'close',note:'尚未落实'})).data.error,'risk_actions_pending');
 const tasksBefore=db.prepare('SELECT count(*) n FROM training_tasks').get().n;
 assert.equal((await call('/api/ai/case-training',mine,{case_id:c.id})).status,403);
 const proposal=await call('/api/ai/case-training',admin,{case_id:c.id});assert.equal(proposal.status,200,JSON.stringify(proposal.data));assert.equal(proposal.data.status,'draft');assert.equal(proposal.data.data.ai_generated,false);assert(proposal.data.data.evidence.length>0);assert.equal(db.prepare('SELECT count(*) n FROM training_tasks').get().n,tasksBefore);
 assert.equal((await call('/api/chat/contexts?peer='+driver.user_id,admin)).status,200);const chat=await call('/api/chat/messages?peer='+driver.user_id,admin);assert(chat.data.messages.some(m=>m.reference?.case_id===c.id));
 // Complete a real HTTP learning flow only in the isolated database copy.
 db.exec("INSERT INTO training_courses(course_id,title,content,content_status) VALUES('QA-PERSONAL','个性化情境练习','辨别分心信号，安全停车后回复。','approved')");
 db.prepare("INSERT INTO training_tasks(task_id,driver_id,alert_id,course_id,status,created_by,updated_at) VALUES('qa-personal-task',?,?,'QA-PERSONAL','in_progress','qa-risk-admin',?)").run(driver.driver_id,c.id,new Date().toISOString());
 const learning={kind:'personal_course',response:'驾驶中不回应手机信息，选择安全地点停车后再处理',reflection:'在驾驶过程中，如果调度消息和导航提醒同时出现，我可能因急于回复而分散注意力，增加观察遗漏与反应延迟的风险。以后出车前设置导航和免打扰，提醒调度集中沟通，行驶中不碰手机，选择合适位置安全停车后再处理，并在一周后复查落实情况。',action_plan:'每次出车前设置导航与免打扰，停车后再处理调度消息'};
 const submitted=await call('/api/training-tasks/qa-personal-task/submit',mine,{learning_record:JSON.stringify(learning)});assert.equal(submitted.status,200,JSON.stringify(submitted.data));assert.equal((await call('/api/training-tasks/qa-personal-task/submit',mine,{})).data.idempotent_replay,true);
 const completion=await call('/api/chat/messages?peer='+driver.user_id,admin),completed=completion.data.messages.filter(m=>m.reference?.task_id==='qa-personal-task');assert.equal(completed.length,1);assert.equal(completed[0].reference.case_id,c.id);assert.equal(completed[0].read_at,null);assert(completed[0].content.includes('请验收'));assert((await call('/api/chat/contacts',admin)).data.unread>0);
 assert.equal((await call('/api/chat/read',admin,{peer:driver.user_id,through:completed[0].seq})).status,200);const receipt=await call('/api/chat/messages?peer=qa-risk-admin',mine);assert(receipt.data.messages.find(m=>m.id===completed[0].id).read_at);
 assert.equal((await call('/api/risk/actionComplete',admin,{case_id:c.id,followup_id:executed.data.followup_ids[0],note:'隔离副本跟进结果已核验'})).status,200);
 }finally{if(child&&child.exitCode===null){const done=once(child,'exit');child.kill();await done}if(gateway)await gateway.close();db?.close();const target=resolve(folder),parent=resolve(tmpdir());if(target.startsWith(parent+'\\')||target.startsWith(parent+'/'))await rm(target,{recursive:true,force:true})}
});
