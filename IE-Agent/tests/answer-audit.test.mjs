import assert from 'node:assert/strict';
import test from 'node:test';
import {ruleAuditAnswer, createAnswerAuditor, AI_CLAIM_RULES,formatAuditNotice} from '../server/answer-audit.mjs';

test('rule audit flags ungrounded claims and passes grounded answers', () => {
  // 无产物却声称已生成清单/按钮 → 命中
  assert.ok(ruleAuditAnswer('已为你生成课程草稿清单，请点击下方确认按钮保存。', [], [], []).length > 0);
  // 有确认清单 → 同样的系统文案放行
  assert.deepEqual(ruleAuditAnswer('已准备培训课程草稿清单：1 项。尚未创建，请检查下方清单后确认执行。', [{ id: 'p' }], [], []), []);
  // 有草稿（propose_* 通道）→ 放行
  assert.deepEqual(ruleAuditAnswer('已生成沟通草稿，下方卡片确认后发送。', [], [], [{ kind: 'intervention' }]), []);
  // 有附件 → 下载提示放行
  assert.deepEqual(ruleAuditAnswer('已生成车队周报文件，请点击下载 HTML 或 Markdown。', [], [{ id: 'a' }], []), []);
  // 声称业务写入完成 → 永远命中（AI 零写库）
  assert.ok(ruleAuditAnswer('培训任务已分配给对应司机。', [], [], []).length > 0);
  assert.ok(ruleAuditAnswer('账号已创建完成，可以直接登录。', [{ id: 'p' }], [], []).length > 0);
  // 普通事实回答 → 放行
  assert.deepEqual(ruleAuditAnswer('车队当前平均分78.2，D级车辆50辆，数据截止2026-07-31。', [], [], []), []);
  // 否定句/指引语在无产物时仍会被规则标记（交由模型复核层排除误报）
  assert.ok(AI_CLAIM_RULES.length >= 4);
});

test('answer auditor: llm review reduces false positives, confirms hallucinations, degrades gracefully', async () => {
  const calls = [];
  // 模型复审判定非幻觉（条件句/指引语）→ passed
  const okAuditor = createAnswerAuditor({ aiAvailable: () => true, aiModel: () => 'test-model', aiUpstream: async () => ({ choices: [{ message: { content: '{"hallucination":false,"problems":[]}' } }] }) });
  const r1 = await okAuditor('生成课程草稿后，下方会出现确认卡片。', calls, [], [], []);
  assert.equal(r1.passed, true);
  assert.equal(r1.llm_checked, false);
  // 模型复核确认幻觉 → 返回可读问题
  const badAuditor = createAnswerAuditor({ aiAvailable: () => true, aiModel: () => 'test-model', aiUpstream: async () => ({ choices: [{ message: { content: '{"hallucination":true,"problems":["声称已生成确认清单但本轮无工具产出"]}' } }] }) });
  const r2 = await badAuditor('已为你生成课程草稿，点击下方确认按钮保存。', calls, [], [], []);
  assert.equal(r2.passed, false);
  assert.deepEqual(r2.issues, ['声称已生成确认清单但本轮无工具产出']);
  assert.equal(r2.corrected, true);
  // 模型不可用 → 退回规则结果
  const offAuditor = createAnswerAuditor({ aiAvailable: () => false, aiModel: () => 'test-model', aiUpstream: async () => { throw new Error('unavailable'); } });
  const r3 = await offAuditor('账号已创建完成。', calls, [], [], []);
  assert.equal(r3.passed, false);
  assert.equal(r3.llm_checked, false);
  assert.ok(r3.issues.length > 0);
  // 模型调用抛错 → 同样退回规则结果，不中断主链路
  const errAuditor = createAnswerAuditor({ aiAvailable: () => true, aiModel: () => 'test-model', aiUpstream: async () => { throw new Error('upstream down'); } });
  const r4 = await errAuditor('已为你生成待确认清单。', calls, [], [], []);
  assert.equal(r4.passed, false);
  assert.equal(r4.llm_checked, false);
  // 规则层通过 → 不触发模型审计（成本控制）
  let upstreamCalls = 0;
  const quietAuditor = createAnswerAuditor({ aiAvailable: () => true, aiModel: () => 'test-model', aiUpstream: async () => { upstreamCalls++; return { choices: [{ message: { content: '{}' } }] }; } });
  const r5 = await quietAuditor('车队平均分78.2，建议关注低可信度车辆。', calls, [], [], []);
  assert.equal(r5.passed, true);
  assert.equal(upstreamCalls, 0);
});

