// Explicit optional smoke test: calls the configured model; business data is a copy.
import {DatabaseSync,backup} from 'node:sqlite';
import {randomBytes} from 'node:crypto';
const testPassword=randomBytes(24).toString('base64url');
import {mkdtemp,rm} from 'node:fs/promises';
import {join,resolve,dirname,basename} from 'node:path';
import {tmpdir} from 'node:os';
import {createServer} from 'node:net';
import {spawn} from 'node:child_process';
import {once} from 'node:events';
import {fileURLToPath} from 'node:url';
import assert from 'node:assert/strict';
import {startLocalDatabase} from '../server/local-database.mjs';
import {passwordHash} from '../tests/fixtures/account-db.mjs';
const root=new URL('../',import.meta.url);process.loadEnvFile(fileURLToPath(new URL('.env.local',root)));
const dir=await mkdtemp(join(tmpdir(),'ie-agent-live-')),path=join(dir,'copy.sqlite');
const source=new DatabaseSync(fileURLToPath(new URL('var/platform.sqlite',root)),{readOnly:true});await backup(source,path);source.close();const db=new DatabaseSync(path);
const target=db.prepare("SELECT driver_id FROM score_snapshots WHERE risk_level='D' AND confidence_level!='low' AND driver_id NOT IN(SELECT driver_id FROM app_users WHERE driver_id IS NOT NULL) LIMIT 1").get();
for(const [name,role,driver] of [['live-admin','safety_admin',null],['live-driver','driver',target.driver_id]])db.prepare('INSERT INTO app_users(user_id,username,role,fleet_scope,password_hash,account_status,must_change_password,driver_id,binding_verified) VALUES(?,?,?,?,?,?,0,?,1)').run(name,name,role,'*',passwordHash(testPassword),'active',driver);
db.prepare("UPDATE training_courses SET content_status='approved' WHERE course_id='C01'").run();
const gateway=await startLocalDatabase({path,manifestPath:new URL('var/data-manifest.json',root)});const socket=createServer();await new Promise(r=>socket.listen(0,'127.0.0.1',r));const port=socket.address().port;await new Promise(r=>socket.close(r));
const child=spawn(process.execPath,['server.mjs'],{cwd:root,windowsHide:true,env:{...process.env,HOST:'127.0.0.1',PORT:String(port),APP_DATA_MODE:'full',SUPABASE_URL:gateway.url,SUPABASE_ANON_KEY:gateway.token,SUPABASE_INSTANCE_ID:'agent-live-qa'},stdio:'ignore'});const base='http://127.0.0.1:'+port;let cookie;
async function call(path,body){const r=await fetch(base+path,{method:'POST',headers:{'content-type':'application/json',...(cookie?{cookie}:{})},body:JSON.stringify(body),signal:AbortSignal.timeout(55000)});return {status:r.status,data:await r.json(),cookie:r.headers.get('set-cookie')?.split(';')[0]};}
const tables=['app_users','training_tasks','training_courses','notification_events','score_snapshots'];const counts=()=>JSON.stringify(tables.map(t=>db.prepare('SELECT count(*) n FROM '+t).get().n));
try{
 for(let i=0;i<100;i++){try{if((await fetch(base+'/healthz')).ok)break;}catch{}await new Promise(r=>setTimeout(r,50));}
 cookie=(await call('/api/auth/login',{username:'live-admin',password:testPassword})).cookie;const before=counts();
 const upload=await call('/api/agent/accounts/preview',{rows:[{username:'private-excel-user-qa',display_name:'仅测试的表格姓名',role:'driver'}]});assert.equal(upload.status,200);
 const checks=[
  {name:'scoped_analysis',text:'请调用analyze_fleet_data分析D级车辆的平均分、数量和主要扣分维度，简要回答。',verify:r=>assert.equal(r.meta.skill,'weekly-fleet-report')},
  {name:'training_course_draft',text:'请调用prepare_training_course创建一门疲劳驾驶课程草稿，标题为疲劳识别，维度fatigue_distraction，内容为停车后学习识别疲劳并制定休息计划，完成条件是提交行动计划。只生成待确认清单。',verify:r=>assert.ok(r.action_plans?.some(x=>x.kind==='course'))},
  {name:'training_tasks',text:'请先查课程，再调用prepare_training_batch，为D级车辆准备C01培训任务，七天后截止，不要执行。',verify:r=>assert.ok(r.action_plans?.some(x=>x.kind==='training'))},
  {name:'account_import_tool',text:`请调用prepare_account_import检查Excel账号导入批次 ${upload.data.id}，只准备待确认清单，不要创建。`,verify:r=>assert.ok(r.action_plans?.some(x=>x.kind==='accounts'))}
 ];
 for(const c of checks){const start=Date.now(),r=await call('/api/ai/chat',{page:'sm-accounts',client_request_id:'live-'+c.name+'-'+Date.now(),messages:[{role:'user',content:c.text}]});assert.equal(r.status,200,c.name+':'+r.data.error);assert.equal(r.data.meta.model,process.env.QW_AI_MODEL||'qwen3.8-max');c.verify(r.data);assert.equal(counts(),before);console.log(JSON.stringify({check:c.name,ok:true,model:r.data.meta.model,tools:r.data.meta.tool_calls,seconds:Math.round((Date.now()-start)/10)/100,plans:r.data.action_plans?.map(x=>({kind:x.kind,count:x.count})),business_unchanged:true}));}
}finally{const stopped=once(child,'exit');child.kill();await stopped;await gateway.close();db.close();assert.equal(dirname(resolve(dir)),resolve(tmpdir()));assert.ok(basename(dir).startsWith('ie-agent-live-'));await rm(dir,{recursive:true,force:true});}
