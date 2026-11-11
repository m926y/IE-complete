import {pushTrainingAssignment} from './personal-learning.mjs';
import { randomBytes, randomUUID, scryptSync, createCipheriv, createDecipheriv } from 'node:crypto';
import { readFile, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';

const fail=(status,code)=>{throw Object.assign(new Error(code),{status,code});};
const id=prefix=>prefix+'-'+randomUUID();
const now=()=>new Date().toISOString();
const csv=rows=>'\ufeff'+rows.map(row=>row.map(v=>'"'+String(v??'').replace(/^[=+@-]/,"'$&").replaceAll('"','""')+'"').join(',')).join('\r\n');

// Private SQLite service. Public requests never supply an actor or executable SQL.
export async function createAgentStore(db,path,scoring,duty){
  const keyPath=join(dirname(path),'.agent-credentials.key');let key;
  try{key=await readFile(keyPath);}catch(e){if(e.code!=='ENOENT')throw e;key=randomBytes(32);await writeFile(keyPath,key,{mode:0o600,flag:'wx'});}
  if(key.length!==32)throw new Error('agent_credentials_key_invalid');
  db.exec(`CREATE TABLE IF NOT EXISTS agent_artifacts(id TEXT PRIMARY KEY,owner TEXT,scope TEXT,kind TEXT,created_at TEXT,expires_at TEXT,consumed_at TEXT,payload TEXT);
    CREATE TABLE IF NOT EXISTS agent_plans(id TEXT PRIMARY KEY,owner TEXT,scope TEXT,kind TEXT,created_at TEXT,expires_at TEXT,state TEXT,payload TEXT,preview TEXT,result TEXT);`);
  function actor(a,write=false){
    const u=a?.id&&db.prepare('SELECT user_id,role,fleet_scope,account_status FROM app_users WHERE user_id=?').get(a.id);
    if(!u||u.account_status!=='active'||!['safety_admin','safety_officer','team_leader'].includes(u.role))fail(403,'agent_forbidden');
    if(write&&(!['safety_admin','safety_officer'].includes(u.role)||String(u.fleet_scope||'*')!=='*'))fail(403,'agent_global_admin_required');
    return {id:u.user_id,scope:String(u.fleet_scope||'*'),role:u.role};
  }
  function audit(a,action,entity,entityId,detail){db.prepare('INSERT INTO audit_logs(audit_id,actor_id,actor_role,action,entity_type,entity_id,occurred_at,detail_json) VALUES(?,?,?,?,?,?,?,?)').run(id('aud'),a.id,a.role,action,entity,entityId,now(),JSON.stringify(detail));}
  function owned(table,identifier,a){const row=db.prepare(`SELECT * FROM ${table} WHERE id=? AND owner=? AND scope=?`).get(identifier,a.id,a.scope);if(!row)fail(404,'agent_not_found');return row;}
  function encrypt(value){const iv=randomBytes(12),c=createCipheriv('aes-256-gcm',key,iv);const b=Buffer.concat([c.update(JSON.stringify(value),'utf8'),c.final()]);return JSON.stringify({iv:iv.toString('hex'),tag:c.getAuthTag().toString('hex'),data:b.toString('base64')});}
  function decrypt(value){const p=JSON.parse(value),d=createDecipheriv('aes-256-gcm',key,Buffer.from(p.iv,'hex'));d.setAuthTag(Buffer.from(p.tag,'hex'));return JSON.parse(Buffer.concat([d.update(Buffer.from(p.data,'base64')),d.final()]).toString('utf8'));}
  function savePlan(a,kind,payload,preview){const identifier=id('plan'),expires=new Date(Date.now()+30*60000).toISOString();db.prepare('INSERT INTO agent_plans VALUES(?,?,?,?,?,?,?,?,?,?)').run(identifier,a.id,a.scope,kind,now(),expires,'pending',JSON.stringify(payload),JSON.stringify(preview),null);audit(a,'agent.plan_prepare','agent_plan',identifier,{kind,count:preview.count});return {id:identifier,kind,state:'pending',expires_at:expires,...preview};}
  function planGet(input){const a=actor(input.actor,true),r=owned('agent_plans',input.id,a);return {id:r.id,kind:r.kind,state:r.state,expires_at:r.expires_at,...JSON.parse(r.preview),...(r.result?{result:JSON.parse(r.result)}:{})};}
  function accountPlan(input){if(input.actor?.id&&!['safety_admin','safety_officer'].includes(db.prepare('SELECT role FROM app_users WHERE user_id=?').get(input.actor.id)?.role))fail(403,'agent_forbidden');
    const a=actor(input.actor,true),rows=input.rows;
    if(!Array.isArray(rows)||rows.length<1||rows.length>200)fail(400,'account_batch_size_invalid');
    const errors=[],seen=new Set(),seenVehicles=new Set(),normalized=[];
    rows.forEach((r,i)=>{
      const username=String(r.username||'').trim().toLowerCase(),display_name=String(r.display_name||username).trim(),role=String(r.role||'driver');
      if(Object.keys(r).some(k=>!['username','display_name','role','vehicle'].includes(k)))errors.push({row:i+2,reason:'仅允许用户名、显示名、角色、对应车辆；不要提供密码'});
      if(!/^[a-z0-9_.-]{3,32}$/.test(username))errors.push({row:i+2,reason:'用户名须为3–32位字母、数字、点、下划线或连字符'});
      if(!display_name||display_name.length>60)errors.push({row:i+2,reason:'显示名须为1–60字'});
      if(!['driver','team_leader','safety_admin','safety_officer'].includes(role))errors.push({row:i+2,reason:'角色无效'});
      if(seen.has(username)||db.prepare('SELECT 1 FROM app_users WHERE username=?').get(username))errors.push({row:i+2,reason:'用户名重复或已存在'});
      if(role==='safety_admin'&&a.role!=='safety_admin')errors.push({row:i+2,reason:'仅管理员可创建管理员'});seen.add(username);
      const vehicle=String(r.vehicle||'').trim();let binding=null;
      if(vehicle){
       if(role!=='driver')errors.push({row:i+2,reason:'只有司机账号可以填写对应车辆'});
       const label=/^(?:车辆|车)?\s*(\d+)$/.exec(vehicle);
       const matches=db.prepare('SELECT d.driver_id,d.gpsno,d.fleet_id,v.display_no FROM drivers d JOIN vehicle_labels v USING(gpsno) WHERE d.gpsno=? OR v.display_no=?').all(vehicle,label?Number(label[1]):-1);
       if(matches.length!==1)errors.push({row:i+2,reason:'对应车辆不存在或不唯一，请填写车辆编号，例如车辆152'});
       else{binding=matches[0];if(seenVehicles.has(binding.driver_id))errors.push({row:i+2,reason:'同一车辆不能在表格中重复分配'});seenVehicles.add(binding.driver_id);
        if(db.prepare("SELECT 1 FROM app_users WHERE role='driver' AND account_status='active' AND binding_verified=1 AND driver_id=?").get(binding.driver_id))errors.push({row:i+2,reason:'该车辆已被其他司机账号绑定'});
       }
      }
      normalized.push({username,display_name,role,...binding?{driver_id:binding.driver_id,gpsno:binding.gpsno,vehicle:'车辆'+binding.display_no}:{}});
    });
    if(errors.length)return {valid:false,count:rows.length,errors};
    return {valid:true,...savePlan(a,'accounts',{rows:normalized},{count:rows.length,rows:normalized.map(({driver_id,gpsno,...r})=>({...r,vehicle:r.vehicle||'稍后绑定'})),role_counts:Object.fromEntries(['driver','team_leader','safety_admin','safety_officer'].map(k=>[k,normalized.filter(r=>r.role===k).length]))})};
  }
  function trainingPlan(input){
    const a=actor(input.actor,true),p=input.options||{};
    if(!p.course_id||!p.cohort||!p.due_at||(p.cohort==='vehicle'&&!p.gpsno))fail(400,'training_details_required');
    const course=p.course_id&&db.prepare("SELECT * FROM training_courses WHERE course_id=? AND content_status='approved'").get(p.course_id);
    if(!course)fail(409,'course_not_approved');
    const today=new Intl.DateTimeFormat('en-CA',{timeZone:'Asia/Shanghai'}).format(new Date());
    if(p.mandatory!==undefined&&typeof p.mandatory!=='boolean')fail(400,'training_mandatory_invalid');
    if(!/^\d{4}-\d{2}-\d{2}$/.test(p.due_at||'')||!Number.isFinite(Date.parse(p.due_at))||new Date(p.due_at).toISOString().slice(0,10)!==p.due_at||p.due_at<today)fail(400,'training_due_date_invalid');
    if(!['a','b','c','d','cd','low_confidence','all','vehicle'].includes(p.cohort))fail(400,'training_cohort_required');
    if(p.cohort==='vehicle'&&!p.gpsno)fail(400,'training_vehicle_required');
    const rows=db.prepare('SELECT s.*,v.display_no FROM score_snapshots s JOIN vehicle_labels v USING(gpsno)').all().filter(s=>p.cohort==='a'?s.risk_level==='A':p.cohort==='b'?s.risk_level==='B':p.cohort==='d'?s.risk_level==='D':p.cohort==='c'?s.risk_level==='C':p.cohort==='cd'?['C','D'].includes(s.risk_level):p.cohort==='low_confidence'?s.confidence_level==='low':p.cohort==='vehicle'?s.gpsno===p.gpsno:true);
    if(p.cohort==='vehicle'&&!rows.length)fail(404,'training_vehicle_not_found');
    const ready=[],skipped=[];
    for(const r of rows){
      const users=db.prepare("SELECT user_id,username FROM app_users WHERE role='driver' AND account_status='active' AND binding_verified=1 AND driver_id=?").all(r.driver_id);
      const reason=users.length!==1?'未绑定唯一的有效司机账号':null;
      if(reason)skipped.push({vehicle:`车辆${r.display_no}`,reason});else ready.push({gpsno:r.gpsno,driver_id:r.driver_id,user_id:users[0].user_id,vehicle:`车辆${r.display_no}`});
    }
    let mandatory=Boolean(p.mandatory),policy=null;const config=db.prepare("SELECT value FROM operation_config WHERE config_id='training_mandate_policy'").get();try{policy=JSON.parse(config?.value||'null');}catch{}
    const targets=ready.map(r=>({...r,mandatory:p.mandatory===undefined?policy?.[rows.find(s=>s.gpsno===r.gpsno)?.risk_level]==='mandatory':mandatory}));
    return savePlan(a,'training',{targets,course_id:course.course_id,course_version:Number(course.version_no||0),due_at:p.due_at,goal:String(p.goal||'结合本车证据完成课程并提交学习反馈').slice(0,500),base_version:scoring.version()},
      {count:targets.length,selected_count:rows.length,skipped,course_id:course.course_id,course_title:course.title,due_at:p.due_at,rows:targets.map(r=>({vehicle:r.vehicle,mandatory:r.mandatory})),base_version:scoring.version()});
  }
  function reportPut(input){const a=actor(input.actor),identifier=id('report');db.prepare('INSERT INTO agent_artifacts VALUES(?,?,?,?,?,?,?,?)').run(identifier,a.id,a.scope,'report',now(),null,null,JSON.stringify(input.report));audit(a,'agent.report_generate','agent_report',identifier,{period:input.report.period,version:input.report.version});return {id:identifier,title:input.report.title,period:input.report.period};}
  function coursePlan(input){const a=actor(input.actor,true),p=input.options||{};if(!String(p.title||'').trim()||String(p.title).length>100||!String(p.content||'').trim()||String(p.content).length>30000||!['history','fatigue_distraction','driving_stability','road_rule','management','imu_evidence'].includes(p.dimension))fail(400,'course_draft_invalid');const payload={title:String(p.title).trim(),content:String(p.content).trim(),dimension:p.dimension,completion_requirement:String(p.completion_requirement||'完成阅读并提交学习记录与行动计划').slice(0,500)};return savePlan(a,'course',payload,{count:1,rows:[{...payload,content:payload.content.length>1200?payload.content.slice(0,1200)+`…（共${payload.content.length}字，确认后完整保存）`:payload.content}],title:payload.title,note:'仅创建待审核课程草稿，不自动批准或分配'});}
  function artifactGet(input){const a=actor(input.actor),r=owned('agent_artifacts',input.id,a);if(r.kind!=='report')fail(404,'agent_not_found');return JSON.parse(r.payload);}
  function apply(input){
    const a=actor(input.actor,true),plan=owned('agent_plans',input.id,a);
    if(plan.state==='complete')return {...JSON.parse(plan.result),idempotent_replay:true};
    if(plan.expires_at<now())fail(410,'agent_plan_expired');
    const p=JSON.parse(plan.payload),at=now();if(plan.kind==='training'&&p.base_version!==scoring.version())fail(409,'agent_score_version_changed');
    if(plan.kind==='training'&&!p.targets.length)fail(409,'agent_no_eligible_targets');
    db.exec('BEGIN IMMEDIATE');
    try{
      const result={ok:true,plan_id:plan.id,kind:plan.kind,count:0};
      if(plan.kind==='accounts'){if(!['safety_admin','safety_officer'].includes(a.role))fail(403,'agent_forbidden');if(a.role!=='safety_admin'&&p.rows.some(r=>r.role==='safety_admin'))fail(403,'cannot_grant_admin');
        const credentials=[['用户名','显示名','角色','初始密码（首次登录须修改）','对应车辆']];
        for(const r of p.rows){
          if(db.prepare('SELECT 1 FROM app_users WHERE username=?').get(r.username))fail(409,'username_exists');
          const password=randomBytes(12).toString('base64url'),salt=randomBytes(16),hash=scryptSync(password,salt,64,{N:16384,r:8,p:1}).toString('hex'),userId=id('u');
          db.prepare('INSERT INTO app_users(user_id,username,display_name,role,fleet_scope,account_status,password_hash,must_change_password,binding_verified,created_by,created_at,updated_at) VALUES(?,?,?,?,?,?,?,?,?,?,?,?)').run(userId,r.username,r.display_name,r.role,r.role==='safety_admin'?'*':null,'active',`scrypt$16384$8$1$${salt.toString('hex')}$${hash}`,1,0,a.id,at,at);
          if(r.driver_id){
           const current=db.prepare('SELECT gpsno,fleet_id FROM drivers WHERE driver_id=?').get(r.driver_id);if(!current||current.gpsno!==r.gpsno)fail(409,'vehicle_mapping_changed');
           if(!duty)fail(503,'binding_service_unavailable');
           duty.bind({actor:{id:a.id},user_id:userId,gpsno:r.gpsno});
           db.prepare('UPDATE app_users SET fleet_scope=? WHERE user_id=?').run(current.fleet_id,userId);
          }
          audit(a,'account.create','app_user',userId,{batch_id:plan.id,username:r.username,role:r.role});credentials.push([r.username,r.display_name,r.role,password,r.vehicle||'未绑定']);result.count++;
        }
        const artifactId=id('credentials');db.prepare('INSERT INTO agent_artifacts VALUES(?,?,?,?,?,?,?,?)').run(artifactId,a.id,a.scope,'credentials',at,new Date(Date.now()+3600000).toISOString(),null,encrypt(csv(credentials)));
        result.credentials_id=artifactId;
      }else if(plan.kind==='course'){
        const courseId='AC-'+randomUUID().slice(0,12);db.prepare('INSERT INTO training_courses(course_id,title,dimension,content,completion_requirement,content_status,version_no,updated_at) VALUES(?,?,?,?,?,?,?,?)').run(courseId,p.title,p.dimension,p.content,p.completion_requirement,'draft',1,at);audit(a,'course.create','training_course',courseId,{batch_id:plan.id,content_status:'demo_draft_requires_team_review'});result.count=1;result.course_id=courseId;
      }else if(plan.kind==='training'){
        const course=db.prepare("SELECT * FROM training_courses WHERE course_id=? AND content_status='approved'").get(p.course_id);
        if(!course||Number(course.version_no||0)!==p.course_version)fail(409,'course_changed');
        for(const r of p.targets){
          const score=db.prepare('SELECT risk_level,confidence_level,source_version FROM score_snapshots WHERE driver_id=?').get(r.driver_id);if(!score)fail(409,'driver_score_unavailable');
          if(!db.prepare("SELECT 1 FROM app_users WHERE user_id=? AND driver_id=? AND binding_verified=1 AND account_status='active' AND role='driver'").get(r.user_id,r.driver_id))fail(409,'driver_binding_changed');
          const task=id('task'),text=`新培训任务：${course.title}，截止 ${p.due_at}。请在培训任务中完成学习及反馈。`;
          db.prepare('INSERT INTO training_tasks(task_id,driver_id,alert_id,course_id,goal,mandatory,due_at,status,created_by,idempotency_key,updated_at,score_version,assigned_risk_level) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?)').run(task,r.driver_id,'',p.course_id,p.goal,Number(r.mandatory),p.due_at,'assigned',a.id,`${plan.id}:${r.driver_id}`,at,score.source_version,score.risk_level);
          db.prepare('INSERT INTO notification_events(notification_id,target_user_id,source_entity_type,source_entity_id,type,title,body,content,created_at,idempotency_key) VALUES(?,?,?,?,?,?,?,?,?,?)').run(id('noti'),r.user_id,'training_task',task,'task_assigned','新的培训任务',text,text,at,'agent:'+task);
          pushTrainingAssignment(db,task,a.id);audit(a,'training.assign','training_task',task,{batch_id:plan.id,course_id:p.course_id,mandatory:r.mandatory});result.count++;
        }
      }else fail(400,'agent_plan_kind_invalid');
      audit(a,'agent.batch_apply','agent_plan',plan.id,{kind:plan.kind,count:result.count});
      db.prepare("UPDATE agent_plans SET state='complete',result=? WHERE id=?").run(JSON.stringify(result),plan.id);db.exec('COMMIT');return result;
    }catch(e){db.exec('ROLLBACK');throw e;}
  }
  function credentialsGet(input){const a=actor(input.actor,true),r=owned('agent_artifacts',input.id,a);if(r.kind!=='credentials'||r.consumed_at||r.expires_at<now())fail(410,'credentials_expired_or_consumed');const value=decrypt(r.payload);db.prepare('UPDATE agent_artifacts SET consumed_at=?,payload=? WHERE id=? AND consumed_at IS NULL').run(now(),'{}',r.id);audit(a,'agent.credentials_download','agent_artifact',r.id,{one_time:true});return {content:value};}
  return {accountPlan,trainingPlan,coursePlan,planGet,reportPut,artifactGet,apply,credentialsGet};
}