test('conditional suggestions and honest refusals never become completed-operation claims',async()=>{
 let reviews=0;
 const audit=createAnswerAuditor({aiAvailable:()=>true,aiModel:()=> 'test',aiUpstream:async()=>{reviews++;throw Error('must not call');}});
 for(const text of ['如果你需要重新规划培训方案，我可以帮你生成新的待确认清单供参考。','我无法直接删除培训任务。','我可为你生成课程草稿。','我将为你准备培训任务清单。','生成课程草稿后，下方会出现确认卡片。','培训任务尚未创建，课程不会自动分配。','请在培训任务台账勾选任务，点击删除所选并确认。']){
  const result=await audit(text,[],[],[],[]);assert.equal(result.passed,true,text);
 }
 assert.equal(reviews,0);
 assert(ruleAuditAnswer('已为你生成课程草稿，但未发送通知。',[],[],[]).length);
 assert(ruleAuditAnswer('我可以生成草稿。另外，培训任务已分配给司机。',[],[],[]).length);
});

test('screenshot scenario explains the actual deletion workflow without inventing an execution',async()=>{
 const audit=createAnswerAuditor({aiAvailable:()=>false,aiModel:()=> 'test'});
 const answer='我无法直接删除培训任务。系统没有提供删除或取消已创建培训任务的工具接口。如果你需要重新规划培训方案，我可以帮你生成新的待确认清单供参考。';
 const result=await audit(answer,[],[],[],[],{question:'请你删除所有当前的培训任务',role:'safety_admin',page:'tr-ledger'});
 assert.equal(result.passed,false);assert.equal(result.llm_checked,false);
 assert(!result.issues.some(x=>x.includes('声称')));
 const notice=formatAuditNotice(result,[],[],[]);assert.match(notice,/培训任务台账/);assert.match(notice,/删除所选/);assert.match(notice,/可能原因/);assert.doesNotMatch(notice,/补齐|上传附件|上一条回答与实际执行不符/);
 const good=await audit('聊天没有删除工具，本轮未执行删除；请到培训任务台账筛选、勾选并确认删除。',[],[],[],[],{question:'删除当前培训任务',role:'safety_admin'});assert.equal(good.passed,true);
 const driver=await audit(answer,[],[],[],[],{question:'删除培训任务',role:'driver'});assert.match(driver.solutions.join(),/司机账号不能删除/);
});

test('tool errors produce specific causes and next steps, with exact artifact counts',async()=>{
 const audit=createAnswerAuditor({aiAvailable:()=>false,aiModel:()=> 'test'});
 for(const [status,reason,expected]of [['tool_error','course_not_approved','课程库'],['tool_error','driver_binding_changed','绑定'],['tool_error','agent_score_version_changed','新清单'],['refused_no_scope','forbidden','授权'],['tool_budget_exceeded','','拆分问题'],['unknown_tool','','未提供的工具']]){
  const r=await audit('操作暂未完成。',[{name:'prepare_training_batch',out:{status,data:{reason}}}],[],[],[],{question:'给司机创建培训'});assert.equal(r.passed,false);assert.match([...r.possible_causes,...r.solutions].join(),new RegExp(expected));assert.doesNotMatch(formatAuditNotice(r),/上传附件|未写入任何业务数据/);
 }
 const r=await audit('已为你生成课程草稿。',[],[],[{id:'report'}],[],{question:'创建课程'});const n=formatAuditNotice(r,[],[{id:'report'}],[]);assert.match(n,/附件 1 份/);assert.doesNotMatch(n,/未生成.*附件/);
});
