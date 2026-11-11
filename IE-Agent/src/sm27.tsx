// R27 准备稿：SM06「通知模板」第三标签 —— 迁移 005 未执行前显示待属主执行，不渲染任何假数据
import { useEffect, useState } from "react";
const api = async <T,>(p: string, init?: RequestInit): Promise<T> => { const r = await fetch(p, { credentials: "include", headers: { "content-type": "application/json" }, ...init }); const j = await r.json().catch(() => ({})); if (!r.ok) throw new Error((j as { error?: string }).error || "HTTP " + r.status); return j as T; };
type Tpl = { template_id: string; template_key: string; version: number; title: string; body: string; review_status: string; scene: string; applicable_role: string; allowed_placeholders: string; source_note: string | null; created_by: string; reviewed_by: string | null; reviewed_at: string | null; review_note: string | null };
const ST: Record<string, [string, React.CSSProperties]> = {
  draft: ["草稿·不可引用", { background: "#f0f0f0", color: "#555", border: "1px solid #ccc" }],
  pending_review: ["待审·不可引用", { background: "#fff7e6", color: "#ad6800", border: "1px solid #ffd591" }],
  approved: ["已审核·可引用", { background: "#e6f4ea", color: "#1a6b2a", border: "1px solid #b7e0c0" }],
  disabled: ["已停用", { background: "#fdecaa", color: "#8a2b0b", border: "1px solid #f5c0c0" }],
};
const Tag2 = ({ s }: { s: string }) => { const [a, b] = ST[s] || [s, {}]; return <span style={{ fontSize: 11, padding: "1px 6px", borderRadius: 6, ...b }}>{a}</span>; };
export function TemplatesTab() {
  const [rows, setRows] = useState<Tpl[] | "pending" | null>(null);
  const [msg, setMsg] = useState<string | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [nc, setNc] = useState({ template_key: "", title: "", body: "", scene: "rm3_draft", source_note: "" });
  async function reload() { const r = await api<{ migration_pending?: boolean; latest?: Tpl[] }>("/api/admin/templates"); if (r.migration_pending) { setRows("pending"); return; } setRows((r.latest || []) as Tpl[]); }
  useEffect(() => { reload().catch(() => setErr("模板列表读取失败")); }, []);
  async function act(t: Tpl, action: string, extra: Record<string, unknown> = {}) {
    setErr(null);
    try { const r = await api<{ audit_id: string | null; new_status?: string }>(`/api/admin/templates/${encodeURIComponent(t.template_key + ":" + t.version)}`, { method: "PATCH", body: JSON.stringify({ action, ...extra }) }); setMsg(`${t.template_key}:${t.version} → ${r.new_status ?? action} · 审计 ${r.audit_id}`); await reload(); }
    catch (e) { const m = String((e as Error).message); if (m.includes("self_review_requires_explicit_confirm")) { try { const r = await api<{ audit_id: string | null }>(`/api/admin/templates/${encodeURIComponent(t.template_key + ":" + t.version)}`, { method: "PATCH", body: JSON.stringify({ action, confirm_same_actor: true }) }); setMsg(`${t.template_key}:${t.version} 同作者二次确认已批准并留痕 · 审计 ${r.audit_id}`); await reload(); } catch (e2) { setErr("批准被拒：" + String((e2 as Error).message)); } } else setErr("操作被拒：" + m); }
  }
  if (rows === "pending") return <div className="alert info">通知模板暂不可用，请联系管理员。</div>;
  if (!rows) return <div className="meta">{rows === null ? "读取中…" : ""}</div>;
  return <div>
    {err && <div className="alert warn">{err}</div>}
    {msg && <div className="alert info">{msg}</div>}
    <div className="task-card" style={{ padding: 8, marginBottom: 8 }}>
      <div className="t">新建通知模板（初始 draft，永不自动批准；占位符白名单：event_date / evidence_type / review_note / driver_id / alert_id）</div>
      <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
        <input className="btn" style={{ width: 190 }} placeholder="template_key(小写)" aria-label="模板键" value={nc.template_key} onChange={(e) => setNc({ ...nc, template_key: e.target.value.toLowerCase() })} />
        <input className="btn" style={{ width: 210 }} placeholder="标题" value={nc.title} onChange={(e) => setNc({ ...nc, title: e.target.value })} />
        <select className="btn" value={nc.scene} onChange={(e) => setNc({ ...nc, scene: e.target.value })} style={{ width: "auto" }}><option value="rm3_draft">RM03 沟通草稿</option></select>
      </div>
      <textarea className="btn" style={{ width: "100%", minHeight: 52, textAlign: "left", fontFamily: "inherit", marginTop: 4 }} placeholder="正文，例：您好，车辆{{alert_id}}涉及{{evidence_type}}复核（{{event_date}}），请说明当日情况并回复。【AI草稿未经确认不会发送】" aria-label="模板正文" value={nc.body} onChange={(e) => setNc({ ...nc, body: e.target.value })} />
      <input className="btn" style={{ width: "100%", marginTop: 4, textAlign: "left" }} placeholder="source_note（口径来源，人工填写，不由模型生成）" value={nc.source_note} onChange={(e) => setNc({ ...nc, source_note: e.target.value })} />
      <button className="btn primary" style={{ width: "auto", marginTop: 4 }} disabled={!nc.template_key || !nc.title || !nc.body} onClick={async () => { try { const r = await api<{ template_key: string; version: number; audit_id: string }>("/api/admin/templates", { method: "POST", body: JSON.stringify({ ...nc, allowed_placeholders: "event_date,evidence_type,review_note" }) }); setMsg(`已建 ${r.template_key}:v${r.version}（draft）· 审计 ${r.audit_id}`); setNc({ template_key: "", title: "", body: "", scene: "rm3_draft", source_note: "" }); await reload(); } catch (e) { setErr("创建被拒：" + String((e as Error).message)); } }}>创建草稿模板</button>
    </div>
    {rows.map((t) => <div key={t.template_id} className="task-card" style={{ padding: 8, marginTop: 6 }}>
      <div style={{ fontSize: 12.5 }}><b>{t.template_key} · v{t.version}</b> {t.title} <Tag2 s={t.review_status} /></div>
      <div className="meta" style={{ whiteSpace: "pre-wrap" }}>{t.body}</div>
      <div className="meta">场景 {t.scene} · 适用 {t.applicable_role} · 作者 {t.created_by}{t.reviewed_by ? ` · 审核 ${t.reviewed_by} @${String(t.reviewed_at || "").slice(0, 16)}` : ""}{t.review_note ? ` · ${t.review_note}` : ""} · 来源 {t.source_note || "—"}</div>
      <div style={{ display: "flex", gap: 6, marginTop: 4, flexWrap: "wrap" }}>
        {t.review_status === "draft" && <button className="btn" style={{ padding: "2px 8px" }} onClick={() => act(t, "submit")}>提交审核</button>}
        {t.review_status === "pending_review" && <>
          <button className="btn" style={{ padding: "2px 8px" }} onClick={() => act(t, "withdraw")}>退回草案</button>
          <button className="btn primary" style={{ padding: "2px 8px", width: "auto" }} onClick={() => { if (window.confirm(`确认以你的名义批准模板 ${t.template_key}:v${t.version}？批准后方可被 RM03 正式引用（同作者需二次确认留痕）。`)) act(t, "approve"); }}>批准（明确确认）</button>
        </>}
        {t.review_status === "approved" && <button className="btn" style={{ padding: "2px 8px" }} onClick={() => { const nb = window.prompt("基于此版本修订正文（将创建新 draft 版本，不覆盖已审文本）：", t.body); if (nb) act(t, "new_version", { body: nb }); }}>产生新草稿版本</button>}
        {["approved", "pending_review"].includes(t.review_status) && <button className="btn" style={{ padding: "2px 8px" }} onClick={() => { if (window.confirm("停用后 RM03 不可再引用该模板（已发送历史不受影响）。确认停用？")) act(t, "disable"); }}>停用</button>}
      </div>
    </div>)}
    <p className="meta">状态机与服务端门禁：draft→pending_review→approved→disabled；引用需 approved 且按 key:version 精确匹配；同作者批准强制 confirm_same_actor 并写审计。</p>
  </div>;
}

