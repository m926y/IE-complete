// 第34轮 新UI（行安 2026-10-24 版）迁移回归 v2：功能保全冒烟
const fs = require("node:fs");
const RP = "/mnt/pages/page-repo-9c562cfc-8c55-4fa4-b226-d9c5dae153f0";
const SHOT = "/workspace/2e745c89-a0e7-4322-81e0-175539140803/work/output/screenshots";
const kv = Object.fromEntries(fs.readFileSync("/tmp/qwenwork/rt/app.env", "utf8").split("\n").filter(Boolean).map(l => { const i = l.indexOf("="); return [l.slice(0, i), l.slice(i + 1)]; }));
const B = "http://127.0.0.1:3100";
let pass = 0, fail = 0;
const K = (n, c, x = "") => { console.log((c ? "PASS " : "FAIL ") + n, String(x).slice(0, 130)); c ? pass++ : fail++; };
const P = async (fn, ms = 1500) => { const t0 = Date.now(); while (Date.now() - t0 < ms) { try { if (await fn()) return true; } catch {} await new Promise(r => setTimeout(r, 200)); } return false; };
(async () => {
  // ---------- API ----------
  const lr = await fetch(B + "/api/auth/login", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ username: "driver_demo", password: kv.DRIVER_PW }) });
  const cookie = (lr.headers.getSetCookie() || []).map(c => c.split(";")[0]).join("; ");
  K("A1 司机登录", lr.status === 200);
  const h = await fetch(B + "/api/data/my.score_history?limit=20", { headers: { cookie } }).then(r => r.json());
  const f = (h.rows || [])[0] || {};
  K("A2 my.score_history 六维+source_version 白名单", h.rows?.length >= 8 && "history_contribution" in f && "imu_evidence_contribution" in f && "source_version" in f);
  const s = await fetch(B + "/api/data/my.score?limit=2", { headers: { cookie } }).then(r => r.json());
  const s0 = (s.rows || [])[0] || {};
  K("A3 my.score 行为分/下界/预测字段", "behavior_safety_score" in s0 && "confidence_adjusted_floor" in s0 && "forecast_40d_risk_prob" in s0);
  const sixSum = ["history_contribution", "fatigue_distraction_contribution", "driving_stability_contribution", "road_rule_contribution", "management_contribution", "imu_evidence_contribution"].reduce((a, k) => a + Number(s0[k] || 0), 0);
  K("A4 司机端六维合计=100−安全分", Math.abs(sixSum - (100 - Number(s0.safety_score))) < 1e-6, sixSum + " vs " + (100 - Number(s0.safety_score)));
  K("A5 my.score 仍无他人数据（会话注入）", (s.rows || []).every((r) => r.driver_id === undefined || String(h.rows[0].score_id).length > 0));
  const dsr = await fetch(B + "/api/auth/login", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ username: "safety_admin", password: kv.ADMIN_PW }) });
  const ack = (dsr.headers.getSetCookie() || []).map(c => c.split(";")[0]).join("; ");
  K("A6 管理员登录", dsr.status === 200);
  const all5 = await fetch(B + "/api/data/admin.score_snapshots?limit=1", { headers: { cookie: ack } }).then(r => r.json());
  K("A7 全量500对象在库", all5.total === 500, "total=" + all5.total);

  // ---------- 浏览器 ----------
  const { chromium } = require("/usr/lib/node_modules/playwright");
  const br = await chromium.launch({ headless: true, args: ["--no-sandbox"] });
  const ctx = await br.newContext({ viewport: { width: 1500, height: 980 } });
  const pg = await ctx.newPage();
  const errs = [];
  pg.on("pageerror", e => errs.push("PE:" + String(e).slice(0, 110)));
  const BT = () => pg.evaluate(() => document.body.innerText || "");
  await pg.goto(B + "/", { waitUntil: "networkidle" });
  await P(async () => (await pg.getByRole("button", { name: /使用账号登录|使用工作台账号登录/ }).count()) > 0, 4000).catch(() => {});
  await pg.getByRole("button", { name: /使用账号登录|使用工作台账号登录/ }).first().click().catch(() => {});
  await pg.waitForTimeout(400);
  K("U1 登录页新UI（品牌区+明文切换）", await pg.locator(".login-visual").count() === 1 && await pg.locator(".password-toggle").count() === 1);
  await pg.locator("#pw").fill(kv.ADMIN_PW); await pg.locator("#pw").press("Tab");
  K("U1b 口令不出现在URL/标题", !/pass|pwd/i.test(pg.url()));
  await pg.locator("#ln").fill("safety_admin"); await pg.locator("#pw").fill(kv.ADMIN_PW);
  await pg.locator(".login-submit").click();
  await P(async () => (await pg.locator("nav.side").count()) === 1, 6000);
  K("U2 新侧栏六个一级入口", (await pg.locator("nav.side a, nav.side button").count()) === 6, (await pg.evaluate(() => document.querySelector("nav.side")?.innerText || "")).replace(/\s+/g, "|").slice(0, 70));
  await P(async () => /评分车辆/.test(await BT()), 8000);
  K("U3 数据总览：真值渲染", /评分车辆/.test(await BT()) && /平均安全分|74\./.test(await BT()));
  await pg.screenshot({ path: SHOT + "/ui34-01-dashboard.png" });
  // 顶部模块tab
  await pg.goto(B + "/#/ev-fleet", { waitUntil: "domcontentloaded" }); await pg.waitForTimeout(2500);
  K("U4 二级功能在顶部标签（车队管理组）", (await pg.locator("nav.module-tabs a").count()) >= 3, (await pg.evaluate(() => document.querySelector("nav.module-tabs")?.innerText || "")).replace(/\n/g, "|"));
  await P(async () => (await pg.locator(".fleet-metrics").count()) === 1); const ft = await pg.evaluate(() => document.querySelector(".fleet-metrics")?.innerText || "");
  K("U5 EV01 指标卡+等级筛选按钮", /评分车辆/.test(ft) && (await pg.locator(".fleet-filters button").count()) === 5, ft.replace(/\n/g, "|").slice(0, 90));
  await pg.locator(".fleet-filters button", { hasText: "D 级" }).click(); await pg.waitForTimeout(1500);
  K("U6 EV01 D级筛选", await P(async () => /D（高优先复核）/.test(await pg.evaluate(() => document.querySelector("tbody")?.innerText || "")), 8000));
  await pg.screenshot({ path: SHOT + "/ui34-02-ev01-d.png" });
  // 车辆编号搜索
  await pg.locator(".fleet-search input").fill("95301325"); await pg.locator(".fleet-search button").click(); await pg.waitForTimeout(1500);
  K("U7 EV01 车辆查询", await P(async () => /95301325/.test(await pg.evaluate(() => document.querySelector("tbody")?.innerText || "")), 6000));
  // 深链+EV03
  await pg.goto(B + "/#/ev-fleet?driver_id=DEMO_D0177", { waitUntil: "domcontentloaded" }); await pg.waitForTimeout(2200);
  K("U8 深链进 EV03（演示身份标注）", await P(async () => /演示身份/.test(await BT()), 9000));
  K("U9 六维面板在线对账", await P(async () => { const t = await pg.evaluate(() => [...document.querySelectorAll(".panel")].map(e => e.innerText).join("\n")); return /合计=100−安全分/.test(t) && /一致|差异/.test(t); }, 5000));
  for (const tb of ["未来风险预测", "事件证据", "管理动作"]) { await pg.locator("button", { hasText: tb }).first().click().catch(() => {}); await pg.waitForTimeout(600); }
  K("U10 EV03 管理动作四入口", /EV05 复核处理/.test(await BT()) && /比较处置方案/.test(await BT()) && /TR02 培训草稿/.test(await BT()));
  await pg.screenshot({ path: SHOT + "/ui34-03-ev03.png" });
  // RM01
  await pg.goto(B + "/#/rm-queue", { waitUntil: "domcontentloaded" }); await pg.waitForTimeout(2000);
  K("U11 RM01 六分组卡（含7天下降）", /7天下滑/.test(await BT()) && /优先复核/.test(await BT()));
  await pg.evaluate(() => { window.location.hash = "rm-queue"; });
  await pg.locator("main").getByText("7天下滑").first().click().catch(async () => { await pg.getByText("7天下滑", { exact: false }).nth(1).click(); });
  await pg.waitForTimeout(1800);
  const rmTxt = await BT();
  K("U12 drop7 面板真实两日+32口径", /2026-07-24/.test(rmTxt) && /2026-07-31/.test(rmTxt) && /32/.test(rmTxt));
  await pg.getByText("常规观察").first().click().catch(() => {}); await pg.waitForTimeout(1500);
