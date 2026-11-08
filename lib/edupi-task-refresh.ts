import type { EducationContract, TeacherTask } from "./edupi-education-contract";

type RawRecord = Record<string, unknown>;
export type TaskReviewRefreshRequirement = {
  before: Pick<TeacherTask, "id" | "trigger" | "sourceEventId" | "evidence" | "reviewHistory" | "revision"
    | "status" | "title" | "dueDate" | "deliverables" | "reviewedAt" | "reviewer" | "reviewNote">;
  decision: string;
  receipt: RawRecord;
  patch: { title?: string; dueDate?: string | null; deliverables?: string[] } | null;
};
export type TaskRefreshRequirement = { boardRevision: number; taskRevision: number; review?: TaskReviewRefreshRequirement };

export function mergeTaskRefreshRequirement(previous: TaskRefreshRequirement | null, boardRevision = 0, taskRevision = 0, review?: TaskReviewRefreshRequirement): TaskRefreshRequirement {
  const retainedReview = review ?? previous?.review;
  return { boardRevision: Math.max(previous?.boardRevision ?? 0, boardRevision), taskRevision: Math.max(previous?.taskRevision ?? 0, taskRevision),
    ...(retainedReview ? { review: retainedReview } : {}) };
}

function record(value: unknown): RawRecord | null {
  return value && typeof value === "object" && !Array.isArray(value) ? value as RawRecord : null;
}

function canonicalize(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(canonicalize);
  const source = record(value);
  return source ? Object.fromEntries(Object.keys(source).sort().map((key) => [key, canonicalize(source[key])])) : value;
}

function sameValue(left: unknown, right: unknown): boolean {
  return JSON.stringify(canonicalize(left)) === JSON.stringify(canonicalize(right));
}