// R30：发送通知模板选择器（scene 限定 approved；空=内置文案；预览只读不写库）
export function TemplateScenePicker(props: { scene: string; driverId: string; onPick: (ref: string | null) => void; label: string }) {
  const [opts, setOpts] = useState<{ template_id: string; template_key: string; version: number; title: string }[]>([]);
  const [ref, setRef] = useState("");
  const [pv, setPv] = useState<string | null>(null);
  useEffect(() => { fetch(`/api/admin/templates?review_status=approved&scene=${props.scene}`, { credentials: "include" }).then((r) => r.json()).then((j) => { if (!j.migration_pending) setOpts((j.rows || []).filter((x: { version: number; review_status: string }) => x.review_status === "approved")); }).catch(() => undefined); }, [props.scene]);
  return <div className="row" style={{ gap: 6, margin: "4px 0", flexWrap: "wrap", alignItems: "center" }}>
    <span className="meta">{props.label}</span>
    <select className="btn" style={{ width: "auto" }} value={ref} onChange={(e) => { setRef(e.target.value); props.onPick(e.target.value || null); setPv(null); }} aria-label={`通知模板-${props.scene}`}><option value="">（内置默认文案）</option>{opts.map((o) => <option key={o.template_id} value={o.template_id}>{o.template_key}:v{o.version} · {o.title.slice(0, 24)}</option>)}</select>
    {ref ? <button className="btn" style={{ padding: "2px 8px" }} onClick={async () => { try { const r = await fetch(`/api/admin/template-preview?template_id=${encodeURIComponent(ref)}&driver_id=${encodeURIComponent(props.driverId || "")}`, { credentials: "include" }).then((x) => x.json()); setPv(r.ok ? String(r.rendered) : String(r.error || "预览不可用（仅 approved 可用）")); } catch { setPv("预览失败"); } }}>预览</button> : null}
    {ref ? <button className="btn" style={{ padding: "2px 8px" }} onClick={() => { setRef(""); props.onPick(null); setPv(null); }}>改回内置文案</button> : null}
    {pv && <span className="meta" style={{ width: "100%" }}>预览：{pv}</span>}
  </div>;
}
