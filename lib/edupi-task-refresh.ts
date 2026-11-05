import type { EducationContract } from "./edupi-education-contract";

export type TaskRefreshRequirement = { boardRevision: number; taskRevision: number };

export function mergeTaskRefreshRequirement(previous: TaskRefreshRequirement | null, boardRevision = 0, taskRevision = 0): TaskRefreshRequirement {
  return { boardRevision: Math.max(previous?.boardRevision ?? 0, boardRevision), taskRevision: Math.max(previous?.taskRevision ?? 0, taskRevision) };
}

export function hasCommittedTaskStage(data: Pick<EducationContract, "tasks"> | null, taskId: string, minBoardRevision: number, stage: string): boolean {
  return Boolean(data?.tasks.some((task) => task.id === taskId && task.boardRevision >= minBoardRevision && task.boardStage === stage));
}

export const TASK_REFRESH_DELAYS_MS = [0, 250, 750, 1_500, 3_000] as const;

export function hasEveryTrackedTask(data: Pick<EducationContract, "tasks">, taskIds: ReadonlySet<string>): boolean {
  const visible = new Set(data.tasks.map((task) => task.id).filter((id): id is string => Boolean(id)));
  return [...taskIds].every((taskId) => visible.has(taskId));
}

export async function refreshUntilTaskVisible({
  taskId,
  minBoardRevision,
  minTaskRevision,
  read,
  signal,
  delays = TASK_REFRESH_DELAYS_MS,
  wait = (milliseconds: number) => new Promise<void>((resolve) => setTimeout(resolve, milliseconds)),
}: {
  taskId: string;
  minBoardRevision?: number;
  minTaskRevision?: number;
  read: (signal: AbortSignal) => Promise<Pick<EducationContract, "tasks">>;
  signal: AbortSignal;
  delays?: readonly number[];
  wait?: (milliseconds: number) => Promise<void>;
}): Promise<boolean> {
  if (delays.length === 0) return false;
  let attempt = 0;
  while (!signal.aborted) {
    const delay = delays[Math.min(attempt, delays.length - 1)];
    if (signal.aborted) return false;
    if (delay > 0) await wait(delay);
    if (signal.aborted) return false;
    try {
      const data = await read(signal);
      if (data.tasks.some((task) => task.id === taskId
        && (minBoardRevision === undefined || task.boardRevision >= minBoardRevision)
        && (minTaskRevision === undefined || task.revision >= minTaskRevision))) return true;
    } catch (error) {
      if (signal.aborted || error instanceof DOMException && error.name === "AbortError") return false;
    }
    attempt += 1;
  }
  return false;
}
