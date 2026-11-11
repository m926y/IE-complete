import { useEffect, useState } from 'react';
import { api, getData } from './api';
import { EmptyState, ResourceTable, cellView } from './ui';
import { vehicleLabel, vehicleOptions } from './vehicles';

const labels: Record<string,string> = { gpsno:'车辆', driver_id:'司机',event_date:'日期',event_time:'发生时间',event_type:'事件类型',event_name:'事件名称',speed_kmh:'速度 km/h',dimension:'维度',source_rows:'原始采样条数',distance_km:'行驶里程 km',reported_run_time_hours:'运行小时',speed_mean_kmh:'平均速度',speed_max_kmh:'最高速度',gps_speed_mean:'GPS均速',gps_speed_max:'GPS最高速度',accel_norm_outlier_samples:'加速度异常采样',gyro_norm_gt20_samples:'角速度异常采样',event_count:'日志条数',energy_type:'能源类型',monthly_mileage_km:'月均里程 km',monthly_drive_hours:'月均驾驶小时',monthly_stop_count:'月均停车次数',highway_mileage_ratio:'高速里程占比',night_mileage_ratio:'夜间里程占比',coordinate_valid:'坐标有效',speed_valid:'速度有效',source_version:'来源版本' };
const kinds = {
  events: { title:'事件明细', columns:['event_time','gpsno','event_name','speed_kmh','dimension'] },
  event_daily: { title:'事件日统计', columns:['event_date','gpsno','event_name','event_count'] },
  trajectory_daily: { title:'轨迹日汇总', columns:['event_date','gpsno','source_rows','distance_km','reported_run_time_hours','speed_mean_kmh','speed_max_kmh'] },
  imu_daily: { title:'IMU 日汇总', columns:['event_date','gpsno','source_rows','gps_speed_mean','gps_speed_max','accel_norm_outlier_samples','gyro_norm_gt20_samples'] },
  profiles: { title:'车辆画像', columns:['gpsno','energy_type','monthly_mileage_km','monthly_drive_hours','monthly_stop_count','highway_mileage_ratio','night_mileage_ratio'] },
};
export function DataExplorer({ driver=false }: { driver?: boolean }) {
  const options=vehicleOptions();
  const [kind,setKind]=useState<keyof typeof kinds>('events');
  const [gps,setGps]=useState(options[0]?.gpsno||'');
  const [date,setDate]=useState('2026-07-31');
  const [selected,setSelected]=useState<Record<string,unknown>|null>(null);
  const params={...(gps?{gpsno:gps}:{}),...(kind!=='profiles'?{event_date:date}:{}),order:kind==='events'?'event_time.desc':kind==='profiles'?'gpsno.asc':'event_date.desc'};
  return <section className="panel stack">
    <div className="row data-filters">
      <label>数据类型<select className="btn" value={kind} onChange={e=>{setKind(e.target.value as keyof typeof kinds);setSelected(null);}}>{Object.entries(kinds).map(([key,v])=><option key={key} value={key}>{v.title}</option>)}</select></label>
      {!driver&&<label>车辆<select className="btn" value={gps} onChange={e=>{setGps(e.target.value);setSelected(null);}}><option value="">全部车辆</option>{options.map(v=><option key={v.gpsno} value={v.gpsno}>{v.label}</option>)}</select></label>}
      {kind!=='profiles'&&<label>日期<input className="btn" type="date" min="2026-06-01" max="2026-07-31" value={date} onChange={e=>{if(e.target.value)setDate(e.target.value);setSelected(null);}} /></label>}
    </div>
    <ResourceTable key={`${kind}:${gps}:${date}`} resource={`${driver?'my':'admin'}.${kind}`} params={params} columns={kinds[kind].columns} labels={labels} pageSize={20} rowActionLabel="详情" onRowClick={setSelected} />
    {selected&&<div className="panel"><div className="row"><h3>数据详情 · {vehicleLabel(selected.gpsno)}</h3><button className="btn" onClick={()=>setSelected(null)}>关闭</button></div><div className="kv">{Object.keys(labels).filter(k=>selected[k]!==undefined).map(k=><div key={k}><span className="meta">{labels[k]} </span><b>{cellView(k,selected[k])}</b></div>)}</div></div>}
    <p className="meta">事件条数为日志记录数，保留源文件重复记录；轨迹和 IMU 展示全量文件的日汇总。</p>
  </section>;
}

