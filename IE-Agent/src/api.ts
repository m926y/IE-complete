export type MeUser = {
  avatarUrl?: string | null;
  mustChangePassword?: boolean;
  localPreview?: boolean;
  userId: string;
  username: string | null;
  displayName: string;
  role: string;
  fleetScope: string | null;
  driverId: string | null;
  bindingVerified: boolean;
  bindingNote: string | null;
  authKind: string;
  capabilities: string[];
  allowedResources: string[];
  ssoEnabled: boolean;
  dataManifest: string;
};

export type MeResponse =
  | { user: MeUser; unbound?: undefined; sso?: { provider: string; name: string } | null }
  | { user: null; unbound: { provider: string; name: string }; sso: true };

export type ListResult<T = Record<string, unknown>> = {
  table: string;
  rows: T[];
  total: number | null;
  limit: number;
  offset: number;
};

export type OverviewResult = {
  dataImported: boolean;
  asOfDate: string | null;
  asOfNote: string | null;
  metrics: { key: string; label: string; count: number | null; unread?: boolean }[];
};

export class ApiError extends Error {
  status: number;
  code: string;
  constructor(status: number, code: string) {
    super(code);
    this.status = status;
    this.code = code;
  }
}

export async function api<T>(path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(path, {
    credentials: "same-origin",
    ...init,
    headers: { "content-type": "application/json", ...(init?.headers || {}) },
  });
  const text = await res.text();
  let json: unknown = null;
  try { json = text ? JSON.parse(text) : null; } catch { /* fallthrough */ }
  if (!res.ok) {
    const code = (json as { error?: string } | null)?.error || `http_${res.status}`;
    throw new ApiError(res.status, code);
  }
  if(init?.method && /^(POST|PATCH|DELETE)$/i.test(init.method) && /^\/api\/(offline-training\/|alerts\/|risk\/(handle|feedback|actionApply|actionComplete)|training-tasks\/|review-requests|admin\/(training-assign|score-weights\/apply)|evaluation-actions\/(apply|remind)|import\/commit|agent\/|ai\/chat|notes\/)/.test(path))window.dispatchEvent(new Event('claw:center-refresh'));
  return json as T;
}

export const getMe = () => api<MeResponse>("/api/me").catch((e) => {
  if (e instanceof ApiError && e.status === 401) return null;
  throw e;
});
export const login = (username: string, password: string) =>
  api<{ ok: boolean }>("/api/auth/login", { method: "POST", body: JSON.stringify({ username, password }) });
export const logout = () => api<{ ok: boolean }>("/api/auth/logout", { method: "POST", body: "{}" });
export const getData = <T,>(resource: string, params: Record<string, string | number> = {}) => {
  const qs = new URLSearchParams(Object.entries(params).map(([k, v]) => [k, String(v)]));
  return api<ListResult<T>>(`/api/data/${resource}${qs.toString() ? `?${qs}` : ""}`);
};
export const getOverview = () => api<OverviewResult>("/api/overview");
export type HistoryDates = { dates: string[]; counts: Record<string, number | null> };
export const getHistoryDates = () => api<HistoryDates>("/api/meta/history-dates");
export type BindingResult = { ok: boolean; binding_id: string | null; user_id: string; driver_id: string | null; identity_status: string | null; binding_note: string | null; audit_id: string | null };
export const setBinding = (payload: { user_id: string; driver_id: string | null; verified: boolean; note: string }) =>
  api<BindingResult>("/api/admin/bindings", { method: "POST", body: JSON.stringify(payload) });

