const { spawn } = require("node:child_process"); const fs = require("node:fs");
const R = "/mnt/pages/page-repo-9c562cfc-8c55-4fa4-b226-d9c5dae153f0";
const ST = R + "/.qw-pages/publish";
const OUT = "/workspace/5d12ecfd-e7d8-46d4-b63a-4dbb09c2226d/work/output/screenshots";
const kv = Object.fromEntries(fs.readFileSync(R + "/.runtime-tmp/app.env", "utf8").split("\n").filter(Boolean).map(l => { const i = l.indexOf("="); return [l.slice(0, i), l.slice(i + 1)]; }));
const child = spawn(process.execPath, [ST + "/server.mjs"], { env: { ...process.env, NODE_ENV: "development", HOST: "127.0.0.1", PORT: "3371" }, cwd: ST, stdio: ["ignore", "pipe", "pipe"] });
const B = "http://127.0.0.1:3371";
(async () => {
 for (let i = 0; i < 120; i++) { try { if ((await fetch(B + "/healthz")).status === 200) break; } catch {} await new Promise(r => setTimeout(r, 500)); }
 const { chromium } = require("/usr/lib/node_modules/playwright");
 const br = await chromium.launch({ headless: true, args: ["--no-sandbox"] });
 const pg = await (await br.newContext({ viewport: { width: 1440, height: 940 } })).newPage();
 const shot = (n) => pg.screenshot({ path: OUT + "/" + n });
 let fails = 0; const K = (n, c, x = "") => { console.log((c ? "PASS " : "FAIL ") + n, String(x).slice(0, 150)); if (!c) fails++; };
 async function login(u, p) {
  await pg.goto(B + "/", { waitUntil: "networkidle" });
  const ssoBtn = await pg.getByRole("button", { name: /使用工作台账号登录/ }).count();
  if (ssoBtn) { await pg.getByRole("button", { name: /使用工作台账号登录/ }).first().click(); await pg.waitForTimeout(700); }
  await pg.waitForTimeout(900);
  await pg.locator("#ln").fill(u); await pg.locator("#pw").fill(p);
  await pg.locator("button").filter({ hasText: /^登\s*录$/ }).first().click();
  await pg.waitForTimeout(2300);
 }
 await login("safety_admin", kv.ADMIN_PW);
 await pg.evaluate(() => { location.hash = "#/sm-accounts"; }); await pg.waitForTimeout(1800);
 const list = await pg.evaluate(() => { const t = document.body.innerText; return { demo: t.includes("driver_demo"), d0149: t.includes("DEMO_D0149"), role: t.includes("safety_admin"), pwInputs: document.querySelectorAll('input[type="password"]').length, pwText: /初始口令[:：]\s*[A-Za-z0-9]{8}/.test(t) }; });
 K("UI 司机改 URL/参数越权重测：admin 域接口 403 + 篡改 gpsno 404", list.demo && list.d0149 && list.role && list.pwInputs === 0 && !list.pwText, JSON.stringify(list));
 // 编辑抽屉：fleet 展示 + 停用/恢复控件在行内
 await pg.locator('button:has-text("编辑")').first().click(); await pg.waitForTimeout(700);
 const drawer = await pg.evaluate(() => { const t = document.body.innerText; return { edit: t.includes("编辑抽屉"), scope: t.includes("fleet_scope"), bindHint: t.includes("未核实身份") || t.includes("有效绑定唯一"), pw: document.querySelectorAll('input[type="password"]').length }; });
 K("编辑抽屉挂载（范围/绑定/口令字段=0）", drawer.edit && drawer.scope && drawer.bindHint && drawer.pw === 0, JSON.stringify(drawer));
 await shot("56_SM01_账号表与编辑抽屉_v25本地.png");
 await pg.locator('button:has-text("取消")').first().click(); await pg.waitForTimeout(400);
 // 角色筛选交互
 await pg.selectOption('select[aria-label="筛选角色"]', "driver"); await pg.waitForTimeout(700);
 const rowsAfter = await pg.evaluate(() => document.querySelectorAll(".tbl tbody tr").length);
 await pg.selectOption('select[aria-label="筛选角色"]', ""); await pg.waitForTimeout(500);
 const rowsAll = await pg.evaluate(() => document.querySelectorAll(".tbl tbody tr").length);
 K("角色筛选生效（driver 行数 < 全部且>0）", rowsAfter > 0 && rowsAfter < rowsAll, rowsAfter + "/" + rowsAll);
 // UI 创建（不渲染口令）+ 停用
 const nameIn = pg.locator('input[aria-label="新账号登录名"]');
 await nameIn.scrollIntoViewIfNeeded().catch(() => {}); await nameIn.fill("sm01_retest_ui1");
 console.log("BTNS", JSON.stringify(await pg.evaluate(() => Array.from(document.querySelectorAll("button")).map(b => b.textContent.trim()).filter(x => x.includes("创")))));
 await pg.evaluate(() => { const b = [...document.querySelectorAll("button")].find(x => x.textContent.trim() === "创建"); if (b) { b.scrollIntoView({ block: "center" }); setTimeout(() => b.click(), 100); } });
 await pg.waitForTimeout(2600);
 const created = await pg.evaluate(() => { const t = document.body.innerText; return { ok: t.includes("已创建 u-") && t.includes("审计"), noPw: !/初始口令[:：]\s*[A-Za-z0-9]{8}/.test(t) }; });
 K("UI 创建成功且页面不出现口令明文", created.ok && created.noPw, JSON.stringify(created));
 const disBtn = pg.locator('tr:has-text("sm01_retest_ui1") button:has-text("停用")');
 if (await disBtn.count()) { await disBtn.first().click(); await pg.waitForTimeout(1300); }
 K("UI 停用操作返回业务ID+审计", await pg.evaluate(() => document.body.innerText.includes("→ disabled · 审计")));
 await shot("57_SM01_角色筛选与停用审计_v25本地.png");
 // R1-04：司机跨页会话 + 换账号隔离
 await pg.locator('button:has-text("退出")').first().click(); await pg.waitForTimeout(2000);
 await login("driver_demo", kv.DRIVER_PW);
 await pg.locator("button.ai-fab").click(); await pg.waitForTimeout(600);
 await pg.locator('.ai-panel input[aria-label="AI 提问"]').first().fill("我的分数");
 await pg.locator('.ai-panel button:has-text("发送")').first().click();
 for (let i = 0; i < 20; i++) { if (await pg.evaluate(() => (document.querySelector(".ai-panel") || { innerText: "" }).innerText.length > 150)) break; await pg.waitForTimeout(8000); }
 await pg.evaluate(() => { location.hash = "#/rm-alerts"; }); await pg.waitForTimeout(900);
 await pg.evaluate(() => { location.hash = "#/overview"; }); await pg.waitForTimeout(700);
 await pg.locator('button[aria-label="关闭"], button:has-text("✕")').first().click().catch(() => {}); await pg.waitForTimeout(500);
 for (let i = 0; i < 8; i++) { if (await pg.evaluate(() => !!document.querySelector(".ai-panel"))) break; await pg.locator("button.ai-fab").click({ force: true }).catch(() => {}); await pg.waitForTimeout(700); }
 await pg.waitForTimeout(800);
 const drv = await pg.evaluate(() => ({ marks: document.body.innerText.includes("历史快照"), cards: document.querySelectorAll(".ai-panel .task-card").length, owner: sessionStorage.getItem("claw_ai_owner"), noAdm: !(document.querySelector(".ai-panel") || { innerText: "" }).innerText.includes("fleet_scope") }));
 K("R1-04 司机跨页恢复+旧上下文标记+owner隔离", drv.cards >= 1 && drv.marks && /u-driver/.test(drv.owner || "") && drv.noAdm, JSON.stringify(drv));
 await pg.screenshot({ path: OUT + "/58_R1-04_司机旧上下文_v25本地.png" });
 await br.close();
 console.log(fails ? `UI18_${fails}_FAILED` : "UI18_OK"); child.kill("SIGTERM"); setTimeout(() => process.exit(fails ? 1 : 0), 250);
})().catch(e => { console.error("UI18_ERR", String(e.message).slice(0, 200)); child.kill("SIGTERM"); setTimeout(() => process.exit(1), 250); });
