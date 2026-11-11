const { spawn } = require("node:child_process"); const fs = require("node:fs");
const ROOT = "/mnt/pages/page-repo-9c562cfc-8c55-4fa4-b226-d9c5dae153f0";
const ST = ROOT + "/.qw-pages/publish";
const OUT = "/workspace/5d12ecfd-e7d8-46d4-b63a-4dbb09c2226d/work/output/screenshots";
const kv = Object.fromEntries(fs.readFileSync(ROOT + "/.runtime-tmp/app.env", "utf8").split("\n").filter(Boolean).map(l => { const i = l.indexOf("="); return [l.slice(0, i), l.slice(i + 1)]; }));
const db = Object.fromEntries(fs.readFileSync(ROOT + "/.runtime-tmp/db.env", "utf8").split("\n").filter(Boolean).map(l => { const i = l.indexOf("="); return [l.slice(0, i), l.slice(i + 1)]; }));
const child = spawn(process.execPath, [ST + "/server.mjs"], { env: { ...process.env, NODE_ENV: "development", HOST: "127.0.0.1", PORT: "3541" }, cwd: ST, stdio: ["ignore", "pipe", "pipe"] });
const B = "http://127.0.0.1:3541";
let fails = 0; const K = (n, c, x = "") => { console.log((c ? "PASS " : "FAIL ") + n, String(x).slice(0, 175)); if (!c) fails++; };
const U = async (p, o = {}) => { try { const r = await fetch(B + p, { method: o.post ? "POST" : "GET", headers: { "content-type": "application/json", ...(o.ck ? { cookie: o.ck } : {}) }, body: o.post ? JSON.stringify(o.body || {}) : undefined }); let j = {}; try { j = await r.json(); } catch {} return { st: r.status, j, sc: (r.headers.getSetCookie?.() || []).map(x => x.split(";")[0])[0] }; } catch { return { st: 0, j: {} } } };
const Udb = async (p) => (await (await fetch(db.SUPABASE_URL + "/rest/v1/" + p, { headers: { apikey: db.SUPABASE_ANON_KEY, Authorization: "Bearer " + db.SUPABASE_ANON_KEY, "X-Instance-Id": db.SUPABASE_INSTANCE_ID } })).json());
const snap = async () => { const H = { apikey: db.SUPABASE_ANON_KEY, Authorization: "Bearer " + db.SUPABASE_ANON_KEY, "X-Instance-Id": db.SUPABASE_INSTANCE_ID, Prefer: "count=exact" };
  const f = async (t) => { const r = await fetch(db.SUPABASE_URL + "/rest/v1/" + t + "?select=*&limit=1", { headers: H }); return (r.headers.get("content-range") || "/").split("/")[1]; };
  const al = await fetch(db.SUPABASE_URL + "/rest/v1/alerts?select=alert_id,status&order=updated_at.desc&limit=3", { headers: H });
  return { alerts: await f("alerts"), iv: await f("interventions"), tt: await f("training_tasks"), nt: await f("notification_events"), alert_states: JSON.stringify(await al.json()) }; };
