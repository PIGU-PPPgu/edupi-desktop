import type { EducationWorkCandidate, TeacherTask } from "./edupi-education-contract";
import type { TaskSessionBinding } from "./edupi-task-sessions";
import { taskContentReady, taskKey } from "./edupi-workbench.ts";
import { matchesTaskQuery } from "./edupi-task-category.ts";
import { compareCompletionTimes, compareForegroundDates, isTaskForeground, taskCompletionTime, taskReferenceDate, type ForegroundContext, type ForegroundPolicy } from "./edupi-foreground.ts";
import { isPausedRecurringTask } from "./edupi-recurring-status.ts";

export type CoreTaskBoardStage = "todo" | "progress" | "review" | "done";
export type TaskBoardLaneId = CoreTaskBoardStage | "paused";

export type TaskBoardColumn = {
  id: TaskBoardLaneId;
  label: string;
  tasks: TeacherTask[];
};

const columns: Array<{ id: TaskBoardLaneId; label: string }> = [
  { id: "todo", label: "待处理" },
  { id: "progress", label: "进行中" },
  { id: "review", label: "待我确认" },
  { id: "done", label: "已完成" },
  { id: "paused", label: "已暂停" },
];

const laneLabels: Record<TaskBoardLaneId, string> = Object.fromEntries(columns.map((column) => [column.id, column.label])) as Record<TaskBoardLaneId, string>;

const transitions: Record<TaskBoardLaneId, TaskBoardLaneId[]> = {
  todo: ["progress", "review", "done"],
  progress: ["todo", "review", "done"],
  review: ["progress", "done"],
  done: ["progress"],
  paused: ["progress"],
};

export function taskBoardTargets(stage: TaskBoardLaneId, task?: TeacherTask): TaskBoardLaneId[] {
  if (task?.recurrence) {
    if (task.status === "rejected" || task.status === "hold") return [];
    return transitions[stage].map(target => target === "done" ? "paused" : target);
  }
  return [...transitions[stage]];
}

export function taskBoardStageForCore(task: TeacherTask, stage: TaskBoardLaneId): CoreTaskBoardStage {
  if (stage === "paused") {
    if (!task.recurrence) throw new Error("普通任务不能暂停周期模板。");
    return "done";
  }
  return stage;
}

export function taskBoardLaneLabel(stage: TaskBoardLaneId): string {
  return laneLabels[stage];
}

export function hasCurrentExplicitBoardStage(task: Pick<TeacherTask, "boardStage" | "boardRevision" | "boardUpdatedAt" | "reviewedAt">): boolean {
  return Boolean(task.boardStage && task.boardRevision > 0
    && (!task.reviewedAt || task.boardUpdatedAt && task.boardUpdatedAt >= task.reviewedAt));
}

export function taskBoardLane(task: TeacherTask, session: TaskSessionBinding | null | undefined, candidate?: Pick<EducationWorkCandidate, "status"> | null): TaskBoardLaneId {
  // Core projects recurring templates from their durable stage override;
  // reviewing the definition must not turn an active template into "done".
  if (task.recurrence) {
    if (task.status === "rejected") return "done";
    if (task.status === "hold") return "review";
    if (isPausedRecurringTask(task)) return "paused";
    if (task.boardStage) return task.boardStage;
  }
  // A later explicit move can reopen reviewed work. Initial stages and older
  // moves must not hide a subsequent review or generated draft.
  if (task.boardStage && hasCurrentExplicitBoardStage(task)) return task.boardStage;
  if (task.status === "accepted" || task.status === "modified" || task.status === "rejected") return "done";
  if (candidate?.status === "accepted" || candidate?.status === "modified" || candidate?.status === "rejected" || candidate?.status === "suppressed") return "done";
  const contentStatus = task.contentStatus?.trim().toLocaleLowerCase().replace(/[\s-]+/g, "_");
  if (contentStatus === "generating" || contentStatus === "running" || contentStatus === "queued") return "progress";
  if (contentStatus === "generation_failed" || contentStatus === "failed" || contentStatus === "error") return task.boardStage === "progress" || session ? "progress" : "todo";
  if (candidate?.status === "pending_review") return "review";
  if (taskContentReady(task)) return "review";
  if (task.boardStage && task.boardStage !== "todo") return task.boardStage;
  if (session) return "progress";
  return "todo";
}

function openTaskOrder(left: TeacherTask, right: TeacherTask): number {
  const leftDate = left.dueDate || left.triggerDate || left.sourceEventDate || "9999-12-31";
  const rightDate = right.dueDate || right.triggerDate || right.sourceEventDate || "9999-12-31";
  return leftDate.localeCompare(rightDate) || taskKey(left).localeCompare(taskKey(right));
}

function doneTaskOrder(left: TeacherTask, right: TeacherTask): number {
  return compareCompletionTimes(taskCompletionTime(left), taskCompletionTime(right)) || taskKey(left).localeCompare(taskKey(right));
}

export function projectTaskBoard(
  tasks: TeacherTask[],
  taskSessions: Record<string, TaskSessionBinding>,
  workCandidates: Array<Pick<EducationWorkCandidate, "taskId" | "status">>,
  query: string,
  policy?: ForegroundPolicy & ForegroundContext,
): TaskBoardColumn[] {
  const context = { ...policy, taskSessions, workCandidates: workCandidates as EducationWorkCandidate[] };
  const visible = tasks.filter((task) => matchesTaskQuery(task, query) && (!policy || isTaskForeground(task, policy, context)));
  const candidateByTask = new Map(workCandidates.map((candidate) => [candidate.taskId, candidate]));
  return columns.map((column) => ({
    ...column,
    tasks: visible
      .filter((task) => taskBoardLane(task, task.id ? taskSessions[task.id] : null, task.id ? candidateByTask.get(task.id) : null) === column.id)
      .sort(column.id === "done" ? (left, right) => compareCompletionTimes(taskCompletionTime(left, context), taskCompletionTime(right, context)) || doneTaskOrder(left, right)
        : policy ? (left, right) => compareForegroundDates(taskReferenceDate(left, context), taskReferenceDate(right, context), policy.today) || taskKey(left).localeCompare(taskKey(right)) : openTaskOrder),
  }));
}
