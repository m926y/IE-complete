import { useEffect, useState } from 'react';
import { api, ApiError, getData } from './api';
import { vehicleLabel } from './vehicles';
type Account={user_id:string;username:string;display_name:string;role:string;account_status:string;driver_id:string|null;binding_verified:boolean};
type Binding={binding_id:string;user_id:string;driver_id:string|null;account_status:string;effective_start:string|null;effective_end:string|null;platform_user_id:string|null};
export function BindingsConsole({drivers}:{drivers:{driver_id:string;gpsno:string}[]}) {
  const [duty,setDuty]=useState<any[]>([]),[at,setAt]=useState(''),[start,setStart]=useState(''),[end,setEnd]=useState(''),[note,setNote]=useState('');
 const [accounts,setAccounts]=useState<Account[]>([]),[history,setHistory]=useState<Binding[]>([]);
  const [user,setUser]=useState(new URLSearchParams(location.hash.split('?')[1]||'').get('user_id')||'');
  const [gps,setGps]=useState(''),[busy,setBusy]=useState(false),[loading,setLoading]=useState(true);
  const [error,setError]=useState(''),[notice,setNotice]=useState('');
  const vehicle=(id:string|null)=>drivers.find(d=>d.driver_id===id)?.gpsno;
  const name=(id:string)=>{const a=accounts.find(x=>x.user_id===id);return a?`${a.driver_id?vehicleLabel(vehicle(a.driver_id)).replace("车辆","司机"):a.username}（${a.username}）`:'已移除账号';};
  const selected=accounts.find(a=>a.user_id===user);
  async function load(){
    const association=await api<{accounts:Account[]}>('/api/admin/driver-accounts');setAccounts(association.accounts);
    const r=await api<{rows:Binding[]}>('/api/admin/bindings');setHistory(r.rows);setLoading(false);
  }
  useEffect(()=>{load().catch(()=>{setError('绑定信息读取失败');setLoading(false);});},[]);
  async function save(id:string,vehicleGps:string|null){
    setBusy(true);setError('');setNotice('');
    try{await api('/api/admin/vehicle-binding',{method:'POST',body:JSON.stringify({user_id:id,gpsno:vehicleGps})});await load();setNotice(vehicleGps?'司机与车辆已绑定':'已解除绑定，司机的数据访问权限已同步更新');}
    catch(e){const code=e instanceof ApiError?e.code:'';setError(code==='vehicle_already_bound'?'该车辆已绑定其他司机，请先解除原绑定':code==='active_driver_account_required'?'请选择已启用的司机账号':code==='vehicle_not_imported_or_ambiguous'?'该车辆不可绑定，请检查数据映射':'保存失败，请检查权限或稍后重试');}
    finally{setBusy(false);}
  }
  return <div className="stack">
    {notice&&<div className="alert info" role="status">{notice}</div>}{error&&<div className="alert warn" role="alert">{error}</div>}
    <section className="panel stack"><h3>绑定司机与车辆</h3>
      <div className="row data-filters"><label>司机账号<select className="btn" aria-label="司机账号" value={user} onChange={e=>{setUser(e.target.value);const a=accounts.find(x=>x.user_id===e.target.value);setGps(vehicle(a?.driver_id||null)||'');}}><option value="">请选择司机账号</option>{accounts.filter(a=>a.account_status==='active').map(a=><option key={a.user_id} value={a.user_id}>{name(a.user_id)}</option>)}</select></label>
      <label>车辆<select className="btn" aria-label="绑定车辆" value={gps} onChange={e=>setGps(e.target.value)}><option value="">请选择车辆</option>{drivers.map(d=><option key={d.driver_id} value={d.gpsno}>{vehicleLabel(d.gpsno)}</option>)}</select></label>
      <button className="btn primary" disabled={busy||!user||!gps} onClick={()=>save(user,gps)}>{busy?'保存中…':selected?.driver_id?'更换绑定车辆':'确认绑定'}</button></div>
      <p className="meta">绑定即时生效，用于控制司机账号可查看的车辆数据；更换车辆保留原车辆历史记录。</p>
    </section>
    <section className="panel stack"><h3>历史当班司机记录</h3><p className="meta">时间按北京时间填写，开始包含、结束不包含。解绑和换绑自动留档；未知历史不按当前绑定猜测。</p><div className="row"><label>查询时点<input type="datetime-local" value={at} onChange={e=>setAt(e.target.value)}/></label><button className="btn" onClick={async()=>{try{const r=await api<{rows:any[]}>('/api/admin/duty-history?'+new URLSearchParams({...gps?{gpsno:gps}:{},...at?{at:at+':00+08:00'}:{}}));setDuty(r.rows)}catch{setError('查询失败，请检查时间和权限')}}}>查询当班记录</button></div><table className="tbl"><thead><tr><th>司机</th><th>车辆</th><th>开始</th><th>结束</th><th>依据</th></tr></thead><tbody>{duty.map(r=><tr key={r.id}><td>{name(r.user_id)}</td><td>车辆{r.display_no}</td><td>{new Date(r.start_at).toLocaleString('zh-CN')}</td><td>{r.end_at?new Date(r.end_at).toLocaleString('zh-CN'):'持续有效'}</td><td>{r.note}</td></tr>)}</tbody></table><details><summary>补录已核实的历史当班</summary><p>使用上方选择的司机和车辆；补录不会修改当前绑定。</p><label>开始<input type="datetime-local" value={start} onChange={e=>setStart(e.target.value)}/></label><label>结束<input type="datetime-local" value={end} onChange={e=>setEnd(e.target.value)}/></label><input placeholder="核验依据（必填）" value={note} onChange={e=>setNote(e.target.value)}/><button className="btn" disabled={busy||!user||!gps||!start||!end||!note.trim()} onClick={async()=>{setBusy(true);try{await api('/api/admin/duty-history',{method:'POST',body:JSON.stringify({user_id:user,gpsno:gps,start_at:start+':00+08:00',end_at:end+':00+08:00',note})});setNotice('历史当班已保存，当前绑定不变')}catch{setError('保存失败：请检查时间重叠、核验依据或权限')}finally{setBusy(false)}}}>保存历史当班</button></details></section>
    <section className="panel"><h3>司机与车辆</h3>{loading?<p>加载中…</p>:<table className="tbl"><thead><tr><th>司机账号</th><th>当前车辆</th><th>状态</th><th>操作</th></tr></thead><tbody>{accounts.map(a=><tr key={a.user_id}><td>{name(a.user_id)}</td><td>{a.driver_id?vehicleLabel(vehicle(a.driver_id)):'未绑定'}</td><td>{a.account_status!=='active'?'账号停用':a.binding_verified?'已核实':'未绑定 / 待核实'}</td><td><button className="btn" onClick={()=>{setUser(a.user_id);setGps(vehicle(a.driver_id)||'');}}>选择车辆</button>{a.driver_id&&<button className="btn" disabled={busy} onClick={()=>save(a.user_id,null)}>解除绑定</button>}</td></tr>)}</tbody></table>}</section>
    <details className="panel"><summary>历史绑定（{history.filter(r=>r.account_status!=='active').length}）</summary><table className="tbl"><thead><tr><th>司机账号</th><th>车辆</th><th>开始</th><th>结束</th></tr></thead><tbody>{history.filter(r=>r.account_status!=='active').map(r=><tr key={r.binding_id}><td>{name(r.user_id)}</td><td>{vehicleLabel(vehicle(r.driver_id))}</td><td>{r.effective_start?.slice(0,19)||'原有绑定'}</td><td>{r.effective_end?.slice(0,19)||'—'}</td></tr>)}</tbody></table></details>
  </div>;
}
