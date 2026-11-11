import {DriverNotifications} from './driver-notifications';
import {Brand} from './brand';
import {driverText,driverDate} from './driver-shared';
import './driver-integrated.css';
import {AccountProfile,Avatar} from './account';
import {MessageButton} from './messaging';

import {DriverLiveRisks} from './risk-monitor';
import {OfflineTrainingAgenda} from './offline-training';
import {vehicleOptions} from './vehicles';
import { useEffect, useRef, useState } from "react";
import { DriverNavigationProvider, useDriverNavigation } from "./driver-navigation";
import { DriverRiskPanel, DriverTrainingCard } from "./driver-learning";
import { DriverReadError, numberText, finiteValue, driverDimensions } from "./driver-shared";
import { DriverEvidence } from "./driver-evidence";
import { DriverActions } from "./driver-actions";
import { DailyReportEntry, DailyReportPage } from './daily-report';
import type { DriverDestination } from "./driver-actions";
import type { FleetSummary } from "./api";import type { MeUser } from "./api";
import { ApiError, dailyReportNotifications, fleetSummary, getOwnProfile, updateOwnProfile, getData, interventionRead, interventionReply, logout, myNotes, noteRead, rrCreate,taskView } from "./api";
import { Banner, EmptyState, Tag, GlobalSearch} from "./ui";

function FleetStatsPanel() {
  const [fs, setFs] = useState<FleetSummary | "loading" | "error" | null>("loading");
  useEffect(() => { fleetSummary().then((r) => setFs(r)).catch(() => setFs("error")); }, []);
  return <div className="panel" style={{ borderColor: "var(--line)", background: "#fcf9ff" }} aria-label="anonymous fleet statistics panel">
    <h3>匿名车队统计</h3>
    {fs === "loading" && <EmptyState kind="loading" />}
    {fs === "error" && <div className="alert warn">无法获取车队统计：本账号未绑定/未核实或查询失败（服务端拒绝时不返回任何个人与车队数据）</div>}
    {typeof fs === "object" && fs && fs.data_status !== "ok" && (
      <div className={"alert " + (fs.data_status === "query_failed" ? "warn" : "info")}>
        {fs.data_status === "insufficient_sample" ? "样本不足：该车队有效评分人数少于 10，均值与分布已隐藏（隐私保护，不以 0 或空壳冒充）"
          : fs.note || "统计查询失败：请稍后重试（未以空值冒充 0）"}
        {fs.as_of_date ? " · 数据截止 " + fs.as_of_date : ""}
      </div>)}
    {typeof fs === "object" && fs && fs.data_status === "ok" && <>
      <div style={{ display: "flex", gap: 14, flexWrap: "wrap", fontSize: 13 }}>
        <span>数据截止 <b>{fs.as_of_date}</b></span>
        <span>有效评分人数 <b>{fs.valid_count}</b></span>
        <span>车队平均安全分 <b>{fs.average ?? "—"}</b></span>
        
      </div>
      {fs.distribution ? <div style={{ display: "grid", gridTemplateColumns: "repeat(4, 1fr)", gap: 6, marginTop: 8 }}>
        {(["A", "B", "C", "D"] as const).map((k) => { const v = (fs.distribution as Record<string, number>)[k] ?? 0; return <div key={k} className="task-card" style={{ padding: 6, textAlign: "center" }}>
          <div className="meta">{k} 级</div><div style={{ fontSize: 18, fontWeight: 700 }}>{v}</div>
          <div style={{ height: 4, background: "#dfe8f6", borderRadius: 2 }}><div style={{ height: 4, width: Math.round((v / (fs.valid_count || 1)) * 100) + "%", background: k === "D" ? "#b3261e" : k === "C" ? "#ad6800" : k === "B" ? "#1a56c4" : "#1a6b2a", borderRadius: 2 }} /></div>
        </div>; })}
      </div> : <div className="alert info" style={{ marginTop: 6 }}>{fs.note || "等级类别过细可能反推个人：本次不展示分布（人数与均值保留）"}</div>}
      <p className="login-note">{fs.note}</p>
    </>}
    
  </div>;
}

function TabBtn({ active, ico, label, onClick }: { active: boolean; ico: string; label: string; onClick: () => void }) {
  return <button className={active ? "active" : ""} onClick={onClick}><span className="ico" aria-hidden="true">{ico}</span>{label}</button>;
}



