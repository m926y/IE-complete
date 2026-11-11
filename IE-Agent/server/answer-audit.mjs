// 回答审计智能体：核对 AI 回答中的"主张"与本轮真实执行事实，拦截声称型幻觉。
// 三层：①规则初筛（零成本，词表对照产物）②模型审计复核（仅可疑时触发，降误报）③确定性更正建议。
// 数字类事实由证据卡/受控工具机制约束，本模块专管"声称做了但实际没做"的回答。

export const AI_CLAIM_RULES = [
  { rx: /(已|为你|为您|帮您|帮你).{0,14}(生成|创建|准备|保存|提交|拟定).{0,18}(清单|卡片|草稿|课程|账号|任务|方案|批次)/, needs: "plan", label: "声称已生成待确认清单或草稿，但本轮没有任何工具产出清单" },
  { rx: /(下方|下面|下文).{0,12}(确认|清单|卡片|按钮)|(确认|保存).{0,4}按钮/, needs: "plan", label: "提到界面存在确认卡片或按钮，但本轮没有生成任何待确认清单" },
  { rx: /(已|为你|为您).{0,14}(生成|创建|产出).{0,18}(周报|报告文件|附件|文件)|点击.{0,6}下载/, needs: "artifact", label: "声称已生成文件附件，但本轮没有产出任何附件" },
  { rx: /(账号|任务|课程|通知|培训).{0,8}已(创建|分配|发放|提交|入库|下发)|已(完成|执行).{0,8}(创建|分配|审核|发放|写入)/, needs: "never", label: "声称已完成业务写入——AI 从不直接写库，创建/分配必须由人工在确认卡片或页面执行" },
  // 模型可能背诵历史回复中的服务端固定覆写文案（如“已准备…清单：0 项”）而不重新查询
  { rx: /已准备(?:培训任务|账号导入|培训课程草稿)清单：|请检查下方清单后确认执行/, needs: "plan", label: "复述了系统清单文案但本轮未真实生成清单——数据库状态可能已变化，应重新调用工具查询" },
];

// 规则初筛：返回命中的可疑主张列表（空=通过）
export function ruleAuditAnswer(answer, plans, artifacts, drafts) {
  const clauses = String(answer || "").split(/[。！？；\n，]|但是|但(?=已)/).filter(Boolean);
  const hits = [];
  for (const r of AI_CLAIM_RULES) {
    const asserted = clauses.some(text => {
      const match=r.rx.exec(text);if(!match)return false;
      // Only completed/present claims need a matching artifact. Suggestions, refusals,
      // future offers and quoted examples are not statements of execution.
      const prefix=text.slice(0,match.index+1);
      if(/尚未|还未|没有|未曾|未能|不能|无法|不会|不自动|不支持/.test(prefix))return false;
      if(/^(?:如果|若|如需|假如|例如|比如|用户说|你说|原话)/.test(text.trim()))return false;
      if(/可以|能够|愿意|将|会|打算|建议|需要时|之后|后[，：:]?$/.test(prefix)||/(?:^|我|也|还)可/.test(prefix))return false;
      if(/(?:下方|下面|下文).{0,6}(?:会|将|可)/.test(text))return false;
      if(/(?:确认|生成|创建|审核).{0,12}后.{0,12}(?:会|可|再)/.test(text))return false;
      // A real platform page can have buttons without a chat action plan.
      if(r.needs==='plan'&&/台账|页面|课程库|历史|上一轮|之前/.test(text)&&!/已.{0,12}(?:生成|准备|创建)/.test(text))return false;
      return true;
    });
    if (!asserted) continue;
    if (r.needs === "plan" && ((plans || []).length || (drafts || []).length)) continue;
    if (r.needs === "artifact" && (artifacts || []).length) continue;
    hits.push(r.label);
  }
  return hits;
}

