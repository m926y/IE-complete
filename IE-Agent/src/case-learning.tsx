import {useState} from 'react';
import {api} from './api';
import {AiMessage} from './ai-message';
type Result={data:{advice:string;ai_generated:boolean}};
export function CaseLearningAdvisor({caseId,peer,courses=[],recommendedCourse}:{caseId:string;peer:string|null;courses?:{course_id:string;title:string}[];recommendedCourse?:string}){
 const [result,setResult]=useState<Result|null>(null),[busy,setBusy]=useState(false),[error,setError]=useState('');
 async function generate(){setBusy(true);setError('');try{setResult(await api<Result>('/api/ai/case-training',{method:'POST',body:JSON.stringify({case_id:caseId,advice_only:true})}))}catch{setError('建议生成失败，请稍后重试。')}finally{setBusy(false)}}
 const recommended=courses.filter(c=>c.course_id===recommendedCourse);
 return <section className="panel stack case-advisor"><h4>处置建议</h4><div className="row"><button className="btn primary" disabled={busy} onClick={()=>void generate()}>{busy?'正在生成建议…':'生成处置与培训建议'}</button>{peer&&<button className="btn" onClick={()=>window.dispatchEvent(new CustomEvent('claw:message-open',{detail:{peer,case_id:caseId}}))}>联系司机</button>}</div>{error&&<p role="alert">{error}</p>}{result&&<><small className="meta">{result.data.ai_generated?'千问建议':'处置参考建议'}</small><AiMessage content={result.data.advice}/><div className="risk-course-recommendations"><b>推荐培训</b>{recommended.length?recommended.map(c=><p key={c.course_id}>{c.title}</p>):<p>暂无匹配的已审核课程，可到培训管理选择。</p>}<a className="btn" href="#/tr-ledger">前往培训管理</a></div></>}</section>
}