export function hasCommittedTaskReview(data: Pick<EducationContract, "tasks"> & Partial<Pick<EducationContract, "workCases">>, requirement: TaskReviewRefreshRequirement): boolean {
  const { before, decision, receipt, patch } = requirement;
  const tasks = data.tasks.filter((task) => task.id === before.id);
  if (tasks.length !== 1) return false;
  const task = tasks[0], review = record(receipt.teacher_review), target = record(receipt.target);
  const history = task.reviewHistory;
  const committed = record(history[before.reviewHistory.length]);
  const capability = /^capability_task_[a-f0-9]{32}$/.test(String(before.id))
    && before.trigger === "capability_package" && before.evidence.material_kind === "capability_package";
  const expectedReviewId = capability ? receipt.receipt_id : record(receipt.rollback)?.rollback_id;
  const reviewState = (status: unknown) => status === "planned" ? "pending_review" : status === "hold" ? "held" : status;
  const statuses: Record<string, string> = { accept: "accepted", modify: "modified", reject: "rejected", hold: "held", rollback: "modified" };
  const expectedStatus = statuses[decision];
  const snapshotFields = ["status", "title", "due_date", "deliverables", "reviewed_at", "reviewer", "review_note", "revision"];
  const changedFields = ["status", "title", "due_date", "deliverables"];
  const snapshot = (value: typeof before): RawRecord => ({ status: value.status, title: value.title, due_date: value.dueDate,
    deliverables: value.deliverables, reviewed_at: value.reviewedAt, reviewer: value.reviewer,
    review_note: value.reviewNote, revision: value.revision });
  const validEntry = (entry: RawRecord, expectedRevision: number | null): boolean => {
    const previous = record(entry.before), next = record(entry.after);
    if (!previous || !next || typeof previous.revision !== "number" || !Number.isInteger(previous.revision) || previous.revision < 0
      || expectedRevision !== null && previous.revision !== expectedRevision
      || next.revision !== previous.revision + 1 || entry.previous_status !== previous.status || entry.next_status !== next.status
      || next.reviewed_at !== entry.reviewed_at || next.reviewer !== entry.reviewer || next.review_note !== entry.note
      || !Array.isArray(previous.deliverables) || !Array.isArray(next.deliverables)
      || !snapshotFields.every((field) => Object.hasOwn(previous, field) && Object.hasOwn(next, field))) return false;
    const action = String(entry.action);
    if (!Object.hasOwn(statuses, action) || capability && action === "rollback") return false;
    if (action !== "rollback" && Object.hasOwn(entry, "rollback_of") && entry.rollback_of !== null) return false;
    if (action !== "rollback" && next.status !== (action === "hold" ? "hold" : statuses[action])) return false;
    if (action !== "modify" && action !== "rollback" && changedFields.slice(1).some((field) => !sameValue(previous[field], next[field]))) return false;
    if (capability && changedFields.slice(1).some((field) => !sameValue(previous[field], next[field]))) return false;
    const expectedFields = capability ? action === "modify" ? ["status", "artifacts"] : ["status"]
      : changedFields.filter((field) => !sameValue(previous[field], next[field]));
    return (capability || expectedFields.length > 0) && sameValue(entry.changed_fields, expectedFields);
  };
  if (!review || !target || target.target_id !== before.id || target.target_kind !== "task"
    || target.command_type !== "review_task" || receipt.command_type !== "review_task" || receipt.decision !== decision
    || !expectedStatus || receipt.status !== expectedStatus
    || receipt.external_send !== false || task.externalSend !== false || task.requiresTeacherReview !== true || task.scope !== "teacher_internal"
    || task.sourceEventId !== before.sourceEventId || task.trigger !== before.trigger
    || task.evidence.source_entry_id !== before.evidence.source_entry_id || task.evidence.material_kind !== before.evidence.material_kind
    || history.length < before.reviewHistory.length + 1
    || !sameValue(history.slice(0, before.reviewHistory.length), before.reviewHistory)
    || !committed || typeof committed.review_id !== "string" || !committed.review_id.trim()
    || before.reviewHistory.some((entry) => entry.review_id === committed.review_id)
    || committed.action !== decision || committed.reviewer !== review.reviewer_id
    || committed.reviewed_at !== review.reviewed_at || committed.note !== review.note
    || review.revision !== before.revision + 1 || !validEntry(committed, before.revision)
    || !sameValue(committed.before, snapshot(before))
    || reviewState(record(committed.after)?.status) !== review.state
    || decision !== "rollback" && reviewState(record(committed.after)?.status) !== expectedStatus) return false;
  if (decision === "rollback") {
    const latest = record(before.reviewHistory.at(-1));
    const restored = record(latest?.before);
    if (capability || !latest || latest.action === "rollback" || committed.rollback_of !== latest.review_id
      || !restored || changedFields.some((field) => !sameValue(restored[field], record(committed.after)?.[field]))) return false;
  } else if (committed.review_id !== expectedReviewId) return false;
  const committedAfter = record(committed.after);
  if (decision === "modify" && (!patch || !committedAfter
    || Object.hasOwn(patch, "title") && committedAfter.title !== patch.title
    || Object.hasOwn(patch, "dueDate") && committedAfter.due_date !== patch.dueDate
    || Object.hasOwn(patch, "deliverables") && !sameValue(committedAfter.deliverables, patch.deliverables))) return false;

  let previousAfter = committedAfter;
  const reviewIds = new Set(before.reviewHistory.map((entry) => entry.review_id));
  const continuesCapabilityReview = (entryBefore: RawRecord | null, previous: RawRecord | null): boolean => {
    if (!entryBefore || !previous) return false;
    const revisionGap = Number(entryBefore.revision) - Number(previous.revision);
    return Number.isSafeInteger(entryBefore.revision) && revisionGap > 0
      && (sameValue(entryBefore.status, previous.status)
        || entryBefore.status === "planned" && ["accepted", "modified", "rejected", "hold"].includes(String(previous.status)))
      && snapshotFields.slice(1, -1).every((field) => sameValue(entryBefore[field], previous[field]));
  };
  for (let index = before.reviewHistory.length; index < history.length; index += 1) {
    const entry = record(history[index]);
    const prior = index === before.reviewHistory.length ? record(before.reviewHistory.at(-1)) : record(history[index - 1]);
    const restored = record(prior?.before), next = record(entry?.after), entryBefore = record(entry?.before);
    if (!entry || typeof entry.review_id !== "string" || !entry.review_id.trim() || reviewIds.has(entry.review_id)
      || !validEntry(entry, capability && index > before.reviewHistory.length ? null : before.revision + index - before.reviewHistory.length)
      || index > before.reviewHistory.length && (capability
        ? !sameValue(entry.before, previousAfter) && !continuesCapabilityReview(entryBefore, previousAfter)
        : !sameValue(entry.before, previousAfter))
      || entry.action === "rollback" && (!prior || prior.action === "rollback" || entry.rollback_of !== prior.review_id
        || !restored || !next || changedFields.some((field) => !sameValue(restored[field], next[field])))) return false;
    reviewIds.add(entry.review_id);
    previousAfter = record(entry.after);
  }
  const invalidatedCapability = capability && task.status === "planned" && task.contentStatus === "stale"
    && Number.isSafeInteger(task.revision) && task.revision > Number(previousAfter?.revision);
  const refreshedCapability = capability && task.status === "planned" && task.contentStatus !== "stale"
    && Number.isSafeInteger(task.revision) && task.revision > Number(previousAfter?.revision)
    && (() => {
      const cases = data.workCases?.filter((item) => item.taskId === task.id) ?? [];
      if (cases.length !== 1) return false;
      const workCase = cases[0];
      if (workCase.kind !== "capability_package" || workCase.triggerId !== task.sourceEventId
        || workCase.title !== task.title || workCase.dueDate !== task.dueDate
        || workCase.externalSend !== false || workCase.currentState !== task.contentStatus
        || !["planned", "queued", "running", "draft_ready", "failed"].includes(workCase.currentState)
        || workCase.transitions.at(-1)?.state !== workCase.currentState) return false;
      const lastReviewId = history.at(-1)?.review_id;
      const reviewIndex = workCase.transitions.findLastIndex((item) => item.sourceKind === "teacher_review"
        && item.sourceId === lastReviewId && item.occurredAt === task.reviewedAt);
      const stale = workCase.transitions[reviewIndex + 1];
      const refreshed = workCase.transitions[reviewIndex + 2];
      return reviewIndex >= 0 && stale?.state === "stale" && stale.sourceKind === "execution"
        && refreshed?.sourceKind === "execution" && ["planned", "queued", "held"].includes(refreshed?.state)
        && /^sha256:[a-f0-9]{64}$/.test(stale.sourceId) && refreshed.sourceId === stale.sourceId
        && stale.occurredAt >= task.reviewedAt! && refreshed.occurredAt >= stale.occurredAt
        && refreshed.sequence === stale.sequence + 1;
    })();
  return Boolean(previousAfter && (invalidatedCapability || refreshedCapability
    || task.revision === previousAfter.revision && task.status === previousAfter.status) && task.title === previousAfter.title
    && task.dueDate === previousAfter.due_date && sameValue(task.deliverables, previousAfter.deliverables)
    && task.reviewer === previousAfter.reviewer && task.reviewedAt === previousAfter.reviewed_at
    && task.reviewNote === previousAfter.review_note);
}

