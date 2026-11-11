import {createDutyHistory} from './duty-history.mjs';
import {createDriverIntegration} from './driver-integration.mjs';
import {createLearningIntegration} from './learning-integration.mjs';
import {createHandover} from './handover.mjs';
import {createPersonalLearning} from './personal-learning.mjs';
import {createOfflineTraining} from './offline-training.mjs';
import {createActionCenter} from './action-center.mjs';
import {createEvaluationActions} from './evaluation-actions.mjs';
// Private, loopback-only PostgREST subset used by the local persistent platform.
import { DatabaseSync } from 'node:sqlite';
import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import { resolve,dirname } from 'node:path';
import { pathToFileURL,fileURLToPath } from 'node:url';
import { randomBytes } from 'node:crypto';
import { createScoringEngine } from './scoring-engine.mjs';
import { createAgentStore } from './agent-store.mjs';
import { createRiskMonitor } from './risk-monitor.mjs';
import { createMessaging } from './messaging.mjs';

const quote = name => '"' + String(name).replaceAll('"', '""') + '"';
const identifier = value => { if (!/^[a-zA-Z_][a-zA-Z0-9_]*$/.test(value)) throw new Error('invalid_identifier'); return quote(value); };
const valueOf = v => v === 'true' ? 1 : v === 'false' ? 0 : v;
const sqlValue = value => typeof value === 'boolean' ? Number(value) : value && typeof value === 'object' ? JSON.stringify(value) : value ?? null;
const split = input => { let depth=0, start=0, out=[]; for (let i=0;i<input.length;i++) { if(input[i]==='(')depth++; if(input[i]===')')depth--; if(input[i]===','&&depth===0){out.push(input.slice(start,i));start=i+1;} } out.push(input.slice(start)); return out; };
function filter(key, expression, args, columns) {
  if (key==='or'||key==='and') {
    if (!expression.startsWith('(')||!expression.endsWith(')')) throw new Error('bad_filter');
    return '('+split(expression.slice(1,-1)).map(part => {const dot=part.indexOf('.');return filter(part.slice(0,dot),part.slice(dot+1),args,columns);}).join(key==='or'?' OR ':' AND ')+')';
  }
  if(!columns.has(key)) throw new Error('unknown_column');
  const col=identifier(key);
  if(expression.startsWith('not.')) return 'NOT ('+filter(key,expression.slice(4),args,columns)+')';
  if(expression==='is.null') return col+' IS NULL';
  if(expression==='is.true'||expression==='is.false') {args.push(expression==='is.true'?1:0);return col+' = ?';}
  if(expression.startsWith('in.(')&&expression.endsWith(')')) {
    const values=expression.slice(4,-1).split(','); if(!values.length)return '0';
    args.push(...values.map(valueOf));return col+' IN ('+values.map(()=>'?').join(',')+')';
  }
  const dot=expression.indexOf('.'), op=expression.slice(0,dot), value=expression.slice(dot+1);
  const operators={eq:'=',neq:'<>',gt:'>',gte:'>=',lt:'<',lte:'<=',like:'LIKE',ilike:'LIKE'};
  if(dot<0||!operators[op])throw new Error('unsupported_filter');
  args.push(valueOf(['like','ilike'].includes(op)?value.replaceAll('*','%'):value));
  return col+' '+operators[op]+' ?';
}

