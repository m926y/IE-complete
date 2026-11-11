// 第3轮 pilot 导入驱动：①全量文件预检（留证，不提交）②从全量文件抽取3对象pilot行
// ③预检→管理员确认写入→计数/record_id回查→整批重复执行验证UPSERT不增长。
// 目标对象：DEMO_D0149(高可信D级演示锚点)、DEMO_D0289(低可信)、DEMO_D0013(A级但低覆盖，教育案例)
import { readFileSync } from "node:fs";
const BASE = process.env.BASE || "http://127.0.0.1:3000";
const UP = (p) => readFileSync("/workspace/5d12ecfd-e7d8-46d4-b63a-4dbb09c2226d/work/uploads/" + p, "utf8");
const PILOT_DRIVERS = ["DEMO_D0149", "DEMO_D0289", "DEMO_D0013"];

function parseCsvRows(text) {
  const src = text.charCodeAt(0) === 0xfeff ? text.slice(1) : text;
  const rows = []; let field = "", row = [], q = false;
  for (let i = 0; i < src.length; i++) { const c = src[i];
    if (q) { if (c === '"') { if (src[i + 1] === '"') { field += '"'; i++; } else q = false; } else field += c; }
    else if (c === '"') q = true; else if (c === ",") { row.push(field); field = ""; }
    else if (c === "\n") { row.push(field); field = ""; rows.push(row); row = []; } else if (c !== "\r") field += c; }
  if (field || row.length) { row.push(field); rows.push(row); }
  const fixed = rows.filter((r) => r.some((x) => x.trim() !== ""));
  if (fixed[0]) fixed[0] = fixed[0].map((x) => x.replace(/^\ufeff/, "").trim());
  return fixed;
}
const toCsv = (rows) => rows.map((r) => r.map((c) => /[",\n]/.test(c) ? `"${c.replace(/"/g, '""')}"` : c).join(",")).join("\n") + "\n";

async function req(path, { method = "GET", body, cookie } = {}) {
  const res = await fetch(BASE + path, { method, headers: { "content-type": "application/json", ...(cookie ? { cookie } : {}) }, body: body ? JSON.stringify(body) : undefined });
  let json = null; try { json = await res.json(); } catch {}
  return { status: res.status, json, setCookie: res.headers.getSetCookie?.() || [] };
}
const out = (label, obj) => console.log(`\n### ${label}\n` + JSON.stringify(obj, null, 1));

const login = await req("/api/auth/login", { method: "POST", body: { username: "safety_admin", password: process.env.ADMIN_PW } });
if (login.status !== 200) { console.error("管理员登录失败", login.status); process.exit(1); }
const C = `claw_session=${(login.setCookie.join("|").match(/claw_session=([0-9a-f]{64})/) || [])[1]}`;
const RUN_TAG = process.env.RUN_TAG || "v1";

// ① 全量文件预检（不提交）
for (const [table, file] of [["drivers", "drivers.csv"], ["risk_snapshots", "risk_snapshots.csv"], ["score_snapshots", "score_snapshots.csv"]]) {
  const csv = UP(file);
  const r = await req("/api/import/check", { method: "POST", cookie: C, body: { table, filename: `FULL_${file}_确认前不提交`, csv, source_version: "snapshot_ffbc02143fcb" } });
  out(`全量预检 ${table}（不提交）`, { status: r.status, ...((x) => ({ ok: x.ok, row_total: x.row_total, accepted: x.accepted_row_estimate, rejected: x.rejected_count, dup_pk: x.dup_pk_count, type_errors: (x.type_errors || []).length, unknown_columns: x.unknown_columns, missing_contract_columns: (x.missing_contract_columns || []).length, run_id: x.run_id }))(r.json) });
}

// ② 抽取3对象 pilot 行（真实原行，不改动任何值）
const drv = parseCsvRows(UP("drivers.csv")); const sc = parseCsvRows(UP("score_snapshots.csv")); const rk = parseCsvRows(UP("risk_snapshots.csv"));
const pick = (rows, key, vals) => [rows[0], ...rows.slice(1).filter((r) => vals.includes(r[rows[0].indexOf(key)]))];
const dPilot = pick(drv, "driver_id", PILOT_DRIVERS);
const gpsnos = dPilot.slice(1).map((r) => r[drv[0].indexOf("gpsno")]);
const sPilot = pick(sc, "driver_id", PILOT_DRIVERS);
const rPilot = pick(rk, "gpsno", gpsnos);
out("pilot 抽取", { drivers: dPilot.length - 1, score_snapshots: sPilot.length - 1, risk_snapshots: rPilot.length - 1, gpsnos });

// ③ 预检 → 提交
const jobs = [["drivers", toCsv(dPilot)], ["score_snapshots", toCsv(sPilot)], ["risk_snapshots", toCsv(rPilot)]];
for (const [table, csv] of jobs) {
  const chk = await req("/api/import/check", { method: "POST", cookie: C, body: { table, filename: `pilot3_${table}_${RUN_TAG}.csv`, csv, source_version: "snapshot_ffbc02143fcb" } });
  out(`预检(pilot) ${table}`, { ok: chk.json?.ok, row_total: chk.json?.row_total, accepted: chk.json?.accepted_row_estimate, rejected: chk.json?.rejected_count, dup_pk_count: chk.json?.dup_pk_count, unknown_columns: chk.json?.unknown_columns, missing_contract_columns: chk.json?.missing_contract_columns, run_id: chk.json?.run_id, audit_id: chk.json?.audit_id });
  if (!chk.json?.ok || !chk.json?.run_id) { console.error("预检未通过，放弃提交", table); continue; }
  const cm = await req("/api/import/commit", { method: "POST", cookie: C, body: { run_id: chk.json.run_id, csv } });
  out(`确认写入 ${table}`, { status: cm.status, ...cm.json });
}

// ④ 回查数据库端真实行数与 record_id
for (const [r, params] of [["admin.drivers", {}], ["admin.score_snapshots", {}], ["admin.risk_snapshots", {}]]) {
  const res = await req(`/api/data/${r}?limit=50`, { cookie: C });
  out(`回查 ${r}`, { total: res.json?.total, ids: (res.json?.rows || []).map((x) => x.driver_id || x.score_id || x.snapshot_id) });
}
