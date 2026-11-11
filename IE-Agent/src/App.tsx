import {saveActiveMessages} from './ai-conversation-store';
import {BrandMark} from './brand';
import {LoginHome} from './login-home';
import {ConversationSidebar,readConversations} from './ai-conversations';
import {MessagingProvider} from './messaging';
import { AiMessage } from './ai-message';
import './ai-message.css';
import { AgentReportCard, AgentActionCard, AgentAccountUpload } from './agent-tools';
import {RiskMonitorProvider} from './risk-monitor';
import type { AgentArtifact, AgentPlan } from './agent-tools';
import { AccountProfile } from "./account";
import { loadVehicleLabels, displayText } from "./vehicles";
import {useEffect, useState, useRef} from "react";
import type { FormEvent } from "react";
import {ApiError, aiCallsStatus, aiChat, aiConfirm, aiEvidenceCheck, aiEvidenceCheckVer, aiSelftest, aiUpload, getMe, login} from "./api";
import type { AiUpload } from "./api";
import type { Selftest } from "./api";
import type { EvidenceCard } from "./api";
import { Tag } from "./ui";
import type { MeUser } from "./api";
function clearAiSession() { try { const owner = sessionStorage.getItem("claw_ai_owner"); if (owner) sessionStorage.removeItem("claw_ai_msgs_" + owner); sessionStorage.removeItem("claw_ai_owner"); sessionStorage.removeItem("claw_fill"); sessionStorage.removeItem("claw_fill_seen"); } catch {} window.dispatchEvent(new Event("claw:auth-lost")); }
import { AdminShell } from "./admin";
import { DriverShell } from "./driver";

function LoginView({ onDone }: { onDone: () => void }) {
  const [notice] = useState(() => { const s = sessionStorage.getItem("account_notice"); sessionStorage.removeItem("account_notice"); return s; });
  const [u, setU] = useState("");
  const [p, setP] = useState("");
  const [showPassword, setShowPassword] = useState(false);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<{ tone: string; text: string } | null>(null);
  async function submit(e: FormEvent) {
    e.preventDefault();
    if (busy) return;
    setBusy(true); setMsg(null);
    try {
      await login(u.trim(), p);
      onDone();
    } catch (err) {
      const code = err instanceof ApiError ? err.code : "network_error";
      setMsg({ tone: code === "invalid_credentials" ? "danger" : "warn",
        text: code === "invalid_credentials" ? "账号或密码不正确。"
          : code === "account_disabled" ? "账号已停用，请联系安全管理员。"
          : code === "too_many_attempts" ? "尝试次数过多，请 5 分钟后再试。"
          : code === "database_unavailable" ? "登录服务暂不可用，请稍后重试。"
          : code === "network_error" ? "登录服务暂不可用，请稍后重试。"
          : "暂时无法完成登录，请稍后重试。" });
    } finally { setBusy(false); }
  }
  return <LoginHome>
    <form id="login-form" className="login-card" onSubmit={submit}>
      <div className="login-brand"><BrandMark/><div><h1>易流智安</h1><div className="login-sub">驾驶安全管理</div></div></div>
      <h2 className="login-heading">欢迎回来</h2><p className="lh-form-subtitle">登录易流智安，进入安全管理工作台</p>{notice && <div className="alert info">{notice}</div>}
      {msg && <div className={`alert ${msg.tone}`} role="alert">{msg.text}</div>}
      <div className="field"><label htmlFor="ln">账号</label><input id="ln" autoComplete="username" autoCapitalize="none" spellCheck={false} value={u} onChange={(e) => { setU(e.target.value); setMsg(null); }} placeholder="请输入账号" required /></div>
      <div className="field"><label htmlFor="pw">密码</label><div className="password-input"><input id="pw" type={showPassword ? "text" : "password"} autoComplete="current-password" value={p} onChange={(e) => { setP(e.target.value); setMsg(null); }} placeholder="请输入密码" required /><button type="button" className="password-toggle" aria-label={showPassword ? "隐藏密码" : "显示密码"} aria-pressed={showPassword} onClick={() => setShowPassword(v => !v)}><svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" strokeWidth="1.5" aria-hidden="true"><path d="M2 12s3.5-7 10-7 10 7 10 7-3.5 7-10 7S2 12 2 12Z" /><circle cx="12" cy="12" r="3" />{showPassword && <path d="M3 3l18 18" />}</svg></button></div></div>
      <button className="btn primary login-submit" disabled={busy || !u.trim() || !p}>{busy ? "登录中…" : "登录"}<span aria-hidden="true">→</span></button>
    </form>
  </LoginHome>;
}

