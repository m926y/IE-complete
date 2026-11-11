import {KnowledgeUpload,KnowledgeMap,KnowledgeAttachments,AuthoritativeKnowledge} from './knowledge-library';
// R17 SM05 规则草案双栏 + SM06 知识内容管理（服务端强制门禁；草案/待审永不成为正式依据）
import React, { useEffect, useState } from "react";
import { knowledgeAction, knowledgeCreate, knowledgeList, ruleDraftAction, ruleDraftCreate, rulesBoard } from "./api";


const dimName=(v:unknown)=>({history:"历史事故与未遂",driving_stability:"驾驶稳定性",fatigue_distraction:"疲劳与分心",management:"管理配合度",imu_evidence:"车辆传感器风险",gps_coverage:"定位数据覆盖"} as Record<string,string>)[String(v)]||String(v||"—");
const DIMS = ["history", "driving_stability", "fatigue_distraction", "management", "imu_evidence", "gps_coverage"];
type Row = Record<string, string | number | boolean | null | undefined>;
function PageHead({ code, title, desc }: { code: string; title: string; desc: string }) {
  return <div className="page-head"><h2>{title}</h2></div>;
}

function StatusTag({ s }: { s: string }) {
  const map: Record<string, [string, React.CSSProperties]> = {
    draft: ["草案·未生效", { background: "#f0f0f0", color: "#555", border: "1px solid #ccc" }],
    pending_review: ["待审·未生效", { background: "#fff7e6", color: "#ad6800", border: "1px solid #ffd591" }],
    archived: ["已归档", { background: "#eee", color: "#888", border: "1px solid #ddd" }],
    approved: ["正式生效", { background: "#e6f4ea", color: "#1a6b2a", border: "1px solid #b7e0c0" }],
    disabled: ["已停用", { background: "#fdecaa", color: "#8a2b0b", border: "1px solid #f5c0c0" }],
    approved_draft: ["已批准·未生效", { background: "#e8f0fe", color: "#1a4fb0", border: "1px solid #b7c8f0" }],
    effectuated: ["已生效·进入现行", { background: "#e6f4ea", color: "#1a6b2a", border: "1px solid #b7e0c0" }],
  };
  const [txt, style] = map[s] || [s, {}];
  return <span style={{ fontSize: 11, padding: "1px 6px", borderRadius: 6, ...style }}>{txt}</span>;
}