const dimensionHelp:Record<string,{name:string;description:string;items:string[]}>= {
 history:{name:'历史事故与未遂',description:'关注已经记录的事故和险些发生事故的情况，帮助复盘风险经历。',items:['事故','未遂事故']},
 fatigue_distraction:{name:'疲劳与分心',description:'关注是否因疲劳或其他活动影响对道路的持续观察和注意力。',items:['疲劳（闭眼）、困倦','打哈欠','注意力分散、频繁低头','打电话、看手机','抽烟']},
 driving_stability:{name:'驾驶稳定性',description:'主要看车辆行驶时能否保持车道、留足车距，并及时注意碰撞及盲区风险。',items:['前碰撞预警','左车道偏移、右车道偏移','车距过近','长时间压线','后盲区报警、右盲区报警']},
 road_rule:{name:'道路规则',description:'关注不同道路场景下的车速控制，尤其是路口、弯道和下坡等需要谨慎驾驶的位置。',items:['路口超速','主路弯道超速','危险路段超速','匝道超速','高速长下坡超速']},
 management:{name:'管理配合',description:'关注驾驶监测设备能否正常观察，及时发现并处理遮挡或角度异常。',items:['摄像头遮挡','摄像头角度扭转']},
 imu_evidence:{name:'IMU 风险佐证',description:'通过车辆惯性传感器的异常变化辅助观察车辆运动状态。它是传感器线索，不直接等同于某一种违规行为。',items:['加速度异常','角速度异常','速度差异常']}
};
function DimensionHelp({dimension}:{dimension:string}){const [open,setOpen]=useState(false);const info=dimensionHelp[dimension];if(!info)return null;return <span className="stability-help"><button className="stability-help-trigger" aria-label={'了解'+info.name} aria-expanded={open} onClick={()=>setOpen(v=>!v)}>?</button>{open&&<span className="stability-help-popover" role="note"><strong>{info.name}是什么？</strong><span>{info.description}</span><b>包含的指标</b><ul>{info.items.map(t=><li key={t}>{t}</li>)}</ul><button className="btn" onClick={()=>setOpen(false)}>收起</button></span>}</span>}

function HistoryEntry(){
 const [open,setOpen]=useState(false);const navigation=useDriverNavigation();
 return <><button className="btn driver-subpage-entry" onClick={()=>setOpen(true)}>评分历史与六维 <span aria-hidden="true">›</span></button>{open&&<section className="driver-record-page" aria-label="评分历史与六维"><button className="btn driver-back-icon" aria-label="返回上一级" onClick={()=>navigation.request(()=>setOpen(false))}>←</button><MyHistory/></section>}</>;
}

function MyHistory() {
  const [rows, setRows] = useState<Record<string, unknown>[] | null | "error">(null);
  const [offset, setOffset] = useState(0);
  const [more, setMore] = useState(false);
  const [retry, setRetry] = useState(0);
  const [selectedEvidence, setSelectedEvidence] = useState<string | null>(null);
  useEffect(() => {
    let active = true; setRows(null); setSelectedEvidence(null);
    getData<Record<string, unknown>>("my.score_history", { limit: 20, offset, order: "as_of_date.desc,score_id.asc" }).then(r => {
      if (!active) return;
      setRows([...r.rows].reverse());
      setMore(r.total === null ? r.rows.length === 20 : offset + r.rows.length < r.total);
    }).catch(() => { if (active) setRows("error"); });
    return () => { active = false; };
  }, [offset, retry]);
  const DIMS = driverDimensions;
  const COLORS = ["#a480c4", "#b298d2", "#9b80bc", "#cab6dd", "#b68dbd", "#c4aed4"];
  if (rows === "error") return <div className="panel"><EmptyState kind="error" onRetry={() => setRetry(v => v + 1)} /></div>;
  if (!rows) return <div className="panel"><EmptyState kind="loading" /></div>;
  const last = rows[rows.length - 1] || {};
  const dimensionValue = (key: string) => finiteValue(last[key]);
  const maxd = Math.max(...DIMS.map(([k]) => Math.max(0, dimensionValue(k) ?? 0)), 1);
  return <div className="panel"><h3>评分历史与六维</h3>
    <p className="meta">查看近期评分，点击“查看依据”了解扣分原因。</p>
    {rows.length === 0 && <p>暂无评分历史。</p>}
    <div className="table-wrap" style={{ marginBottom: 10 }}><table><thead><tr><th>截止日</th><th>安全分</th><th>等级</th><th>可信度</th><th>依据</th></tr></thead><tbody>
      {rows.map((r) => <tr key={String(r.score_id)}><td>{String(r.as_of_date)}</td><td>{numberText(r.safety_score)}</td><td>{String(r.risk_level || "—")}</td><td>{driverText(r.confidence_level)}</td><td><button className="btn" aria-label={`查看 ${String(r.as_of_date)} 评分依据`} onClick={() => setSelectedEvidence(String(r.score_id))}>查看依据</button></td></tr>)}
    </tbody></table></div>
    {selectedEvidence && <DriverEvidence readable key={selectedEvidence} kind="score_history" id={selectedEvidence} initialOpen />}
    {DIMS.map(([k, label], i) => <div key={k} className="row" style={{ marginBottom: 4 }}>
      <span style={{ width: 90, fontSize: 12.5, color: "var(--ink-2)" }}>{label}</span>
      {dimensionValue(k) == null ? <span className="meta">未取得，未绘制</span> : <><span style={{ height: 12, width: `${Math.max(0, dimensionValue(k)!) / maxd * 40}%`, background: COLORS[i], borderRadius: 3, display: "inline-block" }} /><span className="mono">{numberText(last[k])}</span></>}
    </div>)}
    <p className="login-note">各项扣分截至 {String(last.as_of_date ?? "—")}。</p>
    <div className="row" aria-label="评分历史分页"><button className="btn" disabled={offset === 0} onClick={() => setOffset(v => Math.max(0, v - 20))}>较新评分</button><span>第 {offset / 20 + 1} 页</span><button className="btn" disabled={!more} onClick={() => setOffset(v => v + 20)}>更早评分</button></div>
  </div>;
}