export function businessAudit(answer,calls=[],context={}) {
  const issues=[],causes=[],solutions=[];
  const question=String(context.question||'');
  const deletingTraining=/删除|取消|清空/.test(question)&&/培训|课程任务/.test(question);
  if(deletingTraining&&!/培训任务台账|培训台账|tr-ledger/.test(answer)){
    issues.push('培训删除的业务指引不够准确');
    causes.push('聊天 Agent 尚未接入删除培训任务的工具；平台的培训任务台账已提供删除功能。不能把聊天工具的能力限制说成平台没有该功能。');
    if(context.role==='driver')solutions.push('司机账号不能删除培训任务，请联系有权限的管理员或安全员处理。');
    else solutions.push('进入[培训任务台账](#/tr-ledger)，先筛选并核对任务，再勾选所需记录或选择全部筛选结果，点击“删除所选”并确认；历史学习记录和审计记录保留。');
  }
  for(const c of calls){
    const status=c.out?.status,code=String(c.out?.data?.reason||'');
    if(!['tool_error','refused_no_scope','tool_budget_exceeded','unknown_tool'].includes(status))continue;
    issues.push(`工具 ${c.name} 未成功完成（${code||status}）`);
    if(status==='refused_no_scope'){
      causes.push('当前登录角色或车队范围不满足该操作权限。');solutions.push('核对当前账号和车队授权；由有权限的管理员或安全员执行，不要通过更换提问方式绕过权限。');
    }else if(code==='course_not_approved'||code==='course_changed'){
      causes.push('所选课程尚未审核通过，或课程版本、审核状态已经变化。');solutions.push('在课程库完成审核，重新查询已审核课程并生成新的待确认培训清单。');
    }else if(/binding/.test(code)){
      causes.push('司机账号的有效状态或车辆绑定可能已变化。');solutions.push('在司机与车辆绑定页面核实账号与当前车辆关系，再重新生成清单。');
    }else if(/version|expired/.test(code)){
      causes.push('清单可能已过期，或评分版本已更新。');solutions.push('重新查询当前评分和业务状态，生成新清单后再人工确认。');
    }else if(status==='tool_budget_exceeded'){
      causes.push('本轮工具调用已达到上限。');solutions.push('缩小对象范围或拆分问题；已返回的清单需要单独核对，不代表已执行。');
    }else if(/attachment|upload/.test(code)){
      causes.push('本轮附件可能已过期、无法读取或不符合所选工具要求。');solutions.push('检查实际附件及错误提示，必要时重新上传后重试。');
    }else if(status==='unknown_tool'){
      causes.push('模型请求了当前未提供的工具。');solutions.push('使用已有受控工具或相应业务页面；不能把请求工具当作已执行操作。');
    }else{
      causes.push('工具调用失败，具体原因需要结合错误码及服务端日志核查，不能据此认定数据已被修改。');solutions.push('先刷新对应业务台账核对实际状态，再按错误码检查服务和输入参数；核对后再重试。');
    }
  }
  return {issues:[...new Set(issues)],possible_causes:[...new Set(causes)],solutions:[...new Set(solutions)]};
}

export function formatAuditNotice(result,plans=[],artifacts=[],drafts=[]) {
  const facts=`本轮实际返回：待确认清单 ${plans.length} 份、附件 ${artifacts.length} 份、表单草稿 ${drafts.length} 份。待确认内容须人工确认后才执行；是否已执行请查业务台账。`;
  return ['【业务核对与建议】',result.issues.join('；')+'。',...result.possible_causes.map(x=>'可能原因：'+x),...result.solutions.map(x=>'处理建议：'+x),facts].join('\n\n');
}

