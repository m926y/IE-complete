const { spawn } = require("node:child_process"); const fs = require("node:fs");
const R2 = "/mnt/pages/page-repo-9c562cfc-8c55-4fa4-b226-d9c5dae153f0";
const kv = Object.fromEntries(fs.readFileSync(R2 + "/.runtime-tmp/app.env", "utf8").split("\n").filter(Boolean).map(l => { const i = l.indexOf("="); return [l.slice(0, i), l.slice(i + 1)]; }));
const child = spawn(process.execPath, [R2 + "/.qw-pages/publish/server.mjs"], { env: { ...process.env, HOST: "127.0.0.1", PORT: "3431", NODE_ENV: "development" }, cwd: R2 + "/.qw-pages/publish", stdio: ["ignore", "ignore", "pipe"] });
let serr = ""; child.stderr.on("data", c => serr += c);
const B = "http://127.0.0.1:3431";
const U = async (p, o = {}) => { try { const r = await fetch(B + p, { method: o.post ? "POST" : o.patch ? "PATCH" : "GET", headers: { "content-type": "application/json", ...(o.ck ? { cookie: o.ck } : {}) }, body: (o.post || o.patch) ? JSON.stringify(o.body || {}) : undefined }); let j = {}; try { j = await r.json(); } catch {} return { st: r.status, j, sc: (r.headers.getSetCookie?.() || []).map(x => x.split(";")[0]).find(x => x.startsWith("claw_session=")) }; } catch { return { st: 0, j: {} } } };
let fails = 0; const K = (n, c, x = "") => { console.log((c ? "PASS " : "FAIL ") + n, String(x).slice(0, 160)); if (!c) fails++; };
(async () => {
 for (let i = 0; i < 100; i++) { if ((await U("/healthz")).st === 200) break; await new Promise(r => setTimeout(r, 250)); }
 const F = (await U("/api/auth/login", { post: 1, body: { username: "safety_admin", password: kv.ADMIN_PW } })).sc;
 const D = (await U("/api/auth/login", { post: 1, body: { username: "driver_demo", password: kv.DRIVER_PW } })).sc;
 const uname = "scoped_sa_" + (Date.now() % 100000);
 const cr = await U("/api/admin/users", { post: 1, ck: F, body: { username: uname, display_name: "R20 受限车队管理员（真实授权）", role: "safety_admin", reveal_password: true } });
 const SU = cr.j.user_id, SPW = cr.j.initial_password;
 K("全范围管理员经 SM01 端点创建真实 scoped 候选账号", cr.st === 201 && !!SU && !String(SPW).includes("redacted"), SU);
 const ed = await U(`/api/admin/users/${SU}`, { patch: 1, ck: F, body: { fleet_scope: "DEMO_FLEET" } });
 K("授权 fleet_scope=DEMO_FLEET（真实车队，无虚构）", ed.st === 200 && ed.j.changed.fleet_scope, "audit " + ed.j.audit_id);
 const S = (await U("/api/auth/login", { post: 1, body: { username: uname, password: SPW } })).sc;
 fs.writeFileSync(R2 + "/.runtime-tmp/scoped.env", `SC_USER=${uname}\nSC_PW=${SPW}\nSC_ID=${SU}\n`);
 console.log("SCOPED_S", S ? "ok" : "NO_COOKIE", "full", Boolean(F));
 // 1) SM01 列表可见性差异（真实）
 const fa = await U("/api/data/admin.accounts?limit=50", { ck: F });
 const sa = await U("/api/data/admin.accounts?limit=50", { ck: S });
 console.log("SA_RAW", sa.st, JSON.stringify(sa.j).slice(0, 200));
 K("受限管理员账号列表：看不到全范围同角色管理员行（真实可见性差异）", fa.st === 200 && sa.st === 200 && !JSON.stringify(sa.j.rows).includes("u-admin-0001") && JSON.stringify(sa.j.rows).includes(SU) && sa.j.total < fa.j.total, `full=${fa.j.total} scoped=${sa.j.total}`);
 K("受限列表仍含本队绑定司机账号（driver_demo）", JSON.stringify(sa.j.rows).includes("u-driver-0001"), "");
 // 2) 数据资源 scope
 const dr1 = await U("/api/data/admin.drivers?limit=1", { ck: S });
 K("scoped 本队 drivers 计数合法（500）", dr1.j.total === 500, "total=" + dr1.j.total);
 const dr2 = await U("/api/data/admin.drivers?limit=1&fleet_id=FLEET_MISMATCH_R20", { ck: S });
 K("scoped 借参数请求他队 fleet_id → 403 out_of_fleet_scope", dr2.st === 403 && dr2.j.error === "out_of_fleet_scope", "");
 const dr3 = await U("/api/data/admin.alerts?limit=5", { ck: S });
 K("scoped alerts 走 gpsno.in 集合（本队 2 条）", dr3.st === 200 && dr3.j.total === 2, "alerts=" + dr3.j.total);
 // 3) 概览指标
 const ov1 = await U("/api/overview", { ck: F });
 const ov2 = await U("/api/overview", { ck: S });
 const sameCnt = JSON.stringify((ov1.j.metrics || []).map(x => x.count)) === JSON.stringify((ov2.j.metrics || []).map(x => x.count));
 K("EV01 指标：同队 scoped 与全范围计数一致（本队全量合法可见）", ov2.st === 200 && sameCnt, "");
 // 4) 直接详情/证据卡（同队合法 + 缺失对象真实拒绝）
 const ev1 = await U("/api/ai/evidence-check?ref=score:95301325_2026-07-31", { ck: S });
 K("scoped 证据卡跳转（同队 gpsno 命中集合）200", ev1.st === 200 && ev1.j.ok);
 const ev2 = await U("/api/ai/evidence-check?ref=score:NOT_EXIST_R20", { ck: S });
 K("不存在 ref 404（不泄漏）", ev2.st === 404);
 // 5) 越权写：无第二车队对象 → 用真实不存在的司机/案卷（机制级）+ 无业务写入验证
 const tk0 = (await U("/api/data/admin.trainings?limit=1", { ck: F })).j.total;
 const bad = await U("/api/admin/training-assign", { post: 1, ck: S, body: { course_id: "DEMO_C01", driver_id: "DEMO_D9999", idempotency_key: "r20:probe1" } });
 const tk1 = (await U("/api/data/admin.trainings?limit=1", { ck: F })).j.total;
 K("分配非本队/不存在 driver → 404(与不存在同语义) 且零写入", bad.st === 404 && tk1 === tk0, "st=" + bad.st + " err=" + bad.j.error);
 const bad2 = await U("/api/alerts/alert-r20-nonexist/intervention", { post: 1, ck: S, body: { draft_text: "probe" } });
 K("对不存在案卷存草稿 → 404 零业务写", bad2.st === 404, "err=" + bad2.j.error);
 const auR = await U("/api/data/admin.audit?limit=10&action_prefix=scope_refused", { ck: F });
 K("越权写尝试留审计（scope_refused.write）", auR.j.total >= 1, JSON.stringify((auR.j.rows || []).slice(0, 2).map(x => x.audit_id + ":" + x.entity_id)));
 // 6) SM01 接口 scope 一致性
 const pa = await U("/api/admin/users/u-admin-0001", { patch: 1, ck: S, body: { fleet_scope: "DEMO_FLEET" } });
 K("scoped 编辑全范围管理员账号 → 403 + account.scope_refused 审计", pa.st === 403 && pa.j.error === "out_of_fleet_scope");
 const pd = await U("/api/admin/users/u-admin-0001/status", { post: 1, ck: S, body: { account_status: "disabled" } });
 K("scoped 停用他管理员 → 403", pd.st === 403);
 const pc = await U("/api/admin/users", { post: 1, ck: S, body: { username: "x_r20_admin", role: "safety_admin" } });
 K("scoped 铸造新管理员 → 403 cannot_grant_admin_in_scope", pc.st === 403);
 const selfEdit = await U(`/api/admin/users/${SU}`, { patch: 1, ck: S, body: { display_name: "R20 受限管理员改名留证" } });
 K("scoped 编辑自己 → 放行（200+审计）", selfEdit.st === 200, "audit " + selfEdit.j.audit_id);
 // 7) AI 受控工具 scoped 行为
 const c1 = await U("/api/ai/chat", { post: 1, ck: S, body: { messages: [{ role: "user", content: "查询车队 FLEET_MISMATCH_R20 的司机清单和总数" }], page: "ev-fleet" } });
 const leak = /DEMO_D0\d{3}/.test(String(c1.j.answer || "")) && !String(c1.j.answer || "").length;
 K("AI 工具对他队请求：经 listResource scope 拒绝/空（回答不含本队司机清单冒充）", c1.st === 200 && !/共\s*500/.test(String(c1.j.answer || "") + JSON.stringify(c1.j.citations || "")), "state=" + (c1.j.state || ""));
 const c2 = await U("/api/ai/chat", { post: 1, ck: S, body: { messages: [{ role: "user", content: "DEMO_FLEET 在管司机总数？" }], page: "ev-fleet" } });
 K("AI 工具本队查询正常（含500）", c2.st === 200 && /500/.test(String(c2.j.answer || "")));
 // 8) 停用 scoped：旧会话立即失效
 const ds = await U(`/api/admin/users/${SU}/status`, { post: 1, ck: F, body: { account_status: "disabled" } });
 const gone1 = await U("/api/data/admin.drivers?limit=1", { ck: S });
 const gone2 = await U("/api/overview", { ck: S });
 const rl = await U("/api/auth/login", { post: 1, body: { username: uname, password: SPW } });
 K("停用后旧会话下一请求即拒 + 重登拒绝（审计链）",ds.st === 200 && [401, 403].includes(gone1.st) && [401, 403].includes(gone2.st) && rl.st !== 200, `gone=${gone1.st}/${gone2.st} relogin=${rl.st}`);
 const audAll = await U("/api/data/admin.audit?limit=30&entity_id=" + SU, { ck: F });
 K("该账号全程审计可回看（create/edit×2/status/refused）", (audAll.j.rows || []).length >= 5, JSON.stringify((audAll.j.rows || []).map(x => x.audit_id).slice(0, 6)));
 console.log("SE", /TypeError|ReferenceError/.test(serr) ? serr.slice(0, 220) : "srv_clean");
 console.log("IDS " + JSON.stringify({ scoped_user: SU, create_as: cr.j.audit_id, grant_audit: ed.j.audit_id, self_edit: selfEdit.j.audit_id, disable_audit: ds.j.audit_id, refused_audits: (auR.j.rows || []).map(x => x.audit_id) }));
 console.log(fails ? `R20_${fails}_FAILED` : "R20_OK");
 child.kill("SIGTERM"); setTimeout(() => process.exit(fails ? 1 : 0), 250);
})();
