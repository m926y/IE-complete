import test from 'node:test';import assert from 'node:assert/strict';import {spawn} from 'node:child_process';import {createServer} from 'node:net';import {once} from 'node:events';import {mkdtemp,rm} from 'node:fs/promises';import {tmpdir} from 'node:os';import {join} from 'node:path';import {startFixtureDatabase} from './fixtures/account-db.mjs';
test('Course authoring, private attachments and mixed driver assessment',async t=>{
 const fixture=await startFixtureDatabase(),db=fixture.tables,temp=await mkdtemp(join(tmpdir(),'learning-assets-'));
 db.score_snapshots.push({driver_id:'driver-one',score_id:'custom-score',risk_level:'C',confidence_level:'high',source_version:'v1'});
 const listener=createServer();await new Promise(r=>listener.listen(0,'127.0.0.1',r));const port=listener.address().port;await new Promise(r=>listener.close(r));
 const child=spawn(process.execPath,['server.mjs'],{cwd:new URL('../',import.meta.url),windowsHide:true,env:{...process.env,HOST:'127.0.0.1',PORT:String(port),SUPABASE_URL:fixture.url,SUPABASE_ANON_KEY:'fixture',SUPABASE_INSTANCE_ID:'fixture',LEARNING_ASSET_DIR:temp,QW_AI_API_KEY:'',QWEN_API_KEY:'',OPENAI_API_KEY:''},stdio:['ignore','pipe','pipe']});let output='';child.stderr.on('data',b=>output+=b);
 const base=`http://127.0.0.1:${port}`;async function call(path,cookie,body,method){const r=await fetch(base+path,{method:method||(body===undefined?'GET':'POST'),headers:{'content-type':'application/json',...cookie?{cookie}:{}},...body===undefined?{}:{body:JSON.stringify(body)}});return {status:r.status,data:await r.json(),cookie:r.headers.get('set-cookie')?.split(';')[0]}}
 try{
  for(let i=0;i<100;i++){try{if((await fetch(base+'/healthz')).ok)break}catch{}await new Promise(r=>setTimeout(r,40));if(i===99)throw Error(output)}
  const admin=(await call('/api/auth/login',null,{username:'preview_admin',password:'PreviewAdmin2026'})).cookie,driver=(await call('/api/auth/login',null,{username:'preview_driver',password:'PreviewDriver2026'})).cookie;
  let asset;
  await t.test('Staff upload accepts document and range reads; driver upload is refused',async()=>{
   let r=await fetch(base+'/api/learning-assets',{method:'POST',headers:{cookie:admin,'x-file-name':encodeURIComponent('安全资料.md'),'content-type':'application/octet-stream'},body:'# 安全停车\n停车后再查看消息。'});assert.equal(r.status,201);asset=await r.json();assert.match(asset.text,/安全停车/);
   assert.equal((await fetch(base+asset.url)).status,401);assert.equal((await fetch(base+asset.url,{headers:{cookie:driver}})).status,403);
   r=await fetch(base+asset.url,{headers:{cookie:admin,range:'bytes=0-5'}});assert.equal(r.status,206);assert.equal((await r.arrayBuffer()).byteLength,6);
   assert.equal((await fetch(base+'/api/learning-assets',{method:'POST',headers:{cookie:driver,'x-file-name':'x.md'},body:'x'})).status,403);
  });
  const pack={kind:'editable_course_v1',text:'安全驾驶',video:'',questions:[{type:'single',title:'何时查看消息',options:['驾驶中','停车后'],answer:[1],explain:'停车后操作'},{type:'text',title:'写出操作步骤',options:[],answer:[],reference:'安全停车，查看消息'}]};
  await t.test('Create, validate and review mixed course; unaudited course is never approved implicitly',async()=>{
   const r=await call('/api/admin/course-draft',admin,{action:'create',course_id:'UC_QA001',title:'视频与混合题培训',content:JSON.stringify(pack)});assert.equal(r.status,201);assert.equal(db.training_courses.find(c=>c.course_id==='UC_QA001').content_status,'draft');
   for(const status of ['pending_review','approved'])assert.equal((await call('/api/admin/course-review',admin,{course_id:'UC_QA001',new_status:status})).status,200);
   assert.equal((await call('/api/admin/course-draft',driver,{action:'create'})).status,403);
   assert.equal((await call('/api/admin/course-draft',admin,{action:'create',course_id:'UC_BAD001',title:'bad',content:JSON.stringify({...pack,questions:[{...pack.questions[0],answer:[8]}]})})).status,400);
  });
  const snapshot={course_id:'UC_QA001',title:'混合题培训',content:JSON.stringify(pack),content_status:'approved'};
  db.training_tasks.push({task_id:'custom-qa-task',course_id:'UC_QA001',driver_id:'driver-one',status:'assigned',course_snapshot:JSON.stringify(snapshot),updated_at:'2026-01-01T00:00:00Z',created_by:'preview-admin'});
  let version;
  await t.test('Assigned driver sees questions without answer keys; submits only complete responses and server computes grades',async()=>{
   let r=await call('/api/training-tasks/custom-qa-task/custom-learning',driver);assert.equal(r.status,200);assert.equal(r.data.course.questions[0].answer,undefined);assert.equal(r.data.course.questions[1].reference,undefined);version=r.data.updated_at;
   r=await call('/api/training-tasks/custom-qa-task/custom-learning',driver,{action:'submit',reading_ack:true,answers:{0:[1],1:''},expected_updated_at:version});assert.equal(r.data.error,'answer_required');
   r=await call('/api/training-tasks/custom-qa-task/custom-learning',driver,{action:'draft',answers:{0:[1],1:'先安全停车，再处理消息。'},expected_updated_at:version});assert.equal(r.status,200);version=r.data.updated_at;
   r=await call('/api/training-tasks/custom-qa-task/custom-learning',driver,{action:'submit',reading_ack:true,answers:{0:[1],1:'先安全停车，再处理消息。'},score:0,expected_updated_at:version});assert.equal(r.status,200);assert.equal(r.data.record.score,100);assert.equal(r.data.record.manual_count,1);assert.equal(r.data.status,'submitted');
   assert.equal((await call('/api/training-tasks/custom-qa-task/custom-learning',driver,{action:'draft',answers:{}})).status,409);
   r=await call('/api/training-tasks/custom-qa-task/custom-learning',admin);assert.equal(r.data.course.questions[1].reference,'安全停车，查看消息');
   assert.equal((await call('/api/training-tasks/custom-qa-task/review',admin,{decision:'approved',reason:'已核对选择题与问答内容'})).status,200);
  });
 }finally{const done=once(child,'exit');child.kill();await done;await fixture.close();await rm(temp,{recursive:true,force:true})}
});