export async function startLocalDatabase({ path, manifestPath,enableDriverReports=false }) {
  const manifest=JSON.parse(await readFile(manifestPath,'utf8'));
  const db=new DatabaseSync(path);
  db.exec('PRAGMA journal_mode=WAL; PRAGMA busy_timeout=5000; PRAGMA foreign_keys=ON;');
  // 幂等结构补全：早期发行库的 evaluation_rule_drafts 缺 dimension/approval_note 两列，
  // 代码三处引用（列表 select/创建 insert/批准 patch），缺列会使规则板整体 503
  if(db.prepare("SELECT 1 FROM sqlite_master WHERE type='table' AND name='evaluation_rule_drafts'").get()){
    const cols=new Set(db.prepare('PRAGMA table_info(evaluation_rule_drafts)').all().map(c=>c.name));
    if(!cols.has('dimension'))db.exec('ALTER TABLE evaluation_rule_drafts ADD COLUMN dimension TEXT');
    if(!cols.has('approval_note'))db.exec('ALTER TABLE evaluation_rule_drafts ADD COLUMN approval_note TEXT');
  }
  db.prepare('ATTACH DATABASE ? AS history').run(pathToFileURL(resolve(dirname(manifestPath instanceof URL?fileURLToPath(manifestPath):resolve(manifestPath)),manifest.history_database)).href+'?mode=ro');
  const dimension=`CASE WHEN e.event_type IN (11803,11804) THEN 'history' WHEN e.event_type IN (41001,41002,41003,41004,41005,41009,41023,41029) THEN 'fatigue_distraction' WHEN e.event_type IN (11401,11402,11403,11405,11406) THEN 'road_rule' WHEN e.event_type IN (41006,41021) THEN 'management' ELSE 'driving_stability' END`;
  db.exec(`CREATE TEMP VIEW replay_events AS SELECT e.event_id,e.gpsno,d.driver_id,e.event_time,e.event_date,cast(e.event_type AS TEXT) event_type,e.event_name,e.speed speed_kmh,e.coordinate_valid,e.speed_valid,e.source_line,${dimension} dimension,e.event_date replay_date,1 is_replay,'history_index_v1' source_version FROM history.events e JOIN main.drivers d ON d.gpsno=e.gpsno;
    CREATE TEMP VIEW local_event_daily AS SELECT e.*,d.driver_id FROM history.event_daily e JOIN main.drivers d ON d.gpsno=e.gpsno;
    CREATE TEMP VIEW local_trajectory_daily AS SELECT e.*,d.driver_id FROM history.trajectory_daily e JOIN main.drivers d ON d.gpsno=e.gpsno;
    CREATE TEMP VIEW local_imu_daily AS SELECT e.*,d.driver_id FROM history.imu_daily e JOIN main.drivers d ON d.gpsno=e.gpsno;
    CREATE TEMP VIEW local_profiles AS SELECT e.*,d.driver_id FROM history.profiles e JOIN main.drivers d ON d.gpsno=e.gpsno;`);
  const learningIntegration=createLearningIntegration(db),driverIntegration=createDriverIntegration(db,{autoStart:enableDriverReports});
  const tables=new Set(db.prepare("SELECT name FROM sqlite_master WHERE type='table' UNION SELECT name FROM sqlite_temp_master WHERE type='view'").all().map(x=>x.name));
  const readOnly=new Set(['replay_events','local_event_daily','local_trajectory_daily','local_imu_daily','local_profiles','data_metadata']);
  for(const t of ['daily_safety_reports','driver_safety_goals','daily_report_jobs','driver_report_metadata','training_delivery_outbox','review_delivery_outbox'])readOnly.add(t);
  const facts=new Set(['drivers','risk_snapshots','score_snapshots','score_history','deduction_ledger','review_queue']);
  const token=randomBytes(32).toString('hex');
  const scoring=createScoringEngine(db,JSON.parse(await readFile(new URL('../scripts/scoring_source/scoring_frozen.json',import.meta.url),'utf8')));
  const duty=createDutyHistory(db);
  const agent=await createAgentStore(db,path,scoring,duty);tables.add("driver_duty_history");readOnly.add("driver_duty_history");
  const personal=createPersonalLearning(db);tables.add('chat_business_refs');readOnly.add('chat_business_refs');
  const risk=createRiskMonitor(db);
  const evaluation=createEvaluationActions(db,scoring,JSON.parse(await readFile(new URL('./training-reference.json',import.meta.url),'utf8')));
  for(const t of ['evaluation_actions','evaluation_training_plans']){tables.add(t);readOnly.add(t);}
  const offline=createOfflineTraining(db);for(const t of ['offline_trainings','offline_training_attendees']){tables.add(t);readOnly.add(t);}
  const center=createActionCenter(db);tables.add('action_center_reads');readOnly.add('action_center_reads');
  const messaging=createMessaging(db);tables.add('chat_messages');readOnly.add('chat_messages');
  const handover=createHandover(db);for(const t of ['handover_settings','handover_reports','handover_notes']){tables.add(t);readOnly.add(t);}
  for(const t of ['risk_action_plans','risk_case_actions','risk_action_followups','risk_replay_sessions','realtime_events','realtime_vehicle_state','risk_cases','alert_evidence','alert_deliveries']){tables.add(t);readOnly.add(t);}
  for(const t of ['agent_plans','agent_artifacts'])readOnly.add(t);
  for(const table of ['scoring_designs','scoring_versions','scoring_version_rows','score_snapshots','score_history','deduction_ledger','review_queue','evaluation_rules'])readOnly.add(table);
  const server=createServer(async(req,res)=>{
    try {
      if(req.headers.apikey!==token){res.writeHead(401);res.end('{"code":"unauthorized"}');return;}
      const url=new URL(req.url,'http://local');
      if(url.pathname.startsWith('/internal/driver-integration/')||url.pathname.startsWith('/internal/learning-integration/')){try{const action=url.pathname.split('/').at(-1),service=url.pathname.includes('/driver-integration/')?driverIntegration:learningIntegration;if(req.method!=='POST'||['pump','close'].includes(action)||!Object.hasOwn(service,action))throw Object.assign(new Error(),{status:404});let raw='';for await(const b of req){raw+=b;if(raw.length>16000)throw new Error('body_too_large')}const out=await service[action](JSON.parse(raw));res.writeHead(200,{'content-type':'application/json','cache-control':'no-store'});res.end(JSON.stringify(out));}catch(e){res.writeHead(e.status||500,{'content-type':'application/json'});res.end(JSON.stringify({error:e.code||'driver_integration_failed'}))}return;}
      if(url.pathname.startsWith('/internal/handover/')){try{const action=url.pathname.split('/').at(-1);if(req.method!=='POST'||!['data','settings','view','preview','generate','assign','accept','note','delete_note'].includes(action))throw Object.assign(new Error(),{status:404});let raw='';for await(const b of req){raw+=b;if(raw.length>16000)throw new Error('body_too_large')}const out=await handover[action](JSON.parse(raw));res.writeHead(200,{'content-type':'application/json','cache-control':'no-store'});res.end(JSON.stringify(out));}catch(e){res.writeHead(e.status||500,{'content-type':'application/json'});res.end(JSON.stringify({error:e.code||'handover_failed'}))}return;}
      if(url.pathname.startsWith('/internal/duty/')){try{let raw='';for await(const b of req){raw+=b;if(raw.length>16000)throw new Error('too_large')}const action=url.pathname.split('/').at(-1);if(req.method!=='POST'||!Object.hasOwn(duty,action))throw Object.assign(new Error(),{status:404});const out=duty[action](JSON.parse(raw));res.writeHead(200,{'content-type':'application/json'});res.end(JSON.stringify(out));}catch(e){res.writeHead(e.status||500,{'content-type':'application/json'});res.end(JSON.stringify({error:e.code||'duty_failed'}))}return;}
      if(url.pathname.startsWith('/internal/personal/')){try{const action=url.pathname.split('/').at(-1);if(req.method!=='POST'||!Object.hasOwn(personal,action)){res.writeHead(404);res.end('{}');return;}let raw='';for await(const b of req){raw+=b;if(raw.length>16000)throw new Error('body_too_large');}const out=personal[action](JSON.parse(raw));res.writeHead(200,{'content-type':'application/json'});res.end(JSON.stringify(out));}catch(e){res.writeHead(e.status||500,{'content-type':'application/json'});res.end(JSON.stringify({error:e.code||'personal_failed'}));}return;}
      if(url.pathname.startsWith('/internal/offline/')){
        try{const action=url.pathname.slice('/internal/offline/'.length);if(req.method!=='POST'||!Object.hasOwn(offline,action)){res.writeHead(404);res.end('{}');return;}let raw='';for await(const b of req){raw+=b;if(raw.length>32000)throw new Error('body_too_large');}const result=offline[action](JSON.parse(raw));res.writeHead(200,{'content-type':'application/json','cache-control':'no-store'});res.end(JSON.stringify(result));}catch(e){res.writeHead(e.status||500,{'content-type':'application/json'});res.end(JSON.stringify({error:e.status?e.code:'offline_service_failed'}));}return;
      }
      if(url.pathname.startsWith('/internal/center/')){
        try{const action=url.pathname.slice('/internal/center/'.length);if(req.method!=='POST'||!Object.hasOwn(center,action)){res.writeHead(404);res.end('{}');return;}let raw='';for await(const b of req){raw+=b;if(raw.length>16000)throw new Error('body_too_large');}const result=center[action](JSON.parse(raw));res.writeHead(200,{'content-type':'application/json','cache-control':'no-store'});res.end(JSON.stringify(result));}catch(e){res.writeHead(e.status||500,{'content-type':'application/json'});res.end(JSON.stringify({error:e.status?e.code:'center_service_failed'}));}return;
      }
      if(url.pathname.startsWith('/internal/evaluation/')){
        try{const action=url.pathname.slice('/internal/evaluation/'.length);if(req.method!=='POST'||!Object.hasOwn(evaluation,action)){res.writeHead(404);res.end('{}');return;}let raw='';for await(const b of req){raw+=b;if(raw.length>32000)throw new Error('body_too_large');}const result=evaluation[action](JSON.parse(raw));res.writeHead(200,{'content-type':'application/json','cache-control':'no-store'});res.end(JSON.stringify(result));}catch(e){res.writeHead(e.status||500,{'content-type':'application/json'});res.end(JSON.stringify({error:e.status?e.code:'evaluation_service_failed'}));}return;
      }
      if(url.pathname.startsWith('/internal/chat/')){
        try{const action=url.pathname.slice('/internal/chat/'.length);if(req.method!=='POST'||!Object.hasOwn(messaging,action)){res.writeHead(404);res.end('{}');return;}let raw='';for await(const b of req){raw+=b;if(raw.length>16000)throw new Error('body_too_large');}const result=messaging[action](JSON.parse(raw));res.writeHead(200,{'content-type':'application/json','cache-control':'no-store'});res.end(JSON.stringify(result));}catch(e){res.writeHead(e.status||500,{'content-type':'application/json'});res.end(JSON.stringify({error:e.status?e.code:'chat_service_failed'}));}return;
      }
      if(url.pathname.startsWith('/internal/risk/')){
        try{
          const action=url.pathname.slice('/internal/risk/'.length);
          if(req.method!=='POST'||!['metadata','create','control','live','handle','feedback','actionPreview','actionApply','actionComplete'].includes(action)){res.writeHead(404);res.end('{}');return;}
          let raw='';for await(const b of req){raw+=b;if(raw.length>32000)throw new Error('body_too_large');}
          const result=risk[action](JSON.parse(raw));res.writeHead(200,{'content-type':'application/json','cache-control':'no-store'});res.end(JSON.stringify(result));
        }catch(e){res.writeHead(e.status||500,{'content-type':'application/json'});res.end(JSON.stringify({error:e.status?e.code:'risk_service_failed'}));}
        return;
      }
      if(url.pathname.startsWith('/internal/agent/')){
        try{
          const action=url.pathname.slice('/internal/agent/'.length);
          if(req.method!=='POST'||!Object.hasOwn(agent,action)){res.writeHead(404);res.end('{}');return;}
          let raw='';for await(const b of req){raw+=b;if(raw.length>2*1024*1024)throw new Error('body_too_large');}
          const result=agent[action](JSON.parse(raw));res.writeHead(200,{'content-type':'application/json','cache-control':'no-store'});res.end(JSON.stringify(result));
        }catch(e){res.writeHead(e.status||500,{'content-type':'application/json'});res.end(JSON.stringify({error:e.status?e.code:'agent_transaction_failed'}));}
        return;
      }
      if(url.pathname.startsWith('/internal/scoring/')){
        const action=url.pathname.slice('/internal/scoring/'.length);
        let result;
        try{
          if(req.method==='GET'&&action==='state')result=scoring.state();
          else if(req.method==='GET'&&action==='version')result={version:scoring.version()};
          else if(req.method==='GET'&&action==='history')result=scoring.history(url.searchParams.get('version'));
          else if(req.method==='GET'&&action==='compare')result=scoring.compare(url.searchParams.get('left'),url.searchParams.get('right'));
          else if(req.method==='POST'&&['preview','apply','design','submit','review','activate'].includes(action)){
            let input='';for await(const b of req){input+=b;if(input.length>16000)throw new Error('body_too_large');}
            const body=JSON.parse(input);if(['preview','apply'].includes(action))await scoring.precompute(body);result=await scoring[action](body);
          }else{res.writeHead(404);res.end('{}');return;}
          res.writeHead(200,{'content-type':'application/json','cache-control':'no-store'});res.end(JSON.stringify(result));
        }catch(e){res.writeHead(e.status||500,{'content-type':'application/json'});res.end(JSON.stringify({error:e.status?e.code:'scoring_recompute_failed'}));}
        return;
      }
      if(!/^\/rest\/v1\/[a-z_]+$/.test(url.pathname))throw new Error('invalid_path');
      const table=url.pathname.split('/').at(-1);
      if(!tables.has(table))throw new Error('unknown_table');
      const info=db.prepare(`PRAGMA table_info(${identifier(table)})`).all();
      const columns=new Set(info.map(x=>x.name)), args=[], clauses=[];
      for(const [key,value] of url.searchParams) {
        if(['select','order','limit','offset','on_conflict','distinct','on'].includes(key))continue;
        clauses.push(filter(key,value,args,columns));
      }
      const where=clauses.length?' WHERE '+clauses.join(' AND '):'';
      const name=identifier(table);
      let result=[];
      if(req.method==='GET'||req.method==='HEAD') {
        const requested=url.searchParams.get('select')||'*';
        const select=requested==='*'?'*':requested.split(',').map(col=>{if(!columns.has(col))throw new Error('unknown_column');return identifier(col);}).join(',');
        const unique=url.searchParams.get('distinct')==='1'?'DISTINCT ':'';
        let total=db.prepare(`SELECT count(*) n FROM (SELECT ${unique}${unique?select:'1'} FROM ${name}${where})`).get(...args).n;
        const order=(url.searchParams.get('order')||'').split(',').filter(Boolean).map(term=>{
          const [col,direction='asc',nulls]=term.split('.');if(!columns.has(col)||!['asc','desc'].includes(direction)||nulls&&!['nullsfirst','nullslast'].includes(nulls))throw new Error('bad_order');
          return identifier(col)+' '+direction.toUpperCase()+(nulls?' NULLS '+(nulls==='nullsfirst'?'FIRST':'LAST'):'');
        });
        const primary=info.filter(x=>x.pk).map(x=>x.name);
        if(!unique)for(const pk of primary)if(!order.some(x=>x.startsWith(identifier(pk)+' ')))order.push(identifier(pk)+' ASC');
        const range=/^(\d+)-(\d+)$/.exec(req.headers.range||'');
        const limit=Math.min(Math.max(Number(url.searchParams.get('limit')||(range?Number(range[2])-Number(range[1])+1:1000)),0),20000);
        const offset=Math.max(Number(url.searchParams.get('offset')||(range?range[1]:0)),0);
        if(!Number.isInteger(limit)||!Number.isInteger(offset))throw new Error('invalid_range');
        result=db.prepare(`SELECT ${unique}${select} FROM ${name}${where}${order.length?' ORDER BY '+order.join(','):''} LIMIT ? OFFSET ?`).all(...args,limit,offset);
        res.setHeader('content-range',`${offset}-${Math.max(offset,offset+result.length-1)}/${total}`);
      } else {
        if(readOnly.has(table)||facts.has(table)&&req.headers['x-platform-db-operation']!=='upsert_resource') {res.writeHead(403);res.end('{"code":"read_only_fact"}');return;}
        let text='';for await(const b of req){text+=b;if(text.length>8*1024*1024)throw new Error('body_too_large');}
        const body=text?JSON.parse(text):null;
        if(req.method==='POST'||req.method==='PATCH') {
          const rows=Array.isArray(body)?body:[body];
          for(const row of rows) for(const key of Object.keys(row||{})) if(!columns.has(key)) {
            db.exec(`ALTER TABLE ${name} ADD COLUMN ${identifier(key)} TEXT`);columns.add(key);
          }
        }
        db.exec('BEGIN IMMEDIATE');
        try {
          if(req.method==='POST') {
            const rows=Array.isArray(body)?body:[body];
            for(const row of rows){
              const keys=Object.keys(row), values=keys.map(k=>sqlValue(row[k]));
              const conflicts=(url.searchParams.get('on_conflict')||info.filter(x=>x.pk).map(x=>x.name).join(',')).split(',').filter(Boolean);
              let suffix='';
              if(String(req.headers.prefer).includes('resolution=merge-duplicates')&&conflicts.length)suffix=` ON CONFLICT (${conflicts.map(identifier).join(',')}) DO UPDATE SET `+keys.filter(k=>!conflicts.includes(k)).map(k=>`${identifier(k)}=excluded.${identifier(k)}`).join(',');
              db.prepare(`INSERT INTO ${name} (${keys.map(identifier).join(',')}) VALUES (${keys.map(()=>'?').join(',')})${suffix}`).run(...values);
              result.push(row);
            }
          } else if(req.method==='PATCH') {
            const keys=Object.keys(body||{}); if(!keys.length)throw new Error('empty_patch');
            result=db.prepare(`UPDATE ${name} SET ${keys.map(k=>identifier(k)+'=?').join(',')}${where} RETURNING *`).all(...keys.map(k=>sqlValue(body[k])),...args);
          } else if(req.method==='DELETE') result=db.prepare(`DELETE FROM ${name}${where} RETURNING *`).all(...args);
          else throw new Error('unsupported_method');
          db.exec('COMMIT');
        } catch(e){db.exec('ROLLBACK');throw e;}
      }
      res.writeHead(200,{'content-type':'application/json','cache-control':'no-store'});res.end(req.method==='HEAD'?undefined:JSON.stringify(result));
    } catch(e) {
      const conflict=String(e.message).includes('UNIQUE constraint');
      const error=conflict?'23505':/^(invalid_|bad_|unknown_|unsupported_|empty_)/.test(e.message)?e.message:'local_database_error';
      console.error('local-db',req.method,new URL(req.url,'http://local').pathname,error);
      res.writeHead(conflict?409:400,{'content-type':'application/json'});res.end(JSON.stringify({code:error}));
    }
  });
  await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
  return {url:`http://127.0.0.1:${server.address().port}`,token,runDriverReports:driverIntegration.pump,close:async()=>{driverIntegration.close();learningIntegration.close();await handover.close();return new Promise(resolve=>{risk.close();server.close(()=>{db.close();resolve();});});}};
}
