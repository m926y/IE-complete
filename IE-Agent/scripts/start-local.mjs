import {homedir} from 'node:os';
import {join} from 'node:path';
import { spawn } from 'node:child_process';
import { startLocalDatabase } from '../server/local-database.mjs';
import { fileURLToPath } from 'node:url';
import { existsSync } from 'node:fs';
const root=new URL('../',import.meta.url);
// Local model credentials stay outside source control and are read only by the server.
const localEnv=fileURLToPath(new URL('.env.local',root));
if(existsSync(localEnv))process.loadEnvFile(localEnv);
const db=await startLocalDatabase({enableDriverReports:true,path:fileURLToPath(new URL('var/platform.sqlite',root)),manifestPath:new URL('var/data-manifest.json',root)});
const bundledPython=join(homedir(),'.cache/codex-runtimes/codex-primary-runtime/dependencies/python/python.exe');
const child=spawn(process.execPath,['server.mjs'],{cwd:root,windowsHide:true,env:{...process.env,PYTHON:process.env.PYTHON||(existsSync(bundledPython)?bundledPython:'python'),HOST:'127.0.0.1',PORT:process.env.LOCAL_PORT||'3100',APP_PREVIEW:'0',APP_DATA_MODE:'full',SUPABASE_URL:db.url,SUPABASE_ANON_KEY:db.token,SUPABASE_INSTANCE_ID:'local-persistent',DATA_MANIFEST_LABEL:'本地完整数据 · 500辆车 · 2026-06-01至2026-07-31'},stdio:'inherit'});
process.on('SIGINT',()=>child.kill());process.on('SIGTERM',()=>child.kill());
child.on('exit',async(code)=>{await db.close();process.exit(code||0);});
