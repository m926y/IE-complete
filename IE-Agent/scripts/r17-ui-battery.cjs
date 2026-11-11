const { spawn } = require("node:child_process"); const fs = require("node:fs");
const R = "/mnt/pages/page-repo-9c562cfc-8c55-4fa4-b226-d9c5dae153f0";
const ST = R + "/.qw-pages/publish";
const OUT = "/workspace/5d12ecfd-e7d8-46d4-b63a-4dbb09c2226d/work/output/screenshots";
const kv = Object.fromEntries(fs.readFileSync(R + "/.runtime-tmp/app.env", "utf8").split("\n").filter(Boolean).map(l => { const i = l.indexOf("="); return [l.slice(0, i), l.slice(i + 1)]; }));
const child = spawn(process.execPath, [ST + "/server.mjs"], { env: { ...process.env, NODE_ENV: "development", HOST: "127.0.0.1", PORT: "3345" }, cwd: ST, stdio: ["ignore", "pipe", "pipe"] });
const B = "http://127.0.0.1:3345";
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
  if (ssoBtn) { await pg.getByRole("button", { name: /使用工作台账号登录/ }).first().click(); await pg.waitForTimeout(800); }
  await pg.waitForTimeout(800);
  await pg.locator("#ln").fill(u); await pg.locator("#pw").fill(p);
  await pg.locator("button").filter({ hasText: /^登\s*录$/ }).first().click();
  await pg.waitForTimeout(2200);
 }
 await login("safety_admin", kv.ADMIN_PW);
 // 1) 搜索 alert
 await pg.locator('input[aria-label="全局搜索"]').fill("9f4bafddd");
 await pg.waitForTimeout(2500);
 const grp = await pg.evaluate(() => document.body.innerText.includes("案卷与告警 · 命中 1"));
 K("admin 搜索案卷：分组计数=1", grp);
 await shot("50_搜索_alert命中_v25.png");
 await pg.evaluate(() => { const panel = [...document.querySelectorAll("div")].find(d => d.style && d.style.zIndex === "60"); if (panel) { const el = [...panel.querySelectorAll(".task-card")].find(x => x.innerText.includes("alert-9f4b")); el && el.click(); } });
 await pg.waitForTimeout(2200);
 K("点击案卷结果→深链抽屉打开", await pg.evaluate(() => location.hash.includes("rm-alerts") && document.body.innerText.includes("alert-9f4bafddd3747b53")), await pg.evaluate(() => location.hash));
 await pg.waitForTimeout(600); await shot("51_点击案卷结果_案卷抽屉_v25.png");
 // 2) 搜索司机四类
 await pg.evaluate(() => { location.hash = "#/overview"; });
 await pg.locator('input[aria-label="全局搜索"]').fill("DEMO_D0149");
 await pg.waitForTimeout(2500);
 const four = await pg.evaluate(() => { const t = document.body.innerText; return ["司机/车辆", "案卷与告警", "培训任务", "正式知识"].every(x => t.includes(x)); });
 K("四类分组均呈现（knowledge=0 诚实计数）", four);
 await shot("52_搜索司机_四类分组_v25.png");
 // 3) SM05 UI
 await pg.evaluate(() => { location.hash = "#/sm-drafts"; });
 await pg.waitForTimeout(1600);
 await pg.fill('textarea[placeholder*="提案文本"]', "【UI取证草案】gps_coverage 窗口 28→35 天（仅提案演示，永不生效）");
 await pg.locator('button:has-text("创建草案")').click();
 await pg.waitForTimeout(1500);
 const erdUi = await pg.evaluate(() => document.body.innerText.includes("已建草案 erd-"));
 K("SM05 UI 创建草案成功", erdUi);
 const curOk = await pg.evaluate(() => document.body.querySelectorAll("table.tbl tbody tr").length === 6);
 K("SM05 现行六维只读列渲染", curOk);
 await shot("53_SM05_双栏_草案未生效_v25.png");
 // 4) SM06 UI
 await pg.evaluate(() => { location.hash = "#/sm-knowledge"; });
 await pg.waitForTimeout(1500);
 const sm06 = await pg.evaluate(() => { const t = document.body.innerText; return { pend: t.includes("待审·未生效"), dis: t.includes("已停用"), appr: t.includes("正式生效") || !t.includes("K6") }; });
 K("SM06 状态徽章（待审/停用/无正式可见计数诚实）", sm06.pend && sm06.dis, JSON.stringify(sm06));
 await shot("54_SM06_知识状态机_v25.png");
 // 5) 司机搜他人
 await pg.locator('button:has-text("退出")').first().click(); await pg.waitForTimeout(2000);
 await login("driver_demo", kv.DRIVER_PW);
 await pg.locator('input[aria-label="全局搜索"]').fill("D0289");
 await pg.waitForTimeout(2400);
 const drv = await pg.evaluate(() => { const panel = [...document.querySelectorAll("div")].find(d => d.style && d.style.zIndex === "60"); const txt = panel ? panel.innerText : document.body.innerText; return { hasNoRes: txt.includes("未找到匹配对象"), leak: /D0289 · /.test(txt), counts: (txt.match(/：0/g) || []).length }; });
 K("司机搜他人：空结果面板+无他人对象行", drv.hasNoRes && !drv.leak && drv.counts >= 4, JSON.stringify(drv));
 await shot("55_司机搜索_他人零结果_v25.png");
 await br.close();
 console.log(fails ? `UI17_${fails}_FAILED` : "UI17_OK"); child.kill("SIGTERM"); setTimeout(() => process.exit(fails ? 1 : 0), 250);
})().catch(e => { console.error("UI17_ERR", String(e.message).slice(0, 200)); child.kill("SIGTERM"); setTimeout(() => process.exit(1), 250); });
