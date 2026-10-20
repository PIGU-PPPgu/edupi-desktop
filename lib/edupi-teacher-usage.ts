import { desktopApiHeaders } from "./desktop-native";
import { TeacherUsageError, usageObject, validTeacherUsageEvent, type TeacherUsageEvent, type TeacherUsageStatus, type TeacherUsageAction, type TeacherUsageSurface, type TeacherUsageTargetKind, type TeacherUsageDomain } from "./edupi-teacher-usage-types";
export type { TeacherUsageEvent, TeacherUsageStatus, TeacherUsageAction, TeacherUsageSurface, TeacherUsageTargetKind } from "./edupi-teacher-usage-types";
export { TeacherUsageError } from "./edupi-teacher-usage-types";
type Fetcher = typeof fetch;
type HeadersProvider = typeof desktopApiHeaders;
export type TeacherUsageClientOptions = { fetcher?: Fetcher; headersProvider?: HeadersProvider; timeoutMs?: number };
async function request(body: Record<string, unknown> | null, options: TeacherUsageClientOptions = {}, documents = false) {
  const controller = new AbortController();
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([(async () => {
      const response = await (options.fetcher ?? fetch)(`/api/edupi/teacher-usage${documents ? "?documents=1" : ""}`, {
        method: body ? "POST" : "GET", cache: "no-store", signal: controller.signal,
        headers: await (options.headersProvider ?? desktopApiHeaders)(body ? { "content-type": "application/json" } : {}),
        ...(body ? { body: JSON.stringify(body) } : {}),
      });
      const value = usageObject(await response.json());
      if (!response.ok || value?.ok !== true) throw new TeacherUsageError(typeof value?.errorCode === "string" ? value.errorCode : "teacher_usage_unavailable");
      return value;
    })(), new Promise<never>((_resolve, reject) => { timer = setTimeout(() => { controller.abort(); reject(new TeacherUsageError("usage_reply_unknown")); }, options.timeoutMs ?? 12_000); })]);
  } catch (error) {
    if (error instanceof TeacherUsageError) throw error;
    throw new TeacherUsageError("usage_reply_unknown");
  } finally { if (timer) clearTimeout(timer); }
}
export async function readTeacherUsageStatus(options: TeacherUsageClientOptions = {}, documents = false): Promise<TeacherUsageStatus> {
  return await request(null, options, documents) as unknown as TeacherUsageStatus;
}
export async function isTeacherUsageRecordingEnabled(options: TeacherUsageClientOptions = {}): Promise<boolean> {
  try { return (await readTeacherUsageStatus(options)).collecting === true; } catch { return false; }
}
export async function prepareTeacherUsageEvent(input: {
  eventId: string; sessionId: string; target: { kind: TeacherUsageTargetKind; targetId: string; expectedRevision?: number; expectedFingerprint?: string };
  action: TeacherUsageAction; surface: TeacherUsageSurface; occurredAt: string; domain?: TeacherUsageDomain; scope?: { classId: string; subject: string };
}, options: TeacherUsageClientOptions = {}): Promise<TeacherUsageEvent> {
  const reply = await request({ action: "event_prepare", event_id: input.eventId, session_id: input.sessionId,
    usage_action: input.action, surface: input.surface, occurred_at: input.occurredAt,
    ...(input.domain === undefined ? {} : { domain: input.domain }), ...(input.scope === undefined ? {} : { scope: { class_id: input.scope.classId, subject: input.scope.subject } }),
    target: { kind: input.target.kind, target_id: input.target.targetId },
    ...(input.target.expectedRevision === undefined ? {} : { expected_revision: input.target.expectedRevision }),
    ...(input.target.expectedFingerprint === undefined ? {} : { expected_fingerprint: input.target.expectedFingerprint }) }, options);
  const event = usageObject(reply.result)?.event;
  if (!validTeacherUsageEvent(event)) throw new TeacherUsageError("teacher_usage_invalid_request");
  if (event.event_id !== input.eventId || event.session_id !== input.sessionId || event.target.kind !== input.target.kind || event.target.target_id !== input.target.targetId
    || event.action !== input.action || event.surface !== input.surface
    || input.target.expectedRevision !== undefined && event.target.expected_revision !== input.target.expectedRevision
    || input.target.expectedFingerprint !== undefined && event.target.expected_fingerprint !== input.target.expectedFingerprint
    || input.domain !== undefined && event.domain !== input.domain
    || input.scope && (input.scope.classId !== event.scope.class_id || input.scope.subject !== event.scope.subject)) throw new TeacherUsageError("usage_outbox_conflict");
  return event;
}
/** Reuse this event unchanged after any unknown reply; the server durably owns retries once received. */
export async function recordTeacherUsageEvent(event: TeacherUsageEvent, options: TeacherUsageClientOptions = {}) {
  if (!validTeacherUsageEvent(event)) throw new TeacherUsageError("teacher_usage_invalid_request");
  return (await request({ action: "record", event }, options)).result as { sequence: number; event_ref: string; replayed: boolean; external_send: false };
}
export async function setTeacherUsageConsent(command: { commandId: string; decision: "revoke"; at: string } | { commandId: string; decision: "accept"; at: string; policyRef: string; checked: true; viewed: true }, options: TeacherUsageClientOptions = {}) {
  return (await request({ action: "consent_set", command_id: command.commandId, decision: command.decision, at: command.at,
    ...(command.decision === "accept" ? { policy_ref: command.policyRef, checked: command.checked, viewed: command.viewed } : {}) }, options)).result;
}
export async function eraseTeacherUsage(command: { commandId: string; requestedAt: string }, options: TeacherUsageClientOptions = {}) {
  return (await request({ action: "erase_all", command_id: command.commandId, requested_at: command.requestedAt }, options)).result;
}
export async function retryTeacherUsageOutbox(options: TeacherUsageClientOptions = {}) { return (await request({ action: "retry" }, options)).result; }
/** Builds local aggregate bytes only; no receiver, network upload, or upload cursor is implemented. */
export async function readTeacherUsageBatch(input: { throughRevision: number; after?: number; limit?: number }, options: TeacherUsageClientOptions = {}) {
  return (await request({ action: "upload_batch_read", through_revision: input.throughRevision,
    ...(input.after === undefined ? {} : { after: input.after }), ...(input.limit === undefined ? {} : { limit: input.limit }) }, options)).result as Record<string, unknown>;
}
export function teacherUsageErrorLabel(error: unknown): string {
  const code = error instanceof TeacherUsageError ? error.code : "teacher_usage_unavailable";
  if (code === "usage_reply_unknown") return "回执未确认，请重试原操作";
  if (code === "usage_control_pending") return "请先重试待确认的同意或擦除操作";
  if (code === "usage_documents_unconfigured") return "尚未配置当前政策和协议，未开启收集";
  if (code === "usage_documents_invalid" || code === "usage_documents_changed") return "当前文档无法核对，收集已停止";
  if (code === "teacher_usage_consent_required" || code === "teacher_usage_consent_stale") return "当前同意已失效";
  if (code === "teacher_usage_target_stale") return "来源已变更，此次操作未计入";
  if (code.includes("capacity")) return "本地记录已满，收集已停止";
  if (code === "owner_uninitialized") return "教师授权尚未就绪";
  if (code.includes("invalid")) return "本地记录校验失败，收集已停止";
  if (code.includes("conflict")) return "记录身份冲突，请保留原记录";
  return "本地用量暂不可用";
}