const RR_REASONS: [string, string][] = [
  ["identity_association", "身份关联疑问"], ["event_record", "事件记录疑问"],
  ["device_or_data_missing", "设备或数据缺失"], ["score_explanation", "评分解释疑问"],
];
function RRRequestPanel({ unbound }: { unbound: boolean }) {
  const [reason, setReason] = useState("score_explanation");
  const [desc, setDesc] = useState("");
  const [scoreId, setScoreId] = useState("");
  const [msg, setMsg] = useState<string | null>(null);
  const [mine, setMine] = useState<Record<string, unknown>[] | null>(null);
  const [mineError, setMineError] = useState<unknown>(null);
  const [busy, setBusy] = useState(false);
  const inFlight = useRef(false);
  const load = () => { setMineError(null); getData<Record<string, unknown>>("my.review_requests", { limit: 20 }).then((r) => setMine(r.rows)).catch(setMineError); };
  useEffect(() => { if (!unbound) { load(); getData<Record<string, unknown>>("my.score", { limit: 1 }).then((r) => setScoreId(String(r.rows[0]?.score_id || ""))).catch(() => {}); } }, [unbound]);
  async function submit() {
    if (inFlight.current || unbound || !scoreId || !desc.trim()) return;
    inFlight.current = true; setBusy(true); setMsg(null);
    try {
      const r = await rrCreate({ score_id: scoreId, reason_code: reason, description: desc });
      setMsg(`${r.idempotent_replay ? "已有同一申请" : "已提交申请"} ${r.request_id}（${r.status}）。${r.notification?.state === "pending" ? "申请已保存，站内提醒待恢复。" : "安全员处理后此处可见答复。"}`);
      load();
    } catch (e) { setMsg(`提交未确认（${e instanceof ApiError ? e.code : "network"}），说明已保留。请先查看处理记录，确认状态后重试。`); }
    finally { inFlight.current = false; setBusy(false); }
  }
  if (unbound) return <><h3>对评分有疑问？</h3><p className="page-desc">当前无核实绑定：不展示对象明细，也无法针对本人评分提交复核。</p></>;
  return <>
    <h3>评分复核申请</h3>
    <p className="page-desc">对评分有疑问？填写原因，安全员会核查并回复。</p>
    <div className="field"><label>针对的评分记录</label><input value={scoreId ? "当前安全评分" : "暂无评分记录"} readOnly aria-label="针对评分记录" style={{ background: "var(--bg)" }} /></div>
    <div className="field"><label>原因</label>
      <select className="btn" disabled={busy} style={{ background: "#fff", textAlign: "left" }} value={reason} onChange={(e) => setReason(e.target.value)} aria-label="复核原因">{RR_REASONS.map(([k, v]) => <option key={k} value={k}>{v}</option>)}</select></div>
    <div className="field"><label>说明（必填）</label><textarea disabled={busy} maxLength={4000} style={{ width: "100%", minHeight: 60, borderRadius: 8, border: "1px solid var(--line)", padding: 8, font: "inherit" }} value={desc} onChange={(e) => setDesc(e.target.value)} aria-label="复核说明" /></div>
    <p className="meta">{desc.length}/4000 字</p>
    <button className="btn primary" onClick={() => void submit()} disabled={busy || !desc.trim() || !scoreId}>{busy ? "正在提交申请…" : "提交复核申请"}</button>
    {msg && <div role="status" className="alert info">{msg}</div>}
    <h4 style={{ fontSize: 13, marginTop: 10 }}>我的申请与处理记录</h4>
    {mineError ? <DriverReadError error={mineError} retry={load} /> : mine === null && <EmptyState kind="loading" />}
    {!mineError && mine && mine.length === 0 && <p className="login-note">暂无申请。</p>}
    {(!mineError ? mine || [] : []).map((x) => <div key={String(x.request_id)} className="task-card"><div className="t"><span>评分复核申请</span> · <Tag tone={String(x.status) === "closed" ? "gray" : String(x.status) === "answered" ? "green" : "blue"}>{driverText(x.status)}</Tag></div>
      <div className="meta">{RR_REASONS.find((k) => k[0] === x.reason_code)?.[1] || String(x.reason_code)}</div>
      <div className="meta">我的原文：{String(x.description)}</div>
      {x.review_note ? <div className="meta">安全员答复 · {driverDate(x.updated_at)}：{String(x.review_note)}</div> : null}
    </div>)}
  </>;
}

