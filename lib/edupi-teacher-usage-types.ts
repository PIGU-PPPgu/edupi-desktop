export const TEACHER_USAGE_ACTIONS = ["opportunity_visible", "draft_opened", "review_started", "review_dismissed", "manual_prepare", "manual_retry", "feedback_form_opened", "artifact_exported"] as const;
export const TEACHER_USAGE_SURFACES = ["today", "task", "chat", "artifact", "calendar", "student", "admin"] as const;
export const TEACHER_USAGE_DOMAINS = ["teaching_preparation", "student_followup", "lesson_reflection", "calendar_administration", "parent_communication", "safety_privacy"] as const;
export const TEACHER_USAGE_TARGETS = ["goal", "opportunity", "work_candidate", "follow_up", "capability_work", "artifact", "schedule_conflict"] as const;
export type TeacherUsageAction = typeof TEACHER_USAGE_ACTIONS[number];
export type TeacherUsageSurface = typeof TEACHER_USAGE_SURFACES[number];
export type TeacherUsageDomain = typeof TEACHER_USAGE_DOMAINS[number];
export type TeacherUsageTargetKind = typeof TEACHER_USAGE_TARGETS[number];
export type TeacherUsageEvent = {
  event_id: string; session_id: string; domain: TeacherUsageDomain;
  scope: { class_id: string; subject: string };
  target: { kind: TeacherUsageTargetKind; target_id: string; expected_revision: number; expected_fingerprint: string };
  action: TeacherUsageAction; surface: TeacherUsageSurface; occurred_at: string;
};
export type TeacherUsageConsent = {
  revision: number; status: "not_accepted" | "accepted" | "revoked"; consent_ref: string | null; start_after: number;
  privacy_policy_version: string | null; privacy_policy_sha256: string | null;
  user_agreement_version: string | null; user_agreement_sha256: string | null;
  confirmed_at: string | null; updated_at: string | null;
};
export type TeacherUsageDocument = { version: string; sha256: string; text?: string };
export type TeacherUsageDocuments = { configured: boolean; policy_ref: string | null; error_code?: string; privacy_policy?: TeacherUsageDocument; user_agreement?: TeacherUsageDocument };
export type TeacherUsageStatus = {
  usage: { revision: number; consent: TeacherUsageConsent; summary: { total_events: number; unique_targets: number; by_action: Record<TeacherUsageAction, number> }; events: unknown[]; next_after: number | null };
  documents: TeacherUsageDocuments; collecting: boolean;
  outbox: { pending: number; pending_control: number; confirmed: number; quarantined: number; stopped: boolean };
  externalSend: false;
};
export class TeacherUsageError extends Error {
  constructor(readonly code: string) { super(code); this.name = "TeacherUsageError"; }
}
export function usageObject(value: unknown): Record<string, unknown> | null {
  return value !== null && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : null;
}
export function usageExact(value: unknown, keys: readonly string[]): value is Record<string, unknown> {
  const object = usageObject(value);
  return !!object && Object.keys(object).length === keys.length && keys.every(key => Object.hasOwn(object, key));
}
export function usageId(value: unknown, max = 160): value is string {
  return typeof value === "string" && value.length <= max && /^[A-Za-z0-9][A-Za-z0-9._:@/+~=-]*$/u.test(value);
}
export function usageHash(value: unknown): value is string { return typeof value === "string" && /^sha256:[a-f0-9]{64}$/u.test(value); }
export function usageRevision(value: unknown): value is number { return Number.isSafeInteger(value) && Number(value) >= 0; }
export function usageTime(value: unknown): value is string {
  return typeof value === "string" && /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/u.test(value)
    && Number.isFinite(Date.parse(value)) && new Date(value).toISOString() === value;
}
export function usageTarget(value: unknown): value is TeacherUsageEvent["target"] {
  return usageExact(value, ["kind", "target_id", "expected_revision", "expected_fingerprint"])
    && TEACHER_USAGE_TARGETS.includes(value.kind as TeacherUsageTargetKind) && usageId(value.target_id, 300)
    && usageRevision(value.expected_revision) && usageHash(value.expected_fingerprint);
}
export function usageScope(value: unknown): value is TeacherUsageEvent["scope"] {
  return usageExact(value, ["class_id", "subject"]) && usageId(value.class_id)
    && typeof value.subject === "string" && value.subject.length > 0 && value.subject.length <= 128
    && !/[\u0000-\u001f\u007f]/u.test(value.subject);
}
export function validTeacherUsageEvent(value: unknown): value is TeacherUsageEvent {
  return usageExact(value, ["event_id", "session_id", "domain", "scope", "target", "action", "surface", "occurred_at"])
    && usageId(value.event_id) && usageId(value.session_id) && TEACHER_USAGE_DOMAINS.includes(value.domain as TeacherUsageDomain)
    && usageScope(value.scope) && usageTarget(value.target) && TEACHER_USAGE_ACTIONS.includes(value.action as TeacherUsageAction)
    && TEACHER_USAGE_SURFACES.includes(value.surface as TeacherUsageSurface) && usageTime(value.occurred_at);
}
