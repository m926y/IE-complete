import {useCanDeleteTraining} from './training-ui';
import {CourseEditor,CourseContent,courseText} from './course-editor';
import {api} from './api';
// R19：TR05 课程库/审核面板（复用 course-review 状态机 + 新 course-draft） + SM04 审计控制台（服务端筛选/分页/导出）
import { useCallback, useEffect, useState, useRef } from "react";
import { auditQuery, courseCreate, courseDraftEdit, coursesBoard, courseReview, opsSet } from "./api";

type Course = Record<string, unknown> & { course_id: string; review_trail?: Record<string, unknown>[] };
type AudRow = Record<string, string | null>;

const STY: Record<string, [string, React.CSSProperties]> = {
  approved: ["已审核·可分配", { background: "#e6f4ea", color: "#1a6b2a", border: "1px solid #b7e0c0" }],
  pending_review: ["待审·不可分配", { background: "#fff7e6", color: "#ad6800", border: "1px solid #ffd591" }],
  demo_draft_requires_team_review: ["待审核", { background: "#fff7e6", color: "#ad6800", border: "1px solid #ffd591" }],
  draft: ["草稿·未生效", { background: "#f0f0f0", color: "#555", border: "1px solid #ccc" }],
  disabled: ["已停用", { background: "#fdecaa", color: "#8a2b0b", border: "1px solid #f5c0c0" }],
};
const Tag2 = ({ s }: { s: string }) => { const [t, st] = STY[s] || [s, {}]; return <span style={{ fontSize: 11, padding: "1px 6px", borderRadius: 6, ...st }}>{t}</span>; };