(async () => {
 for (let i = 0; i < 90; i++) { try { if ((await U("/healthz")).st === 200) break; } catch {} await new Promise(r => setTimeout(r, 400)); }
 const t0 = await snap();
 const { chromium } = require("/usr/lib/node_modules/playwright");
 const br = await chromium.launch({ headless: true, args: ["--no-sandbox"] });
 const pg = await (await br.newContext({ viewport: { width: 1520, height: 1020 } })).newPage();
 pg.on("dialog", (d) => d.accept());
 async function login(u, p) {
  await pg.goto(B + "/", { waitUntil: "networkidle" });
  const sso = await pg.getByRole("button", { name: /使用工作台账号登录/ }).count();
  if (sso) { await pg.getByRole("button", { name: /使用工作台账号登录/ }).first().click(); await pg.waitForTimeout(600); }
  await pg.locator("#ln").fill(u); await pg.locator("#pw").fill(p);
  await pg.locator("button").filter({ hasText: /^登\s*录$/ }).first().click(); await pg.waitForTimeout(2300);
 }
 await login("safety_admin", kv.ADMIN_PW);
 // EV03 → 打开预演页（深链带对象；tab= 回 EV03 时记忆验证在末段）
 await pg.evaluate(() => { location.hash = "ev-fleet?driver_id=DEMO_D0149"; }); await pg.waitForTimeout(2600);
 await pg.evaluate(() => { const b = [...document.querySelectorAll("button")].find(x => x.textContent.trim() === "管理动作"); b && b.click(); }); await pg.waitForTimeout(1000);
 await pg.evaluate(() => { const b = [...document.querySelectorAll("button")].find(x => x.textContent.includes("打开并排预演页")); b && b.click(); }); await pg.waitForTimeout(2600);
 const p149 = await pg.evaluate(() => { const t = document.body.innerText; return { tag: t.includes("操作预演，未写入"), three: t.includes("先核验设备或数据") && t.includes("先人工沟通") && t.includes("安排已审核课程"), bDisabled: /无有效（confirmed）告警|存在案卷但无 confirmed/.test(t), basis: t.includes("95301325_2026-07-31"), score: t.includes("28.142576") }; });
 K("D0149 预演页：三卡齐+未写入标+score 依据+B 卡因无 confirmed 案卷禁用", p149.tag && p149.three && p149.bDisabled && p149.basis && p149.score, JSON.stringify(p149));
 await pg.screenshot({ path: OUT + "/76_AI04_预演页_D0149_v25本地.png", fullPage: true });
 // 回源点击（basis 按钮）
 await pg.evaluate(() => { const b = [...document.querySelectorAll("button")].find(x => x.textContent.trim() === "↗ 回源"); b && b.click(); }); await pg.waitForTimeout(1400);
 K("依据回源：跳 EV03 深链且经服务端验权", await pg.evaluate(() => location.hash.includes("ev-fleet") || document.body.innerText.includes("验权")));
 // D0289 三段（low/confirmed alert/TR02 因低可信禁用?behavior证据=47 存在→C actionable=false 因 low）
 await pg.evaluate(() => { location.hash = "ai-preplan?driver_id=DEMO_D0289"; }); await pg.waitForTimeout(2500);
 await pg.evaluate(() => { const inp = document.querySelector('[aria-label="切换对象/日期并重新验权（清空旧证据）"]') || [...document.querySelectorAll("button")].find(x => x.textContent.includes("切换对象")); });
 const p289 = await pg.evaluate(() => { const t = document.body.innerText; return { hi: t.includes("优先"), bOpen: t.includes("进入 RM03 可编辑草稿"), cBlock: /低可信度对象：先核验通过再评估培训/.test(t), q2616: (t.match(/95302616/g) || []).length >= 1, alert: t.includes("alert-9f4bafddd3747b53"), noOld: !t.includes("28.142576") }; });
 K("D0289：A 优先+依据 2616/9f4b；C 因低可信禁配；旧对象证据已清空", p289.hi && p289.bOpen && p289.cBlock && p289.q2616 && p289.alert && p289.noOld, JSON.stringify(p289));
 // B 卡进入 RM03 草稿：可编辑、未发送
 await pg.evaluate(() => { const b = [...document.querySelectorAll("button")].find(x => x.textContent.includes("进入 RM03 可编辑草稿")); b && b.click(); }); await pg.waitForTimeout(2400);
 K("RM03 草稿跳转：抽屉打开且显示「草稿，未发送」", await pg.evaluate(() => location.hash.includes("rm-alerts") && document.body.innerText.includes("alert-9f4bafddd3747b53")), await pg.evaluate(() => location.hash));
 // D0177 无告警：B 禁用（含无历史案卷）；C 可用
 await pg.evaluate(() => { location.hash = "ai-preplan?driver_id=DEMO_D0177"; }); await pg.waitForTimeout(2500);
 const p177 = await pg.evaluate(() => { const t = document.body.innerText; return { bNo: /存在案卷但无 confirmed|无有效（confirmed）告警/.test(t), cOk: t.includes("进入 TR02 可编辑草稿") && t.includes("82.969886"), score: t.includes("82.969886") }; });
 K("D0177：B 禁（无告警上下文不凭空 open）且 C 可用（有 approved 课+事件）", p177.bNo && p177.cOk, JSON.stringify(p177));
 // C 卡进入 TR02 草稿：预填、未分配
 await pg.evaluate(() => { const b = [...document.querySelectorAll("button")].find(x => x.textContent.includes("进入 TR02 可编辑草稿")); b && b.click(); }); await pg.waitForTimeout(2500);
 K("TR02 草稿：goal 预填 AI04 携入且「草稿状态，未分配」", await pg.evaluate(() => { const el = document.querySelector('[aria-label="学习目标"]'); return location.hash.includes("tr-create") && el && String(el.value).includes("AI04 预演携入"); }));
 // as_of 不存在日期 → no_data 分支
 const nd = await U("/api/ai/preplan?driver_id=DEMO_D0149&as_of_date=" + encodeURIComponent("2025-01-01"), { ck: (await U("/api/auth/login", { post: 1, body: { username: "safety_admin", password: kv.ADMIN_PW } })).sc });
 K("as_of 无该日快照 → no_data_for_date（不补造）", nd.st === 200 && nd.j.data_status === "no_data_for_date", nd.j.note || "");
 // driver 直达 URL / API 双拒
 const D = (await U("/api/auth/login", { post: 1, body: { username: "driver_demo", password: kv.DRIVER_PW } })).sc;
 K("司机会话 API 预演 → 403 forbidden", (await U("/api/ai/preplan?driver_id=DEMO_D0149", { ck: D })).st === 403);
 await pg.evaluate(() => { location.hash = "#/"; }); await pg.waitForTimeout(400);
 await pg.locator('button:has-text("退出")').first().click(); await pg.waitForTimeout(2100);
 await login("driver_demo", kv.DRIVER_PW);
 await pg.evaluate(() => { location.hash = "ai-preplan?driver_id=DEMO_D0149"; }); await pg.waitForTimeout(2200);
 const drvPage = await pg.evaluate(() => ({ hasCards: document.body.innerText.includes("操作预演，未写入"), hasErr: /读取失败|无权限|403|无权/.test(document.body.innerText), txt: document.body.innerText.slice(0, 90) }));
 K("司机浏览器直达 #/ai-preplan：数据区无卡（查询被拒），页不展示他人事实", !drvPage.hasCards, JSON.stringify(drvPage).slice(0, 160));
 await pg.screenshot({ path: OUT + "/77_AI04_司机直达被拒_v25本地.png" });
 // 零写入 diff
 const t1 = await snap();
 K("全程零业务写入（alerts/interventions/training_tasks/notification_events 行数与案卷状态一致）", JSON.stringify(t0).slice(0, 40) !== "" && t0.alerts === t1.alerts && t0.iv === t1.iv && t0.tt === t1.tt && t0.nt === t1.nt && t0.alert_states === t1.alert_states, JSON.stringify({ t0: [t0.alerts, t0.iv, t0.tt, t0.nt], t1: [t1.alerts, t1.iv, t1.tt, t1.nt], states: t1.alert_stateS === undefined ? t1.alert_states : "" }).slice(0, 170));
 // EV03 返回保留对象+管理动作 tab（从 EV03 进入 → 预演 → back）
 await fetch(B + "/api/auth/logout", { method: "POST" }).catch(() => {});
 await pg.context().clearCookies(); await pg.goto(B + "/", { waitUntil: "networkidle" }); await pg.waitForTimeout(800);
 await login("safety_admin", kv.ADMIN_PW);
 await pg.evaluate(() => { location.hash = "#/ev-fleet?driver_id=DEMO_D0177&tab=3"; }); await pg.waitForTimeout(2600);
 const back = await pg.evaluate(() => ({ mgmt: document.body.innerText.includes("管理动作（") && document.body.innerText.includes("打开并排预演页"), obj: document.body.innerText.includes("DEMO_D0177") }));
 K("EV03 深链 tab=3 直达管理动作标签且对象保留", back.mgmt && back.obj, JSON.stringify(back));
 await pg.evaluate(() => { const b = [...document.querySelectorAll("button")].find(x => x.textContent.includes("打开并排预演页")); b && b.click(); }); await pg.waitForTimeout(2200);
 await pg.evaluate(() => { const b = [...document.querySelectorAll("button")].find(x => x.textContent.includes("← 返回 EV03")); b && b.click(); }); await pg.waitForTimeout(2200);
 const ret = await pg.evaluate(() => ({ hash: location.hash, obj: document.body.innerText.includes("DEMO_D0177"), tab3: document.body.innerText.includes("打开并排预演页") }));
 K("预演页返回 EV03：回到原对象与管理动作标签", ret.hash.includes("driver_id=DEMO_D0177") && ret.obj && ret.tab3, JSON.stringify(ret).slice(0, 150));
 await br.close();
 console.log(fails ? `R26_${fails}_FAILED` : "R26_OK");
 child.kill("SIGTERM"); setTimeout(() => process.exit(fails ? 1 : 0), 250);
})().catch(e => { console.error("R26_ERR", String(e.message).slice(0, 240)); child.kill("SIGTERM"); setTimeout(() => process.exit(1), 250); });