export type ImportCheckReport = {
  ok: boolean; run_id?: string; fatal?: string; filename?: string; table?: string;
  header?: string[]; row_total?: number; accepted_row_estimate?: number; rejected_count?: number;
  dup_pk?: { key: string; lines: number[]; kept: string }[]; dup_pk_count?: number;
  type_errors?: { line: number; field: string; reason: string; value: string }[];
  rejected_rows?: { line: number; reason: string }[]; blank_pk_rows?: number;
  unknown_columns?: string[]; missing_contract_columns?: string[]; warnings?: string[];
  source_version_input?: string | null; confirm_window_minutes?: number; audit_id?: string | null;
};
export type ImportCommitReport = {
  run_id: string; table: string; submitted_rows: number; upserted: number; rejected_final: number;
  chunks: { from: number; to: number; ok: boolean; reason?: string }[]; result: string;
  finished_at?: string; audit_id?: string | null; idempotent_replay?: boolean;
};
export const importCheck = (payload: { table: string; filename: string; csv: string; source_version?: string }) =>
  api<ImportCheckReport>("/api/import/check", { method: "POST", body: JSON.stringify(payload) });
export const importCommit = (payload: { run_id: string; csv: string }) =>
  api<ImportCommitReport>("/api/import/commit", { method: "POST", body: JSON.stringify(payload) });

export type CourseReviewResult = { ok: boolean; course_id: string; old_status: string; new_status: string; version_no: number; reviewed_by: string; audit_id: string | null };
export type OpsUpdateResult = { ok: boolean; config_id: string; old_value: string; new_value: string; old_version: string | number; new_version: number; effective_at: string; audit_id: string | null };
export type AssignResult = { ok: boolean; task_id?: string; audit_id?: string | null; idempotent_replay?: boolean; error?: string };
export const courseReview = (p2: { course_id: string; new_status: string; note?: string; confirm_by?: string }) => api<CourseReviewResult>("/api/admin/course-review", { method: "POST", body: JSON.stringify(p2) });
export const opsConfigUpdate = (p2: { config_id: string; value: string; effective_at?: string }) => api<OpsUpdateResult>("/api/admin/ops-config", { method: "POST", body: JSON.stringify(p2) });
export const trainingAssign = (p2: { course_id: string; driver_id: string; goal?: string; mandatory?: boolean; alert_id?: string; due_at?: string; idempotency_key?: string; template_ref?: string }) => api<AssignResult>("/api/admin/training-assign", { method: "POST", body: JSON.stringify(p2) });

export type ConfirmResult = { ok: boolean; alert_id: string; status: string; rule_code?: string; idempotent_replay?: boolean; audit_id?: string | null; evidence?: Record<string, unknown> };
export type CaseView = { alert: Record<string, unknown>; interventions: Record<string, unknown>[]; trainings: Record<string, unknown>[]; notifications: Record<string, unknown>[]; timeline: Record<string, unknown>[]; demo_binding: { verified: boolean; note: string } | null };
export type InterResult = { ok: true; intervention_id: string; status?: string; sent_at?: string | null; read_at?: string | null; replied_at?: string | null; reply_text?: string | null; notification_id?: string | null; delivered_to_account?: boolean; audit_id?: string | null; idempotent_replay?: boolean; note?: string };
export const alertConfirm = (p2: { gpsno: string; rule_code: string; evidence_id: string; occurred_at: string }) => api<ConfirmResult>("/api/alerts/confirm", { method: "POST", body: JSON.stringify(p2) });
export const alertStatus = (id: string, status: string, reason = "") => api<{ ok: boolean; audit_id: string | null; new_status: string }>(`/api/alerts/${encodeURIComponent(id)}/status`, { method: "PATCH", body: JSON.stringify({ status, reason }) });
export const interventionDraft = (alertId: string, draft_text: string) => api<InterResult>(`/api/alerts/${encodeURIComponent(alertId)}/intervention`, { method: "POST", body: JSON.stringify({ draft_text }) });
export const interventionEdit = (id: string, draft_text: string) => api<InterResult>(`/api/interventions/${encodeURIComponent(id)}/draft`, { method: "PATCH", body: JSON.stringify({ draft_text }) });
export const interventionSend = (id: string) => api<InterResult>(`/api/interventions/${encodeURIComponent(id)}/send`, { method: "POST", body: "{}" });
export const interventionRead = (id: string) => api<InterResult>(`/api/interventions/${encodeURIComponent(id)}/read`, { method: "POST", body: "{}" });
export const interventionReply = (id: string, reply_text: string) => api<InterResult>(`/api/interventions/${encodeURIComponent(id)}/reply`, { method: "POST", body: JSON.stringify({ reply_text }) });
export const caseView = (alertId: string) => api<CaseView>(`/api/cases/${encodeURIComponent(alertId)}`);

