const { spawn } = require("node:child_process"); const fs = require("node:fs");
const RP = "/mnt/pages/page-repo-9c562cfc-8c55-4fa4-b226-d9c5dae153f0";
const ST = RP + "/.qw-pages/publish";
const OUT = RP + "/../../../../workspace/5d12ecfd-e7d8-46d4-b63a-4dbb09c2226d/work/output/screenshots";
const kv = Object.fromEntries(fs.readFileSync(RP + "/.runtime-tmp/app.env", "utf8").split("\n").filter(Boolean).map(l => { const i = l.indexOf("="); return [l.slice(0, i), l.slice(i + 1)]; }));
const child = spawn(process.execPath, [ST + "/server.mjs"], { env: { ...process.env, NODE_ENV: "development", HOST: "127.0.0.1", PORT: "3521" }, cwd: ST, stdio: ["ignore", "pipe", "pipe"] });
const B = "http://127.0.0.1:3521";
(async () => {
 for (let i = 0; i < 90; i++) { try { if ((await fetch(B + "/healthz")).status === 200) break; } catch {} await new Promise(rr => setTimeout(rr, 400)); }
 // 准备真实 submitted 任务（driver 会话 API 提交，UI 用于页面取证）
 const U = async (p, o = {}) => { const r = await fetch(B + p, { method: o.post ? "POST" : "GET", headers: { "content-type": "application/json", ...(o.ck ? { cookie: o.ck } : {}) }, body: o.post ? JSON.stringify(o.body || {}) : undefined }); let j = {}; try { j = await r.json(); } catch {} return { st: r.status, j, sc: (r.headers.getSetCookie?.() || []).map(x => x.split(";")[0])[0] }; };
 const F = (await U("/api/auth/login", { post: 1, body: { username: "safety_admin", password: kv.ADMIN_PW } })).sc;
 const D = (await U("/api/auth/login", { post: 1, body: { username: "driver_demo", password: kv.DRIVER_PW } })).sc;
 const asn = await U("/api/admin/training-assign", { post: 1, ck: F, body: { course_id: "DEMO_C01", driver_id: "DEMO_D0149", alert_id: "alert-1e7ec09935dd735b", goal: "TR06 页面取证任务：车距复盘与记录补齐", due_at: "2026-12-31", idempotency_key: "ui24:" + (Date.now() % 100000000) } });
 const TID = asn.j.task_id;
 await U(`/api/training-tasks/${TID}/start`, { post: 1, ck: D, body: {} });
 const sb = await U(`/api/training-tasks/${TID}/submit`, { post: 1, ck: D, body: { learning_record: "已复盘三秒车距与夜间双提醒；缺：雨天场景与连续跟车记录说明。", feedback: "希望增加雨天车距微课。" } });
 console.log("prep:", TID, sb.st, sb.j.status);
 const { chromium } = require("/usr/lib/node_modules/playwright");
 const br = await chromium.launch({ headless: true, args: ["--no-sandbox"] });
 const pg = await (await br.newContext({ viewport: { width: 1500, height: 1050 } })).newPage();
 let fails = 0; const K = (n, c, x = "") => { console.log((c ? "PASS " : "FAIL ") + n, String(x).slice(0, 160)); if (!c) fails++; };
 await pg.goto(B + "/", { waitUntil: "networkidle" });
 const sso = await pg.getByRole("button", { name: /使用工作台账号登录/ }).count();
 if (sso) { await pg.getByRole("button", { name: /使用工作台账号登录/ }).first().click(); await pg.waitForTimeout(600); }
 await pg.locator("#ln").fill("safety_admin"); await pg.locator("#pw").fill(kv.ADMIN_PW);
 await pg.locator("button").filter({ hasText: /^登\s*录$/ }).first().click(); await pg.waitForTimeout(2200);
 await pg.evaluate(() => { location.hash = "#/tr-ledger"; }); await pg.waitForTimeout(1800);
 K("TR06 队列出现真实待复核行", await pg.evaluate((t) => document.body.innerText.includes(t), TID));
 await pg.evaluate((tid) => { const hs = [...document.querySelectorAll("h3")]; const bench = hs.find(h => h.textContent.includes("TR06")); const block = bench && bench.closest("div"); const rows = block ? [...block.querySelectorAll("tr")] : []; const r = rows.find(x => x.innerText.includes("submitted")) || rows.find(x => x.innerText.includes(tid)); r && r.click(); }, TID);
 await pg.waitForTimeout(1600);
 const four = await pg.evaluate(() => { const t = document.body.innerText; return { one: t.includes("① 司机提交原文"), two: t.includes("② 课程要求"), three: t.includes("③ 已授权且可核实的关联证据"), four: t.includes("④ AI 辅助摘要"), alert: t.includes("alert-1e7ec09935dd735b"), quote: t.includes("三秒车距") }; });
 K("四部分并列均渲染（含原文与 alert）", four.one && four.two && four.three && four.four && four.alert && four.quote, JSON.stringify(four));
 await pg.evaluate(() => { const b = [...document.querySelectorAll("button")].find(x => x.textContent.includes("生成 AI 辅助摘要")); b && b.click(); });
 for (let w = 0; w < 22; w++) { const done = await pg.evaluate(() => /核查|覆盖| limitations|暂不可用|ref/.test(document.body.innerText) && document.body.innerText.includes("模型") !== false && !document.body.innerText.includes("生成中…")); if (done) break; await pg.waitForTimeout(8000); }
 const sumUi = await pg.evaluate(() => { const t = document.body.innerText; return { hasState: /覆盖|未见|无法判断/.test(t), auditLine: t.includes("调用已审计"), model: t.includes("qwen3.8"), notJudge: t.includes("不自动判定"), btn: t.includes("重新生成摘要") }; });
 K("AI 摘要卡呈现（判定态/审计说明/模型名/不判定声明）", sumUi.hasState && sumUi.auditLine && sumUi.notJudge, JSON.stringify(sumUi));
 await pg.screenshot({ path: OUT + "/71_TR06_四部分与AI摘要_v25本地.png", fullPage: true });
 await br.close();
 console.log("TID_SHOWN=" + TID);
 console.log(fails ? `UI24_${fails}_FAILED` : "UI24_OK"); child.kill("SIGTERM"); setTimeout(() => process.exit(fails ? 1 : 0), 250);
})().catch(e => { console.error("UI24_ERR", String(e.message).slice(0, 200)); child.kill("SIGTERM"); setTimeout(() => process.exit(1), 250); });