export function preservePendingTaskReviews(
  current: EducationContract | null, next: EducationContract,
  requirements: ReadonlyMap<string, TaskRefreshRequirement>,
): EducationContract {
  if (!current) return next;
  const pending = new Set([...requirements].filter(([, requirement]) => requirement.review
    && !hasCommittedTaskReview(next, requirement.review)).map(([id]) => id));
  if (pending.size === 0) return next;
  const previous = new Map(current.tasks.filter((task) => task.id !== null && pending.has(task.id)).map((task) => [task.id, task]));
  const tasks = next.tasks.filter((task) => !previous.has(task.id));
  for (const task of previous.values()) tasks.push(task);
  return { ...next, tasks };
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
  review,
  requirement,
  read,
  signal,
  delays = TASK_REFRESH_DELAYS_MS,
  wait = (milliseconds: number) => new Promise<void>((resolve) => setTimeout(resolve, milliseconds)),
}: {
  taskId: string;
  minBoardRevision?: number;
  minTaskRevision?: number;
  review?: TaskReviewRefreshRequirement;
  requirement?: () => TaskRefreshRequirement | undefined;
  read: (signal: AbortSignal) => Promise<Pick<EducationContract, "tasks"> & Partial<Pick<EducationContract, "workCases">>>;
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
      if (signal.aborted) return false;
      const latest = requirement?.();
      const requiredReview = latest?.review ?? review;
      const requiredBoardRevision = latest?.boardRevision ?? minBoardRevision;
      const requiredTaskRevision = latest?.taskRevision ?? minTaskRevision;
      if ((!requiredReview || hasCommittedTaskReview(data, requiredReview)) && data.tasks.filter((task) => task.id === taskId).length === 1 && data.tasks.some((task) => task.id === taskId
        && (requiredBoardRevision === undefined || task.boardRevision >= requiredBoardRevision)
        && (requiredTaskRevision === undefined || task.revision >= requiredTaskRevision))) return true;
    } catch (error) {
      if (signal.aborted || error instanceof DOMException && error.name === "AbortError") return false;
    }
    attempt += 1;
  }
  return false;
}