function OwnScoreDetail() {
  const [row, setRow] = useState<Record<string, unknown> | null | "loading" | "error">("loading");
  useEffect(() => { getData<Record<string, unknown>>("my.score", { limit: 1 }).then((r) => setRow(r.rows[0] || null)).catch(() => setRow("error")); }, []);
  if (row === "loading") return <EmptyState kind="loading" />;
  if (row === "error") return <EmptyState kind="error" />;
  if (!row) return <><div className="panel score-hero"><div className="l">安全评分</div><div className="n">—</div><div className="l">暂无评分记录</div></div><FleetStatsPanel /></>;
  const low = row.confidence_level === "low";
  const confidenceTone = low ? "amber" : row.confidence_level === "high" ? "green" : row.confidence_level === "medium" ? "blue" : "gray";
  return <div className="stack">
    <div className="panel score-hero">
      <div className="n" style={{ color: "var(--ink)" }}>{numberText(row.safety_score)}</div>
      <div className="l">安全评分 · {String(row.window_start || "窗口待核实")} 至 {String(row.as_of_date || "未取得")} · <Tag tone={confidenceTone}>{({high:"可信度高",medium:"可信度中",low:"可信度低"} as Record<string,string>)[String(row.confidence_level)] || "可信度未取得"}{low ? " · 先核验设备/数据" : ""}</Tag></div>
      <div className="l">等级 {String(row.risk_level || "未取得")}· 7 天变化 {row.score_change_7d == null ? "—" : numberText(row.score_change_7d)}</div>
    </div>
    {low && <Banner tone="warn">可信度低：说明数据覆盖或设备状态待核实，先做数据/设备核验，不会被当作“安全”或自动奖惩。</Banner>}
    <FleetStatsPanel />
    <div className="panel driver-attention"><h3>关注事项</h3><div className="kv">
      <span className="kk">主风险维度</span><b>{{history:"历史事故与未遂", fatigue_distraction:"疲劳与分心", driving_stability:"驾驶稳定性", road_rule:"道路规则", management:"管理配合", imu_evidence:"IMU证据"}[String(row.primary_risk_dimension)] || String(row.primary_risk_dimension || "—")}<DimensionHelp dimension={String(row.primary_risk_dimension)}/></b>
      <span className="kk">建议动作</span><b>{String(row.recommended_action ?? "—")}</b>
      <span className="kk">首要扣分原因</span><b>{String(row.top_reason_1 ?? "—")}</b>
      <span className="kk">未来40天预测</span><b>{row.forecast_40d_risk_prob == null || String(row.forecast_40d_risk_prob).trim() === "" || !Number.isFinite(Number(row.forecast_40d_risk_prob)) ? "—" : numberText(Number(row.forecast_40d_risk_prob) * 100) + "%"}<small className="forecast-note">预测概率</small></b>
    </div></div>
    <DriverEvidence readable kind="score" id={String(row.score_id || "")} label="查看本次评分依据" />
    <HistoryEntry />
  </div>;
}


function NotesInbox() {
  const [rows, setRows] = useState<Record<string, unknown>[] | null>(null);
  const [msg, setMsg] = useState<string | null>(null);
  const [error, setError] = useState<unknown>(null);
  const load = () => { setError(null); myNotes().then((r) => setRows(r.rows)).catch(setError); };
  useEffect(() => { load(); }, []);
  function read(id: string) { noteRead(id).then((r: { idempotent_replay?: boolean }) => { setMsg(r.idempotent_replay ? "已读" : "已标记已读"); load(); }).catch((e: unknown) => setMsg("暂未完成，请稍后重试。")); }
  if (error) return <DriverReadError error={error} retry={load} />;
  if (!rows) return <EmptyState kind="loading" />;
  return <div className="panel"><h3>站内消息</h3>
    {rows.length === 0 && <p className="login-note">暂无消息。</p>}
    {rows.map((r) => <div key={String(r.notification_id)} className="task-card"><div className="t">{String(r.title || r.type)}</div>
      <div className="meta">{String(r.content).slice(0, 120)} · {driverDate(r.created_at)} · {r.read_at ? <>已读 {driverDate(r.read_at)}</> : <button className="btn" style={{ padding: "3px 10px" }} onClick={() => read(String(r.notification_id))}>标记已读</button>}</div></div>)}
    {msg && <div className="alert info">{msg}</div>}
  </div>;
}