// 审计智能体：规则命中后用模型复核（排除引用指引语/条件句/转述用户原话等误报）。
// deps 注入 {aiUpstream, aiAvailable, aiModel}，保持本模块可独立单测。
export function createAnswerAuditor(deps) {
  const { aiUpstream, aiAvailable, aiModel } = deps;
  return async function auditAiAnswer(answer, calls, plans, artifacts, drafts, context={}) {
    const ruleIssues = ruleAuditAnswer(answer, plans, artifacts, drafts);
    const business=businessAudit(answer,calls,context);
    const finish=(issues,llm_checked)=>{
      const all=[...new Set([...issues,...business.issues])];
      const possible_causes=[...business.possible_causes],solutions=[...business.solutions];
      if(issues.length){
        possible_causes.push('回答可能混淆了操作建议、待确认清单和实际执行结果，或沿用了历史对话中的旧状态。');
        if(plans?.length)solutions.push('检查本轮真实确认卡片的对象、课程和数量；确认后到相应台账核对结果。');
        else if(/账号/.test(context.question||''))solutions.push('检查账号导入表的校验结果，生成真实的待确认账号清单；已创建账号须到账号管理查询，不凭聊天记忆断言。');
        else if(/周报|报告|下载/.test(context.question||''))solutions.push('调用报告生成工具，取得真实附件后再提供下载指引；无数据或生成失败时如实说明。');
        else if(/课程/.test(context.question||''))solutions.push('先区分创建课程草稿与分发培训任务；据文件建课时核对实际附件，课程经确认入库并审核通过后才能分发。');
        else if(/培训/.test(context.question||''))solutions.push('创建培训需先查询已审核课程并生成真实待确认清单；查询进度需读取培训台账。删除培训则到培训任务台账勾选确认。');
        else solutions.push('按本轮实际工具返回核查清单、附件及业务台账；需要执行操作时使用支持的工具或业务页面，并完成必要确认。');
      }
      return {passed:!all.length,issues:all,possible_causes,solutions,llm_checked,corrected:!!all.length};
    };
    if (!ruleIssues.length) return finish([],false);
    if (aiAvailable()) {
      try {
        const j = await aiUpstream({
          model: aiModel(), temperature: 0, max_tokens: 280,
          messages: [
            { role: "system", content: "你是平台回答审计智能体。判断【回答】是否存在未被【执行事实】支持的声称，例如：声称已生成确认清单/卡片/按钮、声称已生成文件附件、声称已完成账号创建或任务分配等业务写入。注意：指引语（如“确认后会出现”“请点击下方按钮”在确有清单时）、条件句、否定句（“尚未创建”“不会自动分配”）和转述都不算幻觉。输出纯JSON，不带代码围栏：{\"hallucination\":true或false,\"problems\":[\"一句话中文描述\"]}" },
            { role: "user", content: JSON.stringify({
              回答: String(answer).slice(0, 2500),
              执行事实: {
                用户问题:String(context.question||'').slice(0,1000),当前角色:context.role,当前页面:context.page,
                能力边界:'聊天工具可以准备待确认培训及课程清单；删除培训需到培训任务台账勾选删除。不能把待执行建议当作已经执行。',
                工具调用: (calls || []).map((c) => ({ tool: c.name, status: c.out?.status, reason:c.out?.data?.reason, 台账查询结果:c.name==='get_tasks'?c.out?.data:undefined, 产出确认清单: Boolean(c.out?.action_plan), 产出附件: Boolean(c.out?.artifact) })),
                确认清单数: (plans || []).length, 附件数: (artifacts || []).length, 草稿数: (drafts || []).length,
              },
              规则疑点: ruleIssues,
            }) },
          ],
        });
        const d = JSON.parse(String(j.choices?.[0]?.message?.content || "").replace(/^```(?:json)?\s*|\s*```$/g, ""));
        if (d.hallucination === false) return finish([],true);
        const problems = (Array.isArray(d.problems) ? d.problems : []).slice(0, 3).map((x) => String(x).slice(0, 160));
        return finish(problems.length ? problems : ruleIssues,true);
      } catch { /* 模型审计失败退回规则结果 */ }
    }
    return finish(ruleIssues,false);
  };
}
