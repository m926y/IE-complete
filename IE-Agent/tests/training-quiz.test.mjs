import test from 'node:test';
import assert from 'node:assert/strict';
import {spawn} from 'node:child_process';
import {createServer} from 'node:net';
import {once} from 'node:events';
import {startFixtureDatabase} from './fixtures/account-db.mjs';
test('Interactive courses: approval, scoped multi-driver assignment, durable server grading and task review',async t=>{
 const fixture=await startFixtureDatabase(),db=fixture.tables;
 db.app_users.push({...db.app_users[0],user_id:'test-officer',username:'test_officer',role:'safety_officer'});
 db.score_snapshots.push(...['driver-one','driver-two','driver-three'].map((driver_id,i)=>({driver_id,score_id:'qa-score-'+i,risk_level:i===0?'C':'D',confidence_level:'high',source_version:'qa-v1'})));
 db.app_users.push({...db.app_users[1],user_id:'second-driver',username:'driver_two',driver_id:'driver-two',fleet_scope:'fleet-two'});
 db.app_users.push({...db.app_users[1],user_id:'unverified-driver',username:'unverified',driver_id:'driver-three',binding_verified:false});
 db.app_users.push({...db.app_users[0],user_id:'scoped-admin',username:'scoped',fleet_scope:'fleet-one'});
 db.drivers.push({driver_id:'driver-three',gpsno:'TEST-VEHICLE-RAW-03',fleet_id:'fleet-one'});
 const net=createServer();await new Promise(r=>net.listen(0,'127.0.0.1',r));const port=net.address().port;await new Promise(r=>net.close(r));
 let child,output='';async function boot(){child=spawn(process.execPath,['server.mjs'],{cwd:new URL('../',import.meta.url),windowsHide:true,env:{...process.env,HOST:'127.0.0.1',PORT:String(port),SUPABASE_URL:fixture.url,SUPABASE_ANON_KEY:'fixture',SUPABASE_INSTANCE_ID:'fixture'},stdio:['ignore','pipe','pipe']});child.stderr.on('data',b=>output+=b);for(let i=0;i<100;i++){try{if((await fetch(`http://127.0.0.1:${port}/healthz`)).ok)return}catch{}await new Promise(r=>setTimeout(r,40))}throw Error(output)}
 async function stop(){const done=once(child,'exit');child.kill();await done}
 async function call(path,cookie,body,method){const r=await fetch(`http://127.0.0.1:${port}${path}`,{method:method||(body===undefined?'GET':'POST'),headers:{'content-type':'application/json',...(cookie?{cookie}:{})},...(body===undefined?{}:{body:JSON.stringify(body)})});return {status:r.status,data:await r.json(),cookie:r.headers.get('set-cookie')?.split(';')[0]}}
 const login=async name=>(await call('/api/auth/login',null,{username:name,password:name==='preview_admin'||name==='scoped'?'PreviewAdmin2026':'PreviewDriver2026'})).cookie;
 let admin,driver,second,scoped,unverified,library,task1,task2;
 const reflection='在驾驶过程中，如果调度消息和导航提醒同时出现，我可能因急于回复而分散注意力，增加观察遗漏与反应延迟的风险。以后出车前设置导航和免打扰，提醒调度集中沟通，行驶中不碰手机，选择合适位置安全停车后再处理，并在一周后复查落实情况。';
 const batch={course_id:'XA_M01',driver_ids:['driver-one','driver-two','driver-three'],due_at:'2099-12-31',batch_id:'test-batch-000000000001'};
 try{await boot();admin=await login('preview_admin');driver=await login('preview_driver');second=await login('driver_two');scoped=await login('scoped');unverified=await login('unverified');
 await t.test('Authentication and roles protect catalog, install and batch endpoints',async()=>{assert.equal((await call('/api/training-library')).status,401);assert.equal((await call('/api/training-library',driver)).status,403);for(const p of ['/api/admin/training-library/install','/api/admin/training-library/assign'])assert.equal((await call(p,driver,{})).status,403);library=(await call('/api/training-library',admin)).data;assert.equal(library.courses.length,17);assert.equal(library.courses.flatMap(c=>c.questions).length,86)});
 await t.test('Installing all 17 legacy and reading courses is explicit, idempotent and never approves or assigns',async()=>{for(const c of library.courses){let a=await call('/api/admin/training-library/install',admin,{course_id:c.course_id});assert.equal(a.status,200);assert.equal((await call('/api/admin/training-library/install',admin,{course_id:c.course_id})).data.idempotent_replay,true)}assert.equal(db.training_courses.length,17);assert(db.training_courses.every(c=>c.content_status==='draft'));assert.equal(db.training_tasks?.length||0,0);assert(!db.training_courses.some(c=>c.content.includes('正确答案')))});
 await t.test('Unapproved course assignment is refused without tasks; human approval state machine remains required',async()=>{let r=await call('/api/admin/training-library/assign',admin,batch);assert.equal(r.data.assigned,0);assert.equal(db.training_tasks?.length||0,0);for(const status of ['pending_review','approved'])assert.equal((await call('/api/admin/course-review',admin,{course_id:'XA_M01',new_status:status})).status,200)});
 await t.test('Out-of-scope target rejects entire selection before writes',async()=>{const n=db.training_tasks?.length||0;assert.equal((await call('/api/admin/training-library/assign',scoped,batch)).status,404);assert.equal(db.training_tasks?.length||0,n)});
 await t.test('Batch distributes to distinct verified drivers, reports unverified driver, and retry does not duplicate tasks/notices',async()=>{let r=await call('/api/admin/training-library/assign',admin,batch);assert.equal(r.status,200);assert.equal(r.data.assigned,2);assert.equal(r.data.failed,1);assert.equal(db.training_tasks.length,2);assert.equal(db.notification_events.length,2);task1=r.data.results.find(x=>x.driver_id==='driver-one').task_id;task2=r.data.results.find(x=>x.driver_id==='driver-two').task_id;let again=await call('/api/admin/training-library/assign',admin,batch);assert.equal(again.data.assigned,2);assert(again.data.results.filter(x=>x.ok).every(x=>x.idempotent_replay));assert.equal(db.training_tasks.length,2);assert.equal(db.notification_events.length,2);await Promise.all([call('/api/admin/training-library/assign',admin,batch),call('/api/admin/training-library/assign',admin,batch)]);assert.equal(db.training_tasks.length,2);assert.equal(db.notification_events.length,2)});
 await t.test('Notification failure reports the created task and retry repairs delivery without duplicating it',async()=>{const notices=db.notification_events;db.notification_events=Object.freeze([]);const b={...batch,driver_ids:['driver-one'],batch_id:'notification-retry-000001'};const before=db.training_tasks.length;let r=await call('/api/admin/training-library/assign',admin,b);assert.equal(r.data.results[0].warning,'notification_pending');assert.equal(r.data.assigned,1);assert.equal(db.training_tasks.length,before+1);db.notification_events=notices;r=await call('/api/admin/training-library/assign',admin,b);assert.equal(r.data.results[0].idempotent_replay,true);assert.equal(db.training_tasks.length,before+1);assert.equal(db.notification_events.length,3)});
 await t.test('A colliding registered course version is never overwritten or distributed',async()=>{const c=db.training_courses.find(c=>c.course_id==='XA_M02'),old=c.source_version;c.source_version='other-content';assert.equal((await call('/api/admin/training-library/install',admin,{course_id:c.course_id})).data.error,'quiz_course_version_conflict');assert.equal((await call('/api/training-library',admin)).data.courses.find(x=>x.course_id===c.course_id).content_status,'version_conflict');assert.equal(c.source_version,'other-content');c.source_version=old});
 await t.test('New lesson is visible only to its intended driver, with unsolved keys and explanations hidden',async()=>{assert.equal((await call(`/api/training-tasks/${task1}/quiz`,second)).status,404);assert.equal((await call(`/api/training-tasks/${task1}/quiz`,unverified)).status,403);assert.equal((await call(`/api/training-tasks/${task2}/quiz`,scoped)).status,404);const r=await call(`/api/training-tasks/${task1}/quiz`,driver);assert.equal(r.status,200);assert(r.data.questions.every(q=>!('answer'in q)&&!('explain'in q)));assert.equal(r.data.answered,0);assert.equal((await call(`/api/training-tasks/${task1}/quiz-answer`,admin,{question_id:0,selected:[1]})).status,403)});
 await t.test('Custom courses require a scenario answer, personal reflection and action; other drivers cannot read them',async()=>{
 db.training_courses.push({course_id:'CUSTOM-1',title:'案卷专题',content:'请先核验分心场景，再制定停车沟通计划。',content_status:'approved'});db.training_tasks.push({task_id:'custom-task',course_id:'CUSTOM-1',driver_id:'driver-one',status:'in_progress',created_by:'preview-admin'});
 let v=await call('/api/training-tasks/custom-task/personal-learning',driver);assert.equal(v.status,200);assert(v.data.personal_question.prompt);assert.equal((await call('/api/training-tasks/custom-task/personal-learning',second)).status,404);
 const path='/api/training-tasks/custom-task/submit';assert.equal((await call(path,driver,{learning_record:'看完了'})).data.error,'personal_response_required');const record={kind:'personal_course',response:'安全停车之后回复调度消息，驾驶中不操作手机',action_plan:'每次出车之前设置好手机与导航，停车后再交流',reflection:'过短'};assert.equal((await call(path,driver,{learning_record:JSON.stringify(record)})).data.error,'quiz_reflection_required');record.reflection=reflection;v=await call(path,driver,{learning_record:JSON.stringify(record)});assert.equal(v.status,200);const saved=JSON.parse(db.training_tasks.find(x=>x.task_id==='custom-task').learning_record);assert.equal(saved.reflection,reflection);assert(saved.completed_at);assert(saved.personal_question);assert.equal((await call(path,driver,{})).data.idempotent_replay,true);
 });
 await t.test('Legacy record and submission APIs cannot forge a quiz grade or erase answer state',async()=>{for(const [path,method] of [['draft','PATCH'],['submit','POST']])assert.equal((await call(`/api/training-tasks/${task1}/${path}`,driver,{learning_record:'100分',score:100},method)).data.error,'interactive_course_use_quiz');assert.equal((await call(`/api/training-tasks/${task1}/quiz-finish`,driver,{})).status,409)});
 await t.test('Answers must be valid and sequential; server ignores fabricated score and persists only first submission',async()=>{const path=`/api/training-tasks/${task1}/quiz-answer`;assert.equal((await call(path,driver,{question_id:1,selected:[2]})).status,409);for(const selected of [[],[4],[1,1],[1,2]])assert.equal((await call(path,driver,{question_id:0,selected})).status,400);const r=await call(path,driver,{question_id:0,selected:[1],score:0,correct:false});assert.equal(r.data.score,25);assert.equal(r.data.questions[0].correct,true);assert(!('answer'in r.data.questions[1]));const repeat=await call(path,driver,{question_id:0,selected:[0],score:100});assert.equal(repeat.data.idempotent_replay,true);assert.deepEqual(repeat.data.questions[0].selected,[1]);assert.equal(repeat.data.score,25)});
 await t.test('Server restart restores progress from database and does not expose future keys',async()=>{await stop();await boot();const r=await call(`/api/training-tasks/${task1}/quiz`,driver);assert.equal(r.data.answered,1);assert.equal(r.data.score,25);assert(!('answer'in r.data.questions[1]))});
 await t.test('Concurrent duplicate submissions cannot overwrite or double-count',async()=>{const p=`/api/training-tasks/${task1}/quiz-answer`;const r=await Promise.all([call(p,driver,{question_id:1,selected:[2]}),call(p,driver,{question_id:1,selected:[0]})]);assert(r.every(x=>x.status===200));const state=(await call(`/api/training-tasks/${task1}/quiz`,driver)).data;assert.equal(state.answered,2);assert.equal(r.filter(x=>x.data.idempotent_replay).length,1);assert.equal(state.questions[1].selected.length,1)});
 await t.test('Multi-select partial answer earns zero; total is server-calculated and submission is immutable',async()=>{const c=library.courses.find(c=>c.course_id==='XA_M01');await call(`/api/training-tasks/${task1}/quiz-answer`,driver,{question_id:2,selected:c.questions[2].answer});let a=await call(`/api/training-tasks/${task1}/quiz-answer`,driver,{question_id:3,selected:[0]});assert.equal(a.data.questions[3].correct,false);const before=a.data.score;assert.equal((await call(`/api/training-tasks/${task1}/quiz-finish`,driver,{reflection:'太短'})).data.error,'quiz_reflection_required');assert.equal((await call(`/api/training-tasks/${task1}/quiz-finish`,driver,{reflection:'字'.repeat(181)})).data.error,'quiz_reflection_required');let r=await call(`/api/training-tasks/${task1}/quiz-finish`,driver,{score:100,reflection});assert.equal(r.data.score,before);assert.equal(r.data.completed,true);assert.equal(r.data.reflection,reflection);assert(r.data.personal_question);assert.equal(r.data.passed,false);assert.equal(r.data.status,'submitted');assert.equal((await call(`/api/training-tasks/${task1}/quiz-finish`,driver,{})).data.idempotent_replay,true);assert.equal(db.notification_events.filter(n=>n.type==='task_submitted'&&n.source_entity_id===task1).length,1);assert.equal((await call(`/api/training-tasks/${task1}/quiz-answer`,driver,{question_id:3,selected:[0,1,2]})).data.score,before)});
 await t.test('Admin can inspect grade, review through existing workflow, while other driver progress stays empty',async()=>{assert.equal((await call(`/api/training-tasks/${task1}/review`,driver,{decision:'approved',reason:'self-approve'})).status,403);assert.equal((await call(`/api/training-tasks/${task2}/review`,scoped,{decision:'approved',reason:'out-of-scope'})).status,404);const r=await call(`/api/training-tasks/${task1}/quiz`,admin);assert.equal(r.data.completed,true);assert.equal(r.data.reflection,reflection);assert(r.data.personal_question);assert.equal((await call(`/api/training-tasks/${task1}/review`,admin,{decision:'approved',reason:'已核对课程答题和错题解析'})).status,200);assert.equal((await call(`/api/training-tasks/${task2}/quiz`,second)).data.answered,0);assert.equal((await call(`/api/training-tasks/${task1}/quiz`,driver)).data.status,'reviewed');assert.equal(db.score_snapshots.length,3);assert.equal(db.score_history.length,0)});
 await t.test('Reading-course bank preserves six-question version and rejects A/B assignments across the legacy endpoint',async()=>{
  for(const status of ['pending_review','approved'])assert.equal((await call('/api/admin/course-review',admin,{course_id:'XA_T03',new_status:status})).status,200);
  const r=await call('/api/admin/training-library/assign',admin,{...batch,course_id:'XA_T03',driver_ids:['driver-one'],batch_id:'reading-bank-test-00001'});assert.equal(r.data.assigned,1);const id=r.data.results[0].task_id;
  let view=(await call(`/api/training-tasks/${id}/quiz`,driver)).data;assert.equal(view.total,6);assert(view.reading.length>0);assert.equal(view.version,'tiered-reading-v1-20261029');assert(view.questions.every(q=>!q.answer));
  const course=library.courses.find(c=>c.course_id==='XA_T03');for(const [index,q] of course.questions.entries())assert.equal((await call(`/api/training-tasks/${id}/quiz-answer`,driver,{question_id:index,selected:q.answer})).status,200);
  view=(await call(`/api/training-tasks/${id}/quiz-finish`,driver,{reflection,reading_ack:true,action_plan:'停车后检查任务安排，开车前设置导航，驾驶中不操作手机。'})).data;assert.equal(view.score,100);assert(view.completed);assert.equal(JSON.parse(db.training_tasks.find(t=>t.task_id===id).learning_record).version,'tiered-reading-v1-20261029');
  const sc=db.score_snapshots.find(s=>s.driver_id==='driver-one');sc.risk_level='A';const denied=await call('/api/admin/training-library/assign',admin,{...batch,driver_ids:['driver-one'],course_id:'XA_T03',batch_id:'ab-rejected-000001'});assert.equal(denied.data.assigned,0);assert.equal(denied.data.results[0].error,'training_cd_only');assert.equal((await call(`/api/training-tasks/${id}/quiz`,driver)).data.score,100);sc.risk_level='C';
 });
 await t.test('Reading closure requires action plan, rejects failed approval, archives retry and notifies review',async()=>{
 const result=await call('/api/admin/training-library/assign',admin,{...batch,course_id:'XA_T03',driver_ids:['driver-one'],batch_id:'rollout-remediation-001'}),id=result.data.results[0].task_id,course=library.courses.find(c=>c.course_id==='XA_T03');
 for(const [index,q] of course.questions.entries())assert.equal((await call(`/api/training-tasks/${id}/quiz-answer`,driver,{question_id:index,selected:[q.options.findIndex((_,j)=>!q.answer.includes(j))]})).status,200);
 assert.equal((await call(`/api/training-tasks/${id}/quiz-finish`,driver,{})).data.error,'quiz_reading_action_required');
 const body={reflection,reading_ack:true,action_plan:'在停车后处理手机消息，出车前完成导航和任务设置。'};
 assert.equal((await call(`/api/training-tasks/${id}/quiz-finish`,driver,body)).status,200);
 assert.equal((await call(`/api/training-tasks/${id}/review`,admin,{decision:'approved',reason:'不能以低分通过'})).data.error,'quiz_remediation_required');
 assert.equal((await call(`/api/training-tasks/${id}/review`,admin,{decision:'returned',reason:'复习错题，完善个人行动措施'})).status,200);
 assert.equal((await call(`/api/training-tasks/${id}/quiz-retry`,admin,{})).status,403);
 const retry=await call(`/api/training-tasks/${id}/quiz-retry`,driver,{});assert.equal(retry.status,200);assert.equal(retry.data.previous_attempts.length,1);assert.equal(retry.data.previous_attempts[0].score,0);assert.equal(retry.data.answered,0);
 for(const [index,q] of course.questions.entries())await call(`/api/training-tasks/${id}/quiz-answer`,driver,{question_id:index,selected:q.answer});
 assert.equal((await call(`/api/training-tasks/${id}/quiz-finish`,driver,body)).data.score,100);
 assert.equal((await call(`/api/training-tasks/${id}/review`,admin,{decision:'approved',reason:'核对阅读确认、逐题答案和行动计划后通过'})).status,200);
 const v=(await call(`/api/training-tasks/${id}/quiz`,driver)).data;assert.equal(v.status,'reviewed');assert.equal(v.previous_attempts.length,1);assert.equal(v.action_plan,body.action_plan);assert(db.notification_events.some(n=>n.source_entity_id===id&&n.type==='task_reviewed'));
 });
 await t.test('Officers cannot delete other creators tasks or courses and groups; denials do not write',async()=>{
 const officer=(await call('/api/auth/login',null,{username:'test_officer',password:'PreviewAdmin2026'})).cookie;
 assert(officer);
 const task=db.training_tasks.find(x=>x.status!=='deleted');const status=task.status;
 const before=JSON.stringify({tasks:db.training_tasks,courses:db.training_courses,config:db.operation_config,audit:db.audit_logs});
 for(const [path,body] of [[`/api/training-tasks/${task.task_id}/delete`,{}],['/api/training-tasks/batch-delete',{tasks:[{task_id:task.task_id,expected_updated_at:task.updated_at||null}]}],['/api/courses/XA_M01/delete',{}],['/api/course-groups',{action:'delete',id:'training_group_test'}]])assert.equal((await call(path,officer,body)).status,403,path);
 assert.equal(task.status,status);assert.equal(JSON.stringify({tasks:db.training_tasks,courses:db.training_courses,config:db.operation_config,audit:db.audit_logs}),before);
 });
 await t.test('Officer can delete own tasks only; mixed batch is rejected before any write',async()=>{
 const officer=(await call('/api/auth/login',null,{username:'test_officer',password:'PreviewAdmin2026'})).cookie;
 const tasks=['officer-single','officer-batch','other-officer','unknown-creator'].map((task_id,i)=>({task_id,driver_id:'driver-one',course_id:'XA_M01',status:i===0?'reviewed':'assigned',created_by:i<2?'test-officer':i===2?'someone-else':null,learning_record:'retain-learning',updated_at:'2026-11-03T00:00:00.000Z'}));db.training_tasks.push(...tasks);
 const selection=ids=>({tasks:ids.map(i=>({task_id:tasks[i].task_id,expected_updated_at:tasks[i].updated_at}))});
 for(const i of [2,3])assert.equal((await call(`/api/training-tasks/${tasks[i].task_id}/delete`,officer,{})).status,403);
 assert.equal((await call('/api/training-tasks/batch-delete',officer,selection([1,2]))).status,403);
 assert.equal((await call('/api/training-tasks/batch-delete',officer,selection([1,3]))).status,403);
 assert(tasks.every(x=>x.status!=='deleted'));
 assert.equal((await call(`/api/training-tasks/${tasks[0].task_id}/delete`,officer,{})).status,200);
 assert.equal((await call('/api/training-tasks/batch-delete',officer,selection([1]))).status,200);
 for(const task of tasks.slice(0,2)){assert.equal(task.status,'deleted');assert.equal(task.learning_record,'retain-learning');assert(db.audit_logs.some(x=>x.entity_id===task.task_id&&x.actor_id==='test-officer'&&x.action==='training.delete'))}
 });
 await t.test('Task deletion is scoped, preserves learning records and removes both role lists',async()=>{
 const target=db.training_tasks.find(x=>x.driver_id==='driver-one');const id=target.task_id;const original=target.learning_record;
 assert.equal((await call(`/api/training-tasks/${id}/delete`,driver,{})).status,403);
 const foreign=db.training_tasks.find(x=>x.driver_id==='driver-two');
 assert.equal((await call(`/api/training-tasks/${foreign.task_id}/delete`,scoped,{})).status,404);
 assert.equal((await call(`/api/training-tasks/${id}/delete`,admin,{})).status,200);
 assert.equal(target.status,'deleted');assert.equal(target.learning_record,original);
 assert(db.audit_logs.some(x=>x.entity_id===id&&x.action==='training.delete'));
 assert.equal((await call(`/api/training-tasks/${id}`,driver)).status,404);
 assert.equal((await call(`/api/training-tasks/${id}/quiz`,driver)).status,404);
 for(const [resource,cookie] of [['admin.trainings',admin],['my.trainings',driver]]){const r=await call('/api/data/'+resource,cookie);assert.equal(r.status,200);assert(!r.data.rows.some(x=>x.task_id===id));}
 });
 await t.test('Batch task deletion validates selection, scope and stale versions before writing',async()=>{
 const targets=Array.from({length:205},(_,i)=>({task_id:'batch-delete-'+i,driver_id:'driver-one',course_id:'XA_M01',status:i%2?'submitted':'assigned',learning_record:'retained-'+i,updated_at:'2026-11-01T00:00:00.000Z'}));db.training_tasks.push(...targets);
 const select=targets.slice(0,2).map(r=>({task_id:r.task_id,expected_updated_at:r.updated_at}));
 assert.equal((await call('/api/training-tasks/batch-delete',driver,{tasks:select})).status,403);
 for(const tasks of [[],[select[0],select[0]],[{task_id:select[0].task_id}],targets.map(r=>({task_id:r.task_id,expected_updated_at:r.updated_at}))])assert.equal((await call('/api/training-tasks/batch-delete',admin,{tasks})).status,400);
 const foreign=db.training_tasks.find(r=>r.driver_id==='driver-two'&&r.status!=='deleted');
 assert.equal((await call('/api/training-tasks/batch-delete',scoped,{tasks:[select[0],{task_id:foreign.task_id,expected_updated_at:foreign.updated_at||null}]})).status,404);
 assert.equal(targets[0].status,'assigned');
 assert.equal((await call('/api/training-tasks/batch-delete',admin,{tasks:[select[0],{...select[1],expected_updated_at:'stale'}]})).status,409);
 assert.equal(targets[0].status,'assigned');
 let before=(await call('/api/data/admin.trainings?limit=200',admin)).data;assert(before.total>200);assert.equal(before.rows.length,200);
 const beforeTotal=before.total;
 const result=await call('/api/training-tasks/batch-delete',admin,{tasks:select});assert.equal(result.status,200);assert.deepEqual(result.data.deleted,select.map(r=>r.task_id));assert.equal(result.data.failed.length,0);
 const after=(await call('/api/data/admin.trainings?limit=200',admin)).data;assert.equal(after.total,beforeTotal-2);
 assert.equal((await call('/api/data/my.trainings',driver)).data.rows.some(r=>select.some(s=>s.task_id===r.task_id)),false);
 assert.equal(targets[0].learning_record,'retained-0');assert.equal(targets[1].learning_record,'retained-1');
 assert(db.audit_logs.some(r=>r.entity_id===targets[1].task_id&&r.action==='training.delete'));
 // All pages remain readable; totals come from the complete result rather than page 1.
 const all=[];for(let offset=0;;offset+=200){const r=(await call('/api/data/admin.trainings?limit=200&offset='+offset,admin)).data;all.push(...r.rows);if(r.rows.length<200)break}assert.equal(all.length,after.total);
 });
 await t.test('Cross-module reading, saved answers, required fields and driver submission form a complete flow',async()=>{
 for(const status of ['pending_review','approved'])assert.equal((await call('/api/admin/course-review',admin,{course_id:'XA_TX',new_status:status})).status,200);
 const assigned=await call('/api/admin/training-library/assign',admin,{...batch,course_id:'XA_TX',driver_ids:['driver-two'],batch_id:'cross-reading-submit-001'});assert.equal(assigned.data.assigned,1);const id=assigned.data.results[0].task_id;
 let view=(await call(`/api/training-tasks/${id}/quiz`,second)).data;assert(view.reading.length>=8);assert(view.reading.some(s=>s.includes('辅助')));assert(view.action);assert(view.links.length>0);assert.equal(view.total,6);
 const course=library.courses.find(c=>c.course_id==='XA_TX');
 for(const [question_id,q]of course.questions.entries())assert.equal((await call(`/api/training-tasks/${id}/quiz-answer`,second,{question_id,selected:q.answer})).status,200);
 view=(await call(`/api/training-tasks/${id}/quiz`,second)).data;assert.equal(view.answered,6);assert.equal(view.status,'in_progress');assert.equal(view.completed,false);assert.equal(view.reflection,'');
 assert.equal((await call(`/api/training-tasks/${id}/quiz-finish`,second,{reflection})).data.error,'quiz_reading_action_required');
 const fields={reading_ack:true,action_plan:'出车前确认辅助系统功能，行驶中专注观察，停车后再处理调度信息。'};
 assert.equal((await call(`/api/training-tasks/${id}/quiz-finish`,second,fields)).data.error,'quiz_reflection_required');
 assert.equal((await call(`/api/training-tasks/${id}/quiz-draft`,second,{...fields,reflection,expected_updated_at:view.updated_at})).status,200);
 const resumed=(await call(`/api/training-tasks/${id}/quiz`,second)).data;assert.equal(resumed.answered,6);assert.equal(resumed.reflection,reflection);assert.equal(resumed.reading_ack,true);
 const result=await call(`/api/training-tasks/${id}/quiz-finish`,second,{...fields,reflection});assert.equal(result.status,200);assert.equal(result.data.status,'submitted');assert.equal(result.data.completed,true);assert.equal(result.data.score,100);
 assert.equal((await call(`/api/training-tasks/${id}/quiz-finish`,second,{...fields,reflection})).data.idempotent_replay,true);
 assert.equal((await call(`/api/training-tasks/${id}/quiz`,admin)).data.status,'submitted');
 assert.equal(db.notification_events.filter(n=>n.source_entity_id===id&&n.type==='task_submitted').length,1);
 });
 await t.test('Safety officer shares staff operations while parameter writes remain forbidden',async()=>{
 const officer=(await call('/api/auth/login',null,{username:'test_officer',password:'PreviewAdmin2026'})).cookie;
 for(const resource of ['admin.accounts','admin.operation_config','admin.import_runs','admin.trainings'])assert.equal((await call('/api/data/'+resource,officer)).status,200);
 assert.equal((await call('/api/admin/users',officer,{username:'officer_created_driver',display_name:'司机',role:'driver',reveal_password:true})).status,201);
 assert.equal((await call('/api/admin/ops-config',officer,{config_id:'drop_threshold',value:'5'})).status,403);
 for(const path of ['/api/admin/score-weights/apply','/api/admin/score-weights/design','/api/admin/score-weights/preview'])assert.equal((await call(path,officer,{})).status,403);
 assert.equal((await call('/api/course-groups',officer)).status,200);
 });
 await t.test('Course groups persist, deliver all member courses idempotently and keep prior tasks after removal',async()=>{
 assert.equal((await call('/api/course-groups',driver)).status,403);
 const g=await call('/api/course-groups',admin,{name:'专项课程组',course_ids:['XA_M01','XA_T03']});assert.equal(g.status,200);const group=g.data.group;
 assert((await call('/api/course-groups',admin)).data.groups.some(x=>x.id===group.id));
 const body={group_id:group.id,driver_ids:['driver-two'],due_at:'2099-12-31',batch_id:'group-test-1'};
 const r=await call('/api/course-groups/assign',admin,body);assert.equal(r.status,200);assert.equal(r.data.assigned,2);assert.equal(r.data.failed,0);
 const n=db.training_tasks.length;assert.equal((await call('/api/course-groups/assign',admin,body)).data.assigned,2);assert.equal(db.training_tasks.length,n);
 assert.equal((await call('/api/course-groups/assign',scoped,body)).status,404);
 assert.equal((await call('/api/courses/XA_T03/delete',driver,{})).status,403);
 assert.equal((await call('/api/courses/XA_T03/delete',admin,{})).status,200);
 assert.equal((await call('/api/course-groups/assign',admin,{...body,batch_id:'another'})).status,409);
 assert.equal((await call('/api/course-groups',admin,{action:'delete',id:group.id})).status,200);
 assert(!(await call('/api/course-groups',admin)).data.groups.some(x=>x.id===group.id));assert.equal(db.training_tasks.length,n);
 });
 }finally{if(child&&child.exitCode===null)await stop();await fixture.close()}
});
