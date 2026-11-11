import {CustomLearning} from './custom-learning';
import {parseEditable} from './course-editor';
import {driverText,driverDate} from './driver-shared';
import {cellView} from './ui';
import {QuizTask,isInteractiveCourse,QuizScoreSummary} from './training';
import {PersonalLesson} from './personal-lesson';
import { useEffect, useRef, useState } from "react";
import { ApiError, driverRiskCenter, taskView, taskSaveDraft, taskStart, taskSubmit } from "./api";
import type { DriverRiskResult, TaskView } from "./api";
import { EmptyState, Tag } from "./ui";
import { DriverEvidence } from "./driver-evidence";
import { notificationText } from "./training-recovery";
import { LearningReportPanel } from "./learning-report";
import { useDriverDraft,useDriverNavigation } from "./driver-navigation";
import { DriverReadError, numberText, trainingStatusNames } from "./driver-shared";

export function DriverRiskPanel() {
  const today = new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Shanghai", year: "numeric", month: "2-digit", day: "2-digit" }).format(new Date());
  const [date, updateDate] = useState(today);
  const [eventsOffset, setEventsOffset] = useState(0);
  const [replayExpanded,setReplayExpanded]=useState(true);
  const [alertsOffset, setAlertsOffset] = useState(0);
  const setDate = (value: string) => { updateDate(value); setEventsOffset(0); setAlertsOffset(0); };
  const [data, setData] = useState<DriverRiskResult | null>(null);
  const [error, setError] = useState<unknown>(null);
  const [version, setVersion] = useState(0);
  useEffect(() => {
    let active = true; setData(null); setError(null);
    driverRiskCenter(date, eventsOffset, alertsOffset).then(r => { if (active) setData(r); }).catch(e => { if (active) setError(e); });
    return () => { active = false; };
  }, [date, eventsOffset, alertsOffset, version]);
  const sc = data?.snapshot;
  return <section className="panel" aria-label="个人风险记录">
    <h3>个人风险记录</h3>
    <label>查看日期（北京时间） <input type="date" aria-label="风险日期" value={date} onChange={e => { if (e.target.value) setDate(e.target.value); }} /></label>
    {error ? <DriverReadError error={error} retry={() => setVersion(v => v + 1)} /> : !data ? <EmptyState kind="loading" /> : <>
      
      
      {sc ? <p>未来40天预测概率：<b>{sc.forecast_40d_risk_prob == null || !Number.isFinite(Number(sc.forecast_40d_risk_prob)) || String(sc.forecast_40d_risk_prob).trim() === "" ? "—" : numberText(Number(sc.forecast_40d_risk_prob) * 100) + "%"}</b> · 可信度 {driverText(sc.confidence_level)}</p> : <p>未取得本人评分快照，不显示风险概率。</p>}
      {data.latest_replay_date && data.latest_replay_date !== date && <button className="btn" onClick={() => setDate(data.latest_replay_date!)}>查看最近回放日 {data.latest_replay_date}</button>}
      <div className="row" style={{justifyContent:"space-between",alignItems:"center"}}><h4>回放事件</h4><button className="btn" style={{width:"auto",padding:"6px 12px",fontSize:13}} aria-expanded={replayExpanded} onClick={()=>setReplayExpanded(v=>!v)}>{replayExpanded?"收起":"展开"}</button></div>
      {replayExpanded&&<>
      {data.events.length === 0 && <p>本页没有可展示的本人回放事件；数据覆盖情况需核验。</p>}
      {data.events.map(e => <details className="task-card" id={`driver-event-${String(e.event_id)}`} key={String(e.event_id)}><summary>{String(e.event_name || e.event_type)} · {driverDate(e.event_time)}</summary><div className="driver-event-facts"><span>{driverText(e.dimension)}</span><b>{numberText(e.speed_kmh)} 公里/小时</b></div><DriverEvidence readable kind="event" id={String(e.event_id)} /></details>)}
      <div className="row" aria-label="回放分页"><button className="btn" disabled={eventsOffset === 0} onClick={() => setEventsOffset(v => Math.max(0, v - 10))}>回放上一页</button><span>第 {eventsOffset / 10 + 1} 页</span><button className="btn" disabled={!data.pagination.events_has_more} onClick={() => setEventsOffset(v => v + 10)}>回放下一页</button></div>
      </>}
      <h4>人工告警</h4>
      {data.alerts.length === 0 && <p>本页没有本人告警记录；这与是否存在风险事件是两回事。</p>}
      {data.alerts.map(a => <div className="task-card" key={String(a.alert_id)}><b>{cellView("rule_code",a.rule_code)} · {driverText(a.status)}</b><div className="meta">{driverDate(a.occurred_at)}</div><DriverEvidence readable kind="alert" id={String(a.alert_id)} label="查看告警证据" />{data.events.some(e => e.event_id === a.evidence_id) && <a href={`#driver-event-${String(a.evidence_id)}`} onClick={e => { e.preventDefault(); const el = document.getElementById(`driver-event-${String(a.evidence_id)}`); el?.setAttribute("open", ""); el?.scrollIntoView({ behavior: "smooth" }); }}>查看关联事件</a>}</div>)}
      <div className="row" aria-label="告警分页"><button className="btn" disabled={alertsOffset === 0} onClick={() => setAlertsOffset(v => Math.max(0, v - 10))}>告警上一页</button><span>第 {alertsOffset / 10 + 1} 页</span><button className="btn" disabled={!data.pagination.alerts_has_more} onClick={() => setAlertsOffset(v => v + 10)}>告警下一页</button></div>
      {data.truncated && <p className="meta">还有记录未显示，请使用对应列表的下一页；翻页期间如新增数据，记录位置可能变化。</p>}
      
    </>}
  </section>;
}


// Keep the peer's task-card structure while routing every course through the existing validated player.
export function DriverTrainingCard({row,reload,initialOpen=false}:{row:Record<string,unknown>;reload:()=>void;initialOpen?:boolean}){
 const navigation=useDriverNavigation();const [open,setOpen]=useState(initialOpen),[view,setView]=useState<TaskView|null>(null),[error,setError]=useState<unknown>(null);const id=String(row.task_id);
 useEffect(()=>{let active=true;taskView(id).then(v=>{if(active)setView(v)}).catch(e=>{if(active)setError(e)});return()=>{active=false}},[open,id,row.status]);
 const back=()=>navigation.request(()=>{setOpen(false);reload()});return <article className={"task-card"+(open?" driver-course-screen":"")}><h4>{String(view?.course?.title||'培训课程')}</h4><p className="meta">状态 {trainingStatusNames[String(view?.task.status||row.status)]||String(row.status)} · 截止 {String(row.due_at||'未设置')}{row.mandatory?' · 必修':''}</p><QuizScoreSummary record={row.learning_record}/><button className="btn primary course-open-button" onClick={()=>setOpen(true)}>{open?'已打开课程':'进入课程与学习记录'}</button>{open&&<><button className="btn driver-course-back" aria-label="返回培训任务" onClick={back}>←</button>{error?<DriverReadError error={error} retry={()=>{setError(null);taskView(id).then(setView).catch(setError)}}/>:!view?<EmptyState kind="loading"/>:<>{parseEditable(view.course?.content)?<CustomLearning taskId={id} onBack={back}/>:isInteractiveCourse(row.course_id)?<QuizTask taskId={id} onBack={back}/>:<PersonalLesson id={id} status={String(view.task.status)} onBack={back}/>}<LearningReportPanel taskId={id} onLoaded={reload}/></>}</>}</article>
}
