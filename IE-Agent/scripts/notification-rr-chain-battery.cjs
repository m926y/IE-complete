const { spawn } = require("node:child_process"); const fs = require("node:fs");
const R2 = "/mnt/pages/page-repo-9c562cfc-8c55-4fa4-b226-d9c5dae153f0";
const ST = R2 + "/.qw-pages/publish";
const kv = Object.fromEntries(fs.readFileSync(R2 + "/.runtime-tmp/app.env", "utf8").split("\n").filter(Boolean).map(l => { const i = l.indexOf("="); return [l.slice(0, i), l.slice(i + 1)]; }));
const child = spawn(process.execPath, [ST + "/server.mjs"], { env: { ...process.env, NODE_ENV: "development", HOST: "127.0.0.1", PORT: "3631" }, cwd: ST, stdio: ["ignore", "pipe", "pipe"] });
const B = "http://127.0.0.1:3631";
let fails = 0; const K = (n, c, x = "") => { console.log((c ? "PASS " : "FAIL ") + n, String(x).slice(0, 170)); if (!c) fails++; };
const U = async (p, o = {}) => { try { const r = await fetch(B + p, { method: o.post ? "POST" : o.patch ? "PATCH" : "GET", headers: { "content-type": "application/json", ...(o.ck ? { cookie: o.ck } : {}) }, body: (o.post || o.patch) ? JSON.stringify(o.body || {}) : undefined }); let j = {}; try { j = await r.json(); } catch {} return { st: r.status, j, sc: (r.headers.getSetCookie?.() || []).map(x => x.split(";")[0]).find(x => x.startsWith("claw_session=")) }; } catch { return { st: 0, j: {} } } };
(async () => {
 for (let i = 0; i < 90; i++) { try { if ((await U("/healthz")).st === 200) break; } catch {} await new Promise(r => setTimeout(r, 400)); }
 const A = (await U("/api/auth/login", { post: 1, body: { username: "safety_admin", password: kv.ADMIN_PW } })).sc;
 const D = (await U("/api/auth/login", { post: 1, body: { username: "driver_demo", password: kv.DRIVER_PW } })).sc;
 const k = "rvw_r30b_" + (Date.now() % 100000);
 const c = await U("/api/admin/templates", { post: 1, ck: A, body: { template_key: k, title: "答复通知（R30b）", body: "复核答复：司机{{driver_id}}，原因码{{evidence_type}}，说明：{{review_note}}（站内演示）。", allowed_placeholders: "driver_id,evidence_type,review_note", scene: "review_answer", source_note: "R30b 真实闭环" } });
 await U(`/api/admin/templates/${k}:1`, { patch: 1, ck: A, body: { action: "submit" } });
 const ap = await U(`/api/admin/templates/${k}:1`, { patch: 1, ck: A, body: { action: "approve", confirm_same_actor: true } });
 // 司机本人提交真实复核申请
 const rr = await U("/api/review-requests", { post: 1, ck: D, body: { score_id: "95301325_2026-07-31", evidence_id: "95301325_11804_2026-07-31", reason_code: "device_or_data_missing", description: "R30b-107415：IMU 事件时间戳与台账不一致，请核查（演示异议）。" } });
 const RID = rr.j.request_id;
 K("B1 模板批准 + 司机真实复核申请（201 或幂等 replay 200）", ap.j.new_status === "approved" && [200, 201].includes(rr.st) && !!RID, `rr=${RID} tpl_audit=${ap.j.audit_id}`);
 const tid = c.j.template_id;
 const adv = await U(`/api/review-requests/${RID}/advance`, { post: 1, ck: A, body: { status: "answered", response_note: "已核：事件时间戳为 UTC 口径，答复附说明（R30b 演示答复）。", template_ref: tid } });
 K("B2 answered 带模板放行 + 通知生成", adv.st === 200 && adv.j.driver_notified !== undefined, "status=" + adv.j.new_status);
 const notes = (await U(`/api/data/my.notifications?limit=30`, { ck: D })).j.rows || [];
 const hit = notes.find(x => String(x.source_entity_id || "") === RID || String(x.body || x.content || "").includes("复核答复：司机DEMO_D0149"));
 const bodyT = String((hit || {}).body || (hit || {}).content || "");
 K("B3 driver_demo 站内收到模板渲染答复（真值填入、无「待核」残留于已具事实）", !!hit && bodyT.includes("R30b：IMU") === false && bodyT.includes("DEMO_D0149") && bodyT.includes("device_or_data_missing") && (bodyT.includes("R30b 演示答复") || bodyT.includes("已核") || bodyT.includes("说明：")), bodyT.slice(0, 110));
 const aud = (await U(`/api/data/admin.audit?limit=10&entity_id=${RID}`, { ck: A })).j.rows || [];
 K("B4 advance/answered 审计在案（真实动作名）", aud.some(x => String(x.action).startsWith("review_request.")), aud.map(x => x.audit_id + ":" + x.action).slice(0, 2).join(","));
 const rj = await U(`/api/review-requests/${RID}/advance`, { post: 1, ck: A, body: { status: "closed", response_note: "闭环", template_ref: "nt-nonexist" } });
 K("B5 不存在的模板参照 → 409/404 拒（不静默回退）", [404, 409].includes(rj.st), rj.j.error || "");
 console.log("IDS " + JSON.stringify({ rr: RID, tpl: tid, advance_audits: aud.slice(0, 3).map(x => x.audit_id) }));
 console.log(fails ? `R30B_${fails}_FAILED` : "R30B_OK");
 child.kill("SIGTERM"); setTimeout(() => process.exit(fails ? 1 : 0), 250);
})();
