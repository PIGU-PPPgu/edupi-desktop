import type { EducationContract, EducationWorkCase, EducationWorkCaseState, EducationWorkTransition } from "./edupi-education-contract";

const STATE_LABELS: Record<EducationWorkCaseState, string> = {
  planned: "计划中",
  accepted: "已接受",
  modified: "已调整",
  rejected: "已拒绝",
  held: "已暂缓",
  queued: "已排队",
  running: "正在准备",
  draft_ready: "已准备",
  failed: "准备失败",
  completed: "已完成",
};

const TRANSITION_LABELS: Record<EducationWorkTransition["state"], string> = {
  planned: "回到计划",
  accepted: "教师接受",
  modified: "教师调整",
  rejected: "教师拒绝",
  held: "教师暂缓",
  queued: "进入队列",
  running: "开始准备",
  draft_ready: "准备完成",
  failed: "准备失败",
  stale: "旧版本失效",
};

const ACTIVE_ORDER: Partial<Record<EducationWorkCaseState, number>> = { running: 0, queued: 1, draft_ready: 2, failed: 3 };

export function workCaseForTask(data: Pick<EducationContract, "workCases">, taskId: string | null | undefined): EducationWorkCase | null {
  if (!taskId) return null;
  return data.workCases.find((workCase) => workCase.taskId === taskId) ?? null;
}

export function workCaseStateLabel(state: EducationWorkCaseState): string {
  return STATE_LABELS[state];
}

export function workCaseTransitionLabel(transition: EducationWorkTransition): string {
  return TRANSITION_LABELS[transition.state];
}

export function activeLivingWorkCases(workCases: EducationWorkCase[]): EducationWorkCase[] {
  return workCases
    .filter((workCase) => ACTIVE_ORDER[workCase.currentState] !== undefined)
    .sort((left, right) => Number(ACTIVE_ORDER[left.currentState]) - Number(ACTIVE_ORDER[right.currentState])
      || String(left.dueDate || "9999-12-31").localeCompare(String(right.dueDate || "9999-12-31"))
      || left.id.localeCompare(right.id));
}
