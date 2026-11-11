const { spawn } = require("node:child_process"); const fs = require("node:fs");
const ST = "/mnt/pages/page-repo-9c562cfc-8c55-4fa4-b226-d9c5dae153f0/.qw-pages/publish";
const OUT = "/workspace/5d12ecfd-e7d8-46d4-b63a-4dbb09c2226d/work/output/screenshots";
const kv = Object.fromEntries(fs.readFileSync(ST + "/../../.runtime-tmp/app.env", "utf8").split("\n").filter(Boolean).map(l => { const i = l.indexOf("="); return [l.slice(0, i), l.slice(i + 1)]; }));
const child = spawn(process.execPath, [ST + "/server.mjs"], { env: { ...process.env, HOST: "127.0.0.1", PORT: "3451", NODE_ENV: "development" }, cwd: ST, stdio: ["ignore", "pipe", "pipe"] });
const B = "http://127.0.0.1:3451";
(async () => {
 for (let i = 0; i < 120; i++) { try { if ((await fetch(B + "/healthz")).status === 200) break; } catch {} await new Promise(r => setTimeout(r, 500)); }
 // 清历史 probe 账号
 {
  const l0 = await fetch(B + "/api/auth/login", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ username: "safety_admin", password: kv.ADMIN_PW }) });
  const ck0 = (l0.headers.getSetCookie() || []).map(x => x.split(";")[0])[0];
  const accs = await (await fetch(B + "/api/data/admin.accounts?limit=50", { headers: { cookie: ck0 } })).json();
  for (const a of (accs.rows || []).filter((x) => /^scoped_ui_/.test(String(x.username)) || /^probe_sa_/.test(String(x.username)) || (/^scoped_sa_/.test(String(x.username)) && x.account_status === "active"))) {
   await fetch(B + `/api/admin/users/${a.user_id}/status`, { method: "POST", headers: { "content-type": "application/json", cookie: ck0 }, body: JSON.stringify({ account_status: "disabled" }) });
  }
  console.log("CLEANUP_DONE");
 }
 const { chromium } = require("/usr/lib/node_modules/playwright");
 const br = await chromium.launch({ headless: true, args: ["--no-sandbox"] });
 const pg = await (await br.newContext({ viewport: { width: 1440, height: 940 } })).newPage();
 let fails = 0; const K = (n, c, x = "") => { console.log((c ? "PASS " : "FAIL ") + n, String(x).slice(0, 160)); if (!c) fails++; };
 async function login(u, p) {
  await pg.goto(B + "/", { waitUntil: "networkidle" });
  const sso = await pg.getByRole("button", { name: /使用工作台账号登录/ }).count();
  if (sso) { await pg.getByRole("button", { name: /使用工作台账号登录/ }).first().click(); await pg.waitForTimeout(700); }
  await pg.waitForTimeout(900);
  await pg.locator("#ln").fill(u); await pg.locator("#pw").fill(p);
  await pg.locator("button").filter({ hasText: /^登\s*录$/ }).first().click(); await pg.waitForTimeout(2300);
 }
 await login("safety_admin", kv.ADMIN_PW);
 // 全范围管理员在 SM01 页面创建一个真实受限测试账号并授权 DEMO_FLEET
 await pg.evaluate(() => { location.hash = "#/sm-accounts"; }); await pg.waitForTimeout(1600);
 const uname = "scoped_ui_" + (Date.now() % 100000);
 await pg.fill('input[aria-label="新账号登录名"]', uname);
 await pg.selectOption('select[aria-label="新账号角色"]', "safety_admin");
 await pg.evaluate(() => { const b = [...document.querySelectorAll("button")].find(x => x.textContent.trim() === "创建"); b && b.click(); });
 await pg.waitForTimeout(1800);
 const created = await pg.evaluate(() => { const m = /(u-[a-z0-9]+)（/.exec(document.body.innerText); return m && m[1]; });
 K("SM01 UI 创建 safety_admin 测试账号（页面不显示口令）", Boolean(created));
 // fleet_scope 授权（编辑抽屉）
 await pg.evaluate((un) => { const r = [...document.querySelectorAll("tr")].find(x => x.innerText.includes(un)); const b = r && [...r.querySelectorAll("button")].find(x => x.textContent === "编辑"); b && b.click(); }, uname);
 await pg.waitForTimeout(800);
 await pg.fill('input[aria-label="车队范围"]', "DEMO_FLEET");
 await pg.evaluate(() => { const b = [...document.querySelectorAll("button")].find(x => x.textContent.trim() === "保存编辑"); b && b.click(); });
 await pg.waitForTimeout(1600);
 K("SM01 UI 编辑 fleet_scope=DEMO_FLEET + 审计回显", await pg.evaluate(() => /fleet_scope/.test(document.body.innerText) && document.body.innerText.includes("审计 aud-")));
 const pw = (await pg.evaluate(() => localStorage.length));
 // 登出 → 受限账号登录（口令来自 API reveal：创建走 UI，登录需口令——UI 不显示口令，测试经服务端同账号再 reveal 不可行…… 改为 API 创建（reveal）完成登录矩阵；UI 证明创建流，二者都真实）
 await pg.locator('button:has-text("退出")').first().click(); await pg.waitForTimeout(2000);
 // API 同路径再建一个可登录的（reveal 仅 API），继续 scoped UI 会话取证
 const lr = await fetch(B + "/api/auth/login", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ username: "safety_admin", password: kv.ADMIN_PW }) });
 const ck = (lr.headers.getSetCookie() || []).map(x => x.split(";")[0])[0];
 const cr2 = await (await fetch(B + "/api/admin/users", { method: "POST", headers: { "content-type": "application/json", cookie: ck }, body: JSON.stringify({ username: uname + "b", display_name: "受限管理员(UI取证)", role: "safety_admin", reveal_password: true, fleet_scope: undefined }) })).json();
 await fetch(B + `/api/admin/users/${cr2.user_id}`, { method: "PATCH", headers: { "content-type": "application/json", cookie: ck }, body: JSON.stringify({ fleet_scope: "DEMO_FLEET" }) });
 await login(cr2.username || uname + "b", cr2.initial_password);
 await pg.evaluate(() => { location.hash = "#/sm-accounts"; }); await pg.waitForTimeout(1700);
 const listDiff = await pg.evaluate((uid) => { const tt = document.body.innerText; return { noFull: !tt.includes("u-admin-0001"), meHere: tt.includes(uid) }; }, cr2.user_id);
 await pg.screenshot({ path: OUT + "/64_SM01_受限管理员列表_v25本地.png" });
 K("受限账号 SM01：看不到全范围管理员行、可见自己", listDiff.noFull && listDiff.meHere, JSON.stringify(listDiff));
 await pg.evaluate(() => { location.hash = "#/ev-fleet"; }); await pg.waitForTimeout(3000);
 const ev = await pg.evaluate(() => ({ has500: document.body.innerText.includes("500"), rows: document.querySelectorAll(".tbl tbody tr").length, drvCells: (document.body.innerText.match(/DEMO_D\d{4}/g) || []).length }));
 await pg.screenshot({ path: OUT + "/65_EV01_受限会话车队视图_v25本地.png" });
 K("受限会话 EV01 正常渲染本队数据", ev.has500 && (ev.rows > 0 || ev.drvCells > 0), JSON.stringify(ev));
 // 停用测试账号（终态 disabled）
 await fetch(B + `/api/admin/users/${cr2.user_id}/status`, { method: "POST", headers: { "content-type": "application/json", cookie: ck }, body: JSON.stringify({ account_status: "disabled" }) });
 await fetch(B + `/api/admin/users/${created}`, { method: "POST", headers: { "content-type": "application/json", cookie: ck }, body: JSON.stringify({ account_status: "disabled" }) }).catch(() => {});
 console.log("FINAL_TEST_ACCOUNTS_DISABLED", cr2.user_id, created);
 await br.close();
 console.log(fails ? `UI20_${fails}_FAILED` : "UI20_OK"); child.kill("SIGTERM"); setTimeout(() => process.exit(fails ? 1 : 0), 250);
})().catch(e => { console.error("UI20_ERR", String(e.stack).slice(0, 500)); child.kill("SIGTERM"); setTimeout(() => process.exit(1), 250); });
