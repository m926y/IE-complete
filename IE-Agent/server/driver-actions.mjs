import { createHash } from "node:crypto";

// Read-only projections. Callers supply an authorized read function; no writes or audit access.
export const DIMENSIONS = ["history_contribution", "fatigue_distraction_contribution", "driving_stability_contribution", "road_rule_contribution", "management_contribution", "imu_evidence_contribution"];
export const SCORE_COLUMNS = ["score_id", "driver_id", "as_of_date", "window_start", "safety_score", "confidence_level", "score_status", "score_method", "source_version", ...DIMENSIONS].join(",");
export function finiteNumber(value) {
  if (value == null || !["number", "string"].includes(typeof value) || String(value).trim() === "") return null;
  const number = Number(value); return Number.isFinite(number) ? number : null;
}
const compareText = (a, b) => a < b ? -1 : a > b ? 1 : 0;
const validDay = value => typeof value === "string" && /^\d{4}-\d{2}-\d{2}$/.test(value) && Number.isFinite(Date.parse(value)) && new Date(value).toISOString().slice(0, 10) === value;
const instant = value => typeof value === "string" && value.includes("T") && Number.isFinite(Date.parse(value)) ? new Date(value).toISOString() : null;
const safeScore = row => row ? Object.fromEntries(SCORE_COLUMNS.split(",").filter(k => k !== "driver_id").map(k => [k, row[k] ?? null])) : null;

export async function readAll(read, fail, table, query, primaryKey) {
  const rows = [], seen = new Set(); let total = null;
  for (let offset = 0; offset < 100000; offset += 500) {
    const result = await read(table, { ...query, order: `${primaryKey}.asc`, limit: 500, offset });
    const batch = result.data;
    if (!Array.isArray(batch)) fail(503, "aggregation_unavailable");
    const count = /\/(\d+)$/.exec(result.rangeHeader || "");
    if (count) {
      if (total !== null && total !== Number(count[1])) fail(409, "action_center_changed");
      total = Number(count[1]);
    }
    for (const row of batch) {
      if (seen.has(row[primaryKey])) fail(409, "action_center_changed");
      seen.add(row[primaryKey]); rows.push(row);
    }
    if (batch.length < 500 || (total !== null && rows.length === total)) {
      if (total !== null && rows.length !== total) fail(409, "action_center_changed");
      return rows;
    }
  }
  fail(503, "aggregation_limit_exceeded");
}

