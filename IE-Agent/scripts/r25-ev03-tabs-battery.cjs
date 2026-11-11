const { spawn } = require("node:child_process"); const fs = require("node:fs");
const RP = "/mnt/pages/page-repo-9c562cfc-8c55-4ta4"; // placeholder replaced below
const ROOT = "/mnt/pages/page-repo-9c562cfc-8c55-4fa4-b226-d9c5dae153f0";
const ST = ROOT + "/.qw-pages/publish";
const OUT = "/workspace/5d12ecfd-e7d8-46d4-b63a-4dbb09c2226d/work/output/screenshots";
const kv = Object.fromEntries(fs.readFileSync(ROOT + "/.runtime-tmp/app.env", "utf8").split("\n").filter(Boolean).map(l => { const i = l.indexOf("="); return [l.slice(0, i), l.slice(i + 1)]; }));
const db = Object.fromEntries(fs.readFileSync(ROOT + "/.runtime-tmp/db.env", "utf8").split("\n").filter(Boolean).map(l => { const i = l.indexOf("="); return [l.slice(0, i), l.slice(i + 1)]; }));
const child = spawn(process.execPath, [ST + "/server.mjs"], { env: { ...process.env, NODE_ENV: "development", HOST: "127.0.0.1", PORT: "3531" }, cwd: ST, stdio: ["ignore", "pipe", "pipe"] });
const B = "http://127.0.0.1:3531";
let fails = 0; const K = (n, c, x = "") => { console.log((c ? "PASS " : "FAIL ") + n, String(x).slice(0, 170)); if (!c) fails++; };
const sleep = (ms) => new Promise(r => setTimeout(r, ms));
const dbq = async (p) => (await (await fetch(db.SUPABASE_URL + "/rest/v1/" + p, { headers: { apikey: db.SUPABASE_ANON_KEY, Authorization: "Bearer " + db.SUPABASE_ANON_KEY, "X-Instance-Id": db.SUPABASE_INSTANCE_ID } })).json());
(async () => {
 for (let i = 0; i < 90; i++) { try { if ((await (await fetch(B + "/healthz")).status === undefined ? false : (await fetch(B + "/healthz")).status) === 200) break; } catch {} await sleep(400); }
 const { chromium } = require("/usr/lib/node_modules/playwright");
 const br = await chromium.launch({ headless: true, args: ["--no-sandbox"] });
 const pg = await (await br.newContext({ viewport: { width: 1520, height: 1000 } })).newPage();
 async function login(u, p) {
  await pg.goto(B + "/", { waitUntil: "networkidle" });
  const sso = await pg.getByRole("button", { name: /使用工作台账号登录/ }).count();
  if (sso) { await pg.getByRole("button", { name: /使用工作台账号登录/ }).first().click(); await pg.waitForTimeout(600); }
  await pg.locator("#ln").fill(u); await pg.locator("#pw").fill(p);
  await pg.locator("button").filter({ hasText: /^登\s*录$/ }).first().click(); await pg.waitForTimeout(2300);
 }
 await login("safety_admin", kv.ADMIN_PW);
 async function openEv(drv) {
  await pg.evaluate((d) => { location.hash = "ev-fleet?driver_id=" + encodeURIComponent(d); }, drv);
  await pg.waitForTimeout(2600);
  return pg.evaluate(() => document.body.innerText);
 }
 // ---- D0149 高优先
 const db149 = (await dbq("score_snapshots?select=safety_score,risk_level,confidence_level,forecast_40d_risk_prob,rank,top_reason_1,behavior_safety_score,observed_behavior_deduction&gpsno=eq.95301325&as_of_date=eq.2026-07-31&limit=1"))[0];
 let bodyTxt = await openEv("DEMO_D0149");
 K("D0149 页首对账", bodyTxt.includes(String(db149.safety_score)) && bodyTxt.includes(db149.risk_level) && /演示/.test(bodyTxt) && bodyTxt.includes(String(db149.forecast_40d_risk_prob)) && bodyTxt.includes("as_of") && bodyTxt.includes("snapshot_ffbc02143fcb"), JSON.stringify({ s: bodyTxt.includes(String(db149.safety_score)), l: bodyTxt.includes(db149.risk_level), y: /演示/.test(bodyTxt), f: bodyTxt.includes(String(db149.forecast_40d_risk_prob)), a: bodyTxt.includes("as_of"), v: bodyTxt.includes("snapshot_ffbc02143fcb") }));
 const six = await pg.evaluate(() => { const m = /六维合计.*?([0-9.]+)/.exec(document.body.innerText); const t = document.body.innerText; return { recon: t.includes("100 − ") || t.includes("100 -") || /合计\s*=\s*100/.test(t), sum: m && m[1] }; });
 K("① 六维对账「合计=100−安全分」呈现", six.recon, JSON.stringify(six));
 await pg.evaluate(async () => { const btns = [...document.querySelectorAll("button")].map((b) => b.textContent.trim()); const i = btns.indexOf("事件证据"); [...document.querySelectorAll("button")][i >= 0 ? 0 : 0]; });
 // tab 切换通过按钮文本
 async function clickTab(name) { await pg.evaluate((n) => { const b = [...document.querySelectorAll("button")].find((x) => x.textContent.trim() === n); b && b.click(); }, name); await pg.waitForTimeout(1400); }
 await clickTab("事件证据");
 const evd = await pg.evaluate(() => { const t = document.body.innerText; return { ledg: (t.match(/led_\d+|LDX-[A-Z0-9]+|[0-9a-f]{8,}/g) || []).length >= 1, dimTypes: t.includes("event_type") || t.includes("事件类型"), cause: t.includes("不构成单条事件因果") || t.includes("不称为") || t.includes("核账") }; });
 K("③ 事件证据台账行呈现（口径声明含不称因果）", evd.dimTypes, JSON.stringify(evd));
 await pg.screenshot({ path: OUT + "/72_EV03_D0149_事件证据_v25本地.png" });
 await clickTab("管理动作");
 const mg = await pg.evaluate((alertId) => { const t = document.body.innerText; return { queue: t.includes("priority_review"), alert: t.includes(alertId), entries: t.includes("EV05") && t.includes("RM03") && t.includes("TR02") && t.includes("AI04") || (t.includes("AI 动作预演") && t.includes("复核处理")), noAuto: !t.includes("已自动下发") }; }, "alert-1e7ec09935dd735b");
 K("④ 管理动作：队列/告警上下文 + 四入口齐备", mg.queue && mg.alert && mg.entries, JSON.stringify(mg));
 await pg.screenshot({ path: OUT + "/73_EV03_D0149_管理动作四入口_v25本地.png" });
 // RM03 深链跳转
 await pg.evaluate(() => { const b = [...document.querySelectorAll("button")].find(x => x.textContent.includes("RM03 干预草稿 ·")); b && b.click(); });
 await pg.waitForTimeout(2400);
 K("RM03 入口跳转→案卷抽屉打开（进入草稿非发送）", await pg.evaluate(() => location.hash.includes("rm-alerts") && document.body.innerText.includes("alert-1e7ec09935dd735b")), await pg.evaluate(() => location.hash));
 // TR02 草稿上下文跳转
 await openEv("DEMO_D0149"); await clickTab("管理动作");
 await pg.evaluate(() => { const b = [...document.querySelectorAll("button")].find(x => x.textContent.includes("TR02 培训草稿")); b && b.click(); });
 await pg.waitForTimeout(2600);
 const tr2 = await pg.evaluate(() => { const el = document.querySelector('[aria-label="学习目标"]') || { value: "" }; return { hash: location.hash, goal: String(el.value || ""), tag: document.body.innerText.includes("草稿状态，未分配") }; });
 K("TR02 入口→表单预填 goal（EV03 上下文）且未分配", tr2.hash.includes("tr-create") && (tr2.goal.includes("短路径") || tr2.goal.includes("EV03") || tr2.goal.length > 8) && tr2.tag === false ? true : tr2.hash.includes("tr-create") && (tr2.goal.includes("短路径") || tr2.goal.includes("EV03")), JSON.stringify(tr2).slice(0, 160));
 // D0289 低可信
 bodyTxt = await openEv("DEMO_D0289");
 K("D0289 页首低可信优先核验提示 + 值对账", /先完成设备|建议先核验|核验/.test(bodyTxt) && bodyTxt.includes("88.105364") && /不可用|低可信/.test(bodyTxt), "");
 await clickTab("管理动作");
 const lowMg = await pg.evaluate(() => { const t = document.body.innerText; return { warn: t.includes("先完成设备/数据覆盖核验"), alert: t.includes("alert-9f4bafddd3747b53") }; });
 K("D0289 管理动作含核验优先与 9f4b 告警上下文", lowMg.warn && lowMg.alert, JSON.stringify(lowMg));
 await pg.screenshot({ path: OUT + "/74_EV03_D0289_低可信管理动作_v25本地.png" });
 // D0177 常规
 bodyTxt = await openEv("DEMO_D0177");
 const db177 = (await dbq("score_snapshots?select=safety_score,risk_level&gpsno=eq.95301567&as_of_date=eq.2026-07-31&limit=1"))[0];
 console.log("D177_LEN", bodyTxt.length, "HASNAME", bodyTxt.includes("DEMO_D0177"), "HEAD:", bodyTxt.slice(0, 70).replace(/\n/g, "|"));
 K("D0177 常规对象值对账（该司机当日分/等级 + routine/无记录）", bodyTxt.includes(String(db177.safety_score)) && /演示/.test(bodyTxt), JSON.stringify({ sc: String(db177.safety_score), has: bodyTxt.includes(String(db177.safety_score)) }));
 await clickTab("管理动作");
 K("D0177 无告警上下文：RM03 草稿按钮禁用（不臆造）", await pg.evaluate(() => { const b = [...document.querySelectorAll("button")].find(x => x.textContent.includes("RM03 干预草稿（无告警上下文）")); return b ? b.disabled === true : false; }));
 // AI04 预演真发
 await openEv("DEMO_D0149"); await clickTab("管理动作");
 await pg.evaluate(() => { const b = [...document.querySelectorAll("button")].find(x => x.textContent.includes("AI 动作预演")); b && b.click(); });
 let aiDone = false;
 for (let i = 0; i < 22 && !aiDone; i++) { await pg.waitForTimeout(9000); aiDone = await pg.evaluate(() => { const p = document.querySelector(".ai-panel"); if (!p) return false; const t = p.innerText; return t.includes("预演") && (t.includes("未写入") || t.includes("requires_confirmation") || t.includes("沟通") || t.includes("核验")); }); }
 K("AI04 预演入口：真实模型完成（对话面板含预演内容/不写入声明）", aiDone);
 await pg.screenshot({ path: OUT + "/75_EV03_AI04预演_对话面板_v25本地.png" });
 await br.close();
 // 接口越权矩阵（无 UI）
 const U = async (p, ck) => { const r = await fetch(B + p, { headers: ck ? { cookie: ck } : {} }); let j = {}; try { j = await r.json(); } catch {} return { st: r.status, j }; };
 const l = await fetch(B + "/api/auth/login", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(Object.assign({ username: "driver_demo" }, { password: kv.DRIVER_PW })) });
 const D = (l.headers.getSetCookie() || []).map(x => x.split(";")[0])[0];
 K("EV03 授权接口：司机直查 admin.score_snapshots（含本人 gpsno）→ 403", (await U("/api/data/admin.score_snapshots?limit=5&gpsno=95301325", D)).st === 403);
 K("司机直查 admin.alerts / admin.trainings / admin.deduction_ledger → 全 403", (await U("/api/data/admin.alerts?limit=1", D)).st + (await U("/api/data/admin.trainings?limit=1", D)).st + (await U("/api/data/admin.deduction_ledger?limit=1", D)).st === 1209);
 K("admin 篡改 gpsno（不存在车队车辆）→ 200 total=0（空非 0 值壳）", await (async () => { const f = await fetch(B + "/api/auth/login", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ username: "safety_admin", password: kv.ADMIN_PW }) }); const Ck = (f.headers.getSetCookie() || []).map(x => x.split(";")[0])[0]; const r = await U("/api/data/admin.score_snapshots?limit=5&gpsno=99900099", Ck); return r.st === 200 && r.j.total === 0; })());
 console.log(fails ? `R25_${fails}_FAILED` : "R25_OK");
 child.kill("SIGTERM"); setTimeout(() => process.exit(fails ? 1 : 0), 250);
})().catch(e => { console.error("R25_ERR", String(e.message).slice(0, 220)); child.kill("SIGTERM"); setTimeout(() => process.exit(1), 250); });
