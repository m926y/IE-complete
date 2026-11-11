import { isDeepStrictEqual } from 'node:util';
import { organizeDailyReport } from './report-agent.mjs';
import { validDay } from './data-reader.mjs';
import schema from './report-schema.json' with { type:'json' };

const banned = /实时监测|实时风险警报|刚刚发生|今天发生了|今日新增风险|风险已经改善/;
const typeMatches = (value,type) => type==='null' ? value===null : type==='integer' ? Number.isSafeInteger(value) : type==='number' ? typeof value==='number' && Number.isFinite(value) : type==='array' ? Array.isArray(value) : type==='object' ? value!==null && typeof value==='object' && !Array.isArray(value) : typeof value===type;

function matchesSchema(value, rule) {
  if (rule.$ref) return matchesSchema(value,schema.$defs[rule.$ref.split('/').at(-1)]);
  if (rule.anyOf) return rule.anyOf.some(candidate=>matchesSchema(value,candidate));
  if (Object.hasOwn(rule,'const') && !isDeepStrictEqual(value,rule.const)) return false;
  if (rule.enum && !rule.enum.includes(value)) return false;
  if (rule.type && !(Array.isArray(rule.type) ? rule.type : [rule.type]).some(type=>typeMatches(value,type))) return false;
  if (typeof value==='string' && ((rule.maxLength!==undefined && value.length>rule.maxLength) || (rule.format==='date' && !validDay(value)))) return false;
  if (Array.isArray(value) && ((rule.maxItems!==undefined && value.length>rule.maxItems) || (rule.items && !value.every(item=>matchesSchema(item,rule.items))))) return false;
  if (value && typeof value==='object' && !Array.isArray(value)) {
    if (rule.required?.some(key=>!Object.hasOwn(value,key))) return false;
    if (rule.additionalProperties===false && Object.keys(value).some(key=>!Object.hasOwn(rule.properties,key))) return false;
    if (rule.properties && Object.entries(value).some(([key,item])=>rule.properties[key] && !matchesSchema(item,rule.properties[key]))) return false;
  }
  return true;
}

export function validateDailySafetyReport(report, snapshot) {
  if (!matchesSchema(report,schema)) throw new Error('invalid_report_schema');
  const expectedAsOf = new Date(Date.parse(report.reportDate+'T00:00:00Z')-86400000).toISOString().slice(0,10);
  if (snapshot?.asOf !== expectedAsOf) throw new Error('report_date_snapshot_mismatch');
  if (!snapshot || report.driverId !== snapshot.driverId || report.sourceFingerprint !== snapshot.sourceFingerprint || report.dataStatus !== 'historical_replay') throw new Error('report_fact_mismatch');
  const expected = organizeDailyReport(snapshot, report.reportDate);
  // The template has one canonical representation per frozen snapshot and prior-goal context.
  // This checks all numbers, evidence, course refs, coverage, and wording together.
  if (!isDeepStrictEqual(report, expected)) throw new Error('report_fact_mismatch');
  if (banned.test(JSON.stringify(report))) throw new Error('report_freshness_violation');
  return report;
}