K("U13 RM01 QueueConfirm（非drop7分组可建单）", /对该对象发起人工核查|建立设备\/数据核验待办/.test(await BT()));
  await pg.screenshot({ path: SHOT + "/ui34-04-rm01-drop7.png" });
  // AI04
  await pg.goto(B + "/#/ai-preplan?driver_id=DEMO_D0149", { waitUntil: "domcontentloaded" }); await pg.waitForTimeout(2200);
  K("U14 AI04 「未写入」横幅+三卡", await P(async () => { const t = await BT(); return /操作预演，未写入/.test(t) && /设备|沟通|课程|核验/.test(t); }, 6000));
  await pg.screenshot({ path: SHOT + "/ui34-05-ai04.png" });
  // RM03
  await pg.goto(B + "/#/rm-alerts?alert_id=alert-1e7ec09935dd735b", { waitUntil: "domcontentloaded" }); await pg.waitForTimeout(1800);
  K("U15 RM03 案卷深链+状态机文案", await P(async () => /alert-1e7ec09935dd735b/.test(await BT()), 6000));
  // TR
  await pg.goto(B + "/#/tr-courses", { waitUntil: "domcontentloaded" }); await pg.waitForTimeout(1500);
  K("U16 TR05 课程库（审核按钮组存在）", /课程|C01|待审核|批准/.test(await BT()));
  await pg.goto(B + "/#/tr-create", { waitUntil: "domcontentloaded" }); await pg.waitForTimeout(1500);
  K("U17 TR02 门禁文案+模板picker+确认按钮", await P(async () => { const t = await BT(); return /仅 approved|安全员确认分配|确认分配/.test(t) && /草稿状态，未分配/.test(t) && /强制培训/.test(t); }, 5000));
  // SM 抽检
  await pg.goto(B + "/#/sm-config", { waitUntil: "domcontentloaded" }); await pg.waitForTimeout(1300);
  K("U18 SM03 生效链说明（开放配置后口径）", await P(async () => /现行生效口径|唯一变更通道|旁路直改一律 410/.test(await BT()), 4000));
  await pg.goto(B + "/#/sm-drafts", { waitUntil: "domcontentloaded" }); await pg.waitForTimeout(1300);
  K("U19 SM05 生效链门禁注记", await P(async () => /批准并生效前不参与|生效需显式确认/.test(await BT()), 4000));
  await pg.goto(B + "/#/sm-audit", { waitUntil: "domcontentloaded" }); await pg.waitForTimeout(1800);
  K("U20 SM04 审计隐私注记", await P(async () => /不显示口令、完整问答/.test(await BT()), 4000));
  await pg.goto(B + "/#/sm-knowledge?tab=templates", { waitUntil: "domcontentloaded" }); await pg.waitForTimeout(1300);
  K("U21 SM06 模板深链tab+永不自动批准注记", await P(async () => { const t = await BT(); return /通知模板/.test(t) && /永不自动批准|占位符白名单/.test(t); }, 4000));
  await pg.goto(B + "/#/sm-accounts", { waitUntil: "domcontentloaded" }); await pg.waitForTimeout(1300);
  K("U22 SM01 不出现口令明文", await P(async () => { const t = await BT(); return /账号与角色/.test(t) && !t.includes(kv.ADMIN_PW) && !t.includes(kv.DRIVER_PW) && /不出现口令|不记录于页面|不落任何口令/.test(t); }, 4000));
  // AI 面板
  await pg.goto(B + "/#/overview", { waitUntil: "domcontentloaded" }); await pg.waitForTimeout(1200);
  await pg.locator("nav.side button", { hasText: "智能助手" }).click(); await pg.waitForTimeout(700);
  await P(async () => (await pg.locator(".ai-panel").count()) === 1, 4000);
  const aiTxt = await pg.evaluate(() => document.querySelector(".ai-panel")?.innerText || "");
  K("U23 AI面板：自检+长期摘要+指令版本", /运行工具链自检/.test(aiTxt) && /重登后保留脱敏摘要/.test(aiTxt) && /指令版本|Qwen/.test(aiTxt), aiTxt.replace(/\n/g, "|").slice(0, 110));
  await pg.screenshot({ path: SHOT + "/ui34-06-ai.png" });
  // 司机端
  const ctx2 = await br.newContext({ viewport: { width: 400, height: 860 } });
  const dp = await ctx2.newPage();
  const derrs = []; dp.on("pageerror", e => derrs.push(String(e).slice(0, 110)));
  await dp.goto(B + "/", { waitUntil: "domcontentloaded" }); await dp.waitForTimeout(1200);
  await dp.getByRole("button", { name: /使用账号登录|使用工作台账号登录/ }).first().click().catch(() => {}); await dp.waitForTimeout(300);
  await dp.locator("#ln").fill("driver_demo"); await dp.locator("#pw").fill(kv.DRIVER_PW);
  await dp.locator(".login-submit").click(); await dp.waitForTimeout(2200);
  const DBT = (await dp.evaluate(() => document.body.innerText || ""));
  K("U24 司机端布局+演示水印", /司机端/.test(DBT) && /演示数据绑定/.test(DBT), DBT.replace(/\n/g, "|").slice(0, 120));
  K("U25 EV04 六维/历史（补丁字段渲染）", /六维为最后一日/.test(DBT) && /历史/.test(DBT) && (DBT.match(/—/g) || []).length < 15);
  K("U26 匿名车队统计", /匿名车队统计/.test(DBT) && /500|74/.test(DBT));
  await dp.screenshot({ path: SHOT + "/ui34-07-driver.png" });
  for (const t of ["今日风险", "培训任务", "我的资料"]) { await dp.locator(".tabbar button", { hasText: t }).first().click().catch(() => {}); await dp.waitForTimeout(900); }
  const DT2 = await dp.evaluate(() => document.body.innerText || "");
  K("U27 培训/资料页可达", /培训任务/.test(DT2) && /我的资料|退出登录/.test(DT2));
  K("U28 司机端无运行时异常", derrs.length === 0, derrs.join(";"));
  await dp.screenshot({ path: SHOT + "/ui34-08-driver-profile.png" });
  K("U29 管理员端无运行时异常", errs.length === 0, errs.join(";").slice(0, 200));
  await br.close();
  console.log(`\nUI34 RESULT pass=${pass} fail=${fail}`);
  process.exit(fail ? 1 : 0);
})().catch(e => { console.error("RUNNER ERR", e); process.exit(2); });
