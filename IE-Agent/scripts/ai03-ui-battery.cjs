const { spawn } = require("node:child_process"); const fs = require("node:fs");
const ST = "/mnt/pages/page-repo-9c562cfc-8c55-4fa4-b226-d9c5dae153f0/.qw-pages/publish";
const OUT = "/workspace/5d12ecfd-e7d8-46d4-b63a-4dbb09c2226d/work/output/screenshots";
const kv = Object.fromEntries(fs.readFileSync("/mnt/pages/page-repo-9c562cfc-8c55-4fa4-b226-d9c5dae153f0/.runtime-tmp/app.env", "utf8").split("\n").filter(Boolean).map(l => { const i = l.indexOf("="); return [l.slice(0, i), l.slice(i + 1)]; }));
const child = spawn(process.execPath, [ST + "/server.mjs"], { env: { ...process.env, NODE_ENV: "development", HOST: "127.0.0.1", PORT: "3295" }, cwd: ST, stdio: ["ignore", "pipe", "pipe"] });
const B = "http://127.0.0.1:3295";
(async () => {
 for (let i = 0; i < 120; i++) { try { if ((await fetch(B + "/healthz")).status === 200) break; } catch {} await new Promise(r => setTimeout(r, 500)); }
 delete require.cache[require.resolve("/usr/lib/node_modules/playwright")];
 const { chromium } = require("/usr/lib/node_modules/playwright");
 const br = await chromium.launch({ headless: true, args: ["--no-sandbox"] });
 const pg = await (await br.newContext({ viewport: { width: 1440, height: 900 } })).newPage();
 const shot = (n) => pg.screenshot({ path: OUT + "/" + n });
 async function login(u, p) {
  await pg.goto(B + "/", { waitUntil: "networkidle" });
  const ssoBtn = await pg.getByRole("button", { name: /使用工作台账号登录/ }).count();
  if (ssoBtn) { await pg.getByRole("button", { name: /使用工作台账号登录/ }).first().click(); await pg.waitForTimeout(800); }
  for (let i = 0; i < 12; i++) { if (await pg.locator("#ln").count()) break; await pg.waitForTimeout(500); }
  await pg.locator("#ln").fill(u); await pg.locator("#pw").fill(p);
  await pg.locator("button").filter({ hasText: /^登\s*录$/ }).first().click();
  await pg.waitForTimeout(2400);
 }
 let fails = 0; const K = (n, c, x = "") => { console.log((c ? "PASS " : "FAIL ") + n, String(x).slice(0, 150)); if (!c) fails++; };
 await login("safety_admin", kv.ADMIN_PW);
 await pg.evaluate(() => sessionStorage.clear());
 // 1) 自检卡（确定性 fill_to 两卡）
 await pg.locator("button.ai-fab").click(); await pg.waitForTimeout(500);
 await pg.locator('button:has-text("运行工具链自检")').click();
 for (let i = 0; i < 20; i++) { if (await pg.locator('button:has-text("填入 RM03 草稿表单")').count()) break; await pg.waitForTimeout(700); }
 K("自检卡含两个填入按钮", (await pg.locator('button:has-text("填入 RM03 草稿表单")').count()) >= 1 && (await pg.locator('button:has-text("填入 TR02 表单")').count()) >= 1);
 await shot("40b_自检卡_两个填入按钮_v23.png");
 // 2) TR02 填入并现场修改一个字段
 await pg.locator('button:has-text("填入 TR02 表单")').first().click(); await pg.waitForTimeout(2200);
 const tr2a = await pg.evaluate(() => {
  const g = (sel) => { const e = document.querySelector(sel); return e ? (e.value || e.selectedIndex) : null; };
  return { hash: location.hash, inputs: Array.from(document.querySelectorAll("input,select,textarea")).slice(0, 12).map(e => `${e.name || e.id || e.tagName}=${(e.value || "").slice(0, 24)}`), draftTag: document.body.innerText.includes("草稿状态，未分配"), fill: document.body.innerText.includes("已填入 AI 草稿") };
 });
 K("TR02：路由+提示+字段回填", tr2a.hash.includes("tr-create") && tr2a.fill && tr2a.draftTag, JSON.stringify({ hash: tr2a.hash, fields: tr2a.inputs.slice(0, 6) }).slice(0, 150));
 const dueSel = 'input[type="date"]';
 if (await pg.locator(dueSel).count()) { await pg.locator(dueSel).first().fill("2026-12-15"); await pg.waitForTimeout(400); }
 const edited = await pg.evaluate(() => (document.querySelector('input[type="date"]') || {}).value);
 K("TR02 用户可逐项修改（deadline 改写生效）", edited === "2026-12-15", "due→" + edited);
 await shot("43b_填入TR02_可编辑_确认分配前_v23.png");
 // 3) RM03 填入
 await pg.evaluate(() => { location.hash = "#/overview"; }); await pg.waitForTimeout(900);
 for (let i = 0; i < 8; i++) { const vis = await pg.evaluate(() => !!document.querySelector(".ai-panel")); if (vis) break; await pg.locator("button.ai-fab").click({ force: true }).catch(() => {}); await pg.waitForTimeout(700); }
 await pg.waitForTimeout(600);
 await pg.locator('button:has-text("填入 RM03 草稿表单")').first().click(); await pg.waitForTimeout(2500);
 const rm3 = await pg.evaluate(() => ({ hash: location.hash, body: document.body.innerText.includes("已填入 AI 草稿"), ta: (document.querySelector('textarea[aria-label="干预草稿"]') || {}).value || null }));
 K("RM03：路由+填入提示（编辑域随链路终态显示发送卡）", rm3.hash.includes("rm-alerts") && rm3.body, JSON.stringify(rm3).slice(0, 120));
 await shot("41b_填入RM03_案卷与草稿内容_v23.png");
 // 4) 跨页恢复 + 历史快照标记
 await pg.locator('button[aria-label="关闭"], .ai-close').first().click().catch(async () => { await pg.locator("button.ai-fab").click(); });
 await pg.evaluate(() => { location.hash = "#/ev-fleet"; }); await pg.waitForTimeout(1000);
 await pg.evaluate(() => { location.hash = "#/overview"; }); await pg.waitForTimeout(700);
 await pg.locator("button.ai-fab").click(); await pg.waitForTimeout(900);
 const restored = await pg.locator("text=历史快照").count();
 const msgsKept = await pg.evaluate(() => document.querySelectorAll(".ai-panel .task-card").length);
 K("AI01 跨页后对话保留+旧上下文标记", restored >= 1 && msgsKept >= 2, `marks=${restored} cards=${msgsKept}`);
 await shot("42b_AI01_跨页恢复_旧上下文标记_v23.png");
 // 5) 退出→司机登录：隔离
 await pg.locator('button:has-text("退出")').first().click(); await pg.waitForTimeout(2200);
 const st = await pg.evaluate(() => Object.keys(sessionStorage).filter(k => k.startsWith("claw_")));
 K("退出后 AI 会话缓存清空", st.length === 0, JSON.stringify(st));
 await login("driver_demo", kv.DRIVER_PW);
 await pg.locator("button.ai-fab").click(); await pg.waitForTimeout(700);
 const leak = await pg.evaluate(() => (document.querySelector(".ai-panel") || { innerText: "" }).innerText.includes("alert-9f4b") || (document.querySelector(".ai-panel") || { innerText: "" }).innerText.includes("D0289"));
 const drvCards = await pg.evaluate(() => document.querySelectorAll(".ai-panel .task-card").length);
 K("司机会话 AI 面板无管理员历史（隔离）", !leak, `drv_cards=${drvCards} leak=${leak}`);
 await pg.locator('.ai-panel input[aria-label="AI 提问"], input[aria-label="AI 提问"]').first().fill("我的最新安全分是多少？");
 await pg.locator('.ai-panel button:has-text("发送"), button:has-text("发送")').first().click();
 for (let i = 0; i < 26; i++) { const n = await pg.evaluate(() => (document.querySelector(".ai-panel") || { innerText: "" }).innerText.length); if (n > 160) break; await pg.locator('.ai-panel button:has-text("发送"), button:has-text("发送")').first().click().catch(() => {}); await pg.waitForTimeout(8000); }
 console.log("DRV_PANEL_TAIL:", (await pg.evaluate(() => (document.querySelector(".ai-panel") || { innerText: "NOPANEL" }).innerText).catch(() => "ERR")).replace(/\n/g, " ⏎ ").slice(-260));
 await pg.evaluate(() => { location.hash = "#/overview"; }); await pg.waitForTimeout(900);
 await pg.locator('button[aria-label="关闭"]').first().click().catch(() => {});
 await pg.waitForTimeout(500);
 for (let i = 0; i < 10; i++) { if (await pg.evaluate(() => !!document.querySelector(".ai-panel"))) break; await pg.locator("button.ai-fab").click({ force: true }).catch(() => {}); await pg.waitForTimeout(700); }
 await pg.waitForTimeout(700);
 const cardsDump = await pg.evaluate(() => Array.from(document.querySelectorAll(".ai-panel .task-card")).map(x => x.innerText.slice(0, 50)));
 console.log("CARDS_DUMP", JSON.stringify(cardsDump).slice(0, 500));
 const drvRestored = await pg.evaluate(() => ({ cards: document.querySelectorAll(".ai-panel .task-card").length, mark: document.body.innerText.includes("历史快照"), keys: Object.keys(sessionStorage).filter(k => k.startsWith("claw")), owner: sessionStorage.getItem("claw_ai_owner"), storeLen: (sessionStorage.getItem("claw_ai_msgs_" + (sessionStorage.getItem("claw_ai_owner") || "")) || "").length, panelVis: !!document.querySelector(".ai-panel"), noAdmin: !(document.querySelector(".ai-panel") || { innerText: "" }).innerText.includes("D0289") && !(document.querySelector(".ai-panel") || { innerText: "" }).innerText.includes("alert-9f4b") }));
 K("司机跨页恢复本人会话且无管理员内容", drvRestored.cards >= 1 && drvRestored.mark && drvRestored.noAdmin, JSON.stringify(drvRestored));
 await shot("44b_AI01_司机会话隔离恢复_v23.png");
 await br.close();
 console.log(fails ? `UI16B_${fails}_FAILED` : "UI16B_OK"); child.kill("SIGTERM"); setTimeout(() => process.exit(fails ? 1 : 0), 250);
})().catch(e => { console.error("UI16B_ERR", String(e.message).slice(0, 200)); child.kill("SIGTERM"); setTimeout(() => process.exit(1), 250); });
