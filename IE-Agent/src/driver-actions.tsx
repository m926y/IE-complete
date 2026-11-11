import {DriverTodos} from './driver-notifications';
import {driverText} from './driver-shared';
import { useEffect, useRef, useState } from "react";
import { ApiError, driverActionCenter, driverInterventionView, driverScoreComparison, interventionRead, interventionReply, rrView, taskView } from "./api";
import type { DriverActionCenter, DriverInterventionView, DriverScoreComparison, DriverSourceRef, RRView, TaskView } from "./api";
import { DriverEvidence } from "./driver-evidence";
import { DriverTrainingCard } from "./driver-learning";
import { DriverReadError, numberText, driverDimensions, trainingStatusNames } from "./driver-shared";
import { useDriverNavigation } from "./driver-navigation";
import { EmptyState } from "./ui";

export type DriverDestination = "training" | "risk" | "review";
const eventNames: Record<string, string> = { assigned: "分配培训", started: "开始学习", submitted: "提交学习", returned: "退回补充", reviewed: "复核通过", observation: "继续观察", interview: "需面谈", sent: "发送沟通", read: "已读沟通", replied: "回复沟通", review_requested: "申请评分复核", review_current_state: "当前复核处理记录", score_recorded: "历史评分截止日", alert_recorded: "告警记录日期", event_recorded: "历史回放事件" };
const statusNames: Record<string, string> = { ...trainingStatusNames, submitted: "待人工处理", sent: "已发送", read: "已读", replied: "已回复", closed: "已关闭", checking: "核查中", awaiting_data_owner: "等待数据负责人", answered: "已答复", historical: "历史评分", replay: "历史回放", pending_review: "待人工核查", confirmed: "人工已确认" };
const dimensions = driverDimensions;

