import type { EducationWorkCandidate, TeacherTask } from "./edupi-education-contract";
import type { TaskSessionBinding } from "./edupi-task-sessions";
import { taskDisplayTitle, taskKey, taskTypeLabel } from "./edupi-workbench";

export type TaskBoardLaneId = "todo" | "progress" | "review" | "done";

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
];

const transitions: Record<TaskBoardLaneId, TaskBoardLaneId[]> = {
  todo: ["progress", "review"],
  progress: ["todo", "review"],
  review: ["progress", "done"],
  done: ["progress"],
};

export function taskBoardTargets(stage: TaskBoardLaneId): TaskBoardLaneId[] {
  return [...transitions[stage]];
}

function hasCandidateOutput(task: TeacherTask): boolean {
  return Boolean(task.contentStatus && task.contentStatus !== "not_generated");
}

export function taskBoardLane(task: TeacherTask, session: TaskSessionBinding | null | undefined, candidate?: Pick<EducationWorkCandidate, "status"> | null): TaskBoardLaneId {
  if (task.boardStage) return task.boardStage;
  if (task.status === "accepted" || task.status === "modified" || task.status === "rejected") return "done";
  if (candidate?.status === "accepted" || candidate?.status === "modified" || candidate?.status === "rejected" || candidate?.status === "suppressed") return "done";
  if (candidate?.status === "pending_review") return "review";
  if (hasCandidateOutput(task)) return "review";
  if (session) return "progress";
  return "todo";
}

function searchableText(task: TeacherTask): string {
  return [
    taskDisplayTitle(task),
    taskTypeLabel(task),
    task.dueDate,
    task.triggerDate,
    task.sourceEventDate,
    task.sourceEventName,
    task.student,
    task.topic,
    task.materialKind,
  ].filter(Boolean).join(" ").toLocaleLowerCase();
}

function openTaskOrder(left: TeacherTask, right: TeacherTask): number {
  const leftDate = left.dueDate || left.triggerDate || left.sourceEventDate || "9999-12-31";
  const rightDate = right.dueDate || right.triggerDate || right.sourceEventDate || "9999-12-31";
  return leftDate.localeCompare(rightDate) || taskKey(left).localeCompare(taskKey(right));
}

function doneTaskOrder(left: TeacherTask, right: TeacherTask): number {
  return String(right.reviewedAt || "").localeCompare(String(left.reviewedAt || "")) || taskKey(left).localeCompare(taskKey(right));
}

export function projectTaskBoard(
  tasks: TeacherTask[],
  taskSessions: Record<string, TaskSessionBinding>,
  workCandidates: Array<Pick<EducationWorkCandidate, "taskId" | "status">>,
  query: string,
): TaskBoardColumn[] {
  const normalizedQuery = query.trim().toLocaleLowerCase();
  const visible = tasks.filter((task) => !normalizedQuery || searchableText(task).includes(normalizedQuery));
  const candidateByTask = new Map(workCandidates.map((candidate) => [candidate.taskId, candidate]));
  return columns.map((column) => ({
    ...column,
    tasks: visible
      .filter((task) => taskBoardLane(task, task.id ? taskSessions[task.id] : null, task.id ? candidateByTask.get(task.id) : null) === column.id)
      .sort(column.id === "done" ? doneTaskOrder : openTaskOrder),
  }));
}
