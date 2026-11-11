// Only explicit, unambiguous fields in the current user message qualify for the deterministic path.
export function explicitTrainingRequest(text,courses){
 const s=String(text||'');
 if(!/(?:创建|安排|分配|准备|分发|课程选择|课程选)/.test(s)||/(?:为什么|为何|不能|失败|不要|不生成|未选|没选)/.test(s))return null;
 const chosen=courses.filter(c=>c.status==='approved'&&(new RegExp('(?:^|[^A-Za-z0-9_])'+c.course_id+'(?:$|[^A-Za-z0-9_])','i').test(s)||s.includes(c.title)));
 if(chosen.length!==1)return null;
 const dates=[...s.matchAll(/(20\d{2})[-年/](\d{1,2})[-月/](\d{1,2})日?/g)].map(m=>m[1]+'-'+m[2].padStart(2,'0')+'-'+m[3].padStart(2,'0'));
 if(new Set(dates).size!==1)return null;
 let cohort=null,gpsno;const vehicle=/车辆\s*([1-9]\d*)/.exec(s);
 if(vehicle){if((s.match(/车辆\s*[1-9]\d*/g)||[]).length!==1)return null;cohort='vehicle';gpsno='车辆'+vehicle[1]}
 else if(/(?:所有|全部|全体)\s*(?:的)?\s*司机/.test(s))cohort='all';
 else if(/低可信度/.test(s))cohort='low_confidence';
 else{const grades=[...s.matchAll(/([ABCD])\s*级/gi)].map(m=>m[1].toLowerCase());const unique=[...new Set(grades)];if(unique.length===1)cohort=unique[0];else if(unique.length===2&&unique.includes('c')&&unique.includes('d'))cohort='cd'}
 return cohort?{course_id:chosen[0].course_id,cohort,due_at:dates[0],...(gpsno?{gpsno}:{})}:null;
}
