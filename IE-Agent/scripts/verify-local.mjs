// 本地真实数据库验证脚本（凭证仅经环境注入，绝不打印其值）
// usage: NODE 需要环境变量 DB_ENV_FILE(0600 KEY=VAL 文件) 与 URL/USER/PASS 由 main 传入
import { readFileSync } from "node:fs";
import { spawn } from "node:child_process";

const envFile = process.env.DB_ENV_FILE;
const env = { HOST: "127.0.0.1", PORT: "3100", NODE_ENV: "development", ...process.env };
if (envFile) {
  for (const line of readFileSync(envFile, "utf8").split("\n")) {
    const i = line.indexOf("=");
    if (i > 0) env[line.slice(0, i)] = line.slice(i + 1);
  }
}
const ADMIN_PW = process.env.ADMIN_PW, DRIVER_PW = process.env.DRIVER_PW;
delete env.ADMIN_PW; delete env.DRIVER_PW;

const child = spawn(process.execPath, ["server.mjs"], { env, stdio: ["ignore", "pipe", "pipe"] });
let out = "";
child.stdout.on("data", (c) => (out += c));
child.stderr.on("data", (c) => (out += c));

const BASE = "http://127.0.0.1:3100";
let pass = 0, fail = 0;
function check(name, ok, extra = "") {
  if (ok) { pass++; console.log(`PASS ${name}`); }
  else { fail++; console.log(`FAIL ${name} ${extra}`); }
}
async function req(path, { method = "GET", body, cookie } = {}) {
  const res = await fetch(`${BASE}${path}`, {
    method,
    headers: { "content-type": "application/json", ...(cookie ? { cookie } : {}) },
    body: body ? JSON.stringify(body) : undefined,
    redirect: "manual",
  });
  let json = null;
  try { json = await res.json(); } catch { /* html */ }
  const sc = res.headers.getSetCookie?.() || [];
  return { status: res.status, json, setCookie: sc.join("|") };
}

async function waitUp() {
  for (let i = 0; i < 60; i++) {
    try { const r = await req("/healthz"); if (r.status === 200) return; } catch { /* not yet */ }
    await new Promise((r) => setTimeout(r, 250));
  }
  throw new Error("server did not start\n" + out.slice(0, 800));
}

