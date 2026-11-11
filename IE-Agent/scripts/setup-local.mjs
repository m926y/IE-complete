import {DatabaseSync} from 'node:sqlite';
import {randomBytes,scryptSync} from 'node:crypto';
import {existsSync} from 'node:fs';
import {writeFile} from 'node:fs/promises';
import {fileURLToPath,pathToFileURL} from 'node:url';
import {resolve} from 'node:path';
const args=process.argv.slice(2);if(args.length&&(args.length!==2||args[0]!=='--data-dir'))throw new Error('Usage: node scripts/setup-local.mjs [--data-dir DIRECTORY]');
const dataDir=args.length?pathToFileURL(resolve(args[1])+'/'):new URL('../var/',import.meta.url),path=new URL('platform.sqlite',dataDir),access=new URL('initial-accounts.json',dataDir);
if(!existsSync(path))throw new Error('First restore the dataset: python scripts/install-data.py');
const db=new DatabaseSync(fileURLToPath(path));
try{
 if(db.prepare('SELECT count(*) n FROM app_users').get().n){console.log('Existing accounts preserved. No passwords or bindings were changed.');process.exitCode=0;}
 else{
  if(existsSync(access))throw new Error('Initial account file already exists; keep it and inspect before retrying.');
  const driver=db.prepare("SELECT d.* FROM drivers d JOIN score_snapshots s ON s.driver_id=d.driver_id JOIN vehicle_labels v ON v.gpsno=d.gpsno WHERE s.risk_level IN ('C','D') AND s.confidence_level!='low' ORDER BY v.display_no LIMIT 1").get();
  if(!driver)throw new Error('No eligible demonstration driver in dataset');
  const at=new Date().toISOString(),accounts=[['release-admin','demo_admin','管理员演示账号','safety_admin'],['release-officer','demo_officer','安全员演示账号','safety_officer'],['release-driver','demo_driver','司机演示账号','driver']].map(([id,username,name,role])=>({id,username,name,role,password:'X'+randomBytes(18).toString('base64url')+'9'}));
  db.exec('BEGIN IMMEDIATE');
  try{
   for(const a of accounts){const salt=randomBytes(16),hash=`scrypt$16384$8$1$${salt.toString('hex')}$${scryptSync(a.password,salt,64).toString('hex')}`;db.prepare("INSERT INTO app_users(user_id,username,display_name,role,fleet_scope,default_fleet_id,driver_id,binding_verified,binding_note,account_status,password_hash,must_change_password,created_by,created_at,updated_at) VALUES(?,?,?,?,?,?,?,?,?,'active',?,1,'local-setup',?,?)").run(a.id,a.username,a.name,a.role,a.role==='driver'?driver.fleet_id:'*',driver.fleet_id,a.role==='driver'?driver.driver_id:null,a.role==='driver'?1:0,a.role==='driver'?'当前车辆演示绑定；过去当班身份未知':null,hash,at,at);}
   await writeFile(access,JSON.stringify({created_at:at,notice:'仅保存在本机，请勿上传或转发；首次登录需修改密码。',accounts:accounts.map(a=>({username:a.username,role:a.role,password:a.password}))},null,2)+'\n',{flag:'wx',mode:0o600});
   db.exec('COMMIT');
  }catch(e){db.exec('ROLLBACK');throw e;}
  console.log('Created local demo_admin, demo_officer and demo_driver with random passwords.');
  console.log('Open var/initial-accounts.json on this computer. Passwords were not printed.');
 }
}finally{db.close();}
