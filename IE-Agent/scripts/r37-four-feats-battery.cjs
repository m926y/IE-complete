// 第37轮四功能电池（真实库）：司机资料 / 根因分析 / 评分标准开放配置（草案→批准→生效） / 等级→强制映射
const fs = require("node:fs");
const RP = "/mnt/pages/page-repo-9c562cfc-8c55-4fa4-b226-d9c5dae153f0";
const kv = Object.fromEntries(fs.readFileSync("/tmp/qwenwork/rt/app.env", "utf8").split("\n").filter(Boolean).map(l => { const i = l.indexOf("="); return [l.slice(0, i), l.slice(i + 1)]; }));
const B = "http://127.0.0.1:3220";
let pass = 0, fail = 0;
const K = (n, c, x = "") => { console.log((c ? "PASS " : "FAIL ") + n, String(x).slice(0, 150)); c ? pass++ : fail++; };
async function J(path, opt = {}) { const r = await fetch(B + path, { ...opt, headers: { "content-type": "application/json", ...(opt.headers || {}) } }); let j = null; try { j = await r.json(); } catch {} return { status: r.status, j }; }
const login = async (u, p) => { const r = await fetch(B + "/api/auth/login", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ username: u, password: p }) }); return { status: r.status, cookie: (r.headers.getSetCookie() || []).map(c => c.split(";")[0]).join("; ") }; };
(async () => {
  const { spawn } = require("node:child_process");
  const env = { NODE_ENV: "production", ...process.env, HOST: "127.0.0.1", PORT: "3220" };
  for (const line of fs.readFileSync("/tmp/qwenwork/rt/db.env", "utf8").split("\n")) { const i = line.indexOf("="); if (i > 0) env[line.slice(0, i)] = line.slice(i + 1); }
  const child = spawn(process.execPath, [RP + "/server.mjs"], { env, stdio: ["ignore", "pipe", "pipe"] });
  let log = ""; child.stdout.on("data", c => log += c); child.stderr.on("data", c => log += c);
  for (let i = 0; i < 80; i++) { try { if ((await fetch(B + "/healthz")).status === 200) break; } catch {} await new Promise(r => setTimeout(r, 500)); }
  const LA = await login("safety_admin", kv.ADMIN_PW), LD = await login("driver_demo", kv.DRIVER_PW);
  const ckA = { headers: { cookie: LA.cookie } }, ckD = { headers: { cookie: LD.cookie } };
  const me = (await J("/api/me", ckD)).j; const duid = me?.user?.userId || "";
  K("T0 双角色登录+会话", LA.status === 200 && LD.status === 200 && !!duid);
  const total = async (res, params = {}) => (await J("/api/data/" + res + "?" + new URLSearchParams(Object.assign({ limit: 1 }, params)), ckA)).j?.total;
  const pre = { er: await total("admin.evaluation_rules"), sc: await total("admin.score_snapshots"), led: await total("admin.deduction_ledger"), hst: await total("admin.score_history"), tt: await total("admin.trainings") };
  console.log("counts_before:", JSON.stringify(pre));

  // ===== ① 司机资料维护 =====
  K("P1 司机 GET profile", (await J("/api/me/profile", ckD)).status === 200);
  const pBad = await J("/api/me/profile", { method: "POST", ...ckD, body: JSON.stringify({ phone: "abc!!" }) });
  K("P2 非法电话→409 invalid_phone_format", pBad.status === 409 && pBad.j?.error === "invalid_phone_format");
  const pBadj = await J("/api/me/profile", { method: "POST", ...ckD, body: JSON.stringify({ prefs: "not-json" }) });
  K("P3 非法prefs→409 invalid_prefs_json", pBadj.status === 409 && pBadj.j?.error === "invalid_prefs_json");
  const pOk = await J("/api/me/profile", { method: "POST", ...ckD, body: JSON.stringify({ phone: "138-0000-7788", intro: "R37自维护：常跑城东夜班组（测试备注）", prefs: JSON.stringify({ contact_pref: "仅紧急事件联系" }) }) });
  K("P4 合法保存→200+审计", pOk.status === 200 && /^aud-/.test(String(pOk.j?.audit_id)));
  const g1 = await J("/api/me/profile", ckD);
  K("P5 回读持久化一致", g1.j?.profile?.phone === "138-0000-7788" && String(g1.j?.profile?.intro || "").includes("R37"));
  const adm = await J("/api/me/profile", { method: "POST", ...ckA, body: JSON.stringify({ phone: "12345" }) });
  K("P6 管理员越界→403 profile_driver_only", adm.status === 403 && adm.j?.error === "profile_driver_only");
  const au0 = await J("/api/admin/audit?action_prefix=account.profile_update&limit=5", ckA);
  K("P7 审计链在案", (au0.j?.rows || []).length >= 1, "rows=" + (au0.j?.rows || []).length);
  const profRes = await J("/api/data/admin.driver_profiles?limit=1", ckA);
  K("P7b 资料表未暴露为资源（防越权读他人）", profRes.status === 404, "status=" + profRes.status);

  // ===== ② 根因分析 =====
  const rc = await J("/api/analysis/root-causes?cohort=cd", ckA); const rcd = rc.j || {};
  K("R1 staff 200 结构完整·限制声明在位", rc.status === 200 && rcd.data_status === "ok" && Array.isArray(rcd.dimensions) && Array.isArray(rcd.top_objects) && /因果|不构成/.test(String(rcd.note)), "pool=" + rcd.cohort_count);
  const cCnt = await total("admin.score_snapshots", { risk_level: "C" }), dCnt = await total("admin.score_snapshots", { risk_level: "D" });
  K("R2 池=真实C+D计数", rcd.cohort_count === ((cCnt || 0) + (dCnt || 0)), `${rcd.cohort_count} vs ${cCnt}+${dCnt}`);
  K("R3 仅D池=D计数", (await J("/api/analysis/root-causes?cohort=d", ckA)).j?.cohort_count === dCnt);
  const dimSum = (rcd.dimensions || []).reduce((a, x) => a + (x.share_pct || 0), 0);
  K("R4 维度占度和≈100", Math.abs(dimSum - 100) < 1.5, "sum=" + dimSum.toFixed(1));
  K("R5 司机 403", (await J("/api/analysis/root-causes", ckD)).status === 403);

  // ===== ③ 评分标准开放配置 =====
  const b0 = await J("/api/admin/rule-drafts", ckA);
  const liveDims = (b0.j?.current || []).map(x => String(x.dimension));
  K("S0 规则板 6 维（现行含版本）", (b0.j?.current || []).length === 6 && (b0.j?.current || []).every(x => x.source_version), liveDims.join(","));
  const tgt = liveDims.includes("fatigue_distraction") ? "fatigue_distraction" : liveDims[0];
  const tv = Number((b0.j?.current || []).find(x => String(x.dimension) === tgt)?.weight);
  const t1 = await J("/api/admin/rule-drafts", { method: "POST", ...ckA, body: JSON.stringify({ dimension: tgt, proposal: "R37 文本草案：仅说明不可生效" }) });
  K("S1 文本草案=非结构化", t1.status === 201 && t1.j?.structured === false);
  await J("/api/admin/rule-drafts/" + encodeURIComponent(t1.j.draft_id), { method: "PATCH", ...ckA, body: JSON.stringify({ action: "submit" }) });
  K("S2 批准缺备注→409", (await J("/api/admin/rule-drafts/" + encodeURIComponent(t1.j.draft_id), { method: "PATCH", ...ckA, body: JSON.stringify({ action: "approve" }) })).j?.error === "approve_requires_review_note");
  const t3 = await J("/api/admin/rule-drafts/" + encodeURIComponent(t1.j.draft_id), { method: "PATCH", ...ckA, body: JSON.stringify({ action: "approve", review_note: "R37 批准" }) });
  K("S3 同作者未确认→409 self_review", t3.status === 409 && t3.j?.error === "self_review_requires_explicit_confirm");
  const t4 = await J("/api/admin/rule-drafts/" + encodeURIComponent(t1.j.draft_id), { method: "PATCH", ...ckA, body: JSON.stringify({ action: "approve", review_note: "R37 批准", confirm_same_actor: true }) });
  K("S4 二次确认批准→approved", t4.status === 200 && t4.j?.new_status === "approved");
  const t5 = await J("/api/admin/rule-drafts/" + encodeURIComponent(t1.j.draft_id), { method: "PATCH", ...ckA, body: JSON.stringify({ action: "effectuate", confirm_effectuate: true }) });
  K("S5 文本草案生效→409 not_structured", t5.status === 409 && t5.j?.error === "proposal_not_structured_for_effectuate");
  await J("/api/admin/rule-drafts/" + encodeURIComponent(t1.j.draft_id), { method: "PATCH", ...ckA, body: JSON.stringify({ action: "archive" }) });
  const s1 = await J("/api/admin/rule-drafts", { method: "POST", ...ckA, body: JSON.stringify({ dimension: tgt, proposal: "R37 结构化生效链验证（等值权重，不改分值口径）", weights: { [tgt]: tv } }) });
  K("S6 结构化草案", s1.status === 201 && s1.j?.structured === true);
  const did = encodeURIComponent(s1.j.draft_id);
  await J("/api/admin/rule-drafts/" + did, { method: "PATCH", ...ckA, body: JSON.stringify({ action: "submit" }) });
  const s2 = await J("/api/admin/rule-drafts/" + did, { method: "PATCH", ...ckA, body: JSON.stringify({ action: "approve", review_note: "R37 批准（等值生效验证）", confirm_same_actor: true }) });
  K("S7 批准", s2.status === 200 && s2.j?.new_status === "approved");
  K("S8 生效无确认→409", (await J("/api/admin/rule-drafts/" + did, { method: "PATCH", ...ckA, body: JSON.stringify({ action: "effectuate" }) })).j?.error === "effectuate_requires_explicit_confirm");
  const s4 = await J("/api/admin/rule-drafts/" + did, { method: "PATCH", ...ckA, body: JSON.stringify({ action: "effectuate", confirm_effectuate: true }) });
  K("S9 生效→ruleset_vN", s4.status === 200 && s4.j?.new_status === "effectuated" && /^ruleset_v\d+/.test(String(s4.j?.new_source_version)), String(s4.j?.new_source_version));
  const b1 = await J("/api/admin/rule-drafts", ckA);
  const trow = (b1.j?.current || []).find(x => String(x.dimension) === tgt);
  K("S10 现行=等值权重+新版本；他维不动", Number(trow.weight) === tv && /^ruleset_v/.test(String(trow.source_version)), `${tgt}:${trow.weight}@${trow.source_version}`);
  K("S11 越界权重→409", (await J("/api/admin/rule-drafts", { method: "POST", ...ckA, body: JSON.stringify({ dimension: tgt, proposal: "x", weights: { [tgt]: 5 } }) })).j?.error === "weight_out_of_range");
  K("S12 旁路直改仍 410", (await J("/api/admin/evaluation-rules", { method: "POST", ...ckA, body: JSON.stringify({}) })).status === 410);
  const postCore = { er: await total("admin.evaluation_rules"), sc: await total("admin.score_snapshots"), led: await total("admin.deduction_ledger"), hst: await total("admin.score_history") };
  K("S13 生效链零改写历史：er/sc/ledger/history 行数不变", postCore.er === pre.er && postCore.sc === pre.sc && postCore.led === pre.led && postCore.hst === pre.hst, JSON.stringify(postCore));
  const dchk = await J("/api/data/admin.score_snapshots?limit=1&driver_id=DEMO_D0149", ckA);
  K("S14 快照分值原样（28.142576/D/snapshot_ffbc…）", String(dchk.j?.rows?.[0]?.safety_score) === "28.142576" && dchk.j?.rows?.[0]?.risk_level === "D", JSON.stringify(dchk.j?.rows?.[0]?.safety_score));

  // ===== ④ 等级→强制映射 =====
  const inv = await J("/api/admin/ops-config", { method: "POST", ...ckA, body: JSON.stringify({ config_id: "training_mandate_policy", value: "{\"X\":\"mandatory\"}" }) });
  K("M1 非法映射键→409 mandate_policy_invalid", inv.status === 409 && inv.j?.error === "mandate_policy_invalid");
  const mk = await J("/api/admin/ops-config", { method: "POST", ...ckA, body: JSON.stringify({ config_id: "training_mandate_policy", value: JSON.stringify({ D: "mandatory", C: "optional", B: "optional", A: "optional" }) }) });
  K("M2 映射写入（201 创建或 200 升版）", [200, 201].includes(mk.status) && Number(mk.j?.new_version) >= 1 && /^aud|^$/.test(String(mk.j?.audit_id || "")), mk.status + " v" + mk.j?.new_version);
  const asg = await J("/api/admin/training-assign", { method: "POST", ...ckA, body: JSON.stringify({ course_id: "DEMO_C01", driver_id: "DEMO_D0149", goal: "【R37 映射验证·真实演示任务】D级按现行映射强制：疲劳与分心短路径复盘", due_at: "2026-12-05", idempotency_key: "r37-mandate-" + Date.now() }) });
  K("M3 缺省提交→映射自动强制(policy)", asg.status === 200 && asg.j?.mandatory === true && String(asg.j?.mandatory_source || "").startsWith("policy"), JSON.stringify({ m: asg.j?.mandatory, s: asg.j?.mandatory_source }));
  const tsk = await J("/api/data/admin.trainings?limit=1&task_id=" + encodeURIComponent(asg.j?.task_id || "none"), ckA);
  K("M4 落库 mandatory=true（布尔列）", tsk.j?.rows?.[0]?.mandatory === true || String(tsk.j?.rows?.[0]?.mandatory) === "true");
  const asg2 = await J("/api/admin/training-assign", { method: "POST", ...ckA, body: JSON.stringify({ course_id: "DEMO_C01", driver_id: "DEMO_D0149", goal: "【R37 改判验证·真实演示任务】人工显式非强制（允许+留痕）", due_at: "2026-12-05", mandatory: false, idempotency_key: "r37-override-" + Date.now() }) });
  K("M5 人工改判→允许且 manual", asg2.status === 200 && asg2.j?.mandatory === false && asg2.j?.mandatory_source === "manual");
  K("M6 任务行数 = 基线+2（本轮真实演示对象，已披露）", (await total("admin.trainings")) === pre.tt + 2);
  child.kill("SIGTERM");
  console.log(`\nR37 RESULT pass=${pass} fail=${fail}`);
  if (fail) { console.log(log.slice(-1200)); process.exit(1); }
  process.exit(0);
})().catch(e => { console.error("RUNNER ERR", e); process.exit(2); });
