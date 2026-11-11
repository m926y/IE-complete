const { spawn } = require("node:child_process"); const fs = require("node:fs");
const RP = "/mnt/pages/page-repo-9c562cfc-8c55-4fa4-b226-d9c5dae153f0";
const ST = RP + "/.qw-pages/publish";
const OUT = "/workspace/5d12ecfd-e7d8-46d4-b63a-4dbb09c2226d/work/output/screenshots";
const kv = Object.fromEntries(fs.readFileSync(RP + "/.runtime-tmp/app.env", "utf8").split("\n").filter(Boolean).map(l => { const i = l.indexOf("="); return [l.slice(0, i), l.slice(i + 1)]; }));
const child = spawn(process.execPath, [ST + "/server.mjs"], { env: { ...process.env, NODE_ENV: "development", HOST: "127.0.0.1", PORT: "3463" }, cwd: ST, stdio: ["ignore", "pipe", "pipe"] });
const B = "http://127.0.0.1:3463";
(async () => {
 for (let i = 0; i < 110; i++) { try { if ((await fetch(B + "/healthz")).status === 200) break; } catch {} await new Promise(r => setTimeout(r, 500)); }
 const { chromium } = require("/usr/lib/node_modules/playwright");
 const br = await chromium.launch({ headless: true, args: ["--no-sandbox"] });
 const pg = await (await br.newContext({ viewport: { width: 540, height: 1000 } })).newPage();
 let fails = 0; const K = (n, c, x = "") => { console.log((c ? "PASS " : "FAIL ") + n, String(x).slice(0, 140)); if (!c) fails++; };
 await pg.goto(B + "/", { waitUntil: "networkidle" });
 const sso = await pg.getByRole("button", { name: /使用工作台账号登录/ }).count();
 if (sso) { await pg.getByRole("button", { name: /使用工作台账号登录/ }).first().click(); await pg.waitForTimeout(700); }
 await pg.locator("#ln").fill("driver_demo"); await pg.locator("#pw").fill(kv.DRIVER_PW);
 await pg.locator("button").filter({ hasText: /^登\s*录$/ }).first().click(); await pg.waitForTimeout(2400);
 await pg.waitForSelector('[aria-label="anonymous fleet statistics panel"]', { timeout: 20000 }).catch(() => {});
 await pg.waitForTimeout(1500);
 const vis = await pg.evaluate(() => { const el = document.querySelector('[aria-label="anonymous fleet statistics panel"]'); const t = el ? el.innerText : ""; return { ok: t.includes("匿名车队统计"), num: t.includes("500"), avg: t.includes("74.4"), dist: t.includes("A 级"), hero: !!document.querySelector(".panel.score-hero"), leak: /9530\d{4}|DEMO_D0/.test(t) }; });
 K("EV04 匿名区渲染（500/74.4/分布/A级；我的分区独立；无个人字段）", vis.ok && vis.num && vis.avg && vis.dist && vis.hero && !vis.leak, JSON.stringify(vis));
 await pg.screenshot({ path: OUT + "/66_EV04_匿名车队统计_真实司机会话.png", fullPage: true });
 await br.close();
 console.log(fails ? `UI21_${fails}_FAILED` : "UI21_OK"); child.kill("SIGTERM"); setTimeout(() => process.exit(fails ? 1 : 0), 250);
})().catch(e => { console.error("UI21_ERR", String(e.message).slice(0, 200)); child.kill("SIGTERM"); setTimeout(() => process.exit(1), 250); });
