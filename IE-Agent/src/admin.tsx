import {CustomLearning} from './custom-learning';
import {parseEditable} from './course-editor';
import {BrandMark} from './brand';
import {CourseGroups} from './course-groups';
import {api,coursesBoard} from './api';
import {systemCell,systemLabel} from './system-values';
import './system-ui.css';
import {TrainingSurface,TrainingTable,trainingStatus,useTrainingNames} from './training-ui';
import {RiskQueueChart} from './risk-queue-chart';
import {eventName} from './event-names';
import {AdminDriverReports} from './admin-driver-reports';
import {TrainingNotificationRecovery} from './training-recovery';
import {TrainingLedger} from './training-ledger';
import {DriverAccountsPage} from './driver-accounts';
import {HandoverPage} from './handover';
import {ModelGovernance} from "./model-governance";
import {ModelRulesEditor} from './model-rules';
import {PersonalRecord} from './personal-lesson';
import {OfflineTrainingPage} from './offline-training';
import {ActionCenter} from './action-center';
import {EvaluationActionPage} from './evaluation-actions';
import { FleetScoreTrend } from "./overview-controls";
import { VehicleScoreTrend } from './score-trend';
import {MessageButton} from './messaging';
import { TrainingLibraryPanel, QuizScoreSummary, AdminQuizReview, isInteractiveCourse } from "./training";
import {RiskAlertBar,RiskMonitorPage} from './risk-monitor';
import { AgentAccountImportPanel } from './agent-tools';
import { WeightEditor } from "./weights";
import { DataCenter, FullReplay } from "./data";
import { AccountProfile, Avatar } from "./account";
import { vehicleLabel, vehicleId, vehicleOptions, displayText } from "./vehicles";
import { useEffect, useMemo, useRef, useState } from "react";
import type { MeUser, ImportCheckReport, ImportCommitReport } from "./api";
import {ApiError, alertConfirm, alertContact, alertHandoff, alertNote, alertStatus, caseView, courseReview, createUser, egressProbe, getData, getHistoryDates, importCheck, importCommit, interventionDraft, interventionEdit, interventionSend, myNotes, noteRead, notesSummary, opsConfigUpdate, rrAdvance, rrView, setBinding, setUserStatus, taskReview, taskView, trainingAssign, taskSummary, TaskSummary, aiEvidenceCheck} from "./api";
import type { RRView } from "./api";
import type { CaseView as CaseViewT } from "./api";
import { Banner, cellView, EmptyState, ResourceTable, Tag, GlobalSearch } from "./ui";
import { SmDraftsPage, SmKnowledgePage } from "./sm17";
import { AccountAdminPanel } from "./sm18";
import { BindingsConsole } from "./sm23";

import { TemplatesTab, TemplateScenePicker } from "./sm27";
import { AuditConsole, CourseBoard } from "./sm19";
import { Dashboard } from "./dashboard";
import { RootCausesPage, MandatePolicyCard } from "./r37";

const IMPORTABLE_TABLES = [
  "drivers", "risk_snapshots", "score_snapshots", "review_queue", "score_history", "deduction_ledger",
  "replay_events", "evaluation_rules", "training_courses", "operation_config", "user_bindings",
  "alerts", "interventions", "training_tasks", "review_requests", "knowledge_articles",
  "evaluation_rule_drafts", "notification_events",
];

function ImportPanel({ onCommitted }: { onCommitted: () => void }) {
  const [table, setTable] = useState("drivers");
  const [file, setFile] = useState<{ name: string; csv: string } | null>(null);
  const [sv, setSv] = useState("snapshot_ffbc02143fcb");
  const [report, setReport] = useState<ImportCheckReport | null>(null);
  const [commit, setCommit] = useState<ImportCommitReport | null>(null);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [note, setNote] = useState<string | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);
  const canCommit = Boolean(report?.ok && report.run_id && !commit);
  async function pick(f: File | undefined) {
    setErr(null); setReport(null); setCommit(null); setNote(null);
    if (!f) { setFile(null); return; }
    if (f.size > 4 * 1024 * 1024) { setErr("文件超过 4MB 上限，请拆分后再导入"); return; }
    const csv = await f.text();
    setFile({ name: f.name, csv });
  }
  async function check() {
    if (!file) { setErr("先选择 CSV 文件"); return; }
    setBusy(true); setErr(null); setCommit(null);
    try { const r = await importCheck({ table, filename: file.name, csv: file.csv, source_version: sv || undefined }); setReport(r); }
    catch (e) { setErr(e instanceof ApiError ? errText(e.code) : "连接失败，请重试"); }
    setBusy(false);
  }
  async function doCommit() {
    if (!report?.run_id || !file) return;
    setBusy(true); setErr(null);
    try {
      const c = await importCommit({ run_id: report.run_id, csv: file.csv });
      setCommit(c); setReport(null); setFile(null); if (fileRef.current) fileRef.current.value = "";
      onCommitted();
    } catch (e) {
      const code = e instanceof ApiError ? e.code : "network_error";
      if (code === "content_changed_since_check") setErr("文件内容与预检时不一致，已拒绝写入；请重新预检。");
      else if (code === "confirm_window_expired") setErr("确认窗口（30分钟）已过，请重新预检。");
      else if (code === "precheck_not_passed") setErr("该预检未通过或已作废，不能写入。");
      else setErr(errText(code));
    }
    setBusy(false);
  }
  function errText(code: string) {
    if (code === "forbidden") return "当前账号无导入权限（仅安全管理员）。";
    if (code === "unsupported_table") return "该表不在版本化导入白名单（audit_logs 等由系统写入）。";
    if (code === "file_too_large") return "文件超过 4MB 上限。";
    if (code === "bad_json") return "请求格式错误。";
    if (code === "unknown_columns_in_header") return "文件中存在契约外列，提交被服务端二次防线拒绝；请修正表头后重新预检。";
    if (code === "missing_pk_column") return "文件缺少业务主键列，提交被拒绝。";
    return `导入失败：${code}`;
  }
  return <div className="panel">
    <h3>版本化 CSV 导入（仅安全管理员 · 预检 → 确认 → UPSERT）</h3>
    <p className="page-desc">流程：选择业务表与 CSV 文件 → 服务端预检（不落业务数据）→ 管理员确认后按业务主键 UPSERT（重复执行不新增记录）。文本列原样保留；空值不转 0；数值按字符串写入保留原始小数位。浏览器不持有任何数据库凭证。</p>
    <div className="row">
      <select className="btn" value={table} onChange={(e) => { setTable(e.target.value); setReport(null); setCommit(null); }} aria-label="目标表">
        {IMPORTABLE_TABLES.map((x) => <option key={x} value={x}>{x}</option>)}
      </select>
      <label className="btn" htmlFor="csvfile">选择 CSV 文件</label>
      <input id="csvfile" ref={fileRef} type="file" accept=".csv,text/csv" style={{ display: "none" }} onChange={(e) => pick(e.target.files?.[0])} />
      <span className="mono">{file ? `${file.name}（${(file.csv.length / 1024).toFixed(1)}KB 字符）` : "未选择文件"}</span>
      <input className="btn" style={{ width: 240 }} value={sv} onChange={(e) => setSv(e.target.value)} aria-label="source_version" placeholder="source_version（运行级口径）" />
      <button className="btn" onClick={check} disabled={busy || !file}>预检（不写入）</button>
      <button className="btn primary" style={{ width: "auto" }} onClick={doCommit} disabled={busy || !canCommit}>{busy ? "处理中…" : "确认写入"}</button>
    </div>
    {err && <div className="alert danger">{err}</div>}
    {note && <div className="alert ok">{note}</div>}
    {report && !report.ok && <div className="alert danger">预检被拒：{report.fatal}</div>}
    {report?.ok && <div className="alert info">
      预检通过：目标 <b>{report.table}</b> · 文件 <b>{report.filename}</b> · 数据行 <b>{report.row_total}</b> ·
      预计写入 <b>{report.accepted_row_estimate}</b> · 拒绝行 <b>{report.rejected_count}</b> · 文件内重复主键 <b>{report.dup_pk_count}</b> ·
      类型错误 <b>{(report.type_errors || []).length}</b>（明细最多各列 50 条） · run <span className="mono">{report.run_id}</span> · 审计 <span className="mono">{report.audit_id || "—"}</span>
      <br />确认窗口 {report.confirm_window_minutes} 分钟内有效；写入按业务主键 UPSERT，重复执行结果不变。
      {report.unknown_columns?.length ? <><br />未知列：{report.unknown_columns.join(", ")}</> : null}
      {report.missing_contract_columns?.length ? <><br />缺失契约列（该列不更新）：{report.missing_contract_columns.join(", ")}</> : null}
      {(report.dup_pk || []).slice(0, 20).map((d) => <div key={d.key} className="mono">重复主键 {d.key} 行 {d.lines.join("↔")}（后写覆盖先写）</div>)}
      {(report.type_errors || []).slice(0, 20).map((x, i) => <div key={i} className="mono">第 {x.line} 行 {x.field}：{x.reason}「{x.value}」</div>)}
      {(report.rejected_rows || []).slice(0, 20).map((x, i) => <div key={i} className="mono">第 {x.line} 行拒绝：{x.reason}</div>)}
      {(report.warnings || []).slice(0, 10).map((w, i) => <div key={i}>提示：{w}</div>)}
    </div>}
    {commit && <div className="alert ok">
      导入 {commit.result === "committed" ? "完成" : "部分失败（已停止，可查审计）"}：{commit.table} · 提交 {commit.submitted_rows} 行 ·
      UPSERT {commit.upserted} 行 · 最终拒绝 {commit.rejected_final} 行 · 分块 {commit.chunks.filter((c) => c.ok).length}/{commit.chunks.length} ·
      run <span className="mono">{commit.run_id}</span> · 审计 <span className="mono">{commit.audit_id || "—"}</span>
      {commit.idempotent_replay ? " · （重复确认，返回既有结果，未重复写入）" : null}
    </div>}
  </div>;
}

const NAV: { group: string; items: { key: string; label: string; code?: string }[] }[] = [
  { group: "工作台", items: [{ key: "overview", label: "工作台总览" },{key:'handover',label:'AI 交接班'},{key:'daily-reports',label:'司机安全简报'}] },
  { group: "安全评价", items: [
    { key: "ev-fleet", label: "车队总览", code: "EV01" },
    { key: "ev-actions", label: "评价与分层处置" },
    { key: "ev-week", label: "周度分析", code: "EV02" },
    { key: "ev-driver", label: "司机详情", code: "EV03" },
    { key: "ev-review", label: "评价复核/数据异议", code: "EV05" },
    { key: "ev-root", label: "根因分析", code: "EV06" },
  ]},
  { group: "风险监控", items: [
    { key: "rm-queue", label: "风险工作台", code: "RM01" },
    { key: "rm-live", label: "风险回放", code: "RM-LIVE" },
    { key: "rm-alerts", label: "告警与事件档案", code: "RM03/RM05" },
  ]},
  { group: "培训改善", items: [
    { key: "tr-ledger", label: "培训台账", code: "TR01" },
    { key: "tr-courses", label: "课程库与审核", code: "TR05/SM06" },
    { key: "tr-create", label: "创建培训", code: "TR02" },
    { key: "tr-offline", label: "线下培训预约" },
  ]},
  { group: "系统管理", items: [
    { key: "sm-accounts", label: "账号与角色", code: "SM01" },
    { key: "sm-bindings", label: "司机与车辆绑定", code: "SM02" },
    { key: "sm-config", label: "规则与运营配置", code: "SM03" },
    { key: "sm-audit", label: "数据版本与审计", code: "SM04" },
    { key: "sm-knowledge", label: "知识内容", code: "SM06" },
  ]},
];

function NavIcon({ kind }: { kind: number }) {
  const paths = [
    <><rect x="3" y="3" width="7" height="7" rx="1.5" /><rect x="14" y="3" width="7" height="7" rx="1.5" /><rect x="3" y="14" width="7" height="7" rx="1.5" /><rect x="14" y="14" width="7" height="7" rx="1.5" /></>,
    <><path d="M4 16V8l2-4h12l2 4v8M4 9h16M7 13h1m8 0h1M6 16v3m12-3v3M3 16h18" /></>,
    <><path d="m12 3 9 16H3L12 3Z" /><path d="M12 9v4m0 3h.01" /></>,
    <><path d="m2 8 10-5 10 5-10 5L2 8Zm4 2v7l6 3 6-3v-7M22 8v8" /></>,
    <><rect x="4" y="7" width="16" height="13" rx="3" /><path d="M12 3v4M9 12v2m6-2v2M9 17h6M1 11v5m22-5v5" /></>,
    <><path d="M4 6h16M4 12h16M4 18h16" /><circle cx="8" cy="6" r="2" /><circle cx="16" cy="12" r="2" /><circle cx="10" cy="18" r="2" /></>,
  ];
  return <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">{paths[kind]}</svg>;
}