export async function actionCenter({ driverId, read, fail, params }) {
  const rawLimit = params.get("limit") ?? "10", cursor = params.get("cursor");
  if (!/^\d+$/.test(rawLimit) || Number(rawLimit) < 1 || Number(rawLimit) > 50) fail(400, "invalid_action_pagination");
  const limit = Number(rawLimit);
  const own = { driver_id: `eq.${driverId}` };
  const [tasks, messages, reviews, scores, alerts, events, snapshots] = await Promise.all([
    readAll(read, fail, "training_tasks", { ...own, select: "task_id,alert_id,status,started_at,submitted_at,reviewed_at,course_snapshot,updated_at" }, "task_id"),
    readAll(read, fail, "interventions", { ...own, status: "in.(sent,read,replied,closed)", select: "intervention_id,alert_id,status,sent_at,read_at,replied_at" }, "intervention_id"),
    readAll(read, fail, "review_requests", { ...own, select: "request_id,score_id,evidence_id,status,created_at,updated_at,source_version" }, "request_id"),
    readAll(read, fail, "score_history", { ...own, select: SCORE_COLUMNS }, "score_id"),
    readAll(read, fail, "alerts", { ...own, select: "alert_id,evidence_id,occurred_at,status" }, "alert_id"),
    readAll(read, fail, "replay_events", { ...own, select: "event_id,event_time,source_version" }, "event_id"),
    readAll(read, fail, "score_snapshots", { ...own, select: SCORE_COLUMNS }, "score_id"),
  ]);
  const timeline = [], alertMap = new Map(alerts.map(x => [x.alert_id, x]));
  const scoreIds = new Set([...scores, ...snapshots].map(x => x.score_id));
  function add(kind, id, type, at, status, version, related = []) {
    const eventAt = validDay(at) ? new Date(at + "T00:00:00+08:00").toISOString() : instant(at);
    if (!eventAt) return;
    timeline.push({ event_id: `${kind}:${id}:${type}:${eventAt}`, event_type: type, source_kind: kind, source_id: id, event_at: eventAt, date_precision: validDay(at) ? "day" : "instant", status, source_version: version || null, related });
  }
  const relatedAlert = id => id && alertMap.has(id) ? [{ source_kind: "alert", source_id: id }] : [];
  for (const row of tasks) {
    const related = relatedAlert(row.alert_id), version = row.course_snapshot?.source_version;
    // 宿主 PostgreSQL 的 training_tasks 无 created_at 列（本地 SQLite 才有）：回退 updated_at（分配行的初始时间戳）。
    const assigned = row.course_snapshot?.captured_stage === "assignment" ? row.course_snapshot.captured_at : (row.created_at || row.updated_at);
    add("training_task", row.task_id, "assigned", assigned, row.status, version, related);
    add("training_task", row.task_id, "started", row.started_at, row.status, version, related);
    add("training_task", row.task_id, "submitted", row.submitted_at, row.status, version, related);
    if (["returned", "reviewed", "observation", "interview"].includes(row.status)) add("training_task", row.task_id, row.status, row.reviewed_at, row.status, version, related);
  }
  for (const row of messages) {
    // An internal draft is never a driver timeline node, even if it has stray timestamps.
    if (!instant(row.sent_at)) continue;
    for (const [field, type] of [["sent_at", "sent"], ["read_at", "read"], ["replied_at", "replied"]]) add("intervention", row.intervention_id, type, row[field], row.status, null, relatedAlert(row.alert_id));
  }
  for (const row of reviews) {
    const related = row.score_id && scoreIds.has(row.score_id) ? [{ source_kind: snapshots.some(x => x.score_id === row.score_id) ? "score" : "score_history", source_id: row.score_id }] : [];
    add("review_request", row.request_id, "review_requested", row.created_at, row.status, row.source_version, related);
    if (row.status !== "submitted") add("review_request", row.request_id, "review_current_state", row.updated_at, row.status, row.source_version, related);
  }
  for (const row of scores) add("score_history", row.score_id, "score_recorded", row.as_of_date, "historical", row.source_version);
  for (const row of alerts) add("alert", row.alert_id, "alert_recorded", row.occurred_at, row.status, null);
  for (const row of events) add("event", row.event_id, "event_recorded", row.event_time, "replay", row.source_version);
  timeline.sort((a, b) => compareText(b.event_at, a.event_at) || compareText(b.event_id, a.event_id));
  const counts = {
    training_pending: tasks.filter(x => ["assigned", "in_progress", "returned"].includes(x.status)).length,
    training_awaiting_review: tasks.filter(x => x.status === "submitted").length,
    training_follow_up: tasks.filter(x => ["observation", "interview"].includes(x.status)).length,
    messages_awaiting_reply: messages.filter(x => instant(x.sent_at) && ["sent", "read"].includes(x.status)).length,
    review_open: reviews.filter(x => ["submitted", "checking", "awaiting_data_owner"].includes(x.status)).length,
    review_answered: reviews.filter(x => x.status === "answered").length,
  };
  const revision = createHash("sha256").update(JSON.stringify([driverId, counts, timeline])).digest("hex");
  let offset = 0;
  if (cursor) {
    let parsed;
    try { if (!/^[\w-]{1,2000}$/.test(cursor)) throw Error(); parsed = JSON.parse(Buffer.from(cursor, "base64url").toString("utf8")); } catch { fail(400, "invalid_action_cursor"); }
    if (!parsed || typeof parsed.revision !== "string" || typeof parsed.event_id !== "string") fail(400, "invalid_action_cursor");
    if (parsed.revision !== revision) fail(409, "action_center_changed");
    const index = timeline.findIndex(x => x.event_id === parsed.event_id);
    if (index < 0) fail(400, "invalid_action_cursor");
    offset = index + 1;
  }
  const rows = timeline.slice(offset, offset + limit), hasMore = offset + rows.length < timeline.length;
  const latest = snapshots.filter(x => validDay(x.as_of_date)).sort((a, b) => compareText(b.as_of_date, a.as_of_date) || compareText(b.score_id, a.score_id))[0];
  const low = latest?.confidence_level === "low", missing = !latest || finiteNumber(latest.safety_score) === null || !latest.source_version || !latest.score_method || !["low", "medium", "high"].includes(latest.confidence_level);
  const nextCode = missing || low ? "verify_data" : counts.training_pending ? "continue_training" : counts.messages_awaiting_reply ? "respond_message" : counts.training_follow_up ? "follow_up" : counts.training_awaiting_review || counts.review_open ? "await_review" : tasks.some(x => x.status === "reviewed") ? "inspect_reassessment" : "inspect_evidence";
  const nextNotes = { verify_data: missing ? "评分、口径或可信度缺失，先联系安全员核验数据。" : "本人快照可信度低，优先核验设备和数据，不据此判断安全。", continue_training: "有待完成或需补充的本人培训，打开课程核对要求后继续学习。", respond_message: "有已发送且尚未回复的安全员沟通，可先查看原文与证据再回应。", follow_up: "有继续观察或面谈事项，请按已保存的人工意见联系安全员。", await_review: "提交内容已保存，等待人工复核或评分复核答复，不自动改分。", inspect_reassessment: "培训已复核，可打开任务查看本人后续数据与复评条件；完成学习不等于风险降低。", inspect_evidence: "当前没有上述待办，可查看本人评分依据；无待办不等于零风险。" };
  return {
    counts, as_of_date: latest?.as_of_date || null, source_version: latest?.source_version || null,
    next_step: { code: nextCode, note: nextNotes[nextCode] },
    timeline: rows, pagination: { limit, has_more: hasMore, next_cursor: hasMore ? Buffer.from(JSON.stringify({ revision, event_id: rows.at(-1).event_id })).toString("base64url") : null },
    queried_at: new Date().toISOString(),
    limitations: "计数覆盖本人完整查询范围，不是本页条数。时间线仅聚合已保存业务字段；未保存的历史节点不会补造，重复提交/退回可能只保留最近一次。日期精度的评分节点不代表该时刻发生事件。通用培训独立显示，日期接近不建立因果关联。数据变化后需从第一页重新读取。",
  };
}