function ProfileEdit() {
  const [prof, setProf] = useState<{ phone: string; intro: string; contact_pref: string } | null>(null);
  const [loadErr, setLoadErr] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  useEffect(() => { getOwnProfile().then((r) => { const p = r.profile; let cp = "站内消息"; try { const pj = p?.prefs ? JSON.parse(String(p.prefs)) : null; if (pj?.contact_pref) cp = String(pj.contact_pref); } catch { /* defaults */ }
    setProf({ phone: String(p?.phone || ""), intro: String(p?.intro || ""), contact_pref: cp }); }).catch(() => setLoadErr(true)); }, []);
  if (loadErr) return <div className="panel"><EmptyState kind="error" /></div>;
  if (!prof) return <div className="panel"><EmptyState kind="loading" /></div>;
  async function save() { if (!prof) return; setBusy(true); setMsg(null);
    try { const r = await updateOwnProfile({ phone: prof.phone, intro: prof.intro, prefs: JSON.stringify({ contact_pref: prof.contact_pref }) }); setMsg("资料已保存"); }
    catch (e) { const c = e instanceof ApiError ? e.code : "network"; setMsg({ invalid_phone_format: "电话格式不正确（仅数字与 +() -，5-24 位）", profile_driver_only: "仅司机账号可维护", invalid_prefs_json: "偏好数据异常，请刷新页面" }[c] || `保存被拒：${c}`); }
    setBusy(false); }
  return <div className="panel stack">
    <h3>联系方式与备注（本人维护）</h3>
    <div className="field"><label>联系电话（安全员干预沟通用；5-24 位，可清空）</label><input value={prof.phone} onChange={(e) => setProf({ ...prof, phone: e.target.value })} inputMode="tel" placeholder="例如 138-0000-0000" /></div>
    <label className="field" style={{ fontSize: 13 }}>联系偏好
      <select value={prof.contact_pref} onChange={(e) => setProf({ ...prof, contact_pref: e.target.value })}>{["站内消息", "电话联系", "仅紧急事件联系"].map((o) => <option key={o}>{o}</option>)}</select></label>
    <div className="field"><label>个人备注（如常驻线路、班次说明；≤500 字，不对其他司机展示）</label><textarea style={{ width: "100%", minHeight: 56, borderRadius: 8, border: "1px solid var(--line)", padding: 8, font: "inherit" }} value={prof.intro} onChange={(e) => setProf({ ...prof, intro: e.target.value.slice(0, 500) })} /></div>
    <button className="btn primary" style={{ width: "auto" }} disabled={busy} onClick={save}>{busy ? "保存中…" : "保存资料"}</button>
    {msg && <div className="alert info">{msg}</div>}
  </div>;
}

function MySafety({ user, onNavigate = () => {}, onReport = () => {}, reviewOpen = false }: { user: MeUser; onNavigate?: (target: DriverDestination) => void; onReport?:()=>void; reviewOpen?: boolean }) {
  const unbound = !user.driverId || !user.bindingVerified;
  const navigation=useDriverNavigation();const [reviewPage,setReviewPage]=useState(reviewOpen);
  useEffect(()=>{if(reviewOpen)setReviewPage(true)},[reviewOpen]);
  return <div className="stack">
    {unbound
      ? <Banner tone="warn">请联系安全员完成车辆绑定。</Banner>
      : null}
    {!unbound && <DriverActions navigate={onNavigate} />}
    {!unbound && <button className="btn primary driver-report-entry" onClick={onReport}>安全简报 <span aria-hidden="true">↗</span></button>}
    {!unbound ? <OwnScoreDetail /> : <div className="panel score-hero"><div className="n">—</div><div className="l">安全评分（绑定核实后显示）</div></div>}
    <button className="btn driver-subpage-entry" onClick={()=>setReviewPage(true)}>评分复核申请 <span aria-hidden="true">›</span></button>{reviewPage&&<section className="driver-record-page" aria-label="评分复核申请"><button className="btn driver-back-icon" aria-label="返回上一级" onClick={()=>navigation.request(()=>setReviewPage(false))}>←</button><RRRequestPanel unbound={unbound}/></section>}
  </div>;
}

