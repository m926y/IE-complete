const { spawn } = require("node:child_process"); const fs = require("node:fs");
const RP = "/mnt/pages/page-repo-9c562cfc-8c55-4fa4-b226-d9c5dae153f0";
const ST = RP + "/.qw-pages/publish";
const OUT = "/workspace/5d12ecfd-e7d8-46d4-b63a-4dbb09c2226d/work/output/screenshots";
const kv = Object.fromEntries(fs.readFileSync(RP + "/.runtime-tmp/app.env", "utf8").split("\n").filter(Boolean).map(l => { const i = l.indexOf("="); return [l.slice(0, i), l.slice(i + 1)]; }));
const child = spawn(process.execPath, [ST + "/server.mjs"], { env: { ...process.env, NODE_ENV: "development", HOST: "127.0.0.1", PORT: "3474" }, cwd: ST, stdio: ["ignore", "pipe", "pipe"] });
const B = "http://127.0.0.1:3474";
(async () => {
 for (let i = 0; i < 110; i++) { try { if ((await fetch(B + "/healthz")).status === 200) break; } catch {} await new Promise(r => setTimeout(r, 500)); }
 const { chromium } = require("/usr/lib/node_modules/playwright");
 const br = await chromium.launch({ headless: true, args: ["--no-sandbox"] });
 const pg = await (await br.newContext({ viewport: { width: 1500, height: 980 } })).newPage();
 let fails = 0; const K = (n, c, x = "") => { console.log((c ? "PASS " : "FAIL ") + n, String(x).slice(0, 150)); if (!c) fails++; };
 await pg.goto(B + "/", { waitUntil: "networkidle" });
 const sso = await pg.getByRole("button", { name: /使用工作台账号登录/ }).count();
 if (sso) { await pg.getByRole("button", { name: /使用工作台账号登录/ }).first().click(); await pg.waitForTimeout(700); }
 await pg.locator("#ln").fill("safety_admin"); await pg.locator("#pw").fill(kv.ADMIN_PW);
 await pg.locator("button").filter({ hasText: /^登\s*录$/ }).first().click(); await pg.waitForTimeout(2200);
 await pg.evaluate(() => { location.hash = "#/rm-queue"; }); await pg.waitForTimeout(2600);
 K("RM01 出现「7天下滑」分组按钮与计数", await pg.evaluate(() => document.body.innerText.includes("7天下滑") && /7天下滑\s*32/.test(document.body.innerText.replace(/\s+/g, " "))));
 await pg.evaluate(() => { const b = [...document.querySelectorAll("button")].find(x => x.innerText.includes("7天下滑")); b && b.click(); });
 await pg.waitForTimeout(1800);
 const tbl = await pg.evaluate(() => { const t = document.body.innerText; return { pair: t.includes("2026-07-24 → 2026-07-31") || t.includes("2026-07-24"), sample: t.includes("95201298"), drop: t.includes("21.7887"), thr: t.includes("ops_v1"), baseTag: t.includes("behavior_coaching") || t.includes("priority_review") }; });
 K("分组表：日期对/样本车/Δ/阈值版本/原标签并存", tbl.pair && tbl.sample && tbl.drop && tbl.thr && tbl.baseTag, JSON.stringify(tbl));
 await pg.screenshot({ path: OUT + "/67_RM01_7天下滑分组_v25本地.png", fullPage: false });
 await pg.evaluate(() => { const els = [...document.querySelectorAll("tr")]; const row = els.find(x => x.innerText.includes("95201298")); const b = row && [...row.querySelectorAll("button")].find((x) => x.textContent.includes("EV03")); b && b.click(); });
 await pg.waitForTimeout(1800);
 const ev = await pg.evaluate(() => ({ hash: location.hash, has: document.body.innerText.includes("95201298") || document.body.innerText.includes("司机详情") }));
 K("点击 EV03 详情/证据跳转成功", ev.hash.includes("ev-fleet") && ev.has, JSON.stringify(ev));
 await pg.screenshot({ path: OUT + "/68_EV03_下滑车辆详情_v25本地.png", fullPage: false });
 await br.close();
 console.log(fails ? `UI22_${fails}_FAILED` : "UI22_OK"); child.kill("SIGTERM"); setTimeout(() => process.exit(fails ? 1 : 0), 250);
})().catch(e => { console.error("UI22_ERR", String(e.message).slice(0, 200)); child.kill("SIGTERM"); setTimeout(() => process.exit(1), 250); });
