import type { TeacherTask } from "./edupi-education-contract";

export function isPausedRecurringTask(task: Pick<TeacherTask, "recurrence" | "boardStage" | "status">): boolean {
  return Boolean(task.recurrence && task.boardStage === "done" && task.status !== "hold" && task.status !== "rejected");
}
