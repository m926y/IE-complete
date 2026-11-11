import test from 'node:test';
import assert from 'node:assert/strict';
import {DatabaseSync,backup} from 'node:sqlite';
import {mkdtemp,readFile} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {fileURLToPath} from 'node:url';
import {spawnSync} from 'node:child_process';
import {startLocalDatabase} from '../server/local-database.mjs';
const root=new URL('../',import.meta.url);

test('Release data manifest contains the complete query and factor-recompute inputs',async()=>{
 const m=JSON.parse(await readFile(new URL('data/release-manifest.json',root),'utf8'));
 assert.equal(m.counts.drivers,500);assert.equal(m.counts.events,3152654);assert.equal(m.counts.score_history,4000);
 for(const name of ['risk_events.parquet','trajectory_daily.parquet','imu_daily.parquet','vehicle_profile.parquet'])assert(m.files['scoring-data/data/processed/cleaned/'+name]);
 assert.match(m.bundle.sha256,/^[a-f0-9]{64}$/);assert.equal(new URL(m.bundle.url).hostname,'github.com');
 assert.equal(JSON.parse(await readFile(new URL('var/data-manifest.json',root),'utf8')).history_database,'history.sqlite');
});

test('Distribution bootstrap creates random local accounts, requires a first password change, and preserves existing accounts',async()=>{
 const folder=await mkdtemp(join(tmpdir(),'ie-release-accounts-')),dbPath=join(folder,'platform.sqlite'),original=new DatabaseSync(fileURLToPath(new URL('var/platform.sqlite',root)),{readOnly:true});await backup(original,dbPath);original.close();
 const clean=new DatabaseSync(dbPath);for(const t of ['app_sessions','app_users','user_bindings'])clean.exec('DELETE FROM '+t);clean.close();
 const run=()=>spawnSync(process.execPath,['scripts/setup-local.mjs','--data-dir',folder],{cwd:root,encoding:'utf8',windowsHide:true});
 const first=run();assert.equal(first.status,0,first.stderr);const access=JSON.parse(await readFile(join(folder,'initial-accounts.json'),'utf8'));
 assert.equal(access.accounts.length,3);assert.equal(new Set(access.accounts.map(a=>a.password)).size,3);for(const a of access.accounts){assert(a.password.length>=24);assert(!first.stdout.includes(a.password));}
 const db=new DatabaseSync(dbPath,{readOnly:true});const rows=db.prepare('SELECT user_id,password_hash,must_change_password FROM app_users ORDER BY user_id').all();assert.equal(rows.length,3);assert(rows.every(r=>r.must_change_password===1&&r.password_hash.startsWith('scrypt$')));assert.equal(run().status,0);assert.deepEqual(db.prepare('SELECT user_id,password_hash,must_change_password FROM app_users ORDER BY user_id').all(),rows);db.close();
});

test('The relative history path works with a temporary business copy and the private full-data gateway',async()=>{
 const folder=await mkdtemp(join(tmpdir(),'ie-release-path-')),dbPath=join(folder,'platform.sqlite'),original=new DatabaseSync(fileURLToPath(new URL('var/platform.sqlite',root)),{readOnly:true});await backup(original,dbPath);original.close();
 const gate=await startLocalDatabase({path:dbPath,manifestPath:new URL('var/data-manifest.json',root)});
 try{const r=await fetch(gate.url+'/rest/v1/replay_events?select=event_id&limit=1',{headers:{apikey:gate.token,prefer:'count=exact',connection:'close'}});assert.equal(r.status,200);assert.equal((await r.json()).length,1);assert.match(r.headers.get('content-range'),/\/3152654$/);assert.equal((await fetch(gate.url+'/rest/v1/app_users')).status,401);}finally{await gate.close();}
});

test('Model files have no author-specific Python or scoring-data directory',async()=>{
 const engine=await readFile(new URL('server/scoring-engine.mjs',root),'utf8'),python=await readFile(new URL('scripts/recompute-model.py',root),'utf8');assert(!engine.includes('C:/Users/12446/'));assert(!python.includes('IE-competition-main/IE-competition-main'));assert(engine.includes('.venv/Scripts/python.exe'));assert(python.includes("root/'scoring-data'"));
});
