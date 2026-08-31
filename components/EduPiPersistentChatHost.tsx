"use client";

import type { ReactNode } from "react";
import type { TeacherTask } from "@/lib/edupi-education-contract";
import { taskDisplayTitle, taskSourceLabel } from "@/lib/edupi-workbench";

export type EduPiPersistentChatMode = "main" | "drawer" | "hidden";

type Props = {
  children: ReactNode;
  mode: EduPiPersistentChatMode;
  task?: TeacherTask | null;
  onPreparePrompt?: (prompt: string) => void;
  onClose?: () => void;
};

/** Keep the one ChatWindow child mounted while only its presentation changes. */
export function EduPiPersistentChatHost({ children, mode, task, onPreparePrompt, onClose }: Props) {
  const prompt = task ? [
    `教学任务：${task.title}`,
    `来源：${taskSourceLabel(task)}`,
    `截止：${task.dueDate || "日期待确认"}`,
    "请仅在教师内部协助，保留来源，不外发；先提出需要教师确认的修改建议。",
  ].join("\n") : "请仅在教师内部协助当前教学工作，不外发。";
  return (
    <section className={`edupi-persistent-chat-host is-${mode}`} aria-label={mode === "drawer" ? "任务内协作" : "对话"}>
      <header className="edupi-persistent-chat-host__header">
        <div><span>{task ? "任务内协作" : "全局协作"}</span><strong>{task ? taskDisplayTitle(task) : "EduPi Agent"}</strong></div>
        <div className="edupi-persistent-chat-host__actions">{task && onPreparePrompt ? <button type="button" onClick={() => onPreparePrompt(prompt)}>带入任务</button> : null}<button type="button" className="edupi-persistent-chat-host__close" onClick={onClose} aria-label="关闭协作">×</button></div>
      </header>
      <div className="edupi-persistent-chat-host__body">{children}</div>
    </section>
  );
}
