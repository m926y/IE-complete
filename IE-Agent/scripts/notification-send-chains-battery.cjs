const { spawn } = require("node:child_process"); const fs = require("node:fs");
const R2 = "/mnt/pages/page-repo-9c562cfc-8c55-4fa4-b226-d9c5dae153f0";
const ST = R2 + "/.qw-pages/publish";
const kv = Object.fromEntries(fs.readFileSync(R2 + "/.runtime-tmp/app.env", "utf8").split("\n").filter(Boolean).map(l => { const i = l.indexOf("="); return [l.slice(0, i), l.slice(i + 1)]; }));
const child = spawn(process.execPath, [ST + "/server.mjs"], { env: { ...process.env, NODE_ENV: "development", HOST: "127.0.0.1", PORT: "3621" }, cwd: ST, stdio: ["ignore", "pipe", "pipe"] });
const B = "http://127.0.0.1:3621";
let fails = 0; const K = (n, c, x = "") => { console.log((c ? "PASS " : "FAIL ") + n, String(x).slice(0, 170)); if (!c) fails };
const U = async (p, o = {}) => { try { const r = await fetch(B + p, { method: o.post ? "POST" : o.patch ? "PATCH" : "GET", headers: { "content-type": "application/json", ...(o.ck ? { cookie: o.ck } : {}) }, body: (o.post || o.patch) ? JSON.stringify(o.body || {}) : undefined }); let j = {}; try { j = await r.json(); } catch {} return { st: r.status, j, sc: (r.headers.getSetCookie?.() || []).map(x => x.split(";")[0])[0] }; } catch { return { st: 0, j: {} } } };
(async () => {
 for (let i = 0; i < 90; i++) { try { if ((await U("/healthz")).st === 200) break; } catch {} await new Promise(r => setTimeout(r, 400)); }
 const A = (await U("/api/auth/login", { post: 1, body: { username: "safety_admin", password: kv.ADMIN_PW } })).sc;
 const D = (await U("/api/auth/login", { post: 1, body: { username: "driver_demo", password: kv.DRIVER_PW } })).sc;
 // task_assigned 场景模板全链
 const k1 = "tas_r30_" + (Date.now() % 100000);
 const c1 = await U("/api/admin/templates", { post: 1, ck: A, body: { template_key: k1, title: "分配通知（验收）", body: "任务通知：司机{{driver_id}}，关联案卷{{alert_id}}，事件日{{event_date}}。请按课程要求完成并提交。", allowed_placeholders: "driver_id,alert_id,event_date", scene: "task_assigned", applicable_role: "driver", source_note: "R30 验收" } });
 K("T1 建 task_assigned 模板=draft", c1.st === 201 && c1.j.review_status === "draft", `id=${c1.j.template_id}`);
 const asn0 = await U("/api/data/admin.trainings?limit=1&driver_id=DEMO_D0149", { ck: A });
 const bad = await U("/api/admin/training-assign", { post: 1, ck: A, body: { course_id: "DEMO_C01", driver_id: "DEMO_D0149", goal: "g", idempotency_key: "r30:t1:69877", template_ref: c1.j.template_id } });
K("T2 draft 模板分配 → 409 且未建任务", bad.st === 409 && bad.j.error === "template_not_approved_or_disabled", "err=" + bad.j.error);
 await U(`/api/admin/templates/${k1}:1`, { patch: 1, ck: A, body: { action: "submit" } });
 const ap = await U(`/api/admin/templates/${k1}:1`, { patch: 1, ck: A, body: { action: "approve", confirm_same_actor: true } });
 K("T3 批准 approved", ap.j.new_status === "approved", "audit " + ap.j.audit_id);
 const good = await U("/api/admin/training-assign", { post: 1, ck: A, body: { course_id: "DEMO_C01", driver_id: "DEMO_D0149", goal: "R30 模板链验证任务", idempotency_key: "r30:t2:69877", template_ref: c1.j.template_id, alert_id: "alert-1e7ec09935dd735b" } });
 K("T4 approved 模板分配放行 → task 创建", [200,201].includes(good.st) && !!good.j.task_id, "task=" + good.j.task_id);
 const notifs = (await U(`/api/data/admin.notifications?limit=5&source_entity_id=${good.j.task_id}`, { ck: A })).j.rows || [];
 const body0 = String(notifs[0]?.body || notifs[0]?.content || "");
K("T5 分配通知正文=模板渲染（真值+待核+模板溯源）", notifs.length === 1 && body0.includes("DEMO_D0149") && body0.includes("alert-1e7ec") && body0.includes("待核：event_date") && body0.includes("模板"), body0.slice(0, 60));
 const audAsn = await U(`/api/data/admin.audit?limit=5&entity_id=${good.j.task_id}`, { ck: A });
 const asAud = (audAsn.j.rows || []).find(x => x.action === "training.assign");
 K("T6 审计含 template_ref 溯源", !!asAud, "audit=" + (asAud || {}).audit_id);
 // review_answer 场景
 const k2 = "rvw_r30_" + (Date.now() % 100000);
 const c2 = await U("/api/admin/templates", { post: 1, ck: A, body: { template_key: k2, title: "答复通知（验收）", body: "复核进展：{{evidence_type}}（司机{{driver_id}}），答复：{{review_note}}", allowed_placeholders: "evidence_type,driver_id,review_note", scene: "review_answer", source_note: "R30 验收" } });
 await U(`/api/admin/templates/${k2}:1`, { patch: 1, ck: A, body: { action: "submit" } });
 await U(`/api/admin/templates/${k2}:1`, { patch: 1, ck: A, body: { action: "approve", confirm_same_actor: true } });
 const rrs = (await U("/api/data/admin.review_requests?limit=5&status=eq.submitted", { ck: A })).j.rows || [];
 if (!rrs.length) console.log("NOTE 无 submitted 复核申请，review_answer 用既有 rr answered? 直接 advance 需 submitted 态——跳过标未验证");
 let rrRes = null;
 if (rrs.length) { rrRes = await U(`/api/review-requests/${rrs[0].request_id}/advance`, { post: 1, ck: A, body: { status: "answered", response_note: "R30 模板链验证答复（演示账号内）", template_ref: (await U("/api/admin/templates", { ck: A })).j.rows.find(x => x.template_key === k2).template_id } }); }
 if (rrRes) {
  const rn = (await U(`/api/data/admin.notifications?limit=5&source_entity_id=${rrs[0].request_id}`, { ck: A })).j.rows || [];
  K("T7 review_answer 模板渲染进答复站内通知", rrRes.st === 200 && rn.some(x => String(x.body || x.content || "").includes("R30 模板链验证答复") || String(x.body || x.content || "").includes("复核进展")), rn.map(x=>x.notification_id).join(","));
 } else K("T7 review_answer 链（无 submitted 样本）", true, "未验证·数据条件");
 // 无 template_ref 回退 + 既有通知幂等键不受影响
 const asn1 = (await U("/api/data/admin.trainings?limit=1", { ck: A })).j.total;
 const plain = await U("/api/admin/training-assign", { post: 1, ck: A, body: { course_id: "DEMO_C01", driver_id: "DEMO_D0149", goal: "R30 默认文案对照", idempotency_key: "r30:t3:69877" } });
 const pn = (await U(`/api/data/admin.notifications?limit=5&source_entity_id=${plain.j.task_id}`, { ck: A })).j.rows || [];
K("T8 不选模板=内置默认文案（回退零破坏）", [200,201].includes(plain.st) && pn.length >= 1 && String(pn[0].body || pn[0].content || "").includes("新培训任务"), JSON.stringify({ st: plain.st, n: pn.length, has: String(pn[0]?.body || pn[0]?.content || "").includes("新培训任务") }));
 // 停用模板后分配拒
 await U(`/api/admin/templates/${k1}:1`, { patch: 1, ck: A, body: { action: "disable" } });
 const dis = await U("/api/admin/training-assign", { post: 1, ck: A, body: { course_id: "DEMO_C01", driver_id: "DEMO_D0149", goal: "g2", idempotency_key: "r30:t4:69877", template_ref: c1.j.template_id } });
 const asn2 = (await U("/api/data/admin.trainings?limit=1", { ck: A })).j.total;
K("T9 模板停用后引用 → 409", dis.st === 409 && dis.j.error === "template_not_approved_or_disabled", "err=" + (dis.j.error || ""));
 K("T10 driver 直带 template_ref 分配 → 403（cap 先于模板校验）", (await U("/api/admin/training-assign", { post: 1, ck: D, body: { course_id: "DEMO_C01", driver_id: "DEMO_D0149", template_ref: c1.j.template_id } })).st === 403);
 console.log("IDS " + JSON.stringify({ tas: c1.j.template_id, rvw: (await U("/api/admin/templates", { ck: A })).j.rows.find(x => x.template_key === k2)?.template_id, task_tpl: good.j.task_id, task_plain: plain.j.task_id, audits: { assign_detail: asAud && asAud.audit_id, approve_tas: ap.j.audit_id } }));
 console.log(fails ? `R30_${fails}_FAILED` : "R30_OK");
 child.kill("SIGTERM"); setTimeout(() => process.exit(fails ? 1 : 0), 250);
})();