export function DriverActions({ navigate }: { navigate: (target: DriverDestination) => void }) {
  const navigation = useDriverNavigation();
  const [data, setData] = useState<DriverActionCenter | null>(null), [error, setError] = useState<unknown>(null);
  const [cursor, setCursor] = useState<string | undefined>(), [version, setVersion] = useState(0);
  const [busy, setBusy] = useState(false), [selected, setSelected] = useState<DriverSourceRef | null>(null);
  const [timelineOpen, setTimelineOpen] = useState(false), [comparisonOpen, setComparisonOpen] = useState(false);
  useEffect(() => {
    let active = true; setError(null); setBusy(true);
    driverActionCenter(cursor).then(result => { if (active) setData(result); }).catch(e => { if (active) setError(e); }).finally(() => { if (active) setBusy(false); });
    return () => { active = false; };
  }, [cursor, version]);
  const refresh = () => { setCursor(undefined); setVersion(v => v + 1); };
  const open = (ref: DriverSourceRef) => navigation.request(() => setSelected(ref));
  return <section className="panel stack" aria-label="本人行动摘要">
    <h3>待办任务</h3><DriverTodos/>
    {error ? <DriverReadError error={error} retry={refresh} /> : !data ? null : <>
      <details className={timelineOpen?"driver-record-page":"driver-record-entry"} open={timelineOpen} onToggle={e => setTimelineOpen(e.currentTarget.open)}>
        <summary>{timelineOpen?"←":"查看本人业务时间线"}</summary>{timelineOpen&&<h2>业务时间线</h2>}
        
        {data.timeline.length === 0 && <p>暂无可展示的已保存节点，无记录不等于零风险。</p>}
        {data.timeline.map(node => <article className="task-card" key={node.event_id}>
          <b>{eventNames[node.event_type] || node.event_type}</b>
          <p className="meta">{node.date_precision === "day" ? "日期 " + new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Shanghai" }).format(new Date(node.event_at)) : "记录时间 " + new Date(node.event_at).toLocaleString("zh-CN", { timeZone: "Asia/Shanghai", hour12: false })} · 当前状态 {statusNames[node.status] || node.status}</p>
          

          <button className="btn" aria-label={`打开记录 ${node.source_id} ${node.event_type}`} onClick={() => open(node)}>查看详情</button>
          {node.related.map(ref => <button className="btn" key={`${ref.source_kind}:${ref.source_id}`} onClick={() => open(ref)}>相关记录</button>)}
        </article>)}
        <div className="row"><button className="btn" disabled={busy || !cursor} onClick={() => setCursor(undefined)}>回到时间线第一页</button><button className="btn" disabled={busy || !data.pagination.has_more} onClick={() => { if (data.pagination.next_cursor) setCursor(data.pagination.next_cursor); }}>更早业务节点</button></div>
      </details>
    </>}
    {selected && <><button className="btn" onClick={() => navigation.request(() => setSelected(null))}>关闭当前业务详情</button><ActionDetail key={`${selected.source_kind}:${selected.source_id}`} selected={selected} refresh={refresh} /></>}
    <details className={comparisonOpen?"driver-record-page":"driver-record-entry"} open={comparisonOpen} onToggle={e => setComparisonOpen(e.currentTarget.open)}><summary>{comparisonOpen?"←":"两期评分变化核对"}</summary>{comparisonOpen&&<h2>评分变化对比</h2>}{comparisonOpen && <ScoreChanges />}</details>
  </section>;
}

function ActionDetail({ selected, refresh }: { selected: DriverSourceRef; refresh: () => void }) {
  const [task, setTask] = useState<TaskView | null>(null), [review, setReview] = useState<RRView | null>(null), [message, setMessage] = useState<DriverInterventionView | null>(null);
  const [error, setError] = useState<unknown>(null), [retry, setRetry] = useState(0);
  const kind = selected.source_kind;
  useEffect(() => {
    let active = true; setError(null);
    if (kind === "training_task") taskView(selected.source_id).then(r => { if (active) setTask(r); }).catch(e => { if (active) setError(e); });
    if (kind === "review_request") rrView(selected.source_id).then(r => { if (active) setReview(r); }).catch(e => { if (active) setError(e); });
    if (kind === "intervention") driverInterventionView(selected.source_id).then(r => { if (active) setMessage(r); }).catch(e => { if (active) setError(e); });
    return () => { active = false; };
  }, [kind, selected.source_id, retry]);
  if (["score", "score_history", "alert", "event"].includes(kind)) return <DriverEvidence readable kind={kind as "score" | "score_history" | "alert" | "event"} id={selected.source_id} initialOpen />;
  return <section className="stack" aria-label="本人业务详情">
    {error ? <DriverReadError error={error} retry={() => setRetry(x => x + 1)} /> : kind === "training_task" ? task ? <DriverTrainingCard row={task.task} reload={() => { setRetry(x => x + 1); refresh(); }} /> : <EmptyState kind="loading" /> : kind === "review_request" ? review ? <>
      <h4>本人复核申请 {String(review.request.request_id)}</h4><p>当前状态：{statusNames[String(review.request.status)] || String(review.request.status)}</p><p>申请原文：{String(review.request.description || "未取得")}</p><p>已保存答复：{String(review.request.review_note || "尚无人工答复，等待安全员处理。")}</p>
      <p className="meta">这里仅查看本人的申请和答复，不能修改算法事实。</p>
    </> : <EmptyState kind="loading" /> : message ? <MessageDetail message={message} reload={() => { setRetry(x => x + 1); refresh(); }} /> : <EmptyState kind="loading" />}
  </section>;
}

function MessageDetail({ message, reload }: { message: DriverInterventionView; reload: () => void }) {
  const [reply, setReply] = useState(""), [busy, setBusy] = useState(false), [receipt, setReceipt] = useState("");
  const lock = useRef(false);
  async function act(respond: boolean) {
    if (lock.current || (respond && !reply.trim())) return;
    lock.current = true; setBusy(true);
    try {
      const result = respond ? await interventionReply(message.intervention_id, reply) : await interventionRead(message.intervention_id);
      setReceipt(respond ? `已保存回复 ${result.replied_at} · ${result.reply_text}` : `已读回执 ${result.read_at}`); reload();
    } catch (e) { setReceipt(`操作结果未确认（${e instanceof ApiError ? e.code : "network"}），输入已保留，请查询状态后重试。`); }
    finally { lock.current = false; setBusy(false); }
  }
  return <><h4>本人沟通 {message.intervention_id}</h4><p>{message.sent_text || "已发送正文未取得"}</p><p>状态 {statusNames[message.status] || message.status} · 发送 {message.sent_at}</p>
    {message.reply_text && <p>已保存回复：{message.reply_text}</p>}
    {["sent", "read"].includes(message.status) && <>{!message.read_at && <button className="btn" disabled={busy} onClick={() => void act(false)}>阅读这条沟通</button>}<label>对此沟通回复<textarea aria-label="业务详情回复" maxLength={2000} disabled={busy} value={reply} onChange={e => setReply(e.target.value)} /></label><p className="meta">{reply.length}/2000 字</p><button className="btn" disabled={busy || !reply.trim()} onClick={() => void act(true)}>发送这条沟通的回复</button></>}
    {message.alert_id && <DriverEvidence readable kind="alert" id={message.alert_id} label="核验沟通关联证据" />}
    {receipt && <p role="status">{receipt}</p>}
  </>;
}

function ScoreChanges() {
  const [data, setData] = useState<DriverScoreComparison | null>(null), [error, setError] = useState<unknown>(null), [busy, setBusy] = useState(false);
  const [before, setBefore] = useState(""), [after, setAfter] = useState("");
  const sequence = useRef(0);
  async function load(earlier?: string, later?: string) {
    const seq = ++sequence.current; setBusy(true); setError(null);
    try { const result = await driverScoreComparison(earlier, later); if (seq !== sequence.current) return; setData(result); setBefore(String(result.before?.score_id || "")); setAfter(String(result.after?.score_id || "")); }
    catch (e) { if (seq === sequence.current) setError(e); }
    finally { if (seq === sequence.current) setBusy(false); }
  }
  useEffect(() => { void load(); return () => { sequence.current++; }; }, []);
  return <section className="stack" aria-label="两期真实评分核对">
    {error ? <DriverReadError error={error} retry={() => void load(before, after)} /> : !data ? <EmptyState kind="loading" /> : <>
      <label>较早记录<select aria-label="较早评分记录" disabled={busy} value={before} onChange={e => setBefore(e.target.value)}>{!before && <option value="">未取得</option>}{data.options.map(row => <option key={row.score_id} value={row.score_id}>{row.as_of_date}</option>)}</select></label>
      <label>较晚记录<select aria-label="较晚评分记录" disabled={busy} value={after} onChange={e => setAfter(e.target.value)}>{!after && <option value="">未取得</option>}{data.options.map(row => <option key={row.score_id} value={row.score_id}>{row.as_of_date}</option>)}</select></label>
      <button className="btn" disabled={busy || !before || !after || before === after} onClick={() => void load(before, after)}>核对选定两期</button>
      {data.options_truncated && <p className="meta">选择器展示最近50条真实记录，不补造日期。</p>}
      <p>{data.note}</p>
      {[data.before, data.after].map((row, index) => row ? <div className="task-card" key={index}><h4>{index === 0 ? "较早" : "较晚"}真实记录</h4><p>截止 {String(row.as_of_date)} · 安全分 {numberText(row.safety_score)}</p><p className="meta">窗口 {String(row.window_start || "未取得")} 至 {String(row.as_of_date)} · 可信度 {driverText(row.confidence_level)}</p><DriverEvidence readable kind="score_history" id={String(row.score_id)} label={`查看${index === 0 ? "较早" : "较晚"}评分依据`} /></div> : <p key={index}>未取得{index === 0 ? "较早" : "较晚"}记录。</p>)}
      <p>记录数值差：{numberText(data.difference)}；不是改善有效判定。</p>
      <div className="table-wrap"><table><thead><tr><th>维度</th><th>较早扣分</th><th>较晚扣分</th><th>记录差值</th></tr></thead><tbody>{dimensions.map(([key, label]) => <tr key={key}><td>{label}</td><td>{numberText(data.before?.[key])}</td><td>{numberText(data.after?.[key])}</td><td>{numberText(data.dimensions[key])}</td></tr>)}</tbody></table></div>
      
    </>}
  </section>;
}
