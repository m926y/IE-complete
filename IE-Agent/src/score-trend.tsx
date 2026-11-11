import { useEffect, useId, useState } from 'react';
import { ApiError, getData } from './api';
import { vehicleLabel } from './vehicles';
import { trendGeometry, trendPoints } from './score-trend-data';
import type { TrendRow } from './score-trend-data';
import './score-trend.css';

const confidence = (value?: string) => ({ high: '高', medium: '中', low: '低' }[value || ''] || '未提供');
const versionName = (value?: string) => !value ? '未提供版本' : value.startsWith('weights-') ? `调权版本 ${value.slice(-8)}` : `原始评分 · ${value.slice(0, 24)}`;

export function VehicleScoreTrend({ gpsno }: { gpsno: string }) {
  const [open, setOpen] = useState(false), [revision, setRevision] = useState(0);
  const [rows, setRows] = useState<TrendRow[] | null>(null), [error, setError] = useState('');
  const [selected, setSelected] = useState<string | null>(null);
  const id = useId();
  useEffect(() => {
    const refresh = () => setRevision(v => v + 1);
    window.addEventListener('claw:scores-updated', refresh);
    return () => window.removeEventListener('claw:scores-updated', refresh);
  }, []);
  useEffect(() => {
    if (!open) return;
    let alive = true;
    setRows(null); setError(''); setSelected(null);
    void (async () => {
      let all: TrendRow[] = [];
      for (let offset = 0; alive; offset += 200) {
        const result = await getData<TrendRow>('admin.score_history', { gpsno, order: 'as_of_date.asc', limit: 200, offset });
        if (!alive) return;
        all = all.concat(result.rows);
        if (result.rows.length < 200) { setRows(all); return; }
      }
    })().catch(e => {
      if (alive) setError(e instanceof ApiError && (e.status === 403 || e.status === 401) ? '当前账号无法查看该车辆的评分趋势，请检查登录状态或权限。' : '评分历史暂时无法读取，请重试。');
    });
    return () => { alive = false; };
  }, [open, gpsno, revision]);

  const points = trendPoints(rows || [], gpsno), valid = points.filter(p => p.score !== null);
  const first = valid[0], last = valid.at(-1);
  const versions = [...new Set(points.map(p => p.source_version || ''))];
  const sameVersion = versions.length === 1 && Boolean(versions[0]);
  const delta = first && last && sameVersion ? last.score! - first.score! : null;
  const chart = trendGeometry(points), active = valid.find(p => p.score_id === selected) || last;
  const tickStep = Math.max(1, Math.ceil(points.length / 8));
  return <section className="panel vehicle-score-trend" aria-label={`${vehicleLabel(gpsno)}评分趋势`}>
    <div className="panel-title"><h3>{vehicleLabel(gpsno)} · 评分趋势</h3><button className="btn" aria-expanded={open} aria-controls={id} onClick={() => setOpen(v => !v)}>{open ? '收起趋势' : '查看趋势'}</button></div>
    {open && <div id={id}>
      {error ? <div className="alert warn" role="alert">{error}<button className="btn" onClick={() => setRevision(v => v + 1)}>重试</button></div>
        : rows === null ? <p role="status">正在读取评分历史…</p>
        : !valid.length ? <p role="status">暂无可绘制的有效评分历史。</p>
        : <>
          <div className="trend-metrics">
            <div><span>最近有效评分</span><b>{last!.score!.toFixed(2)}<small> 分</small></b></div>
            <div><span>期间变化</span><b>{delta === null ? '口径有变' : valid.length === 1 ? '仅一期' : `${delta >= 0 ? '+' : ''}${delta.toFixed(2)}`}<small>{delta !== null && valid.length > 1 ? ' 分' : ''}</small></b></div>
            <div><span>历史记录</span><b>{points.length}<small> 期</small></b></div>
          </div>
          <div className="trend-period">{points[0].as_of_date} — {points.at(-1)!.as_of_date} · 满分 100</div>
          <div className="trend-chart-scroll">
            <svg className="trend-chart" viewBox="0 0 760 254" role="group" aria-label={`${vehicleLabel(gpsno)}历史安全评分折线图，纵轴0到100分，横轴为评分日期`}>
              {[0, 25, 50, 75, 100].map(value => { const y = chart.bottom - value / 100 * (chart.bottom - chart.top); return <g key={value}><line x1={chart.left} x2={chart.right} y1={y} y2={y} className="trend-grid"/><text x={chart.left - 12} y={y + 4} textAnchor="end">{value}</text></g>; })}
              {chart.segments.map((s, i) => <polyline key={i} points={s.map(p => `${p.x},${p.y}`).join(' ')} className="trend-line"/>)}
              {chart.coords.map((p, i) => <g key={p.score_id}>
                {(i % tickStep === 0 || i === points.length - 1) && <text x={p.x} y="242" textAnchor="middle">{p.as_of_date.slice(5)}</text>}
                {p.y !== null && <circle cx={p.x} cy={p.y} r={active?.score_id === p.score_id ? 6 : 4.5} className={p.confidence_level === 'low' ? 'trend-dot low' : 'trend-dot'} tabIndex={0} role="button" aria-label={`${p.as_of_date}，${p.score!.toFixed(2)}分，${p.risk_level || '未提供'}级，可信度${confidence(p.confidence_level)}`} onMouseEnter={() => setSelected(p.score_id)} onFocus={() => setSelected(p.score_id)} onClick={() => setSelected(p.score_id)} onKeyDown={e => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); setSelected(p.score_id); } }}><title>{p.as_of_date} · {p.score!.toFixed(2)} 分 · {p.risk_level || '—'}级 · 可信度{confidence(p.confidence_level)}</title></circle>}
              </g>)}
            </svg>
          </div>
          {active && <div className="trend-detail" aria-live="polite"><b>{active.as_of_date}</b><span>安全分 {active.score!.toFixed(2)}</span><span>等级 {active.risk_level || '—'}</span><span className={active.confidence_level === 'low' ? 'trend-low' : ''}>可信度 {confidence(active.confidence_level)}</span></div>}
          <p className="meta trend-caption">点击或悬停数据点查看详情。{points.some(p => p.confidence_level === 'low') ? '橙色点表示低可信度。' : ''}{points.length > valid.length ? `${points.length - valid.length}期评分不可用，已保留断点。` : ''}</p>
          <details><summary>查看历史明细</summary><div className="table-wrap"><table><thead><tr><th>日期</th><th>安全分</th><th>等级</th><th>可信度</th></tr></thead><tbody>{points.map(p => <tr key={p.score_id}><td>{p.as_of_date}</td><td>{p.score === null ? '—' : p.score.toFixed(2)}</td><td>{p.risk_level || '—'}</td><td>{confidence(p.confidence_level)}</td></tr>)}</tbody></table></div></details>
        </>}
    </div>}
  </section>;
}
