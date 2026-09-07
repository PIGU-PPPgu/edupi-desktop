"use client";
import { useEffect, useState } from "react";
import type { Reminder } from "@/lib/edupi-reminder-store";
import type { DesktopControlInput } from "@/lib/edupi-desktop-control";

export function EduPiReminderInbox({ onAction }: { onAction: (action: DesktopControlInput) => boolean | Promise<boolean> }) {
  const [open, setOpen] = useState(false);
  const [items, setItems] = useState<Reminder[]>([]);
  const [error, setError] = useState("");
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
  const visible = items.filter(item => !item.handled && !item.snoozedUntil).reverse();
  return <section aria-label="提醒" style={{ padding: "8px 12px" }}>
    <button className="native-button" aria-expanded={open} onClick={() => setOpen(!open)}>提醒 {visible.filter(item => !item.read).length || ""}</button>
    {open ? <div style={{ maxHeight: 320, overflowY: "auto" }}>
      {error ? <p role="alert">{error}</p> : null}
      {!visible.length && !error ? <p>暂无待处理提醒</p> : null}
      {visible.map(item => <details key={item.id} onToggle={event => { if (event.currentTarget.open && !item.read) void change(item.id, "read"); }}>
        <summary>{item.title} · {item.kind === "ready" ? "已准备" : "准备失败"}</summary>
        <button className="native-button" onClick={async () => { if (await onAction({ action: "open_task", taskId: item.taskId, stage: "run" })) setOpen(false); else setError("事项暂不可用"); }}>进入协作</button>
        <button className="native-button" onClick={() => void onAction({ action: "open_task", taskId: item.taskId, stage: "artifact" })}>查看事项</button>
        <button className="native-button" onClick={() => void change(item.id, "snooze")}>一小时后提醒</button>
        <button className="native-button" onClick={() => void change(item.id, "handled")}>已处理</button>
      </details>)}
    </div> : null}
  </section>;
}