function PageHead({ title }: { code?: string; title: string; desc: string }) {
  return <div className="page-head"><h2>{title}</h2></div>;
}

const RR_LABEL: Record<string, string> = { identity_association: "身份关联疑问", event_record: "事件记录疑问", device_or_data_missing: "设备或数据缺失", score_explanation: "评分解释疑问" };
const RR_STATUS: Record<string, string> = { submitted: "待人工复核", checking: "核查中", awaiting_data_owner: "待数据核实", answered: "已答复", closed: "已关闭" };
const rrStatus = (value: unknown) => RR_STATUS[String(value)] || "待确认";
const rrDate = (value: unknown) => value && !Number.isNaN(Date.parse(String(value))) ? new Date(String(value)).toLocaleString("zh-CN", { timeZone: "Asia/Shanghai", hour12: false }) : "—";
const rrNumber = (value: unknown) => value != null && Number.isFinite(Number(value)) ? Number(value).toFixed(2) : "—";

function ReviewRecord({ view }: { view: RRView }) {
  const [data, setData] = useState<{ score: Record<string, unknown> | null; ledger: Record<string, unknown>[] } | null>(null);
  const [failed, setFailed] = useState(false);
  useEffect(() => {
    let alive = true;
    const snap = view.snapshot;
    if (!snap) { setData({ score: null, ledger: view.ledger || [] }); return; }
    (async () => {
      const scores = await getData<Record<string, unknown>>("admin.score_snapshots", { gpsno: String(snap.gpsno), as_of_date: String(snap.as_of_date), limit: 200 });
      const score = scores.rows.find(r => r.score_id === snap.score_id && r.source_version === snap.source_version) || null;
      let ledger: Record<string, unknown>[] = [];
      for (let offset = 0; ; offset += 200) {
        const page = await getData<Record<string, unknown>>("admin.deduction_ledger", { gpsno: String(snap.gpsno), limit: 200, offset });
        ledger.push(...page.rows.filter(r => r.as_of_date === snap.as_of_date && r.source_version === snap.source_version));
        if (page.rows.length < 200) break;
      }
      if (alive) setData({ score, ledger });
    })().catch(() => { if (alive) setFailed(true); });
    return () => { alive = false; };
  }, [view]);
  if (failed) return <EmptyState kind="error" />;
  if (!data) return <EmptyState kind="loading" />;
  return <section className="panel" aria-label="针对记录详情"><h3>{view.snapshot ? `${vehicleLabel(view.snapshot.gpsno)} · ${String(view.snapshot.as_of_date)}评分记录` : "事件记录详情"}</h3>
    {view.snapshot && <p>安全分 {rrNumber(view.snapshot.safety_score)} · {String(view.snapshot.risk_level)}级 · 车队排名第{String(view.snapshot.rank ?? "—")}名</p>}
    {data.score ? <><h4>六维扣分</h4><div className="kv">{DIM_ORDER.map(([key, label]) => <span key={key} style={{ display: "contents" }}><span className="kk">{label}</span><b>{rrNumber(data.score![key])} 分</b></span>)}</div><p>主要原因：{displayText(data.score.top_reason_1 || "暂无记录")}</p></> : view.snapshot && <p className="meta">该评分版本的六维明细暂不可用。</p>}
    <h4>关联事件台账</h4>{data.ledger.length ? <div className="table-wrap"><table><thead><tr><th>事件类型</th><th>所属维度</th><th>事件数量</th><th>扣分</th></tr></thead><tbody>{data.ledger.map(l => <tr key={String(l.ledger_id)}><td>{cellView("event_type", l.event_type)}</td><td>{cellView("dimension", l.dimension)}</td><td>{String(l.event_count ?? "—")}</td><td>{rrNumber(l.allocated_points)}</td></tr>)}</tbody></table></div> : <p className="meta">暂无关联事件台账。</p>}
  </section>;
}

function EvReview() {
  const [tick, setTick] = useState(0);
  const [sel, setSel] = useState<string | null>(() => new URLSearchParams(location.hash.split('?')[1]).get('request'));
  const [v, setV] = useState<RRView | null | "error">(null);
  const [note, setNote] = useState("");
  const [rrTpl, setRrTpl] = useState<string | null>(null);
  const [msg, setMsg] = useState<string | null>(null);
  const [recordOpen, setRecordOpen] = useState(false);
  const [drivers, setDrivers] = useState<Record<string, string>>({});
  useEffect(() => {
    let alive = true;
    (async () => {
      const names: Record<string, string> = {};
      for (let offset = 0; ; offset += 200) {
        const page = await getData<Record<string, unknown>>("admin.drivers", { limit: 200, offset });
        for (const r of page.rows) names[String(r.driver_id)] = String(r.display_name || "司机信息待完善");
        if (page.rows.length < 200) break;
      }
      if (alive) setDrivers(names);
    })().catch(() => {});
    return () => { alive = false; };
  }, []);
  useEffect(() => {
    let alive = true;
    setV(null); setNote(""); setRrTpl(null); setRecordOpen(new URLSearchParams(location.hash.split("?")[1]).get("record") === "1");
    if (sel) rrView(sel).then(r => { if (alive) setV(r); }).catch(() => { if (alive) setV("error"); });
    return () => { alive = false; };
  }, [sel, tick]);
  async function move(st: string) {
    setMsg(null);
    try { const r = await rrAdvance(sel!, st, note, rrTpl); setMsg(`已更新为${rrStatus(r.new_status)}${r.driver_notified ? "，已通知司机" : ""}`); setNote(""); setTick(x => x + 1); }
    catch (e) { const c = e instanceof ApiError ? e.code : "network"; setMsg(c === "response_note_required" ? "请先填写答复或处理说明。" : "处理未完成，请刷新后重试。"); }
  }
  return <div>
    <PageHead title="评价复核与数据异议" desc="" />
    <ResourceTable key={`rr${tick}`} resource="admin.review_requests" columns={["driver_id", "reason_code", "status", "created_at"]} rowActionLabel="查看详情" onRowClick={r => { setMsg(null); setSel(String(r.request_id)); }} labels={{ driver_id: "司机", reason_code: "申请原因", status: "处理状态", created_at: "提交时间" }} renderCell={(col, value) => col === "driver_id" ? drivers[String(value)] || "司机信息加载中" : col === "reason_code" ? RR_LABEL[String(value)] || "其他疑问" : col === "status" ? <Tag tone="blue">{rrStatus(value)}</Tag> : rrDate(value)} />
    {sel && !v && <EmptyState kind="loading" />}
    {v && v !== "error" && <div className="panel"><h3>复核详情 · {drivers[String(v.request.driver_id)] || "司机"} <Tag tone="blue">{rrStatus(v.request.status)}</Tag></h3>
      <div className="grid2">
        <div><h4>申请说明 · {RR_LABEL[String(v.request.reason_code)] || "其他疑问"}</h4>
          <p style={{ whiteSpace: "pre-wrap", overflowWrap: "anywhere", background: "var(--bg)", borderRadius: 8, padding: 8, fontSize: 13 }}>{String(v.request.description)}</p>
          <div className="kv"><span className="kk">针对记录</span>{v.snapshot || v.ledger?.length ? <a href={`#/ev-review?request=${encodeURIComponent(String(v.request.request_id))}&record=1`} onClick={e => { e.preventDefault(); setRecordOpen(x => !x); }}>{v.snapshot ? `${vehicleLabel(v.snapshot.gpsno)} · ${String(v.snapshot.as_of_date)}评分` : "关联事件记录"} {recordOpen ? "收起 ↑" : "查看详情 →"}</a> : <span>记录暂不可用</span>}</div></div>
        <div><h4>评分概况</h4>
          {v.snapshot ? <div className="kv">
            <span className="kk">安全分 / 等级</span><b>{rrNumber(v.snapshot.safety_score)} / {String(v.snapshot.risk_level)}级</b>
            <span className="kk">车队排名</span><b>第{String(v.snapshot.rank ?? "—")}名</b>
            <span className="kk">可信度</span><b>{{ high: "高", medium: "中", low: "低" }[String(v.snapshot.confidence_level)] || "待确认"}</b>
            <span className="kk">评分状态</span><b>{{ usable: "可用", usable_with_review: "可用，建议复核", manual_review: "需人工复核", insufficient_data: "数据不足", unavailable: "暂不可用" }[String(v.snapshot.score_status)] || "待核实"}</b>
            <span className="kk">评分日期</span><b>{String(v.snapshot.as_of_date)}</b></div> : <p>暂无评分记录</p>}
        </div>
      </div>
      {recordOpen && <ReviewRecord key={String(v.request.request_id)} view={v} />}
      <TemplateScenePicker key={sel} scene="review_answer" driverId={String(v.request.driver_id || "")} onPick={setRrTpl} label="答复模板（可选）" />
      <div className="field" style={{ marginTop: 8 }}><label htmlFor="review-response">答复或处理说明（答复、转交及关闭前请填写）</label>
        <textarea id="review-response" style={{ width: "100%", minHeight: 78, borderRadius: 8, border: "1px solid var(--line)", padding: 8, font: "inherit" }} value={note} onChange={e => setNote(e.target.value)} aria-label="答复说明" /></div>
      <div className="row">
        {(["checking", "awaiting_data_owner", "answered", "closed"] as const).map(st => { const allowed: Record<string, string[]> = { submitted: ["checking", "answered"], checking: ["awaiting_data_owner", "answered"], awaiting_data_owner: ["answered"], answered: ["closed"], closed: [] }; return allowed[String(v.request.status)]?.includes(st) ? <button key={st} className="btn" onClick={() => move(st)}>{{ checking: "开始核查", awaiting_data_owner: "转交数据核实", answered: "答复司机", closed: "关闭申请" }[st]}</button> : null; })}
        <button className="btn" onClick={() => setSel(null)}>收起</button>
      </div>
      <h4 style={{ marginTop: 12 }}>处理记录</h4>
      {(v.timeline || []).map(e => <div key={String(e.audit_id)} className="task-card"><div className="t">{String(e.action).includes("create") ? "司机提交申请" : `申请${rrStatus(e.new_status)}`}</div><div className="meta">{rrDate(e.occurred_at)}</div></div>)}
    </div>}
    {msg && <div className="alert info" role="status">{msg}</div>}
    {v === "error" && <EmptyState kind="error" />}
  </div>;
}

type ScoreRow = Record<string, unknown>;
const PAGE = 200;

