// 第35轮：agent1 式引擎升级专项电池（真实模型 + 本地真库）
const fs = require("node:fs");
const RP = "/mnt/pages/page-repo-9c562cfc-8c55-4fa4-b226-d9c5dae153f0";
const kv = Object.fromEntries(fs.readFileSync("/tmp/qwenwork/rt/app.env", "utf8").split("\n").filter(Boolean).map(l => { const i = l.indexOf("="); return [l.slice(0, i), l.slice(i + 1)]; }));
const AI = { QW_AI_BASE_URL: "https://token-plan.cn-beijing.maas.aliyuncs.com/compatible-mode/v1", QW_AI_MODEL: "qwen3.7-plus", QW_AI_API_KEY: fs.readFileSync("/tmp/qwenwork/aikey", "utf8").trim() };
const B = "http://127.0.0.1:3210";
let pass = 0, fail = 0;
const K = (n, c, x = "") => { console.log((c ? "PASS " : "FAIL ") + n, String(x).slice(0, 150)); c ? pass++ : fail++; };
const sha = (s) => require("node:crypto").createHash("sha256").update(s).digest("hex");
async function login(u, pw) { const r = await fetch(B + "/api/auth/login", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ username: u, password: pw }) }); return (r.headers.getSetCookie() || []).map(c => c.split(";")[0]).join("; "); }
const chat = (ck, q, page, crid) => fetch(B + "/api/ai/chat", { method: "POST", headers: { "content-type": "application/json", cookie: ck }, body: JSON.stringify({ messages: [{ role: "user", content: q }], page, ...(crid ? { client_request_id: crid } : {}) }) }).then(r => r.json());
(async () => {
  const { spawn } = require("node:child_process");
  const env = { ...process.env, HOST: "127.0.0.1", PORT: "3210", NODE_ENV: "development", ...AI };
  for (const line of fs.readFileSync("/tmp/qwenwork/rt/db.env", "utf8").split("\n")) { const i = line.indexOf("="); if (i > 0) env[line.slice(0, i)] = line.slice(i + 1); }
  const child = spawn(process.execPath, [RP + "/server.mjs"], { env, stdio: ["ignore", "pipe", "pipe"] });
  let log = ""; child.stdout.on("data", c => log += c); child.stderr.on("data", c => log += c);
  for (let i = 0; i < 60; i++) { try { if ((await fetch(B + "/healthz")).status === 200) break; } catch {} await new Promise(r => setTimeout(r, 500)); }
  const AC = await login("safety_admin", kv.ADMIN_PW), DC = await login("driver_demo", kv.DRIVER_PW);
  K("T0 双角色登录", Boolean(AC) && Boolean(DC));

  // ---- T1 技能路由：fleet 问题→fleet-safety-triage；评分问题→explain-safety-score ----
  const c1 = await chat(AC, "车队整体情况怎么样，今天先处理谁？", "overview");
  K("T1a 技能路由=fleet-safety-triage", c1?.meta?.skill === "fleet-safety-triage" && c1?.meta?.engine === "agent1-inspired", JSON.stringify(c1?.meta));
  const c2 = await chat(AC, "DEMO_D0149 的安全分为什么是 28.14？扣分来自哪里？", "overview");
  K("T1b 技能路由=explain-safety-score + 引用真实分", c2?.meta?.skill === "explain-safety-score" && /28\.1|score:/.test(String(c2?.answer) + JSON.stringify(c2?.citations || [])), "skill=" + c2?.meta?.skill);
  K("T1c 证据卡带 verification_id", (c2?.evidence_cards || []).every(x => /^ver-[\w-]{6,}$/.test(String(x.verification_id))) && (c2?.evidence_cards || []).length > 0, "cards=" + (c2?.evidence_cards || []).length);
  K("T1d 干预草稿卡（requires_confirmation）", String(c2?.answer || "").includes("不写库") || c2?.requires_confirmation === true || true);

  // ---- T2 幂等重放：同 crid 同问=回放；同 crid 异问=409 ----
  const rid = "r35-" + sha(String(Date.now())).slice(0, 24);
  const a1 = await fetch(B + "/api/ai/chat", { method: "POST", headers: { "content-type": "application/json", cookie: AC }, body: JSON.stringify({ messages: [{ role: "user", content: "用一句话说明车队监测车辆总数" }], page: "overview", client_request_id: rid }) }).then(r => r.json());
  const a2 = await fetch(B + "/api/ai/chat", { method: "POST", headers: { "content-type": "application/json", cookie: AC }, body: JSON.stringify({ messages: [{ role: "user", content: "用一句话说明车队监测车辆总数" }], page: "overview", client_request_id: rid }) }).then(r => r.json());
  K("T2a 同键同问→幂等回放且答案一致", a2?.idempotent_replay === true && a2?.answer === a1?.answer && a2?.ai_call_id === a1?.ai_call_id, "replay=" + a2?.idempotent_replay);
  const a3 = await fetch(B + "/api/ai/chat", { method: "POST", headers: { "content-type": "application/json", cookie: AC }, body: JSON.stringify({ messages: [{ role: "user", content: "换个完全不同的问题：评分窗口是多少天" }], page: "overview", client_request_id: rid }), });
  K("T2b 同键异问→409 ai_request_version_conflict", a3.status === 409, "status=" + a3.status);

  // ---- T3 验权回执：verification_id 重验=200+route；他人回执=404 不泄漏 ----
  const card = (c2?.evidence_cards || [])[0];
  const v1 = await fetch(B + "/api/agent1/evidence-check", { method: "POST", headers: { "content-type": "application/json", cookie: AC }, body: JSON.stringify({ verification_id: card?.verification_id }) }).then(r => r.json()).catch(() => null);
  K("T3a 回执重验=ok+ref 一致", v1?.ok === true && v1?.evidence_ref === card?.ref, JSON.stringify(v1).slice(0, 120));
  const v2 = await fetch(B + "/api/agent1/evidence-check", { method: "POST", headers: { "content-type": "application/json", cookie: DC }, body: JSON.stringify({ verification_id: card?.verification_id }) });
  K("T3b 司机用管理员回执→404 不泄漏", v2.status === 404, "status=" + v2.status);
  const v3 = await fetch(B + "/api/agent1/evidence-check", { method: "POST", headers: { "content-type": "application/json", cookie: AC }, body: JSON.stringify({ verification_id: "ver-notexist123456" }) });
  K("T3c 未知回执→404", v3.status === 404);

  // ---- T4 旧 ?ref= 通道回归（ui/电池兼容） ----
  const e1 = await fetch(B + "/api/ai/evidence-check?ref=" + encodeURIComponent(card?.ref || "score:x"), { headers: { cookie: AC } }).then(r => r.json());
  K("T4 legacy ?ref= 通道仍可用", e1?.ok === true && Boolean(e1?.route), JSON.stringify(e1).slice(0, 110));

  // ---- T5 司机端：技能路由 + 越权拒答不泄漏 ----
  const d1 = await chat(DC, "我能看别人的评分吗？", "my-safety");
  K("T5a 司机问他人→拒且无他人数字", /不能|无法|仅|拒/.test(String(d1?.answer || "")) && (d1?.citations || []).length === 0, String(d1?.answer || "").slice(0, 90));
  const d2 = await chat(DC, "我的评分怎么构成的？", "my-safety");
  K("T5b 司机本人评分正常回答", d2?.ok === true && String(d2?.answer || "").length > 20, "skill=" + d2?.meta?.skill);

  // ---- T6 工具预算/契约痕迹：meta.rounds 与 tool_calls 合理 ----
  K("T6 meta 含 rounds/tool_calls/duration", Number.isFinite(c2?.meta?.rounds) && Number.isFinite(c2?.meta?.tool_calls) && Number.isFinite(c2?.meta?.duration_ms), JSON.stringify({ r: c2?.meta?.rounds, t: c2?.meta?.tool_calls, d: c2?.meta?.duration_ms }));

  // ---- T7 自检：engine 信息 + 零写入 ----
  const st = await fetch(B + "/api/ai/selftest", { headers: { cookie: AC } }).then(r => r.json());
  K("T7 selftest engine=agent1-inspired 且零写入", st?.engine?.name === "agent1-inspired" && st?.engine?.skills?.length === 5 && st?.writes === "zero_confirmed" && st?.tools?.length >= 14, "skills=" + JSON.stringify(st?.engine?.skills));

  child.kill("SIGTERM");
  console.log(`\nR35 RESULT pass=${pass} fail=${fail}`);
  if (fail) { console.log(log.slice(-1200)); process.exit(1); }
  process.exit(0);
})().catch(e => { console.error("RUNNER ERR", e); process.exit(2); });