export function CourseBoard() {
  const canDelete = useCanDeleteTraining();
  const [rows, setRows] = useState<Course[] | null>(null);
  const [open, setOpen] = useState<Course | null>(null);
  const [msg, setMsg] = useState<string | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [fStatus, setFStatus] = useState("");
  const [showTrail, setShowTrail] = useState<string | null>(null);
  const reviewRef=useRef<HTMLDivElement>(null);
  useEffect(()=>{if(open)requestAnimationFrame(()=>reviewRef.current?.scrollIntoView({behavior:"smooth",block:"start"}))},[open?.course_id]);
  const [editFor, setEditFor] = useState<Course | null>(null);
  async function reload(pick?: string) { const r = await coursesBoard(); setRows(r.courses as Course[]); if (pick) setOpen((r.courses as Course[]).find(x => x.course_id === pick) || null); }
  useEffect(() => { reload().catch(() => setErr("课程板读取失败")); }, []);
  async function review(c: Course, next: string, confirm = false) {
    setErr(null);
    try { const r = await courseReview({ course_id: c.course_id, new_status: next, ...(confirm ? { confirm_by: "manual_admin" } : {}) }); setMsg(`「${String(c.title)}」已更新为${STY[r.new_status]?.[0]||'最新状态'}`); await reload(c.course_id); }
    catch (e) { setErr("审核动作被拒：" + String((e as { code?: string }).code || e)); }
  }
  const list = (rows || []).filter(x => x.content_status!=="deleted"&&(!fStatus || String(x.content_status) === fStatus));
  return <div className="course-board">
    {msg && <div className="alert info">{msg}</div>}
    {err && <div className="alert warn">{err}</div>}
    <div style={{ display: "flex", gap: 6, margin: "4px 0", flexWrap: "wrap" }}>
      <select className="btn" style={{ width: "auto" }} value={fStatus} onChange={(e) => setFStatus(e.target.value)} aria-label="课程状态筛选"><option value="">状态·全部</option>{Object.keys(STY).map(s => <option key={s} value={s}>{STY[s][0]}</option>)}</select>
      <span className="meta" style={{ alignSelf: "center" }}>{list.length}/{(rows || []).length}</span>
    </div>
    {!rows ? <div className="meta">读取中…</div> : <table className="tbl"><thead><tr><th>课程 / 标题</th><th>维度</th><th>状态</th><th>版本</th><th>作者</th><th>审核人 · 时间</th><th>操作</th></tr></thead>
      <tbody>{list.map(c => <tr key={c.course_id} style={{ outline: open?.course_id === c.course_id ? "2px solid #1a56c4" : "none" }}>
        <td><b>{String(c.title)}</b><div className="meta">{courseText(c.content).slice(0,60)}…</div></td>
        <td>{({history:'历史事故与未遂',fatigue_distraction:'疲劳与分心',driving_stability:'驾驶稳定性',road_rule:'道路规则',management:'管理配合',imu_evidence:'车辆运行状态'} as Record<string,string>)[String(c.dimension)]||'综合安全'}</td><td><Tag2 s={String(c.content_status)} /></td><td>第{String(c.version_no)}版</td>
        <td className="meta">{c.authored_by?'已登记':'未登记'}<div>{String(c.authored_at || "").slice(0, 10)}</div></td>
        <td className="meta">{c.reviewed_by ? "已审核" : "—"}<div>{String(c.reviewed_at || "").slice(0, 16)}</div></td>
        <td style={{ whiteSpace: "nowrap" }}>
          <button className="btn" style={{ padding: "2px 8px" }} onClick={() => { setOpen(c); setShowTrail(c.course_id); }}>查看与审核</button>{canDelete && <button className="btn" onClick={async()=>{if(!window.confirm('删除「'+c.title+'」？已分配任务的课程记录保留。'))return;try{await api('/api/courses/'+encodeURIComponent(c.course_id)+'/delete',{method:'POST',body:'{}'});setOpen(null);await reload();setMsg('课程已从课程库移除。')}catch{setErr('删除未完成，请重试。')}}}>删除</button>}
        </td>
      </tr>)}</tbody></table>}
    {open && <div ref={reviewRef} className="task-card course-review-detail" style={{ marginTop: 28 }}>
      <div className="t">课程审核 · {String(open.title)} <Tag2 s={String(open.content_status)} /> 第{String(open.version_no)}版</div>
      <CourseContent content={open.content} answers/>
      <div className="meta">完成要求：{String((open as { completion_requirement?: string }).completion_requirement || "—")}</div>
      <div style={{ display: "flex", gap: 6, flexWrap: "wrap", marginTop: 6 }}>
        {["demo_draft_requires_team_review", "draft"].includes(String(open.content_status)) && <button className="btn" onClick={() => review(open, "pending_review")}>提交审核</button>}
        {open.content_status === "pending_review" && <>
          <button className="btn" onClick={() => review(open, "draft")}>退回草稿</button>
          <button className="btn primary" style={{ width: "auto" }} onClick={() => { if (window.confirm(`确认审核通过「${String(open.title)}」？通过后可分配给司机。`)) review(open, "approved", true); }}>审核通过</button>
        </>}
        {open.content_status === "approved" && <button className="btn" onClick={() => { if (window.confirm(`确认停用「${String(open.title)}」？停用后不能再分配。`)) review(open, "disabled", true); }}>停用课程</button>}
        {["draft", "pending_review", "demo_draft_requires_team_review"].includes(String(open.content_status)) && <button className="btn" onClick={() => setEditFor(open)}>修订文本</button>}
        <button className="btn" onClick={() => setOpen(null)}>收起</button>
      </div>
      {showTrail === open.course_id && <div style={{ marginTop: 6 }}>
        <div className="t" style={{ fontSize: 12.5 }}>审核记录</div>
        {(open.review_trail || []).slice().reverse().map((x) => <div key={String(x.audit_id)} className="meta" style={{ fontSize: 11.5 }}>
          {String(x.at || "").slice(0, 19).replace('T',' ')} · {STY[String(x.to)]?.[0]||'课程内容已更新'} · <a href={`#/sm-audit?audit_id=${String(x.audit_id)}`}>查看操作详情</a>
        </div>)}
        {!(open.review_trail || []).length && <div className="meta">暂无审核记录</div>}
      </div>}
      {editFor && <CourseEditor initial={{course_id:editFor.course_id,title:String(editFor.title),dimension:editFor.dimension,content:editFor.content}} onCancel={()=>setEditFor(null)} onSave={async value=>{await courseDraftEdit(value);setEditFor(null);setMsg('课程已修订，请重新核对并审核。');await reload(editFor.course_id)}}/>}
    </div>}
    <CourseEditor onSave={async value=>{const result=await courseCreate(value);setMsg('课程草稿已保存。');await reload(result.course_id)}}/>
  </div>;
}

const ACTION_PREFIXES = ["", "ai.chat", "ai.confirm", "account", "course", "knowledge", "rule_draft", "intervention", "alert", "training", "review", "import", "ops"];

