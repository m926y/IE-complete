// Resumes driver 96's exact task in a disposable copy; never writes the real record.
import {DatabaseSync,backup} from 'node:sqlite';
import {mkdtemp} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {fileURLToPath} from 'node:url';
import {spawn} from 'node:child_process';
import {startLocalDatabase} from '../server/local-database.mjs';
import {passwordHash} from '../tests/fixtures/account-db.mjs';
const root=new URL('../',import.meta.url),folder=await mkdtemp(join(tmpdir(),'ie-driver96-')),path=join(folder,'platform.sqlite');
const source=new DatabaseSync(new URL('var/platform.sqlite',root),{readOnly:true});await backup(source,path);source.close();
const setup=new DatabaseSync(path);setup.exec('DELETE FROM app_sessions');
const driver=setup.prepare("SELECT u.* FROM app_users u JOIN drivers d ON d.driver_id=u.driver_id JOIN vehicle_labels v USING(gpsno) WHERE v.display_no=96 AND u.role='driver'").get();if(!driver)throw Error('driver96_not_found');
setup.prepare('UPDATE app_users SET password_hash=?,must_change_password=0 WHERE user_id=?').run(passwordHash('TestDriver962026'),driver.user_id);
setup.prepare("INSERT INTO app_users(user_id,username,role,fleet_scope,account_status,password_hash,must_change_password) VALUES('qa-driver96-admin','qa_driver96_admin','safety_admin','*','active',?,0)").run(passwordHash('TestDriver962026'));setup.close();
const gateway=await startLocalDatabase({path,manifestPath:new URL('var/data-manifest.json',root)});
const child=spawn(process.execPath,['server.mjs'],{cwd:root,windowsHide:true,env:{HOST:'127.0.0.1',PORT:'3102',APP_DATA_MODE:'full',SUPABASE_URL:gateway.url,SUPABASE_ANON_KEY:gateway.token,SUPABASE_INSTANCE_ID:'driver96-copy'},stdio:'inherit'});
console.log('Disposable driver96 UI: http://127.0.0.1:3102 | username '+driver.username);
process.on('SIGINT',()=>child.kill());process.on('SIGTERM',()=>child.kill());child.on('exit',async code=>{await gateway.close();process.exit(code||0)});
