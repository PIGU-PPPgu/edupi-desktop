"use client";
import { useEffect, useState } from "react";

export function EduPiMemoryHistory({ id, revision, onRestore }: { id: string; revision: number; onRestore?: (content: string) => Promise<void> }) {
  const [open, setOpen] = useState(false);
  const [history, setHistory] = useState<Array<{ content: string; revision: number; replaced_at: string }>>([]);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  useEffect(() => {
    if (!open) return;
    const controller = new AbortController();
    fetch(`/api/edupi/memories/${encodeURIComponent(id)}/history`, { signal: controller.signal }).then(async response => { if (!response.ok) throw new Error("历史记录读取失败"); const result = await response.json(); setHistory(result.history.slice().reverse()); setError(""); }).catch(error => { if (!controller.signal.aborted) setError(error.message); });
    return () => controller.abort();
  }, [id, revision, open]);
  return <details onToggle={event => setOpen(event.currentTarget.open)}><summary>历史版本</summary>{error ? <p role="alert">{error}</p> : history.length ? history.map(item => <div key={item.revision} style={{ padding: "10px 0" }}><small>版本 {item.revision} · {item.replaced_at.slice(0, 10)}</small><p>{item.content}</p>{onRestore ? <button disabled={busy} onClick={async () => { setBusy(true); try { await onRestore(item.content); } finally { setBusy(false); } }}>恢复这一版</button> : null}</div>) : <p>暂无历史版本</p>}</details>;
}