export type TaskView = { task: Record<string, unknown>; alert: Record<string, unknown> | null; course: Record<string, unknown> | null; timeline: Record<string, unknown>[]; course_basis?:string;current_course_status?:string|null;learning_available?:boolean;reassess: { date: string | null; row: Record<string, unknown> | null;note?:string } | null };
export const taskView = (id: string) => api<TaskView>(`/api/training-tasks/${encodeURIComponent(id)}`);
export const taskStart = (id: string, expectedUpdatedAt?:string|null) => api<{ ok: true; status: string; started_at?: string | null; audit_id?: string | null; idempotent_replay?: boolean }>(`/api/training-tasks/${encodeURIComponent(id)}/start`, { method: "POST", body: JSON.stringify(expectedUpdatedAt===undefined?{}:{expected_updated_at:expectedUpdatedAt}) });
export const taskSaveDraft = (id: string, learning_record: string,extra:{feedback?:string;expected_updated_at?:string|null}={}) => api<{ ok: true; saved_at: string;updated_at:string }>(`/api/training-tasks/${encodeURIComponent(id)}/draft`, { method: "PATCH", body: JSON.stringify({ learning_record,...extra }) });
export const taskSubmit = (id: string, learning_record: string, feedback = "",expectedUpdatedAt?:string|null) => api<{ ok: true; status: string; submitted_at?: string | null; audit_id?: string | null; notification?:TaskNotificationReceipt;reviewer_notified?: string | null; idempotent_replay?: boolean }>(`/api/training-tasks/${encodeURIComponent(id)}/submit`, { method: "POST", body: JSON.stringify({ learning_record, feedback,...(expectedUpdatedAt===undefined?{}:{expected_updated_at:expectedUpdatedAt}) }) });
export const taskReview = (id: string, decision: string, reason: string) => api<{ ok: true; new_status: string; audit_id: string | null; task_id?: string; idempotent_replay?: boolean }>(`/api/training-tasks/${encodeURIComponent(id)}/review`, { method: "POST", body: JSON.stringify({ decision, reason }) });

export type RRView = { request: Record<string, unknown>; snapshot: Record<string, unknown> | null; ledger: Record<string, unknown>[] | null; timeline: Record<string, unknown>[] | null };
export const rrCreate = (p2: { score_id?: string; evidence_id?: string; reason_code: string; description: string }) => api<{ ok: true; request_id: string; status: string; audit_id?: string | null; admin_notified?: string | null; notification?:ReviewNotificationReceipt;idempotent_replay?: boolean }>("/api/review-requests", { method: "POST", body: JSON.stringify(p2) });
export const rrView = (id: string) => api<RRView>(`/api/review-requests/${encodeURIComponent(id)}`);
export const rrAdvance = (id: string, status: string, response_note: string, template_ref?: string | null) => api<{ ok: true; new_status: string; audit_id: string | null; driver_notified?: string | null }>(`/api/review-requests/${encodeURIComponent(id)}/advance`, { method: "POST", body: JSON.stringify({ status, response_note, template_ref }) });

