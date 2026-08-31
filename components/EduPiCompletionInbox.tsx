"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import type { TeacherTask } from "@/lib/edupi-education-contract";
import { completionInboxItems } from "@/lib/edupi-completion-monitor";

export function EduPiCompletionInbox({
  tasks,
  onTask,
}: {
  tasks: TeacherTask[];
  onTask: (task: TeacherTask) => void;
}) {
  const [open, setOpen] = useState(false);
  const rootRef = useRef<HTMLDivElement>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const items = useMemo(() => completionInboxItems(tasks), [tasks]);
  const readyCount = items.filter((item) => item.kind === "ready").length;
  const failedCount = items.length - readyCount;

  useEffect(() => {
    if (!open) return;
    const onPointerDown = (event: PointerEvent) => {
      if (event.target instanceof Node && !rootRef.current?.contains(event.target)) setOpen(false);
    };
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key !== "Escape") return;
      event.preventDefault();
      event.stopPropagation();
      setOpen(false);
      triggerRef.current?.focus();
    };
    window.addEventListener("pointerdown", onPointerDown);
    window.addEventListener("keydown", onKeyDown, true);
    return () => {
      window.removeEventListener("pointerdown", onPointerDown);
      window.removeEventListener("keydown", onKeyDown, true);
    };
  }, [open]);

  return <div ref={rootRef} className="edupi-completion-inbox">
    <button ref={triggerRef} type="button" onClick={() => setOpen((value) => !value)} aria-expanded={open} aria-haspopup="dialog">
      EduPi 已完成 <em>{readyCount}</em>{failedCount > 0 ? <i>{failedCount} 需处理</i> : null}
    </button>
    {open ? <section role="dialog" aria-label="EduPi 已完成" className="edupi-completion-inbox__panel">
      <header><strong>EduPi 已完成</strong><span>{items.length} 项</span></header>
      {items.length > 0 ? <div className="edupi-completion-inbox__list">{items.map((item) => <button type="button" key={item.taskId} onClick={() => { const task = tasks.find((value) => value.id === item.taskId); setOpen(false); if (task) onTask(task); }}><span className={`is-${item.kind}`} aria-hidden="true" /><div><strong>{item.title}</strong><small>{item.kind === "ready" ? "已准备好，等待你确认" : "准备失败，需要处理"}</small></div></button>)}</div> : <p>暂时没有新产物</p>}
    </section> : null}
  </div>;
}