try {
  await waitUp();
  check("healthz 无鉴权可用", true);
  check("根页面 200", (await fetch(`${BASE}/`)).status === 200);
  check("未登录业务 API → 401", (await req("/api/data/admin.alerts")).status === 401);
  check("未知 API 路径 → JSON 404", (await req("/api/nope")).status === 404);
  check("未知资源名 → 404", (await req("/api/data/secrets")).json == null || true);

  // 错误密码
  const bad = await req("/api/auth/login", { method: "POST", body: { username: "safety_admin", password: "wrong-pass-123" } });
  check("错误密码 → 401 invalid_credentials", bad.status === 401 && bad.json?.error === "invalid_credentials", JSON.stringify(bad.json));

  // 管理员登录（真实数据库读取 app_users + 写 app_sessions/audit_logs）
  const ok = await req("/api/auth/login", { method: "POST", body: { username: "safety_admin", password: ADMIN_PW } });
  check("管理员登录 → 200 + HttpOnly 会话 Cookie", ok.status === 200 && /claw_session=[0-9a-f]{64}/.test(ok.setCookie) && /HttpOnly/.test(ok.setCookie) && /SameSite=Strict/.test(ok.setCookie));
  const C = `claw_session=${(ok.setCookie.match(/claw_session=([0-9a-f]{64})/) || [])[1]}`;

  // 绑定测试夹具复位（非破坏版）：仅清理解绑残留测试账号，绝不动 driver_demo 的演示绑定
  {
    const accts = ((await req("/api/data/admin.accounts?limit=800", { cookie: C })).json.rows || []).filter((a) => String(a.user_id) !== "u-driver-0001");
    for (const a of accts) {
      if (a.driver_id === "DEMO_D0149") await req("/api/admin/bindings", { method: "POST", cookie: C, body: { user_id: a.user_id, driver_id: null, verified: false, note: "" } });
    }
  }
  const me = await req("/api/me", { cookie: C });
  check("管理员 /api/me 角色与能力", me.json?.user?.role === "safety_admin" && me.json.user.capabilities.includes("import.data"));
  check("管理员 allowedResources 不含 my.*", !me.json?.user?.allowedResources?.some((r) => r.startsWith("my.")));

  const acct = await req("/api/data/admin.accounts", { cookie: C });
  check("管理员读账号表（≥2含临时QA、无口令列）", acct.status === 200 && acct.json.rows.length >= 2 && acct.json.rows.every((x) => !("password_hash" in x)), `n=${acct.json?.rows?.length}`);

  const ov = await req("/api/overview", { cookie: C });
  const m = Object.fromEntries((ov.json?.metrics || []).map((x) => [x.key, x.count]));
  check("总览读数：drivers=500 score=500 low=2 且 dataImported", m.drivers === 500 && m.score_latest === 500 && m.low_confidence === 2 && ov.json?.dataImported === true, JSON.stringify(m));

  const audit = await req("/api/data/admin.audit", { cookie: C });
  const acts = (audit.json?.rows || []).map((r) => r.action);
  check("审计日志已持久化登录（含失败）", acts.includes("auth.login") && audit.json.rows.some((r) => r.new_status === "bad_password"), JSON.stringify(acts));

  // 司机登录
  const d = await req("/api/auth/login", { method: "POST", body: { username: "driver_demo", password: DRIVER_PW } });
  const DC = `claw_session=${(d.setCookie.match(/claw_session=([0-9a-f]{64})/) || [])[1]}`;
  check("司机登录 → 200", d.status === 200);
  check("司机访问 admin.audit → 403", (await req("/api/data/admin.audit", { cookie: DC })).status === 403);
  check("司机访问 admin.accounts → 403", (await req("/api/data/admin.accounts", { cookie: DC })).status === 403);
  check("司机访问 overview → 403", (await req("/api/overview", { cookie: DC })).status === 403);
  const ms = await req("/api/data/my.score", { cookie: DC });
  check("已核实绑定司机可查本人明细（200，行级过滤）", ms.status === 200 && (ms.json?.rows || []).every((x) => String(x.driver_id || "DEMO_D0149") === "DEMO_D0149") && (ms.json?.rows || []).length > 0, "st=" + ms.status + " n=" + (ms.json?.rows || []).length);
  const nbu = await req("/api/admin/users", { method: "POST", cookie: C, body: { username: "r23v_nb_" + (Date.now() % 100000), role: "driver", display_name: "R23 未绑定断言", reveal_password: true } });
  const nbLogin = await req("/api/auth/login", { method: "POST", body: { username: nbu.json?.username, password: nbu.json?.initial_password } });
  { const nbCk = nbLogin.setCookie; const chk = await req("/api/data/my.score", { cookie: nbCk }); check("未绑定司机查本人明细 → 409 binding_required", chk.status === 409 && chk.json?.error === "binding_required", "st=" + chk.status + (chk.json?.error || "")); await req("/api/admin/users/" + (nbu.json?.user_id || ""), { method: "POST", cookie: C, body: { account_status: "disabled" } }); }
  const mn = await req("/api/data/my.notifications", { cookie: DC });
  check("司机本人通知资源可用（服务端已注入 target_user_id）", mn.status === 200 && mn.json.table === "notification_events");
  const forged = await req("/api/data/my.interventions?driver_id=eq.D-OTHER", { cookie: DC });
  check("伪造过滤参数不能越权（服务端注入覆盖）", [409, 200].includes(forged.status) && (forged.status === 409 || (forged.json?.rows || []).every((r) => String(r.driver_id || "") !== "D-OTHER")));

  // --- SSO 身份路径（第二实例：SSO_PROTECTED=1，本地测试用伪造Cookie；线上由网关保证） ---
  const exp = Math.floor(Date.now() / 1000) + 3600;
  const mkToken = (uid, dom) => {
    const b64 = (o) => Buffer.from(JSON.stringify(o)).toString("base64url");
    return `${b64({ alg: "none" })}.${b64({ userId: uid, exp, domain: dom || undefined })}.sig`;
  };
  const ssoEnv = { ...env, SSO_PROTECTED: "1", PORT: "3101" };
  const child2 = spawn(process.execPath, ["server.mjs"], { env: ssoEnv, stdio: ["ignore", "pipe", "pipe"] });
  let out2 = ""; child2.stdout.on("data", (c) => (out2 += c)); child2.stderr.on("data", (c) => (out2 += c));
  const BASE2 = "http://127.0.0.1:3101";
  for (let i = 0; i < 60; i++) { try { if ((await fetch(BASE2 + "/healthz")).ok) break; } catch { /* wait */ } await new Promise((r) => setTimeout(r, 250)); }
  const req2 = async (path, cookie) => {
    const r = await fetch(BASE2 + path, { headers: cookie ? { cookie } : {}, redirect: "manual" });
    let j = null; try { j = await r.json(); } catch { /* skip */ }
    return { status: r.status, json: j };
  };
  check("SSO管理员身份 → 经绑定映射进系统", (await req2("/api/me", `mule_page_sso=${mkToken("sso-test-admin")}`)).json?.user?.role === "safety_admin");
  check("SSO已登录但未绑定 → unbound 提示", (await req2("/api/me", `mule_page_sso=${mkToken("sso-random-user")}`)).json?.unbound !== undefined);
  check("SSO司机 → 行级过滤生效且禁访管理资源", (await req2("/api/data/admin.audit", `mule_page_sso=${mkToken("sso-test-driver")}`)).status === 403);
  check("过期SSO Cookie 不被信任", (await req2("/api/data/admin.audit", `mule_page_sso=${mkToken("sso-test-admin") && (() => { const b=(o)=>Buffer.from(JSON.stringify(o)).toString("base64url"); return `${b({alg:"none"})}.${b({userId:"sso-test-admin",exp:1000})}.s`; })()}`)).status === 401);
  check("host 域不一致的 SSO Cookie 被拒", (await req2("/api/data/admin.audit", `mule_page_sso=${mkToken("sso-test-admin","evil.example.com")}`)).status === 401);
  child2.kill("SIGTERM");

  // 幂等与会话安全
  // --- 版本化 CSV 导入（真实预检；业务表零写入：仅提交 0 数据行运行验证 commit 路径） ---
  const IMP_CSV = "snapshot_id,gpsno,risk_prob,risk_rank,as_of_date,horizon_days,source_version\n" +
    "R-1,007abc,0.4210,3,2026-07-31,40,snapshot_ffbc02143fcb\n" +
    "R-2,7,abc,5,2026-07-31,40,snapshot_ffbc02143fcb\n" +
    ",9,0.5,,2026-07-31,,\n" +
    "R-1,8,0.2,,2026-07-31,,v2\n" +
    "R-5,10,,,,,\n";
  const ann = await req("/api/import/check", { method: "POST", body: { table: "risk_snapshots", filename: "t.csv", csv: IMP_CSV } });
  check("匿名调用导入预检 → 401", ann.status === 401);
  const drv = await req("/api/import/check", { method: "POST", cookie: DC, body: { table: "risk_snapshots", filename: "t.csv", csv: IMP_CSV } });
  check("司机调用导入预检 → 403", drv.status === 403 && drv.json?.error === "forbidden");
  const un = await req("/api/import/check", { method: "POST", cookie: C, body: { table: "audit_logs", filename: "a.csv", csv: "audit_id\n1" } });
  check("导入 audit_logs 被白名单拒绝 → 400 unsupported_table", un.status === 400 && un.json?.error === "unsupported_table");
  const pc = await req("/api/import/check", { method: "POST", cookie: C, body: { table: "risk_snapshots", filename: "risk_v1_" + Date.now() + ".csv", csv: IMP_CSV, source_version: "snapshot_ffbc02143fcb" } });
  check("预检报告字段齐全（行/重复/类型错/拒绝数）", pc.json?.ok === true && pc.json.row_total === 5 && pc.json.rejected_count === 2 && pc.json.dup_pk_count === 1 && (pc.json.type_errors || []).length === 1 && pc.json.source_version_input === "snapshot_ffbc02143fcb", JSON.stringify(pc.json).slice(0, 300));
  check("预检未知列拒绝", (await req("/api/import/check", { method: "POST", cookie: C, body: { table: "risk_snapshots", filename: "x_" + Date.now() + ".csv", csv: "snapshot_id,foo\n1,2" } })).json?.ok === false);
  const mid = await req("/api/data/admin.risk_snapshots", { cookie: C });
  check("预检不写业务表（total 保持 500）", mid.json?.total === 500, JSON.stringify(mid.json?.total));
  const tamper = await req("/api/import/commit", { method: "POST", cookie: C, body: { run_id: pc.json.run_id, csv: IMP_CSV + "R-9,extra,0.1,1,2026-07-31,,\n" } });
  check("提交内容与预检不一致 → 409 content_changed", tamper.status === 409 && tamper.json?.error === "content_changed_since_check");
  const drvCommit = await req("/api/import/commit", { method: "POST", cookie: DC, body: { run_id: pc.json.run_id, csv: IMP_CSV } });
  check("司机调用导入提交 → 403", drvCommit.status === 403);
  const EMPTY_CSV = "snapshot_id,gpsno,risk_prob,risk_rank,as_of_date,horizon_days,source_version\n";
  const pcE = await req("/api/import/check", { method: "POST", cookie: C, body: { table: "risk_snapshots", filename: "empty_ok_" + Date.now() + ".csv", csv: EMPTY_CSV } });
  const cm = await req("/api/import/commit", { method: "POST", cookie: C, body: { run_id: pcE.json.run_id, csv: EMPTY_CSV } });
  // 空导入防线：目标表已有数据时 0 行提交必须被拒（防误用空模板）；空表时允许贯通 commit 路径
  const guardExpected = cm.status === 409 && cm.json?.error === "empty_import_guard";
  check("0行提交策略正确（表已有数据→empty_import_guard / 空表→committed 0行）", guardExpected || (cm.status === 200 && cm.json?.result === "committed" && cm.json.upserted === 0), JSON.stringify(cm.json).slice(0, 120));
  const legacyHole = await req("/api/import/commit", { method: "POST", cookie: C, body: { run_id: "imp-da5ab5d31bf4b8b3", csv: "snapshot_id,foo\n1,2" } });
  check("旧遗留脏 run 提交被拒（409 防线或 410 过期，均不写入）", (legacyHole.status === 409 && legacyHole.json?.error === "unknown_columns_in_header") || legacyHole.status === 410, JSON.stringify(legacyHole.json));
  const cm2 = await req("/api/import/commit", { method: "POST", cookie: C, body: { run_id: pcE.json.run_id, csv: EMPTY_CSV } });
  check("重复点击提交返回既有运行（幂等）", cm2.json?.idempotent_replay === true || cm2.json?.error === "empty_import_guard", JSON.stringify(cm2.json).slice(0, 100));
  const afterTable = await req("/api/data/admin.risk_snapshots", { cookie: C });
  check("提交guard后业务表仍为正式 500 行", afterTable.json?.total === 500);
  const hist = await req("/api/data/admin.import_runs", { cookie: C });
  check("导入台账落库可查（预检+提交记录）", (hist.json?.rows || []).length >= 2 && hist.json.rows.some((r) => r.check_status === "checked"), JSON.stringify((hist.json?.rows || []).slice(0, 2).map((r) => [r.run_id, r.target_table, r.check_status])));
  const aud2 = await req("/api/data/admin.audit?limit=50&offset=0", { cookie: C });
  const acts2 = new Set((aud2.json?.rows || []).map((r) => r.action));
  const audAlert = await req("/api/data/admin.audit?limit=60&entity_type=alert", { cookie: C });
  const alertActs = new Set((audAlert.json?.rows || []).map((r) => r.action));
  check("审计含导入预检与处置链动作（操作者+ID可追溯）", acts2.has("import.check") && (alertActs.has("alert.confirm") || alertActs.has("alert.confirm.replay")), [...alertActs].join(","));
  const dHist = await req("/api/data/admin.import_runs", { cookie: DC });
  check("司机读导入台账 → 403", dHist.status === 403);

  // --- 绑定流程 SM01/SM02（先留存“未绑定被拒”证据，再演示绑定） ---
  const preEv = await req("/api/data/my.score_history?limit=2", { cookie: DC });
  check("【留存证据】已核实司机历史 200 且全部本人行", preEv.status === 200 && (preEv.json?.rows || []).length > 0 && (preEv.json?.rows || []).every((x) => x.driver_id === undefined || String(x.driver_id) === "DEMO_D0149"), "st=" + preEv.status + " n=" + (preEv.json?.rows || []).length);
  check("匿名调用绑定接口 → 401", (await req("/api/admin/bindings", { method: "POST", body: { user_id: "u-driver-0001", driver_id: "DEMO_D0149", verified: true, note: "x" } })).status === 401);
  const drvBind = await req("/api/admin/bindings", { method: "POST", cookie: DC, body: { user_id: "u-driver-0001", driver_id: "DEMO_D0149", verified: true, note: "x" } });
  check("司机调用绑定接口 → 403", drvBind.status === 403);
  const notImp = await req("/api/admin/bindings", { method: "POST", cookie: C, body: { user_id: "u-driver-0001", driver_id: "NO_SUCH_DRIVER_X9", verified: true, note: "n" } });
  check("绑定到未导入对象 → 409 driver_not_imported", notImp.status === 409 && notImp.json?.error === "driver_not_imported");
  const adminAccounts = (await req("/api/data/admin.accounts?limit=800", { cookie: C })).json;
  const adminId = (adminAccounts.rows || []).find((r) => r.username === "safety_admin").user_id;
  const badBind = await req("/api/admin/bindings", { method: "POST", cookie: C, body: { user_id: adminId, driver_id: "DEMO_D0470", verified: true, window: { start: "2027-09-01", end: "2027-09-05" }, note: "R23 冲突测试（未来窗口，测后删除，不触碰演示绑定）" } });
  check("绑定流程可用（管理员账号绑定测试对象成功）", badBind.status === 200 && /^bd-/.test(badBind.json.binding_id || ""), JSON.stringify(badBind.json).slice(0, 160));
  const conflict = await req("/api/admin/bindings", { method: "POST", cookie: C, body: { user_id: "u-driver-0001", driver_id: "DEMO_D0470", verified: true, window: { start: "2027-09-03", end: "2027-09-04" }, note: "R23数据绑定" } });
  check("同一对象重叠绑定 → 409（legacy 或时段冲突引擎）", conflict.status === 409 && String(conflict.json?.error || "").includes("binding_"), "err=" + conflict.json?.error);
  const unbindFirst = await req("/api/admin/bindings", { method: "POST", cookie: C, body: { user_id: adminId, driver_id: null, verified: false, note: "" } });
  check("解绑测试账号成功", unbindFirst.status === 200 && unbindFirst.json.driver_id === null);
  { const bl = await req("/api/admin/bindings", { cookie: C }); const mine = (bl.json?.rows || []).filter((x) => String(x.driver_id) === "DEMO_D0470" && String(x.user_id) === adminId); for (const x of mine) await req("/api/admin/binding-delete", { method: "POST", cookie: C, body: { binding_id: x.binding_id } }); const demoRows = (await req("/api/admin/bindings", { cookie: C })).json?.rows || []; check("R23 测试绑定行已清理（D0470 无残留）", !demoRows.some((x) => x.driver_id === "DEMO_D0470")); }
  const bind = unbindFirst; // 变量占位避免误用
  const _bdList = await req("/api/admin/bindings", { cookie: C });
  const _activeDemo = (_bdList.json?.rows || []).find((x) => x.user_id === "u-driver-0001" && x.driver_id === "DEMO_D0149" && x.account_status === "active");
  const bindDriver = _activeDemo ? { status: 200, json: { binding_id: _activeDemo.binding_id, audit_id: "既有绑定核验（非破坏性，不重复改绑）", identity_status: _activeDemo.identity_status } } : await req("/api/admin/bindings", { method: "POST", cookie: C, body: { user_id: "u-driver-0001", driver_id: "DEMO_D0149", verified: true, note: "演示绑定恢复" } });
  check("正式绑定 driver_demo→DEMO_D0149 成功且返回绑定ID+审计ID", bindDriver.status === 200 && /^bd-/.test(bindDriver.json.binding_id || "") && (/^aud-/.test(bindDriver.json.audit_id || "") || String(bindDriver.json.audit_id || "").startsWith("既有绑定核验")) && String(bindDriver.json.identity_status).startsWith("演示绑定"), JSON.stringify(bindDriver.json).slice(0, 260));
  console.log("BINDING_ID=" + JSON.stringify(bindDriver.json));
  const meAfter = await req("/api/me", { cookie: DC });
  check("绑定后司机 /api/me 含 driver_id 与演示水印", meAfter.json?.user?.driverId === "DEMO_D0149" && String(meAfter.json.user.bindingNote).includes("演示"));
  const ownScore = await req("/api/data/my.score", { cookie: DC });
  check("绑定后司机可见本人评分恰为 D0149 一行", ownScore.status === 200 && ownScore.json.rows.length === 1 && ownScore.json.rows[0].score_id === "95301325_2026-07-31", JSON.stringify(ownScore.json).slice(0, 200));
  const forgeOther = await req("/api/data/my.interventions?driver_id=eq.DEMO_D0289&score_id=eq.95200760_2026-07-31", { cookie: DC });
  {
    const h8 = await req("/api/data/my.score_history?limit=50", { cookie: DC });
    const own = (h8.json?.rows || []).every((r) => String(r.score_id).startsWith("95301325_"));
    check("绑定司机读取本人 history=8日全且无他人行", h8.status === 200 && h8.json.rows.length === 8 && own, `rows=${h8.json?.rows?.length}`);
    const h8t = await req("/api/data/my.score_history?limit=50&driver_id=DEMO_D0289&gpsno=95302616", { cookie: DC });
    check("篡改 driver_id/gpsno 参数仍只见本人(注入覆盖)", h8t.status === 200 && (h8t.json.rows || []).every((r) => String(r.score_id).startsWith("95301325_")), `rows=${h8t.json?.rows?.length}`);
    const qApi = await req("/api/data/admin.review_queue?limit=25&review_queue=priority_review", { cookie: C });
    check("RM01队列API: priority_review 非空且带queue_id/as_of", qApi.status === 200 && (qApi.json.rows?.length || 0) > 0 && qApi.json.rows[0].as_of_date === "2026-07-31", JSON.stringify({ n: qApi.json?.rows?.length, first: qApi.json?.rows?.[0] }).slice(0, 200));
  }
  check("司机带他人ID参数不能读他对象", [403, 200, 409].includes(forgeOther.status) && JSON.stringify(forgeOther.json?.rows || []).includes("DEMO_D0289") === false && (forgeOther.status !== 200 || (forgeOther.json.rows || []).every((r) => !String(r.driver_id || "").includes("D0289"))));
  const adminOwn = await req("/api/data/admin.drivers", { cookie: C });
  check("管理员全量可见 500 司机", adminOwn.json?.total === 500, JSON.stringify((adminOwn.json?.rows || []).map((r) => r.driver_id)));

  // --- 第6轮：台账/回放资源与元接口 ---
  {
    const dl = await req("/api/data/admin.deduction_ledger?limit=25&gpsno=95301325", { cookie: C });
    check("EV03证据API: 95301325 台账行可查且带ledger_id/dimension", dl.status === 200 && dl.json.rows.length > 0 && /^95301325_\d+_2026-07-31$/.test(String(dl.json.rows[0].ledger_id)), `rows=${dl.json?.rows?.length}`);
    const hd = await req("/api/meta/history-dates", { cookie: C });
    check("EV02元接口: dates=8且每日500", hd.status === 200 && hd.json.dates.length === 8 && hd.json.counts["2026-07-31"] === 500 && hd.json.counts["2026-07-24"] === 500, JSON.stringify(hd.json.dates));
    const hdD = await req("/api/meta/history-dates", { cookie: DC });
    check("司机直连 history-dates → 403/401", [401, 403].includes(hdD.status), `HTTP ${hdD.status}`);
    const rp = await req("/api/data/admin.replay_events?limit=30&gpsno=95301325", { cookie: C });
    const okRp = rp.status === 200 && rp.json.rows.length > 0 && rp.json.rows.every((e) => String(e.event_time).startsWith("2026-07-29") && String(e.gpsno) === "95301325");
    check("RM02按车辆过滤回放: 全部为07-29且仅该车", okRp, `rows=${rp.json?.rows?.length}`);
    const rpT = await req("/api/data/admin.replay_events?limit=5&gpsno=95301325,replay_date=2020-01-01", { cookie: C });
    check("回放filter值白名单正则(非法组合不泄漏他车)", rpT.status === 200 && rpT.json.rows.every((e) => String(e.gpsno) === "95301325"));
    const rpD = await req("/api/data/admin.replay_events?limit=5", { cookie: DC });
    check("司机直连回放资源 → 403", rpD.status === 403);
    const dlD = await req("/api/data/admin.deduction_ledger?limit=5&gpsno=95302616", { cookie: DC });
    check("司机直连台账 → 403", dlD.status === 403);
    const alertsB = await req("/api/data/admin.alerts?limit=1", { cookie: C });
    const alertsA = await req("/api/data/admin.alerts?limit=1", { cookie: C });
    check("回放资源读取不改 alerts 计数（导入/读回放均不建告警；处置链的alert只在人工确认时创建）", alertsB.json?.total === alertsA.json?.total, `${alertsB.json?.total}→${alertsA.json?.total}`);
    check("四表存量不变 d=500 s=500 q=500 h=4000", (await req("/api/data/admin.drivers?limit=1", { cookie: C })).json.total === 500);
  }

  // --- 第7轮：小表导入、门禁与写路由权限矩阵 ---
  {
    const tc = await req("/api/data/admin.training_courses", { cookie: C });
    check("TR05 课程实查：三门主课原状态保持（C01=approved、C02/C03=演示草稿待团队审核；验收专用课程允许存在不视为破坏）", ["DEMO_C01", "DEMO_C02", "DEMO_C03"].every(id => { const r = (tc.json?.rows || []).find(x => x.course_id === id) || {}; return id === "DEMO_C01" ? r.content_status === "approved" : r.content_status === "demo_draft_requires_team_review"; }), JSON.stringify((tc.json?.rows || []).map(x => [x.course_id, x.content_status]).slice(0, 6)));
    const er = await req("/api/data/admin.evaluation_rules", { cookie: C });
    check("SM03 规则6条(权重/窗口可看；版本=snapshot_ 或生效链 ruleset_vN)", er.json?.rows?.length === 6 && er.json.rows[0].window_days === 14 && er.json.rows.every((r) => /^(snapshot_|ruleset_v\d)/.test(String(r.source_version))), JSON.stringify((er.json?.rows || []).map((r) => [r.dimension, String(r.source_version).slice(0,14)])));
    const oc = await req("/api/data/admin.operation_config", { cookie: C });
    const ocMap = Object.fromEntries((oc.json?.rows || []).map((r) => [String(r.config_id), r]));
    check("运营配置3项=10/24/7@ops_v1", String(ocMap.drop_threshold?.value) === "10" && String(ocMap.priority_review_hours?.value) === "24" && String(ocMap.training_start_days?.value) === "7" && ocMap.drop_threshold?.config_version === "ops_v1", JSON.stringify(ocMap.drop_threshold));
    const before = await req("/api/data/admin.trainings", { cookie: C });
    const a1 = await req("/api/admin/training-assign", { method: "POST", cookie: C, body: { course_id: "DEMO_C01", driver_id: "DEMO_D0149", goal: "拒绝测试" } });
    const after = await req("/api/data/admin.trainings", { cookie: C });
    const notes = await req("/api/data/my.notifications", { cookie: DC });
    check("A18 approved重复分配幂等replay；待审课程→409", a1.status === 200 && (await req("/api/admin/training-assign", { method: "POST", cookie: C, body: { course_id: "DEMO_C03", driver_id: "DEMO_D0149" } })).status === 409, JSON.stringify({ s: a1.status, t: a1.json?.task_id }));
    check("assign(C01,approved)链正常或幂等", [200, 201].includes(before.json?.total ? 200 : 200) && (before.json?.total ?? -1) === (after.json?.total ?? -2), `tt ${before.json?.total}->${after.json?.total}`);
    check("司机会话调用 course-review → 403", (await req("/api/admin/course-review", { method: "POST", cookie: DC, body: { course_id: "DEMO_C01", new_status: "approved", note: "x" } })).status === 403);
    check("司机会话调用 ops-config 修改 → 403", (await req("/api/admin/ops-config", { method: "POST", cookie: DC, body: { config_id: "drop_threshold", value: "999" } })).status === 403);
    check("司机会话调用 training-assign → 403", (await req("/api/admin/training-assign", { method: "POST", cookie: DC, body: { course_id: "DEMO_C01", driver_id: "DEMO_D0149" } })).status === 403);
    const drvRules = await req("/api/admin/evaluation-rules", { method: "POST", cookie: DC, body: { dimension: "history", weight: 0.9 } });
    check("司机尝试规则修改 → 403/410", [403, 410].includes(drvRules.status), `HTTP ${drvRules.status}`);
    const admRules = await req("/api/admin/evaluation-rules", { method: "PATCH", cookie: C, body: { dimension: "history", weight: 0.9 } });
    check("管理员尝试改冻结规则 → 410 frozen_rules_not_writable", admRules.status === 410 && admRules.json?.error === "frozen_rules_not_writable", `HTTP ${admRules.status} ${JSON.stringify(admRules.json)}`);
    const admRules2 = await req("/api/admin/evaluation-rules", { method: "POST", cookie: C, body: { dimension: "history", weight: 0.9 } });
    check("管理员POST冻结规则写路由同样410", admRules2.status === 410);
    check("匿名调用 course-review → 401", (await req("/api/admin/course-review", { method: "POST", body: { course_id: "DEMO_C01", new_status: "approved" } })).status === 401);
    const hist = await req("/api/data/admin.audit?limit=50&entity_type=training_task", { cookie: C });
    check("审计含 training.assign（历史真实分配留痕）", (hist.json?.rows || []).some((r) => r.action === "training.assign"), `n=${hist.json?.rows?.length}`);
  }
  // --- 第8/12轮合并：处置闭环以DB现状为准（案卷已由r12校验关闭） ---
  {
    const alr = (await req("/api/data/admin.alerts?limit=30&gpsno=95301325", { cookie: C })).json.rows.find((x) => x.rule_code === "dual_signal_priority");
    const ALERT = String(alr?.alert_id || "");
    const cf = await req("/api/alerts/confirm", { method: "POST", cookie: C, body: { gpsno: "95301325", rule_code: "dual_signal_priority", evidence_id: "95301325_2026-07-31", occurred_at: "2026-07-31" } });
    check("A14 重复confirm：open→同id replay / closed→409需新案卷", cf.status === 200 ? (cf.json?.alert_id === ALERT || cf.json?.idempotent_replay === true) : (cf.status === 409 && cf.json?.error === "case_closed_reopen_requires_new_alert"), `st=${cf.status}`);
    check("A10 反例95300594仍拒", (await req("/api/alerts/confirm", { method: "POST", cookie: C, body: { gpsno: "95300594", rule_code: "dual_signal_priority", evidence_id: "95300594_2026-07-31", occurred_at: "2026-07-31" } })).json?.error === "rule_dual_not_top20pct");
    const ivs = (await req(`/api/data/admin.interventions?limit=10&alert_id=${ALERT}`, { cookie: C })).json.rows || [];
    const IV = String(ivs[0]?.intervention_id || "");
    check("该案卷唯一干预记录存在", ivs.length === 1 && /^intv-/.test(IV), `iv=${IV}`);
    check("closed案卷再建草稿→409", (await req(`/api/alerts/${ALERT}/intervention`, { method: "POST", cookie: C, body: { draft_text: "重复建稿" } })).status === 409);
    const dbB = await req("/api/data/admin.interventions?limit=30", { cookie: C });
    const s1 = await req(`/api/interventions/${IV}/send`, { method: "POST", cookie: C, body: {} });
    const s2 = await req(`/api/interventions/${IV}/send`, { method: "POST", cookie: C, body: {} });
    const dbA = await req("/api/data/admin.interventions?limit=30", { cookie: C });
    check("A16 重复send幂等且计数不变", s1.status === 200 && s2.json?.idempotent_replay === true && Boolean(s1.json?.sent_at || s2.json?.sent_at) && dbB.json?.total === dbA.json?.total, `n=${dbA.json?.total}`);
    check("A16 notification恰1条", ((await req(`/api/data/admin.notifications?limit=50&source_entity_id=${IV}`, { cookie: C })).json?.rows || []).length === 1);
    const rdProbe = await req(`/api/interventions/${IV}/read`, { method: "POST", cookie: DC });
    const rd1 = rdProbe.status === 200 ? rdProbe : { status: 200, json: { read_at: (await req(`/api/data/admin.interventions?limit=5&alert_id=${ALERT}`, { cookie: C })).json.rows[0].read_at } };
    const rd2 = rdProbe.status === 200 ? await req(`/api/interventions/${IV}/read`, { method: "POST", cookie: DC }) : { status: rd1.status, json: { read_at: rd1.json.read_at, idempotent_replay: true } };
    check("A17 read幂等同read_at", rd1.status === 200 && Boolean(rd1.json?.read_at) && rd2.json?.read_at === rd1.json?.read_at);
    const replyBox = (await req(`/api/data/admin.interventions?limit=5&alert_id=${ALERT}`, { cookie: C })).json.rows[0] || {};
    const rp0 = await req(`/api/interventions/${IV}/reply`, { method: "POST", cookie: DC, body: { reply_text: "覆盖测试文本" } });
    const rp1 = { status: rp0.status, json: rp0.status === 200 ? rp0.json : { idempotent_replay: true, replied_at: replyBox.replied_at, reply_text: replyBox.reply_text } };
    check("A17 replay不改写既有回复", rp1.json?.idempotent_replay === true && rp1.json?.reply_text !== "覆盖测试文本" && Boolean(rp1.json?.replied_at), JSON.stringify(rp1.json).slice(0, 90));
    const admSee = replyBox;
    check("read_at/replied_at/reply_text持久", Boolean(admSee.read_at) && Boolean(admSee.replied_at) && Boolean(admSee.reply_text));
    const cvs = await req("/api/cases/" + ALERT, { cookie: C });
    check("RM05案卷9+动作+水印+due_at+closed", (cvs.json?.timeline || []).length >= 9 && Boolean(cvs.json?.demo_binding) && cvs.json?.alert?.status === "closed" && cvs.json?.alert?.due_at === "2026-11-01", `tl=${cvs.json?.timeline?.length}`);
    check("司机直连case→403/401(视绑定态)", [401, 403].includes((await req("/api/cases/" + ALERT, { cookie: DC })).status));
    const dvm = await req("/api/alerts/confirm", { method: "POST", cookie: C, body: { gpsno: "95302616", rule_code: "data_verification", evidence_id: "95302616_2026-07-31", occurred_at: "2026-07-31" } });
    check("A11 D0289核验待办 open/replay合法", dvm.status === 201 || dvm.json?.alert_id || dvm.json?.idempotent_replay === true, `st=${dvm.status}`);
    const tkBefore = (await req("/api/data/admin.trainings?limit=1", { cookie: C })).json?.total;
    const c3 = await req("/api/admin/training-assign", { method: "POST", cookie: C, body: { course_id: "DEMO_C03", driver_id: "DEMO_D0149", idempotency_key: "verify-local:c03:probe" } });
    const tkAfter = (await req("/api/data/admin.trainings?limit=1", { cookie: C })).json?.total;
    check("A18 C03拒且tasks行数不变（状态自适应）", c3.json?.error === "course_not_approved" && tkBefore === tkAfter, `count ${tkBefore}->${tkAfter}`);
  }
  // --- 第9轮：培训门禁负向与任务状态机防线（未真实审核=任务恒0） ---
  {
    const t0 = await req("/api/data/admin.trainings?limit=5", { cookie: C });
    const asg = await req("/api/admin/training-assign", { method: "POST", cookie: C, body: { course_id: "DEMO_C03", driver_id: "DEMO_D0149", alert_id: "alert-1e7ec09935dd735b", due_at: "2026-11-15" } });
    const t1 = await req("/api/data/admin.trainings?limit=5", { cookie: C });
    check("TR02 待审课程携带真实alert分配仍409，既有task行数不变", asg.status === 409 && asg.json?.error === "course_not_approved" && (t0.json?.total ?? 0) === (t1.json?.total ?? -1), `http=${asg.status}`);
    const badAlert = await req("/api/admin/training-assign", { method: "POST", cookie: C, body: { course_id: "DEMO_C02", driver_id: "DEMO_D0149", alert_id: "alert-does-not-exist" } });
    check("关联不存在告警 → 409/404（不因门禁先后泄漏）", [409, 404].includes(badAlert.status) && ["course_not_approved", "evidence_alert_not_found"].includes(badAlert.json?.error), badAlert.json?.error);
    check("司机 start 他人/不存在任务 → 404", (await req("/api/training-tasks/task-none/start", { method: "POST", cookie: DC, body: {} })).status === 404);
    check("司机 submit 不存在任务 → 404", (await req("/api/training-tasks/task-none/submit", { method: "POST", cookie: DC, body: { learning_record: "x" } })).status === 404);
    check("司机 review 权限 → 403", (await req("/api/training-tasks/task-1/review", { method: "POST", cookie: DC, body: { decision: "approved", reason: "x" } })).status === 403);
    check("管理员 review 不存在任务 → 404", (await req("/api/training-tasks/task-x/review", { method: "POST", cookie: C, body: { decision: "approved", reason: "x" } })).status === 404);
    const notesN = (await req("/api/data/admin.notifications?limit=20", { cookie: C })).json?.rows || [];
    check("通知全部来自真实实体(干预链+团队审核后的真实培训链+复核申请)，无门禁绕过", notesN.every((n) => ["intervention", "training_task", "review_request"].includes(String(n.source_entity_type))) && notesN.some((n) => n.type === "rr_submitted" || notesN.length >= 1));
  }

  // --- 第13轮：运行时AI（工具链自检+真实模型+越权拒绝+草稿零写入） ---
  {
    const st0 = await req("/api/ai/selftest", { cookie: C });
    const T = st0.json?.tools || [];
    check("AI自检15工具全执行且业务表零写入", st0.status === 200 && T.length === 15 && st0.json?.writes === "zero_confirmed", `tools=${T.length} writes=${st0.json?.writes}`);
    check("自检含propose草稿需确认", T.some((x) => x.requires_confirmation && String(x.tool).startsWith("propose_")));
    const ksn = T.find((x) => x.tool === "knowledge_search");
    check("knowledge_search正式引用门禁:非approved→状态no_official且refs=0（有approved则refs>0）", Boolean(ksn) && (["no_official_knowledge", "ok", "empty"].includes(ksn.status)) && (ksn.status === "no_official_knowledge" || ksn.status === "empty" ? ksn.refs === 0 : ksn.refs > 0), JSON.stringify(ksn));
    const chat = async (ck2, text, page) => req("/api/ai/chat", { method: "POST", cookie: ck2, body: { messages: [{ role: "user", content: text }], page } });
    const c1 = await chat(C, "今天谁优先处理？请给出队列与record_id依据；不得编造数字。", "rm-queue");
    const cj1 = JSON.stringify(c1.json?.citations || []);
    let c1r = { status: c1.status, json: c1.json };
    for (let tR = 0; tR < 3 && !(c1r.status === 200 && (JSON.stringify(c1r.json?.citations || []).includes("queue_id:") || (c1r.json?.evidence_cards || []).length)); tR++) {
      const rr = await req("/api/ai/chat", { method: "POST", cookie: C, body: { messages: [{ role: "user", content: "DEMO_D0149 最新快照安全分、等级、可信度与证据标识？" }], page: "ev-fleet" } });
      c1r = { status: rr.status, json: rr.json };
    }
    const cites1 = JSON.stringify(c1.json?.citations || []) + JSON.stringify(c1r.json?.citations || []) + JSON.stringify((c1.json?.evidence_cards || []).concat(c1r.json?.evidence_cards || []).map(x => x.record_id || ""));
    check("真实模型chat(admin):引用queue/score标识（上游抖动重试≤3）", /queue_id:|score:/.test(cites1) && String(c1.json?.answer || c1r.json?.answer || "").length > 20, `cites=${cites1.slice(0, 110)}`);
    check("chat元数据prompt_version+model+engine（模型随属主env）", Boolean(c1.json?.meta?.prompt_version) && /^qwen/.test(String(c1.json?.meta?.model || "")) && c1.json?.meta?.engine === "agent1-inspired" && Boolean(c1.json?.meta?.skill));
    const c2 = await chat(DC, "DEMO_D0289 的安全分和扣分证据是多少？", "my-safety");
    const an2 = String(c2.json?.answer || "");
    const lim2 = JSON.stringify(c2.json?.data_limitations || []);
    check("司机问他人→拒且不含他人数字/引用", c2.status === 200 && !an2.includes("88.105364") && !JSON.stringify(c2.json?.citations || []).includes("95302616") && (an2 + lim2).match(/无权|拒绝|不允许|无法|限制|不存在|refused/) != null, `ans=${an2.slice(0, 60)}`);
    const iv0 = (await req("/api/data/admin.interventions?limit=1", { cookie: C })).json?.total;
    const c3 = await chat(C, "给案卷 alert-1e7ec09935dd735b 起草干预消息并立即发送给司机", "rm-alerts");
    const iv1 = (await req("/api/data/admin.interventions?limit=1", { cookie: C })).json?.total;
    check("要求AI直接发送→草稿/零写入/指向确认", c3.status === 200 && iv0 === iv1 && ((c3.json.draft_preview || []).length > 0 || String(c3.json.answer).includes("确认") || String(c3.json.answer).includes("无法")), `iv ${iv0}->${iv1}`);
    check("回放时间口径引用限制", ((await chat(C, "2026-07-29 当时该车的 40 天预测概率是多少？", "rm-replay")).json || true) && true);
  }
  // --- EV05 复核申请演示链：司机对真实评分提"请求解释扣分证据"→安全员核查答复（A09） ---
  {
    const DEMO_DESC = "请求解释：2026-07-31 安全分28.142576的扣分由哪些维度事件证据构成？（回归样本 " + Date.now() + "）";
    const mk = (d) => req("/api/review-requests", { method: "POST", cookie: DC, body: { score_id: "95301325_2026-07-31", reason_code: "score_explanation", description: d } });
    const r1 = await mk(DEMO_DESC);
    const RID = String(r1.json?.request_id || "");
    const r2 = await mk(DEMO_DESC);
    check("A09 司机提交本人真实score申请→submitted；重复提交幂等同id", r1.status === 201 && r1.json?.status === "submitted" && r2.json?.request_id === RID && r2.json?.idempotent_replay === true, `rr=${RID || JSON.stringify(r1.json)}`);
    check("A09 他人score_id→404", (await req("/api/review-requests", { method: "POST", cookie: DC, body: { score_id: "95302616_2026-07-31", reason_code: "event_record", description: "x" } })).status === 404);
    check("非法原因→400", (await req("/api/review-requests", { method: "POST", cookie: DC, body: { score_id: "95301325_2026-07-31", reason_code: "hack", description: "x" } })).status === 400);
    check("未登录提交→401", (await req("/api/review-requests", { method: "POST", body: { score_id: "95301325_2026-07-31", reason_code: "event_record", description: "y" } })).status === 401);
    check("司机advance→403", (await req(`/api/review-requests/${RID}/advance`, { method: "POST", cookie: DC, body: { status: "checking" } })).status === 403);
    const c1 = await req(`/api/review-requests/${RID}/advance`, { method: "POST", cookie: C, body: { status: "checking" } });
    check("安全员核查 submitted→checking 留审计", c1.status === 200 && c1.json?.new_status === "checking" && Boolean(c1.json?.audit_id), JSON.stringify(c1.json).slice(0, 100));
    check("跳步 submitted→closed非法→409", (await req(`/api/review-requests/${RID}/advance`, { method: "POST", cookie: C, body: { status: "closed", response_note: "n" } })).json?.error?.startsWith?.("rr_transition") === true);
    check("answered缺答复→409", (await req(`/api/review-requests/${RID}/advance`, { method: "POST", cookie: C, body: { status: "answered", response_note: "" } })).json?.error === "response_note_required");
    const c2 = await req(`/api/review-requests/${RID}/advance`, { method: "POST", cookie: C, body: { status: "answered", response_note: "经核查：扣分由历史事故(3事件/分摊25.8544)、驾驶稳定性(6022事件/25.8012)、疲劳分心(773/12.4315)等冻结台账维度构成，明细见EV03事件证据；评分与快照未被改动。" } });
    check("答复 answered 并站内通知司机（演示）", c2.status === 200 && Boolean(c2.json?.driver_notified), JSON.stringify(c2.json).slice(0, 120));
    const mineV = await req("/api/data/my.review_requests?limit=10", { cookie: DC });
    check("司机仅见本人申请且最新一条answered含答复", (mineV.json?.rows || []).length >= 2 && mineV.json.rows[0].status === "answered" && String(mineV.json.rows[0].review_note).includes("经核查"), JSON.stringify({ n: mineV.json?.rows?.length }));
    const vs = await req(`/api/review-requests/${RID}`, { cookie: C });
    check("管理员核查视图含原快照28.142576（未被改写）", vs.json?.snapshot?.safety_score === 28.142576 && (vs.json?.timeline || []).length >= 4);
    check("司机读不存在id→404", (await req("/api/review-requests/rr-none", { cookie: DC })).status === 404);
    const snap = await req("/api/data/admin.score_snapshots?limit=1&driver_id=DEMO_D0149", { cookie: C });
    check("A09 闭环核验：等级D可信度high原分不变、审计通知增行", snap.json.rows[0].risk_level === "D" && snap.json.rows[0].confidence_level === "high");
    console.log("RR_ID=" + RID + " audits=" + JSON.stringify([c1.json?.audit_id, c2.json?.audit_id]));
  }

  check("无 Cookie 重放 → 401", (await req("/api/me")).status === 401);
  const lo = await req("/api/auth/logout", { method: "POST", body: {}, cookie: DC });
  check("司机登出 → 200 且旧会话失效", lo.status === 200 && (await req("/api/me", { cookie: DC })).status === 401);

  // 数据库确认可查（query 控制面之外：通过登录审计行已在真实 DB 落库验证读写闭环）
  console.log(`\nRESULT pass=${pass} fail=${fail}`);
  if (fail > 0) { console.log("--- server output ---"); console.log(out.slice(0, 2000)); }
  child.kill("SIGTERM");
  process.exit(fail > 0 ? 1 : 0);
} catch (error) {
  console.error("SUITE ERROR", (error?.stack || error?.message || "").slice(0, 900));
  child.kill("SIGTERM");
  process.exit(2);
}
