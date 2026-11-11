import {eventName} from './event-names';
import { vehicleLabel, vehicleId, displayText } from "./vehicles";
import { useCallback, useEffect, useRef, useState } from "react";
import type { ReactNode } from "react";
import { ApiError, getData } from "./api";
import type { ListResult, SearchGroup } from "./api";
import { search } from "./api";

/** 四种页面状态的统一呈现（加载中/无匹配/无权限无覆盖/读写失败） */
export function EmptyState({ kind, hint, onRetry }: { kind: "loading" | "nomatch" | "noperm" | "nocov" | "error"; hint?: string; onRetry?: () => void }) {
  if (kind === "loading") {
    return <div className="panel"><div className="skeleton" style={{ width: "38%" }} /><div className="skeleton" /><div className="skeleton" style={{ width: "80%" }} /><div className="skeleton" style={{ width: "64%" }} /></div>;
  }
  const map = {
    nomatch: { big: "当前筛选条件下无匹配记录", hint: hint || "这不代表“零风险”。请调整或清空筛选条件。" },
    noperm: { big: "无权限查看该数据", hint: hint || "服务端已拒绝越权访问；此处不会返回受限数据。" },
    nocov: { big: "暂无设备/数据覆盖", hint: hint || "“无事件”不等于“无覆盖”。请先核实设备状态与数据导入范围。" },
    error: { big: "暂时无法读取数据", hint: hint || "网络或服务异常，已保留页面；请稍后重试。" },
  } as const;
  const t = map[kind as keyof typeof map];
  return (
    <div className="panel empty" role="status">
      <div className="big">{t.big}</div>
      {t.hint && <div className="hint">{t.hint}</div>}
      {kind === "error" && onRetry && <p><button className="btn" onClick={onRetry}>重试</button></p>}
    </div>
  );
}

export function Tag({ tone, children }: { tone: "gray" | "blue" | "red" | "amber" | "green"; children: ReactNode }) {
  return <span className={`tag ${tone}`}>{children}</span>;
}

export function fmtCell(v: unknown): string {
  if (v === null || v === undefined || v === "") return "—";
  if (typeof v === "number") return Number.isInteger(v) ? String(v) : v.toFixed(4);
  return String(v);
}

type ResourceTableProps = {
  renderCell?: (column:string,value:unknown,row:Record<string,unknown>)=>ReactNode;
  resource: string;
  labels?: Record<string, string>;
  columns?: string[];
  pageSize?: number;
  params?: Record<string, string | number>;
  onRowClick?: (row: Record<string, unknown>) => void;
  rowActionLabel?: string;
};

