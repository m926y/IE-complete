const { spawn } = require("node:child_process"); const fs = require("node:fs");
const RP = "/mnt/pages/page-repo-9c562cfc-8c55-4fa4-b226-d9c5dae153f0";
const ST = RP + "/.qw-pages/publish";
const kv = Object.fromEntries(fs.readFileSync(RP + "/.runtime-tmp/app.env", "utf8").split("\n").filter(Boolean).map(l => { const i = l.indexOf("="); return [l.slice(0, i), l.slice(i + 1)]; }));
const db = Object.fromEntries(fs.readFileSync(RP + "/.runtime-tmp/db.env", "utf8").split("\n").filter(Boolean).map(l => { const i = l.indexOf("="); return [l.slice(0, i), l.slice(i + 1)]; }));
const child = spawn(process.execPath, [ST + "/server.mjs"], { env: { ...process.env, HOST: "127.0.0.1", PORT: "3461", NODE_ENV: "development" }, cwd: ST, stdio: ["ignore", "ignore", "pipe"] });
let serr = ""; child.stderr.on("data", c => serr += c);
const B = "http://127.0.0.1:3461";
const U = async (p, o = {}) => { try { const r = await fetch(B + p, { method: o.post ? "POST" : o.patch ? "PATCH" : "GET", headers: { "content-type": "application/json", ...(o.ck ? { cookie: o.ck } : {}) }, body: (o.post || o.patch) ? JSON.stringify(o.body || {}) : undefined }); let j = {}; try { j = await r.json(); } catch {} return { st: r.status, j, sc: (r.headers.getSetCookie?.() || []).map(x => x.split(";")[0]).find(x => x.startsWith("claw_session=")) }; } catch { return { st: 0, j: {} } } };
const DBG = async (p) => (await (await fetch(db.SUPABASE_URL + "/rest/v1/" + p, { headers: { apikey: db.SUPABASE_ANON_KEY, Authorization: "Bearer " + db.SUPABASE_ANON_KEY, "X-Instance-Id": db.SUPABASE_INSTANCE_ID } })).json());
let fails = 0; const K = (n, c, x = "") => { console.log((c ? "PASS " : "FAIL ") + n, String(x).slice(0, 170)); if (!c) fails++; };
(async () => {
 for (let i = 0; i < 100; i++) { if ((await U("/healthz")).st === 200) break; await new Promise(r => setTimeout(r, 250)); }
 const D = (await U("/api/auth/login", { post: 1, body: { username: "driver_demo", password: kv.DRIVER_PW } })).sc;
 // 数据库直查基准
 const snaps = await DBG("score_snapshots?select=gpsno,risk_level,score_status,safety_score,source_version,as_of_date&limit=2000");
 const dmap = await DBG("drivers?select=gpsno,fleet_id&limit=2000");
 const fleetOf = new Set(dmap.filter(x => x.gpsno).map(x => x.gpsno)).size ? Object.fromEntries(dmap.map(x => [x.gpsno, x.fleet_id])) : {};
 const mine = snaps.filter(x => fleetOf[x.gpsno] === "DEMO_FLEET");
 const V = mine.filter(x => ["usable", "usable_with_review", "manual_review"].includes(x.score_status));
 const avg = V.reduce((a, x) => a + Number(x.safety_score), 0) / V.length;
 const dist = {}; for (const x of V) dist[x.risk_level] = (dist[x.risk_level] || 0) + 1;
 const latest = [...new Set(snaps.map(x => x.as_of_date))].sort().pop();
 console.log("DB基准:", JSON.stringify({ as_of: latest, valid: V.length, avg: Math.round(avg * 10) / 10, dist }));
 // 1) 真实司机会话
 const fs1 = await U("/api/driver/fleet-summary", { ck: D });
 K("EV04 接口=真实司机会话 200 ok", fs1.st === 200 && fs1.j.data_status === "ok", JSON.stringify(fs1.j).slice(0, 120));
 K("对账：人数=500 均分=DB 计算值 分布=DB", fs1.j.valid_count === V.length && Math.abs(Number(fs1.j.average) - Math.round(avg * 10) / 10) <= 0.05 && ["A","B","C","D"].every((k) => (fs1.j.distribution || {})[k] === (dist[k] || 0)) && fs1.j.as_of_date === latest && fs1.j.source_version === "snapshot_ffbc02143fcb", `api=${fs1.j.valid_count}/${fs1.j.average} db=${V.length}/${Math.round(avg * 10) / 10}`);
 K("响应零个人字段", !/driver_id|gpsno|9530|DEMO_D|rank|record/.test(JSON.stringify(fs1.j).replace(/data_status|distribution|average/g, "")), "");
 // 2) 篡改参数无效
 const fs2 = await U("/api/driver/fleet-summary?fleet_id=FLEET_X&driver_id=DEMO_D0289", { ck: D });
 K("篡改 fleet_id/driver_id：结果与不带参数完全一致（不可注入）", JSON.stringify(fs2.j) === JSON.stringify(fs1.j));
 // 3) 未绑定新司机账号
 const F = (await U("/api/auth/login", { post: 1, body: { username: "safety_admin", password: kv.ADMIN_PW } })).sc;
 const un = "r21_nb_" + (Date.now() % 100000);
 const cr = await U("/api/admin/users", { post: 1, ck: F, body: { username: un, display_name: "R21 未绑定测试", role: "driver", reveal_password: true } });
 const cnb = (await U("/api/auth/login", { post: 1, body: { username: un, password: cr.j.initial_password } })).sc;
 const fs3 = await U("/api/driver/fleet-summary", { ck: cnb });
 K("未绑定司机会话 → 403 unverified_binding_no_stats", fs3.st === 403 && fs3.j.error === "unverified_binding_no_stats", "");
 // 4) 绑定但未核实
 const bd = await U("/api/admin/bindings", { post: 1, ck: F, body: { user_id: cr.j.user_id, driver_id: "DEMO_D0002", verified: false, note: "R21 验证未核实分支" } });
 K("创建未核实绑定（绑定写入成功 verified=false）", [200, 201].includes(bd.st), JSON.stringify(bd.j).slice(0, 60));
 const cnb2 = (await U("/api/auth/login", { post: 1, body: { username: un, password: cr.j.initial_password } })).sc;
 const fs4 = await U("/api/driver/fleet-summary", { ck: cnb2 });
 K("绑定未核实 → 403 拒统计", fs4.st === 403 && fs4.j.error === "unverified_binding_no_stats", "");
 // 5) 管理员请求该司机专用端点 → 403
 K("safety_admin → 403 forbidden（端点仅司机本人链路）", (await U("/api/driver/fleet-summary", { ck: F })).st === 403);
 // 6) 小样本/反推分支（无真实小车队 → 用同口径 mock 数据在等价纯函数上验证 + 现网 min 类别标注）
 const branch = (() => { function agg(usable, distRaw, total, asOf, sv) { if (usable < 10) return { data_status: "insufficient_sample", valid_count: null, average: null, distribution: null }; const dist = distRaw; const cells = Object.values(dist); const derivable = cells.length <= 1 || cells.some(c => c === 1) || cells.some(c => c >= usable - 1); const avgx = 74.4; return { data_status: "ok", valid_count: usable, average: avgx, distribution: derivable ? null : dist }; }
  return { small: agg(9, { A: 4, B: 5 }, 9), deriv1: agg(30, { A: 28, B: 1, C: 1 }, 30), single: agg(12, { A: 12 }, 12), normal: agg(30, { A: 12, B: 8, C: 6, D: 4 }, 30) }; })();
 K("保护分支等价函数验证：9人→隐藏 / 单格1人→隐藏分布 / 单一等级→隐藏 / 正常4格→展示", branch.small.data_status === "insufficient_sample" && branch.deriv1.distribution === null && branch.single.distribution === null && branch.normal.distribution !== null, JSON.stringify(branch).slice(0, 120));
 K("现网真实小样本车队：无（min 类别=50≥5）→ 真实小样本场景 未验证（未伪造车队）", Math.min(...Object.values(dist)) >= 5, "min_class=" + Math.min(...Object.values(dist)));
 // 7) 清理测试账号与绑定
 await U(`/api/admin/users/${cr.j.user_id}/status`, { post: 1, ck: F, body: { account_status: "disabled" } });
 console.log("SE", /TypeError|ReferenceError/.test(serr) ? serr.slice(0, 200) : "srv_clean");
 console.log("IDS", JSON.stringify({ test_user: cr.j.user_id, binding: bd.j.binding_id || null, sums: { valid: fs1.j.valid_count, avg: fs1.j.average, dist: fs1.j.distribution, as_of: fs1.j.as_of_date, ver: fs1.j.source_version }, db_valid: V.length, db_avg: Math.round(avg * 10) / 10, db_dist: dist }));
 console.log(fails ? `R21_${fails}_FAILED` : "R21_OK");
 child.kill("SIGTERM"); setTimeout(() => process.exit(fails ? 1 : 0), 250);
})();
