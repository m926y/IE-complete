// Explicit operator-run rollout; never runs during server startup.
import {readFile,writeFile,mkdir} from 'node:fs/promises';
import assert from 'node:assert/strict';
const base=process.env.ROLLOUT_URL||'http://127.0.0.1:3100';
assert(/^http:\/\/(127\.0\.0\.1|localhost):\d+$/.test(base));
const password=process.env.ROLLOUT_PASSWORD;if(!password)throw Error('ROLLOUT_PASSWORD required');
let cookie;
async function call(path,body){const r=await fetch(base+path,{method:body?'POST':'GET',headers:{'content-type':'application/json',...(cookie?{cookie}:{})},body:body?JSON.stringify(body):undefined});const data=await r.json();if(!r.ok)throw Error(path+': '+(data.error||r.status));if(path==='/api/auth/login')cookie=r.headers.get('set-cookie')?.split(';')[0];return data;}
await call('/api/auth/login',{username:process.env.ROLLOUT_USER||'preview_admin',password});
const ref=JSON.parse(await readFile(new URL('../server/training-reference.json',import.meta.url),'utf8'));
let library=(await call('/api/training-library')).courses;
const rows=library.filter(c=>c.course_id.startsWith('XA_T'));assert.equal(rows.length,9);
for(const c of rows){const qs=c.course_id==='XA_TX'?ref.cross:ref.modules[Number(c.course_id.slice(-2))-1].questions;assert.deepEqual(c.questions,qs);assert.equal(qs.length,6);for(const q of qs){assert(q.title&&q.explain&&q.options.length===4&&q.answer.length);assert(q.answer.every(a=>Number.isInteger(a)&&a>=0&&a<4));}if(c.course_id!=='XA_TX')assert(c.reading.length>0);}
for(const c of rows){if(c.content_status==='version_conflict')throw Error('Course conflict '+c.course_id);if(c.content_status==='not_installed'){await call('/api/admin/training-library/install',{course_id:c.course_id});c.content_status='draft';}if(['draft','disabled'].includes(c.content_status)){await call('/api/admin/course-review',{course_id:c.course_id,new_status:'pending_review',note:'按用户明确上线要求提交审阅稿课程；核对阅读、六题题库、答案解析及适用范围。'});c.content_status='pending_review';}if(c.content_status==='pending_review')await call('/api/admin/course-review',{course_id:c.course_id,new_status:'approved',note:'按用户授权完成内容上线审核；与外部资料审阅稿逐题一致，保留适用范围及不直接改变风险等级的限制。'});}
library=(await call('/api/training-library')).courses.filter(c=>c.course_id.startsWith('XA_T'));assert(library.every(c=>c.content_status==='approved'));
const data=await call('/api/evaluation-actions/data'),assigned=[];
for(const row of data.rows.filter(r=>r.training_eligible&&r.target_user_id)){
 const existing=row.tasks.filter(t=>t.stratification_plan_id&&['assigned','in_progress','submitted','returned','reviewed'].includes(t.status)&&t.course_id.startsWith('XA_T'));
 if(existing.length){assigned.push({vehicle:row.vehicle,level:row.level,reused:true,tasks:existing.map(t=>t.task_id)});continue;}
 const plan=await call('/api/evaluation-actions/prepare',{driver_id:row.driver_id,score_version:row.score_version,course_ids:row.suggested_courses,due_at:'2026-11-06',goal:'【上线演示】按当前风险完成阅读、情境练习及个人行动计划；由演示账号使用者自行学习，成绩不代表真实司机培训效果。'});
 assert(plan.ready);const result=await call('/api/evaluation-actions/apply',{id:plan.id,confirm:true});assigned.push({vehicle:row.vehicle,level:row.level,plan_id:plan.id,questions:plan.questions,tasks:result.task_ids,created:result.created});
}
const report={date:'2026-10-30',version:ref.version,approved_courses:library.map(c=>({id:c.course_id,title:c.title})),assigned,unbound_eligible:data.rows.filter(r=>r.training_eligible&&!r.target_user_id).length,note:'仅发布到已核实绑定且符合资格的账号；不自动填写答案或生成真人验收记录。D级无合格绑定账号时不伪造绑定。'};
await mkdir(new URL('../output/课程正式上线-2026-10-30/',import.meta.url),{recursive:true});await writeFile(new URL('../output/课程正式上线-2026-10-30/上线清单.json',import.meta.url),JSON.stringify(report,null,2));
console.log(JSON.stringify(report,null,2));
