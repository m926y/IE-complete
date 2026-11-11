// Isolated training UI preview; never reads or writes var/platform.sqlite.
import {spawn} from 'node:child_process';
import {startFixtureDatabase} from '../tests/fixtures/account-db.mjs';
const db=await startFixtureDatabase();
db.tables.app_users.push({...db.tables.app_users[1],user_id:'training-preview-two',username:'preview_driver_two',driver_id:'driver-two',fleet_scope:'fleet-two'});
const port=process.env.LOCAL_PORT||'3189';
const child=spawn(process.execPath,['server.mjs'],{cwd:new URL('../',import.meta.url),windowsHide:true,env:{...process.env,HOST:'127.0.0.1',PORT:port,APP_PREVIEW:'1',SUPABASE_URL:db.url,SUPABASE_ANON_KEY:'fixture',SUPABASE_INSTANCE_ID:'fixture'},stdio:'inherit'});
console.log(`培训集成测试界面 http://127.0.0.1:${port}/#/tr-courses | 管理员 preview_admin / PreviewAdmin2026 | 司机 preview_driver、preview_driver_two / PreviewDriver2026 | 仅内存测试数据，重启清空`);
process.on('SIGINT',()=>child.kill());process.on('SIGTERM',()=>child.kill());child.on('exit',async()=>{await db.close();process.exit()});