export async function scoreComparison({ driverId, read, fail, params }) {
  const beforeId = params.get("before_id"), afterId = params.get("after_id");
  if (Boolean(beforeId) !== Boolean(afterId) || [beforeId, afterId].some(x => x && !/^[\w:.,-]{1,100}$/.test(x))) fail(400, "invalid_score_pair");
  const rows = await readAll(read, fail, "score_history", { driver_id: `eq.${driverId}`, select: SCORE_COLUMNS }, "score_id");
  rows.sort((a, b) => compareText(b.as_of_date || "", a.as_of_date || "") || compareText(b.score_id, a.score_id));
  const after = afterId ? rows.find(x => x.score_id === afterId) : rows[0];
  const before = beforeId ? rows.find(x => x.score_id === beforeId) : rows.find(x => after && validDay(x.as_of_date) && x.as_of_date < after.as_of_date);
  if (beforeId && (!before || !after)) fail(404, "not_found");
  if (before && after && (!validDay(before.as_of_date) || !validDay(after.as_of_date) || before.as_of_date >= after.as_of_date)) fail(400, "invalid_score_pair_order");
  let status = "requires_review", note = "两期记录存在，仍需人工核验暴露量、设备覆盖与评价口径；数值变化不证明培训因果效果。";
  const basis = before && after && before.source_version && before.source_version === after.source_version && before.score_method && before.score_method === after.score_method;
  const quality = before && after && [before, after].every(x => ["medium", "high"].includes(x.confidence_level) && finiteNumber(x.safety_score) !== null);
  if (!before || !after) { status = "insufficient_history"; note = "没有两个不同截止日的本人评分记录，不能补造趋势。"; }
  else if (!basis) { status = "not_comparable"; note = "来源版本或评分方法不同或缺失，不计算变化值。"; }
  else if (!quality) { status = "verify_data"; note = "有低可信或缺失可信度的记录，优先核验数据，不计算变化值。"; }
  else if (![before, after].every(x => validDay(x.window_start) && x.window_start <= x.as_of_date)) { status = "missing_window"; note = "评价窗口信息缺失或异常，变化值仅供核对，不能判断改善效果。"; }
  else if (after.window_start <= before.as_of_date) { status = "overlapping_window"; note = "两期评价窗口重叠，数值变化仅供核对，不能当作独立周期或培训效果。"; }
  const difference = (key) => basis && quality && finiteNumber(before[key]) !== null && finiteNumber(after[key]) !== null ? Number((finiteNumber(after[key]) - finiteNumber(before[key])).toFixed(4)) : null;
  return { before: safeScore(before), after: safeScore(after), status, note, difference: difference("safety_score"), dimensions: Object.fromEntries(DIMENSIONS.map(key => [key, difference(key)])), options: rows.slice(0, 50).map(x => ({ score_id: x.score_id, as_of_date: x.as_of_date })), options_truncated: rows.length > 50, limitations: "近14天滚动评价不是独立周评分。来源版本一致只是初筛；未取得可比暴露量和完整设备覆盖，任何差值都不是改善有效或事故率降低的结论。无新数据就等待复评。" };
}