export type NotesSummary = { unread_notes: number; todo_count: number; todo_label: string };
export type NoteRow = { notification_id: string; source_entity_type: string; source_entity_id: string; type: string; title?: string | null; content: string; read_at: string | null; created_at: string };
export const notesSummary = () => api<NotesSummary>("/api/notes/summary");
export const myNotes = () => api<{ rows: NoteRow[] }>("/api/notes");
export const noteRead = (id: string) => api<{ ok: true; read_at: string; idempotent_replay?: boolean }>(`/api/notes/${encodeURIComponent(id)}/read`, { method: "POST", body: "{}" });
export const alertHandoff = (id: string, to_user_id: string) => api<{ ok: true; owner_user_id: string; audit_id: string | null }>(`/api/alerts/${encodeURIComponent(id)}/handoff`, { method: "POST", body: JSON.stringify({ to_user_id }) });
export const alertNote = (id: string, note: string) => api<{ ok: true; audit_id: string | null; note: string }>(`/api/alerts/${encodeURIComponent(id)}/note`, { method: "POST", body: JSON.stringify({ note }) });
export const alertContact = (id: string, next_contact_at: string) => api<{ ok: true; next_contact_at: string; audit_id: string | null }>(`/api/alerts/${encodeURIComponent(id)}/contact`, { method: "POST", body: JSON.stringify({ next_contact_at }) });
export const accountEdit = (id: string, b: Record<string, unknown>) => api<{ ok: true; user_id: string; changed: Record<string, unknown>; audit_id: string | null; note?: string }>(`/api/admin/users/${encodeURIComponent(id)}`, { method: "PATCH", body: JSON.stringify(b) });
export const createUser = (p2: { username: string; display_name: string; role: string; reveal_password?: boolean }) => api<{ ok: true; user_id: string; username: string; role: string; initial_password: string; audit_id: string | null; note?: string }>("/api/admin/users", { method: "POST", body: JSON.stringify(p2) });
export const setUserStatus = (id: string, account_status: string) => api<{ ok: true; account_status: string; audit_id: string | null; note?: string }>(`/api/admin/users/${encodeURIComponent(id)}/status`, { method: "POST", body: JSON.stringify({ account_status }) });
export const egressProbe = () => api<{ ok: boolean; status?: number; error?: string; note?: string; ms?: number }>("/api/meta/egress-probe");

export type AiCitation = string;
export type ChatResult = { artifacts?:import('./agent-tools').AgentArtifact[]; action_plans?:import('./agent-tools').AgentPlan[]; ok: true; answer: string; citations: AiCitation[]; data_limitations: string[]; draft_preview: Record<string, unknown>[] | null; requires_confirmation: boolean; idempotent_replay?: boolean; meta: { prompt_version: string; model: string; engine?: string; skill?: string; skill_title?: string; tool_calls?: number; rounds?: number; duration_ms?: number; answer_audit?: { passed: boolean; issues: string[]; llm_checked: boolean } } };
export type Selftest = { ok: true; prompt_version: string; provider: string; tools: { tool: string; status: string; refs?: number; requires_confirmation?: boolean }[]; writes: string; counts_before: Record<string, number|null>; counts_after: Record<string, number|null>; note: string };
export type AiUpload = { upload_id: string; name: string; kind: string; kind_label: string; chars: number; truncated: boolean; rows: number | null; expires_at: string };
// 二进制上传走原始流 + x-file-name 头（与 learning-assets 同构），不能复用 JSON 版 api()
export const aiUpload = async (file: File): Promise<AiUpload> => {
  const res = await fetch("/api/ai/upload", { method: "POST", credentials: "same-origin", headers: { "content-type": "application/octet-stream", "x-file-name": encodeURIComponent(file.name) }, body: file });
  const text = await res.text();
  let json: unknown = null;
  try { json = text ? JSON.parse(text) : null; } catch { /* fallthrough */ }
  if (!res.ok) throw new ApiError(res.status, (json as { error?: string } | null)?.error || `http_${res.status}`);
  return json as AiUpload;
};
export const aiChat = (messages: { role: string; content: string }[], page?: string, clientRequestId?: string, caseId?:string, attachments?:string[]) => api<ChatResult>("/api/ai/chat", { method: "POST", body: JSON.stringify({ messages, page,case_id:caseId, ...(attachments&&attachments.length?{attachments}:{}), ...(clientRequestId ? { client_request_id: clientRequestId } : {}) }) });
export const aiSelftest = () => api<Selftest>("/api/ai/selftest");