function SsoUnboundView({ name, provider, onUseAppAccount }: { name: string; provider: string; onUseAppAccount: () => void }) {
  return <div className="login-wrap sso-unbound"><div className="login-card">
    <h1>等待账号授权</h1>
    <p className="login-sub">{provider === "dingtalk" ? "钉钉" : "千问"} 账号「{name || "—"}」尚未绑定工作台角色。</p>
    <div className="alert info">安全管理员在「系统管理 → 账号与角色」为你开通并配置范围后，重新访问即可进入。</div>
    <button className="btn lg" onClick={onUseAppAccount}>使用账号登录</button>
  </div></div>;
}

function openEvidenceRoute(route:string){if(route.startsWith('driver:'))window.dispatchEvent(new CustomEvent('claw:driver-nav',{detail:route.slice(7)}));else location.hash=route.replace(/^#/, '');}

function AiPanel({ onClose, who, preset, onPresetUsed }: { onClose: () => void; who: { role: string; userId: string }; preset?: string | null; onPresetUsed?: () => void }) {
  type Msg = { artifacts?:AgentArtifact[]; actionPlans?:AgentPlan[]; role: "user" | "assistant"; content: string; citations?: string[]; limitations?: string[]; drafts?: Record<string, unknown>[] | null; err?: string; cards?: EvidenceCard[]; callId?: string | null; restored?: boolean; longTerm?: boolean; replayed?: boolean; attachments?: { name: string; kind_label: string; chars: number }[]; audit?: { issues: string[]; llm_checked: boolean } };
  const [historyOpen,setHistoryOpen]=useState(false);
  const [driverGreeting]=useState(()=>[
    '开车辛苦了，有什么想问的？',
    '一路辛苦了，有什么我能帮忙的？',
    '歇一会儿吧，有问题随时问我。',
    '辛苦了，今天有什么想了解的？',
    '休息一下，有什么想聊的吗？'
  ][Math.floor(Math.random()*5)]);
  const chatScrollRef=useRef<HTMLDivElement>(null);
  const [msgs, setMsgs] = useState<Msg[]>(() => {
    const saved=readConversations(who.userId);
    return (saved.items.find(t=>t.id===saved.active)?.messages||[]).map(m=>({...m,restored:true}));
  });
  useEffect(() => { if(chatScrollRef.current)chatScrollRef.current.scrollTop=chatScrollRef.current.scrollHeight; }, [msgs]);
  const sendRef = useRef<(p?: string) => void>(() => undefined);
  sendRef.current = (text?: string) => { void send(text); };
  useEffect(() => { if (preset) { const t = setTimeout(() => { sendRef.current(preset); onPresetUsed && onPresetUsed(); }, 60); return () => clearTimeout(t); } }, [preset]);
  function doFill(ft: Record<string, unknown>) { try { sessionStorage.setItem("claw_fill", JSON.stringify(ft)); window.dispatchEvent(new CustomEvent("claw:fill", { detail: ft })); } catch {} const r = String(ft.route || ""); if (r) location.hash = r.replace(/^#/, ""); }
  const [confirms, setConfirms] = useState<Record<string, { decision: string; at: string; business: string | null }>>({});
  const [bizDraft, setBizDraft] = useState<Record<string, string>>({});
  const [checkMsg, setCheckMsg] = useState<string | null>(null);
  const [storageError,setStorageError]=useState('');
  useEffect(()=>{const warn=()=>setStorageError('本机存储空间不足或不可用，本次对话暂未完整保存，请保留页面并释放空间。');window.addEventListener('claw:chat-storage-error',warn);return()=>window.removeEventListener('claw:chat-storage-error',warn)},[]);
  const [probe, setProbe] = useState<string | null>(null);
  const [st, setSt] = useState<null | Selftest>(null);
  const [lastModel, setLastModel] = useState<string | null>(null);
  const [input, setInput] = useState("");
  const [busy, setBusy] = useState(false);
  // 附件状态持久化到 sessionStorage：刷新页面或重开面板后不丢失（服务端24h过期，恢复时过滤）
  const attKey = "claw_ai_atts_" + who.userId;
  const [atts, setAtts] = useState<AiUpload[]>(() => {
    try { const raw = localStorage.getItem(attKey); if (!raw) return [];
      return (JSON.parse(raw) as AiUpload[]).filter((a) => a && a.upload_id && Date.parse(a.expires_at) > Date.now()); } catch { return []; }
  });
  useEffect(() => { try { if (atts.length) localStorage.setItem(attKey, JSON.stringify(atts)); else localStorage.removeItem(attKey); } catch {} }, [atts, attKey]);
  const [attBusy, setAttBusy] = useState(false);
  const [attErr, setAttErr] = useState("");
  const fileRef = useRef<HTMLInputElement>(null);
  const page = location.hash.replace(/^#\//, "").slice(0, 40);
  function uploadError(e: unknown) {
    const code = e instanceof ApiError ? e.code : "";
    return ({ file_type_not_supported: "仅支持 .xlsx / .csv / .docx / .pdf / .pptx / .html / .md / .txt 文件",
      legacy_format_not_supported: "旧版二进制格式不支持：请将 .doc/.ppt/.xls 另存为 .docx/.pptx/.xlsx 后上传",
      file_too_large: "文件超过 20MB 上限", file_empty: "文件为空", csv_quote_invalid: "CSV 引号不完整，请检查文件格式",
      extract_failed: "文件内容解析失败，请确认文件未损坏或加密", extract_dependency_missing: "服务器缺少文档解析组件，请联系管理员",
      extract_empty: "未能从文件中提取到文字内容（可能是扫描版PDF或空文档）", ai_upload_local_only: "当前部署为云端精简版：文件上传解析仅本地完整版可用，其余AI功能不受影响" } as Record<string, string>)[code] || "上传失败，请重试";
  }
  async function uploadFile(file: File) {
    setAttBusy(true); setAttErr("");
    try {
      const r = await aiUpload(file);
      setAtts((prev) => prev.length >= 3 ? prev : prev.concat(r));
    } catch (e) { setAttErr(uploadError(e)); } finally { setAttBusy(false); }
  }
  async function send(preset?: string) {
    const text = (preset ?? input).trim();
    if ((!text && !atts.length) || busy) return;
    const sentAtts = atts;
    const content = text || "（已上传附件，请结合文件内容处理。）";
    setInput(""); setAtts([]); setAttErr("");
    const next = [...msgs, { role: "user" as const, content, attachments: sentAtts.map((a) => ({ name: a.name, kind_label: a.kind_label, chars: a.chars })) }];
    setMsgs(next); saveActiveMessages(who.userId,next); const conversationId=readConversations(who.userId).active; setBusy(true);
    // 幂等键（agent1 client_request_id 语义）：网络重试/双击由服务端回放同一结果
    const crid = typeof crypto !== "undefined" && "randomUUID" in crypto ? crypto.randomUUID() : "r" + Date.now() + Math.random().toString(36).slice(2, 10);
    try {
      const r = await aiChat(next.map((m) => ({ role: m.role, content: m.content })), page, crid,page.startsWith('rm-live')?sessionStorage.getItem('claw_current_case')||undefined:undefined,sentAtts.map((a) => a.upload_id));
      if (r.meta?.model) setLastModel(String(r.meta.model));
      const completed:Msg[]=next.concat({ role: "assistant", content: r.answer, artifacts:r.artifacts, actionPlans:r.action_plans, citations: r.citations, limitations: r.data_limitations, drafts: r.draft_preview, cards: (r as { evidence_cards?: EvidenceCard[] }).evidence_cards || [], callId: (r as { ai_call_id?: string | null }).ai_call_id || null, replayed: r.idempotent_replay === true, audit: r.meta?.answer_audit && !r.meta.answer_audit.passed ? { issues: r.meta.answer_audit.issues, llm_checked: r.meta.answer_audit.llm_checked } : undefined }); saveActiveMessages(who.userId,completed,conversationId); setMsgs(completed);
      { const ids = msgs.filter((m) => m.callId).map((m) => m.callId as string).concat([(r as { ai_call_id?: string | null }).ai_call_id || ""].filter(Boolean)); if (ids.length) aiCallsStatus(ids).then((x) => setConfirms((c0) => ({ ...c0, ...x.confirms }))).catch(() => {}); }
    } catch (e) {
      const code = e instanceof ApiError ? e.code : "network_error";
      const failed:Msg[]=next.concat({ role: "assistant", content: "", err: code }); saveActiveMessages(who.userId,failed,conversationId); setMsgs(failed);
    }
    setBusy(false);
  }
  const suggestions = who.role === "driver"
    ? ["我的评分怎么构成？", "我能问别人分数吗", "待审核课程算正式制度吗", "如何提交复核申请"]
    : ["生成最近有数据的一周车队周报，输出HTML和Markdown文件", "分析车队评分分布及重点关注车辆", "查看课程，准备给D级车辆创建培训任务"];
  return <div className={"ai-panel ai-with-history"+(who.role==="driver"?" mobile-ai "+(historyOpen?"history-open":""):"")} role="complementary" style={{ width: 380, padding: 0 }}>
    {who.role==="driver"&&<div className="mobile-ai-toolbar"><button aria-label="历史会话" onClick={()=>setHistoryOpen(true)}>☰</button><strong>新会话</strong><button aria-label="新建会话" disabled={busy} onClick={()=>window.dispatchEvent(new Event("claw:driver-new-chat"))}>＋</button></div>}
    <div style={{ padding: "10px 14px", background: "var(--navy)", color: "#fff", borderRadius: "12px 12px 0 0" }}>
      <button className="ai-close" onClick={onClose} style={{ color: "#cdd9ef" }} aria-label="关闭">✕</button>
      <b style={{ fontSize: 14 }}>AI 助手</b>
      <details className="ai-tools-menu"><summary>更多</summary><div>    {["safety_admin","safety_officer"].includes(who.role) && <details className="ai-advanced"><summary>会话设置</summary><div style={{ display: "flex", gap: 6, alignItems: "center", flexWrap: "wrap" }}>
      <p className="meta">完整对话自动保存在本机，退出登录、关闭助手或刷新后仍可恢复。各账号分别保存，可在历史会话中查看。</p>
    </div>{storageError && <p className="meta" role="alert">{storageError}</p>}</details>}
    {["safety_admin","safety_officer"].includes(who.role) && <details className="ai-advanced"><summary>Excel账号导入</summary><AgentAccountUpload disabled={busy} onPlan={p=>setMsgs(m=>m.concat({role:"assistant",content:`已上传并校验账号表，批次 ${p.id}，共 ${p.count} 个账号；尚未创建。可以在下方确认，或让我检查这个批次。`,actionPlans:[p]}))}/></details>}
</div></details>
      
    </div>
    {who.role==="driver"&&historyOpen&&<button className="mobile-history-backdrop" aria-label="关闭历史会话" onClick={()=>setHistoryOpen(false)}/>}
    <ConversationSidebar mobile={who.role==="driver"} onDismiss={()=>setHistoryOpen(false)} user={who.userId} messages={msgs} busy={busy} onSelect={items=>{setMsgs(items);setInput('');setCheckMsg(null);setBizDraft({});setConfirms({})}}/>
    <div className="ai-main">{storageError && <div className="alert warn" role="alert">{storageError}</div>}
    <div className="ai-chat-body" ref={chatScrollRef} style={{ overflow: "auto", padding: "10px 12px" }}>

      {who.role==="driver"&&msgs.length===0&&<div className="mobile-chat-welcome"><img className="mobile-chat-logo" src="/brand/yiliu-mark.svg" alt="易流智安"/><h2>{driverGreeting}</h2></div>}
      {msgs.map((m, i) => m.role === "user"
        ? <div key={i} className="task-card" style={{ background: "var(--info-bg)" }}><div className="t">{displayText(m.content).startsWith("AI04 三种管理路径并排预演") ? "分析当前车辆的处置方案" : displayText(m.content)}</div>
            {!!m.attachments?.length && <div className="row" style={{ flexWrap: "wrap", gap: 4, marginTop: 4 }}>{m.attachments.map((a, k) => <span key={k} className="ai-att-chip">📎 {a.name}<em>{a.kind_label} · {a.chars}字</em></span>)}</div>}
          </div>
        : m.err
          ? <div key={i} className="alert warn" style={{ fontSize: 12.5 }}>{m.err === "ai_provider_not_configured" ? "AI 通道未配置（属主 Page env）：运行时模型尚未接通——本界面不是静态聊天模拟，拒绝假回答。人工流程不受影响。" : m.err === "ai_upstream_error" ? "模型上游暂时不可用；工具与人工流程不受影响（可稍后重试）。" : m.err === "ai_request_version_conflict" ? "该问题已有返回结果（幂等保护）；请修改问题后重试。" : m.err === "unauthenticated" ? "登录已过期：请刷新页面重新登录。" : m.err === "ai_policy_blocked" ? "模型端点策略不允许（必须是外部 HTTPS 地址）；请属主检查 Page env。" : m.err === "attachment_expired" ? "附件已过期（上传后24小时有效）：请重新上传文件后再提问。" : m.err === "attachment_not_found" || m.err === "attachment_forbidden" ? "附件不存在或不可用：请重新上传文件。" : m.err === "ai_course_invalid" ? "AI 未能根据该文件生成有效课程内容，请补充说明或更换材料重试。" : `请求失败：${m.err}`}</div>
          : <div key={i} className="task-card">
              {m.longTerm ? <div style={{ fontSize: 11, color: "#ad6800", marginBottom: 2 }}>⌛ 长期摘要（本设备暂存·已截断，非业务状态；重登恢复）</div> : null}
              
              <AiMessage content={displayText(m.content)} />
              {m.artifacts?.map(a=><AgentReportCard key={a.id} artifact={a}/>)}
              {m.actionPlans?.map(p=><AgentActionCard key={p.id} initial={p}/>)}
              {m.cards && m.cards.length > 0 && <div style={{ marginTop: 6 }}>
                <div style={{ fontSize: 12, color: "var(--ink-2)", marginBottom: 4 }}>证据卡（数字仅来自受控工具真实返回；点击按当前会话重新验权；空值显示“—”不出 0）：</div>
                <div style={{ display: "grid", gap: 6 }}>
                {m.cards.map((cd) => <div key={cd.ref} className="task-card" style={{ padding: 8 }}>
                  <div className="t" style={{ fontSize: 12.5 }}>{cd.field} = <b style={{ color: cd.confidence === "low" ? "var(--warn)" : "var(--ink)" }}>{cd.value === null ? "—" : displayText(cd.value)}</b>{cd.confidence ? <> <Tag tone={cd.confidence === "low" ? "amber" : "green"}>可信度 {cd.confidence}</Tag></> : null}</div>
                  <div className="meta" style={{ fontSize: 11 }}>来源表 {cd.table} · record_id <span className="mono">{cd.ref.slice(cd.ref.indexOf(":") + 1)}</span>{cd.window ? ` · ${cd.window}` : ""}{cd.as_of_date ? ` · 截止 ${cd.as_of_date}` : ""}{cd.source_version ? ` · ${String(cd.source_version).slice(0, 22)}` : ""}</div>
                  {cd.limitations ? <div className="meta" style={{ color: "var(--warn)" }}>⚠ {cd.limitations}</div> : null}
                  <button className="btn" style={{ padding: "3px 10px", fontSize: 12, marginTop: 4 }} onClick={() => { setCheckMsg(null);
                    const go = cd.verification_id
                      ? aiEvidenceCheckVer(cd.verification_id).then((r2) => {
                          if ("ok" in r2 && r2.ok) { if (r2.route) { openEvidenceRoute(r2.route); setCheckMsg("回执重验通过，已请求打开对应记录。"); } else setCheckMsg("回执重验通过：记录在你授权范围内（该来源无独立详情页）。"); }
                          else setCheckMsg(`验权未通过/回执已过期（5 分钟）：${("hint" in r2 && r2.hint) || "请重新向 AI 查询"}`);
                        })
                      : aiEvidenceCheck(cd.ref).then((r2) => {
                          if (r2.ok) { if (r2.route) { openEvidenceRoute(r2.route); setCheckMsg("重新验权通过，已请求打开对应记录。"); } else setCheckMsg("服务端已按当前会话重新验权：记录在你授权范围内（该来源无独立详情页）。"); } else setCheckMsg(`验权未通过/记录失效：${r2.hint || "请重新向AI查询"}`);
                        });
                    go.catch(() => setCheckMsg("校验未完成：请重试")); }}>打开 / 重新验权</button>
                  {m.callId && m.drafts && m.drafts.length > 0 && null}
                </div>)}
                </div>
              </div>}
              {m.citations && m.citations.length > 0 && <details style={{ marginTop: 6 }}><summary style={{ fontSize: 12, cursor: "pointer" }}>原始引用（{m.citations.length}）</summary>
                {m.citations.map((c) => <div key={c} className="mono" style={{ fontSize: 11 }}>{displayText(c)}</div>)}
              </details>}
              {m.limitations && m.limitations.length > 0 && <details style={{ fontSize:11.5,marginTop:6 }}><summary style={{cursor:"pointer",color:"var(--ink-3)"}}>数据口径与限制</summary><div style={{color:"var(--warn)"}}>{m.limitations.join("；")}</div></details>}
              {m.drafts && m.drafts.length > 0 && <div style={{ marginTop: 6 }}>
                {m.drafts.map((d, k) => <div key={k} style={{ border: 0 }}>{d.kind === "intervention"
                  ? <div className="task-card"><div className="t">干预草稿</div><div className="meta">{displayText((d as { draft_text?: string }).draft_text || "").slice(0, 210)}…</div><div className="meta">AI 未写库；发送前在 RM03 编辑并独立确认</div>{(d as { fill_to?: Record<string, unknown> }).fill_to ? <button className="btn" style={{ padding: "3px 10px" }} onClick={() => doFill((d as { fill_to: Record<string, unknown> }).fill_to)}>编辑干预草稿 →</button> : null}</div>
                  : d.kind === "training"
                    ? <div className="task-card"><div className="t">培训计划草稿{(d as { fill_to?: Record<string, unknown> }).fill_to ? <button className="btn" style={{ padding: "3px 10px" }} onClick={() => doFill((d as { fill_to: Record<string, unknown> }).fill_to)}>编辑培训方案 →</button> : null}</div><div className="meta">{String((d as { goal?: string }).goal || "")}</div><div className="meta">仅 approved 课程可分配；TR02 页面确认；未审核课程由服务端 409 拒绝</div></div>
                    : <div className="task-card"><div className="t">管理动作建议（预演，未写入）</div><div className="meta">{JSON.stringify((d as { paths?: unknown[] }).paths || (d as { draft_action?: unknown[] }) || []).slice(0, 240)}</div>{(d as { fill_to?: Record<string, unknown> }).fill_to ? <button className="btn" style={{ padding: "3px 10px" }} onClick={() => doFill((d as { fill_to: Record<string, unknown> }).fill_to)}>填入表单 →</button> : null}</div>}
                </div>)}
              </div>}
              {m.audit && <div className="alert warn" role="status" style={{ fontSize: 11.5, marginTop: 6 }}>⚖️ 审计智能体业务核对{m.audit.llm_checked ? "（已作模型复核）" : ""}：{m.audit.issues.join("；")}</div>}
            </div>)}
      {busy && <div className="task-card ai-thinking" aria-live="polite"><span className="ai-thinking-dots" aria-hidden="true"><i/><i/><i/></span>思考中，正在查询数据并整理回答…</div>}
    </div>
    {probe && <div className="alert info" style={{ fontSize: 12 }}>{probe}</div>}
    {checkMsg && <div className="alert info" style={{ margin: "0 12px 6px" }}>{checkMsg}</div>}
    <div className="row ai-shortcuts" style={{ padding: "0 12px 10px" }}>
      {suggestions.map((s,index) => <button key={s} className="btn" style={{ padding: "4px 8px", fontSize: 12 }} onClick={() => send(s)}>{who.role === "driver"?s:["生成周报","数据分析","创建培训"][index]}</button>)}
      {["safety_admin","safety_officer"].includes(who.role) && <button className="btn" style={{ padding: "4px 8px", fontSize: 12 }} onClick={() => { aiSelftest().then((r) => { setSt(r); setProbe(`工具自检 ${r.tools.length} 项 · 写入=${r.writes==="zero_confirmed"?"零":"异常"} · ${r.provider} · ver ${r.prompt_version}`);
 const pre: Record<string, unknown>[] = [];
 const pi = (r as { preplan?: Record<string, Record<string, unknown>> }).preplan;
 if (pi?.intervention?.fill_to) pre.push({ kind: "intervention", ...(pi.intervention as Record<string, unknown>) });
 if (pi?.training?.fill_to) pre.push({ kind: "training", ...(pi.training as Record<string, unknown>) });
 setMsgs((m) => m.concat({ role: "assistant" as const, content: `【工具链自检（真实执行，非模型对话）】\n` + r.tools.map((x) => `${x.tool}:${x.status}${x.requires_confirmation ? "(需确认草稿)" : ""}`).join("\n") + `\n业务表计数前后一致=${r.writes}`, drafts: pre.length ? pre : null })); }).catch((e) => setProbe("自检失败 " + (e instanceof ApiError ? e.code : "?"))); }}>检查工具</button>}
    </div>
    {(atts.length > 0 || attBusy || attErr) && <div style={{ padding: "6px 12px 0" }}>
      <div className="row" style={{ flexWrap: "wrap", gap: 4 }}>
        {atts.map((a) => <span key={a.upload_id} className="ai-att-chip">📎 {a.name}<em>{a.kind_label} · {a.chars}字{a.rows ? ` · ${a.rows}行` : ""}{a.truncated ? " · 已截断" : ""}</em>
          <button className="ai-att-x" aria-label={"移除附件 " + a.name} disabled={busy || attBusy} onClick={() => setAtts((prev) => prev.filter((x) => x.upload_id !== a.upload_id))}>✕</button></span>)}
        {attBusy && <span className="ai-att-chip">解析中…<span className="ai-thinking-dots" aria-hidden="true"><i/><i/><i/></span></span>}
      </div>
      {attErr && <div className="alert warn" role="alert" style={{ fontSize: 12, marginTop: 4 }}>{attErr}</div>}
    </div>}
    <div className="ai-composer" style={{ padding: "8px 12px", display: "flex", gap: 6 }}>
      <input ref={fileRef} type="file" accept=".xlsx,.csv,.docx,.pdf,.pptx,.html,.htm,.md,.txt" style={{ display: "none" }} aria-label="上传文件给AI" onChange={(e) => { const file = e.target.files?.[0]; e.target.value = ""; if (file) void uploadFile(file); }} />
      <button className="btn" style={{ width: "auto", padding: "8px 10px" }} title="上传文件（Excel账号表、Word、PDF、PPT、HTML、Markdown、TXT、CSV，≤20MB，最多3个）" aria-label="上传文件" disabled={busy || attBusy || atts.length >= 3} onClick={() => fileRef.current?.click()}>📎</button>
      <input style={{ flex: 1, minWidth: 0, padding: "8px 10px", border: "1px solid var(--line)", borderRadius: 8 }} value={input} onChange={(e) => setInput(e.target.value)} onKeyDown={(e) => { if (e.key === "Enter") send(); }} placeholder={busy ? "正在回复…" : atts.length ? "可补充说明，如：按表格批量创建账号" : "发送消息"} aria-label="AI 提问" />
      <button className="btn primary" style={{ width: "auto" }} onClick={() => send()} disabled={busy || attBusy || (!input.trim() && !atts.length)}>发送</button>
    </div>
    </div>
  </div>;
}

export function App() {
  const [me, setMe] = useState<MeUser | null | undefined>(undefined);
  const [unbound, setUnbound] = useState<{ name: string; provider: string } | null>(null);
  const [forceLogin, setForceLogin] = useState(false);
  const [ai, setAi] = useState(false);
  const [scoreVersion,setScoreVersion] = useState("initial");
  const [aiPreset, setAiPreset] = useState<string | null>(null);
  useEffect(() => { const h = (ev: Event) => { const d = (ev as CustomEvent<{ prompt?: string }>).detail; if (d && d.prompt) { setAiPreset(String(d.prompt).slice(0, 400)); setAi(true); window.dispatchEvent(new CustomEvent("claw:driver-nav",{detail:"ai"})); } }; window.addEventListener("claw:ai-preset", h); return () => window.removeEventListener("claw:ai-preset", h); }, []);
  const reload = () => getMe().then(async (r) => {
    if (!r) { setMe(null); return; }
    if (r.user) { if (!r.user.mustChangePassword) await loadVehicleLabels().catch(() => {}); setMe(r.user); setUnbound(null); setAi(false); }
    else if (r.unbound) { setMe(null); setUnbound({ name: r.unbound.name, provider: r.unbound.provider }); }
    else setMe(null);
  }).catch(() => setMe(null));
  useEffect(() => { reload(); const h = () => { void reload(); }; window.addEventListener("claw:account-updated", h); return () => window.removeEventListener("claw:account-updated", h); }, []);
  useEffect(() => { if (!me || me.role !== "driver") return; const refresh = () => { getMe().then(async r => { if (r?.user && (r.user.driverId !== me.driverId || r.user.bindingVerified !== me.bindingVerified)) { await loadVehicleLabels().catch(() => {}); sessionStorage.removeItem("claw_ai_msgs_" + me.userId); sessionStorage.removeItem("claw_ai_threads_" + me.userId); setAi(false); setMe(r.user); } }).catch(() => {}); }; const timer = setInterval(refresh, 15000); window.addEventListener("focus", refresh); return () => { clearInterval(timer); window.removeEventListener("focus", refresh); }; }, [me?.userId, me?.driverId, me?.bindingVerified]);
  useEffect(() => { if (!me) return; let alive=true, previous:string|null=null; const sync=async()=>{ try { const response=await fetch("/api/score-version",{credentials:"same-origin"}); if(!response.ok)return; const result=await response.json(); if(!alive)return; if(previous!==null&&result.version!==previous){sessionStorage.removeItem("claw_ai_msgs_"+me.userId);setAi(false);setScoreVersion(result.version);} previous=result.version; }catch{} }; void sync(); const timer=setInterval(sync,15000); window.addEventListener("claw:scores-updated",sync); window.addEventListener("focus",sync); return()=>{alive=false;clearInterval(timer);window.removeEventListener("claw:scores-updated",sync);window.removeEventListener("focus",sync);}; },[me?.userId]);
  if (me === undefined) return <div className="login-wrap"><div className="skeleton" style={{ width: 240 }} /></div>;
  if (unbound && !forceLogin) return <SsoUnboundView {...unbound} onUseAppAccount={() => setForceLogin(true)} />;
  if (!me) return <LoginView onDone={reload} />;
  if (me.mustChangePassword) return <div className="first-login"><AccountProfile user={me} required /></div>;
  return <RiskMonitorProvider key={me.userId+':'+me.driverId} user={me}><MessagingProvider user={me}><div className={`app-workspace ${me.role === "driver" ? "driver-workspace" : "admin-workspace"} ${ai ? "ai-open" : ""}`}>
    {me.role === "driver" ? <DriverShell key={`${me.userId}:${me.driverId}:${me.bindingVerified}:${scoreVersion}`} user={me} aiContent={<AiPanel onClose={()=>window.dispatchEvent(new CustomEvent("claw:driver-nav",{detail:"safety"}))} who={{role:me.role,userId:me.userId}} preset={aiPreset} onPresetUsed={()=>setAiPreset(null)}/>} /> : <AdminShell key={`${me.userId}:${scoreVersion}`} user={me} aiOpen={ai} onAiToggle={() => setAi(v => !v)} />}
    
    {me.role!=="driver" && <div style={{display:ai?"contents":"none"}}><AiPanel onClose={() => setAi(false)} who={{ role: me!.role, userId: me!.userId }} preset={aiPreset} onPresetUsed={() => setAiPreset(null)} /></div>}
  </div></MessagingProvider></RiskMonitorProvider>;
}
