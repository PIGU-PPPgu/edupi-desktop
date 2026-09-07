"use client";
import { useEffect, useState } from "react";
import type { Reminder } from "@/lib/edupi-reminder-store";
import type { DesktopControlInput } from "@/lib/edupi-desktop-control";

export function EduPiReminderInbox({ onAction, onContinue }: { onAction: (action: DesktopControlInput) => boolean | Promise<boolean>; onContinue?: (taskId: string) => Promise<void> }) {
  const [open, setOpen] = useState(false);
  const [items, setItems] = useState<Reminder[]>([]);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const [filter, setFilter] = useState("pending");
  useEffect(() => {
    const controller = new AbortController();
    const load = async () => {
      try {
        const response = await fetch("/api/edupi/reminders", { signal: controller.signal });
        if (!response.ok) throw new Error();
        const result = await response.json();
        if (!controller.signal.aborted) { setItems(result.items); setError(""); }
      } catch { if (!controller.signal.aborted) setError("提醒暂不可用"); }
    };
    void load(); const timer = setInterval(() => void load(), 30000);
    return () => { controller.abort(); clearInterval(timer); };
  }, []);
  const change = async (id: string, type: "read" | "handled" | "snooze") => {
    try {
      const response = await fetch("/api/edupi/reminders", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ id, type }) });
      if (!response.ok) throw new Error();
      setItems((await response.json()).items);
    } catch { setError("提醒保存失败"); }
  };
  const pending = items.filter(item => !item.handled && !item.snoozedUntil);
  const visible = items.filter(item => filter === "handled" ? item.handled : filter === "snoozed" ? !item.handled && Boolean(item.snoozedUntil) : !item.handled && !item.snoozedUntil).reverse();
  return <section aria-label="提醒" style={{ padding: "8px 12px" }}>
    <button className="native-button" aria-expanded={open} onClick={() => setOpen(!open)}>提醒 {pending.filter(item => !item.read).length || ""}</button>
    {open ? <div style={{ maxHeight: 320, overflowY: "auto" }}>
      <select aria-label="提醒状态" value={filter} onChange={event => setFilter(event.target.value)}><option value="pending">待处理</option><option value="snoozed">稍后提醒</option><option value="handled">已处理</option></select>
      {error ? <p role="alert">{error}</p> : null}
      {!visible.length && !error ? <p>暂无待处理提醒</p> : null}
      {visible.map(item => <details key={item.id} onToggle={event => { if (event.currentTarget.open && !item.read) void change(item.id, "read"); }}>
        <summary>{item.title} · {item.kind === "ready" ? "已准备" : item.kind === "due" ? "今日到期" : "准备失败"}</summary>
        <time>{new Date(item.snoozedUntil || item.createdAt).toLocaleString("zh-CN")}</time>
        <button className="native-button" disabled={busy} onClick={async () => {
          setBusy(true);
          try { if (onContinue) await onContinue(item.taskId); else if (!await onAction({ action: "open_task", taskId: item.taskId, stage: "run" })) throw new Error("事项暂不可用"); setOpen(false); }
          catch (error) { setError(error instanceof Error ? error.message : "协作打开失败"); }
          finally { setBusy(false); }
        }}>继续聊</button>
        <button className="native-button" onClick={() => void onAction({ action: "open_task", taskId: item.taskId, stage: "artifact" })}>查看事项</button>
        <button className="native-button" onClick={() => void change(item.id, "snooze")}>一小时后提醒</button>
        <button className="native-button" onClick={() => void change(item.id, "handled")}>已处理</button>
      </details>)}
    </div> : null}
  </section>;
}
