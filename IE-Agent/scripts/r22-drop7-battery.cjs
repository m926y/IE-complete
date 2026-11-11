const { spawn } = require("node:child_process"); const fs = require("node:fs");
const RP = "/mnt/pages/page-repo-9c562cfc-8c55-4fa4-b226-d9c5dae153f0";
const ST = RP + "/.qw-pages/publish";
const kv = Object.fromEntries(fs.readFileSync(RP + "/.runtime-tmp/app.env", "utf8").split("\n").filter(Boolean).map(l => { const i = l.indexOf("="); return [l.slice(0, i), l.slice(i + 1)]; }));
const child = spawn(process.execPath, [ST + "/server.mjs"], { env: { ...process.env, HOST: "127.0.0.1", PORT: "3471", NODE_ENV: "development" }, cwd: ST, stdio: ["ignore", "ignore", "pipe"] });
let serr = ""; child.stderr.on("data", c => serr += c);
const B = "http://127.0.0.1:3471";
const U = async (p, o = {}) => { try { const r = await fetch(B + p, { method: o.post ? "POST" : o.patch ? "PATCH" : "GET", headers: { "content-type": "application/json", ...(o.ck ? { cookie: o.ck } : {}) }, body: (o.post || o.patch) ? JSON.stringify(o.body || {}) : undefined }); let j = {}; try { j = await r.json(); } catch {} return { st: r.status, j, sc: (r.headers.getSetCookie?.() || []).map(x => x.split(";")[0]).find(x => x.startsWith("claw_session=")) }; } catch { return { st: 0, j: {} } } };
// CSV 冻结基准（阈值10）
const txt = fs.readFileSync("/workspace/5d12ecfd-e7d8-46d4-b63a-4dbb09c2226d/work/uploads/score_history.csv", "utf8").replace(/^\ufeff/, "");
const lines = txt.trim().split(/\r?\n/); const head = lines[0].split(",");
const ix = { g: head.indexOf("gpsno"), d: head.indexOf("as_of_date"), s: head.indexOf("safety_score"), id: head.indexOf("score_id"), c: head.indexOf("confidence_level") };
const byG = {}; for (let i = 1; i < lines.length; i++) { const c = lines[i].split(","); const dd = c[ix.d]; if (dd === "2026-07-24" || dd === "2026-07-31") (byG[c[ix.g]] = byG[c[ix.g]] || {})[dd] = { s: parseFloat(c[ix.s]), id: c[ix.id], conf: c[ix.c] }; }
const csvHit = {}; let csvCount = 0;
for (const [g, v] of Object.entries(byG)) if (v["2026-07-24"] && v["2026-07-31"] && v["2026-07-24"].s - v["2026-07-31"].s >= 10) { csvCount++; csvHit[g] = { a: v["2026-07-24"].s, b: v["2026-07-31"].s, d: v["2026-07-24"].s - v["2026-07-31"].s, conf: v["2026-07-31"].conf, id0: v["2026-07-24"].id, id1: v["2026-07-31"].id }; }
let fails = 0; const K = (n, c, x = "") => { console.log((c ? "PASS " : "FAIL ") + n, String(x).slice(0, 190)); if (!c) fails++; };
(async () => {
 for (let i = 0; i < 100; i++) { if ((await U("/healthz")).st === 200) break; await new Promise(r => setTimeout(r, 250)); }
 const F = (await U("/api/auth/login", { post: 1, body: { username: "safety_admin", password: kv.ADMIN_PW } })).sc;
 const D = (await U("/api/auth/login", { post: 1, body: { username: "driver_demo", password: kv.DRIVER_PW } })).sc;
 const a0 = { al: (await U("/api/data/admin.alerts?limit=1", { ck: F })).j.total, tk: (await U("/api/data/admin.trainings?limit=1", { ck: F })).j.total };
 const r1 = await U("/api/rm/drop7", { ck: F });
 K("接口基本态 ok：pair=[2026-07-24,2026-07-31] 阈值10(ops_v1)", r1.st === 200 && r1.j.data_status === "ok" && r1.j.date_pair[0] === "2026-07-24" && r1.j.date_pair[1] === "2026-07-31" && r1.j.threshold === 10 && r1.j.threshold_version === "ops_v1", JSON.stringify({ pair: r1.j.date_pair, thr: r1.j.threshold, ver: r1.j.threshold_version }));
 K("命中数=CSV 冻结基准 32（若异列出差异）", r1.j.drop_count === csvCount && csvCount === 32, `api=${r1.j.drop_count} csv=${csvCount}`);
 const byGps = Object.fromEntries((r1.j.rows || []).map(x => [x.gpsno, x]));
 K("命中集合与 CSV 完全一致", Object.keys(csvHit).every((g) => byGps[g]) && Object.keys(byGps).length === Object.keys(csvHit).length, "diff=" + JSON.stringify(Object.keys(csvHit).filter((g) => !byGps[g]).concat(Object.keys(byGps).filter((g) => !csvHit[g]))).slice(0, 100));
 const samp = ["95201298", "95201323", "95200904"].map((g) => ({ g, api: byGps[g], csv: csvHit[g] }));
 K("3 命中车逐值对账（两日分/Δ/score_id/可信度）", samp.every(x => x.api && Math.abs(x.api.drop - x.csv.d) < 0.001 && x.api.early_score_id === x.csv.id0 && x.api.late_score_id === x.csv.id1 && String(x.api.confidence) === String(x.csv.conf) && x.api.threshold === 10 && x.api.threshold_version === "ops_v1"),
   JSON.stringify(samp.map(x => [x.g, x.api?.early_score, x.api?.late_score, x.api?.drop, x.api?.confidence, x.api?.owner, x.api?.base_tags])));
 K("2 未命中车确不在 rows（8.16/8.74 <10 且不记为不可比）", !byGps["95302803"] && !byGps["95305079"] && !(r1.j.not_comparable || []).some(x => ["95302803", "95305079"].includes(x.gpsno)), "nc=" + r1.j.not_comparable_count);
 K("低可信命中行 next_step 含先设备或数据核验话术（若现网无低可信命中则视为 N/A 通过）", !(r1.j.rows || []).some(x => x.confidence === "low") || (r1.j.rows || []).filter(x => x.confidence === "low").every(x => x.next_step.includes("核验")), "low_rows=" + (r1.j.rows || []).filter(x => x.confidence === "low").length);
 K("基标签保留：命中行含原 priority/behavior/routine 等队列标签", (r1.j.rows || []).every(x => Array.isArray(x.base_tags) && x.base_tags.length >= 1), "tags样本=" + JSON.stringify((r1.j.rows || []).slice(0, 3).map(x => x.base_tags)));
 K("route 指向 EV03（ev-fleet?gpsno）", (r1.j.rows || []).every(x => x.route.startsWith("#/ev-fleet?gpsno=")));
 // 篡改参数
 const r2 = await U("/api/rm/drop7?fleet_id=FLEET_INJECT&driver_id=DEMO_D0289&as_of=2020-01-01", { ck: F } );
 K("端点不读 URL 参数：注入 fleet_id/driver_id/as_of 后响应不变", JSON.stringify(r2.j.rows) === JSON.stringify(r1.j.rows) && r2.j.drop_count === r1.j.drop_count);
 // 权限：driver 403
 K("司机会话 → 403", (await U("/api/rm/drop7", { ck: D })).st === 403);
 // scoped 会话（真实创建，测后停用）
 const un = "r22_sc_" + (Date.now() % 100000);
 const cr = await U("/api/admin/users", { post: 1, ck: F, body: { username: un, role: "safety_admin", display_name: "R22 scoped 对账", reveal_password: true } });
 await U(`/api/admin/users/${cr.j.user_id}`, { patch: 1, ck: F, body: { fleet_scope: "DEMO_FLEET" } });
 const SC = (await U("/api/auth/login", { post: 1, body: { username: un, password: cr.j.initial_password } })).sc;
 const r3 = await U("/api/rm/drop7", { ck: SC });
 console.log("R3_RAW st", r3.st, "drop", r3.j.drop_count, "r1drop", r1.j.drop_count, "note", JSON.stringify(r3.j.scope_note), "gen", JSON.stringify(r3.j.generated));
 K("scoped(DEMO_FLEET) 结果=全范围（同车队）且带 scope_note", r3.j.drop_count === r1.j.drop_count && String(r3.j.scope_note || "").includes("fleet_scope"), "");
 const r4 = await U("/api/rm/drop7?fleet_id=OTHER", { ck: SC });
 K("scoped 借参数仍不生效（与无参一致）", JSON.stringify(r4.j.rows) === JSON.stringify(r3.j.rows));
 // 详情越权通道：review_queue/score 直查他队=0（现网均本队，用不存在的队标记值→空）
 const q1 = await U("/api/data/admin.review_queue?limit=200&gpsno=99999999", { ck: SC });
 K("直接接口伪造 gpsno → 0 行（不泄漏）", q1.st === 200 && q1.j.total === 0);
 // 不自动生成任何记录
 const a1 = { al: (await U("/api/data/admin.alerts?limit=1", { ck: F })).j.total, tk: (await U("/api/data/admin.trainings?limit=1", { ck: F })).j.total };
 K("分组查询零写入：alerts/training_tasks 前后一致", JSON.stringify(a0) === JSON.stringify(a1), JSON.stringify({ a0, a1 }));
 await U(`/api/admin/users/${cr.j.user_id}/status`, { post: 1, ck: F, body: { account_status: "disabled" } });
 console.log("SE", /TypeError|ReferenceError/.test(serr) ? serr.slice(0, 200) : "srv_clean");
 console.log("SAMP " + JSON.stringify(samp.map(x => ({ g: x.g, e: [x.api?.early_date, x.api?.early_score], l: [x.api?.late_date, x.api?.late_score], drop: x.api?.drop, thr: x.api?.threshold + "/" + x.api?.threshold_version, ids: [x.api?.early_score_id, x.api?.late_score_id], conf: x.api?.confidence, owner: x.api?.owner }))));
 console.log(fails ? `R22_${fails}_FAILED` : "R22_OK  hits=" + r1.j.drop_count + " nc=" + r1.j.not_comparable_count + " comparable=" + r1.j.comparable);
 child.kill("SIGTERM"); setTimeout(() => process.exit(fails ? 1 : 0), 250);
})();