function EvFleet() {
  const [agg, setAgg] = useState<{ n: number; avg: number | null; dist: Record<string, number>; low: number; date: string } | null>(null);
  const [filter, setFilter] = useState<string | null>(() => { const level = new URLSearchParams(location.hash.split("?")[1]).get("level"); return level && ["A", "B", "C", "D", "conf"].includes(level) ? level : null; });
  const [vehicleQuery, setVehicleQuery] = useState("");
  const [driver, setDriver] = useState<ScoreRow | null>(null);
  const parseQ = () => { const m = location.hash.match(/[?&](driver_id|gpsno)=([^&#]+)/); return m ? { key: m[1], val: decodeURIComponent(m[2]) } : null; };
  const [q, setQ] = useState<{ key: string; val: string } | null>(parseQ);
  const [deepErr, setDeepErr] = useState<string | null>(null);
  useEffect(() => {
    if (!q) return;
    let alive = true; setDriver(null); setDeepErr("加载中…");
    getData<ScoreRow>("admin.score_snapshots", { limit: 1, order: "as_of_date.desc", ...(q.key === "driver_id" ? { driver_id: q.val } : { gpsno: q.val }) })
      .then((r) => { if (!alive) return; if ((r.rows || []).length) { setDriver(r.rows[0] as ScoreRow); setDeepErr(null); } else setDeepErr("无记录：该标识在当日评分快照中不存在（或超出你的车队范围）"); })
      .catch(() => alive && setDeepErr("查询失败（会话过期或服务异常），请重试"));
    return () => { alive = false; };
  }, [q]);

  useEffect(() => {
    const onHash = () => { if (location.hash.includes("ev-fleet")) { setQ(parseQ()); setDriver(null); setDeepErr(null); } };
    window.addEventListener("hashchange", onHash);
    return () => window.removeEventListener("hashchange", onHash);
  }, []);
  useEffect(() => {
    let alive = true;
    (async () => {
      let rows: ScoreRow[] = [];
      for (let off = 0; ; off += PAGE) {
        const r = await getData<ScoreRow>("admin.score_snapshots", { limit: PAGE, offset: off });
        rows = rows.concat(r.rows);
        if (r.rows.length < PAGE) break;
      }
      if (!alive) return;
      const dist: Record<string, number> = {}; let low = 0; let sum = 0; let cnt = 0;
      for (const r of rows) {
        dist[String(r.risk_level)] = (dist[String(r.risk_level)] || 0) + 1;
        if (r.confidence_level === "low") low++;
        if (typeof r.safety_score === "number") { sum += r.safety_score; cnt++; }
      }
      setAgg({ n: rows.length, avg: cnt ? sum / cnt : null, dist, low, date: String(rows[0]?.as_of_date || "—") });
    })().catch(() => {});
    return () => { alive = false; };
  }, []);
  if (driver) return <EvDriver row={driver} onBack={() => setDriver(null)} />;
  if (deepErr && !driver) return <div><button className="btn" onClick={() => { setDeepErr(null); setQ(null); history.pushState("", "", location.pathname + location.search + "#/ev-fleet"); window.dispatchEvent(new HashChangeEvent("hashchange")); }}>← 返回车队总览</button><div style={{ height: 10 }} />{deepErr === "加载中…" ? <EmptyState kind="loading" /> : <EmptyState kind="nomatch" hint={deepErr} />}</div>;
  const setF = (v: string) => () => setFilter((cur) => (cur === v ? null : v));
  const filterParams: Record<string, string> = !filter ? {} : filter.startsWith("conf") ? { confidence_level: "low" } : { risk_level: filter };
  return <div className="fleet-overview">
    <div className="dashboard-heading fleet-heading"><h1>车队总览</h1><span className="date-label">数据截止 <b>{agg?.date || "—"}</b></span></div>
    <div className="dashboard-metrics fleet-metrics">
      {[
        ["评分车辆", agg?.n ?? "—", null],
        ["平均安全分", agg?.avg?.toFixed(2) ?? "—", null],
        ["D 级车辆", agg?.dist.D ?? "—", "D"],
        ["低可信度车辆", agg?.low ?? "—", "conf"],
      ].map(([label, value, target], i) => <button key={String(label)} className={`dashboard-metric ${i === 1 ? "featured" : ""}`} onClick={() => setFilter(target === null ? null : String(target))}><span className="metric-label">{label}</span><strong>{value}</strong><span className="metric-note">{i === 1 ? "近 14 天" : "辆"}</span></button>)}
    </div>
    {new URLSearchParams(location.hash.split("?")[1]).get("trend")==="1"&&<FleetScoreTrend />}
    <section className="panel fleet-list">
      <div className="fleet-toolbar">
        <div className="fleet-filters" aria-label="等级筛选"><button className={!filter ? "active" : ""} onClick={() => setFilter(null)}>全部</button>{["A", "B", "C", "D"].map(level => <button key={level} className={filter === level ? "active" : ""} onClick={setF(level)}>{level} 级 <span>{agg?.dist[level] ?? "—"}</span></button>)}</div>
        <form className="fleet-search" onSubmit={e => { e.preventDefault(); if (vehicleQuery.trim()) { setFilter(null); setQ({ key: "gpsno", val: vehicleId(vehicleQuery) }); } }}><input placeholder="如：车辆1" aria-label="车辆编号" value={vehicleQuery} onChange={e => setVehicleQuery(e.target.value)} /><button className="btn" type="submit">查询</button></form>
      </div>
      {filter === "conf" && <div className="row filter-note"><Tag tone="amber">低可信度</Tag><button className="btn" onClick={() => setFilter(null)}>清除筛选</button></div>}
      <p><a className="btn primary" href="#/ev-actions">查看高风险车辆与分层处置</a></p><ResourceTable key={filter + JSON.stringify(q ?? {}) + "ev01"} resource="admin.score_snapshots" rowActionLabel="查看" pageSize={15} params={{ order: "safety_score.asc", ...filterParams, ...(q ? { [q.key]: q.val } : {}) }} columns={["gpsno", "safety_score", "rank", "risk_level", "score_change_7d", "confidence_level", "primary_risk_dimension", "recommended_action"]} labels={{ gpsno: "车辆编号", safety_score: "安全分", rank: "排名", risk_level: "等级", score_change_7d: "7天变化", confidence_level: "可信度", primary_risk_dimension: "主要风险维度", recommended_action: "建议动作" }} onRowClick={r => setDriver({ ...r })} />
    </section>

  </div>;
}

const DIM_ORDER: [string, string][] = [
  ["history_contribution", "历史事故与未遂"], ["fatigue_distraction_contribution", "疲劳与分心"],
  ["driving_stability_contribution", "驾驶稳定性"], ["road_rule_contribution", "道路规则"],
  ["management_contribution", "管理配合度"], ["imu_evidence_contribution", "IMU证据"],
];
const DIM_COLORS = ["#a389c3", "#ad95ce", "#b8a1d7", "#c0abdf", "#cbbbe6", "#d5c8ed"];

function SixBars({ row }: { row: ScoreRow }) {
  const vals = DIM_ORDER.map(([k]) => Number(row[k] ?? 0) || 0);
  const max = Math.max(...vals, 1e-9);
  const sixSum = vals.reduce((a, b) => a + b, 0);
  const target = 100 - Number(row.safety_score ?? 0);
  const diff = Math.abs(sixSum - target);
  const verdict = diff <= 1e-6 ? "一致（原始数值精度内）" : diff <= 1e-4 ? `极小差异 ${diff.toExponential(1)}（源文件数值舍入所致，页面不修改算法值）` : `差异 ${diff.toExponential(2)}，需数据组核对；页面不改写`;
  return <div className="panel"><h3>六维扣分（合计=100−安全分在线对账）</h3>
    {DIM_ORDER.map(([k, label], i) => <div key={k} className="row" style={{ marginBottom: 5 }}>
      <span style={{ width: 110, color: "var(--ink-2)", fontSize: 12.5 }}>{label}</span>
      <span style={{ height: 14, width: `${(vals[i] / max) * 45}%`, minWidth: vals[i] > 0 ? 2 : 0, background: DIM_COLORS[i], borderRadius: 3, display: "inline-block" }} />
      <span className="mono" title={String(row[k] ?? "")}>{row[k] == null ? "—" : Number(row[k]).toFixed(4)}</span>
    </div>)}
    <p className="login-note" style={{ marginTop: 6 }}>六维合计 {sixSum.toFixed(4)} vs 100 − 安全分 {target.toFixed(4)} → <b>{verdict}</b>。行为观察扣分 {row.behavior_safety_score==null?"—":Number(row.behavior_safety_score).toFixed(4)} · 评分保守下界 {row.confidence_adjusted_floor==null?"—":Number(row.confidence_adjusted_floor).toFixed(4)}</p>
  </div>;
}

function EvWeek() {
  const [meta, setMeta] = useState<{ dates: string[]; counts: Record<string, number | null> } | null>(null);
  const [a, setA] = useState<string>(""); const [b, setB] = useState<string>("");
  const [cmp2, setCmp2] = useState<{ dropped10: string[]; risen: number; dropped: number; same: number; samples: [string, string, string][] } | null>(null);
  const [busy, setBusy] = useState(false); const [err, setErr] = useState(false);const [weekPage,setWeekPage]=useState(0);
  useEffect(() => { getHistoryDates().then((d) => { setMeta(d); if (d.dates.length) { setA(d.dates[0]); setB(d.dates[d.dates.length - 1]); } }).catch(() => setErr(true)); }, []);
  async function run() {
    if (!a || !b || a === b) return;
    setBusy(true); setCmp2(null);
    const grab = async (date: string) => { let acc: ScoreRow[] = []; for (let off = 0; ; off += 200) { const r = await getData<ScoreRow>("admin.score_history", { limit: 200, offset: off, as_of_date: date }); acc = acc.concat(r.rows); if (r.rows.length < 200) break; } return acc; };
    const A = await grab(a), B = await grab(b);
    const mapA = new Map(A.map((x) => [String(x.gpsno), x]));
    let risen = 0, dropped = 0, same = 0; const d10: string[] = []; const samples: [string, string, string][] = [];
    for (const x of B) { const ya = mapA.get(String(x.gpsno)); if (!ya) continue;
      const diff = Number(x.safety_score) - Number(ya.safety_score);
      if (diff > 0) risen++; else if (diff < 0) dropped++; else same++;
      if (diff <= -10) d10.push(String(x.driver_id || x.gpsno));
      samples.push([vehicleLabel(x.gpsno), String(ya.safety_score), String(x.safety_score)]); }
    samples.sort((x, y) => (Number(x[2]) - Number(x[1])) - (Number(y[2]) - Number(y[1])));
    setWeekPage(0);setCmp2({ dropped10: d10, risen, dropped, same, samples: samples.filter(x=>Number(x[2])-Number(x[1])<=-10) }); setBusy(false);
  }
  if (err) return <EmptyState kind="error" />;
  if (!meta) return <EmptyState kind="loading" />;
  if (!meta.dates.length) return <EmptyState kind="nomatch" hint="暂无评分历史" />;
  const DATES = meta.dates;
  return <div>
    <PageHead code="EV02" title="评分趋势" desc="日期选项与逐日数量直接查询自 score_history（distinct as_of_date + count），不写死、不补造；无记录日期不出现。" />
    <div className="panel"><h3>已有日期（DB 实查）</h3>
      <div className="row">{DATES.map((d) => <Tag key={d} tone={d === b ? "blue" : "gray"}>{d} · {meta.counts[d] ?? "?"}</Tag>)}</div>
    </div>
    <div className="row" style={{ marginBottom: 10 }}>
      <select className="btn" style={{ background: "#fff" }} value={a} onChange={(e) => setA(e.target.value)}>{DATES.map((d) => <option key={d}>{d}</option>)}</select>
      <span>→</span>
      <select className="btn" style={{ background: "#fff" }} value={b} onChange={(e) => setB(e.target.value)}>{DATES.map((d) => <option key={d}>{d}</option>)}</select>
      <button className="btn primary" style={{ width: "auto" }} onClick={run} disabled={busy || !a || !b || a === b}>{busy ? "计算中…" : "对比两日"}</button>
    </div>
    {cmp2 && <div className="panel"><h3>{a} → {b}</h3>
      <p className="page-desc">上升 {cmp2.risen} · 下降 {cmp2.dropped} · 持平 {cmp2.same}；<b>下降≥10 分（运营阈值建议 10 分，仅形成优先队列，不生成新分数或告警）：{cmp2.dropped10.length} 个</b></p>
      <div className="table-wrap"><table><thead><tr><th>对象</th><th>{a}</th><th>{b}</th><th>变化</th></tr></thead><tbody>
        {cmp2.samples.slice(weekPage*10,weekPage*10+10).map((s) => <tr key={s[0]}><td className="mono">{s[0]}</td><td>{Number(s[1]).toFixed(4)}</td><td>{Number(s[2]).toFixed(4)}</td><td style={{ color: Number(s[2]) - Number(s[1]) < 0 ? "var(--risk)" : "var(--ok)" }}>{(Number(s[2]) - Number(s[1])).toFixed(4)}</td></tr>)}
      </tbody></table></div><div className="row week-pagination"><button className="btn" disabled={!weekPage} onClick={()=>setWeekPage(p=>p-1)}>上一页</button><span>第 {weekPage+1} / {Math.max(1,Math.ceil(cmp2.samples.length/10))} 页 · 共 {cmp2.samples.length} 辆</span><button className="btn" disabled={(weekPage+1)*10>=cmp2.samples.length} onClick={()=>setWeekPage(p=>p+1)}>下一页</button></div>

    </div>}
  </div>;
}

function EvDriver({ row, onBack, sourceQueueId }: { row: Record<string, unknown>; onBack: () => void; sourceQueueId?: string }) {
  const [tab, setTab] = useState(() => { const m = /[?&]tab=([0-3])/.exec(location.hash); return m ? Number(m[1]) : 0; });
  const [facts, setFacts] = useState<{ risk: number; alerts: Record<string, unknown>[]; tasks: Record<string, unknown>[] } | null>(null);
  const tabs = ["已观察行为", "未来风险预测", "事件证据", "管理动作"];
  const drvId = row.driver_id ? String(row.driver_id ?? "—") : ""; const gps = String(row.gpsno); const low = String(row.confidence_level) === "low";
  useEffect(() => { setFacts(null); let alive = true;
    Promise.all([
      getData<Record<string, unknown>>("admin.risk_snapshots", { gpsno: gps, limit: 1 }).catch(() => ({ rows: [] as Record<string, unknown>[] })),
      getData<Record<string, unknown>>("admin.alerts", { gpsno: gps, limit: 10 }).catch(() => ({ rows: [] as Record<string, unknown>[] })),
      getData<Record<string, unknown>>("admin.trainings", { driver_id: drvId, limit: 10 }).catch(() => ({ rows: [] as Record<string, unknown>[] })),
      getData<Record<string, unknown>>("admin.drivers", { driver_id: drvId, limit: 5 }).catch(() => ({ rows: [] as Record<string, unknown>[] })),
    ]).then(([rk, al, tr, dv]) => { if (alive) setFacts({ risk: (rk.rows || []).length, alerts: (al.rows || []) as Record<string, unknown>[], tasks: (tr.rows || []) as Record<string, unknown>[], ident: ((dv.rows || [])[0] || {}).identity_status ? String(((dv.rows || [])[0] || {}).identity_status) : null } as never); });
    return () => { alive = false; };
  }, [gps, drvId]);
  return <div className="fleet-detail">
    <button className="btn" onClick={onBack}>← 返回车队总览</button>
    <div style={{ height: 10 }} />
    <div className="meta">车队排名 第 {String(row.rank??'—')} 名</div>
    <PageHead code={`EV03 · ${String(row.driver_id ?? "—")} · 车辆 ${String(row.gpsno)}`} title={vehicleLabel(gps)} desc="页首分栏区分“近14天观察”与“未来40天预测”，两口径不可互相换算；全部值为只读事实。" />
    <Banner tone={row.confidence_level === "low" ? "warn" : "info"}>
      <span>近14天观察：安全分 <b>{row.safety_score == null ? "—" : Number(row.safety_score).toFixed(4)}</b> · 等级 <b>{String(row.risk_level)}</b> · 7天变化 {row.score_change_7d == null ? "—" : Number(row.score_change_7d).toFixed(4)} · 可信度 <b>{{ high: "高", medium: "中", low: "低" }[String(row.confidence_level)] || "—"}（{String(row.confidence_score)}）</b> · 截止 {String(row.as_of_date)}（窗口起 {String(row.window_start)}）{row.confidence_level === "low" ? " → 低可信度：请先核验设备与数据覆盖，不自动奖惩" : ""}</span>
    </Banner>
    <VehicleScoreTrend key={gps} gpsno={gps} />
    <div className="grid2">
      <div className="panel"><h3>评分信息</h3><div className="kv">
        <span className="kk">40天风险概率</span><b>{row.forecast_40d_risk_prob == null ? "—" : (Number(row.forecast_40d_risk_prob) * 100).toFixed(4) + "%"}</b>
        <span className="kk">车队排名</span><b>{String(row.rank)}</b>
        <span className="kk">数据截止</span><b className="mono">{String(row.as_of_date)}</b>
      </div></div>
      <div className="panel"><h3>建议动作</h3><div className="kv">
        <span className="kk">主风险维度</span><b>{({history:"历史事故与未遂", fatigue_distraction:"疲劳与分心", driving_stability:"驾驶稳定性", road_rule:"道路规则", management:"管理配合", imu_evidence:"IMU证据"}[String(row.primary_risk_dimension)] || String(row.primary_risk_dimension ?? "—"))}</b>
        <span className="kk">建议</span><b>{String(row.recommended_action)}</b>
        <span className="kk">复核周期</span><b>{{ monthly: "每月", weekly: "每周", daily: "每日" }[String(row.review_cycle)] || String(row.review_cycle || "—")}</b>
      </div></div>
    </div>
    <a className="btn primary fleet-training-link" href="#/tr-ledger">去培训</a><SixBars row={row} />
    <div className="row">{tabs.map((tb, i) => <button key={tb} className="btn" style={i === tab ? { borderColor: "var(--navy)", color: "var(--navy)" } : undefined} onClick={() => setTab(i)}>{tb}</button>)}</div>
    <div style={{ height: 10 }} />
    {tab === 0 && <section className="panel score-reasons"><h3>主要扣分原因</h3>{[1, 2, 3].map(i => <div key={i}><span className="reason-number">0{i}</span><p>{String(row[`top_reason_${i}`] || "—")}</p>{row[`top_reason_${i}_penalty_points`] != null && <b>{Number(row[`top_reason_${i}_penalty_points`]).toFixed(4)} <small>分</small></b>}</div>)}<div className="vehicle-fact-cards">{[['安全分',Number(row.safety_score).toFixed(4)],['等级',row.risk_level],['排名',row.rank],['主要风险',({history:'历史事故与未遂',fatigue_distraction:'疲劳与分心',driving_stability:'驾驶稳定性',road_rule:'道路规则',management:'管理配合度',imu_evidence:'惯性传感器异常'} as Record<string,string>)[String(row.primary_risk_dimension)]||'—']].map(([k,v])=><div key={String(k)}><span>{String(k)}</span><strong>{String(v??'—')}</strong></div>)}</div></section>}
    {tab === 1 && <>{facts && facts.risk === 0 ? <div className="alert info">该时点无此车辆的 40 天预测快照 → 不可用（未取得）；系统不以观察分反推概率。</div> : <ResourceTable resource="admin.risk_snapshots" pageSize={10} params={{ gpsno: String(row.gpsno) }} columns={['risk_prob','risk_rank','horizon_days','as_of_date']} labels={{risk_prob:'未来风险概率',risk_rank:'风险排名',horizon_days:'预测天数',as_of_date:'预测日期'}} />}</>}
    {tab === 2 && <section className="panel"><h3>扣分依据 · 事件台账</h3><p className="page-desc">事件台账是指按事件类型记录的事件数量、所属维度及对应扣分，<b>仅用于解释与对账。</b></p>{row.top_reason_1_code ? <div className="table-wrap"><table><thead><tr><th>维度</th><th>事件数量</th><th>扣分</th><th>关联事件类型</th></tr></thead><tbody>{[1, 2, 3].map(i => <tr key={i}><td>{{ history: "历史事故与未遂", fatigue_distraction: "疲劳与分心", driving_stability: "驾驶稳定性", road_rule: "道路规则", management: "管理配合度", imu_evidence: "IMU 风险佐证" }[String(row[`top_reason_${i}_dimension`])] || "—"}</td><td>{row[`top_reason_${i}_event_count`] == null ? "—" : String(row[`top_reason_${i}_event_count`])}</td><td>{row[`top_reason_${i}_penalty_points`] == null ? "—" : Number(row[`top_reason_${i}_penalty_points`]).toFixed(4)}</td><td className="mono">{String(row[`top_reason_${i}_source_event_codes`] || "—").split(',').map(eventName).join('、')}</td></tr>)}</tbody></table></div> : <ResourceTable resource="admin.deduction_ledger" columns={["event_type","dimension","event_count","allocated_points","as_of_date"]} pageSize={20} params={{ gpsno: gps }} labels={{ ledger_id: "台账ID", gpsno: "车辆", event_type: "事件类型", dimension: "维度", event_count: "事件数", decayed_severity: "衰减严重度", allocated_points: "分摊扣分", dimension_points: "维度扣分", as_of_date: "截止日" }} />}</section>}
    {tab === 3 && <section className="panel vehicle-management"><h3>管理跟进</h3><div className="vehicle-fact-cards"><div><span>当前告警</span><strong>{facts?.alerts.length??'—'} 项</strong></div><div><span>培训任务</span><strong>{facts?.tasks.length??'—'} 项</strong></div><div><span>数据状态</span><strong>{low?'需核验设备':'可查看评分依据'}</strong></div></div><div className="row"><a className="btn primary" href="#/tr-ledger">去培训</a><a className="btn" href={"#/rm-alerts?return_vehicle="+encodeURIComponent(gps)}>查看告警</a><a className="btn" href={"#/ev-review?return_vehicle="+encodeURIComponent(gps)}>查看评分复核</a></div></section>}
  </div>;
}

function Drop7Panel({data,openRow}:{data:Drop7ish;openRow:(gps:string)=>void}){
 if(data.data_status!=='ok')return <EmptyState kind="nocov" hint="暂无可比较的评分历史"/>;
 return <section className="panel"><h3>近7天评分明显下降的车辆</h3><p className="meta">比较日期 {data.date_pair?.[0]} 至 {data.date_pair?.[1]} · 下降达到 {data.threshold} 分，共 {data.drop_count} 辆</p><div className="table-wrap"><table><thead><tr><th>车辆</th><th>原安全分</th><th>现安全分</th><th>下降分数</th><th>数据可信度</th><th>下一步</th></tr></thead><tbody>{(data.rows||[]).map(x=><tr key={x.gpsno}><td>{vehicleLabel(x.gpsno)}</td><td>{Number(x.early_score).toFixed(4)}</td><td>{Number(x.late_score).toFixed(4)}</td><td>{Math.abs(x.drop).toFixed(4)}</td><td>{{high:'高',medium:'中',low:'低'}[String(x.confidence)]||'未取得'}</td><td><button className="btn" onClick={()=>openRow(x.gpsno)}>查看车辆详情</button></td></tr>)}</tbody></table></div>{!data.rows?.length&&<p className="meta">当前没有达到下降阈值的车辆。</p>}</section>;
}

type Drop7ish = import("./api").Drop7;

const QUEUE_GROUPS: [string, string, string][] = [
  ["priority_review", "优先复核", "red"],
  ["behavior_coaching", "行为辅导", "amber"],
  ["prediction_review", "预测核查", "blue"],
  ["data_quality_review", "数据质量核验", "amber"],
  ["routine", "常规观察", "gray"],

 ];

function RmQueue() {
  const [queueOverview, setQueueOverview] = useState<import("./api").OverviewResult | null>(null);
  useEffect(() => { import("./api").then(m => m.getOverview().then(setQueueOverview).catch(() => {})); }, []);
  const [rows, setRows] = useState<ScoreRow[] | null>(null);
  const [err, setErr] = useState(false);
  const [openG, setOpenG] = useState<string>("priority_review");
  const [detail, setDetail] = useState<ScoreRow | null>(null);
  useEffect(() => {
    let alive = true;
    (async () => {
      let acc: ScoreRow[] = [];
      for (let off = 0; ; off += 200) {
        const r = await getData<ScoreRow>("admin.review_queue", { limit: 200, offset: off });
        acc = acc.concat(r.rows);
        if (r.rows.length < 200) break;
      }
      if (alive) setRows(acc);
    })().catch(() => setErr(true));
    return () => { alive = false; };
  }, []);
  async function openDriver(queueRow: ScoreRow) {
    const r = await getData<ScoreRow>("admin.score_snapshots", { limit: 1, gpsno: String(queueRow.gpsno) });
    if (r.rows[0]) setDetail({ ...r.rows[0], __queue_id: String(queueRow.queue_id) });
  }
  if (detail) return <EvDriver row={detail} onBack={() => setDetail(null)} sourceQueueId={detail.__queue_id as string | undefined} />;
  if (err) return <EmptyState kind="error" />;
  if (!rows) return <EmptyState kind="loading" />;
  const counts = Object.fromEntries(QUEUE_GROUPS.map(([k]) => [k, rows.filter((r) => r.review_queue === k).length]));
  return <div className="risk-workbench">
    <PageHead code="RM01 · 队列来源 review_queue（as_of 2026-07-31）" title="风险监控" desc="队列来自算法快照；排序仅用于复核优先级，不自动创建告警。" />
    <div className="cards">
      <div className="card"><div className="k">监测车辆</div><div className="v">{new Set(rows.map(r => r.gpsno)).size}</div></div>
      <div className="card risk"><div className="k">优先复核</div><div className="v">{counts.priority_review}</div></div>
      <div className="card warn"><div className="k">行为辅导</div><div className="v">{counts.behavior_coaching}</div></div>
      <div className="card warn"><div className="k">数据质量核验</div><div className="v">{counts.data_quality_review}</div><div className="s">先核验设备/数据</div></div>
      <div className="card"><div className="k">待核查告警 / 待回复</div><div className="v">{queueOverview?.metrics.find(m => m.key === "alerts_pending")?.count ?? "—"} / {queueOverview?.metrics.find(m => m.key === "interventions_unreplied")?.count ?? "—"}</div></div>
    </div>
    <div className="row" style={{ marginBottom: 8 }}>
      {QUEUE_GROUPS.map(([k, label]) => <button key={k} className="btn" style={openG === k ? { borderColor: "var(--navy)", color: "var(--navy)" } : undefined} onClick={() => setOpenG(k)}>{label} {counts[k]}</button>)}
    </div>
    <RiskQueueChart key={'chart-'+openG} title={QUEUE_GROUPS.find(([k])=>k===openG)?.[1]||'风险分布'} rows={rows.filter(r=>r.review_queue===openG)} />

    {openG !== "drop7" && <ResourceTable key={`q-${openG}`} resource="admin.review_queue" pageSize={15} columns={["gpsno", "safety_score", "risk_level", "confidence_level", "forecast_40d_risk_prob", "action_deadline", "top_reason_1"]} params={{ review_queue: openG }}
      rowActionLabel="查看" onRowClick={openDriver} labels={{ primary_risk_dimension: "主要风险维度", recommended_action: "建议动作", queue_id: "queue_id(来源)", gpsno: "车辆", safety_score: "14天安全分", rank: "车队排名", risk_level: "等级", forecast_40d_risk_prob: "40天概率", action_deadline: "处置时限", confidence_level: "可信度", top_reason_1: "首要原因", as_of_date: "截止日", source_version: "来源版本" }} />}

    {openG !== "drop7" && <QueueConfirm key={'action-'+openG} group={openG} rows={rows.filter(r=>r.review_queue===openG)} />}
  </div>;
}

const REPLAY_VEHICLES = ["95301325", "95301330", "95301567", "95302616"];

function QueueConfirm({group,rows}:{group:string;rows:ScoreRow[]}){
 const [gps,setGps]=useState(''),[msg,setMsg]=useState(''),[alertId,setAlertId]=useState(''),[busy,setBusy]=useState(false);const dual=group==='priority_review',quality=group==='data_quality_review';const selected=rows.find(r=>String(r.gpsno)===gps);
 async function go(){if(!selected)return;setBusy(true);setMsg('');try{const r=await alertConfirm({gpsno:String(selected.gpsno),rule_code:dual?'dual_signal_priority':'data_verification',evidence_id:String(selected.queue_id),occurred_at:String(selected.as_of_date)});setAlertId(r.alert_id);setMsg(r.idempotent_replay?'该车辆已有待核对记录，可继续处理。':'已建立待核对记录，请检查证据并填写处理结果。');window.dispatchEvent(new Event('claw:center-refresh'))}catch(e){const code=e instanceof ApiError?e.code:'';setMsg(({rule_dual_not_top20pct:'该车不符合优先核查条件，请刷新列表。',rule_dual_behavior_not_CD:'该车等级已变化，请刷新列表。',rule_data_low_confidence_required:'该车数据已恢复，无需再建立设备核验。',evidence_not_found:'评分记录已更新，请刷新后重新选择。',evidence_mismatch:'车辆与评分记录不一致，请刷新。',bad_request:'请先选择一辆车。',case_closed_reopen_requires_new_alert:'该记录已关闭，请前往告警管理查看处理结果。'} as Record<string,string>)[code]||'未能建立记录，请稍后重试。')}finally{setBusy(false)}}
 const description=dual?'这类车辆的行为评分和预测结果都需要关注。建立核查记录后，由安全员核对事件并记录处理结果。':quality?'这类车辆的数据不足或设备可能异常。请先检查设备、采集覆盖和数据缺失情况。':group==='behavior_coaching'?'查看车辆的主要风险，联系司机并安排针对性培训。':group==='prediction_review'?'核对预测结果与事件证据，确定是否需要跟进。':'持续关注评分变化，按需联系司机。';
 return <section className="panel risk-queue-action"><h3>{dual?'建立风险核查记录':quality?'安排设备与数据检查':'下一步处理'}</h3><p className="meta">{description}</p>{(dual||quality)&&<div className="row"><select aria-label="选择核查车辆" value={gps} disabled={busy} onChange={e=>{setGps(e.target.value);setMsg('');setAlertId('')}}><option value="">请选择车辆</option>{rows.map(r=><option key={String(r.queue_id)} value={String(r.gpsno)}>{vehicleLabel(r.gpsno)}</option>)}</select><button className="btn primary" disabled={busy||!selected} onClick={()=>void go()}>{busy?'正在建立…':dual?'建立核查记录':'建立检查任务'}</button></div>}{!dual&&!quality&&<a className="btn" href="#/ev-actions">查看车辆处置与培训</a>}{msg&&<p role="status" className="alert info">{msg}{alertId&&<a className="btn" href={'#/rm-alerts?alert_id='+encodeURIComponent(alertId)}>去处理</a>}</p>}</section>;
}

function RmReplay() { return <FullReplay />; }

function RmAlerts({ initialAlertId }: { initialAlertId?: string | null }) {
  const [vehicleQuery,setVehicleQuery]=useState(''),[vehicleFilter,setVehicleFilter]=useState(''),[vehicleError,setVehicleError]=useState('');
  const archiveDetailRef=useRef<HTMLElement>(null),archiveListRef=useRef<HTMLDivElement>(null);
  const [tick, setTick] = useState(0);
  const [copiedMessage,setCopiedMessage]=useState('');
  async function copyMessage(id:string,text:string){try{await navigator.clipboard.writeText(text);setCopiedMessage(id);setTimeout(()=>setCopiedMessage(value=>value===id?'':value),1800)}catch{setMsg('复制失败，请选中文字复制。')}}
  const [openId, setOpenId] = useState<string | null>(initialAlertId || null);
  const [cs, setCs] = useState<CaseViewT | null>(null);
  useEffect(()=>{if(cs)archiveDetailRef.current?.scrollIntoView({behavior:'smooth',block:'start'})},[cs?.alert?.alert_id]);

  const [msg, setMsg] = useState<string | null>(null);
  const [draft, setDraft] = useState("");
  const [sending, setSending] = useState(false);
  const [closeReason, setCloseReason] = useState("");
  const [contactAt, setContactAt] = useState(""); const [noteTxt, setNoteTxt] = useState("");
  useEffect(() => {
    const take = () => { try { const raw = sessionStorage.getItem("claw_fill"); if (!raw) return false; const ft = JSON.parse(raw); if (ft.form !== "rm3_draft") return false; if (ft.alert_id) { setOpenId(String(ft.alert_id)); if (ft.draft_text) setDraft(String(ft.draft_text)); sessionStorage.removeItem("claw_fill"); setFillNote("已填入 AI 草稿（可编辑）：保存草稿仅建 draft；确认前不会发送"); } return true; } catch { return false; } };
    if (!take()) setFillNote(null);
    const onHash = () => { const m = location.hash.match(/[?&]alert_id=([^&#]+)/); if (m) setOpenId(decodeURIComponent(m[1])); take(); };
    window.addEventListener("hashchange", onHash); window.addEventListener("claw:fill", onHash as never);
    return () => { window.removeEventListener("hashchange", onHash); window.removeEventListener("claw:fill", onHash as never); };
  }, []);
  const [fillNote, setFillNote] = useState<string | null>(null);
  useEffect(() => {
    if (openId) caseView(openId).then((v) => { setCs(v); const d = v.interventions.find((i) => i.status === "draft"); if (d) setDraft(String(d.draft_text || "")); }).catch(() => setCs(null));
    else setCs(null);
  }, [openId, tick]);
  async function act(fn: () => Promise<unknown>, okMsg: string) {
    setMsg(null); setSending(true);
    try {
      await fn();
      setMsg(okMsg);
      setTick((x) => x + 1);
    } catch (e) {
      const code = e instanceof ApiError ? e.code : "network";
      const text = { risk_actions_pending:"还有未完成的处置或培训任务，请完成后再关闭。",risk_review_and_action_required:"请先确认风险并记录已采取的处置措施。",risk_driver_feedback_required:"请先查看司机反馈，再关闭案卷。",risk_forbidden:"当前账号没有处理权限。",use_risk_monitor_workflow:"请刷新页面后重试。", alert_not_confined_as_confirmed: "拒绝：先在案卷内「确认证据属实」后才可建干预草稿", intervention_state_sent_not_editable: "已发送正文不可改写", intervention_state_invalid: "当前状态不允许该转移", close_reason_required: "关闭必须写明原因（已完成干预/证据不成立/转设备核验/重复记录）" }[code] || `拒绝：${code}`;
      setMsg(text);
    }
    setSending(false);
  }
  const al = cs?.alert as Record<string, unknown> | undefined;
  const st = String(al?.status || "");
  const draftRow = cs?.interventions.find((i) => i.status === "draft");
  return <div className="risk-archive">
    <PageHead code="RM03 / RM05" title="告警复核与事件档案" desc="核查报警证据，联系司机并跟进处理结果。" />
    <div ref={archiveListRef} className="archive-filter-toolbar"><input aria-label="检索车辆" placeholder="输入车辆编号" value={vehicleQuery} onChange={e=>setVehicleQuery(e.target.value)}/><button className="btn primary" onClick={()=>{const gps=vehicleId(vehicleQuery);if(vehicleQuery&&!vehicleOptions().some(v=>v.gpsno===gps)){setVehicleError('未找到该车辆');return}setVehicleError('');setVehicleFilter(gps);setOpenId(null)}}>检索车辆</button><select aria-label="选择车辆" value={vehicleFilter} onChange={e=>{setVehicleFilter(e.target.value);setVehicleError('');setVehicleQuery('');setOpenId(null)}}><option value="">全部车辆</option>{vehicleOptions().map(v=><option key={v.gpsno} value={v.gpsno}>{v.label}</option>)}</select></div>{vehicleError&&<p role="alert">{vehicleError}</p>}
    <ResourceTable key={`al${tick}-${vehicleFilter}`} params={vehicleFilter?{gpsno:vehicleFilter}:{}} resource="admin.alerts" columns={['gpsno','rule_code','occurred_at','status']} onRowClick={(r) => setOpenId(String(r.alert_id))} rowActionLabel="查看档案" labels={{gpsno:"车辆",rule_code:"预警原因",occurred_at:"发生时间（北京时间）",status:"处理状态"}} />
    {cs && al && <section ref={archiveDetailRef} className="panel archive-detail">
      <header className="archive-detail-heading"><div><small>事件档案</small><h3>{vehicleLabel(al.gpsno)} · {cellView('rule_code',al.rule_code)}</h3></div><Tag tone={st==='closed'?'green':'blue'}>{cellView('status',st)}</Tag><button className="btn" onClick={()=>{setOpenId(null);setMsg(null);archiveListRef.current?.scrollIntoView({behavior:'smooth',block:'start'})}}>返回列表</button></header>
      <div className="archive-summary"><div><span>发生时间</span><b>{cellView('occurred_at',al.occurred_at)}</b></div><div><span>司机账号</span><b>{cs.demo_binding?'已关联':'尚未关联'}</b></div><div><span>下一步</span><b>{st==='pending_review'?'核查报警情况':st==='confirmed'?'联系司机并跟进':st==='closed'?'已结束处理':'查看处理记录'}</b></div></div>
      <div className="archive-detail-grid"><section className="archive-section"><h4>核查与沟通</h4>
      {st==='pending_review'&&<div className="archive-review"><p>核实报警情况后，选择处理结果。</p><div className="row"><button className="btn primary" disabled={sending} onClick={()=>act(()=>alertStatus(String(al.alert_id),'confirmed'),'已确认报警情况')}>确认风险</button><button className="btn" disabled={sending} onClick={()=>act(()=>alertStatus(String(al.alert_id),'duplicate'),'已标记为误报或重复')}>误报或重复</button><button className="btn" disabled={sending} onClick={()=>act(()=>alertStatus(String(al.alert_id),'supplement_data'),'已标记为需要补充核查')}>需要进一步核查</button></div></div>}
      {st==='confirmed'&&<div className="stack"><label>给司机的消息<textarea aria-label="司机沟通内容" placeholder="说明需要司机注意的问题及下一步措施" value={draft} onChange={e=>setDraft(e.target.value)}/></label><div className="row">{!draftRow?<button className="btn primary" disabled={sending||!draft.trim()} onClick={()=>act(()=>interventionDraft(String(al.alert_id),draft),'沟通草稿已保存，请确认发送')}>保存消息草稿</button>:<><button className="btn" disabled={sending||!draft.trim()} onClick={()=>act(()=>interventionEdit(String(draftRow.intervention_id),draft),'消息草稿已更新')}>保存修改</button><button className="btn primary" disabled={sending||!draft.trim()||draft!==String(draftRow.draft_text||'')} onClick={()=>act(()=>interventionSend(String(draftRow.intervention_id)),'消息已发送给司机')}>发送给司机</button></>}</div></div>}
      {st!=='closed'&&<details className="archive-more"><summary>其他跟进安排</summary><div className="stack"><label>安排回访日期<input type="date" aria-label="回访日期" value={contactAt} onChange={e=>setContactAt(e.target.value)}/></label><button className="btn" disabled={sending||!contactAt} onClick={()=>act(()=>alertContact(String(al.alert_id),contactAt),'回访日期已保存')}>保存回访日期</button><label>处理备注<textarea aria-label="处理备注" placeholder="记录处理进展或需要跟进的事项" value={noteTxt} onChange={e=>setNoteTxt(e.target.value)}/></label><button className="btn" disabled={sending||!noteTxt.trim()} onClick={()=>act(()=>alertNote(String(al.alert_id),noteTxt),'处理备注已保存')}>保存备注</button></div></details>}
      {st!=='closed'&&<details className="archive-more"><summary>结束本次处理</summary><div className="row"><select aria-label="结束处理原因" value={closeReason} onChange={e=>setCloseReason(e.target.value)}><option value="">选择处理结果</option>{['已完成干预','证据不成立','转设备核验','重复记录'].map(x=><option key={x}>{x}</option>)}</select><button className="btn" disabled={sending||!closeReason} onClick={()=>act(()=>alertStatus(String(al.alert_id),'closed',closeReason),'案卷已关闭')}>关闭案卷</button></div></details>}
      {fillNote&&<p role="status">已填入沟通草稿，可修改后发送。</p>}{msg&&<p className="alert info" role="status">{msg}</p>}</section>
      <section className="archive-section"><h4>处理记录</h4>{!cs.timeline.length&&!cs.interventions.length&&<p className="archive-empty">暂无处理记录</p>}<ol className="archive-timeline">{cs.timeline.map(e=><li key={String(e.audit_id)}><b>{({confirmed:'已确认风险',closed:'已关闭案卷',duplicate:'已标记误报或重复',supplement_data:'已安排补充核查',sent:'已发送司机消息',read:'司机已读',replied:'司机已回复'} as Record<string,string>)[String(e.new_status)]||({'risk.case_confirm':'已确认风险','risk.case_false_alarm':'已标记误报或重复','risk.case_insufficient':'已安排进一步核查','risk.case_ack':'已响应待办','risk.case_intervene':'已记录处置措施','risk.case_close':'已关闭案卷','risk.driver_feedback':'司机已提交反馈','alert.note':'已添加处理备注','alert.contact':'已安排回访','alert.handoff':'已转交处理'} as Record<string,string>)[String(e.action)]||'处理记录已更新'}</b><time>{cellView('occurred_at',e.occurred_at)}</time></li>)}</ol>{cs.interventions.map(i=><article className="archive-message" key={String(i.intervention_id)}><button className="archive-copy" aria-label={copiedMessage===String(i.intervention_id)?'已复制':'复制消息正文'} title={copiedMessage===String(i.intervention_id)?'已复制':'复制'} onClick={()=>void copyMessage(String(i.intervention_id),String(i.sent_text||i.draft_text||''))}>{copiedMessage===String(i.intervention_id)?<span role="status">已复制</span>:<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" aria-hidden="true"><rect x="4" y="8" width="12" height="13" rx="2"/><path d="M9 8V5a2 2 0 0 1 2-2h7a2 2 0 0 1 2 2v9a2 2 0 0 1-2 2h-2"/></svg>}</button><b>{i.sent_at?'已发送消息':'消息草稿'}</b><p>{String(i.sent_text||i.draft_text||'')}</p>{Boolean(i.sent_at)&&<small>发送于 {cellView('occurred_at',i.sent_at)}</small>}{Boolean(i.read_at)&&<small>司机已读</small>}{Boolean(i.reply_text)&&<div><b>司机回复</b><p>{String(i.reply_text)}</p></div>}</article>)}</section></div>
    </section>}

  </div>;
}

const TASK_STATUSES = ["assigned", "in_progress", "submitted", "reviewed", "returned", "observation", "interview"];

function TaskDetail({ taskId, onBack }: { taskId: string; onBack: () => void }) {
  const trainingNames=useTrainingNames();
  const [deleting,setDeleting]=useState(false),[deleteError,setDeleteError]=useState("");
  const [v, setV] = useState<Awaited<ReturnType<typeof taskView>> | null | "error">(null);
  useEffect(() => { taskView(taskId).then(setV).catch(() => setV("error")); }, [taskId]);
  if (v === "error") return <EmptyState kind="error" />;
  if (!v) return <EmptyState kind="loading" />;
  const { task, alert, course, timeline, reassess } = v;
  const now = new Date();
  const overdue = ["assigned", "in_progress", "returned"].includes(String(task.status)) && task.due_at && new Date(String(task.due_at)) < now;
  const requirement=String(course?.completion_requirement||"完成课程要求后提交验收");
  const passScore=requirement.match(/(\d+)分/);
  const questionCount=requirement.match(/(\d+)道/);
  const steps=requirement.split(/[；;。]/).map(x=>x.trim()).filter(Boolean);
  async function removeTask(){if(!window.confirm('确认删除这项培训任务？司机端将同步移除此任务，已有学习记录与操作记录会保留。'))return;setDeleting(true);setDeleteError('');try{await api('/api/training-tasks/'+encodeURIComponent(taskId)+'/delete',{method:'POST',body:JSON.stringify({})});onBack()}catch{setDeleteError('删除未完成，请刷新任务后重试。')}finally{setDeleting(false)}}
  return <div className="panel training-task-detail">
    <div className="task-detail-heading"><button className="btn" onClick={onBack}>← 返回台账</button><span className="task-detail-label">培训任务</span><Tag tone="blue">{trainingStatus(task.status)}</Tag>{overdue ? <Tag tone="red">已逾期</Tag> : null}<button className="btn task-delete" disabled={deleting} onClick={()=>void removeTask()}>{deleting?'删除中…':'删除任务'}</button></div>
    {deleteError&&<div className="alert warn" role="alert">{deleteError}</div>}
    <header className="task-course-heading"><p>{trainingNames.driver(task.driver_id)}</p><h2>{String(course?.title||trainingNames.course(task.course_id))}</h2><div className="task-facts"><div><span>培训要求</span><strong>{task.mandatory?'必修':'选修'}</strong></div><div><span>截止日期</span><strong>{task.due_at?new Date(String(task.due_at)).toLocaleDateString('zh-CN'):'未设置'}</strong></div><div><span>{requirement.includes('建议通过')?'建议通过分数':'通过条件'}</span><strong>{passScore?passScore[1]+' 分':'按课程要求验收'}</strong></div>{questionCount&&<div><span>课程题量</span><strong>{questionCount[1]} 道题</strong></div>}</div></header>
    <div className="task-detail-columns"><section className="task-detail-section"><h3>学习要求</h3><ol className="task-requirements">{steps.map((step,i)=><li key={i}>{step}</li>)}</ol><div className="task-goal"><h4>学习目标</h4><p>{String(task.goal||'完成课程学习并提交反馈')}</p></div><div className="task-related"><span>关联风险</span><b>{alert?cellView('rule_code',alert.rule_code):'未关联风险记录'}</b></div></section>
    <section className="task-detail-section"><h3>学习进展与反馈</h3>{parseEditable(course?.content)?<CustomLearning taskId={String(task.task_id)} review/>:isInteractiveCourse(task.course_id)?<><QuizScoreSummary record={task.learning_record}/><AdminQuizReview taskId={String(task.task_id)}/></>:<PersonalRecord record={task.learning_record}/>}<div className="task-feedback"><h4>司机反馈</h4><p>{String(task.feedback||'暂未提交反馈')}</p></div>{Boolean(task.review_note)&&<div className="task-feedback"><h4>审核意见 · {String(task.reviewed_at||'').slice(0,10)}</h4><p>{String(task.review_note)}</p></div>}</section></div>
    {task.status==='submitted'&&<ReviewBench initialTaskId={taskId} onReviewed={()=>{taskView(taskId).then(setV).catch(()=>setV("error"))}}/>}
    <h4 style={{ fontSize: 13, marginTop: 10 }}>培训处理记录</h4>
    {timeline.map((e) => <div key={String(e.audit_id)} className="task-card"><div className="t"><span className="mono">{e.new_status?trainingStatus(e.new_status):'任务记录已更新'}</span></div><div className="meta">{new Date(String(e.occurred_at)).toLocaleString('zh-CN',{timeZone:'Asia/Shanghai',hour12:false})} · </div></div>)}
    {timeline.length === 0 && <EmptyState kind="nomatch" hint="尚无动作" />}
    <h4 style={{ fontSize: 13, marginTop: 8 }}>培训后评分观察</h4>
    {reassess?.date ? <p style={{ fontSize: 13 }}>{reassess.date}：安全分 {String(reassess.row?.safety_score)} · 等级 {String(reassess.row?.risk_level)} · 可信度 {trainingStatus(reassess.row?.confidence_level)}</p>
      : <p className="meta">待下一周期数据</p>}
  </div>;
}

function ReviewBench({initialTaskId=null,onReviewed}:{initialTaskId?:string|null;onReviewed?:()=>void}={}) {
  const [sel, setSel] = useState<string | null>(initialTaskId);
  const [detail, setDetail] = useState<Awaited<ReturnType<typeof taskView>> | null>(null);
  const [decision, setDecision] = useState("approved");
  const [reason, setReason] = useState("");
  const [msg, setMsg] = useState<string | null>(null);
  const [sum, setSum] = useState<TaskSummary | "loading" | null>(null);
  const [chk, setChk] = useState<string | null>(null);
  useEffect(() => { if (sel) { taskView(sel).then((v) => setDetail(v)).catch(() => setDetail(null)); setSum(null); setChk(null); } }, [sel]);
  async function send() { setMsg(null); try { const r = await taskReview(sel!, decision, reason); setMsg(`审核完成：${trainingStatus(r.new_status)}`); setSel(null); onReviewed?.(); } catch (e) { setMsg("审核被拒：" + (e instanceof ApiError ? e.code==='quiz_remediation_required'?'成绩或关键操作题未达标，请退回补学后再验收':e.code : "network") + "（需已提交状态及审核理由）"); } }
  return <div>
    <h3 style={{ fontSize: 14 }}>培训反馈与验收</h3>
    {sel && detail && <div className="panel" style={{ marginTop: 10 }}>
      <h3>复核详情</h3>
      <div className="training-review-grid">
        <div className="task-card" style={{ padding: 8 }}>
          <div className="t">① 司机学习反馈</div>
          <QuizScoreSummary record={detail.task.learning_record} />
          {isInteractiveCourse(detail.task.course_id) ? <AdminQuizReview taskId={String(detail.task.task_id)} /> : <div id="tr06-original"><PersonalRecord record={detail.task.learning_record}/></div>}
          <div className="meta">提交时间：{String(detail.task.submitted_at || "—")} · 状态：{trainingStatus(detail.task.status)}</div>
        </div>
        <div className="task-card" style={{ padding: 8 }}>
          <div className="t">② 课程学习要求</div>
          <div className="kv"><span className="kk">课程</span><b>{String(detail.course?.title || "—")}</b></div>
          <div className="kv"><span className="kk">完成条件</span><b>{String(detail.course?.completion_requirement || "—")}</b></div>
          <div className="kv"><span className="kk">学习目标</span><b>{String(detail.task.goal || "—")}{detail.task.mandatory ? " · 必修" : " · 选修"}</b></div>
          <div className="meta">课程当前状态：{String((detail.course as { content_status?: string } | undefined)?.content_status || "—")}{(detail.course as { content_status?: string } | undefined)?.content_status === "disabled" ? "（课程已停用——本处仍展示分配时的历史版本要求，不回写不删除）" : ""}</div>
        </div>
        <div className="task-card" style={{ padding: 8 }}>
          <div className="t">③ 关联风险记录</div>
          {detail.task.alert_id ? <>
            <div className="kv"><span className="kk">关联案卷</span><b className="mono">已关联风险案卷</b></div>
            <div className="kv"><span className="kk">规则/证据</span><b>{cellView('rule_code',detail.alert?.rule_code)}</b></div>
            <div className="kv"><span className="kk">事实日期</span><b>{String((detail as { alert?: { occurred_at?: string } }).alert?.occurred_at || "—")}</b></div>
          </> : <div className="alert info">本任务未关联风险记录</div>}
        </div>
        <div className="task-card" style={{ padding: 8, borderColor: "#b9cbe8", background: "#f6f9ff" }}>
          <div className="t">④ 学习摘要</div>
          <button className="btn" disabled={sum === "loading"} onClick={async () => { setSum("loading"); try { setSum(await taskSummary(sel!)); } catch { setSum({ available: false, note: "生成失败，请稍后重试" }); } }}>{sum === "loading" ? "生成中…" : sum && typeof sum === "object" && sum.available ? "重新生成摘要" : "生成学习摘要"}</button>
          {sum === "loading" && <div className="meta">正在生成学习摘要…</div>}
          {sum && typeof sum === "object" && !sum.available && <div className="alert warn">AI 摘要暂不可用：{String(sum.reason || "")} —— {String(sum.note || "前三部分与人工审核照常可用")}</div>}
          {sum && sum !== "loading" && sum.available && <>
            {sum.cached ? <div className="meta">（10 分钟内复用缓存结果，未重复计费/调用）</div> : null}
            {sum.course ? <div className="meta">课程版本核对：v{sum.course.version_no} · {trainingStatus(sum.course.current_status)}{sum.course.note ? " · " + sum.course.note : ""}</div> : null}
            {(sum.items || []).map((it, n) => <div key={n} className="task-card" style={{ padding: 6, marginTop: 5 }}>
              <div style={{ fontSize: 12.5 }}><b>{it.judgment}</b> <Tag tone={it.state === "覆盖" ? "green" : it.state === "未见" ? "amber" : "gray"}>{it.state}</Tag>{!it.ref_ok ? <Tag tone="red">关联依据待核查</Tag> : null}</div>
              <div className="meta" style={{ fontSize: 11.5 }}>依据：{it.fact} → <button className="btn" style={{ padding: "0 6px", fontSize: 11 }} onClick={async () => { const ref = it.ref.startsWith("task:") ? null : it.ref; if (!ref) { document.getElementById("tr06-original")?.scrollIntoView({ block: "center" }); setChk("已定位到 ① 原文（同一记录）"); return; } try { const rr = await aiEvidenceCheck(ref); if (rr.ok && rr.route) { location.hash = rr.route.replace(/^#/, ""); setChk("引用重新验权通过：" + ref); } else setChk("该引用重新验权未通过或记录已变化（不缓存旧数据）"); } catch { setChk("引用验权失败"); } }}>查看依据 ↗</button></div>
            </div>)}
          </>}
          {chk && <div className="alert info">{chk}</div>}
        </div>
      </div>
      <div className="row" style={{ marginTop: 8 }}>
        <select className="btn" style={{ background: "#fff" }} value={decision} onChange={(e) => setDecision(e.target.value)} aria-label="审核决定"><option value="approved">通过</option><option value="returned">退回补充</option><option value="observe">继续观察</option><option value="interview">转面谈</option></select>
        <input className="btn" style={{ flex: 1, textAlign: "left", minWidth: 200 }} value={reason} onChange={(e) => setReason(e.target.value)} placeholder="审核理由（必填；先看原文再填写）" aria-label="审核理由" />
        <button className="btn primary" style={{ width: "auto" }} onClick={send} disabled={!reason.trim()}>确认审核结果</button>
        <button className="btn" onClick={() => setSel(null)}>收起</button>
      </div>
      <p className="meta">学习摘要供审核参考，最终结果由安全员确认。</p>
      {msg && <div className="alert info">{msg}</div>}
    </div>}
    {sel && !detail && <div className="meta">任务读取失败或无权访问</div>}
  </div>;
}

function TrLedger()  {
  const tid = new URLSearchParams(location.hash.split('?')[1]).get('task_id')||new URLSearchParams(location.hash.split('?')[1]).get('task')||'';
  const [sel, setSel] = useState<string | null>(tid||null);
  if (sel) return <TaskDetail taskId={sel} onBack={() => { setSel(null); }} />;
  return <div><TrainingNotificationRecovery/>
    <PageHead code="TR01" title="培训任务台账" desc="筛选培训任务，勾选所需记录后批量删除；统计随实际任务同步更新。" />
    <TrainingLedger onOpen={setSel}/>
  </div>;
}

function TrCourses(){const [tab,setTab]=useState(0);const [pending,setPending]=useState(0);useEffect(()=>{coursesBoard().then(r=>setPending((r.courses as Record<string,unknown>[]).filter(c=>String(c.content_status)!=="deleted"&&["draft","pending_review","demo_draft_requires_team_review"].includes(String(c.content_status))).length)).catch(()=>{})},[]);return <div><PageHead code="TR05" title="课程库与审核" desc=""/><div className="row course-catalog-tabs">{['课程目录',`课程新增与审核${pending?`（${pending} 门待处理）`:''}`,'备选课程组'].map((t,i)=><button className={'btn '+(tab===i?'primary':'')} key={t} onClick={()=>setTab(i)}>{t}</button>)}</div>{tab===0?<><TrainingLibraryPanel catalogOnly/>{pending>0&&<div className="alert info" style={{marginTop:8}}>有 {pending} 门课程草稿等待审核：切换到「课程新增与审核」标签，点课程行的「查看与审核」即可提交审核、审核通过或退回。</div>}</>:tab===1?<CourseBoard/>:<CourseGroups/>}</div>;}

function AccountAdmin() { return null; }
function TemplateInsertRow(props: { gpsno: string; driverId: string; onInsert: (t: string) => void }) {
  const [opts, setOpts] = useState<{ migration_pending?: boolean; latest?: { template_id: string; template_key: string; version: number; title: string; review_status: string }[] } | null>(null);
  const [sel, setSel] = useState(""); const [note, setNote] = useState<string | null>(null);
  useEffect(() => { fetch("/api/admin/templates?review_status=approved&scene=rm3_draft", { credentials: "include" }).then((r) => r.json()).then((j) => setOpts(j)).catch(() => setOpts({ latest: [] })); }, []);
  const approved = (opts?.latest || []).filter((x) => x.review_status === "approved");
  if (opts && opts.migration_pending) return <div className="meta">通知模板暂不可用。<b>可编辑草稿</b>。</div>;
  return <div className="row" style={{ gap: 6, margin: "4px 0", flexWrap: "wrap" }}>
    <select className="btn" style={{ width: "auto", maxWidth: 260 }} value={sel} onChange={(e) => setSel(e.target.value)} aria-label="模板选择"><option value="">从已审核模板插入…（{approved.length ? approved.length + " 个可用" : "暂无 approved 模板——不会凭空插入"}）</option>{approved.map((a) => <option key={a.template_id} value={a.template_id}>{a.template_key}:v{a.version} · {a.title}</option>)}</select>
    <button className="btn" disabled={!sel} onClick={async () => { try { const r = await fetch(`/api/admin/template-preview?template_id=${encodeURIComponent(sel)}&driver_id=${encodeURIComponent(props.driverId)}`, { credentials: "include" }).then((x) => x.json()); if (r.ok && r.rendered) { props.onInsert(String(r.rendered)); setNote("预览已插入正文（可编辑；缺事实保留（待核：…））" + (r.missing_facts?.length ? " · 缺：" + r.missing_facts.join("、") : "") + (r.bound_account ? "" : " · 该司机无已核实绑定：发送后不会显示已送达") + "；发送仍需人工确认"); } else setNote(String(r.error || r.note || "预览不可用（未审核模板已拒绝）")); } catch { setNote("预览失败"); } }}>预览并插入草稿</button>
    {note && <span className="meta">{note}</span>}
  </div>;
}

function SmAccounts({canCreateAdmin=true}:{canCreateAdmin?:boolean}) {
  return <div>
    <PageHead code="SM01" title="账号与角色管理" desc="司机账号已按绑定车辆的C/D评级整理。每行操作区提供编辑、停用/恢复和删除账号；删除后立即退出登录，历史业务记录保留。" />
    <AgentAccountImportPanel />
    <AccountAdminPanel canCreateAdmin={canCreateAdmin}/>

  </div>;
}

function BindPanel() { return <BindingsPanelLazy />; }
function BindingsPanelLazy() {
  const [drv, setDrv] = useState<{ driver_id: string; gpsno: string }[] | null>(null);
  useEffect(() => { let alive = true; (async () => {
    const rows: { driver_id: string; gpsno: string }[] = [];
    for (let offset = 0; ; offset += 200) { const r = await getData<{ driver_id: string; gpsno: string }>("admin.drivers", { limit: 200, offset }); rows.push(...r.rows); if (r.rows.length < 200) break; }
    if (alive) setDrv(rows);
  })().catch(() => { if (alive) setDrv([]); }); return () => { alive = false; }; }, []);
  if (!drv) return <div className="meta">读取司机档案…</div>;
  return <BindingsConsole drivers={drv} />;
}

function SmBindings() {
  return <div>
    <PageHead code="SM02" title="司机与车辆绑定" desc="绑定关系写 user_bindings（account/user 体系），展示 gpsno、driver_id、平台账号、identity_status、生效起止与演示身份标识；drivers 表冻结映射、历史评分与预测快照永不改写。日期语义：闭区间含首尾日；相邻(次日开始)允许；空结束=持续有效。结束早于开始、同车重叠跨账号、同账号同窗多司机均在服务端强制拒绝（编辑排除自身；并发经进程内互斥+写后回读自动回滚——多副本部署时该保护降级，需平台事务/唯一约束）。未核实的绑定不会下发个人明细（my.* 403）。as_of 可回看历史当日有效关系。" />
    <BindingsPanelLazy /><details className="panel"><summary>未绑定车辆档案</summary><DriverAccountsPage onlyUnlinked/></details>
  </div>;
}

function OpConfigPanel() {
  const [rows, setRows] = useState<ScoreRow[] | null>(null);
  const [sel, setSel] = useState(""); const [val, setVal] = useState(""); const [eff, setEff] = useState("");
  const [msg, setMsg] = useState<string | null>(null);
  const [ver, setVer] = useState<string | null>(null);
  useEffect(() => { getData<ScoreRow>("admin.operation_config").then((r) => { setRows(r.rows); const c = r.rows.find((x) => x.config_id === "drop_threshold"); if (c) { setSel("drop_threshold"); setVer(String(c.config_version)); setVal(String(c.value)); } }).catch(() => setRows([])); }, []);
  async function upd() {
    setMsg(null);
    try {
      const r = await opsConfigUpdate({ config_id: sel, value: val, effective_at: eff || undefined });
      setMsg(`已生成新版本 v${r.new_version}：${r.old_value} → ${r.new_value}，生效 ${r.effective_at}，审计 ${r.audit_id}`);
      const g = await getData<ScoreRow>("admin.operation_config"); setRows(g.rows);
    } catch (e) { setMsg(e instanceof ApiError ? `拒绝：${e.code}` : "网络异常"); }
  }
  return <div>
    <ResourceTable renderCell={systemCell} resource="admin.operation_config" labels={{ config_id: "配置项", value: "值", unit: "单位", config_version: "版本", updated_by: "修改人", updated_at: "修改时间", effective_at: "生效时间" }} />
    <div className="panel" style={{ marginTop: 10 }}><h3>修改运营参数（产生新版本，需安全管理员确认）</h3>
      <div className="row">
        <select className="btn" style={{ background: "#fff" }} value={sel} onChange={(e) => { setSel(e.target.value); const x = (rows || []).find((y) => y.config_id === e.target.value); if (x) setVal(String(x.value)); }}>{(rows || []).map((x) => <option key={String(x.config_id)} value={String(x.config_id)}>{systemLabel(x.config_id)}（当前 {systemLabel(x.value)} {systemLabel(x.unit || "")}）</option>)}</select>
        <input className="btn" style={{ width: 120, textAlign: "left" }} value={val} onChange={(e) => setVal(e.target.value)} placeholder="新值" aria-label="新值" />
        <input className="btn" style={{ width: 210, textAlign: "left" }} value={eff} onChange={(e) => setEff(e.target.value)} placeholder="生效时间（默认现在）" aria-label="生效时间" />
        <button className="btn primary" style={{ width: "auto" }} onClick={upd} disabled={!sel || !val}>确认修改并升版</button>
      </div>
      {msg && <div className="alert info">{msg}</div>}
    </div>
    <MandatePolicyCard />
  </div>;
}

function OfficerParameters(){return <div className="stack"><h2>评分规则与运营参数</h2><p className="meta">参数由管理员维护。</p><section className="panel"><h3>评分维度与权重</h3><ResourceTable resource="admin.evaluation_rules" columns={["dimension_name","weight","window_days"]} labels={{dimension_name:"评价维度",weight:"权重",window_days:"观察天数"}} renderCell={(key,v)=>key==="weight"?(Number(v)*100).toFixed(2)+"%":String(v??"—")}/></section><section className="panel"><h3>运营参数</h3><ResourceTable resource="admin.operation_config" renderCell={(key,v)=>key.endsWith('_at')&&v?new Date(String(v)).toLocaleString('zh-CN',{timeZone:'Asia/Shanghai',hour12:false}):key==='config_id'&&v==='training_start_days'?'培训开始时限':key==='unit'?({flag:'开关',json:'规则',days:'天'} as Record<string,string>)[String(v)]||String(v??'—'):key==='value'&&['on','off'].includes(String(v))?v==='on'?'开启':'关闭':systemCell(key,v)} labels={{config_id:"配置项",value:"当前设置",unit:"单位",config_version:"版本",updated_at:"更新时间",effective_at:"生效时间",updated_by:"修改人"}}/></section></div>;}
function SmConfig({admin=true}:{admin?:boolean}) {
  const [tab, setTab] = useState(admin?0:1);
  if(!admin)return <OfficerParameters/>;
  return <div>
    <PageHead code="SM03 · 数据截止 2026-07-31" title="评价规则与运营配置" desc="" />
    <div className="row">
      {admin&&<button className="btn" style={tab === 0 ? { borderColor: "var(--navy)", color: "var(--navy)" } : undefined} onClick={() => setTab(0)}>评分规则</button>}
      <button className="btn" style={tab === 1 ? { borderColor: "var(--navy)", color: "var(--navy)" } : undefined} onClick={() => setTab(1)}>运营参数</button><button className="btn" onClick={()=>setTab(2)}>规则草案与审核</button>
    </div>
    <div style={{ height: 10 }} />
    {admin&&tab === 0 && <><WeightEditor /><ModelRulesEditor /></>}
    {tab === 1 && <OpConfigPanel />}{tab===2&&<><ModelGovernance/><details className="panel"><summary>旧版说明草案留档</summary><p className="meta">下列旧版说明草案保留查询；修改正式评分参数请使用上方模型参数表与审核。</p><SmDraftsPage/></details></>}
  </div>;
}

function SmAudit() {
  const [tick, setTick] = useState(0);
  return <div key={tick}>
    <PageHead code="SM04" title="数据版本与审计" desc="快照版本、导入运行台账、校验（概率一致性/评分对账/主键检查）与按操作者/对象/日期的操作日志。" />
    <ImportPanel onCommitted={() => setTick((v) => v + 1)} />

    <h3 style={{ fontSize: 14, margin: "6px 0" }}>数据导入记录</h3>
    <ResourceTable renderCell={systemCell} resource="admin.import_runs" labels={{ run_id: "导入编号", filename: "文件", target_table: "目标表", source_version: "版本口径", check_status: "预检", row_total: "行数", accepted_count: "接受", rejected_count: "拒绝", dup_pk_count: "重复主键", type_error_count: "类型错误", unknown_columns: "未知列", actor_id: "操作者", created_at: "预检时间", committed_at: "写入时间", created_audit_id: "预检审计ID", commit_audit_id: "提交审计ID" }} />
    <h3 style={{ fontSize: 14, margin: "6px 0" }}>操作记录</h3>
    <AuditConsole />
  </div>;
}

function TrCreate(){return <div><PageHead code="TR02" title="创建培训" desc=""/><CourseGroups assign/></div>;}

function SmDrafts() { return <WeightEditor />; }
function SmKnowledge() {
  const [tab, setTab] = useState<"knowledge" | "templates">(() => new URLSearchParams(location.hash.split("?")[1]).get("tab") === "templates" ? "templates" : "knowledge");
  return <div>
    <div className="row" style={{ gap: 6, margin: "4px 0 8px" }}>
      <button className="btn" style={tab === "knowledge" ? { borderColor: "var(--navy)", color: "var(--navy)" } : undefined} onClick={() => setTab("knowledge")}>知识条目</button>
      <button className="btn" style={tab === "templates" ? { borderColor: "var(--navy)", color: "var(--navy)" } : undefined} onClick={() => setTab("templates")} aria-label="通知模板标签">通知模板</button>
      <a className="meta" href="#/tr-courses" style={{ marginLeft: 8 }}>课程库与审核 ↗</a>
    </div>
    {tab === "knowledge" ? <SmKnowledgePage /> : <TemplatesTab />}
  </div>;
}

export function AdminShell({ user, aiOpen, onAiToggle }: { user: MeUser; aiOpen: boolean; onAiToggle: () => void }) {
  const navigation=NAV.map(g=>({...g,items:g.items.filter(it=>(["safety_admin","safety_officer"].includes(user.role)||!["sm-drafts","sm-accounts"].includes(it.key))&&(it.key!=='handover'||['safety_admin','safety_officer'].includes(user.role)))}));
  const [routeKey, setRouteKey] = useState(() => location.hash);
  const route = (routeKey.replace(/^#\/?/, "") || "overview").split("?")[0];
  useEffect(() => {
    const onHash = () => setRouteKey(location.hash);
    window.addEventListener("hashchange", onHash);
    return () => window.removeEventListener("hashchange", onHash);
  }, []);
  const view = useMemo(() => {
    switch (route) {
      case "account-profile": return <AccountProfile user={user} />;
      case "handover": return <HandoverPage user={user}/>;
      case "daily-reports": return <AdminDriverReports/>;
      case "data-center": return <DataCenter />;
      case "ev-fleet": return <EvFleet />;
      case "ev-actions": return <EvaluationActionPage />;
      case "ev-week": return <EvWeek />;
      case "ev-driver": return <EvFleet />; // 详情需从列表行进入
      case "ev-review": return <EvReview />;
      case "ev-root": return <RootCausesPage />;
      case "rm-queue": return <RmQueue />;
      case "rm-live": return <RiskMonitorPage />;
      case "rm-replay": return <RiskMonitorPage />;
      case "rm-alerts": { const m = location.hash.match(/[?&]alert_id=([^&#]+)/); return <RmAlerts initialAlertId={m ? decodeURIComponent(m[1]) : null} />; }
      case "tr-ledger": return <TrLedger />;
      case "tr-courses": return <TrCourses />;
      case "tr-create": return <TrCreate />;
      case "tr-offline": return <OfflineTrainingPage />;
      case "sm-accounts": return <SmAccounts canCreateAdmin={user.role==="safety_admin"}/>;
      case "sm-driver-accounts": return <SmBindings/>;
      case "sm-bindings": return <SmBindings />;
      case "sm-config": return <SmConfig admin={user.role==="safety_admin"}/>;
      case "ai-preplan": return <RiskMonitorPage />;
      case "sm-audit": return <SmAudit />;
      case "sm-drafts": return <SmConfig admin={user.role==="safety_admin"}/>;
      case "sm-knowledge": return <SmKnowledge />;
      default: return <Dashboard canEdit={user.role==="safety_admin"} />;
    }
  }, [routeKey, user]);
  return <div className="admin-shell">
    <header className="topbar">
      <a className="app-brand" href="#/overview"><BrandMark/><span>易流智安<span className="brand-caption">驾驶安全管理</span></span></a>
      <GlobalSearch />
      <span className="spacer" />
      {user.localPreview && <span className="chip">本地测试环境</span>}
      <MessageButton /><ActionCenter />
      <span className="user"><a href="#/account-profile" aria-label="个人信息"><Avatar value={user.avatarUrl} name={user.displayName || user.username || "管"} size={36} /></a><span><b>{user.displayName || user.username}</b><span className="user-role">{user.role === "safety_admin" ? "管理员" : user.role==="safety_officer"?"安全员":user.role}</span></span><a className="profile-link" href="#/account-profile">个人信息</a><LogoutButton /></span>
    </header>
    <nav className="side" aria-label="主导航">
      {[{ index: 0, label: "数据总览", icon: 0 }, { index: 1, label: "车队管理", icon: 1 }, { index: 2, label: "风险监控", icon: 2 }, { index: 3, label: "培训管理", icon: 3 }].map(({ index, label, icon }) => {
        const active = navigation[index].items.some(it => it.key === route) || (index === 0 && route === "overview");
        return <a key={label} className={active ? "active" : ""} href={`#/${navigation[index].items[0].key}`} aria-current={active ? "page" : undefined}><NavIcon kind={icon} /><span>{label}</span></a>;
      })}
      <button className={aiOpen ? "active" : ""} onClick={onAiToggle} aria-pressed={aiOpen}><NavIcon kind={4} /><span>智能助手</span></button>
      <a className={route.startsWith("sm-") ? "active" : ""} href="#/sm-accounts" aria-current={route.startsWith("sm-") ? "page" : undefined}><NavIcon kind={5} /><span>系统管理</span></a>
      <a href="#/data-center" className={route === "data-center" ? "active" : ""}><NavIcon kind={0} /><span>数据中心</span></a>
    </nav>
    <main className="main" key={routeKey}>
      <RiskAlertBar />
      {navigation.filter(g => g.items.length > 1 && g.items.some(it => it.key === route)).map(g => <nav className="module-tabs" aria-label={g.group} key={g.group}>{g.items.filter(it => it.key !== "ev-driver" && (["safety_admin","safety_officer"].includes(user.role)||it.key!=="sm-drafts")).map(it => <a key={it.key} href={`#/${it.key}`} aria-current={route === it.key ? "page" : undefined} className={route === it.key ? "active" : ""}>{it.label.replace("/数据异议", "")}</a>)}</nav>)}
      {['rm-alerts','ev-review'].includes(route)&&new URLSearchParams(routeKey.split('?')[1]||'').get('return_vehicle')&&<a className="btn vehicle-back" href={'#/ev-fleet?gpsno='+encodeURIComponent(new URLSearchParams(routeKey.split('?')[1]||'').get('return_vehicle')!)+'&tab=3'}>← 返回上一级</a>}
      {['ev-fleet','rm-live'].includes(route)&&new URLSearchParams(routeKey.split('?')[1]||'').get('return_evaluation')&&<a className="btn vehicle-back" href={'#/ev-actions?driver_id='+encodeURIComponent(new URLSearchParams(routeKey.split('?')[1]||'').get('return_evaluation')!)}>← 返回上一级</a>}
      {route.startsWith("tr-")?<TrainingSurface>{view}</TrainingSurface>:route.startsWith("sm-")?<div className="system-surface">{view}</div>:view}
    </main>
  </div>;
}

import { logout } from "./api";
export function onAppLogout() { try { const owner = sessionStorage.getItem("claw_ai_owner"); if (owner) sessionStorage.removeItem("claw_ai_msgs_" + owner); sessionStorage.removeItem("claw_ai_owner"); sessionStorage.removeItem("claw_fill"); sessionStorage.removeItem("claw_fill_seen"); } catch {} }
function LogoutButton() {
  return <button className="btn" style={{ background: "var(--navy-line)", color: "#fff", borderColor: "var(--navy-line)", padding: "4px 10px" }} onClick={async () => { await logout().catch(() => {}); onAppLogout(); location.reload(); }}>退出</button>;
}