export function SmDraftsPage() {
  const [board, setBoard] = useState<{ current: Row[]; drafts: Row[]; note?: string } | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [msg, setMsg] = useState<string | null>(null);
  const [dim, setDim] = useState(DIMS[0]);
  const [prop, setProp] = useState("");
  const [weights, setWeights] = useState<Record<string, string>>({});
  const [noteFor, setNoteFor] = useState<string | null>(null);
  const [noteTxt, setNoteTxt] = useState("");
  const [approveFor, setApproveFor] = useState<string | null>(null);
  const [approveNote, setApproveNote] = useState("");
  const [confirmId, setConfirmId] = useState<string | null>(null);
  async function reload() { try { setBoard((await rulesBoard()) as { current: Row[]; drafts: Row[] }); setErr(null); } catch { setErr("读取失败：规则板不可用"); } }
  useEffect(() => { reload(); }, []);
  async function act(id: string, b: Row, label: string) {
    try { const r = await ruleDraftAction(id, b); setMsg(`${label}：${id} → ${r.new_status} · 审计 ${r.audit_id}${(r as unknown as Row).new_source_version ? ` · 新口径 ${String((r as unknown as Row).new_source_version)}` : ""}`); setErr(null); await reload(); }
    catch (e) { const m = e instanceof Error ? e.message : String(e);
      if (m.includes("self_review_requires_explicit_confirm")) setConfirmId(id);
      else setErr("操作被拒：" + m); }
  }
  const curDims = board?.current?.length ? board.current.map((c) => String(c.dimension)) : DIMS;
  useEffect(() => { if (board?.current?.length && !board.current.some((c) => String(c.dimension) === dim)) setDim(String(board.current[0].dimension)); }, [board]);
  const wSum = Object.values(weights).reduce((a, v) => a + (Number(v) || 0), 0);
  const hasStructured = Object.keys(weights).length > 0;
  const parsedProp = (p: string): { kind?: string; note?: string; weights?: Record<string, number> } | null => { try { const j = JSON.parse(String(p)); return j && j.kind === "weight_proposal" ? j : null; } catch { return null; } };
  return <div>
    <PageHead code="SM05" title="评分规则与草案" desc="现行口径直读 evaluation_rules；评分标准可配置：结构化草案→他人/二次确认批准→显式『生效』写为新版本（ruleset_vN，全链审计）。任何未生效草案不被页面/AI 当现行参数；生效不回算历史快照。" />
    {err && <div className="alert warn">{err}</div>}
    {msg && <div className="alert info">{msg}</div>}
    <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 14, alignItems: "start" }}>
      <div className="task-card"><div className="t">现行评分规则（生效口径 · 只读展示）</div>
        {!board ? <div className="meta">读取中…</div> : <table className="tbl"><thead><tr><th>维度</th><th>权重</th><th>窗口</th><th>规则版本</th></tr></thead>
          <tbody>{board.current.map((c) => <tr key={String(c.dimension)}><td>{String(c.dimension_name || c.dimension)}</td><td>{Number(c.weight).toFixed(4)}</td><td>{String(c.window_days)}天</td><td><span className="meta">规则已留档</span></td></tr>)}</tbody></table>}
        <div className="meta">调整评分标准，请在右侧创建草案，经审核后生效。</div></div>
      <div className="task-card"><div className="t">规则草案（批准并生效前不参与任何计算/展示口径）</div>
        <div style={{ display: "flex", gap: 6, flexWrap: "wrap", marginBottom: 4 }}>
          <select className="btn" value={dim} onChange={(e) => setDim(e.target.value)} style={{ width: "auto" }}>{curDims.map((d) => <option key={d} value={d}>{dimName(d)}</option>)}</select>
          <input className="btn" style={{ width: 110 }} type="number" min="0" max="1" step="0.0001" placeholder={`调整${dimName(dim)}权重`} value={weights[dim] ?? ""} onChange={(e) => setWeights({ ...weights, [dim]: e.target.value })} />
          {Object.keys(weights).length > 0 && <span className="meta">拟权重合计≈{wSum.toFixed(4)}（现行未改维度按原值补足）</span>}
        </div>
        <textarea className="btn" style={{ width: "100%", minHeight: 56, textAlign: "left", fontFamily: "inherit" }} placeholder="提案说明（拟议口径/理由/影响评估）；填了权重即为可生效的结构化提案" value={prop} onChange={(e) => setProp(e.target.value)} />
        <div style={{ display: "flex", gap: 6, marginTop: 4 }}>
          <button className="btn" disabled={!prop.trim() && !hasStructured} onClick={async () => {
            try { const r = await ruleDraftCreate({ dimension: dim, proposal: prop, ...(hasStructured ? { weights: Object.fromEntries(Object.entries(weights).map(([k, v]) => [k, Number(v)])) } : {}) }); setMsg(`已建草案 ${r.draft_id}${(r as unknown as Row).structured ? "（结构化·可生效）" : "（仅文本·不可生效）"} · 审计 ${r.audit_id}`); setProp(""); setWeights({}); await reload(); } catch (e) { setErr(e instanceof Error ? e.message : "创建失败"); } }}>创建草案</button>
        </div>
        {!board ? <div className="meta">读取中…</div> : board.drafts.length === 0 ? <div className="meta">暂无草案</div> : board.drafts.map((d) => { const st = String(d.status); const sp = parsedProp(String(d.proposal || "")); return <div key={String(d.draft_id)} className="task-card" style={{ padding: 8, marginTop: 6 }}>
          <div style={{ fontSize: 12.5 }}><b>规则调整草案</b> · {dimName(d.dimension)} <StatusTag s={st === "approved" ? "approved_draft" : st} />{sp ? <span className="meta"> · 结构化{sp.weights ? `（${Object.keys(sp.weights).length} 维权重）` : ""}</span> : null}</div>
          <div className="meta" style={{ whiteSpace: "pre-wrap" }}>{sp ? `权重提案：${Object.entries(sp.weights || {}).map(([k, v]) => `${dimName(k)}→${v}`).join("；")}｜${String(sp.note || "").slice(0, 160)}` : String(d.proposal || "").slice(0, 300)}</div>
          <div className="meta">基线 {String(d.base_version || "—")} · {String(d.created_by)} · {String(d.updated_at || "").slice(0, 10)}{d.review_note ? ` · 意见：${String(d.review_note).slice(0, 60)}` : ""}</div>
          <div style={{ display: "flex", gap: 6, marginTop: 4, flexWrap: "wrap" }}>
            {st === "draft" && <button className="btn" style={{ padding: "2px 8px" }} onClick={() => act(String(d.draft_id), { action: "submit" }, "提交审核")}>提交审核</button>}
            {st === "pending_review" && <>
              <button className="btn" style={{ padding: "2px 8px" }} onClick={() => act(String(d.draft_id), { action: "withdraw" }, "撤回")}>撤回为草案</button>
              {approveFor === String(d.draft_id)
                ? <div style={{ display: "flex", gap: 6, width: "100%" }}><input className="btn" style={{ flex: 1, width: "auto" }} value={approveNote} onChange={(e) => setApproveNote(e.target.value)} placeholder="批准备注（必填：批准理由/口径）" /><button className="btn primary" style={{ width: "auto" }} onClick={() => { act(String(d.draft_id), { action: "approve", review_note: approveNote, ...(confirmId === String(d.draft_id) ? { confirm_same_actor: true } : {}) }, "批准"); setApproveFor(null); setApproveNote(""); }}>确认批准</button></div>
                : confirmId === String(d.draft_id)
                  ? <button className="btn primary" style={{ padding: "2px 8px", width: "auto", background: "#8a2b0b", borderColor: "#8a2b0b" }} onClick={() => { setApproveFor(String(d.draft_id)); setMsg("你是该草案起草人：批准将强制二次确认留痕（审阅=起草同一人已记录）"); }}>同作者批准（需确认）</button>
                  : <button className="btn primary" style={{ padding: "2px 8px", width: "auto" }} onClick={() => setApproveFor(String(d.draft_id))}>批准…</button>}</>}
            {st === "approved" && (sp ? <>
              <button className="btn primary" style={{ padding: "2px 8px", width: "auto" }} disabled={Boolean((d as Row)._busy)} onClick={() => {
                const chg = Object.entries(sp.weights || {}).map(([k, v]) => `${dimName(k)}→${v}`).join("；");
                if (!window.confirm(`确认把该已批准提案写为现行口径？\n变更：${chg}\n生效后 source_version 更新为新 ruleset 版本；历史快照/台账/预测不因此改写（重新出数由算法侧执行）。`)) return;
                act(String(d.draft_id), { action: "effectuate", confirm_effectuate: true }, "生效");
              }}>生效为新口径…</button></> : <span className="meta">（文本草案：不可生效）</span>)}
            {st !== "archived" && st !== "effectuated" && <button className="btn" style={{ padding: "2px 8px" }} onClick={() => act(String(d.draft_id), { action: "archive" }, "归档")}>归档</button>}
            <button className="btn" style={{ padding: "2px 8px" }} onClick={() => setNoteFor(noteFor === String(d.draft_id) ? null : String(d.draft_id))}>审阅意见</button>
          </div>
          {noteFor === String(d.draft_id) && <div style={{ display: "flex", gap: 6, marginTop: 4 }}>
            <input className="btn" style={{ flex: 1, width: "auto" }} value={noteTxt} onChange={(e) => setNoteTxt(e.target.value)} placeholder="审阅意见（留痕可追溯）" />
            <button className="btn primary" style={{ padding: "2px 8px", width: "auto" }} onClick={() => { act(String(d.draft_id), { action: "note", review_note: noteTxt }, "批注"); setNoteTxt(""); }}>保存意见</button>
          </div>}
        </div>; })}
      </div>
    </div>
    <p className="login-note">草案经审核、确认生效后成为现行规则；历史评分保持留档。</p>
  </div>;
}

