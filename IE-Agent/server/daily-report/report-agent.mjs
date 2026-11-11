// Deterministic wording from frozen facts. No model call or external content.
export function organizeDailyReport(snapshot, reportDate) {
  const primary = snapshot.risks[0] || null;
  const refs = primary?.evidenceIds.slice(0,5).map(id=>`event:${id}`) || [];
  const dateLabel = snapshot.coverage.observedDates.join('、') || '暂无回放日期';
  const sourcedAction=Boolean(primary && snapshot.sourceDimension===primary.dimension && snapshot.sourceAction);
  const recommendation = primary
    ? sourcedAction
      ? snapshot.sourceAction
      : '查看对应历史回放证据，并与安全员核对记录。'
    : null;
  const course=primary ? snapshot.approvedCourses.find(item=>item.dimension===primary.dimension)||null : null;
  const previous=snapshot.previousGoal;
  const newEvidence=Boolean(previous && (previous.scoreEvidenceId!==snapshot.score.scoreId || previous.eventType!==primary?.eventType || refs.some(ref=>!previous.evidenceRefs.includes(ref))));
  const goalTracking=previous ? {
    previousGoalId:previous.id,previousReportDate:previous.reportDate,previousStatus:previous.status,previousFeedbackCode:previous.feedbackCode||null,
    newEvidence,assessment:'pending_evidence',
    note:previous.status==='dismissed'?'上一期目标已选择暂不跟进；本期建议仍需重新核对证据。':newEvidence?'出现新的来源证据，但缺少完整可比暴露量，暂不能判断行为是否改善。':'与上一期相比尚无新的个人证据，暂不能判断行为是否改善。',
  } : null;
  const cards = primary ? [{
    type:'risk_insight', priority:1,
    title:`历史回放记录：${primary.eventName || primary.eventType}`,
    description:`已记录 ${primary.count} 条同类回放事件；覆盖日期：${dateLabel}。`,
    evidenceRefs:refs,
  }] : [];
  if (primary) cards.push({ type:'action', priority:2, title:'本期核对建议', description:recommendation, evidenceRefs:refs });
  if (course) cards.push({type:'learning_tip',priority:3,title:`已审批课程：${course.title}`,description:`课程 ${course.id} 与本期证据维度一致；是否正式分配仍由安全员决定。`,evidenceRefs:refs});
  const limitations = [
    '历史回放资料，不代表实时驾驶监测。',
    `事件来源实际覆盖日期：${dateLabel}；不据事件记录日期直接认定连续设备覆盖。`,
    '未取得本期已核实且可比的暴露分母，不计算事件发生率。','按当前绑定车辆展示历史参考；过去实际当班身份不足时，不认定为本人行为。',
  ];
  const comparisonReasons = { missing_score:'缺少有效评分', insufficient_history:'缺少第二期评分', not_comparable:'评分版本或方法不同', verify_data:'评分可信度不足', missing_window:'缺少评分窗口', overlapping_window:'两期评分窗口重叠' };
  if (snapshot.score.comparisonStatus !== 'comparable') limitations.push(`评分差值不可比：${comparisonReasons[snapshot.score.comparisonStatus] || '评分数据不足'}。`);
  if (snapshot.score.confidence === 'low') limitations.push('当前评分可信度低，应先核验数据覆盖与设备。');
  if (snapshot.fleet.status !== 'ok') limitations.push('车队均值不可用：同日同口径可比样本不足或未通过匿名展示条件。');
  if (!primary) limitations.push('没有当前绑定车辆可引用的回放事件，不能据此判断零风险。');
  return {
    schemaVersion:2, reportDate, driverId:snapshot.driverId, dataAsOf:`${snapshot.asOf}T23:59:59+08:00`, dataStatus:'historical_replay', sourceFingerprint:snapshot.sourceFingerprint,
    title:primary ? `历史安全简报：${primary.eventName || primary.eventType}记录核对` : '历史安全简报：数据覆盖待核对',
    summary:primary ? `在 ${dateLabel} 的历史回放中，当前绑定车辆记录了 ${primary.count} 条“${primary.eventName || primary.eventType}”记录；不代表本日新增事件。` : '当前可用回放中没有当前绑定车辆的事件证据，暂不作个人风险判断。',
    metrics:{ personalScore:snapshot.score.latest, personalScoreDate:snapshot.score.date, scoreEvidenceId:snapshot.score.scoreId, scoreChange:snapshot.score.delta, scoreComparisonStatus:snapshot.score.comparisonStatus, scoreConfidence:snapshot.score.confidence, fleetAverage:snapshot.fleet.average, fleetScoredDrivers:snapshot.fleet.scoredDrivers, fleetDate:snapshot.fleet.date, riskCount7d:snapshot.riskCount7d, riskRate:snapshot.riskRate },
    risks:snapshot.risks.slice(0,3).map((risk,index)=>({ eventType:risk.eventType, eventName:risk.eventName, dimension:risk.dimension, observedCount:risk.count, priority:index+1, priorityBasis:risk.priorityBasis, priorityScore:risk.priorityScore, firstObservedAt:risk.firstObservedAt, lastObservedAt:risk.lastObservedAt, evidenceRefs:risk.evidenceIds.slice(0,5).map(id=>`event:${id}`) })),
    cards,
    dailyGoal:primary ? { type:'evidence_review', description:recommendation, status:'pending_evidence', recommendationBasis:sourcedAction?'source_score_action':'historical_event_review', scoreEvidenceRef:sourcedAction&&snapshot.score.scoreId?`score:${snapshot.score.scoreId}`:null, evidenceRefs:refs } : null,
    goalTracking,
    approvedCourseRefs:course?[course.id]:[],
    coverage:snapshot.coverage,
    scoreTrend:{ basis:(snapshot.score.sourceVersion||'未取得版本')+' / '+(snapshot.score.method||'未取得方法'), dates:(snapshot.series||[]).map(x=>x.date), personal:(snapshot.series||[]).map(x=>x.personal), fleet:(snapshot.series||[]).map(x=>x.fleet), fleetComparableCount:(snapshot.series||[]).map(x=>x.fleetCount??null), note:'趋势仅呈现与当期口径一致且可信度中/高的观测日；缺日=无有效观测不插值；历史回放口径，不代表实时驾驶数据流。' },
    dataLimitations:limitations,
  };
}