type Manifest={counts:Record<string,number>;level_counts:Record<string,number>;event_start:string;event_end:string;history_start:string;history_end:string;published_score_max_difference:number;ledger_max_difference:number};
export function DataCenter() {
  const [data,setData]=useState<Manifest|null>(null),[failed,setFailed]=useState(false);
  useEffect(()=>{api<Manifest>('/api/data-status').then(setData).catch(()=>setFailed(true));},[]);
  if(failed)return <EmptyState kind="error" hint="完整数据状态暂不可用，请检查本地数据库。"/>;
  if(!data)return <EmptyState kind="loading"/>;
  return <div className="stack data-center"><h1>数据中心</h1>
    <div className="cards">{[['drivers','车辆'],['score_snapshots','当前评分'],['score_history','历史评分'],['events','事件日志'],['trajectory_daily','轨迹日汇总'],['imu_daily','IMU 日汇总']].map(([key,title])=><div className="card" key={key}><div className="k">{title}</div><div className="v">{data.counts[key]?.toLocaleString()}</div></div>)}</div>
    <p className="meta">事件覆盖 {data.event_start} 至 {data.event_end}；评分历史 {data.history_start} 至 {data.history_end}。A/B/C/D：{['A','B','C','D'].map(k=>`${k} ${data.level_counts[k]}`).join(' · ')}。</p>
    <DataExplorer/>
  </div>;
}

export function FullReplay() {
  const options=vehicleOptions();
  const [gps,setGps]=useState(options[0]?.gpsno||''),[date,setDate]=useState('2026-07-29');
  const [rows,setRows]=useState<Record<string,unknown>[]|null>(null),[failed,setFailed]=useState(false);
  const [playing,setPlaying]=useState(false),[cursor,setCursor]=useState(0);
  useEffect(()=>{
    let alive=true;setRows(null);setFailed(false);setCursor(0);setPlaying(false);
    (async()=>{const all:Record<string,unknown>[]=[];
      for(let offset=0;;offset+=200){const r=await getData<Record<string,unknown>>('admin.events',{gpsno:gps,event_date:date,order:'event_time.asc',limit:200,offset});all.push(...r.rows);if(r.rows.length<200)break;}
      if(alive)setRows(all);
    })().catch(()=>{if(alive)setFailed(true);});return()=>{alive=false;};
  },[gps,date]);
  useEffect(()=>{if(!playing||!rows?.length)return;const timer=setInterval(()=>setCursor(c=>{if(c>=rows.length){setPlaying(false);return c;}return c+1;}),200);return()=>clearInterval(timer);},[playing,rows]);
  return <div className="stack"><h1>历史事件回放</h1><p className="meta">回放仅推进历史事件显示，不自动生成告警。</p>
    <div className="row data-filters"><label>车辆<select className="btn" value={gps} onChange={e=>setGps(e.target.value)}>{options.map(v=><option key={v.gpsno} value={v.gpsno}>{v.label}</option>)}</select></label><label>日期<input className="btn" type="date" min="2026-06-01" max="2026-07-31" value={date} onChange={e=>{if(e.target.value)setDate(e.target.value);}} /></label></div>
    {failed?<EmptyState kind="error"/>:!rows?<EmptyState kind="loading"/>:<><section className="panel"><h3>{vehicleLabel(gps)} · {date}</h3><p>已播放 {cursor} / {rows.length} 条 {cursor>0?String(rows[cursor-1]?.event_time):''}</p><div className="row"><button className="btn primary" disabled={!rows.length} onClick={()=>setPlaying(v=>!v)}>{playing?'暂停':'播放'}</button><button className="btn" onClick={()=>{setPlaying(false);setCursor(Math.min(cursor+10,rows.length));}}>前进 10 条</button><button className="btn" onClick={()=>{setPlaying(false);setCursor(0);}}>重置</button></div></section>
      <section className="panel"><table><thead><tr><th>发生时间</th><th>事件</th><th>速度 km/h</th></tr></thead><tbody>{rows.slice(Math.max(0,cursor-50),cursor).map(r=><tr key={String(r.event_id)}><td>{String(r.event_time)}</td><td>{String(r.event_name)}</td><td>{r.speed_kmh===null?'—':String(r.speed_kmh)}</td></tr>)}</tbody></table><p className="meta">展示最近播放的 50 条；完整事件可在数据中心分页查看。</p></section></>}
  </div>;
}