function MyRisk({ user }: { user: MeUser }) {
  const [rows, setRows] = useState<Record<string, unknown>[] | null | "blocked" | "error">(null);
  const [msg, setMsg] = useState<string | null>(null);
  const [rep, setRep] = useState<Record<string, string>>({});
  const [busyIds, setBusyIds] = useState<Set<string>>(new Set());
  const inFlight = useRef(new Set<string>());
  useEffect(() => {
    if (!user.driverId || !user.bindingVerified) { setRows("blocked"); return; }
    getData<Record<string, unknown>>("my.interventions", { limit: 50 }).then((r) => setRows(r.rows)).catch(() => setRows("error"));
  }, [user.driverId, user.bindingVerified]);
  async function act(id: string, action: "read" | "reply") {
    if (inFlight.current.has(id) || (action === "reply" && !rep[id]?.trim())) return;
    inFlight.current.add(id); setBusyIds(new Set(inFlight.current)); setMsg(null);
    try {
      const r = action === "read" ? await interventionRead(id) : await interventionReply(id, rep[id] || "");
      setMsg(action === "read" ? "已标记为已读" : "回复已发送给安全员");
      refresh();
    } catch (e) { setMsg("暂未完成，输入已保留，请刷新后重试。"); }
    finally { inFlight.current.delete(id); setBusyIds(new Set(inFlight.current)); }
  }
  function refresh() { if (user.driverId && user.bindingVerified) getData<Record<string, unknown>>("my.interventions", { limit: 50 }).then((r) => setRows(r.rows)).catch(() => setRows("error")); }
  if (!user.driverId || !user.bindingVerified || rows === "blocked") return <EmptyState kind="nocov" hint="当前账号无核实有效绑定：不展示个人风险明细，且消息不会向其送达。" />;
  if (rows === "error" || rows === null) return <div className="stack"><DriverRiskPanel /><EmptyState kind={rows === "error" ? "error" : "loading"} onRetry={refresh} /></div>;
  const mine = rows.filter((r) => ["sent", "read", "replied"].includes(String(r.status)));
  return <div className="stack">
    <DriverRiskPanel />
    <DriverLiveRisks/><p><MessageButton/></p>
    {rows.length === 0 && <EmptyState kind="nomatch" hint="暂无沟通记录" />}
    {rows.length > 0 && mine.length === 0 && <EmptyState kind="nomatch" hint="有记录但均未发送给你（当前均处草稿/内部状态）。" />}
    {mine.map((r) => <div className="task-card" key={String(r.intervention_id)}>
      <div className="t">{String(r.sent_text || "")}</div>
      <div className="meta">发送 {driverDate(r.sent_at)} · 状态 <Tag tone={String(r.status) === "replied" ? "green" : "blue"}>{driverText(r.status)}</Tag>{r.read_at ? <> · 已读 {driverDate(r.read_at)}</> : null}{r.replied_at ? <> · 已回复 {driverDate(r.replied_at)}</> : null}</div>
      <div className="row" style={{ marginTop: 8 }}>
        {!r.read_at ? <button className="btn" disabled={busyIds.has(String(r.intervention_id))} onClick={() => void act(String(r.intervention_id), "read")}>标记已读</button> : null}
        {!r.replied_at ? <>
          <input aria-label={`回复 ${String(r.intervention_id)}`} disabled={busyIds.has(String(r.intervention_id))} maxLength={2000} style={{ flex: 1, minWidth: 0, padding: "8px 10px", border: "1px solid var(--line)", borderRadius: 8 }} placeholder="回复内容（发送给安全员）" value={rep[String(r.intervention_id)] || ""} onChange={(e) => setRep((s) => ({ ...s, [String(r.intervention_id)]: e.target.value }))} />
          <button className="btn primary" disabled={busyIds.has(String(r.intervention_id)) || !rep[String(r.intervention_id)]?.trim()} style={{ width: "auto" }} onClick={() => void act(String(r.intervention_id), "reply")}>{busyIds.has(String(r.intervention_id)) ? "正在处理…" : "提交回复"}</button>
          <span className="meta">回复 {(rep[String(r.intervention_id)] || "").length}/2000 字；服务器最多保存2000字。</span>
        </> : null}
        {r.replied_at ? <div className="meta">回复原文：{String(r.reply_text)}</div> : null}
      </div>
    </div>)}
    {msg && <div role="status" className="alert info">{msg}</div>}
  </div>;
}

