export function parseCourse(content){try{const value=JSON.parse(content);return value?.kind==='editable_course_v1'?value:null}catch{return null}}
export function validateCourse(value){
 if(!value||value.kind!=='editable_course_v1'||typeof value.text!=='string'||value.text.length>20000||!Array.isArray(value.questions)||value.questions.length>50)throw new Error('invalid_course');
 if(JSON.stringify(value).length>60000)throw new Error('course_too_large');
 if(!value.text.trim()&&!value.video&&!value.questions.length)throw new Error('course_empty');
 if(value.video&&!/^\/api\/learning-assets\/[a-f0-9]{32}$/.test(value.video))throw new Error('invalid_video');
 const questions=value.questions.map(q=>{
  if(!['single','multiple','text'].includes(q.type)||!String(q.title||'').trim()||String(q.title).length>1000)throw new Error('invalid_question');
  const question={type:q.type,title:String(q.title).trim(),explain:String(q.explain||'').slice(0,2000)};
  if(q.type==='text')return {...question,options:[],answer:[],reference:String(q.reference||'').slice(0,3000)};
  if(!Array.isArray(q.options)||q.options.length<2||q.options.length>8||q.options.some(x=>typeof x!=='string'||!x.trim()||x.length>500)||!Array.isArray(q.answer)||!q.answer.length||new Set(q.answer).size!==q.answer.length||q.answer.some(x=>!Number.isInteger(x)||x<0||x>=q.options.length)||q.type==='single'&&q.answer.length!==1)throw new Error('invalid_question');
  return {...question,options:q.options.map(x=>x.trim()),answer:q.answer};
 });
 return {kind:'editable_course_v1',text:value.text,video:value.video||'',video_name:String(value.video_name||'').slice(0,200),pass_score:80,questions};
}
export function gradeCourse(course,answers){
 let correct=0,total=0;const manual=[];
 for(let i=0;i<course.questions.length;i++){
  const q=course.questions[i],answer=answers?.[i];
  if(q.type==='text'){if(typeof answer!=='string'||!answer.trim()||answer.length>5000)throw new Error('answer_required');manual.push(i);continue}
  if(!Array.isArray(answer)||!answer.length||answer.some(x=>!Number.isInteger(x)||x<0||x>=q.options.length)||new Set(answer).size!==answer.length||q.type==='single'&&answer.length!==1)throw new Error('answer_required');
  total++;if(answer.length===q.answer.length&&answer.every(x=>q.answer.includes(x)))correct++;
 }
 return {score:total?Math.round(correct/total*10000)/100:null,correct,total,manual_count:manual.length};
}
