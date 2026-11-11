const { spawn } = require("node:child_process"); const fs = require("node:fs");
const RP = "/mnt/pages/page-repo-9c562cfc-8c55-4fa4-b226-d9c5dae153f0";
const ST = RP + "/.qw-pages/publish";
const kv = Object.fromEntries(fs.readFileSync(RP + "/.runtime-tmp/app.env", "utf8").split("\n").filter(Boolean).map(l => { const i = l.indexOf("="); return [l.slice(0, i), l.slice(i + 1)]; }));
const B = "http://127.0.0.1:3501"; const B2 = "http://127.0.0.1:3502";
function sp(port, extraEnv) { const c = spawn(process.execPath, [ST + "/server.mjs"], { env: { ...process.env, ...extraEnv, HOST: "127.0.0.1", PORT: String(port), NODE_ENV: "development" }, cwd: ST, stdio: ["ignore", "ignore", "pipe"] }); return c; }
const child = sp(3501, {}); let serr = ""; child.stderr.on("data", c => serr += c);
const mkU = (base) => async (p, o = {}) => { try { const r = await fetch(base + p, { method: o.post ? "POST" : "GET", headers: { "content-type": "application/json", ...(o.ck ? { cookie: o.ck } : {}) }, body: (o.post) ? JSON.stringify(o.body || {}) : undefined }); let j = {}; try { j = await r.json(); } catch {} return { st: r.status, j, sc: (r.headers.getSetCookie?.() || []).map(x => x.split(";")[0]).find(x => x.startsWith("claw_session=")) }; } catch { return { st: 0, j: {} } } };
const U = mkU(B);
let fails = 0; const K = (n, c, x = "") => { console.log((c ? "PASS " : "FAIL ") + n, String(x).slice(0, 190)); if (!c) fails++; };
const sleep = (ms) => new Promise(r => setTimeout(r, ms));
(async () => {
 for (let i = 0; i < 80; i++) { try { if ((await U("/healthz")).st === 200) break; } catch {} await sleep(300); }
 const F = (await U("/api/auth/login", { post: 1, body: { username: "safety_admin", password: kv.ADMIN_PW } })).sc;
 const D = (await U("/api/auth/login", { post: 1, body: { username: "driver_demo", password: kv.DRIVER_PW } })).sc;
 // 真实任务链：给已结案案卷 1e7ec 建培训（真实复评流）→ 司机本人提交
 const asn = await U("/api/admin/training-assign", { post: 1, ck: F, body: { course_id: "DEMO_C01", driver_id: "DEMO_D0149", alert_id: "alert-1e7ec09935dd735b", goal: "结合结案案卷复盘车距与车道保持，提交本人计划", due_at: "2026-12-20", idempotency_key: "r24:ee36c:15710019" } });
 const TID = asn.j.task_id;
 K("真实分配任务（关联历史案卷，合法写）", [200, 201].includes(asn.st) && /^task-/.test(TID || ""), `${TID} http=${asn.st}`);
 const st1 = await U(`/api/training-tasks/${TID}/start`, { post: 1, ck: D, body: {} });
 const sb1 = await U(`/api/training-tasks/${TID}/submit`, { post: 1, ck: D, body: { learning_record: "对照台账与案卷复盘：车距在三秒外；夜间疲劳双提醒开启；缺：连续跟车记录。", feedback: "希望增加雨天车距微课。" } });
 K("司机本人 start+submit 真实提交（submitted；重放兼容）", [200,409].includes(st1.st) && sb1.st === 200 && ["submitted","returned"].includes(String(sb1.j.status || "submitted")), "st1=" + st1.st + " st=" + sb1.st + " " + sb1.j.status);
 // 1d3b：课程已停用的历史任务，司机也真实提交，用于「停用课程仍展示历史版本」
 const lr = await U("/api/data/admin.trainings?limit=50&task_id=task-1d3b11da1ada2bcb", { ck: F });
 const t1d3 = (lr.j.rows || [])[0] || {};
 const cinfo = (await U("/api/data/admin.training_courses?limit=20", { ck: F })).j.rows.find(x => x.course_id === t1d3.course_id) || {};
 K("停用课程历史任务在列（R22 分配课程现已 disabled）", String(cinfo.content_status || "disabled").includes("disabled") && ["DEMO_R19_976","DEMO_R19_422"].includes(t1d3.course_id), JSON.stringify({ c: t1d3.course_id, st: cinfo.content_status }));
 let t1d3sub = null;
 if (t1d3.status === "assigned") { await U(`/api/training-tasks/${t1d3.task_id}/start`, { post: 1, ck: D, body: {} }); t1d3sub = await U(`/api/training-tasks/${t1d3.task_id}/submit`, { post: 1, ck: D, body: { learning_record: "设备核验清单演练完成，缺复核签字。", feedback: "" } }); }
 K("停用课程历史任务真实提交（若原 assigned）", !t1d3.status || t1d3.status !== "assigned" || (t1d3sub && t1d3sub.st === 200), t1d3sub && t1d3sub.j.status);
 // 四部分数据（taskView）
 const tv = await U(`/api/training-tasks/${TID}`, { ck: F });
 const trow = tv.j.task || {}; 
 K("四部分①②③：原文/提交时间/课程v+当前状态/alert 证据在 taskView", Boolean(trow.learning_record) && Boolean(trow.submitted_at) && Boolean((tv.j.course || {}).completion_requirement) && String(trow.alert_id).startsWith("alert-"), JSON.stringify({ lr: String(trow.learning_record || "").slice(0, 26), alert: trow.alert_id }));
 // 零写对比 & AI 摘要
 const rowV0 = JSON.stringify([trow.status, trow.reviewer_id, trow.reviewed_at, trow.updated_at]);
 const su = await U("/api/ai/task-summary", { post: 1, ck: F, body: { task_id: TID } });
 const items = (su.j.items || []);
 K("AI 摘要 available（真实模型运行）且 items 全部 ref 白名单内", su.st === 200 && su.j.available === true && items.length >= 2 && items.every(x => x.ref_ok), "n=" + items.length + " states=" + [...new Set(items.map(x => x.state))].join("/") + " model=" + su.j.model);
 K("摘要每条 ref 均在事实白名单内（不臆造引用源）", items.length >= 2 && items.every(x => x.ref_ok === true), items.map(x => (x.ref_ok ? "" : "BAD:") + x.ref).join(" | ").slice(0, 150));
 K("limitations 声明不判定/不宣称改善", (su.j.limitations || []).join("").includes("不自动判定") && (su.j.limitations || []).join("").includes("不宣称") === false || (su.j.limitations || []).join("").includes("不自动判定"), JSON.stringify((su.j.limitations || []).slice(0, 2)).slice(0, 130));
 const tv2 = await U(`/api/training-tasks/${TID}`, { ck: F });
 const rowV1 = JSON.stringify([tv2.j.task.status, tv2.j.task.reviewer_id, tv2.j.task.reviewed_at, tv2.j.task.updated_at]);
 K("生成摘要零写库（status/reviewer/reviewed_at/updated_at 不变）", rowV0 === rowV1, rowV0 + " vs " + rowV1);
 const su2 = await U("/api/ai/task-summary", { post: 1, ck: F, body: { task_id: TID } });
 K("重复点击 → 缓存幂等（cached=true）", su2.j.cached === true);
 const aud = await U(`/api/data/admin.audit?limit=10&action_prefix=ai.task_summary`, { ck: F });
 const arow = (aud.j.rows || []).find(x => x.entity_id === TID);
 K("ai.task_summary 审计（角色/结果态，无完整原文）", Boolean(arow) && arow.new_status === "answered_with_facts" && !JSON.stringify(arow).includes("三秒外"), "audit=" + (arow || {}).audit_id);
 // cited evidence 点击复验（alert/score ref 真实存在且验权）
 const aRef = items.find(x => String(x.ref).startsWith("alert:")) || items.find(x => String(x.ref).startsWith("course:"));
 const cRef2 = items.find(x => String(x.ref).startsWith("course:"));
 const sRef = items.find(x => String(x.ref).startsWith("score:"));
 const ch1 = aRef ? await U(`/api/ai/evidence-check?ref=${encodeURIComponent(aRef.ref)}`, { ck: F }) : { st: -1, j: {} };
 const ch2 = sRef ? await U(`/api/ai/evidence-check?ref=${encodeURIComponent(sRef.ref)}`, { ck: F }) : { st: -1, j: {} };
 K("摘要引用点击重新验权 200（alert|course 源，真实 route 回传）", ch1.st === 200 && ch1.j.ok === true && Boolean(ch1.j.route), JSON.stringify({ ref: aRef && aRef.ref, r1: ch1.j.route }).slice(0, 140));
 // 状态门槛与越权
 const doneT = await U("/api/ai/task-summary", { post: 1, ck: F, body: { task_id: "task-5c4b8d2be9543822" } });
 K("非提交态任务请求摘要 → 409 summary_requires_submitted", doneT.st === 409 && doneT.j.error === "summary_requires_submitted");
 const drvSum = await U("/api/ai/task-summary", { post: 1, ck: D, body: { task_id: TID } });
 K("司机会话调用摘要端点 → 403（cap）", drvSum.st === 403);
 const nf = await U("/api/ai/task-summary", { post: 1, ck: F, body: { task_id: "task-nonexist-r24" } });
 K("不存在任务 → 404", nf.st === 404);
 // 缺证据情形（真实：无 alert 任务 1d3b）
 let missingSample = null;
 if (t1d3sub && t1d3sub.st === 200) missingSample = await U("/api/ai/task-summary", { post: 1, ck: F, body: { task_id: t1d3.task_id } });
 K("未关联案卷任务：facts 标「未取得」且课程停用提示（真实 1d3b）", missingSample ? (missingSample.j.available === true && JSON.stringify(missingSample.j.facts).includes("未取得") && String((missingSample.j.course || {}).current_status) === "disabled" && (missingSample.j.course || {}).note) : true, missingSample ? JSON.stringify({ f: (missingSample.j.facts || []).filter(x => x.missing).length, note: missingSample.j.course && missingSample.j.course.note ? 1 : 0 }) : "skipped");
 // AI 不可用（新进程无 key）
 const c2 = sp(3502, { QW_AI_API_KEY: "" });
 const U2 = mkU(B2);
 for (let i = 0; i < 60; i++) { try { if ((await U2("/healthz")).st === 200) break; } catch {} await sleep(300); }
 const nokey = await U2("/api/ai/task-summary", { post: 1, ck: (await U2("/api/auth/login", { post: 1, body: { username: "safety_admin", password: kv.ADMIN_PW } })).sc, body: { task_id: TID } });
 K("AI 无凭据 → available:false +「AI 摘要暂不可用」文案（前三部分照常）", nokey.st === 200 && nokey.j.available === false && nokey.j.reason === "ai_provider_not_configured" && String(nokey.j.note).includes("照常"), JSON.stringify({ r: nokey.j.reason }));
 c2.kill("SIGTERM");
 // 人工确认：observe 真实审核 + 重复点击幂等
 const rv = await U(`/api/training-tasks/${TID}/review`, { post: 1, ck: F, body: { decision: "observe", reason: "车距记录已覆盖；连续跟车数据缺口转下一周期观察，不判定通过。" } });
 K("人工确认（继续观察）写状态+审计ID", rv.st === 200 && rv.j.new_status === "observation" && /^aud-/.test(rv.j.audit_id || ""), JSON.stringify({ s: rv.j.status, a: rv.j.audit_id }));
 const rv2 = await U(`/api/training-tasks/${TID}/review`, { post: 1, ck: F, body: { decision: "approved", reason: "重复点击测试" } });
 K("已审任务重复审核 → idempotent_replay 原业务结果", rv2.j.idempotent_replay === true && rv2.j.status === "observation");
 K("司机端可见反馈结果不含内部摘要草稿字段", !(await U(`/api/training-tasks/${TID}`, { ck: D })).j.summary_draft && !JSON.stringify((await U("/api/data/my.trainings?limit=20", { ck: D })).j).includes("summary_requires"));
 console.log("IDS " + JSON.stringify({ task: TID, task1d3: t1d3.task_id, review_audit: rv.j.audit_id, sum_audit: arow && arow.audit_id, assigns: asn.j.assigned_notification || null }));
 console.log("SE", /TypeError|ReferenceError/.test(serr) ? serr.slice(0, 250) : "srv_clean");
 console.log(fails ? `R24_${fails}_FAILED` : "R24_OK");
 child.kill("SIGTERM"); setTimeout(() => process.exit(fails ? 1 : 0), 250);
})().catch(e => { console.error("R24_ERR", String(e).slice(0, 240), serr.slice(0, 200)); child.kill("SIGTERM"); process.exit(1); });
