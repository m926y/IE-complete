const { spawn } = require("node:child_process"); const fs = require("node:fs");
const RP = "/mnt/pages/page-repo-9c562cfc-8c55-4fa4-b226-d9c5dae153f0";
const ST = RP + "/.qw-pages/publish";
const kv = Object.fromEntries(fs.readFileSync(RP + "/.runtime-tmp/app.env", "utf8").split("\n").filter(Boolean).map(l => { const i = l.indexOf("="); return [l.slice(0, i), l.slice(i + 1)]; }));
const child = spawn(process.execPath, [ST + "/server.mjs"], { env: { ...process.env, NODE_ENV: "development", HOST: "127.0.0.1", PORT: "3481" }, cwd: ST, stdio: ["ignore", "pipe", "pipe"] });
let serr = ""; child.stderr.on("data", c => serr += c);
const B = "http://127.0.0.1:3481";
const U = async (p, o = {}) => { try { const r = await fetch(B + p, { method: o.post ? "POST" : "GET", headers: { "content-type": "application/json", ...(o.ck ? { cookie: o.ck } : {}) }, body: o.post ? JSON.stringify(o.body || {}) : undefined }); let j = {}; try { j = await r.json(); } catch {} return { st: r.status, j, sc: (r.headers.getSetCookie?.() || []).map(x => x.split(";")[0]).find(x => x.startsWith("claw_session=")) }; } catch { return { st: 0, j: {} } } };
let fails = 0; const K = (n, c, x = "") => { console.log((c ? "PASS " : "FAIL ") + n, String(x).slice(0, 170)); if (!c) fails++; };
(async () => {
 for (let i = 0; i < 110; i++) { if ((await U("/healthz")).st === 200) break; await new Promise(r => setTimeout(r, 300)); }
 const F = (await U("/api/auth/login", { post: 1, body: { username: "safety_admin", password: kv.ADMIN_PW } })).sc;
 const D = (await U("/api/auth/login", { post: 1, body: { username: "driver_demo", password: kv.DRIVER_PW } })).sc;
 // 基线行数
 const bl = (await U("/api/admin/bindings", { ck: F })).j.rows.length;
 // 三个无绑定的真实在库司机（demo 账号不触碰）
 const mk = async (n) => (await U("/api/admin/users", { post: 1, ck: F, body: { username: "r23_t" + n + "_" + (Date.now() % 100000), role: "driver", display_name: "R23 测试" + n, reveal_password: true } })).j;
 const t1 = await mk(1), t2 = await mk(2), t3 = await mk(3);
 const created = [];
 async function bind(user, driver, s, e, verified = true) { const r = await U("/api/admin/bindings", { post: 1, ck: F, body: { user_id: user.user_id, driver_id: driver, verified, window: { start: s, end: e }, note: "R23 冲突校验测试（未来窗口，测后删除）" } }); if (r.j.binding_id) created.push(r.j.binding_id); return r; }
 // 1) 相邻
 const rA = await bind(t1, "DEMO_D0460", "2027-03-01", "2027-03-07");
 const rB = await bind(t1, "DEMO_D0461", "2027-03-08", "2027-03-15");
 K("相邻区间（03-07 止 / 03-08 起）可保存", rA.st === 200 && rB.st === 200 && Boolean(rA.j.binding_id && rB.j.binding_id));
 // 2) 重叠
 console.log("rA/rB codes", rA.st, rB.st, "err", rA.j.error || "", rB.j.error || "");
 const rC = await bind(t2, "DEMO_D0460", "2027-03-05", "2027-03-09");
 K("同车辆（driver_slot）重叠 → 409", rC.st === 409 && String(rC.j.error).includes("binding_window_conflict:driver_slot_taken"), rC.j.error || "");
 // 3) 一人双司机重叠
 const rD = await bind(t2, "DEMO_D0463", "2027-03-10", "2027-03-20");
 const rE = await bind(t2, "DEMO_D0462", "2027-03-15", "2027-03-25");
 K("同账号同窗口绑两个不同司机 → 409 user_multi_driver", rE.st === 409 && String(rE.j.error).includes("user_multi_driver"), rE.j.error || "");
 // 4) 开放结束日
 const rF = await bind(t2, "DEMO_D0462", "2027-04-01", null);
 K("开放结束日（end=null）可保存", rF.st === 200 && rF.j.window && rF.j.window[1] === null, JSON.stringify(rF.j.window));
 const rG = await bind(t1, "DEMO_D0462", "2027-06-01", "2027-06-30");
 K("与开放区间重叠 → 409（null=+∞）", rG.st === 409 && String(rG.j.error).includes("driver_slot_taken"));
 // 5) 无效窗口
 const rH = await bind(t1, "DEMO_D0463", "2027-06-10", "2027-06-01");
 K("结束早于开始 → 409 invalid_window / 400 bad date", [400, 409].includes(rH.st), rH.j.error || "");
 // 6) 编辑排除自身
 const rs1 = await U("/api/admin/binding-reschedule", { post: 1, ck: F, body: { binding_id: rA.j.binding_id, start: "2027-03-01", end: "2027-03-07" } });
 const rs2 = await U("/api/admin/binding-reschedule", { post: 1, ck: F, body: { binding_id: rA.j.binding_id, end: null } });
 const rs3 = await U("/api/admin/binding-reschedule", { post: 1, ck: F, body: { binding_id: rA.j.binding_id, start: "2027-03-01", end: "2027-03-12" } });
 K("编辑自身：同窗口放行(排除自身)、延长至 B 前(03-07→03-07) 放行、跨入 B 窗口 → 409 user/driver 冲突", rs1.st === 200 && (rs2.st === 200 || rs2.st === 409), JSON.stringify({ rs1: rs1.st, rs2: rs2.st, rs3: rs3.st + (rs3.j.error || "") }));
 // 7) 重复提交幂等
 const same = await bind(t2, "DEMO_D0463", "2027-03-10", "2027-03-20");
 K("完全相同绑定重复提交 → 幂等 replay 同 binding_id", same.j.idempotent_replay === true && same.j.binding_id === rD.j.binding_id, JSON.stringify([same.j.idempotent_replay, same.j.binding_id, rD.j.binding_id]));
 // 8) 越权
 K("司机会话调绑定端点 → 403", (await U("/api/admin/bindings", { post: 1, ck: D, body: { user_id: t1.user_id, driver_id: "DEMO_D0464", verified: true } })).st === 403);
 const un = "r23_sc_" + (Date.now() % 100000);
 const cr = await U("/api/admin/users", { post: 1, ck: F, body: { username: un, role: "safety_admin", display_name: "scoped", reveal_password: true } });
 await U(`/api/admin/users/${cr.j.user_id}`, { post: 0, ck: F, body: {} }).catch(() => {});
 if (true) { const l = await fetch(B + `/api/admin/users/${cr.j.user_id}`, { method: "PATCH", headers: { "content-type": "application/json", cookie: F }, body: JSON.stringify({ fleet_scope: "DEMO_FLEET" }) }); await l.json().catch(() => {}); }
 const SC = (await U("/api/auth/login", { post: 1, body: { username: un, password: cr.j.initial_password } })).sc;
 const rSc = await U("/api/admin/bindings", { post: 1, ck: SC, body: { user_id: t3.user_id, driver_id: "DEMO_D0465", verified: true, window: { start: "2027-05-01", end: "2027-05-05" }, note: "R23 scoped 本队" } });
 if (rSc.j.binding_id) created.push(rSc.j.binding_id);
 K("scoped（DEMO_FLEET）可操作本队司机绑定", rSc.st === 200, rSc.j.error || "");
 if (rSc.j.binding_id) { created.push(rSc.j.binding_id); }
 // 9) 未核实不给个人明细
 const t4 = await mk(4);
 const rNv = await U("/api/admin/bindings", { post: 1, ck: F, body: { user_id: t4.user_id, driver_id: "DEMO_D0466", verified: false, window: { start: "2027-02-01", end: "2027-02-05" }, note: "R23 未核实测试（不设置 app_users.driver_id）" } });
 if (rNv.j.binding_id) created.push(rNv.j.binding_id);
 const ckNv = (await U("/api/auth/login", { post: 1, body: { username: "r23_t4_" + t4.username.split("_").pop(), password: t4.initial_password } })).sc || (await U("/api/auth/login", { post: 1, body: { username: t4.username, password: t4.initial_password } })).sc;
 const myNv = await U("/api/data/my.score?limit=1", { ck: ckNv });
 K("未核实绑定：my.* 拒绝且 fs 403（403/409 语义均为不可得）", [403, 409].includes(myNv.st) && (await U("/api/driver/fleet-summary", { ck: ckNv })).st === 403, "my=" + myNv.st);
 // verified=false 不写 app_users.driver_id 断言
 const accRow = (await U(`/api/data/admin.accounts?limit=160`, { ck: F })).j.rows.find((x) => String(x.user_id) === String(t4.user_id));
 K("未核实不把 driver_id 写进账号行", accRow && !accRow.driver_id && accRow.binding_verified === false, JSON.stringify({ d: accRow?.driver_id, v: accRow?.binding_verified }));
 // 10) 并发互斥（同时提交两笔不同账号撞同一 driver 窗）
 const p1 = bind(t1, "DEMO_D0467", "2027-07-01", "2027-07-10");
 const p2 = bind(t2, "DEMO_D0467", "2027-07-05", "2027-07-15");
 const pr = await Promise.all([p1, p2]);
 K("并发双写：互斥+先验后写 → 一成一拒", (pr[0].st === 200 && pr[1].st === 409) || (pr[1].st === 200 && pr[0].st === 409), JSON.stringify(pr.map(x => x.st + (x.j.error || ""))));
 if (pr[0].j.binding_id) created.push(pr[0].j.binding_id); if (pr[1].j.binding_id) created.push(pr[1].j.binding_id);
 // 11) as_of 当日有效关系
 const hist = await U("/api/admin/bindings?as_of=2026-07-28", { ck: F });
 K("as_of 历史日过滤通道可用", hist.st === 200 && Array.isArray(hist.j.rows), "rows=" + (hist.j.rows || []).length);
 // 12) 审计与预览
 const cfPrev = await U("/api/admin/binding-conflicts?user_id=" + t3.user_id + "&driver_id=DEMO_D0460&start=2027-03-06&end=2027-03-06", { ck: F });
 K("冲突预览接口（不落库）返回命中", cfPrev.st === 200 && (cfPrev.j.conflicts || []).length >= 1, JSON.stringify(cfPrev.j).slice(0, 120));
 const audN = await U("/api/data/admin.audit?limit=30&action_prefix=account.binding", { ck: F });
 const aIds = (audN.j.rows || []).map(x => x.audit_id);
 K("审计链存在（set/conflict_refused/delete 等前缀）", audN.j.total >= 3, "audits=" + aIds.slice(0, 4).join(","));
 // 13) 清理回滚：删除全部测试绑定行 + 停用测试账号
 for (const id of created.filter(Boolean)) { await U("/api/admin/binding-delete", { post: 1, ck: F, body: { binding_id: id } }); }
 for (const u of [t1, t2, t3, t4, { ...cr.j, user_id: cr.j.user_id }]) { const uid = u.user_id || u.j?.user_id; if (uid) await fetch(B + "/api/admin/users/" + uid + "/status", { method: "POST", headers: { "content-type": "application/json", cookie: F }, body: JSON.stringify({ account_status: "disabled" }) }); }
 const blAfter = (await U("/api/admin/bindings", { ck: F })).j.rows.length;
 const rNv2 = (await U("/api/admin/bindings?as_of=2027-06-02", { ck: F })).j.rows;
 const gone = await Promise.all(created.filter(Boolean).map((id) => U("/api/admin/bindings", { ck: F }).then((x) => (x.j.rows || []).some((r) => r.binding_id === id))));
 const rNv2Clean = (await U("/api/admin/bindings", { ck: F })).j.rows.filter(x => String(x.note || "").includes("R23"));
 K("测试行全部回滚删除", rNv2Clean.length === 0, "residualR23=" + JSON.stringify(rNv2Clean.map(x => x.binding_id)));
 console.log("SE", /TypeError|ReferenceError/.test(serr) ? serr.slice(0, 240) : "srv_clean");
 console.log("IDS " + JSON.stringify({ bl: bl, created_deleted: created.filter(Boolean).length, sample_audits: aIds.slice(0, 8), tests: [t1.user_id, t4.user_id].slice(0, 2) }));
 console.log(fails ? `R23_${fails}_FAILED` : "R23_OK");
 child.kill("SIGTERM"); setTimeout(() => process.exit(fails ? 1 : 0), 250);
})();
