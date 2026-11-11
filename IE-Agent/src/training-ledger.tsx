import {useCallback, useEffect, useRef, useState} from 'react';
import {api, getData} from './api';
import {EmptyState} from './ui';
import {trainingStatus, useTrainingNames, useTaskDeletionPermission} from './training-ui';
import {isInteractiveCourse, QuizScoreSummary} from './training';
import {ConfirmDelete} from './confirm-delete';
import './training-ledger.css';

type Task = Record<string, unknown>;
const openStatuses = ['assigned', 'in_progress', 'returned'];
const statuses = ['assigned', 'in_progress', 'submitted', 'reviewed', 'returned', 'observation', 'interview'];
const overdue = (r: Task) => openStatuses.includes(String(r.status)) && !!r.due_at && new Date(String(r.due_at)).getTime() < Date.now();

export function TrainingLedger({onOpen}: {onOpen: (id: string) => void}) {
  const names = useTrainingNames();
  const {canDelete,canDeleteTask} = useTaskDeletionPermission();
  const [rows, setRows] = useState<Task[] | null>(null);
  const [error, setError] = useState(''), [message, setMessage] = useState('');
  const [search, setSearch] = useState(''), [status, setStatus] = useState(''), [course, setCourse] = useState(''), [requirement, setRequirement] = useState('');
  const [page, setPage] = useState(0), [selected, setSelected] = useState<string[]>([]), [busy, setBusy] = useState(false), [loading, setLoading] = useState(true);
  const [showScores, setShowScores] = useState(false);
  const [pendingDelete, setPendingDelete] = useState<string[] | null>(null);
  const request = useRef(0);
  const selectPage = useRef<HTMLInputElement>(null);
  const reload = useCallback(async () => {
    const version = ++request.current;
    setLoading(true); setError('');
    try {
      const all: Task[] = [];
      for (let offset = 0; ; offset += 200) {
        const r = await getData<Task>('admin.trainings', {limit: 200, offset, order: 'updated_at.desc,task_id.asc'});
        all.push(...r.rows);
        if (r.rows.length < 200) break;
      }
      if (version !== request.current) return;
      setRows(all);
      setSelected(s => s.filter(id => all.some(r => r.task_id === id)));
    } catch { if (version === request.current) setError('培训任务读取失败，请刷新重试。'); }
    finally { if (version === request.current) setLoading(false); }
  }, []);
  useEffect(() => {
    void reload();
    const refresh = () => { void reload(); };
    window.addEventListener('claw:center-refresh', refresh);
    window.addEventListener('focus', refresh);
    return () => { request.current++; window.removeEventListener('claw:center-refresh', refresh); window.removeEventListener('focus', refresh); };
  }, [reload]);
  const filtered = (rows || []).filter(r => (!status || (status === 'overdue' ? overdue(r) : r.status === status)) && (!course || r.course_id === course) && (!requirement || Number(r.mandatory) === Number(requirement)) && [r.task_id, r.driver_id, names.driver(r.driver_id), r.course_id, names.course(r.course_id), r.goal].join(' ').toLowerCase().includes(search.trim().toLowerCase()));
  const pages = Math.max(1, Math.ceil(filtered.length / 20)), currentPage = Math.min(page, pages - 1);
  const visible = filtered.slice(currentPage * 20, currentPage * 20 + 20);
  const selectablePage = visible.filter(canDeleteTask);
  const selectableFiltered = filtered.filter(canDeleteTask);
  const allPageSelected = selectablePage.length > 0 && selectablePage.every(r => selected.includes(String(r.task_id)));
  useEffect(() => { if (selectPage.current) selectPage.current.indeterminate = !allPageSelected && selectablePage.some(r => selected.includes(String(r.task_id))); }, [allPageSelected, visible, selected]);
  function changeFilter(update: () => void) { update(); setPage(0); setSelected([]); }
  function toggle(ids: string[], checked: boolean) { setSelected(s => checked ? [...new Set([...s, ...ids])] : s.filter(id => !ids.includes(id))); }
  async function remove(ids: string[]) {
    if (!canDelete || !ids.length || ids.some(id => !rows?.some(r => r.task_id === id && canDeleteTask(r)))) return;
    setBusy(true); setError(''); setMessage('');
    let deleted = 0; const failed: string[] = [];
    try {
      // 每批最多200项；选择更多结果时分批提交，并保留失败项供重试。
      for (let offset = 0; offset < ids.length; offset += 200) {
        const result = await api<{deleted: string[]; failed: {task_id: string}[]}>('/api/training-tasks/batch-delete', {method: 'POST', body: JSON.stringify({tasks: ids.slice(offset, offset + 200).map(id => ({task_id: id, expected_updated_at: rows?.find(r => r.task_id === id)?.updated_at ?? null}))})});
        deleted += result.deleted.length; failed.push(...result.failed.map(r => r.task_id));
      }
      setSelected(failed);
      setMessage(`已删除 ${deleted} 项任务${failed.length ? `，${failed.length} 项未删除，请刷新核查后重试` : ''}。`);
    } catch { setError(`删除未全部完成，已删除 ${deleted} 项；请刷新后核查剩余任务。`); }
    finally { await reload(); setBusy(false); }
  }
  const counts = Object.fromEntries(statuses.map(s => [s, (rows || []).filter(r => r.status === s).length]));
  return <div className="training-ledger">
    {canDelete && pendingDelete && <ConfirmDelete title={`删除 ${pendingDelete.length} 项培训任务`} onCancel={()=>setPendingDelete(null)} onConfirm={()=>{const ids=pendingDelete;setPendingDelete(null);void remove(ids);}}>司机端将同步移除所选任务，历史学习记录和操作记录保留。请确认只删除已选中的任务。</ConfirmDelete>}
    <div className="cards" aria-label="培训任务统计">
      {[['total', '总任务数'], ['assigned', '已分配'], ['in_progress', '进行中'], ['submitted', '待复核'], ['reviewed', '已复核'], ['returned', '退回补充'], ['overdue', '已逾期']].map(([key, label]) => <div className={`card ${key === 'overdue' ? 'risk' : ''}`} key={key}><div className="k">{label}</div><div className="v">{rows === null ? '—' : key === 'total' ? rows.length : key === 'overdue' ? rows.filter(overdue).length : counts[key] || 0}</div></div>)}
    </div>
    <details className="panel" onToggle={e => setShowScores(e.currentTarget.open)}><summary>互动课程答题成绩</summary>{showScores && (filtered.some(r=>isInteractiveCourse(r.course_id)) ? filtered.filter(r=>isInteractiveCourse(r.course_id)).map(r=><div key={String(r.task_id)} className="task-card"><b>{names.driver(r.driver_id)} · {names.course(r.course_id)}</b> · {trainingStatus(r.status)}<QuizScoreSummary record={r.learning_record}/><button className="btn" onClick={()=>onOpen(String(r.task_id))}>查看任务与复核</button></div>) : <p className="meta">当前筛选结果中暂无互动课程记录。</p>)}</details>
    <section className="panel stack">
      <div className="row ledger-filters">
        <input className="btn" aria-label="搜索培训任务" placeholder="搜索司机、车辆、课程或任务" value={search} disabled={busy} onChange={e => changeFilter(() => setSearch(e.target.value))}/>
        <select className="btn" aria-label="筛选任务状态" value={status} disabled={busy} onChange={e => changeFilter(() => setStatus(e.target.value))}><option value="">全部状态</option>{statuses.map(s => <option key={s} value={s}>{trainingStatus(s)}</option>)}<option value="overdue">已逾期</option></select>
        <select className="btn" aria-label="筛选培训课程" value={course} disabled={busy} onChange={e => changeFilter(() => setCourse(e.target.value))}><option value="">全部课程</option>{[...new Set((rows || []).map(r => String(r.course_id)))].map(id => <option value={id} key={id}>{names.course(id)}</option>)}</select>
        <select className="btn" aria-label="筛选培训要求" value={requirement} disabled={busy} onChange={e => changeFilter(() => setRequirement(e.target.value))}><option value="">必修与选修</option><option value="1">必修</option><option value="0">选修</option></select>
        <button className="btn" disabled={busy} onClick={() => changeFilter(() => { setSearch(''); setStatus(''); setCourse(''); setRequirement(''); })}>重置筛选</button>
        <button className="btn" disabled={busy || loading} onClick={() => void reload()}>{loading ? '读取中…' : '刷新台账'}</button>
      </div>
      <p className="meta">统计卡片显示全部有效任务；当前筛选 {filtered.length} 项。删除后列表、总数和各状态数量同步更新。</p>
      {error && <div className="alert warn" role="alert">{error}</div>}{message && <div className="alert info" role="status">{message}</div>}
      {canDelete && <div className="row ledger-selection">
        <button className="btn" disabled={busy || loading || !selectableFiltered.length} onClick={() => toggle(selectableFiltered.map(r => String(r.task_id)), true)}>选择可删除任务（{selectableFiltered.length}）</button>
        <button className="btn" disabled={busy || !selected.length} onClick={() => setSelected([])}>取消选择</button><span>已选 {selected.length} 项</span>
        <button className="btn task-delete" disabled={busy || loading || !selected.length} onClick={() => setPendingDelete([...selected])}>{busy ? '删除中…' : `删除所选（${selected.length}）`}</button>
      </div>}
      {rows === null && loading ? <EmptyState kind="loading"/> : <div className="table-wrap"><table className="tbl"><thead><tr>
        {canDelete && <th><input type="checkbox" ref={selectPage} aria-label="选择本页全部任务" checked={allPageSelected} disabled={busy || loading || !selectablePage.length} onChange={e => toggle(selectablePage.map(r => String(r.task_id)), e.target.checked)}/></th>}<th>司机 / 车辆</th><th>培训课程 / 学习目标</th><th>要求</th><th>截止日期</th><th>状态</th><th>提交日期</th><th>验收日期</th><th>操作</th>
      </tr></thead><tbody>{visible.map(r => <tr key={String(r.task_id)} className={selected.includes(String(r.task_id)) ? 'is-selected' : ''}>
        {canDelete && <td><input type="checkbox" aria-label={`选择${names.driver(r.driver_id)}的${names.course(r.course_id)}任务`} checked={selected.includes(String(r.task_id))} disabled={busy || loading || !canDeleteTask(r)} onChange={e => toggle([String(r.task_id)], e.target.checked)}/></td>}
        <td>{names.driver(r.driver_id)}</td><td><b>{names.course(r.course_id)}</b><div className="meta">{String(r.goal || '—')}</div></td><td>{Number(r.mandatory) ? '必修' : '选修'}</td><td>{r.due_at ? new Date(String(r.due_at)).toLocaleDateString('zh-CN') : '未设置'}</td><td>{trainingStatus(r.status)}{overdue(r) && <span className="ledger-overdue"> · 已逾期</span>}</td>
        <td>{r.submitted_at ? new Date(String(r.submitted_at)).toLocaleDateString('zh-CN') : '—'}</td><td>{r.reviewed_at ? new Date(String(r.reviewed_at)).toLocaleDateString('zh-CN') : '—'}</td>
        <td><div className="row"><button className="btn" disabled={busy} onClick={() => onOpen(String(r.task_id))}>查看任务</button>{canDeleteTask(r) && <button className="btn task-delete" disabled={busy || loading} onClick={() => setPendingDelete([String(r.task_id)])}>删除</button>}</div></td>
      </tr>)}</tbody></table>{!filtered.length && !error && <EmptyState kind="nomatch" hint={rows?.length ? '没有符合筛选条件的任务。' : '暂无培训任务，请先审核课程，再创建培训。'}/>}</div>}
      <div className="row"><button className="btn" disabled={busy || currentPage === 0} onClick={() => setPage(currentPage - 1)}>上一页</button><span>共 {filtered.length} 项 · 第 {currentPage + 1} / {pages} 页</span><button className="btn" disabled={busy || currentPage + 1 >= pages} onClick={() => setPage(currentPage + 1)}>下一页</button></div>
    </section>
  </div>;
}
