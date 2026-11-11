import test from 'node:test';
import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import { fileURLToPath } from 'node:url';
import { trendGeometry, trendPoints } from '../src/score-trend-data.ts';

const row = (date, score, extra={}) => ({score_id:date,gpsno:'v1',as_of_date:date,safety_score:score,source_version:'v0',...extra});
test('Trend orders real dates, scopes to one vehicle and keeps missing scores distinct from zero',()=>{
  const points=trendPoints([row('2026-07-31',0),row('2026-07-10',null),row('2026-07-01',70),row('2026-07-20',''),row('2026-07-21',101),row('2026-02-31',80),row('2026-07-01',99,{gpsno:'v2'})],'v1');
  assert.deepEqual(points.map(p=>p.score),[70,null,null,null,0]);
  assert.equal(points[0].as_of_date,'2026-07-01');
  const chart=trendGeometry(points);
  assert.equal(chart.segments.length,2);
  assert(chart.segments.every(s=>s.length===1));
  assert.equal(chart.coords.at(-1).y,chart.bottom);
});
test('Plot uses elapsed time and a fixed 0–100 scale, with gaps between scoring versions',()=>{
  const points=trendPoints([row('2026-07-01',0),row('2026-07-02',50),row('2026-07-11',100,{source_version:'v1'})],'v1');
  const chart=trendGeometry(points);
  assert.equal(chart.coords[0].x,chart.left);
  assert.equal(chart.coords[1].x,chart.left+(chart.right-chart.left)/10);
  assert.equal(chart.coords[2].x,chart.right);
  assert.equal(chart.coords[0].y,chart.bottom);
  assert.equal(chart.coords[2].y,chart.top);
  assert.deepEqual(chart.segments.map(s=>s.length),[2,1]);
  const one=trendGeometry([points[0]]);
  assert.equal(one.coords[0].x,(one.left+one.right)/2);
  assert(trendGeometry([]).segments.length===0);
});
test('All 500 current vehicles have real dated series whose latest point matches their snapshot',()=>{
  const db=new DatabaseSync(fileURLToPath(new URL('../var/platform.sqlite',import.meta.url)),{readOnly:true});
  try {
    const snapshots=db.prepare('select gpsno,as_of_date,safety_score from score_snapshots').all();
    const history=db.prepare('select * from score_history order by as_of_date').all();
    assert.equal(snapshots.length,500);
    let count=0;
    for(const snapshot of snapshots){
      const points=trendPoints(history,String(snapshot.gpsno));
      assert.equal(points.length,new Set(history.map(r=>r.as_of_date)).size);assert(points.length>=8);
      assert(points.every(p=>p.score!==null));
      assert.equal(points.at(-1).as_of_date,snapshot.as_of_date);
      assert(Math.abs(points.at(-1).score-Number(snapshot.safety_score))<1e-8);
      const chart=trendGeometry(points);
      assert(chart.coords.every(p=>Number.isFinite(p.x)&&Number.isFinite(p.y)&&p.y>=chart.top&&p.y<=chart.bottom));
      count+=points.length;
    }
    assert.equal(count,history.length);
  } finally {db.close();}
});
