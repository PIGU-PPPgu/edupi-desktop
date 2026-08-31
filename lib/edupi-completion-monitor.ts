import type { TeacherTask } from "./edupi-education-contract";
import { taskArtifactFile, taskDisplayTitle } from "./edupi-workbench";

export type EduPiCompletionKind = "ready" | "failed";

export type EduPiCompletionSnapshotItem = {
  taskId: string;
  title: string;
  contentStatus: string;
  completion: EduPiCompletionKind | null;
  identity: string;
};

export type EduPiCompletionSnapshot = Record<string, EduPiCompletionSnapshotItem>;

function normalizedContentStatus(task: TeacherTask): string {
  return typeof task.contentStatus === "string" ? task.contentStatus : "";
}

export function completionState(task: TeacherTask): EduPiCompletionKind | null {
  const status = normalizedContentStatus(task);
  if (status === "draft_ready") return "ready";
  if (status === "generation_failed") return "failed";
  return null;
}

export function completionIdentity(task: TeacherTask, workspace: string): string {
  const status = normalizedContentStatus(task);
  const artifact = status === "draft_ready" ? taskArtifactFile(task, workspace) : null;
  return [status, artifact?.hash || "", artifact?.path || ""].join("\u0000");
}

export function completionSnapshot(tasks: TeacherTask[], workspace: string): EduPiCompletionSnapshot {
  return Object.fromEntries(tasks
    .filter((task): task is TeacherTask & { id: string } => typeof task.id === "string" && task.id.length > 0)
    .map((task): [string, EduPiCompletionSnapshotItem] => [task.id, {
      taskId: task.id,
      title: taskDisplayTitle(task),
      contentStatus: normalizedContentStatus(task),
      completion: completionState(task),
      identity: completionIdentity(task, workspace),
    }])
    .sort(([left], [right]) => left.localeCompare(right)));
}

export function completionSnapshotSignature(snapshot: EduPiCompletionSnapshot): string {
  return JSON.stringify(Object.values(snapshot).map((item) => [item.taskId, item.identity]));
}

export function diffTaskCompletionTransitions(
  previous: EduPiCompletionSnapshot,
  current: EduPiCompletionSnapshot,
): EduPiCompletionSnapshotItem[] {
  return Object.values(current)
    .filter((item) => item.completion !== null && previous[item.taskId]?.identity !== item.identity)
    .sort((left, right) => left.taskId.localeCompare(right.taskId));
}

export function completionInboxItems(tasks: TeacherTask[]): Array<{
  taskId: string;
  title: string;
  kind: EduPiCompletionKind;
}> {
  return tasks.flatMap((task) => {
    const kind = completionState(task);
    if (!task.id || !kind) return [];
    return [{ taskId: task.id, title: taskDisplayTitle(task), kind }];
  }).sort((left, right) => {
    const priority = (left.kind === "failed" ? 0 : 1) - (right.kind === "failed" ? 0 : 1);
    return priority || left.title.localeCompare(right.title) || left.taskId.localeCompare(right.taskId);
  });
}