export type EvidenceCard = { ref: string; table: string; field: string; value: string | number | null; window: string | null; as_of_date: string | null; source_version: string | null; confidence: string | null; limitations: string | null; verification_id?: string | null };
export type CheckResult = { ok?: true; ref: string; route: string | null; fresh?: Record<string, unknown>; error?: string; hint?: string };
export const aiEvidenceCheck = (ref: string) => api<CheckResult>(`/api/ai/evidence-check?ref=${encodeURIComponent(ref)}`);
export const aiEvidenceCheckVer = (verificationId: string) => api<{ ok: true; verification_id: string; evidence_ref: string; route: string | null; verified_at: string } | { error: string; hint?: string }>("/api/agent1/evidence-check", { method: "POST", body: JSON.stringify({ verification_id: verificationId }) });
export const aiConfirm = (p2: { ai_call_id: string; decision: string; business_entity?: string; business_id?: string; business_audit_id?: string }) => api<{ ok: true; confirm_audit_id: string | null; status: string; idempotent_replay?: boolean; confirmed?: string }>("/api/ai/confirm", { method: "POST", body: JSON.stringify(p2) });
export const aiCallsStatus = (ids: string[]) => api<{ confirms: Record<string, { decision: string; at: string; business: string | null }> }>(`/api/ai/calls?ids=${ids.join(",")}`);

// R17：全局搜索 / SM05 / SM06
export type SearchItem = { record_id: string; title: string; summary: string; route: string };
export type SearchGroup = { type: string; total: number; items: SearchItem[] };
export const search = (q: string) => api<{ ok: true; q: string; groups: SearchGroup[]; visible_types: string[]; note?: string }>("/api/search?q=" + encodeURIComponent(q));
export const rulesBoard = () => api<{ ok: true; current: Record<string, unknown>[]; drafts: Record<string, unknown>[]; note: string }>("/api/admin/rule-drafts");
export const ruleDraftCreate = (b: Record<string, unknown>) => api<{ ok: true; draft_id: string; audit_id: string; structured?: boolean }>("/api/admin/rule-drafts", { method: "POST", body: JSON.stringify(b) });
export const ruleDraftAction = (id: string, b: Record<string, unknown>) => api<{ ok: true; new_status: string; audit_id: string; new_source_version?: string; self_review_confirmed?: boolean }>(`/api/admin/rule-drafts/${encodeURIComponent(id)}`, { method: "PATCH", body: JSON.stringify(b) });
export const knowledgeList = () => api<{ ok: true; rows: Record<string, unknown>[]; note: string }>("/api/admin/knowledge");
export const knowledgeCreate = (b: Record<string, unknown>) => api<{ ok: true; article_id: string; version_no: number; audit_id: string }>("/api/admin/knowledge", { method: "POST", body: JSON.stringify(b) });
export const knowledgeAction = (id: string, b: Record<string, unknown>) => api<{ ok: true; new_status?: string; version_no?: number; audit_id: string; self_review_confirmed?: boolean }>(`/api/admin/knowledge/${encodeURIComponent(id)}`, { method: "PATCH", body: JSON.stringify(b) });

// R19：课程板 + 审计控制台 + ops 开关
export const coursesBoard = () => api<{ ok: true; courses: Record<string, unknown>[]; note: string }>("/api/admin/courses");
export const courseCreate = (b: Record<string, unknown>) => api<{ ok: true; course_id: string; content_status: string; audit_id: string }>("/api/admin/course-draft", { method: "POST", body: JSON.stringify({ ...b, action: "create" }) });
export const courseDraftEdit = (b: Record<string, unknown>) => api<{ ok: true; course_id: string; version_no: number; audit_id: string }>("/api/admin/course-draft", { method: "PATCH", body: JSON.stringify(b) });
export const auditQuery = (q: Record<string, string | number>) => api<{ ok: true; rows: Record<string, string | null>[]; total: number; limit: number; offset: number; note: string }>("/api/admin/audit?" + new URLSearchParams(Object.entries(q).map(([k, v]) => [k, String(v)])).toString());
export const opsSet = (config_id: string, value: string) => api<{ ok: true; old_value: string | null; new_value: string; new_version: number; audit_id: string | null }>("/api/admin/ops-config", { method: "POST", body: JSON.stringify({ config_id, value }) });
export const opsList = () => api<{ ok: true; rows: Record<string, string | number | null>[] }>("/api/admin/ops");

