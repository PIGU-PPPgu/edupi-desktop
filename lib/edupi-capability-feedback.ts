import type { EducationWorkCase, TeacherTask } from "./edupi-education-contract";
import { desktopApiHeaders } from "./desktop-native";
import { TeacherFeedbackError, type TeacherFeedbackCapture, type TeacherFeedbackDomain, type TeacherFeedbackFetcher } from "./edupi-teacher-feedback";

export type CapabilityFeedbackBinding = {
  taskId: string;
  workCaseId: string;
  revision: number;
  decision: "accept" | "modify" | "reject" | "hold";
  status: "accepted" | "modified" | "rejected" | "held";
};
export type CapabilityFeedbackRecord = { feedback_id?: string; session_id?: string; current?: boolean; source_status?: string; decision?: string;
  target?: { kind?: string; target_id?: string; revision?: number; status?: string } };

const ID = /^[A-Za-z0-9][A-Za-z0-9._:@/+~=-]{0,159}$/;
const HASH = /^sha256:[a-f0-9]{64}$/;
const DOMAINS = new Set(["calendar_administration", "lesson_reflection", "parent_communication"]);
const record = (value: unknown): Record<string, unknown> | null => value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : null;

export function capabilityFeedbackMustRefresh(error: unknown): boolean {
  return error instanceof TeacherFeedbackError && ["teacher_feedback_target_stale", "teacher_feedback_target_missing",
    "teacher_feedback_conflict", "teacher_feedback_supersession_invalid", "invalid_feedback"].includes(error.code);
}

export function capabilityFeedbackBinding(task: Pick<TeacherTask, "id" | "trigger" | "status" | "revision" | "reviewedAt" | "reviewer" | "sourceEventId" | "externalSend">,
  workCase: Pick<EducationWorkCase, "id" | "taskId" | "kind" | "triggerId" | "currentState" | "externalSend"> | null): CapabilityFeedbackBinding | null {
  const decisions = { accepted: ["accept", "accepted"], modified: ["modify", "modified"], rejected: ["reject", "rejected"], hold: ["hold", "held"] } as const;
  const decision = task.status === "planned" ? null : decisions[task.status];
  if (!decision || task.trigger !== "capability_package" || !task.id || !ID.test(task.id) || !workCase
    || workCase.kind !== "capability_package" || !ID.test(workCase.id) || workCase.taskId !== task.id
    || workCase.triggerId !== task.sourceEventId || workCase.currentState !== decision[1]
    || task.externalSend !== false || workCase.externalSend !== false || !task.reviewer || !task.reviewedAt
    || !Number.isFinite(Date.parse(task.reviewedAt)) || !Number.isSafeInteger(task.revision) || task.revision < 1) return null;
  return { taskId: task.id, workCaseId: workCase.id, revision: task.revision, decision: decision[0], status: decision[1] };
}

export async function prepareCapabilityFeedback(binding: CapabilityFeedbackBinding, fetcher: TeacherFeedbackFetcher = fetch,
  headersProvider: typeof desktopApiHeaders = desktopApiHeaders): Promise<TeacherFeedbackCapture> {
  const response = await fetcher("/api/edupi/teacher-feedback", { method: "POST", cache: "no-store",
    headers: await headersProvider({ "Content-Type": "application/json" }), signal: AbortSignal.timeout(15_000),
    body: JSON.stringify({ action: "target_read", target: { kind: "capability_work", target_id: binding.workCaseId } }) });
  const body = record(await response.json().catch(() => null));
  const target = record(body?.result), scope = record(target?.scope), evidence = target?.evidence_ids;
  if (!response.ok || body?.ok !== true || !target || target.kind !== "capability_work" || target.target_id !== binding.workCaseId
    || body.externalSend !== false || target.revision !== binding.revision || target.status !== binding.status || target.external_send === true
    || typeof target.fingerprint !== "string" || !HASH.test(target.fingerprint) || !DOMAINS.has(String(target.domain))
    || !scope || typeof scope.class_id !== "string" || !ID.test(scope.class_id)
    || typeof scope.subject !== "string" || !scope.subject.trim() || scope.subject.length > 128
    || /[\u0000-\u001f\u007f]/.test(scope.subject) || !Array.isArray(evidence) || evidence.length === 0 || evidence.length > 500
    || evidence.some(value => typeof value !== "string" || !value || value.length > 240)) {
    throw new TeacherFeedbackError(response.status >= 500 ? "feedback_runtime_unavailable" : "teacher_feedback_target_stale", "反馈依据已变化，请刷新任务。");
  }
  return { commandId: `desktop-capability-feedback-${globalThis.crypto.randomUUID()}`, sessionId: "desktop-capability-feedback",
    domain: target.domain as TeacherFeedbackDomain, scope: { classId: scope.class_id, subject: scope.subject },
    target: { kind: "capability_work", targetId: binding.workCaseId, expectedRevision: binding.revision, expectedFingerprint: target.fingerprint },
    reviewedRevision: binding.revision, decision: binding.decision, usefulness: "not_observed", used: false,
    evidenceIds: [...new Set(evidence as string[])], occurredAt: new Date().toISOString() };
}

export function currentCapabilityFeedback(records: CapabilityFeedbackRecord[], binding: CapabilityFeedbackBinding): CapabilityFeedbackRecord | null {
  return records.find(row => row.current === true && row.source_status === "current" && row.session_id === "desktop-capability-feedback"
    && row.target?.kind === "capability_work" && row.target.target_id === binding.workCaseId && row.target.revision === binding.revision) ?? null;
}

/** A durable record can await source proof without becoming current evidence. */
export function recordedCapabilityFeedback(records: CapabilityFeedbackRecord[], binding: CapabilityFeedbackBinding,
  feedbackId?: string): { record: CapabilityFeedbackRecord; sourceStatus: "current" | "unverified" } | null {
  const candidates = feedbackId === undefined ? records : records.filter(row => row.feedback_id === feedbackId);
  const current = currentCapabilityFeedback(candidates, binding);
  if (current) return { record: current, sourceStatus: "current" };
  const pending = candidates.find(row => row.current === true && row.source_status === "unverified"
    && typeof row.feedback_id === "string" && Boolean(row.feedback_id) && row.session_id === "desktop-capability-feedback"
    && row.decision === binding.decision && row.target?.kind === "capability_work" && row.target.target_id === binding.workCaseId
    && row.target.revision === binding.revision && row.target.status === binding.status);
  return pending ? { record: pending, sourceStatus: "unverified" } : null;
}

export async function readCapabilityFeedbackRecords(): Promise<CapabilityFeedbackRecord[]> {
  const response = await fetch("/api/edupi/teacher-feedback", { headers: await desktopApiHeaders(), cache: "no-store", signal: AbortSignal.timeout(15_000) });
  const body = record(await response.json().catch(() => null)), result = record(body?.result);
  if (!response.ok || body?.ok !== true || !Array.isArray(result?.feedback)) throw new TeacherFeedbackError("feedback_runtime_unavailable", "反馈暂不可读取");
  return result.feedback as CapabilityFeedbackRecord[];
}