export function SmKnowledgePage() {
  const [rows, setRows] = useState<Row[] | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [msg, setMsg] = useState<string | null>(null);
  const [title, setTitle] = useState(""); const [content, setContent] = useState(""); const [snote, setSnote] = useState(""); const [role, setRole] = useState("all");
  const [editFor, setEditFor] = useState<string | null>(null); const [editTxt, setEditTxt] = useState("");
  const [confirmId, setConfirmId] = useState<string | null>(null);
  const hl = (location.hash.split("article_id=")[1] || "").split("&")[0];
  async function reload() { try { setRows((await knowledgeList()).rows as Row[]); setErr(null); } catch { setErr("知识清单读取失败"); } }
  useEffect(() => { reload(); }, []);
  async function act(id: string, b: Row, label: string) {
    try { const r = await knowledgeAction(id, b); setMsg(`${label}：${id} → ${r.new_status ?? r.version_no ?? "ok"} · 审计 ${r.audit_id}${r.self_review_confirmed ? "（同作者二次确认已留痕）" : ""}`); setErr(null); await reload(); }
    catch (e) { const m = e instanceof Error ? e.message : String(e); if (m.includes("self_review_requires_explicit_confirm")) { setConfirmId(id); setErr("你是该条目作者：请点“确认并批准”完成同作者二次确认（将写入审计）"); } else setErr("操作被拒：" + m); }
  }
  return <div>
    <KnowledgeUpload onSaved={()=>void reload()}/><KnowledgeMap rows={rows||[]}/><AuthoritativeKnowledge/>
    <PageHead code="" title="知识内容管理" desc="全部转换由服务端校验并写审计（含版本坐标 article_id:version_no）；同作者审阅必须显式二次确认。运行时 AI 正式引用 = 仅 approved 的最新版本（含版本核验，停用/待审拒绝）。" />
    {err && <div className="alert warn">{err}</div>}
    {msg && <div className="alert info">{msg}</div>}
    <div className="task-card"><div className="t">新建知识条目（审核通过后生效）</div>
      <input className="btn" style={{ width: "100%" }} placeholder="标题" value={title} onChange={(e) => setTitle(e.target.value)} />
      <textarea className="btn" style={{ width: "100%", minHeight: 52, textAlign: "left", fontFamily: "inherit", marginTop: 4 }} placeholder="正文（Markdown 纯文本均可）" value={content} onChange={(e) => setContent(e.target.value)} />
      <div style={{ display: "flex", gap: 6, marginTop: 4, flexWrap: "wrap" }}>
        <input className="btn" style={{ flex: 1, width: "auto" }} placeholder="来源说明或依据" value={snote} onChange={(e) => setSnote(e.target.value)} />
        <select className="btn" style={{ width: "auto" }} value={role} onChange={(e) => setRole(e.target.value)}><option value="all">所有人员</option><option value="driver">司机</option><option value="safety_admin">管理员</option></select>
        <button className="btn primary" style={{ width: "auto" }} disabled={!title.trim() || !content.trim()} onClick={async () => { try { const r = await knowledgeCreate({ title, content, source_note: snote, applicable_role: role }); setMsg(`已建 ${r.article_id} v${r.version_no}（draft）· 审计 ${r.audit_id}`); setTitle(""); setContent(""); setSnote(""); await reload(); } catch (e) { setErr(e instanceof Error ? e.message : "创建失败"); } }}>创建草稿</button>
      </div></div>
    {!rows ? <div className="meta">读取中…</div> : rows.map((r) => <div id={r.is_latest?`knowledge-${r.article_id}`:undefined} key={`${r.article_id}:${r.version_no}`} className="task-card knowledge-entry" style={{ padding: 8, marginTop: 6, outline: hl === String(r.article_id) ? "2px solid #1a56c4" : "none" }}>
      <div style={{ fontSize: 12.5 }}><b>第{String(r.version_no)}版</b> {r.is_latest ? null : <span className="meta">（历史版本，仅追溯）</span>} <StatusTag s={String(r.review_status)} /> {r.officially_referenceable ? <span style={{ fontSize: 11, color: "#1a6b2a" }}>· AI 可正式引用</span> : null}</div>
      <div className="t" style={{ fontSize: 13 }}>{String(r.title)}</div>
      <div className="meta">维度 {dimName(r.dimension)} · 适用 {r.applicable_role==="driver"?"司机":r.applicable_role==="safety_admin"?"管理员":"所有人员"} · 来源 {String(r.source_note || "—")} · 作者 {String(r.created_by)} · {r.reviewed_by ? `审核 ${String(r.reviewed_by)} @${String(r.reviewed_at || "").slice(0, 16)}` : "未审"}</div>
      {r.content ? <div className="meta" style={{ whiteSpace: "pre-wrap" }}>{String(r.content).slice(0, 240)}{(String(r.content).length > 240 ? "…" : "")}</div> : null}
      <KnowledgeAttachments content={r.content}/>{r.is_latest ? <div style={{ display: "flex", gap: 6, marginTop: 4, flexWrap: "wrap" }}>
        {r.review_status === "draft" && <>
          {editFor === `${r.article_id}` ? <div style={{ display: "flex", gap: 6, width: "100%" }}><input className="btn" style={{ flex: 1, width: "auto" }} value={editTxt} onChange={(e) => setEditTxt(e.target.value)} placeholder="修订正文" /><button className="btn primary" style={{ width: "auto" }} onClick={() => { act(String(r.article_id), { action: "edit", content: editTxt }, "修订"); setEditFor(null); }}>存修订</button></div>
            : <button className="btn" style={{ padding: "2px 8px" }} onClick={() => { setEditFor(String(r.article_id)); setEditTxt(String(r.content || "")); }}>编辑</button>}
          <button className="btn" style={{ padding: "2px 8px" }} onClick={() => act(String(r.article_id), { action: "submit" }, "提交审核")}>提交审核</button></>}
        {r.review_status === "pending_review" && <>
          <button className="btn" style={{ padding: "2px 8px" }} onClick={() => act(String(r.article_id), { action: "withdraw" }, "退回")}>退回草案</button>
          {confirmId === String(r.article_id)
            ? <button className="btn primary" style={{ padding: "2px 8px", width: "auto", background: "#8a2b0b", borderColor: "#8a2b0b" }} onClick={() => act(String(r.article_id), { action: "approve", confirm_same_actor: true }, "同作者批准")}>确认并批准（同作者留痕）</button>
            : <button className="btn primary" style={{ padding: "2px 8px", width: "auto" }} onClick={() => act(String(r.article_id), { action: "approve" }, "审核通过")}>审核通过</button>}</>}
        {r.review_status === "approved" && <>
          <button className="btn" style={{ padding: "2px 8px" }} onClick={() => act(String(r.article_id), { action: "disable" }, "停用")}>停用</button>
          <button className="btn" style={{ padding: "2px 8px" }} onClick={() => act(String(r.article_id), { action: "new_version", content: String(r.content) }, "建新版本(基于当前)")}>新版本</button></>}
      </div> : null}
    </div>)}
    <p className="login-note">知识条目依次经过起草、审核和发布；修改已发布内容会生成新版本，旧版保留。</p>
  </div>;
}
