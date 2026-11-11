// R41：个性化叙述生成器（AI 只写文字；数字/证据/措辞三重守门，不过关回落规则模板）
const BANNED = /实时监测|实时风险警报|刚刚发生|今天发生了|今日新增风险|风险已经改善|已经改善|事故已避免|已送达|已扣分|将降低事故|保证|确保安|罚款|处罚/;
const NUM_RE = /[0-9０-９]+(?:[.．][0-9０-９]+)?/g;
const nf = (v) => {
  const half = String(v).replace(/[０-９]/g, ch => String.fromCharCode(ch.charCodeAt(0) - 0xFF10 + 48)).replace(/[．]/g, '.');
  const out = new Set([half]);
  if (/^\d+(\.\d+)?$/.test(half)) {
    out.add(String(Number(half)));
    out.add(Number(half).toFixed(2).replace(/\.?0+$/, ''));
    out.add(Number(half).toFixed(2));
  }
  return [...out];
};
export function allowedNumberStrings(report, snapshot) {
  const m = report.metrics; const allow = new Set(["1", "2", "3", "4", "5", "6", "7", "0"]);
  const add = (v) => { if (v === null || v === undefined || v === '') return; for (const x of nf(v)) allow.add(x); };
  add(m.personalScore); add(m.scoreChange === null ? null : Math.abs(Number(m.scoreChange))); add(m.fleetAverage); add(m.fleetScoredDrivers);
  add(String(m.personalScoreDate || '').slice(0, 4)); add(String(m.personalScoreDate || '').replace(/^(\d{4})-0?(\d{2})-0?(\d{2})$/, (f, a, b, c) => [a, b, c].join(' ')).split(' ')[0]);
  for (const dpart of [m.personalScoreDate, report.reportDate, report.dataAsOf, ...(report.scoreTrend?.dates || []), ...(report.coverage?.observedDates || [])]) {
    if (typeof dpart === 'string') for (const seg of dpart.split(/[-T: ]/)) add(seg.replace(/^0+(?=\d)/, ''));
  }
  for (const r of report.risks || []) { add(r.observedCount); for (const seg of [String(r.firstObservedAt || '').split(/[-T: ]/), String(r.lastObservedAt || '').split(/[-T: ]/)].flat()) add(seg.replace(/^0+(?=\d)/, '')); }
  for (const s of snapshot?.series || []) { add(s.personal); add(s.fleet); add(s.fleetCount); }
  if (report.approvedCourseRefs?.length) add(report.approvedCourseRefs.length);
  return allow;
}
export function verifyNarrative(n, report, allow) {
  if (!n || typeof n !== 'object') return { ok: false, errors: ['shape'] };
  const errors = [];
  const texts = [];
  if (typeof n.greeting !== 'string' || !n.greeting.trim() || n.greeting.length > 60) errors.push('greeting'); else texts.push(n.greeting);
  if (typeof n.analysis !== 'string' || n.analysis.length < 10 || n.analysis.length > 380) errors.push('analysis'); else texts.push(n.analysis);
  if (!Array.isArray(n.items) || n.items.length < 1 || n.items.length > 3) errors.push('items');
  const refsPool = new Set([...(report.risks || []).flatMap(r => r.evidenceRefs || []), ...(report.dailyGoal?.evidenceRefs || []), ...(report.cards || []).flatMap(c => c.evidenceRefs || []), ...(report.metrics.scoreEvidenceId ? ['score:' + report.metrics.scoreEvidenceId] : []), ...(report.dailyGoal?.scoreEvidenceRef ? [report.dailyGoal.scoreEvidenceRef] : [])]);
  const riskNames = (report.risks || []).map(r => r.eventName || r.eventType);
  (n.items || []).forEach((it, k) => {
    if (!it || typeof it !== 'object') { errors.push('item' + k); return; }
    for (const key of ['title', 'observation', 'advice']) { if (typeof it[key] !== 'string' || !it[key].trim() || it[key].length > 160) errors.push(`item${k}.${key}`); else texts.push(it[key]); }
    if (!Array.isArray(it.evidenceRefs) || !it.evidenceRefs.length || !it.evidenceRefs.every(x => typeof x === 'string' && refsPool.has(x))) errors.push(`item${k}.refs`);
  });
  if (typeof n.goal !== 'string' || n.goal.length < 6 || n.goal.length > 160) errors.push('goal'); else texts.push(n.goal);
  const joined = texts.join('\n');
  if (BANNED.test(joined)) errors.push('banned_word');
  if (joined.includes('%')) errors.push('percent');
  const nums = joined.match(NUM_RE) || [];
  for (const raw of new Set(nums)) { if (![...nf(raw)].some(v => allow.has(v))) errors.push('number:' + raw); }
  if (!riskNames.some(rn => rn && (n.analysis + JSON.stringify(n.items)).includes(rn.slice(0, 2)))) errors.push('not_personalized');
  return { ok: errors.filter((x, i, a) => a.indexOf(x) === i).length === 0, errors: [...new Set(errors)] };
}
export function personalizerMessages(report, snapshot, feedbackHint, repairNote) {
  const m = report.metrics;
  const factsLite = {
    reportDate: report.reportDate, businessGreetingSlot: feedbackHint?.greeting || '按时段自选（早/午/晚）', dataStatus: report.dataStatus,
    personalScore: m.personalScore, personalScoreDate: m.personalScoreDate, scoreConfidence: m.scoreConfidence, scoreChange: m.scoreChange, scoreComparisonStatus: m.scoreComparisonStatus,
    fleetAverage: m.fleetAverage, fleetScoredDrivers: m.fleetScoredDrivers, fleetDate: m.fleetDate,
    trend: { dates: report.scoreTrend.dates, personal: report.scoreTrend.personal, fleet: report.scoreTrend.fleet },
    risks: (report.risks || []).map(r => ({ eventType: r.eventType, eventName: r.eventName, dimension: r.dimension, observedCount: r.observedCount, firstObservedAt: r.firstObservedAt, lastObservedAt: r.lastObservedAt, evidenceRefs: r.evidenceRefs })),
    previousGoalTracking: report.goalTracking, driverFeedbackHint: feedbackHint?.feedbackCode || null,
    approvedCourse: (report.cards || []).find(c => c.type === 'learning_tip') || null,
    dataLimitations: report.dataLimitations, coverageObservedDates: report.coverage.observedDates,
  };
  const system = [
    '你是物流车队驾驶安全分析智能体，为一名司机生成当晚的个性化安全简报叙述（移动端阅读）。',
    '铁律：1) 所有数字只能逐字使用输入事实中出现的数值与日期，不得计算、换算、四舍五入出新值；禁止出现 % 与任何百分比。',
    '2) 每条风险的 observation/advice 必须引用 evidenceRefs 中已有的证据 ID（字符串原样），不得杜撰。',
    '3) 这是历史回放数据：禁止"实时监测/刚刚发生/今天发生了"等措辞；禁止承诺或断言风险已改善、事故已避免、已送达、处罚等。',
    '4) 个性化=针对该司机本人的风险构成（事件类型/次数/时间跨度/趋势点）与上期目标跟踪情况给出可执行建议；建议面向司机本人、可在下次驾驶执行；不得推荐输入之外的课程。',
    '5) 若 facts.previousGoalTracking 显示司机上期有反馈（feedbackHint），需在 analysis 中呼应一次。',
    '6) 仅输出 JSON：{"greeting":"≤40字问候+一句话总评","analysis":"80-260字个性化分析","items":[{"title":"≤20字","observation":"≤80字现象(含数字)","advice":"≤100字建议","evidenceRefs":["..."]}],"goal":"≤60字今日改善目标(动词开头,可执行)"}',
    repairNote ? '7) 上一稿未通过校验，原因：' + repairNote + '。修正后重新输出完整 JSON。' : '',
  ].filter(Boolean).join('\n');
  return [{ role: 'system', content: system }, { role: 'user', content: JSON.stringify(factsLite).slice(0, 7000) }];
}
