import { LevelRatioControl } from "./overview-controls";
import { vehicleLabel } from "./vehicles";
import type {ReactNode} from "react";
import { useEffect, useState, useRef } from "react";
import { getData, getOverview } from "./api";
import type { OverviewResult } from "./api";
import { EmptyState, Tag } from "./ui";

type Row = Record<string, unknown>;
const levels = ["A", "B", "C", "D"];
const colors = ["#a78ad3", "#c2abe5", "#deb25e", "#d67b85"];

function ChartEntrance({className,children}:{className:string;children:ReactNode}){
 const node=useRef<HTMLElement>(null),[visible,setVisible]=useState(false);
 useEffect(()=>{if(!node.current)return;const observer=new IntersectionObserver(entries=>{if(entries.some(e=>e.isIntersecting)){setVisible(true);observer.disconnect()}},{threshold:.15});observer.observe(node.current);return()=>observer.disconnect()},[]);
 return <section ref={node} className={className+' overview-chart-entrance'+(visible?' chart-visible':'')}>{children}</section>;
}

export function Dashboard({canEdit=false}:{canEdit?:boolean}) {
  const [overview, setOverview] = useState<OverviewResult | null>(null);
  const [scores, setScores] = useState<Row[] | null>(null);
  const [failed, setFailed] = useState(false);
  useEffect(() => {
    let active = true;
    getOverview().then(r => { if (active) setOverview(r); }).catch(() => { if (active) setFailed(true); });
    (async () => {
      const latest = await getData<Row>("admin.score_snapshots", { limit: 1, order: "as_of_date.desc" });
      const date = latest.rows[0]?.as_of_date;
      if (!date) { if (active) setScores([]); return; }
      const rows: Row[] = [];
      for (let offset = 0; ; offset += 200) {
        const page = await getData<Row>("admin.score_snapshots", { limit: 200, offset, as_of_date: String(date) });
        rows.push(...page.rows);
        if (page.rows.length < 200) break;
      }
      if (active) setScores(rows);
    })().catch(() => { if (active) setFailed(true); });
    return () => { active = false; };
  }, []);
  if (failed) return <EmptyState kind="error" onRetry={() => location.reload()} />;
  if (!overview || !scores) return <EmptyState kind="loading" />;
  const valid = scores.filter(r => ["usable", "usable_with_review", "manual_review"].includes(String(r.score_status)) && r.safety_score !== null && Number.isFinite(Number(r.safety_score)));
  const average = valid.length ? (valid.reduce((n, r) => n + Number(r.safety_score), 0) / valid.length).toFixed(2) : "—";
  const distribution = levels.map(level => valid.filter(r => r.risk_level === level).length);
  let cumulative = 0;
  const stops = distribution.map((n, i) => { const start = cumulative; cumulative += valid.length ? n / valid.length * 100 : 0; return `${colors[i]} ${start}% ${cumulative}%`; });
  const metrics = [
    { label: "评分车辆", value: scores.length || "—", note: "辆", tone: "", route: "ev-fleet" },
    { label: "平均安全分", value: average, note: "近 14 天", tone: "featured", route: "ev-fleet?trend=1" },
    { label: "D 级车辆", value: distribution[3], note: "辆", tone: "", route: "ev-fleet?level=D" },
    { label: "低可信度车辆", value: scores.filter(r => r.confidence_level === "low").length, note: "辆", tone: "", route: "ev-fleet?level=conf" },
  ];
  const dimensions = [["history", "历史事故与未遂"], ["fatigue_distraction", "疲劳与分心"], ["driving_stability", "驾驶稳定性"], ["road_rule", "道路规则"], ["management", "管理配合度"], ["imu_evidence", "IMU 风险佐证"]].map(([key, label]) => ({ key, label, value: valid.length ? valid.reduce((n, r) => n + Number(r[key + "_contribution"] || 0), 0) / valid.length : 0 }));
  const dimensionMax = Math.max(...dimensions.map(d => d.value), 1);
  const review = [...scores].filter(r => r.safety_score !== null).sort((a, b) => Number(a.safety_score) - Number(b.safety_score)).slice(0, 6);
  return <div className="dashboard">
    <div className="dashboard-heading"><div><h1>车队运行总览</h1></div><span className="date-label">数据截止 <b>{overview.asOfDate || "—"}</b></span></div>
    <div className="dashboard-context"><span>评分窗口 <b>近 14 天</b></span><span>统计周期 <b>{String(scores[0]?.window_start || "—")} — {String(scores[0]?.as_of_date || "—")}</b></span></div>
    <div className="dashboard-metrics">{metrics.map(m => <a href={`#/${m.route}`} className={`dashboard-metric ${m.tone}`} key={m.label}><span className="metric-label">{m.label}</span><strong>{m.value}</strong><span className="metric-note">{m.note}<span>↗</span></span></a>)}</div>
    <div className="dashboard-charts">
      <ChartEntrance className="panel distribution-panel"><div className="panel-title"><h3>安全评分分布</h3><a href="#/ev-fleet">查看车队 ↗</a></div><div className="distribution-body"><div className="distribution-ring" role="img" aria-label={scores.length ? levels.map((level, i) => `${level}级${distribution[i]}辆`).join("，") : "暂无评分数据"} style={{ background: valid.length ? `conic-gradient(${stops.join(",")})` : "var(--line)" }}><div><b>{valid.length || "—"}</b><span>评分车辆</span></div></div><div className="distribution-legend">{levels.map((l, i) => <div key={l}><span className="legend-dot" style={{ background: colors[i] }} /><span>{l} 级</span><b>{scores.length ? distribution[i] : "—"}</b><small>{valid.length ? Math.round(distribution[i] / valid.length * 100) + "%" : "—"}</small></div>)}</div></div>{canEdit&&<LevelRatioControl />}</ChartEntrance>
      <ChartEntrance className="panel dimension-panel"><div className="panel-title"><h3>各维度平均扣分</h3><span className="unit-label">单位：分</span></div><div className="dimension-chart">{dimensions.map((d,index) => <div key={d.key} style={{animationDelay:`${index*65}ms`}}><span>{d.label}</span><div className="dimension-track"><i style={{ width: `${d.value / dimensionMax * 100}%` }} /></div><b>{valid.length ? d.value.toFixed(2) : "—"}</b></div>)}</div></ChartEntrance>
    </div>
    <section className="panel dashboard-table"><div className="panel-title"><h3>评分关注对象 </h3><a href="#/ev-fleet">全部记录 ↗</a></div><div className="table-wrap"><table><thead><tr><th>车辆</th><th>安全分</th><th>等级</th><th>可信度</th><th>主要风险维度</th><th /></tr></thead><tbody>{review.map(r => <tr key={String(r.score_id)}><td className="mono">{vehicleLabel(r.gpsno)}</td><td className="score-cell">{Number(r.safety_score).toFixed(2)}</td><td><Tag tone={r.risk_level === "D" ? "red" : "amber"}>{String(r.risk_level)}</Tag></td><td><Tag tone={r.confidence_level === "low" ? "amber" : "green"}>{r.confidence_level === "high" ? "高" : r.confidence_level === "low" ? "低 · 先核验" : String(r.confidence_level)}</Tag></td><td>{{ history: "历史事故与未遂", fatigue_distraction: "疲劳与分心", driving_stability: "驾驶稳定性", road_rule: "道路规则", management: "管理配合", imu_evidence: "IMU 证据" }[String(r.primary_risk_dimension)] || String(r.primary_risk_dimension || "—")}</td><td><a href={`#/ev-fleet?gpsno=${encodeURIComponent(String(r.gpsno))}`}>查看明细 →</a></td></tr>)}</tbody></table>{!review.length && <EmptyState kind="nomatch" hint="" />}</div></section>
  </div>;
}
