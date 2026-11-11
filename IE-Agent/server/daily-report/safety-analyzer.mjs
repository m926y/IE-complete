import { finiteNumber, fleetStatistics } from '../driver-actions.mjs';
import { validDay } from './data-reader.mjs';

const quality = row => row && ['medium','high'].includes(row.confidence_level) && finiteNumber(row.safety_score) !== null;
const usable = row => row && ['usable','usable_with_review','manual_review'].includes(row.score_status) && finiteNumber(row.safety_score) !== null;
const byLatest = (a,b) => b.as_of_date.localeCompare(a.as_of_date) || b.score_id.localeCompare(a.score_id);

export function computeDriverSnapshot(facts) {
  if (!facts || !validDay(facts.asOf) || !Array.isArray(facts.history)) throw new Error('invalid_driver_facts');
  const scores = [...facts.history, ...facts.snapshots].filter(usable).sort(byLatest);
  const latest = scores[0] || null;
  const prior = latest ? scores.find(row => row.as_of_date < latest.as_of_date) || null : null;
  const sameBasis = Boolean(latest && prior && latest.source_version && latest.source_version === prior.source_version && latest.score_method && latest.score_method === prior.score_method);
  const validWindows = Boolean(latest && prior && validDay(latest.window_start) && validDay(prior.window_start) && latest.window_start <= latest.as_of_date && prior.window_start <= prior.as_of_date);
  const nonOverlapping = validWindows && latest.window_start > prior.as_of_date;
  const scoreDelta = sameBasis && quality(latest) && quality(prior) && nonOverlapping ? Number((finiteNumber(latest.safety_score) - finiteNumber(prior.safety_score)).toFixed(4)) : null;
  const comparisonStatus = !latest ? 'missing_score' : !prior ? 'insufficient_history' : !sameBasis ? 'not_comparable' : !quality(latest) || !quality(prior) ? 'verify_data' : !validWindows ? 'missing_window' : !nonOverlapping ? 'overlapping_window' : 'comparable';
  const fleetBasisMatches = latest && facts.fleetScores.every(row => row.source_version === latest.source_version && row.score_method === latest.score_method);
  const fleet = latest && latest.source_version && latest.score_method && fleetBasisMatches ? fleetStatistics(facts.fleetScores) : { data_status:'missing_or_mixed_basis', average:null, valid_count:null };
  const grouped = new Map();
  for (const event of facts.events) {
    if (!event.event_id || !event.event_type || !event.event_time) continue;
    const key = String(event.event_type);
    if (!grouped.has(key)) grouped.set(key, { eventType:key, eventName:event.event_name || null, dimension:event.dimension || null, evidenceIds:[], eventTimes:[] });
    const group = grouped.get(key);
    if (!group.evidenceIds.includes(event.event_id)) { group.evidenceIds.push(event.event_id); group.eventTimes.push(event.event_time); }
  }
  // 评分趋势（确定性，与当期口径同版本/方法；缺日=无有效观测，不插值）
  const basisVersion = latest?.source_version || null, basisMethod = latest?.score_method || null;
  const dateMap = new Map(); for (const row of [...facts.history, ...facts.snapshots]) { if (row && row.as_of_date) { if (!dateMap.has(row.as_of_date) || (Number(row.safety_score) !== null && Number.isFinite(Number(row.safety_score)) && row.source_version === basisVersion)) dateMap.set(row.as_of_date, row); } }
  const trendDates = (facts.trendDates || [...dateMap.keys()].sort().slice(-7));
  const series = trendDates.map(date => {
    const own = dateMap.get(date);
    const personalOk = own && own.source_version === basisVersion && own.score_method === basisMethod && ['medium','high'].includes(own.confidence_level) && ['usable','usable_with_review','manual_review'].includes(own.score_status) && finiteNumber(own.safety_score) !== null;
    let fleetPoint = null;
    if (Array.isArray(facts.fleetScoresByDate)) { const rows = facts.fleetScoresByDate.filter(r => r.as_of_date === date && r.source_version === basisVersion && r.score_method === basisMethod); const st = rows.length ? fleetStatistics(rows) : null; if (st && st.data_status === 'ok') fleetPoint = st; }
    return { date, personal: personalOk ? finiteNumber(own.safety_score) : null, fleet: fleetPoint ? fleetPoint.average : null, fleetCount: fleetPoint ? fleetPoint.valid_count : null };
  });
  const risks = [...grouped.values()].map(group => ({ ...group, count:group.evidenceIds.length, evidenceIds:group.evidenceIds.sort(), firstObservedAt:group.eventTimes.sort()[0], lastObservedAt:group.eventTimes.at(-1), priorityBasis:'observed_replay_count', priorityScore:null })).map(({eventTimes,...row})=>row).sort((a,b)=>b.count-a.count || a.eventType.localeCompare(b.eventType));
  const observedDates = facts.replayDates.filter(day => day <= facts.asOf);
  const coverage = { source:'historical_replay', observedDates, firstOwnedEventAt:facts.events.map(row=>row.event_time).sort()[0] || null, complete7d:false, complete30d:false, exposureAvailable:false };
  void dateMap;
  return {
    driverId:facts.driver.driver_id, fleetId:facts.driver.fleet_id, asOf:facts.asOf, sourceFingerprint:facts.fingerprint,
    score: { latest:latest ? finiteNumber(latest.safety_score) : null, date:latest?.as_of_date || null, scoreId:latest?.score_id || null, method:latest?.score_method || null, sourceVersion:latest?.source_version || null, confidence:latest?.confidence_level || null, status:latest?.score_status || null, delta:scoreDelta, comparisonStatus },
    fleet: { average:fleet.average ?? null, scoredDrivers:fleet.valid_count ?? null, status:fleet.data_status, date:latest?.as_of_date || null, sourceVersion:fleet.source_version || null },
    risks, riskRate:null, riskCount7d:null, coverage, series,
    sourceAction: facts.snapshots.find(row=>row.score_id===latest?.score_id)?.recommended_action || null,
    sourceDimension: facts.snapshots.find(row=>row.score_id===latest?.score_id)?.primary_risk_dimension || null,
    approvedCourses:facts.approvedCourses.filter(row=>row.course_id && row.title && row.dimension).map(row=>({id:row.course_id,title:row.title,dimension:row.dimension})).sort((a,b)=>a.id.localeCompare(b.id)),
  };
}
