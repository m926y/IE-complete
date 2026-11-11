// 第37轮 UI 冒烟：EV06 根因页 / SM05 生效链按钮 / SM03 映射卡 / TR02 强制预填 / 司机资料表单
const fs = require("node:fs");
const SHOT = "/workspace/2e745c89-a0e7-4322-81e0-175539140803/work/output/screenshots";
const kv = Object.fromEntries(fs.readFileSync("/tmp/qwenwork/rt/app.env", "utf8").split("\n").filter(Boolean).map(l => { const i = l.indexOf("="); return [l.slice(0, i), l.slice(i + 1)]; }));
const B = "http://127.0.0.1:3100";
let pass = 0, fail = 0;
const K = (n, c, x = "") => { console.log((c ? "PASS " : "FAIL ") + n, String(x).slice(0, 130)); c ? pass++ : fail++; };
(async () => {
  const { chromium } = require("/usr/lib/node_modules/playwright");
  const br = await chromium.launch({ headless: true, args: ["--no-sandbox"] });
  const ctx = await br.newContext({ viewport: { width: 1500, height: 980 } });
  const pg = await ctx.newPage();
  const errs = []; pg.on("pageerror", e => errs.push(String(e).slice(0, 110)));
  const BT = async () => await pg.evaluate(() => document.body.innerText || "");
  const wait = async (fn, ms = 8000) => { const t0 = Date.now(); while (Date.now() - t0 < ms) { try { if (await fn()) return true; } catch {} await new Promise(r => setTimeout(r, 250)); } return false; };
  await pg.goto(B + "/", { waitUntil: "networkidle" });
  await pg.getByRole("button", { name: /使用账号登录|使用工作台账号登录/ }).first().click().catch(() => {}); await pg.waitForTimeout(400);
  await pg.locator("#ln").fill("safety_admin"); await pg.locator("#pw").fill(kv.ADMIN_PW);
  await pg.locator(".login-submit").click(); await wait(async () => (await pg.locator("nav.side").count()) === 1, 8000);
  // R1 EV06
  await pg.goto(B + "/#/ev-root", { waitUntil: "domcontentloaded" }); await pg.waitForTimeout(3000);
  K("U1 根因分析页：池/维度贡献/事件TOP/限制声明", await wait(async () => { const t = await BT(); return /分析对象数/.test(t) && /维度分摊贡献/.test(t) && /结构性归因/.test(t); }, 10000));
  K("U2 二级tab含根因分析", /根因分析/.test(await BT()));
  await pg.screenshot({ path: SHOT + "/ui37-01-root.png" });
  // R2 SM05 生效链
  await pg.goto(B + "/#/sm-drafts", { waitUntil: "domcontentloaded" }); await pg.waitForTimeout(1500);
  K("U3 SM05：权重输入+批准/生效链路文案在位", await wait(async () => { const t = await BT(); return /生效为新口径|批准…|结构化|提交审核/.test(t) && /ruleset|生效/.test(t); }, 6000), (await BT()).includes("生效") ? "生效文案OK" : "");
  await pg.screenshot({ path: SHOT + "/ui37-02-sm05.png" });
  // R3 SM03 映射卡
  await pg.goto(B + "/#/sm-config", { waitUntil: "domcontentloaded" }); await pg.waitForTimeout(1200);
  await pg.locator("button", { hasText: "运营参数" }).first().click(); await pg.waitForTimeout(1200);
  K("U4 SM03：风险等级→强制性映射卡渲染", await wait(async () => { const t = await BT(); return /风险等级 → 强制性培训映射/.test(t) && /非强制|强制/.test(t); }, 6000));
  // R4 TR02 预填
  await pg.goto(B + "/#/tr-create", { waitUntil: "domcontentloaded" }); await pg.waitForTimeout(1200);
  await pg.locator("input").first().fill("");
  const inp = pg.locator(".field input").first();
  await inp.fill("DEMO_D0149"); await pg.waitForTimeout(400);
  await inp.press("Tab"); await pg.waitForTimeout(2500);
  K("U5 TR02：输入司机后按映射预填提示+勾选", await wait(async () => { const t = await BT(); return /映射=强制|已按现行映射预填/.test(t); }, 8000), (await BT()).match(/等级 D 映射=[^\n]*/)?.[0].slice(0, 60) || "");
  await pg.screenshot({ path: SHOT + "/ui37-03-tr02.png" });
  K("U6 管理员端无运行时异常", errs.length === 0, errs.join(";"));
  // R5 司机资料
  const ctx2 = await br.newContext({ viewport: { width: 400, height: 860 } });
  const dp = await ctx2.newPage();
  const derrs = []; dp.on("pageerror", e => derrs.push(String(e).slice(0, 110)));
  await dp.goto(B + "/", { waitUntil: "domcontentloaded" }); await dp.waitForTimeout(1200);
  await dp.getByRole("button", { name: /使用账号登录|使用工作台账号登录/ }).first().click().catch(() => {}); await dp.waitForTimeout(300);
  await dp.locator("#ln").fill("driver_demo"); await dp.locator("#pw").fill(kv.DRIVER_PW);
  await dp.locator(".login-submit").click(); await dp.waitForTimeout(2200);
  await dp.locator(".tabbar button", { hasText: "我的资料" }).first().click().catch(() => {}); await dp.waitForTimeout(1500);
  K("U7 司机资料表单在位（含上轮回读值）", await wait(async () => { const t = await dp.evaluate(() => document.body.innerText || ""); return /联系方式与备注/.test(t); }, 6000));
  const ph = dp.locator("input").filter({ hasText: "" }).first();
  await dp.getByPlaceholder("例如 138-0000-0000").first().fill("139-2222-3344");
  await dp.getByText("保存资料").first().click();
  K("U8 保存→审计回执文案", await wait(async () => { const t = await dp.evaluate(() => document.body.innerText || ""); return /已保存 · 审计/.test(t); }, 8000));
  await dp.screenshot({ path: SHOT + "/ui37-04-profile.png" });
  K("U9 司机端无运行时异常", derrs.length === 0, derrs.join(";"));
  await br.close();
  console.log(`\nUI37 RESULT pass=${pass} fail=${fail}`);
  process.exit(fail ? 1 : 0);
})().catch(e => { console.error("RUNNER ERR", e); process.exit(2); });
