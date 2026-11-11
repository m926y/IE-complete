import {getData} from './api';
import {useTrainingNames,trainingStatus} from './training-ui';
import { useEffect,useState } from "react";
import { ApiError, retryTaskNotification } from "./api";
import type { TaskNotificationReceipt } from "./api";

export function notificationText(receipt?: TaskNotificationReceipt): string {
  return !receipt ? "通知状态请在台账核对。" : { recorded: "站内通知已记录，不代表已读或外部渠道送达。", pending: "任务已保存，站内提醒暂未完成，可由安全员按任务编号重试。", no_recipient: "任务已保存，但未取得有效接收账号，请核对账号绑定后重试。", not_needed: "任务已进入后续状态，无需补发此阶段提醒。" }[receipt.state];
}

export function TrainingNotificationRecovery() {
  const names=useTrainingNames(),[tasks,setTasks]=useState<Record<string,unknown>[]>([]);
  useEffect(()=>{let active=true;(async()=>{const all:Record<string,unknown>[]=[];for(let offset=0;;offset+=200){const r=await getData<Record<string,unknown>>('admin.trainings',{limit:200,offset});all.push(...r.rows);if(r.rows.length<200)break}return all})().then(rows=>{if(active)setTasks(rows)}).catch(()=>{});return()=>{active=false}},[]);
  const [id, setId] = useState(""), [kind, setKind] = useState<"assigned" | "submitted">("assigned"), [busy, setBusy] = useState(false), [msg, setMsg] = useState("");
  async function retry() {
    setBusy(true); setMsg("");
    try { const r = await retryTaskNotification(id.trim(), kind); setMsg(notificationText(r.notification)); }
    catch (e) { setMsg(`未完成（${e instanceof ApiError ? e.code : "network"}），请核对任务编号与车队权限。`); }
    finally { setBusy(false); }
  }
  return <details className="panel training-notification-recovery"><summary>培训通知补发</summary><p className="recovery-description">为已分配或已提交的培训补发通知，不会重复创建任务。</p><div className="recovery-form"><label>选择培训任务<select aria-label="补发通知培训任务" value={id} onChange={e=>setId(e.target.value)}><option value="">请选择任务</option>{tasks.map(t=><option key={String(t.task_id)} value={String(t.task_id)}>{names.driver(t.driver_id)} · {names.course(t.course_id)} · {trainingStatus(t.status)}</option>)}</select></label><label>提醒阶段<select aria-label="补发提醒阶段" value={kind} onChange={e => setKind(e.target.value as "assigned" | "submitted")}><option value="assigned">新分配提醒司机</option><option value="submitted">已提交提醒安全员</option></select></label><button className="btn primary" disabled={busy || !/^[\w:,.-]{1,80}$/.test(id.trim())} onClick={retry}>{busy?"正在补发…":"补发通知"}</button></div>{msg && <div className="alert info" role="status">{msg}</div>}</details>;
}