const auditText=(value:unknown):string=>{const text=String(value||'—');const names:Record<string,string>={safety_admin:'管理员',safety_officer:'安全员',driver:'司机',team_leader:'队长',active:'已启用',disabled:'已停用',pending_review:'待审核',approved:'已审核',draft:'草稿',confirmed:'已确认',closed:'已关闭',assigned:'已分配',submitted:'待验收',reviewed:'已验收',account:'账号',app_users:'账号',training_task:'培训任务',course:'课程',alert:'风险告警',rule_draft:'规则草案',knowledge:'知识内容',operation_config:'运营配置',create:'创建',update:'修改',edit:'编辑',submit:'提交',approve:'审核通过',disable:'停用',restore:'恢复',note:'添加备注',close:'关闭',confirm:'确认',assign:'分配',review:'验收',binding:'车辆绑定',import:'数据导入',login:'登录',logout:'退出',effectuate:'生效',archive:'归档',withdraw:'撤回'};return names[text]||text.split('.').map(t=>names[t]||(/[a-z_]/i.test(t)?'业务操作':t)).join(' · ')};
export function AuditConsole() {
  const [q, setQ] = useState({ actor: "", entity_id: "", action_prefix: "", from: "", to: "" });
  const [page, setPage] = useState(0);
  const [data, setData] = useState<{ rows: AudRow[]; total: number } | null>(null);
  const [detail, setDetail] = useState<Record<string, unknown> | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const limit = 25;
  const load = useCallback(async (p: number) => {
    setErr(null);
    try { const r = await auditQuery({ ...q, limit, offset: p * limit }); setData({ rows: r.rows as AudRow[], total: r.total as number }); }
    catch { setErr("审计查询失败（服务端过滤/分页）"); }
  }, [q]);
  useEffect(() => { load(0); setPage(0); }, [load]);
  const qs = () => new URLSearchParams(Object.entries(q).filter(([, v]) => v) as [string, string][]).toString();
  const pages = data ? Math.ceil(data.total / limit) : 0;
  return <div>
    <div className="task-card" style={{ padding: 8 }}>
      <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
        <input className="btn" style={{ width: 150 }} placeholder="操作人编号" value={q.actor} onChange={(e) => setQ({ ...q, actor: e.target.value })} aria-label="审计-操作者" />
        <input className="btn" style={{ width: 190 }} placeholder="业务记录编号" value={q.entity_id} onChange={(e) => setQ({ ...q, entity_id: e.target.value })} aria-label="审计-对象ID" />
        <select className="btn" style={{ width: "auto" }} value={q.action_prefix} onChange={(e) => setQ({ ...q, action_prefix: e.target.value })} aria-label="审计-action前缀">
          <option value="">全部操作类型</option>{ACTION_PREFIXES.filter(Boolean).map(a => <option key={a} value={a}>{auditText(a)}</option>)}
        </select>
        <input className="btn" style={{ width: 160 }} type="date" value={q.from} onChange={(e) => setQ({ ...q, from: e.target.value })} aria-label="审计-起" />
        <input className="btn" style={{ width: 160 }} type="date" value={q.to} onChange={(e) => setQ({ ...q, to: e.target.value })} aria-label="审计-止" />
        <a className="btn" style={{ alignSelf: "center" }} href={`/api/admin/audit?format=csv&limit=500&${qs()}`}>导出当前结果(CSV)</a>
        <button className="btn" onClick={() => load(page)}>刷新</button>
      </div>
      <div className="meta">{data ? `共 ${data.total} 条 · 第 ${page + 1}/${Math.max(pages, 1)} 页` : "查询中…"}</div>
    </div>
    {err && <div className="alert warn">{err}</div>}
    <table className="tbl"><thead><tr><th>操作时间</th><th>角色·操作者</th><th>动作</th><th>对象</th><th>状态变化</th><th>追溯记录</th></tr></thead>
      <tbody>{(data?.rows || []).map(r => <tr key={String(r.audit_id)}>
        <td><button className="btn" style={{ padding: "0 4px", fontSize: 11.5 }} onClick={async () => { try { const d = await fetch(`/api/admin/audit/${encodeURIComponent(String(r.audit_id))}`, { headers: {} , credentials:"include"}).then(x => x.json()); setDetail(d); } catch { setErr("详情读取失败"); } }}>查看详情</button><div className="meta">{String(r.occurred_at || "").slice(0, 19)}</div></td>
        <td>{auditText(r.actor_role)}<div className="meta">{String(r.actor_id)}</div></td>
        <td><b>{auditText(r.action)}</b></td>
        <td>{auditText(r.entity_type)}<div className="meta">关联业务记录</div></td>
        <td>{r.old_status ? `${auditText(r.old_status)}→` : ""}{r.new_status ? auditText(r.new_status) : "—"}</td>
        <td className="meta">{r.request_id?"已留档":"—"}</td>
      </tr>)}</tbody></table>
    <div style={{ display: "flex", gap: 8 }}><button className="btn" disabled={page === 0} onClick={() => { setPage(page - 1); load(page - 1); }}>上一页</button><button className="btn" disabled={page + 1 >= pages} onClick={() => { setPage(page + 1); load(page + 1); }}>下一页</button></div>
    {detail && <div className="task-card" style={{ marginTop: 6 }} key={JSON.stringify(detail).length}>
      <div className="t">操作详情</div>
      <details><summary>查看追溯信息</summary><pre style={{ fontSize: 11.5, whiteSpace: "pre-wrap", maxHeight: 200, overflowY: "auto" }}>{JSON.stringify({ audit: detail.audit, evidence_refs: detail.evidence_refs, detail_meta: detail.detail_meta, redaction_note: detail.redaction_note }, null, 1).slice(0, 1800)}</pre></details>
      <button className="btn" onClick={() => setDetail(null)}>关闭</button>
    </div>}
  </div>;
}
