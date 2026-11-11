import { createContext, useCallback, useContext, useEffect, useRef, useState } from "react";
import type { ReactNode } from "react";

type Draft = { label: string; dirty: boolean; busy: boolean; save: () => Promise<boolean>; discard: () => void };
type Navigation = { register: (id: string, read: () => Draft) => () => void; request: (go: () => void) => void; isProtected: (id: string) => boolean };
const Context = createContext<Navigation | null>(null);

export function DriverNavigationProvider({ children }: { children: ReactNode }) {
  const drafts = useRef(new Map<string, () => Draft>());
  const [pending, setPending] = useState<{ go: () => void } | null>(null);
  const [saving, setSaving] = useState(false);
  const savingRef = useRef(false);
  const [message, setMessage] = useState("");
  const lock = useRef(false);
  const dialog = useRef<HTMLDialogElement>(null);
  const register = useCallback((id: string, read: () => Draft) => {
    drafts.current.set(id, read);
    return () => { drafts.current.delete(id); };
  }, []);
  const isProtected = useCallback((id: string) => { const draft = drafts.current.get(id)?.(); return Boolean(draft && (draft.dirty || draft.busy)); }, []);
  const request = useCallback((go: () => void) => {
    if (lock.current) return;
    if ([...drafts.current.values()].some(read => { const d = read(); return d.dirty || d.busy; })) {
      lock.current = true; setMessage(""); setPending({ go });
    } else go();
  }, []);
  useEffect(() => {
    const unload = (event: BeforeUnloadEvent) => {
      if ([...drafts.current.values()].some(read => { const d = read(); return d.dirty || d.busy; })) {
        event.preventDefault(); event.returnValue = "";
      }
    };
    window.addEventListener("beforeunload", unload);
    return () => window.removeEventListener("beforeunload", unload);
  }, []);
  useEffect(() => { if (pending) dialog.current?.showModal(); else dialog.current?.close(); }, [pending]);
  function stay() { if (savingRef.current) return; lock.current = false; setPending(null); }
  async function leave(save: boolean) {
    if (!pending || savingRef.current) return;
    const entries = [...drafts.current.values()].map(read => read());
    if (entries.some(d => d.busy)) { setMessage("操作仍在进行，请等待结果后再选择。"); return; }
    savingRef.current = true; setSaving(true); setMessage("");
    try {
      if (save) {
        for (const draft of entries) if (draft.dirty && !await draft.save()) {
          setMessage("尚有记录未保存，已留在当前页。请处理保存错误或版本冲突后重试。"); return;
        }
        if ([...drafts.current.values()].some(read => read().dirty || read().busy)) {
          setMessage("还有未保存或正在处理的内容，请先核对当前记录。"); return;
        }
      } else for (const draft of entries) draft.discard();
      const go = pending.go; lock.current = false; setPending(null); go();
    } catch { setMessage("未能完成保存，仍留在当前页，输入已保留。"); }
    finally { savingRef.current = false; setSaving(false); }
  }
  return <Context.Provider value={{ register, request, isProtected }}>
    {children}
    <dialog ref={dialog} className="driver-leave-dialog" aria-labelledby="driver-leave-title" onCancel={event => { event.preventDefault(); stay(); }}>
      <h3 id="driver-leave-title">离开前处理未保存记录</h3>
      <p>学习记录尚未保存或操作仍在进行。保存失败时将继续留在当前页。</p>
      {pending && <ul>{[...drafts.current.values()].map(read => read()).filter(d => d.dirty || d.busy).map(d => <li key={d.label}>{d.label}</li>)}</ul>}
      {message && <p role="alert">{message}</p>}
      <div className="row">
        <button className="btn" autoFocus disabled={saving} onClick={stay}>留在当前页</button>
        <button className="btn primary" disabled={saving} onClick={() => void leave(true)}>{saving ? "正在保存…" : "保存后离开"}</button>
        <button className="btn" disabled={saving} onClick={() => void leave(false)}>放弃未保存内容并离开</button>
      </div>
    </dialog>
  </Context.Provider>;
}

export function useDriverNavigation() {
  const value = useContext(Context);
  if (!value) throw new Error("Driver navigation requires its provider");
  return value;
}

export function useDriverDraft(id: string, draft: Draft) {
  const { register } = useDriverNavigation();
  const latest = useRef(draft); latest.current = draft;
  useEffect(() => register(id, () => latest.current), [id, register]);
}
