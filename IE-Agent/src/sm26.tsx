import { vehicleLabel, vehicleId } from "./vehicles";
// R26 AI04 管理动作并排预演页（只读；复用 ai.preplan 组装端点与对话侧 action_preplan；进入草稿≠写入）
import { useEffect, useState } from "react";
import { aiEvidenceCheck } from "./api";
type Basis = { label: string; table: string; record_id: string; ref: string | null; note?: string };
type Card = { key: string; title: string; basis: Basis[]; plan: string; highlight: boolean; actionable: boolean; disabled_reason: string | null; missing: string[]; todos: string; limits: string; operator: string; draft_entry: { kind: string; label: string; hash: string } | null };
type Pre = { data_status: string; subject?: { driver_id: string | null; gpsno: string; as_of_date: string; source_version: string }; cards: Card[]; note?: string; title_tag?: string; ai_note?: string; facts_status?: string };
const api = async <T,>(p: string): Promise<T> => { const r = await fetch(p, { credentials: "include" }); const j = await r.json().catch(() => ({})); if (!r.ok) throw new Error((j as { error?: string }).error || "HTTP " + r.status); return j as T; };
export function AiPreplanPage() {
  const parse = () => { const m = location.hash.match(/[?&](driver_id|gpsno|as_of_date|as_of)=([^&#]+)/g) || []; const o: Record<string, string> = {}; for (const s of m) { const [, k, v] = s.match(/[?&](driver_id|gpsno|as_of_date|as_of)=([^&#]+)/) || []; if (k) o[k === "as_of" ? "as_of_date" : k] = decodeURIComponent(v || ""); } return o; };
  const [crit, setCrit] = useState(parse);
  const [draftQ, setDraftQ] = useState({ driver_id: "", gpsno: "", as_of_date: "" });
  const [data, setData] = useState<Pre | "loading" | "fail" | null>(null);
  const [chk, setChk] = useState<string | null>(null);
  const load = (c: Record<string, string>) => {
    setData("loading"); setChk(null);
    const qs = new URLSearchParams(); if (c.driver_id) qs.set("driver_id", c.driver_id); if (c.gpsno) qs.set("gpsno", c.gpsno); if (c.as_of_date) qs.set("as_of_date", c.as_of_date);
    api<Pre>("/api/ai/preplan?" + qs.toString()).then((r) => setData(r)).catch(() => setData("fail"));
  };
  useEffect(() => { const h = () => { const c = parse(); setCrit(c); load(c); }; window.addEventListener("hashchange", h); load(crit); return () => window.removeEventListener("hashchange", h); }, []);
  useEffect(() => { setCrit(parse()); load(parse()); }, [crit.gpsno, crit.driver_id, crit.as_of_date]);
  const goDraft = (c: Card) => {
    const d = c.draft_entry; if (!d) return;
    if (d.kind === "tr2") { try { sessionStorage.setItem("claw_fill", JSON.stringify({ form: "tr2", driver_id: data && typeof data === "object" && data.subject ? data.subject.driver_id : "", alert_id: null, goal: "【AI04 预演携入·逐项可改，确认分配才写库】" + c.plan, note: "来自 AI04 并排预演页" })); } catch { /* ignore */ } window.dispatchEvent(new CustomEvent("claw:fill")); }
    location.hash = d.hash;
  };
  const backToEv03 = () => { const sub = data && typeof data === "object" && data.subject ? data.subject : null; if (sub) location.hash = "ev-fleet?driver_id=" + encodeURIComponent(String(sub.driver_id || sub.gpsno)) + "&tab=3"; else location.hash = "ev-fleet"; };
  return <div>
    <div className="alert warn" style={{ fontWeight: 700 }}>操作预演，未写入 —— 本页所有判断不创建/修改 alerts、interventions、training_tasks、notification_events；AI 建议与已核实事实分列，不预测事故概率或安全分变化。</div>
    <div style={{ display: "flex", gap: 6, flexWrap: "wrap", marginBottom: 8 }}>
      <input className="btn" style={{ width: 170 }} placeholder="driver_id（如 DEMO_D0149）" value={draftQ.driver_id || crit.driver_id || ""} onChange={(e) => setDraftQ({ ...draftQ, driver_id: e.target.value })} aria-label="预演对象 driver_id" />
      <input className="btn" style={{ width: 150 }} placeholder="或车辆编号" value={draftQ.gpsno ?? (crit.gpsno ? vehicleLabel(crit.gpsno) : "")} onChange={(e) => setDraftQ({ ...draftQ, gpsno: e.target.value })} aria-label="预演对象 gpsno" />
      <input className="btn" style={{ width: 140 }} placeholder="as_of_date（空=最新）" value={draftQ.as_of_date || crit.as_of_date || ""} onChange={(e) => setDraftQ({ ...draftQ, as_of_date: e.target.value })} aria-label="预演日期" />
      <button className="btn primary" style={{ width: "auto" }} onClick={() => { const c: Record<string, string> = {}; if (draftQ.driver_id) c.driver_id = draftQ.driver_id; else if (draftQ.gpsno) c.gpsno = vehicleId(draftQ.gpsno); else if (crit.gpsno) c.gpsno = crit.gpsno; if (draftQ.as_of_date) c.as_of_date = draftQ.as_of_date; setCrit(c); }}>切换对象/日期并重新验权（清空旧证据）</button>
      <button className="btn" onClick={backToEv03}>← 返回 EV03（保留对象与管理动作为主标签）</button>
      <button className="btn" onClick={() => { const sub = data && typeof data === "object" && data.subject ? data.subject : null; window.dispatchEvent(new CustomEvent("claw:ai-preset", { detail: { prompt: "AI04 三种管理路径并排预演：" + (sub ? `${sub.driver_id}（${sub.gpsno}，as_of ${sub.as_of_date}，版本 ${sub.source_version}）` : "当前对象") + "，调用 action_preplan，只预演不写入" } })); }}>让 AI 预演三路径（对话侧栏，走既有工具与审计）</button>
    </div>
    {data === "loading" && <div className="meta">按可信会话组装中（URL 参数只作查询条件，角色/车队一律以服务端会话为准）…</div>}
    {data === "fail" && <div className="alert warn">预演组装失败：会话或查询异常（不展示旧数据冒充）</div>}
    {data && data !== "fail" && typeof data === "object" && data.data_status !== "ok" && <div className="alert info">{data.data_status === "no_data_for_date" ? String(data.note) : data.data_status === "not_found" ? "对象不存在或不在你的授权范围（与不存在同语义，不泄漏）" : String(data.note || "无数据")}</div>}
    {data && data !== "loading" && typeof data === "object" && data.data_status === "ok" && <>
      <div className="meta" style={{ marginBottom: 6 }}>对象：{String(data.subject?.driver_id)} · {vehicleLabel(data.subject?.gpsno)} · as_of {String(data.subject?.as_of_date)} · {String(data.subject?.source_version)} · {String(data.facts_status)}</div>
      <div style={{ display: "grid", gridTemplateColumns: "repeat(3, 1fr)", gap: 10, alignItems: "start" }}>
        {data.cards.map((c) => <div key={c.key} className="task-card" style={{ padding: 10, borderColor: c.highlight ? "#d48806" : c.actionable ? "#2f5496" : "#ddd", background: c.highlight ? "#fffbe6" : c.actionable ? undefined : "#fafafa" }}>
          <div className="t">{c.title}{c.highlight ? <span className="tag amber" style={{ marginLeft: 6 }}>优先</span> : null} <span className="meta" style={{ fontWeight: 400 }}>方案预演 · 未写入</span></div>
          <div className="meta" style={{ margin: "4px 0" }}>{c.plan}</div>
          <div className="t" style={{ fontSize: 12 }}>建议依据（真实 record_id，点击回源重验权）</div>
          {c.basis.map((bb) => <div key={bb.table + bb.record_id} className="meta" style={{ fontSize: 11.5, margin: "2px 0" }}>· {bb.label}：<b>{bb.record_id}</b>
            {bb.ref ? <> <button className="btn" style={{ padding: "0 6px", fontSize: 10.5 }} onClick={async () => { try { const rr = await aiEvidenceCheck(String(bb.ref)); if (rr.ok && rr.route) { location.hash = String(rr.route).replace(/^#/, ""); setChk("重新验权通过：" + String(bb.ref)); } else setChk("该依据重新验权未通过或已变化（不缓存旧证据）"); } catch { setChk("验权失败"); } }}>↗ 回源</button></> : null}
            <div className="meta" style={{ paddingLeft: 10 }}>{bb.note}</div>
          </div>)}
          <div style={{ marginTop: 6, fontSize: 12.5 }}>拟处理对象：本对象本人{c.key === "verify" ? "（设备/数据核验）" : c.key === "communicate" ? "（RM03 人工沟通）" : "（TR02 培训分配）"}</div>
          <div style={{ fontSize: 12.5 }}>责任人 / 确认操作者：<b>{c.operator}</b></div>
          <div className="meta">预计业务待办：{c.todos}</div>
          <div className="meta">所缺条件：{c.missing.length ? c.missing.join("；") : "无"}</div>
          <div className="meta">数据限制：{c.limits}</div>
          <div style={{ marginTop: 6 }}>
            {c.actionable && c.draft_entry
              ? <button className="btn primary" style={{ width: "auto" }} onClick={() => goDraft(c)}>{c.draft_entry.label} →</button>
              : <button className="btn" disabled>{c.disabled_reason || "本卡无草稿入口"}</button>}
          </div>
        </div>)}
      </div>
      {chk && <div className="alert info">{chk}</div>}
      <p className="meta">{String(data.ai_note)}</p>
    </>}
  </div>;
}
