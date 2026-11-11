import {reflectionPrompt} from './reflection-prompt';
import {QuizScoreSummary} from './training';
import { useState } from "react";
import { learningReport } from "./api";
import type { LearningReport } from "./api";
import { EmptyState } from "./ui";
function ReadableLearningRecord({record}:{record:unknown}){
 let value:any=null;try{value=typeof record==='string'?JSON.parse(record):record}catch{}
 if(!value||typeof value!=='object')return <p>{typeof record==='string'&&!record.trim().startsWith('{')?record:'暂无学习记录'}</p>;
 return <div className="learning-report-readable">{value.personal_question?.prompt&&<article><h4>复盘问题</h4><p>{reflectionPrompt(value.personal_question.prompt)}</p></article>}{value.response&&<article><h4>情境题回答</h4><p>{value.response}</p></article>}<article><h4>我的风险复盘</h4><p>{value.reflection||'尚未填写'}</p></article><article><h4>我的行动计划</h4><p>{value.action_plan||'尚未填写'}</p></article>{value.kind==='editable_course_record'&&<article><h4>问答题回答</h4>{Object.entries(value.answers||{}).filter(([,answer])=>typeof answer==='string').map(([key,answer])=><p key={key}>第{Number(key)+1}题：{String(answer)}</p>)}</article>}</div>;
}
export function LearningReportPanel({ taskId, onLoaded }: { taskId: string; onLoaded?: () => void }) {
  const [report,setReport]=useState<LearningReport|null>(null),[busy,setBusy]=useState(false),[error,setError]=useState(false);
  const load=async()=>{setBusy(true);setError(false);try{setReport(await learningReport(taskId));onLoaded?.();}catch{setError(true);}finally{setBusy(false);}};
  return <div><button className="btn" disabled={busy} onClick={load}>查看学习复盘汇总</button>{error?<EmptyState kind="error" onRetry={load}/>:report&&<section className="panel" aria-label="学习复盘汇总"><h4>{report.course?.title||"课程未取得"}</h4><p>目标：{report.goal||"未记录"}</p><QuizScoreSummary record={report.learning_record}/><ReadableLearningRecord record={report.learning_record}/><p style={{whiteSpace:"pre-wrap"}}>本人反馈：{report.feedback||"尚未填写"}</p><p>人工复核意见：{report.review_note||"暂无"}</p><p>{report.conclusion}</p><p className="meta">更新于 {new Date(report.generated_at).toLocaleString("zh-CN",{timeZone:"Asia/Shanghai"})}</p></section>}</div>;
}