/** 受控只读列表：数据一律来自服务端 /api/data/<resource>（服务端验权+行级过滤），前端不伪造行 */
export function ResourceTable({ renderCell, resource, labels = {}, columns, pageSize = 20, params = {}, onRowClick, rowActionLabel }: ResourceTableProps) {
  const [state, setState] = useState<{ kind: "loading" | "ok" | "error"; data: ListResult<Record<string, unknown>> | null; code?: string }>({ kind: "loading", data: null });
  const [offset, setOffset] = useState(0);
  const seq = useRef(0);

  const load = useCallback(async (off: number) => {
    const my = ++seq.current;
    setState(previous=>({kind:"loading",data:previous.data}));
    try {
      const res = await getData<Record<string, unknown>>(resource, { ...params, limit: pageSize, offset: off });
      if (my === seq.current) setState({ kind: "ok", data: res });
    } catch (e) {
      if (my !== seq.current) return;
      const code = e instanceof ApiError ? e.code : "network_error";
      setState({ kind: "error", data: null, code });
    }
  }, [resource, pageSize, JSON.stringify(params)]);

  useEffect(() => { setOffset(0); }, [resource]);
  useEffect(() => { load(offset); }, [load, offset]);
  useEffect(()=>{const refresh=()=>{void load(offset);};window.addEventListener("claw:agent-applied",refresh);return()=>window.removeEventListener("claw:agent-applied",refresh);},[load,offset]);

  if (state.kind === "loading"&&!state.data) return <EmptyState kind="loading" />;
  if (state.kind === "error") {
    if (state.code === "forbidden") return <EmptyState kind="noperm" />;
    if (state.code === "binding_required") return <EmptyState kind="nocov" hint="当前账号尚未核实绑定司机身份。未核实时不展示个人明细属设计约束，不是数据丢失；绑定经安全管理员核实（SM01/SM02）后此区将显示本人数据。" />;
    return <EmptyState kind="error" onRetry={() => load(offset)} />;
  }
  const rows = state.data?.rows ?? [];
  if (rows.length === 0) {
    return <EmptyState kind="nomatch" hint="当前筛选/该对象无记录。本页按事实显示空态，不补造趋势、告警或证据。" />;
  }
  const cols = columns || Object.keys(rows[0]);
  const total = state.data?.total ?? rows.length;
  return (
    <div aria-busy={state.kind==='loading'}>
      <div className="table-wrap">
        <table>
          <thead><tr>{cols.map((c) => <th key={c}>{labels[c] || (c === "gpsno" ? "车辆" : c)}</th>)}{rowActionLabel && <th>操作</th>}</tr></thead>
          <tbody>
            {rows.map((r, i) => (
              <tr key={String(r.request_id ?? r[cols[0]] ?? i)} style={onRowClick ? { cursor: "pointer" } : undefined} onClick={() => onRowClick?.(r)}>
                {cols.map((c) => <td key={c} className={/id$|version|gpsno/.test(c) ? "mono" : undefined} title={renderCell?undefined:c === "gpsno" ? vehicleLabel(r[c]) : displayText(fmtCell(r[c]))}>{renderCell?renderCell(c,r[c],r):cellView(c, r[c])}</td>)}
                {rowActionLabel && <td><button className="table-action" onClick={e => { e.stopPropagation(); onRowClick?.(r); }}>{rowActionLabel}</button></td>}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <div className="pager">
        <button className="btn" disabled={state.kind==='loading'||offset === 0} onClick={() => setOffset(Math.max(offset - pageSize, 0))}>上一页</button>
        <span>第 {Math.floor((state.data?.offset??offset) / pageSize) + 1} 页{state.data?.total !== null && state.data?.total !== undefined ? ` · 共 ${total} 条` : ""}</span>
        <button className="btn" disabled={state.kind==='loading'||offset + pageSize >= total} onClick={() => setOffset(offset + pageSize)}>下一页</button>
      </div>
    </div>
  );
}

/** 语义色标：低可信=琥珀并提示先核验；D=高危红、C=琥珀（等级为复核优先级非事故概率），颜色均配文字 */
export function cellView(col: string, v: unknown) {
  if(col==='rule_code')return ({dual_signal_priority:'预测与行为风险均需关注',REPLAY_stability:'车道控制异常',REPLAY_distraction:'分心驾驶',REPLAY_fatigue:'疲劳驾驶',REPLAY_collision:'碰撞风险',REPLAY_road:'特殊路段超速',REPLAY_junction:'路口风险',REPLAY_blind:'盲区风险',REPLAY_quality:'摄像头异常',REPLAY_incident:'险情与事故核查',REPLAY_distraction_SHADOW:'重复分心信号待核查',data_quality:'设备与数据检查'} as Record<string,string>)[String(v)]||String(v).replace(/^REPLAY_/, '回放预警：');
  if(col==='status'&&['pending_review','confirmed','closed','duplicate','needs_more'].includes(String(v)))return ({pending_review:'待复核',confirmed:'已确认',closed:'已关闭',duplicate:'重复记录',needs_more:'待补充证据'} as Record<string,string>)[String(v)];
  if(col==='occurred_at'&&/^\d{4}-\d{2}-\d{2}$/.test(String(v)))return String(v).replace(/-/g,'/');
  if(col==='occurred_at'&&v&&!Number.isNaN(Date.parse(String(v))))return new Date(String(v)).toLocaleString('zh-CN',{timeZone:'Asia/Shanghai',hour12:false});
  if(col==='action_deadline')return ({within_24h:'24小时内',within_7d:'7天内',within_30d:'30天内',before_action:'采取措施前完成',immediate:'立即处理'} as Record<string,string>)[String(v)]||'待安排';
  if(col==='event_type')return eventName(v);

  if (col === "gpsno") return vehicleLabel(v);
  if (col === "primary_risk_dimension" || col === "dimension") return ({ history: "历史事故与未遂", fatigue_distraction: "疲劳与分心", driving_stability: "驾驶稳定性", road_rule: "道路规则", management: "管理配合度", imu_evidence: "IMU 风险佐证" }[String(v)] || fmtCell(v));
  if (["risk_prob", "forecast_40d_risk_prob"].includes(col) && typeof v === "number") return (v * 100).toFixed(2) + "%";
  if (col === "safety_score" && typeof v === "number") return <span className="score-cell">{v.toFixed(4)}</span>;
  if (col === "confidence_level") {
    if (v === "low") return <Tag tone="amber">低 · 建议先核验数据/设备</Tag>;
    if (v === "high") return <Tag tone="green">高</Tag>;
    if (v === "medium") return <Tag tone="gray">中</Tag>;
    if (v) return <Tag tone="gray">{String(v)}</Tag>;
  }
  if (col === "score_change_7d" && typeof v === "number" && v <= -10) return <Tag tone="red">{v.toFixed(4)} · 7天下降≥10</Tag>;
  if (col === "risk_level") {
    if (v === "D") return <Tag tone="red">D（高优先复核）</Tag>;
    if (v === "C") return <Tag tone="amber">C</Tag>;
    if (v === "A" || v === "B") return <Tag tone="gray">{String(v)}</Tag>;
  }
  return displayText(fmtCell(v));
}

export function Banner({ tone, children }: { tone: "info" | "warn"; children: ReactNode }) {
  return <div className={`banner ${tone}`}>{children}</div>;
}

// ===== 全局搜索入口（顶部；两角色共用；结果由服务端按可信会话过滤） =====
export function GlobalSearch({placeholder="搜索车辆、司机、案卷、任务"}:{placeholder?:string}) {
  const [q, setQ] = useState("");
  const [state, setState] = useState<"idle" | "loading" | "ok" | "empty" | "fail" | "invalid">("idle");
  const [data, setData] = useState<{ groups: SearchGroup[]; note?: string } | null>(null);
  const [open, setOpen] = useState(false);
  const timer = useRef<number>(0);
  function run(text: string) {
    setQ(text);
    window.clearTimeout(timer.current);
    if (!text.trim()) { setState("idle"); setData(null); return; }
    timer.current = window.setTimeout(async () => {
      setState("loading"); setOpen(true);
      try {
        const r = await search(vehicleId(text));
        const any = r.groups.reduce((a, g) => a + g.total, 0);
        setData(r as typeof data); setState(any ? "ok" : "empty");
      } catch { setState("fail"); }
    }, 350);
  }
  const LABEL: Record<string, string> = { drivers: "司机/车辆", score_snapshots: "车辆评分", alerts: "案卷与告警", training_tasks: "培训任务", knowledge_articles: "知识库" };
  return <div className="global-search">
    <input aria-label="全局搜索" value={q} onChange={(e) => run(e.target.value)} onFocus={() => { if (data) setOpen(true); }} placeholder={placeholder} style={{ width: "100%", padding: "6px 10px", borderRadius: 8, border: "1px solid var(--line)", fontSize: 13 }} />
    {open && state !== "idle" && <div className="task-card" style={{ position: "absolute", top: 36, left: 0, right: 0, zIndex: 60, maxHeight: 420, overflowY: "auto", textAlign: "left" }}>
      {state === "loading" && <div className="meta">检索中…</div>}
      {state === "fail" && <div className="meta" style={{ color: "var(--warn)" }}>搜索失败，请重试</div>}
      {state === "empty" && <div><div className="meta">未找到匹配对象。仅统计你有权查看的类别{data?.note ? "；" + data.note : ""}</div>
        {(data?.groups || []).map((g) => <div key={g.type} className="meta" style={{ fontSize: 11 }}>{LABEL[g.type] || g.type}：{g.total}</div>)}</div>}
      {(state === "ok") && (data?.groups || []).map((g) => <div key={g.type} style={{ marginBottom: 4 }}>
        <div className="t" style={{ fontSize: 12 }}>{LABEL[g.type] || g.type} · 命中 {g.total}</div>
        {g.items.map((it) => <div key={g.type + it.record_id} className="task-card" style={{ padding: 6, cursor: "pointer" }} onClick={() => { const h = it.route.replace(/^#/, ""); if (h && h !== "/") location.hash = h; setOpen(false); }}>
          <div style={{ fontSize: 12.5 }}>{it.title} <span className="meta">↗</span></div><div className="meta" style={{ fontSize: 11 }}>{it.summary}</div>
        </div>)}
      </div>)}
      {data?.note && state !== "empty" && <div className="meta" style={{ fontSize: 11 }}>{data.note}</div>}
    </div>}
  </div>;
}
