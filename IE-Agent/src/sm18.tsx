import {vehicleLabel} from './vehicles';
import {ConfirmDelete} from './confirm-delete';
// R18 SM01 账号管理：列表筛选 + 编辑抽屉 + 创建/停用/恢复（复用 manage.accounts 门禁；页面永不渲染口令）
import { useEffect, useState, useRef } from "react";
import { api, accountEdit, createUser, getData, getMe, setUserStatus } from "./api";

const driverLabel=(id:unknown)=>/^D-车辆\d+$/.test(String(id))?String(id).slice(2):vehicleLabel(String(id).replace(/^D-/,""));
type Acct = Record<string, string | number | boolean | null>;

export function AccountAdminPanel({ onChanged,canCreateAdmin=true }: { onChanged?: () => void;canCreateAdmin?:boolean }) {
  const [credential, setCredential] = useState<{ username: string; password: string; userId: string; role: string } | null>(null);
  const [creating, setCreating] = useState(false);
  const [deleting, setDeleting] = useState<string | null>(null), [selfId, setSelfId] = useState('');
  const [pendingDelete, setPendingDelete] = useState<Acct | null>(null);
  const [vehicleGrades, setVehicleGrades] = useState<Record<string, {label: string; grade: string}>>({});
  const [rows, setRows] = useState<Acct[] | null>(null);
  const [msg, setMsg] = useState<string | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [fRole, setFRole] = useState(""); const [fStatus, setFStatus] = useState(""); const [fFleet, setFFleet] = useState("");
  const editRef = useRef<HTMLDivElement>(null);
  const [editing, setEditing] = useState<Acct | null>(null);
  useEffect(()=>{if(editing)editRef.current?.scrollIntoView({behavior:"smooth",block:"start"});},[editing]);
  const [eDn, setEDn] = useState(""); const [eScope, setEScope] = useState(""); const [eDriver, setEDriver] = useState(""); const [eClear, setEClear] = useState(false);
  const [username, setUsername] = useState(""); const [role, setRole] = useState("driver"); const [dn, setDn] = useState("");
  async function create() {
    setCreating(true); setErr(null); setCredential(null); setMsg(null);
    try {
      const r = await createUser({ username, display_name: dn || username, role, reveal_password: true });
      setCredential({ username: r.username, password: r.initial_password, userId: r.user_id, role: r.role });
      setUsername(""); setDn(""); await reload();
    } catch (e) { setErr(e instanceof Error && e.message === "username_exists" ? "该用户名已存在" : "创建失败，请检查用户名或稍后重试"); }
    finally { setCreating(false); }
  }
  async function reload() { try { const all: Acct[] = []; for (let offset = 0; ; offset += 200) { const r = await getData<Acct>("admin.accounts", { limit: 200, offset }); all.push(...r.rows); if (r.rows.length < 200) break; } setRows(all); onChanged?.(); } catch { setErr("账号列表读取失败"); } }
  useEffect(() => { reload(); const refresh=()=>{void reload();};window.addEventListener("claw:agent-applied",refresh);return()=>window.removeEventListener("claw:agent-applied",refresh); }, []);
  useEffect(() => { let alive=true; void getMe().then(r=>{if(alive)setSelfId(r?.user?.userId||'')}); async function all(resource:string){const out:Acct[]=[];for(let offset=0;;offset+=200){const r=await getData<Acct>(resource,{limit:200,offset});out.push(...r.rows);if(r.rows.length<200)break}return out} void Promise.all([all('admin.drivers'),all('admin.score_snapshots')]).then(([drivers,scores])=>{const grades=new Map(scores.sort((a,b)=>String(a.as_of_date||'').localeCompare(String(b.as_of_date||''))).map(s=>[String(s.gpsno),String(s.risk_level||'未评级')]));if(alive)setVehicleGrades(Object.fromEntries(drivers.map(d=>[String(d.driver_id),{label:vehicleLabel(d.gpsno),grade:grades.get(String(d.gpsno))||'未评级'}])))}).catch(()=>{});return()=>{alive=false}; }, []);
  const filtered = (rows || []).filter((r) => (!fRole || r.role === fRole) && (!fStatus || r.account_status === fStatus) && (!fFleet || String(r.fleet_scope || "").toLowerCase().includes(fFleet.toLowerCase())));
  function openEdit(a: Acct) { setEditing(a); setEDn(String(a.display_name || "")); setEScope(String(a.fleet_scope || "*")); setEDriver(String(a.driver_id || "")); setEClear(false); setErr(null); }
  async function saveEdit() {
    if (!editing) return;
    const b: Record<string, unknown> = {};
    if (String(editing.display_name || "") !== eDn) b.display_name = eDn;
    if (String(editing.fleet_scope || "*") !== eScope) b.fleet_scope = eScope;
    if (eClear) b.clear_binding = true; else if (String(editing.driver_id || "") !== eDriver) b.driver_id = eDriver;
    if (!Object.keys(b).length) { setMsg("无字段变化"); return; }
    try { await accountEdit(String(editing.user_id), b); setMsg("账号信息已更新"); setEditing(null); await reload(); }
    catch (e) { setErr("编辑被拒：" + (e instanceof Error ? e.message : "?")); }
  }
  async function status(a: Acct, next: string) {
    try { const r = await setUserStatus(String(a.user_id), next); setMsg(r.account_status === "active" ? "账号已启用" : "账号已停用"); await reload(); }
    catch (e) { setErr("状态操作被拒：" + (e instanceof Error ? e.message : "?")); }
  }
  async function remove(a: Acct) {
    setDeleting(String(a.user_id)); setErr(null); setMsg(null);
    try { await api('/api/admin/users/'+encodeURIComponent(String(a.user_id)), {method:'DELETE'}); if(editing?.user_id===a.user_id)setEditing(null); if(credential?.userId===a.user_id)setCredential(null); await reload(); setMsg('账号已删除，登录会话已清除。'); }
    catch(e) { const reasons:Record<string,string>={cannot_delete_self:'不能删除当前登录账号',cannot_delete_admin:'仅管理员可删除管理员账号',cannot_delete_last_admin:'需保留至少一个启用的管理员',out_of_fleet_scope:'该账号不在当前管理范围内'};setErr(reasons[e instanceof Error?e.message:'']||'删除未完成，请刷新后重试。'); }
    finally { setDeleting(null); }
  }
  return <div>
    {pendingDelete && <ConfirmDelete title={`删除账号「${pendingDelete.username}」`} onCancel={()=>setPendingDelete(null)} onConfirm={()=>{const target=pendingDelete;setPendingDelete(null);void remove(target);}}>该账号将无法登录，现有登录会话会被清除。历史培训和操作记录保留。</ConfirmDelete>}
    {credential && <section className="panel credential-card" role="status"><h3>账号已创建</h3><p>请安全交付以下登录信息；首次登录需要更换密码。</p>
      <label className="field">用户名<input value={credential.username} readOnly /></label>
      <label className="field">初始密码<input value={credential.password} readOnly aria-label="新账号初始密码" /></label>
      <div className="row">{credential.role === "driver" && <a className="btn" href={`#/sm-bindings?user_id=${encodeURIComponent(credential.userId)}`}>核实司机身份 →</a>}<button className="btn primary" onClick={async () => { try { await navigator.clipboard.writeText(`用户名：${credential.username}\n初始密码：${credential.password}`); setMsg("登录信息已复制"); } catch { setMsg("请选中上方登录信息进行复制"); } }}>复制登录信息</button><button className="btn" onClick={() => { setCredential(null); setMsg(null); }}>已交付，关闭</button></div>
    </section>}
    {err && <div className="alert warn">{err}</div>}
    {msg && <div className="alert info">{msg}</div>}
    <div className="task-card" style={{ padding: 8, marginBottom: 8 }}>
      <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
        <select className="btn" style={{ width: "auto" }} value={fRole} onChange={(e) => { setFRole(e.target.value); }} aria-label="筛选角色"><option value="">角色·全部</option><option value="safety_admin">管理员</option><option value="safety_officer">安全员</option><option value="team_leader">队长</option><option value="driver">司机</option></select>
        <select className="btn" style={{ width: "auto" }} value={fStatus} onChange={(e) => setFStatus(e.target.value)} aria-label="筛选状态"><option value="">状态·全部</option><option value="active">已启用</option><option value="disabled">已停用</option></select>
        <input className="btn" style={{ width: 150 }} placeholder="车队筛选" value={fFleet} onChange={(e) => setFFleet(e.target.value)} aria-label="车队筛选" />
        <span className="meta">当前可管理账号 · {filtered.length}/{(rows || []).length}{rows ? "" : " 加载中…"}</span><button className="btn" disabled={!!deleting} onClick={()=>void reload()}>刷新账号</button>
      </div>
    </div>
    <p className="meta">删除途径：在账号行右侧点击「删除账号」并确认。当前登录账号不可删除；删除保留历史业务记录。</p>
    <div className="table-wrap"><table className="tbl"><thead><tr><th>平台用户 / 显示名</th><th>角色</th><th>状态</th><th>司机绑定 / 车辆评级</th><th>车队范围</th><th>更新</th><th>操作</th></tr></thead>
      <tbody>{filtered.map((a) => <tr key={String(a.user_id)}>
        <td><b>{String(a.username)}</b><div className="meta">{a.role==="driver" ? (a.driver_id ? driverLabel(a.driver_id).replace("车辆","司机") : "未绑定司机") : String(a.display_name || "—")}</div></td>
        <td>{a.role === "driver" ? "司机" : a.role === "safety_admin" ? "管理员" : a.role==="safety_officer"?"安全员":"队长"}</td>
        <td><span style={{ fontSize: 11, padding: "1px 6px", borderRadius: 6, ...(a.account_status === "active" ? { background: "#e6f4ea", color: "#1a6b2a" } : { background: "#fdecaa", color: "#8a2b0b" }) }}>{a.account_status === "active" ? "已启用" : "已停用"}</span></td>
        <td>{a.driver_id ? <>{vehicleGrades[String(a.driver_id)]?.label||driverLabel(a.driver_id)}{a.binding_verified ? '' : '（待核实）'}<div className="meta">车辆评级：{vehicleGrades[String(a.driver_id)]?.grade||'读取中'}</div></> : "—"}</td>
        <td>{a.fleet_scope === "*" ? "全部车队" : a.fleet_scope === "fleet-local" ? "当前车队" : String(a.fleet_scope || "—")}</td>
        <td className="meta">{String(a.updated_at || "").slice(0, 16)}</td>
        <td style={{ whiteSpace: "nowrap" }}>
          <button className="btn" style={{ padding: "2px 8px" }} onClick={() => openEdit(a)}>编辑</button>{" "}
          {a.account_status === "active" ? <button className="btn" style={{ padding: "2px 8px" }} onClick={() => status(a, "disabled")}>停用</button> : <button className="btn" style={{ padding: "2px 8px" }} onClick={() => status(a, "active")}>恢复</button>}
          {' '}<button className="btn task-delete" style={{padding:'2px 8px',color:'#a04f71'}} disabled={!!deleting||String(a.user_id)===selfId||(!canCreateAdmin&&a.role==='safety_admin')} title={String(a.user_id)===selfId?'不能删除当前登录账号':undefined} onClick={()=>setPendingDelete(a)}>{deleting===String(a.user_id)?'删除中…':'删除账号'}</button>
        </td>
      </tr>)}</tbody></table></div>
    {editing && <div ref={editRef} className="task-card account-edit-target" style={{ marginTop: 8, outline: "2px solid #1a56c4" }}>
      <div className="t">编辑账号 · {String(editing.username)}</div>
      <div style={{ display: "grid", gap: 6, gridTemplateColumns: "1fr 1fr", alignItems: "end" }}>
        <label>显示名<input className="btn" style={{ width: "100%" }} value={eDn} onChange={(e) => setEDn(e.target.value)} /></label>
        <label>管理车队（* 表示全部车队）<input className="btn" style={{ width: "100%" }} value={eScope} onChange={(e) => setEScope(e.target.value)} aria-label="车队范围" /></label>
        <label>司机绑定<div style={{ display: "flex", gap: 6 }}>
          <select className="btn" style={{ flex: 1 }} disabled={eClear || !editing.binding_verified} value={eDriver} onChange={(e) => setEDriver(e.target.value)} aria-label="司机绑定">
            <option value="">（不变更/空）</option>
            {(rows || []).filter((x) => x.role === "driver" && x.user_id !== editing.user_id && x.driver_id).map((x) => <option key={String(x.user_id)} value={String(x.driver_id)}>{driverLabel(x.driver_id)}</option>)}
          </select>
          <label className="meta" style={{ alignSelf: "center" }}><input type="checkbox" checked={eClear} onChange={(e) => setEClear(e.target.checked)} /> 清除绑定</label>
        </div>
        <div className="meta">{editing.binding_verified ? "身份已核实" : "请先核实身份绑定"}</div></label>
      </div>
      <div style={{ display: "flex", gap: 6, marginTop: 6 }}>
        <button className="btn primary" style={{ width: "auto" }} onClick={saveEdit}>保存编辑</button>
        <button className="btn" onClick={() => setEditing(null)}>取消</button>
      </div>

    </div>}
    <div className="task-card" style={{ marginTop: 10, padding: 8 }}>
      <div className="t">创建账号</div>
      <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
        <input className="btn" style={{ width: 170 }} value={username} onChange={(e) => setUsername(e.target.value.replace(/[^a-z0-9_.-]/g, ""))} placeholder="登录名(小写)" aria-label="新账号登录名" />
        <input className="btn" style={{ width: 150 }} value={dn} onChange={(e) => setDn(e.target.value)} placeholder="显示名" />
        <select className="btn" style={{ width: "auto" }} value={role} onChange={(e) => setRole(e.target.value)} aria-label="新账号角色"><option value="driver">司机</option>{canCreateAdmin&&<option value="safety_admin">管理员</option>}<option value="safety_officer">安全员</option></select>
        <button className="btn primary" disabled={creating || username.length < 3} onClick={create}>{creating ? "创建中…" : "创建账号"}</button>
      </div>

    </div>
  </div>;
}