function MyTraining() {
  const navigation = useDriverNavigation();
  const [rows, setRows] = useState<Record<string, unknown>[] | null>(null);
  const [error, setError] = useState<unknown>(null);
  const [offset, setOffset] = useState(0);
  const [more, setMore] = useState(false);
  const [target,setTarget]=useState<Record<string,unknown>|null>(null);
  useEffect(()=>{const open=()=>{const id=sessionStorage.getItem('claw_training_target');if(id)navigation.request(()=>{void taskView(id).then(v=>{setTarget(v.task);sessionStorage.removeItem('claw_training_target')}).catch(setError)})};open();window.addEventListener('claw:training-open',open);return()=>window.removeEventListener('claw:training-open',open)},[]);
  const sequence = useRef(0);
  const load = () => { const seq = ++sequence.current; setError(null); getData<Record<string, unknown>>("my.trainings", { limit: 20, offset }).then(r => { if (seq !== sequence.current) return; setRows(previous => [...(previous || []).filter(row => !r.rows.some(next => next.task_id === row.task_id) && navigation.isProtected(`training:${String(row.task_id)}`)), ...r.rows]); setMore(r.total == null ? r.rows.length === 20 : offset + r.rows.length < r.total); }).catch(e => { if (seq === sequence.current) setError(e); }); };
  useEffect(() => { setRows(null); load(); return () => { sequence.current++; }; }, [offset]);
  useEffect(()=>{const refresh=()=>{if(document.visibilityState!=="hidden")load()};const timer=setInterval(refresh,15000);window.addEventListener("focus",refresh);return()=>{clearInterval(timer);window.removeEventListener("focus",refresh)}},[offset]);
  if (error && !rows) return <DriverReadError error={error} retry={load} />;
  if (!rows) return <EmptyState kind="loading" />;
  return <div className="stack"><h3>培训任务</h3><OfflineTrainingAgenda/><button className="btn" onClick={load}>刷新任务状态</button>
    <p className="meta">查看学习任务、提交反馈，并跟进验收结果。</p>
    {error ? <DriverReadError error={error} retry={load} /> : null}
    {rows.length === 0 && <EmptyState kind="nomatch" hint="本页暂无培训任务。" />}
    {target&&<DriverTrainingCard key={"target:"+String(target.task_id)} row={target} reload={load} initialOpen/>}
    {rows.filter(r=>r.task_id!==target?.task_id).map(r => <DriverTrainingCard key={String(r.task_id)} row={r} reload={load} />)}
    <div className="row" aria-label="培训分页"><button className="btn" disabled={offset === 0} onClick={() => navigation.request(() => setOffset(v => Math.max(0, v - 20)))}>上一页</button><span>第 {offset / 20 + 1} 页</span><button className="btn" disabled={!more} onClick={() => navigation.request(() => setOffset(v => v + 20))}>下一页</button></div>
  </div>;
}

function MyProfile({ user }: { user: MeUser }) {
  const navigation = useDriverNavigation();
  return <div className="stack">
    <h3 style={{ fontSize: 15 }}>我的资料</h3>
    <div className="panel driver-profile-card"><div className="kv">
      <span className="kk">登录账号</span><b>{user.username || user.userId}</b>
      <span className="kk">显示名</span><b>{user.bindingVerified?(vehicleOptions()[0]?.label||"车辆").replace("车辆","司机"):"司机"}</b>
      <span className="kk">角色</span><b>司机</b>
      <span className="kk">司机绑定</span><b>{user.driverId ? (user.bindingVerified ? "已绑定" : "待核实") : "未绑定"}</b>
      <span className="kk">绑定车辆</span><b>{user.bindingVerified?vehicleOptions()[0]?.label||"车辆待同步":"尚未绑定"}</b>
      
      <span className="kk">登录方式</span><b>{user.authKind === "sso" ? "千问办公平台账号（SSO）" : "账号登录"}</b>
      <span className="kk">数据截止</span><b>见当前评分日期</b>
    </div>
    <div className="meta" style={{ marginTop: 6 }}>车辆绑定请联系安全员；联系方式可自行更新。</div>
    </div>
    <AccountProfile user={user}/><details className="panel"><summary>联系方式与偏好</summary><ProfileEdit/></details>

    <button className="btn" onClick={() => navigation.request(() => { void (async () => { await logout().catch(() => {}); try { const o = sessionStorage.getItem("claw_ai_owner"); if (o) sessionStorage.removeItem("claw_ai_msgs_" + o); sessionStorage.removeItem("claw_ai_owner"); sessionStorage.removeItem("claw_fill"); sessionStorage.removeItem("claw_fill_seen"); } catch {} window.dispatchEvent(new Event("claw:auth-lost")); location.reload(); })(); })}>退出登录</button>
    {user.authKind === "sso" && <p className="login-note">平台 SSO 会话由网关管理，应用不提供强制登出；“退出”仅清除本工作台会话视图。</p>}
  </div>;
}