// R21：司机端匿名车队统计（服务端按可信会话，无可调参数）
export type FleetSummary = { data_status: "ok" | "insufficient_sample" | "no_data" | "query_failed"; as_of_date: string | null; source_version?: string | null; valid_count: number | null; average: number | null; distribution: { A: number; B: number; C: number; D: number } | null; note: string;sample_definition?:string };
export const fleetSummary = () => api<FleetSummary>("/api/driver/fleet-summary");

export type Drop7 = { data_status: string; date_pair?: [string, string] | null; threshold: number; threshold_version: string; comparable?: number; drop_count: number; not_comparable_count?: number; not_comparable?: { gpsno: string; driver_id: string | null; reason: string }[]; rows?: { gpsno: string; driver_id: string | null; early_date: string; late_date: string; early_score: number; late_score: number; drop: number; threshold: number; threshold_version: string; early_score_id: string; late_score_id: string; confidence: string | null; base_tags: string[]; owner: string; next_step: string; route: string }[]; note?: string; scope_note?: string; generated?: string };
export const drop7 = () => api<Drop7>("/api/rm/drop7");

export type TaskSummary = { available: boolean; reason?: string; note?: string; task_id?: string; status?: string; course?: { course_id: string; title: string; version_no: number; current_status: string; note: string | null } | null; facts?: { ref: string; label: string; missing: boolean }[]; items?: { judgment: string; state: string; fact: string; ref: string; ref_ok: boolean }[]; limitations?: string[]; model?: string; cached?: boolean; audit_note?: string };
export const taskSummary = (task_id: string) => api<TaskSummary>("/api/ai/task-summary", { method: "POST", body: JSON.stringify({ task_id }) });

// ===== R37 新增：司机资料 / 根因分析 =====
export type DriverProfile = { user_id: string; phone: string | null; intro: string | null; prefs: string | null; updated_by: string | null; updated_at: string | null };
export const getOwnProfile = () => api<{ ok: true; profile: DriverProfile | null; note: string }>("/api/me/profile");
export const updateOwnProfile = (b: Record<string, unknown>) => api<{ ok: true; audit_id: string; saved: string[]; note: string }>("/api/me/profile", { method: "POST", body: JSON.stringify(b) });
export type RootCauseDim = { dimension: string; dimension_name: string; allocated_points: number; share_pct: number | null; events: number };
export type RootCauseEvent = { dimension: string; dimension_name: string; event_type: string; allocated_points: number };
export type RootCauseObj = { gpsno: string; driver_id: string | null; allocated_points: number; safety_score: number | string | null; risk_level: string | null; confidence_level: string | null; score_id: string | null };
export type RootCausesResult = { ok: true; data_status: string; note: string; as_of_date?: string | null; source_version?: string | null; ruleset_source_version?: string | null; cohort?: string; cohort_count?: number; low_conf_in_pool?: number; pool_avg?: number | null; ledger_total_allocated_in_pool?: number; ledger_rows_in_pool?: number; gps_covered_in_pool?: number; gps_without_ledger_in_pool?: number; dimensions?: RootCauseDim[]; event_types?: RootCauseEvent[]; top_objects?: RootCauseObj[] };
export const rootCauses = (cohort = "cd") => api<RootCausesResult>(`/api/analysis/root-causes?cohort=${encodeURIComponent(cohort)}`);

// Integrated driver branch contracts.

export type TaskNotificationReceipt = { state: "recorded" | "pending" | "no_recipient" | "not_needed"; notification_id: string | null };


