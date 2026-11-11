export type TrendRow = {
  score_id: string; gpsno: string; as_of_date: string;
  safety_score: number | string | null; risk_level?: string;
  confidence_level?: string; source_version?: string;
};
export type TrendPoint = TrendRow & { time: number; score: number | null };

export function trendPoints(rows: TrendRow[], gpsno: string): TrendPoint[] {
  return rows.filter(r => String(r.gpsno) === gpsno && /^\d{4}-\d{2}-\d{2}$/.test(r.as_of_date))
    .flatMap(r => {
      const time = Date.parse(r.as_of_date + 'T00:00:00Z');
      if (!Number.isFinite(time) || new Date(time).toISOString().slice(0, 10) !== r.as_of_date) return [];
      const value = r.safety_score;
      const numeric = typeof value === 'number' || (typeof value === 'string' && value.trim() !== '') ? Number(value) : NaN;
      return [{ ...r, time, score: Number.isFinite(numeric) && numeric >= 0 && numeric <= 100 ? numeric : null }];
    }).sort((a, b) => a.time - b.time || a.score_id.localeCompare(b.score_id));
}

export function trendGeometry(points: TrendPoint[]) {
  const left = 48, right = 728, top = 22, bottom = 218;
  const first = points[0]?.time ?? 0, last = points.at(-1)?.time ?? first;
  const coords = points.map(p => ({ ...p,
    x: last === first ? (left + right) / 2 : left + (p.time - first) / (last - first) * (right - left),
    y: p.score === null ? null : bottom - p.score / 100 * (bottom - top),
  }));
  const segments: typeof coords[] = [];
  for (const p of coords) {
    if (p.y === null) { segments.push([]); continue; }
    let segment = segments.at(-1);
    if (!segment || (segment.length && segment.at(-1)?.source_version !== p.source_version)) { segment = []; segments.push(segment); }
    segment.push(p);
  }
  return { coords, segments: segments.filter(s => s.length), left, right, top, bottom };
}