const TABS = [
  { key: "safety", ico: "◈", label: "我的安全", el: (u: MeUser) => <MySafety user={u} /> },
  { key: "risk", ico: "△", label: "风险与沟通", el: (u: MeUser) => <MyRisk user={u} /> },
  { key: "training", ico: "▤", label: "培训任务", el: () => <MyTraining /> },
  { key: "notifications", ico: "♧", label: "通知", el: () => <DriverNotifications/> },
  { key: "ai", ico: "✧", label: "AI 会话", el: () => null },
  { key: "profile", ico: "◎", label: "我的", el: (u: MeUser) => <MyProfile user={u} /> },
];

export function DriverShell({ user, aiContent }: { user: MeUser; aiContent: import("react").ReactNode }) {
  return <DriverNavigationProvider key={user.userId}><DriverShellContent user={user} aiContent={aiContent} /></DriverNavigationProvider>;
}

function DriverShellContent({ user, aiContent }: { user: MeUser; aiContent: import("react").ReactNode }) {
  const navigation = useDriverNavigation();
  const [tab, setTab] = useState(0);
  const [reportOpen,setReportOpen]=useState(false);
  const [reviewOpen, setReviewOpen] = useState(false);
  const [reportUnread,setReportUnread]=useState(0);
  useEffect(()=>{if(!user.driverId||!user.bindingVerified)return;let live=true;const refresh=()=>{if(document.visibilityState==='hidden')return;dailyReportNotifications().then(result=>{if(live)setReportUnread(result.rows.filter(row=>!row.read_at).length);}).catch(()=>{});};refresh();const timer=setInterval(refresh,60000);document.addEventListener('visibilitychange',refresh);window.addEventListener('claw:center-refresh',refresh);return()=>{live=false;clearInterval(timer);document.removeEventListener('visibilitychange',refresh);window.removeEventListener('claw:center-refresh',refresh);};},[user.driverId,user.bindingVerified]);
  const navigate = (target: DriverDestination) => navigation.request(() => { setReviewOpen(target === "review"); setTab(target === "training" ? 2 : target === "risk" ? 1 : 0); });
  useEffect(()=>{const nav=(event:Event)=>{const raw=(event as CustomEvent<string>).detail,key=raw.split('?')[0],index=key==="report"?0:TABS.findIndex(t=>t.key===key);if(index>=0)navigation.request(()=>{const report=new URLSearchParams(raw.split('?')[1]||'').get('report');if(report)sessionStorage.setItem('claw_report_target',report);setReportOpen(key==="report");setTab(index);if(index===tab&&key==='training')window.dispatchEvent(new Event('claw:training-open'));if(index===tab&&key==='report')window.dispatchEvent(new Event('claw:report-open'))})};window.addEventListener('claw:driver-nav',nav);return()=>window.removeEventListener('claw:driver-nav',nav)},[navigation,tab]);
  const active = TABS[tab];
  return <div className={"driver-shell"+(active.key==="ai"?" driver-ai-active":"")}>
    <header className="driver-head"><div className="driver-brand-row"><Brand driver/><GlobalSearch placeholder="搜索任务" /></div>
      <div className="driver-identity"><Avatar value={user.avatarUrl} name={user.displayName}/><div><div className="name">{user.bindingVerified?(vehicleOptions()[0]?.label||"车辆").replace("车辆","司机"):"司机"}</div><div className="sub">{user.bindingVerified ? vehicleOptions()[0]?.label||"车辆待同步" : "身份待核实"}</div></div><span className="driver-app-label">司机端</span></div>
    </header>
    <main className={"driver-main"+(active.key==="ai"?" driver-chat-page":"")}>
      <div className="driver-safety-note">停车后操作</div>

      {active.key === "ai" ? aiContent : reportOpen ? <div className="driver-report-page"><button className="btn driver-back-icon" aria-label="返回上一级" onClick={()=>setReportOpen(false)}>←</button><DailyReportPage enabled={Boolean(user.driverId&&user.bindingVerified)}/></div> : active.key === "safety" ? <MySafety user={user} onNavigate={navigate} onReport={()=>navigation.request(()=>setReportOpen(true))} reviewOpen={reviewOpen} /> : active.el(user)}
    </main>
    <nav className="tabbar">
      {TABS.map((t, i) => <TabBtn key={t.key} active={i === tab} ico={t.ico} label={t.label} onClick={() => { if (i !== tab) navigation.request(() => { setReviewOpen(false); setReportOpen(false); setTab(i); }); }} />)}
    </nav>
  </div>;
}


