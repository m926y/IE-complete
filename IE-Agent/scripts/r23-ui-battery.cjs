const { spawn } = require("node:child_process"); const fs = require("node:fs");
const RP = "/mnt/pages/page-repo-9c562cfc-8c55-4fa4-b226-d9c5dae153f0";
const ST = RP + "/.qw-pages/publish";
const OUT = "/workspace/5d12ecfd-e7d8-46d4-b63a-4dbb09c2226d/work/output/screenshots";
const kv = Object.fromEntries(fs.readFileSync(RP + "/.runtime-tmp/app.env", "utf8").split("\n").filter(Boolean).map(l => { const i = l.indexOf("="); return [l.slice(0, i), l.slice(i + 1)]; }));
const child = spawn(process.execPath, [ST + "/server.mjs"], { env: { ...process.env, NODE_ENV: "development", HOST: "127.0.0.1", PORT: "3488" }, cwd: ST, stdio: ["ignore", "pipe", "pipe"] });
const B = "http://127.0.0.1:3488";
(async () => {
 for (let i = 0; i < 110; i++) { try { if ((await fetch(B + "/healthz")).status === 200) break; } catch {} await new Promise(r => setTimeout(r, 400)); }
 const { chromium } = require("/usr/lib/node_modules/playwright");
 const br = await chromium.launch({ headless: true, args: ["--no-sandbox"] });
 const pg = await (await br.newContext({ viewport: { width: 1480, height: 980 } })).newPage();
 pg.on("dialog", (d) => d.dismiss()); // UI 冒烟不真删
 let fails = 0; const K = (n, c, x = "") => { console.log((c ? "PASS " : "FAIL ") + n, String(x).slice(0, 150)); if (!c) fails++; };
 await pg.goto(B + "/", { waitUntil: "networkidle" });
 const sso = await pg.getByRole("button", { name: /使用工作台账号登录/ }).count();
 if (sso) { await pg.getByRole("button", { name: /使用工作台账号登录/ }).first().click(); await pg.waitForTimeout(700); }
 await pg.locator("#ln").fill("safety_admin"); await pg.locator("#pw").fill(kv.ADMIN_PW);
 await pg.locator("button").filter({ hasText: /^登\s*录$/ }).first().click(); await pg.waitForTimeout(2200);
 await pg.evaluate(() => { location.hash = "#/sm-bindings"; }); await pg.waitForTimeout(2200);
 const view = await pg.evaluate(() => { const t = document.body.innerText; return { dual: t.includes("当前绑定") && t.includes("历史绑定"), demo: t.includes("DEMO_D0149"), veh: t.includes("车辆 95301325"), synth: t.includes("演示身份"), asof: !!document.querySelector('[aria-label="as_of 历史日期"]'), open: t.includes("持续有效"), win: !!document.querySelector('[aria-label="生效开始"]') }; });
 K("SM02 双区+窗口编辑+演示身份+as_of 控件齐备", view.dual && view.demo && view.synth && view.asof && view.open && view.win && view.veh, JSON.stringify(view));
 await pg.screenshot({ path: OUT + "/69_SM02_双区与窗口编辑_v25本地.png" });
 // 冲突预览真点击：编辑 demo 行窗口为与自身无关的 user_multi? 用"新建" 面板：选 DEMO_D0149 窗口 2026-08-01~08-05 user 留空？——填 u-admin-0001 → 预览命中 driver_slot（demo 的 open 行）
 await pg.fill('[aria-label="目标账号"]', "u-admin-0001");
 await pg.selectOption('[aria-label="选择司机"]', 'DEMO_D0149');
 await pg.fill('[aria-label="生效开始"]', "2026-12-01"); await pg.fill('[aria-label="结束（留空=持续）"]', "2026-12-05");
 await pg.evaluate(() => { const b = [...document.querySelectorAll("button")].find((x) => x.textContent.trim() === "预览冲突（不落库）"); b && b.click(); });
 await pg.waitForTimeout(1500);
 const preDbg = await pg.evaluate(() => document.body.innerText.split(String.fromCharCode(10)).filter((l) => l.indexOf("预览") >= 0 || l.indexOf("拒绝") >= 0).slice(-2).join(" || "));
 console.log("PREVIEW_UI", preDbg);
 K("UI 冲突预览显示命中", await pg.evaluate(() => /预览到冲突/.test(document.body.innerText)));
 await pg.screenshot({ path: OUT + "/70_SM02_冲突预览命中_v25本地.png", fullPage: false });
 await pg.selectOption('[aria-label="选择司机"]', "DEMO_D0001"); await pg.fill('[aria-label="生效开始"]', "2031-01-01"); await pg.fill('[aria-label="结束（留空=持续）"]', "");
 await pg.evaluate(() => { const b = [...document.querySelectorAll("button")].find((x) => x.textContent.trim() === "预览冲突（不落库）"); b && b.click(); });
 await pg.waitForTimeout(1500);
 K("UI 预览：开放远期窗口显示无冲突", await pg.evaluate(() => /预览：无冲突/.test(document.body.innerText)));
 await br.close();
 console.log(fails ? `UI23_${fails}_FAILED` : "UI23_OK"); child.kill("SIGTERM"); setTimeout(() => process.exit(fails ? 1 : 0), 250);
})().catch(e => { console.error("UI23_ERR", String(e.message).slice(0, 180)); child.kill("SIGTERM"); setTimeout(() => process.exit(1), 250); });
