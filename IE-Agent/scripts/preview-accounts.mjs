// Local-only validation environment. All business/model credentials are omitted.
import { spawn } from 'node:child_process';
import { startFixtureDatabase } from '../tests/fixtures/account-db.mjs';
const db = await startFixtureDatabase();
const child = spawn(process.execPath, ['server.mjs'], { cwd: new URL('../', import.meta.url), windowsHide: true,
  env: { HOST: '127.0.0.1', PORT: '3100', APP_PREVIEW: '1', SUPABASE_URL: db.url, SUPABASE_ANON_KEY: 'local-fixture', SUPABASE_INSTANCE_ID: 'fixture' }, stdio: 'inherit' });
console.log('本地测试界面 http://127.0.0.1:3100 | 安全员 preview_admin / PreviewAdmin2026 | 司机 preview_driver / PreviewDriver2026');
process.on('SIGINT', () => child.kill());
process.on('SIGTERM', () => child.kill());
child.on('exit', async () => { await db.close(); process.exit(); });