export type DriverRiskResult = { date: string; timezone: string; source_type: string; queried_at: string; latest_replay_date: string | null; snapshot: Record<string, unknown> | null; events: Record<string, unknown>[]; alerts: Record<string, unknown>[]; pagination: { limit: number; events_offset: number; alerts_offset: number; events_has_more: boolean; alerts_has_more: boolean }; truncated: boolean; note: string };

export const driverRiskCenter = (date: string, eventsOffset = 0, alertsOffset = 0) => api<DriverRiskResult>(`/api/driver/risk-center?${new URLSearchParams({ date, limit: "10", events_offset: String(eventsOffset), alerts_offset: String(alertsOffset) })}`);

export type DriverEvidenceKind = "event" | "alert" | "score" | "score_history";

export type DriverEvidenceResult = { kind: DriverEvidenceKind; record: Record<string, unknown>; linked: Record<string, unknown> | null; linked_kind: string | null; ledger: Record<string, unknown>[]; ledger_status: string; offset: number; has_more: boolean; queried_at: string; limitations: string };

export const driverEvidence = (kind: DriverEvidenceKind, id: string, offset = 0) => api<DriverEvidenceResult>(`/api/driver/evidence?${new URLSearchParams({ kind, id, offset: String(offset) })}`);

export type LearningReport = { task_id: string; course: { title: string; source_version: string | null; completion_requirement: string | null } | null; goal: string | null; status: string; learning_record: string | null; feedback: string | null; review_note: string | null; submitted_at: string | null; reviewed_at: string | null; conclusion: string; limitations: string; generated_at: string };

export const learningReport = (taskId: string) => api<LearningReport>(`/api/driver/learning-report?task_id=${encodeURIComponent(taskId)}`);

export const retryTaskNotification = (id: string, kind: "assigned" | "submitted") => api<{ ok: boolean; task_id: string; notification: TaskNotificationReceipt; audit_id: string | null }>(`/api/training-tasks/${encodeURIComponent(id)}/retry-notification`, { method: "POST", body: JSON.stringify({ kind }) });

export type ReviewNotificationReceipt = { state: "recorded" | "pending" | "no_recipient" | "not_needed"; notification_id?: string | null; note?: string };


export type DailyRisk = { eventType:string; eventName:string|null; dimension:string|null; observedCount:number; priority:number; priorityBasis:string; priorityScore:null; firstObservedAt:string; lastObservedAt:string; evidenceRefs:string[] };

export type DailyCard = { type:string; priority:number; title:string; description:string; evidenceRefs:string[] };

export type DailySafetyReport = {
  schemaVersion:number; reportDate:string; driverId:string; dataAsOf:string; dataStatus:string; sourceFingerprint:string; title:string; summary:string;
  metrics:{personalScore:number|null;personalScoreDate:string|null;scoreEvidenceId:string|null;scoreChange:number|null;scoreComparisonStatus:string;scoreConfidence:string|null;fleetAverage:number|null;fleetScoredDrivers:number|null;fleetDate:string|null;riskCount7d:number|null;riskRate:number|null};
  risks:DailyRisk[];cards:DailyCard[];dailyGoal:{type:string;description:string;status:string;recommendationBasis?:string;scoreEvidenceRef?:string|null;evidenceRefs:string[]}|null;
  goalTracking?:{previousGoalId:number;previousReportDate:string;previousStatus:string;previousFeedbackCode:string|null;newEvidence:boolean;assessment:string;note:string}|null;
  approvedCourseRefs:string[];
  coverage:{source:string;observedDates:string[];firstOwnedEventAt:string|null;complete7d:boolean;complete30d:boolean;exposureAvailable:boolean};dataLimitations:string[];
  scoreTrend?:{basis:string;dates:string[];personal:(number|null)[];fleet:(number|null)[];fleetComparableCount?:(number|null)[];note:string};
  narrative?:{greeting:string;analysis:string;items:{title:string;observation:string;advice:string;evidenceRefs:string[]}[];goal:string}|null;
  narrativeMeta?:{generatedBy:string;ai_status:string;model?:string;prompt_version?:string;attempts?:number;reason?:string}|null;
};

