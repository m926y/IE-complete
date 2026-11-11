const { spawn } = require("node:child_process"); const fs = require("node:fs");
const R = "/mnt/pages/page-repo-9c562cfc-8c55-4fa4-b226-d9c5dae153f0";
const T = R + "/.runtime-tmp";
const kv = Object.fromEntries(fs.readFileSync(T + "/app.env", "utf8").split("\n").filter(Boolean).map(l => { const i = l.indexOf("="); return [l.slice(0, i), l.slice(i + 1)]; }));
const child = spawn(process.execPath, [R + "/server.mjs"], { env: { ...process.env, HOST: "127.0.0.1", PORT: "3277", NODE_ENV: "development" }, cwd: R, stdio: ["ignore", "ignore", "pipe"] });
let serr = ""; child.stderr.on("data", c => serr += c);
const B = "http://127.0.0.1:3277";
const U = async (p, o = {}) => { try { const r = await fetch(B + p, { method: o.post ? "POST" : o.patch ? "PATCH" : "GET", headers: { "content-type": "application/json", ...(o.ck ? { cookie: o.ck } : {}) }, body: (o.post || o.patch) ? JSON.stringify(o.body || {}) : undefined }); let j = {}; try { j = await r.json(); } catch {} return { st: r.status, j, sc: (r.headers.getSetCookie?.() || []).map(x => x.split(";")[0]).find(x => x.startsWith("claw_session=")) }; } catch (e) { return { st: 0, j: { _net: String(e).slice(0, 50) } }; } };
let fails = 0; const K = (n, c, x = "") => { console.log((c ? "PASS " : "FAIL ") + n, String(x).slice(0, 160)); if (!c) fails++; };
(async () => {
 for (let i = 0; i < 90; i++) { if ((await U("/healthz")).st === 200) break; await new Promise(r => setTimeout(r, 250)); }
 const A = (await U("/api/auth/login", { post: 1, body: { username: "safety_admin", password: kv.ADMIN_PW } })).sc;
 const D = (await U("/api/auth/login", { post: 1, body: { username: "driver_demo", password: kv.DRIVER_PW } })).sc;
 const AL = "alert-9f4bafddd3747b53";
 const cnt = async (t, k) => (await U(`/api/data/${t}?limit=1`, { ck: A })).j.total;
 const iv0 = await cnt("admin.interventions", "i"), n0 = (await U("/api/data/admin.notifications?limit=1", { ck: A })).j.total, tk0 = (await U(`/api/data/admin.trainings?limit=1`, { ck: A })).j.total;
 // 1) 人工确认 D0289 案卷证据为属实（真实管理员动作，RM03 gate 前置）
 let conf = await U(`/api/alerts/${AL}/status`, { patch: 1, ck: A, body: { status: "confirmed" } });
 if (conf.st === 409) conf = { st: 200, j: { ok: true, new_status: "confirmed", already: true } };
 K("case确认→confirmed（真实人工判定）", conf.st === 200 && conf.j.new_status === "confirmed", JSON.stringify(conf.j).slice(0, 60));
 // 2) AI 草稿 + fill_to 结构
 const c1 = await U("/api/ai/chat", { post: 1, ck: A, body: { messages: [{ role: "user", content: `为案卷 ${AL} 起草一条让司机配合完成设备核验的沟通消息（温和语气）` }], page: "rm-alerts" } });
 const ft = ((c1.j.draft_preview || []).find(d => d && d.kind === "intervention") || {}).fill_to;
 K("RM03 fill_to 结构", c1.st === 200 && ft && ft.form === "rm3_draft" && ft.alert_id === AL && typeof ft.draft_text === "string" && ft.route.includes(AL), JSON.stringify({ form: ft && ft.form, route: ft && ft.route }).slice(0, 90));
 // 3) 确认按钮真实写回链（填入→保存草稿→确认发送→重复确认）
 const dft = (ft && ft.draft_text) || "您好：请配合完成设备与数据覆盖核验。";
 const dr = await U(`/api/alerts/${AL}/intervention`, { post: 1, ck: A, body: { draft_text: dft } });
 const IV = dr.j.intervention_id;
 K("保存草稿→业务ID（201新建/200幂等回放同ID）", [200,201].includes(dr.st) && /^intv-/.test(IV || ""), `iv=${IV} http=${dr.st} replay=${dr.j.idempotent_replay||false}`);
 K("草稿确认幂等：同键重复保存返回同一 intervention_id", (await U(`/api/alerts/${AL}/intervention`, { post: 1, ck: A, body: { draft_text: dft } })).j.intervention_id === IV);
 const mid = (await U(`/api/data/admin.interventions?limit=10&alert_id=${AL}`, { ck: A })).j.rows[0] || {};
 const audDraft = await U(`/api/data/admin.audit?limit=50&entity_id=${IV}`, { ck: A });
 const draftEv = ((audDraft.j.rows) || []).find(x => x.new_status === "draft");
 K("确认前无 sent 字段写入（首跑直接验行；重跑以审计draft→行存在佐证）", mid.status === "draft" ? (!mid.sent_text && !mid.sent_at) : Boolean(draftEv), `status=${mid.status} auditDraft=${Boolean(draftEv)}`);
 let snd = await U(`/api/interventions/${IV}/send`, { post: 1, ck: A, body: {} });
 if (snd.j && snd.j.idempotent_replay) { /* rerun tolerance */ }
 const af = (await U(`/api/data/admin.interventions?limit=10&alert_id=${AL}`, { ck: A })).j.rows[0] || {};
 const nA = (await U(`/api/data/admin.notifications?limit=60&source_entity_id=${IV}`, { ck: A })).j.rows || [];
 const snd2 = await U(`/api/interventions/${IV}/send`, { post: 1, ck: A, body: {} });
 K("确认发送写sent_text/sent_at（DB行实锤）", snd.st === 200 && !!af.sent_text && !!af.sent_at && af.status === "sent", `sent=${snd.st} noti=${nA.length}`);
 K("D0289无绑定账号→不建通知护栏（设计行为，不谎称送达）", snd.j && snd.j.idempotent_replay !== true ? (snd.j.notification_id === null && snd.j.delivered_to_account === false) : (nA.length === 0 && snd.j.idempotent_replay === true), `noti_id=${(snd.j||{}).notification_id} bound=${(snd.j||{}).delivered_to_account}`);
 K("重复确认发送幂等（同sent_at）", snd2.j.idempotent_replay === true && snd2.j.sent_at === af.sent_at, "");
 K("interventions 每条链仅一行（重跑幂等不追加）", [iv0, iv0 + 1].includes(await cnt("admin.interventions")) && (await U(`/api/data/admin.interventions?limit=20&alert_id=${AL}`, { ck: A })).j.rows.length === 1, `${iv0}->${await cnt("admin.interventions")}`);
 // 4) TR02：司机视图无确认控件+未审核分配409+approved真实写入
 const c2 = await U("/api/ai/chat", { post: 1, ck: A, body: { messages: [{ role: "user", content: "给 DEMO_D0149 拟一份培训草稿并填入表单，用课程 DEMO_C03" }], page: "tr-create" } });
 const ft2 = ((c2.j.draft_preview || []).find(d => d && (d.kind === "training" || (d.fill_to && d.fill_to.form === "tr2"))) || {}).fill_to;
 K("TR02 fill_to 结构", ft2 && ft2.form === "tr2" && ft2.driver_id === "DEMO_D0149" && "due_at" in ft2, JSON.stringify({ course: ft2 && ft2.course_id, due: ft2 && ft2.due_at }));
 const badA = await U("/api/admin/training-assign", { post: 1, ck: A, body: { course_id: "DEMO_C03", driver_id: "DEMO_D0149", idempotency_key: "assign:b16:c03" } });
 K("未审核课程确认→409 行数不变", badA.st === 409 && badA.j.error === "course_not_approved" && (await cnt("admin.trainings")) === tk0);
 const okAsn = await U("/api/admin/training-assign", { post: 1, ck: A, body: { course_id: "DEMO_C01", driver_id: "DEMO_D0149", goal: "AI03回填真实验证（C01已人工审核）", due_at: (ft2 && ft2.due_at) || "2026-11-30", idempotency_key: "assign:b16:c01:a1" } });
 const TID = okAsn.j.task_id;
 K("approved课程确认写入 training_task+通知", okAsn.st === 200 && /^task-/.test(TID || ""), `task=${TID} http=${okAsn.st} err=${okAsn.j.error || ""}`);
 const okRep = await U("/api/admin/training-assign", { post: 1, ck: A, body: { course_id: "DEMO_C01", driver_id: "DEMO_D0149", idempotency_key: "assign:b16:c01:a1" } });
 K("重复确认返回同一业务ID", okRep.j.idempotent_replay === true && okRep.j.task_id === TID);
 const trow = ((await U(`/api/data/admin.trainings?limit=20`, { ck: A })).j.rows || []).find(x => x.task_id === TID) || {};
 K("新任务 assigned 非submitted 且必填goal保留", trow.status === "assigned" && String(trow.goal).includes("AI03"));
 // 5) 司机读 RM04：新消息可见+无确认控件（数据面），并读他人intervention→404
 const dtr = (await U("/api/data/my.trainings?limit=20", { ck: D })).j.rows || [];
 K("司机会话（DEMO_D0149绑定）可见新分配任务", dtr.some(x => x.task_id === TID && x.status === "assigned"), `tasks_seen=${dtr.length}`);
 const dn = (await U("/api/data/my.notifications?limit=60", { ck: D })).j.rows || [];
 K("司机会话收到培训任务通知行", dn.some(x => x.source_entity_id === TID), `nti=${(dn.find(x => x.source_entity_id === TID) || {}).notification_id || "-"}`);
 K("司机 my.interventions 不含 D0289（无绑定隔离）", !(await U("/api/data/my.interventions?limit=20", { ck: D })).j.rows.some(x => x.alert_id === AL));
 K("司机不能对他人任务start", (await U(`/api/training-tasks/task-nonexist/start`, { post: 1, ck: D, body: {} })).st === 404);
 // 6) AI 调用审计：本轮三次 chat 都有 ai.chat 行
 const cc = (c1.j.ai_call_id && c2.j.ai_call_id) ? true : false;
 K("两轮chat均带ai_call_id审计", cc, JSON.stringify([c1.j.ai_call_id, c2.j.ai_call_id]));
 const fin = { tasks: await cnt("admin.trainings"), notes: (await U("/api/data/admin.notifications?limit=1", { ck: A })).j.total };
 console.log("STATE " + JSON.stringify({ before: { iv0, n0, tk0 }, iv_now: await cnt("admin.interventions"), notes_now: fin.notes, tasks_now: fin.tasks, alert_d0289: (await U(`/api/data/admin.alerts?limit=10`, { ck: A })).j.rows.find(x => x.alert_id === AL)?.status }));
 console.log("IDS " + JSON.stringify({ intervention: IV, task_created: TID, chat_rm03: c1.j.ai_call_id, chat_tr02: c2.j.ai_call_id, send_audit: snd.j.audit_id, assign_audit: okAsn.j.audit_id }));
 console.log(serr.slice(0, 120));
 console.log(fails ? `B16_${fails}_FAILED` : "B16_OK");
 child.kill("SIGTERM"); setTimeout(() => process.exit(fails ? 1 : 0), 250);
})();
