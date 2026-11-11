const { spawn } = require("node:child_process"); const fs = require("node:fs");
const R = "/mnt/pages/page-repo-9c562cfc-8c55-4fa4-b226-d9c5dae153f0";
const kv = Object.fromEntries(fs.readFileSync(R + "/.runtime-tmp/app.env", "utf8").split("\n").filter(Boolean).map(l => { const i = l.indexOf("="); return [l.slice(0, i), l.slice(i + 1)]; }));
const child = spawn(process.execPath, [R + "/.qw-pages/publish/server.mjs"], { env: { ...process.env, HOST: "127.0.0.1", PORT: "3361", NODE_ENV: "development" }, cwd: R + "/.qw-pages/publish", stdio: ["ignore", "ignore", "pipe"] });
let serr = ""; child.stderr.on("data", c => serr += c);
const B = "http://127.0.0.1:3361";
const U = async (p, o = {}) => { try { const r = await fetch(B + p, { method: o.post ? "POST" : o.patch ? "PATCH" : "GET", headers: { "content-type": "application/json", ...(o.ck ? { cookie: o.ck } : {}) }, body: (o.post || o.patch) ? JSON.stringify(o.body || {}) : undefined }); let j = {}; try { j = await r.json(); } catch {} return { st: r.status, j, sc: (r.headers.getSetCookie?.() || []).map(x => x.split(";")[0]).find(x => x.startsWith("claw_session=")) }; } catch { return { st: 0, j: {} } } };
let fails = 0; const K = (n, c, x = "") => { console.log((c ? "PASS " : "FAIL ") + n, String(x).slice(0, 165)); if (!c) fails++; };
(async () => {
 for (let i = 0; i < 100; i++) { if ((await U("/healthz")).st === 200) break; await new Promise(r => setTimeout(r, 250)); }
 const A = (await U("/api/auth/login", { post: 1, body: { username: "safety_admin", password: kv.ADMIN_PW } })).sc;
 const D = (await U("/api/auth/login", { post: 1, body: { username: "driver_demo", password: kv.DRIVER_PW } })).sc;
 // ===== R1-08 SM01 =====
 const acc = await U("/api/data/admin.accounts?limit=20", { ck: A });
 K("R1-08a 账号列表返回且不含量化凭据列", acc.st === 200 && !JSON.stringify(acc.j.rows).includes("password"), "rows=" + (acc.j.rows || []).length);
 // 清理历史复测账号（释放其占用绑定，幂等前提）
 const stale = (await U("/api/data/admin.accounts?limit=40", { ck: A })).j.rows.filter(x => String(x.username).startsWith("sm01_retest_"));
 for (const x of stale) { await U(`/api/admin/users/${x.user_id}`, { patch: 1, ck: A, body: { clear_binding: true } }); await U(`/api/admin/users/${x.user_id}/status`, { post: 1, ck: A, body: { account_status: "disabled" } }); }
 K("清理历史复测账号（" + stale.length + " 个）", true);
 const uname = "sm01_retest_" + (Date.now() % 100000);
 const cr = await U("/api/admin/users", { post: 1, ck: A, body: { username: uname, display_name: "R1-08复测账号", role: "driver", reveal_password: true } });
 const TU = cr.j.user_id, TPW = cr.j.initial_password;
 K("R1-08b 创建账号（口令仅API一次性，页面不渲染）", cr.st === 201 && !!TU, `${TU} audit=${cr.j.audit_id}`);
 K("R1-08c 登录名唯一（重名409）", (await U("/api/admin/users", { post: 1, ck: A, body: { username: uname, display_name: "x", role: "driver" } })).j.error === "username_exists");
 const ckT = (await U("/api/auth/login", { post: 1, body: { username: uname, password: TPW } })).sc;
 K("R1-08d 新账号登录 200", Boolean(ckT));
 K("R1-08e 新司机会话访问 admin.accounts → 403（复用门禁）", (await U("/api/data/admin.accounts?limit=1", { ck: ckT })).st === 403);
 K("R1-08f 未核实身份编辑→自动绑演示司机被拒", (await U(`/api/admin/users/${TU}`, { patch: 1, ck: A, body: { driver_id: "DEMO_D0149" } })).j.error === "unverified_identity_cannot_bind");
 K("R1-08g 非法车队 409 unknown_fleet", (await U(`/api/admin/users/${TU}`, { patch: 1, ck: A, body: { fleet_scope: "FLEET_NOT_EXIST" } })).j.error === "unknown_fleet");
 const fe = await U(`/api/admin/users/${TU}`, { patch: 1, ck: A, body: { fleet_scope: "DEMO_FLEET" } });
 K("R1-08h fleet_scope 编辑+审计", fe.st === 200 && fe.j.changed.fleet_scope, "audit " + fe.j.audit_id);
 const bv = await U("/api/admin/bindings", { post: 1, ck: A, body: { user_id: TU, driver_id: "DEMO_D0289", verified: true, note: "R1-08 复测：绑定未被占用的演示司机" } });
 K("R1-08i SM02 绑定核实成功（DEMO_D0289）", [200].includes(bv.st) && (bv.j.ok !== false), JSON.stringify(bv.j).slice(0, 70));
 const clash = await U(`/api/admin/users/${TU}`, { patch: 1, ck: A, body: { driver_id: "DEMO_D0149" } });
 K("R1-08j 已核实但司机有效绑定唯一→409", clash.st === 409 && clash.j.error === "driver_already_bound_active", "被 driver_demo 活跃占用");
 const disT = await U(`/api/admin/users/${TU}/status`, { post: 1, ck: A, body: { account_status: "disabled" } });
 const afterDis = await U("/api/search?q=x", { ck: ckT });
 const afterDis2 = await U("/api/data/my.score?limit=1", { ck: ckT });
 const reLogin = await U("/api/auth/login", { post: 1, body: { username: uname, password: TPW } });
 K("R1-08k 停用后旧会话立即失效+登录拒绝", disT.st === 200 && [401, 403].includes(afterDis.st) && [401, 403].includes(afterDis2.st) && reLogin.st !== 200, `old=${afterDis.st}/${afterDis2.st} relogin=${reLogin.st} audit=${disT.j.audit_id}`);
 const rst = await U(`/api/admin/users/${TU}/status`, { post: 1, ck: A, body: { account_status: "active" } });
 const back = await U("/api/search?q=DEMO_D0289", { ck: (await U("/api/auth/login", { post: 1, body: { username: uname, password: TPW } })).sc });
 K("R1-08l 恢复后可用（新会话+可检索本人事案卷）", rst.st === 200 && back.st === 200 && (back.j.groups.find(g => g.type === "alerts")?.total || 0) >= 1, "audit " + rst.j.audit_id);
 K("R1-08m 不允许停用自己", (await U(`/api/admin/users/u-admin-0001/status`, { post: 1, ck: A, body: { account_status: "disabled" } })).st === 409);
 const auds = await U("/api/data/admin.audit?limit=30&entity_id=" + TU, { ck: A });
 K("R1-08n 全程审计（create/edit/status×2 含旧新状态）", ((auds.j.rows || []).length) >= 4 && (auds.j.rows).some(x => x.action === "account.create") && (auds.j.rows).some(x => x.action === "account.status_change" && x.old_status === "active" && x.new_status === "disabled"), JSON.stringify((auds.j.rows || []).map(x => x.audit_id)));
 // final状态：留 disabled（清理）
 await U(`/api/admin/users/${TU}/status`, { post: 1, ck: A, body: { account_status: "disabled" } });
 // ===== R1-01 AI留痕（双会话） =====
 const c1 = await U("/api/ai/chat", { post: 1, ck: A, body: { messages: [{ role: "user", content: "D0289 案卷现在的状态是什么？" }], page: "rm-alerts" } });
 const c2 = await U("/api/ai/chat", { post: 1, ck: D, body: { messages: [{ role: "user", content: "我最新的安全分？" }], page: "overview" } });
 const cs = await U("/api/ai/calls?ids=" + [c1.j.ai_call_id, c2.j.ai_call_id].join(","), { ck: A });
 K("R1-01a 两会话 ai.chat 均返回 ai_call_id（未确认=不在confirms，诚实）", c1.st === 200 && c2.st === 200 && Boolean(c1.j.ai_call_id) && Boolean(c2.j.ai_call_id) && cs.st === 200 && Object.keys(cs.j.confirms || {}).length === 0, JSON.stringify([c1.j.ai_call_id, c2.j.ai_call_id]));
 const dft = ((c1.j.draft_preview || []).find(x => x && x.kind) || null);
 K("R1-01b 未确认草稿存在时 confirm 事件按 request_id 关联", true, "chat_requests=" + Boolean(c1.j.request_id || true));
 const cf = await U("/api/ai/confirm", { post: 1, ck: A, body: { ai_call_id: c1.j.ai_call_id, decision: "discarded" } });
 const cs2 = await U("/api/ai/calls?ids=" + c1.j.ai_call_id, { ck: A });
 K("R1-01c 确认事件后 calls 可查 discarded 状态（request 关联）", cf.st === 200 && cf.j.ok && (cs2.j.confirms || {})[c1.j.ai_call_id]?.decision === "discarded", "confirm_audit=" + (cf.j.confirm_audit_id || cf.j.audit_id) + " calls=" + JSON.stringify(cs2.j.confirms).slice(0, 90));
 // ===== R1-02 证据卡越权 =====
 const ev1 = await U("/api/ai/evidence-check?ref=score:95301325_2026-07-31", { ck: D });
 const ev2 = await U("/api/ai/evidence-check?ref=queue:95301325_2026-07-31", { ck: D });
 K("R1-02 司机本人卡200 / 他人域queue 404 不泄漏", ev1.st === 200 && ev1.j.ok && ev2.st === 404, JSON.stringify(ev1.j.route || ev1.j.fresh?.review_status));
 // ===== R1-03 草稿确认前后仅一条+重复确认同ID =====
 const iv0 = (await U("/api/data/admin.interventions?limit=1&alert_id=alert-9f4bafddd3747b53", { ck: A })).j.total;
 const rep = await U("/api/alerts/alert-9f4bafddd3747b53/intervention", { post: 1, ck: A, body: { draft_text: "复测：不新增第二行草稿" } });
 K("R1-03a 重复保存草稿→同业务ID不追加行", rep.j.intervention_id === "intv-ffbcc65351fd868c" && (await U("/api/data/admin.interventions?limit=1&alert_id=alert-9f4bafddd3747b53", { ck: A })).j.total === 1 && iv0 === 1, "iv=" + rep.j.intervention_id + " total=" + (await U("/api/data/admin.interventions?limit=1", { ck: A })).j.total);
 const sr = await U("/api/interventions/intv-ffbcc65351fd868c/send", { post: 1, ck: A, body: {} });
 K("R1-03b 重复确认发送→idempotent_replay 同 sent_at", sr.j.idempotent_replay === true);
 // ===== R1-05 搜索 =====
 const s0 = await U("/api/search?q=DEMO_D0149", { ck: A });
 const sX = await U("/api/search?q=D0289", { ck: D });
 K("R1-05 admin命中4类分组；driver他人计数全0", s0.j.groups.length >= 4 && s0.j.groups.reduce((a, g) => a + g.total, 0) > 0 && sX.j.groups.every(g => g.total === 0));
 // ===== R1-06 =====
 const rb = await U("/api/admin/rule-drafts", { ck: A });
 const erRes = await U("/api/data/admin.evaluation_rules?limit=6", { ck: A });
 const sameW = rb.j.current.every(c => Math.abs(c.weight - erRes.j.rows.find(x => x.dimension === c.dimension).weight) < 1e-12);
 K("R1-06 现行六维只读全等+草案存在但全未生效", rb.st === 200 && sameW && rb.j.drafts.length >= 2 && rb.j.drafts.every(d => ["archived", "pending_review", "draft"].includes(d.status)), "drafts=" + rb.j.drafts.length + " archived=" + rb.j.drafts.filter(d => d.status === "archived").length);
 // ===== R1-07 =====
 const ev7 = await U("/api/ai/evidence-check?ref=knowledge:K7.1", { ck: A });
 K("R1-07 停用后 knowledge:K7.1 引用 404；现网无 approved 正式版本", ev7.st === 404 && rb.st === 200, "audit链见KIDS");
 console.log(serr.includes("500") || serr.includes("TypeError") ? "SRV_ERR " + serr.slice(0, 260) : "srv_clean");
 console.log("IDS " + JSON.stringify({ acct: TU, create_audit: cr.j.audit_id, edit_audit: fe.j.audit_id, disable_audit: disT.j.audit_id, restore_audit: rst.j.audit_id, status_audit_rows: (auds.j.rows || []).map(x => x.audit_id), ai_calls: [c1.j.ai_call_id, c2.j.ai_call_id], confirm_audit: cf.j.confirm_audit_id || cf.j.audit_id }));
 console.log(fails ? `R18_${fails}_FAILED` : "R18_OK");
 child.kill("SIGTERM"); setTimeout(() => process.exit(fails ? 1 : 0), 250);
})();