export type PublishedDailyReport = {id:number;reportVersion:number;publishedAt:string;report:DailySafetyReport};

export type DailyHistory = {rows:{id:number;reportDate:string;reportVersion:number;isCurrent:boolean;publishedAt:string;title:string}[];total:number;limit:number;offset:number};

export type DailyGoal = {handledNote?:string|null;handledAt?:string|null;id:number;reportId:number;previousGoalId:number|null;type:string;description:string;status:string;feedbackCode:string|null;feedbackText:string|null;updatedAt:string|null;createdAt:string};

export const dailyReportToday = () => api<PublishedDailyReport|null>('/api/driver/reports/today');

export const dailyReportHistory = (offset=0) => api<DailyHistory>(`/api/driver/reports/history?limit=20&offset=${offset}`);

export const dailyReportDetail = (id:number) => api<PublishedDailyReport>(`/api/driver/reports/${id}`);

export const dailyReportNotifications = () => api<{rows:NoteRow[]}>('/api/driver/notifications');

export const dailySafetyGoals = () => api<{rows:DailyGoal[]}>('/api/driver/safety-goals');

export const dailyGoalFeedback = (id:number,code:'will_review'|'need_help'|'dismissed',text='') => api<{id:number;status:string;feedbackCode:string;updatedAt:string;idempotentReplay:boolean}>(`/api/driver/safety-goals/${id}/feedback`,{method:'POST',body:JSON.stringify({code,text})});

export const adminDailyReportRun = (driverId:string,reportDate:string,revise=false) => api<PublishedDailyReport & {idempotentReplay:boolean;notificationCount:number}>('/api/admin/daily-reports/run',{method:'POST',body:JSON.stringify({driver_id:driverId,report_date:reportDate,revise})});

export type DailyReportJobs = {date:string;total:number;byStatus:Record<string,number>;rows:{id:number;driver_id:string;report_date:string;status:string;attempts:number;started_at:string|null;finished_at:string|null;error_message:string|null}[];limit:number;offset:number};

export const adminDailyReportJobs = (date:string,status?:'failed') => api<DailyReportJobs>(`/api/admin/daily-reports/jobs?${new URLSearchParams({date,...(status?{status}:{})})}`);


export type DriverSourceKind = "training_task" | "intervention" | "review_request" | "score" | "score_history" | "alert" | "event";

export type DriverSourceRef = { source_kind: DriverSourceKind; source_id: string };

export type DriverTimelineNode = DriverSourceRef & { event_id: string; event_type: string; event_at: string; date_precision: "day" | "instant"; status: string; source_version: string | null; related: DriverSourceRef[] };

export type DriverActionCenter = {
  counts: { training_pending: number; training_awaiting_review: number; training_follow_up: number; messages_awaiting_reply: number; review_open: number; review_answered: number };
  as_of_date: string | null; source_version: string | null; next_step: { code: string; note: string };
  timeline: DriverTimelineNode[]; pagination: { limit: number; has_more: boolean; next_cursor: string | null }; queried_at: string; limitations: string;
};

export const driverActionCenter = (cursor?: string) => api<DriverActionCenter>("/api/driver/action-center" + (cursor ? "?cursor=" + encodeURIComponent(cursor) : ""));

export type DriverScoreComparison = { before: Record<string, unknown> | null; after: Record<string, unknown> | null; status: string; note: string; difference: number | null; dimensions: Record<string, number | null>; options: { score_id: string; as_of_date: string }[]; options_truncated: boolean; limitations: string };

export const driverScoreComparison = (before?: string, after?: string) => api<DriverScoreComparison>("/api/driver/score-comparison" + (before && after ? "?" + new URLSearchParams({ before_id: before, after_id: after }) : ""));

export type DriverInterventionView = { intervention_id: string; status: string; sent_text: string | null; sent_at: string | null; read_at: string | null; replied_at: string | null; reply_text: string | null; alert_id: string | null };

export const driverInterventionView = (id: string) => api<DriverInterventionView>("/api/driver/intervention?id=" + encodeURIComponent(id));
