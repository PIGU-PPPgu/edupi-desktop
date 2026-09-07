import type { TeacherTask } from "./edupi-education-contract";
import { completionSnapshot } from "./edupi-completion-monitor";

export type ReminderEvent = { taskId: string; title: string; completion: "ready" | "failed" | "due" | null; identity: string };
export function reminderEvents(tasks: TeacherTask[], workspace: string, now = new Date()): Record<string, ReminderEvent> {
  const activeTasks = tasks.filter(task => !["rejected", "hold", "accepted"].includes(task.status) && task.boardStage !== "done");
  const result: Record<string, ReminderEvent> = completionSnapshot(activeTasks, workspace);
  const today = new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Shanghai", year: "numeric", month: "2-digit", day: "2-digit" }).format(now);
  for (const task of activeTasks) {
    if (!task.id || task.dueDate !== today || ["rejected", "hold", "accepted"].includes(task.status) || task.contentStatus === "draft_ready") continue;
    result[`due:${task.id}`] = { taskId: task.id, title: task.title, completion: "due", identity: `due:${today}` };
  }
  return result;
}
