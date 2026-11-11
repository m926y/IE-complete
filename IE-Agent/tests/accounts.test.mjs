import test from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { createServer } from 'node:net';
import { once } from 'node:events';
import { startFixtureDatabase } from './fixtures/account-db.mjs';

test('S1 lifecycle, both-role account settings, credential revocation and vehicle labels', async t => {
  const db = await startFixtureDatabase();
  const socket = createServer();
  await new Promise(resolve => socket.listen(0, '127.0.0.1', resolve));
  const port = socket.address().port;
  await new Promise(resolve => socket.close(resolve));
  const child = spawn(process.execPath, ['server.mjs'], {
    cwd: new URL('../', import.meta.url), windowsHide: true,
    env: { HOST: '127.0.0.1', PORT: String(port), SUPABASE_URL: db.url, SUPABASE_ANON_KEY: 'test', SUPABASE_INSTANCE_ID: 'fixture' }, stdio: ['ignore', 'pipe', 'pipe'],
  });
  let output = ''; child.stderr.on('data', x => output += x);
  const base = `http://127.0.0.1:${port}`;
  async function call(path, { cookie, method = 'GET', body } = {}) {
    const response = await fetch(base + path, { method, headers: { 'content-type': 'application/json', ...(cookie ? { cookie } : {}) }, body: body === undefined ? undefined : JSON.stringify(body) });
    return { status: response.status, body: await response.json(), cookie: response.headers.get('set-cookie')?.split(';')[0], cache: response.headers.get('cache-control') };
  }
  async function login(username, password) { return call('/api/auth/login', { method: 'POST', body: { username, password } }); }
  try {
    for (let i = 0; i < 80; i++) { try { if ((await fetch(base + '/healthz')).ok) break; } catch {} await new Promise(r => setTimeout(r, 50)); }
    const admin = (await login('preview_admin', 'PreviewAdmin2026')).cookie;
    const driver = (await login('preview_driver', 'PreviewDriver2026')).cookie;
    await t.test('unauthenticated requests are refused', async () => { assert.equal((await call('/api/me/account')).status, 401); });
    let initial;
    await t.test('admin creates a new driver and receives one-time credential', async () => {
      const r = await call('/api/admin/users', { cookie: admin, method: 'POST', body: { username: 'new_driver', role: 'driver', display_name: '新司机', reveal_password: true } });
      assert.equal(r.status, 201); assert.equal(r.cache, 'no-store'); initial = r.body.initial_password;
      assert.ok(initial.length >= 10); assert.equal(Boolean(db.tables.app_users.at(-1).must_change_password), true);
      assert.ok(!JSON.stringify(r.body).includes('password_hash'));
    });
    let fresh;
    await t.test('new driver must change password before business APIs', async () => {
      fresh = (await login('new_driver', initial)).cookie;
      assert.equal((await call('/api/me', { cookie: fresh })).body.user.mustChangePassword, true);
      assert.equal((await call('/api/data/my.trainings', { cookie: fresh })).body.error, 'password_change_required');
    });
    await t.test('wrong current password and weak new password are rejected', async () => {
      assert.equal((await call('/api/me/password', { cookie: fresh, method: 'POST', body: { current_password: 'bad', new_password: 'NewPassword2026' } })).status, 403);
      assert.equal((await call('/api/me/password', { cookie: fresh, method: 'POST', body: { current_password: initial, new_password: 'short' } })).status, 400);
    });
    await t.test('password change invalidates every old session and old credential', async () => {
      const another = (await login('new_driver', initial)).cookie;
      assert.equal((await call('/api/me/password', { cookie: fresh, method: 'POST', body: { current_password: initial, new_password: 'NewPassword2026' } })).status, 200);
      assert.equal((await call('/api/me', { cookie: fresh })).status, 401);
      assert.equal((await call('/api/me', { cookie: another })).status, 401);
      assert.equal((await login('new_driver', initial)).status, 401);
      fresh = (await login('new_driver', 'NewPassword2026')).cookie;
      assert.equal((await call('/api/me', { cookie: fresh })).body.user.mustChangePassword, false);
      assert.equal((await call('/api/data/my.trainings', { cookie: fresh })).body.error, 'binding_required');
    });
    await t.test('both roles save profile and avatar; user_id and role cannot expand access', async () => {
      for (const [cookie, label] of [[admin, '管理员更新'], [driver, '司机更新']]) {
        const r = await call('/api/me/account', { cookie, method: 'PATCH', body: { display_name: label, avatar_url: 'preset:3', user_id: 'another', role: 'safety_admin', binding_verified: true } });
        assert.equal(r.status, 200); assert.equal(r.body.user.displayName, label); assert.equal(r.body.user.avatarUrl, 'preset:3');
      }
      assert.equal((await call('/api/me', { cookie: driver })).body.user.role, 'driver');
      assert.equal((await call('/api/me/account', { cookie: driver, method: 'PATCH', body: { avatar_url: 'data:image/svg+xml;base64,PHN2Zz4=' } })).status, 400);
      const png = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+a3ioAAAAASUVORK5CYII=';
      assert.equal((await call('/api/me/account', { cookie: driver, method: 'PATCH', body: { avatar_url: png } })).status, 200);
      assert.equal((await call('/api/me', { cookie: driver })).body.user.avatarUrl, png);
    });
    await t.test('rename checks current password and uniqueness, persists across login', async () => {
      assert.equal((await call('/api/me/account', { cookie: driver, method: 'PATCH', body: { username: 'driver_renamed' } })).status, 403);
      assert.equal((await call('/api/me/account', { cookie: driver, method: 'PATCH', body: { username: 'preview_admin', current_password: 'PreviewDriver2026' } })).status, 409);
      assert.equal((await call('/api/me/account', { cookie: driver, method: 'PATCH', body: { username: 'driver_renamed', current_password: 'PreviewDriver2026' } })).status, 200);
      assert.equal((await login('preview_driver', 'PreviewDriver2026')).status, 401);
      assert.equal((await login('driver_renamed', 'PreviewDriver2026')).status, 200);
    });
    await t.test('driver sees only own persistent vehicle alias', async () => {
      const r = await call('/api/vehicles/labels', { cookie: driver });
      assert.equal(r.status, 200); assert.deepEqual(r.body.rows, [{ gpsno: 'TEST-VEHICLE-RAW-01', label: '车辆1' }]);
      assert.equal((await call('/api/vehicles/labels', { cookie: admin })).body.rows.length, 2);
    });
    await t.test('driver cannot create accounts and audit contains no credentials', async () => {
      assert.equal((await call('/api/admin/users', { cookie: driver, method: 'POST', body: { username: 'intruder', role: 'safety_admin' } })).status, 403);
      const audit = JSON.stringify(db.tables.audit_logs);
      assert.ok(!audit.includes(initial)); assert.ok(!audit.includes('NewPassword2026')); assert.ok(!audit.includes('password_hash'));
    });
    await t.test('admin creation also enforces first login password change', async () => {
      const r = await call('/api/admin/users', { cookie: admin, method: 'POST', body: { username: 'new_admin', role: 'safety_admin', reveal_password: true } });
      assert.equal(r.status, 201);
      const session = (await login('new_admin', r.body.initial_password)).cookie;
      assert.equal((await call('/api/me', { cookie: session })).body.user.mustChangePassword, true);
      assert.equal((await call('/api/admin/users', { cookie: session, method: 'POST', body: { username: 'blocked_admin', role: 'safety_admin' } })).body.error, 'password_change_required');
    });
    await t.test('new driver can be verified and bound through existing S1 business endpoint', async () => {
      const newUser = db.tables.app_users.find(x => x.username === 'new_driver');
      const r = await call('/api/admin/bindings', { cookie: admin, method: 'POST', body: { user_id: newUser.user_id, driver_id: 'driver-two', verified: true, note: 'isolated account lifecycle test', window: { start: '2026-07-01', end: null } } });
      assert.equal(r.status, 200, JSON.stringify(r.body));
      const me = await call('/api/me', { cookie: fresh });
      assert.equal(me.body.user.driverId, 'driver-two'); assert.equal(me.body.user.bindingVerified, true);
      assert.equal((await call('/api/data/my.trainings', { cookie: fresh })).status, 200);
    });
    await t.test('account deletion refuses self, driver and cross-fleet writes', async () => {
      const newUser = db.tables.app_users.find(x=>x.username==='new_driver');
      assert.equal((await call('/api/admin/users/test-admin',{cookie:admin,method:'DELETE'})).body.error,'cannot_delete_self');
      assert.equal((await call('/api/admin/users/'+newUser.user_id,{cookie:driver,method:'DELETE'})).status,403);
      db.tables.app_users.push({user_id:'scoped-deleter',username:'scoped_deleter',role:'safety_officer',fleet_scope:'fleet-one',account_status:'active',password_hash:db.tables.app_users[0].password_hash});
      const scoped=(await login('scoped_deleter','PreviewAdmin2026')).cookie;
      assert.equal((await call('/api/admin/users/'+newUser.user_id,{cookie:scoped,method:'DELETE'})).status,403);
      assert.equal((await call('/api/admin/users/test-admin',{cookie:scoped,method:'DELETE'})).status,403);
      assert.ok(db.tables.app_users.some(x=>x.user_id===newUser.user_id));
    });
    await t.test('deleting account removes login, revokes sessions, closes bindings and retains history', async () => {
      const newUser=db.tables.app_users.find(x=>x.username==='new_driver');
      const history={task_id:'retained-learning',driver_id:'driver-two',status:'submitted',learning_record:'preserved'};
      db.tables.training_tasks.push(history);
      db.tables.user_bindings.push({binding_id:'delete-test',user_id:newUser.user_id,driver_id:'driver-two',account_status:'active',effective_end:null});
      const result=await call('/api/admin/users/'+newUser.user_id,{cookie:admin,method:'DELETE'});
      assert.equal(result.status,200,JSON.stringify(result.body));
      assert.ok(!db.tables.app_users.some(x=>x.user_id===newUser.user_id));
      assert.ok(!db.tables.app_sessions.some(x=>x.user_id===newUser.user_id));
      assert.equal((await call('/api/me',{cookie:fresh})).status,401);
      assert.equal((await login('new_driver','NewPassword2026')).status,401);
      assert.equal(db.tables.user_bindings.find(x=>x.binding_id==='delete-test').account_status,'disabled');
      assert.ok(db.tables.user_bindings.find(x=>x.binding_id==='delete-test').effective_end);
      assert.deepEqual(db.tables.training_tasks.find(x=>x.task_id==='retained-learning'),history);
      assert.ok(db.tables.audit_logs.some(x=>x.entity_id===newUser.user_id&&x.action==='account.delete'));
      assert.ok(!(await call('/api/data/admin.accounts',{cookie:admin})).body.rows.some(x=>x.user_id===newUser.user_id));
    });
  } finally { const closed = once(child, 'exit'); child.kill(); await closed; await db.close(); }
});
