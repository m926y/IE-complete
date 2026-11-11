import {useEffect, useId, useRef} from 'react';
import './confirm-delete.css';

export function ConfirmDelete({title, children, onCancel, onConfirm}: {title: string; children: string; onCancel: () => void; onConfirm: () => void}) {
  const dialog=useRef<HTMLDialogElement>(null), id=useId();
  useEffect(()=>{dialog.current?.showModal();},[]);
  return <dialog className="delete-confirm" ref={dialog} aria-labelledby={id} onCancel={e=>{e.preventDefault();onCancel();}}>
    <h3 id={id}>{title}</h3><p>{children}</p><div className="row"><button className="btn" autoFocus onClick={onCancel}>取消</button><button className="btn delete-confirm-action" onClick={onConfirm}>确认删除</button></div>
  </dialog>;
}
