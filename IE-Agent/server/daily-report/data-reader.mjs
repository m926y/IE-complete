import { createHash } from 'node:crypto';

export const validDay = value => typeof value === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(value) && !Number.isNaN(Date.parse(value)) && new Date(value).toISOString().slice(0, 10) === value;
const digest = value => createHash('sha256').update(JSON.stringify(value)).digest('hex');

// The local store holds verified source rows. This adapter has no mutation path.
export function readDriverFacts(store, driverId, asOf) {
  if (!validDay(asOf) || typeof driverId !== 'string' || !/^[\w.-]{1,100}$/.test(driverId)) throw new Error('invalid_daily_report_input');
  if (!store || typeof store.rows !== 'function' || typeof store.sourceHash !== 'string') throw new Error('invalid_source_store');
  const drivers = store.rows('drivers');
  const matches = drivers.filter(row => row.driver_id === driverId);
  if (matches.length !== 1 || !matches[0].gpsno || !matches[0].fleet_id) throw new Error('driver_not_found_or_ambiguous');
  const driver = matches[0];
  // Source driver mapping is historical; it must cover every fact selected below.
  const mapped = day => day && (!driver.mapping_start || driver.mapping_start <= day) && (!driver.mapping_end || day <= driver.mapping_end);
  const history = store.rows('score_history').filter(row => row.driver_id === driverId && row.gpsno === driver.gpsno && validDay(row.as_of_date) && row.as_of_date <= asOf && mapped(row.as_of_date));
  const snapshots = store.rows('score_snapshots').filter(row => row.driver_id === driverId && row.gpsno === driver.gpsno && validDay(row.as_of_date) && row.as_of_date <= asOf && mapped(row.as_of_date));
  const eventTime = row => typeof row.event_time === 'string' && /^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}$/.test(row.event_time) ? row.event_time : null;
  const allEvents = store.rows('replay_events').filter(row => row.is_replay === true && validDay(row.replay_date) && eventTime(row));
  const events = allEvents.filter(row => row.driver_id === driverId && row.gpsno === driver.gpsno && row.replay_date <= asOf && row.event_time.slice(0, 10) === row.replay_date && mapped(row.replay_date));
  const latestDate = [...history, ...snapshots].map(row => row.as_of_date).sort().at(-1) || null;
  const fleetIds = new Set(drivers.filter(row => row.fleet_id === driver.fleet_id && (!latestDate || ((!row.mapping_start || row.mapping_start <= latestDate) && (!row.mapping_end || latestDate <= row.mapping_end)))).map(row => row.driver_id));
  const fleetScores = latestDate ? store.rows('score_history').filter(row => row.as_of_date === latestDate && fleetIds.has(row.driver_id)) : [];
  const latestSnapshot = snapshots.sort((a,b) => b.as_of_date.localeCompare(a.as_of_date) || b.score_id.localeCompare(a.score_id))[0] || null;
  // 趋势序列用的车队按日成员评分（成员集与 fleetScores 同基准日口径；不并入 fingerprint 之外的新表查询）
  const ownDates = [...new Set([...history, ...snapshots].filter(row => row.safety_score !== null && row.safety_score !== undefined && String(row.safety_score).trim() !== '').map(row => row.as_of_date))].sort();
  const trendDates = ownDates.slice(-7);
  const fleetScoresByDate = store.rows('score_history').filter(row => trendDates.includes(row.as_of_date) && fleetIds.has(row.driver_id) && row.gpsno);
  const ledger = latestSnapshot ? store.rows('deduction_ledger').filter(row => row.gpsno === driver.gpsno && row.as_of_date === latestSnapshot.as_of_date && row.source_version === latestSnapshot.source_version) : [];
  const cutoff=`${asOf}T23:59:59+08:00`;
  const approvedCourses = store.rows('training_courses').filter(row => row.content_status === 'approved' && typeof row.updated_at==='string' && !Number.isNaN(Date.parse(row.updated_at)) && Date.parse(row.updated_at)<=Date.parse(cutoff));
  const replayDates = [...new Set(allEvents.map(row => row.replay_date))].sort();
  const facts = { driver: { driver_id: driver.driver_id, gpsno: driver.gpsno, fleet_id: driver.fleet_id, mapping_start: driver.mapping_start, mapping_end: driver.mapping_end }, history, snapshots, events, fleetScores, fleetScoresByDate, trendDates, ledger, approvedCourses, replayDates, sourceHash: store.sourceHash, asOf };
  return { ...facts, fingerprint: digest(facts) };
}
