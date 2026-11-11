import test from 'node:test';
import assert from 'node:assert/strict';
import {DatabaseSync} from 'node:sqlite';
import {fileURLToPath} from 'node:url';
import {createActionCenter} from '../server/action-center.mjs';
test('Notification and task centers derive scoped, persistent, actionable state',async t=>{
 const db=new DatabaseSync(':memory:'),source=new DatabaseSync(fileURLToPath(new URL('../var/platform.sqlite',import.meta.url)),{readOnly:true});
 for(const name of ['app_users','drivers','vehicle_labels','alerts','risk_replay_sessions','risk_cases','training_tasks','review_requests','notification_events','interventions','score_snapshots','audit_logs','agent_artifacts','evaluation_actions'])db.exec(source.prepare("SELECT sql FROM sqlite_master WHERE name=?").get(name).sql);source.close();
 const insert=(table,row)=>{const keys=Object.keys(row);db.prepare(`INSERT INTO ${table}(${keys.join(',')}) VALUES(${keys.map(()=>'?').join(',')})`).run(...Object.values(row))};
 for(const [id,role,scope,driver] of [['admin','safety_admin','*',null],['staff','safety_admin','f1',null],['driver','driver','f1','d1'],['other','driver','f2','d2']])insert('app_users',{user_id:id,username:id,role,fleet_scope:scope,driver_id:driver,binding_verified:1,account_status:'active'});
 for(const [id,g,f] of [['d1','v1','f1'],['d2','v2','f2']])insert('drivers',{driver_id:id,gpsno:g,fleet_id:f});
 insert('risk_replay_sessions',{id:'session1',gps_json:'["v1","v2"]',status:'paused',created_at:'2026-10-29T01:00:00Z'});
 insert('vehicle_labels',{gpsno:'v1',display_no:1});insert('vehicle_labels',{gpsno:'v2',display_no:2});
 for(const [id,d,g] of [['c1','d1','v1'],['c2','d2','v2']]){insert('risk_cases',{id,driver_id:d,gpsno:g,target_user_id:d==='d1'?'driver':'other',title:'风险核查',level:'red',status:'pending_review',replay_session_id:'session1'});insert('alerts',{alert_id:id,driver_id:d,gpsno:g,status:'pending_review'});}
 insert('training_tasks',{task_id:'t1',driver_id:'d1',status:'submitted'});
 insert('training_tasks',{task_id:'t2',driver_id:'d1',status:'assigned',due_at:'2020-01-01'});
 insert('review_requests',{request_id:'r1',driver_id:'d1',status:'submitted'});
 insert('alerts',{alert_id:'a1',driver_id:'d1',gpsno:'v1',status:'confirmed',due_at:'2020-01-01'});
 insert('score_snapshots',{score_id:'s1',driver_id:'d1',gpsno:'v1',confidence_level:'low'});
 for(let i=0;i<60;i++)insert('notification_events',{notification_id:'n'+i,target_user_id:'staff',source_entity_type:'training_task',source_entity_id:'t1',title:'培训提交',content:'待审核',created_at:'2026-10-29T01:00:00Z'});
 insert('notification_events',{notification_id:'hidden',target_user_id:'staff',source_entity_type:'replay_risk',source_entity_id:'c2',content:'其他车队内容'});
 insert('audit_logs',{audit_id:'weight',action:'scoring.weights_apply',occurred_at:'2026-10-29T02:00:00Z'});
 insert('audit_logs',{audit_id:'import',actor_id:'staff',action:'import.commit',occurred_at:'2026-10-29T02:00:00Z'});
 insert('agent_artifacts',{id:'report',owner:'staff',scope:'f1',kind:'report',payload:JSON.stringify({title:'车队周报'}),created_at:'2026-10-29T02:00:00Z'});
 let svc=createActionCenter(db);const input=id=>({actor:{id}});
 try{
 await t.test('Counts and lists share current fleet scope with no 50-row notification truncation',()=>{const feed=svc.data(input('staff'));assert.equal(feed.unread_notes,63);assert.equal(feed.notes.length,63);assert(!JSON.stringify(feed).includes('其他车队内容'));assert(feed.todos.every(t=>t.vehicle==='车辆1'));assert.equal(feed.todo_count,6);assert.equal(feed.todos.filter(t=>t.kind==='risk').length,2);assert.equal(feed.todos[0].bucket,'urgent');assert(feed.todos.filter(t=>t.bucket==='overdue').length===2);assert(feed.todos.some(t=>t.route==='#/tr-ledger?task_id=t1'));assert(feed.todos.some(t=>t.route==='#/ev-review?request=r1'));assert(feed.notes.some(n=>n.route==='/api/agent/artifact?id=report&format=html&preview=1'));});
 await t.test('Reading a notification never completes its task and persists across service restart',()=>{const before=svc.data(input('staff')).todo_count;svc.read({...input('staff'),id:'note:n1'});svc=createActionCenter(db);assert.equal(svc.data(input('staff')).unread_notes,62);assert.equal(svc.data(input('staff')).todo_count,before);assert.throws(()=>svc.read({...input('other'),id:'note:n1'}),/center_note_not_found/);svc.read({...input('staff'),all:true});assert.equal(svc.data(input('staff')).unread_notes,0);});
 await t.test('Removal persists per account, preserves business records and can be undone',()=>{const before=svc.data(input('staff')),todo=before.todos[0];svc.remove({...input('staff'),ids:['note:n1',todo.id]});svc=createActionCenter(db);const after=svc.data(input('staff'));assert.equal(after.notes.length,before.notes.length-1);assert.equal(after.todo_count,before.todo_count-1);assert(db.prepare("SELECT 1 FROM notification_events WHERE notification_id='n1'").get());assert.throws(()=>svc.remove({...input('other'),ids:['note:n1']}),/center_item_invalid/);svc.restore({...input('staff'),ids:['note:n1',todo.id]});assert.equal(svc.data(input('staff')).todo_count,before.todo_count);});
 await t.test('Closing actual business objects removes tasks; reviewed training is no longer pending',()=>{db.exec("UPDATE risk_cases SET status='closed' WHERE id='c1';UPDATE alerts SET status='closed' WHERE alert_id='a1';UPDATE training_tasks SET status='reviewed';UPDATE review_requests SET status='closed';UPDATE score_snapshots SET confidence_level='high'");assert.equal(svc.data(input('staff')).todo_count,0)});
 await t.test('Driver view stays private and binding/disable changes revoke access immediately',()=>{db.exec("UPDATE risk_cases SET status='pending_review' WHERE id='c1';UPDATE training_tasks SET status='returned' WHERE task_id='t2'");assert.equal(svc.data(input('driver')).todo_count,2);assert(svc.data(input('driver')).todos.every(t=>t.route.startsWith('driver:')));db.exec("UPDATE risk_cases SET shadow=1 WHERE id='c1'");assert.equal(svc.data(input('driver')).todo_count,1);db.exec("UPDATE app_users SET binding_verified=0 WHERE user_id='driver'");assert.equal(svc.data(input('driver')).todo_count,0);db.exec("UPDATE app_users SET account_status='disabled' WHERE user_id='staff'");assert.throws(()=>svc.data(input('staff')),/center_forbidden/)});
 }finally{db.close()}
});
