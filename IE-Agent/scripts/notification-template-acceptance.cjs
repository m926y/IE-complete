const { spawn } = require("node:child_process"); const fs = require("node:fs");
const ROOT = "/mnt/pages/page-repo-9c562cfc-8c55-4fa4-b226-d9c5dae153f0";
const ST = ROOT + "/.qw-pages/publish";
const OUT = "/workspace/5d12ecfd-e7d8-46d4-b63a-4dbb09c2226d/work/output/screenshots";
const kv = Object.fromEntries(fs.readFileSync(ROOT + "/.runtime-tmp/app.env", "utf8").split("\n").filter(Boolean).map(l => { const i = l.indexOf("="); return [l.slice(0, i), l.slice(i + 1)]; }));
const db = Object.fromEntries(fs.readFileSync(ROOT + "/.runtime-tmp/db.env", "utf8").split("\n").filter(Boolean).map(l => { const i = l.indexOf("="); return [l.slice(0, i), l.slice(i + 1)]; }));
const child = spawn(process.execPath, [ST + "/server.mjs"], { env: { ...process.env, NODE_ENV: "development", HOST: "127.0.0.1", PORT: "3571" }, cwd: ST, stdio: ["ignore", "pipe", "pipe"] });
const B = "http://127.0.0.1:3571";
let fails = 0; const K = (n, c, x = "") => { console.log((c ? "PASS " : "FAIL ") + n, String(x).slice(0, 170)); if (!c) fails++; };
const U = async (p, o = {}) => { try { const r = await fetch(B + p, { method: o.post ? "POST" : "GET", headers: { "content-type": "application/json", ...(o.ck ? { cookie: o.ck } : {}) }, body: o.post ? JSON.stringify(o.body || {}) : undefined }); let j = {}; try { j = await r.json(); } catch {} return { st: r.status, j, sc: (r.headers.getSetCookie?.() || []).map(x => x.split(";")[0])[0] }; } catch { return { st: 0, j: {} } } };
const Hdb = { apikey: db.SUPABASE_ANON_KEY, Authorization: "Bearer " + db.SUPABASE_ANON_KEY, "X-Instance-Id": db.SUPABASE_INSTANCE_ID, Prefer: "count=exact" };
const cnt = async (t) => { const r = await fetch(db.SUPABASE_URL + "/rest/v1/" + t + "?select=*&limit=1", { headers: Hdb }); return (r.headers.get("content-range") || "//").split("/")[1]; };
(async () => {
 for (let i = 0; i < 90; i++) { try { if ((await U("/healthz")).st === 200) break; } catch {} await new Promise(r => setTimeout(r, 400)); }
 const A = (await U("/api/auth/login", { post: 1, body: { username: "safety_admin", password: kv.ADMIN_PW } })).sc;
 const D = (await U("/api/auth/login", { post: 1, body: { username: "driver_demo", password: kv.DRIVER_PW } })).sc;
 const t0 = { al: await cnt("alerts"), iv: await cnt("interventions"), tt: await cnt("training_tasks"), nt: await cnt("notification_events") };
 const tp = await U("/api/admin/templates?review_status=approved&scene=rm3_draft", { ck: A });
 K("admin 列表：迁移未执行 → migration_pending 优雅降级（非 500）", tp.st === 200 && tp.j.migration_pending === true, String(tp.j.note || "").slice(0, 80));
 const dr = await U("/api/admin/templates", { ck: D });
 K("司机访问模板端点 → 403", dr.st === 403);
 const pv = await U("/api/admin/template-preview?template_id=nt-x&driver_id=DEMO_D0149", { ck: A });
 K("预览：pending 态提示（未执行不伪造渲染）", pv.st === 200 && pv.j.migration_pending === true && pv.j.rendered === null);
 const ct = await U("/api/admin/templates", { post: 1, ck: A, body: { action: "create", template_key: "probe_only", title: "t", body: "b" } });
 K("建模板 POST：pending 下同样降级零触碰", ct.st === 200 && ct.j.migration_pending === true);
 const pa = await U("/api/admin/templates/anything%3A1", { post: 0, ck: A }); // GET 不存在路由 → 404 正常
 // UI 降级提示
 const { chromium } = require("/usr/lib/node_modules/playwright");
 const br = await chromium.launch({ headless: true, args: ["--no-sandbox"] });
 const pg = await (await br.newContext({ viewport: { width: 1480, height: 1000 } })).newPage();
 await pg.goto(B + "/", { waitUntil: "networkidle" });
 const sso = await pg.getByRole("button", { name: /使用工作台账号登录/ }).count();
 if (sso) { await pg.getByRole("button", { name: /使用工作台账号登录/ }).first().click(); await pg.waitForTimeout(600); }
 await pg.locator("#ln").fill("safety_admin"); await pg.locator("#pw").fill(kv.ADMIN_PW);
 await pg.locator("button").filter({ hasText: /^登\s*录$/ }).first().click(); await pg.waitForTimeout(2200);
 await pg.evaluate(() => { location.hash = "#/sm-knowledge"; }); await pg.waitForTimeout(1200);
 await pg.locator('button[aria-label="通知模板标签"]').click(); await pg.waitForTimeout(1500);
 K("SM06 第三标签显示「待属主执行迁移」提示且无假列表", await pg.evaluate(() => document.body.innerText.includes("迁移 005") && document.body.innerText.includes("尚未执行") && !document.body.innerText.includes("已审核·可引用")));
 await pg.screenshot({ path: OUT + "/78_SM06_通知模板标签_待属主_v25本地.png" });
 await pg.evaluate(() => { location.hash = "#/rm-alerts?alert_id=alert-9f4bafddd3747b53"; }); await pg.waitForTimeout(2200);
 K("RM03 抽屉显示模板 pending 提示（未迁移不显示可选模板）", await pg.evaluate(() => document.body.innerText.includes("迁移 005 未执行") || document.body.innerText.includes("待属主")));
 await br.close();
 const t1 = { al: await cnt("alerts"), iv: await cnt("interventions"), tt: await cnt("training_tasks"), nt: await cnt("notification_events") };
 K("全程零业务写入（四表行数 diff 相同）", JSON.stringify(t0) === JSON.stringify(t1), JSON.stringify({ t0, t1 }));
 console.log("BLOCKED(待属主执行迁移005后复测): 引用待审/停用模板409、已审核按key:version引用200、改正文产新draft不覆盖、预览填真实事实(event_date=2026-07-31, evidence_type=data_verification；缺review_note→待核)、无绑定账号发送不显示已送达、确认前 interventions/notification_events 零写、重发幂等(既有链路已验)");
 console.log(fails ? `R27_${fails}_FAILED` : "R27_OK_PENDING");
 child.kill("SIGTERM"); setTimeout(() => process.exit(fails ? 1 : 0), 250);
})();