export function fleetStatistics(rows) {
  const eligible = rows.filter(x => ["usable", "usable_with_review", "manual_review"].includes(x.score_status) && finiteNumber(x.safety_score) !== null);
  const ids = new Map(); for (const row of eligible) ids.set(row.driver_id, (ids.get(row.driver_id) || 0) + 1);
  const usable = eligible.filter(x => x.driver_id && ids.get(x.driver_id) === 1);
  const hidden = { valid_count: null, average: null, distribution: null, source_version: null };
  const definition = "同队、同截止日，状态为usable/usable_with_review/manual_review，安全分为有限数值且每名司机唯一；均值还要求来源版本和评分方法一致。";
  if (usable.length < 10) return { ...hidden, data_status: "insufficient_sample", note: "有效评分人数不足10，均值、人数与分布均隐藏。", sample_definition: definition };
  if (usable.some(x => !x.source_version || !x.score_method)) return { ...hidden, data_status: "missing_basis", note: "部分有效记录缺少版本或评分方法，未混算均值或分布。", sample_definition: definition };
  if (new Set(usable.map(x => JSON.stringify([x.source_version, x.score_method]))).size !== 1) return { ...hidden, data_status: "mixed_versions", note: "同日有效记录包含不同来源版本或评分方法，未混算均值或分布。", sample_definition: definition };
  const dist = {}; for (const row of usable) dist[row.risk_level] = (dist[row.risk_level] || 0) + 1;
  const cells = Object.values(dist), suppressed = Object.keys(dist).some(k => !["A", "B", "C", "D"].includes(k)) || cells.length <= 1 || cells.some(c => c === 1 || c >= usable.length - 1);
  return { data_status: "ok", source_version: usable[0].source_version, valid_count: usable.length, average: Math.round(usable.reduce((a, x) => a + finiteNumber(x.safety_score), 0) / usable.length * 10) / 10, distribution: suppressed ? null : { A: dist.A || 0, B: dist.B || 0, C: dist.C || 0, D: dist.D || 0 }, note: suppressed ? "等级分组可能反推个体或含未知等级，分布隐藏；不提供司机排名。" : "只展示匿名聚合，不提供司机排名或其他司机明细。", sample_definition: definition };
}
