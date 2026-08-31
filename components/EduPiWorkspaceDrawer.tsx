"use client";

import type { ReactNode } from "react";
import type { TeacherTask } from "@/lib/edupi-education-contract";
import { taskDisplayTitle, taskSourceLabel } from "@/lib/edupi-workbench";

type Props = {
  kind: "agent" | "file" | null;
  task: TeacherTask | undefined;
  filePath: string | null;
  agentPanel: ReactNode;
  filePanel: ReactNode;
  onClose: () => void;
  onPreparePrompt: (prompt: string) => void;
};

export function EduPiWorkspaceDrawer({ kind, task, filePath, agentPanel, filePanel, onClose, onPreparePrompt }: Props) {
  if (!kind) return null;
  const prompt = task ? [
    `教学任务：${task.title}`,
    `来源：${taskSourceLabel(task)}`,
    `截止：${task.dueDate || "日期待确认"}`,
    "请仅在教师内部协助，保留来源，不外发；先提出需要教师确认的修改建议。",
  ].join("\n") : "请仅在教师内部协助当前教学工作，不外发。";
  return (
    <aside className={`edupi-workspace-drawer is-${kind}`} aria-label={kind === "agent" ? "任务内协作" : "材料预览"}>
      <header>
        <div><span>{kind === "agent" ? task ? "任务内协作" : "全局协作" : "材料预览"}</span><h2>{kind === "agent" ? task ? taskDisplayTitle(task) : "EduPi Agent" : filePath?.split(/[\\/]/).pop() || "文件"}</h2></div>
        <div>{kind === "agent" ? <button type="button" onClick={() => onPreparePrompt(prompt)}>带入任务</button> : null}<button type="button" className="is-close" onClick={onClose} aria-label="关闭侧栏">×</button></div>
      </header>
      <div className="edupi-workspace-drawer__body">{kind === "agent" ? agentPanel : filePanel}</div>
    </aside>
  );
}
