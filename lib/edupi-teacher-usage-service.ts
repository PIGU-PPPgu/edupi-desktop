import type { EduPiRuntimeHandle } from "./edupi-runtime-supervisor";
import { loadTeacherUsageDocuments, teacherUsageCanonical, teacherUsageDigest } from "./edupi-teacher-usage-documents.ts";
import { TeacherUsageOutbox, teacherUsageOutboxSummary, withTeacherUsageLock, type UsageEntry, type UsageOutboxState } from "./edupi-teacher-usage-outbox.ts";
import { TeacherUsageError, TEACHER_USAGE_ACTIONS, TEACHER_USAGE_SURFACES, TEACHER_USAGE_DOMAINS, TEACHER_USAGE_TARGETS, usageExact, usageHash, usageId, usageObject, usageRevision, usageScope, usageTime, validTeacherUsageEvent,
  type TeacherUsageConsent, type TeacherUsageDocuments } from "./edupi-teacher-usage-types.ts";

type Host = Pick<EduPiRuntimeHandle, "call" | "callOwnerControl">;
export type TeacherUsageServiceOptions = { host: Host; dataRoot: string; stateDir: string; registryPath?: string; maxEvents?: number };
const OWNER = /^[A-Za-z0-9_][A-Za-z0-9_.:-]{0,127}$/u;
function failure(code: string): never { throw new TeacherUsageError(code); }
function validConsent(value: unknown): value is TeacherUsageConsent {
  const consent = usageObject(value);
  return !!consent && usageRevision(consent.revision) && usageRevision(consent.start_after)
    && ["not_accepted", "accepted", "revoked"].includes(String(consent.status))
    && (consent.status === "accepted" ? usageHash(consent.consent_ref) : consent.consent_ref === null);
}
function documentConsentMatches(consent: TeacherUsageConsent, docs: TeacherUsageDocuments): boolean {
  return docs.configured && consent.status === "accepted" && consent.privacy_policy_version === docs.privacy_policy?.version
    && consent.privacy_policy_sha256 === docs.privacy_policy?.sha256 && consent.user_agreement_version === docs.user_agreement?.version
    && consent.user_agreement_sha256 === docs.user_agreement?.sha256;
}
function fields(body: Record<string, unknown>, required: string[], optional: string[] = []): void {
  if (!required.every(key => Object.hasOwn(body, key)) || Object.keys(body).some(key => !required.includes(key) && !optional.includes(key))) failure("teacher_usage_invalid_request");
}
function filters(body: Record<string, unknown>, batch = false): void {
  for (const key of ["after", "through_revision"]) if (body[key] !== undefined && !usageRevision(body[key])) failure("teacher_usage_invalid_request");
  if (body.limit !== undefined && (!Number.isSafeInteger(body.limit) || Number(body.limit) < 1 || Number(body.limit) > 100)) failure("teacher_usage_invalid_request");
  if (!batch && (body.session_id !== undefined && !usageId(body.session_id)
    || body.domain !== undefined && !TEACHER_USAGE_DOMAINS.includes(body.domain as typeof TEACHER_USAGE_DOMAINS[number]))) failure("teacher_usage_invalid_request");
}
export function validateTeacherUsageRequest(value: unknown): Record<string, unknown> {
  const body = usageObject(value);
  if (!body) failure("teacher_usage_invalid_request");
  switch (body.action) {
    case "read": fields(body, ["action"], ["session_id", "domain", "after", "limit"]); filters(body); break;
    case "upload_batch_read": fields(body, ["action", "through_revision"], ["after", "limit"]); filters(body, true); break;
    case "record": fields(body, ["action", "event"]); if (!validTeacherUsageEvent(body.event)) failure("teacher_usage_invalid_request"); break;
    case "event_prepare":
      fields(body, ["action", "event_id", "session_id", "target", "usage_action", "surface", "occurred_at"], ["expected_revision", "expected_fingerprint", "domain", "scope"]);
      if (!usageId(body.event_id) || !usageId(body.session_id) || !usageTime(body.occurred_at)
        || !TEACHER_USAGE_ACTIONS.includes(body.usage_action as typeof TEACHER_USAGE_ACTIONS[number])
        || !TEACHER_USAGE_SURFACES.includes(body.surface as typeof TEACHER_USAGE_SURFACES[number])
        || !usageExact(body.target, ["kind", "target_id"]) || !TEACHER_USAGE_TARGETS.includes(body.target.kind as typeof TEACHER_USAGE_TARGETS[number]) || !usageId(body.target.target_id, 300)
        || body.expected_revision !== undefined && !usageRevision(body.expected_revision)
        || body.expected_fingerprint !== undefined && !usageHash(body.expected_fingerprint)
        || body.domain !== undefined && !TEACHER_USAGE_DOMAINS.includes(body.domain as typeof TEACHER_USAGE_DOMAINS[number])
        || body.scope !== undefined && !usageScope(body.scope)) failure("teacher_usage_invalid_request");
      break;
    case "target_read": {
      fields(body, ["action", "target"], ["expected_revision", "expected_fingerprint"]);
      if (!usageExact(body.target, ["kind", "target_id"]) || !TEACHER_USAGE_TARGETS.includes(body.target.kind as typeof TEACHER_USAGE_TARGETS[number]) || !usageId(body.target.target_id, 300)
        || body.expected_revision !== undefined && !usageRevision(body.expected_revision)
        || body.expected_fingerprint !== undefined && !usageHash(body.expected_fingerprint)) failure("teacher_usage_invalid_request");
      break;
    }
    case "consent_set":
      if (!usageId(body.command_id) || !usageTime(body.at)) failure("teacher_usage_invalid_request");
      if (body.decision === "accept") {
        fields(body, ["action", "command_id", "decision", "at", "policy_ref", "checked", "viewed"]);
        if (!usageHash(body.policy_ref) || body.checked !== true || body.viewed !== true) failure("teacher_usage_invalid_request");
      } else if (body.decision === "revoke") fields(body, ["action", "command_id", "decision", "at"]);
      else failure("teacher_usage_invalid_request");
      break;
    case "erase_all": fields(body, ["action", "command_id", "requested_at"]); if (!usageId(body.command_id) || !usageTime(body.requested_at)) failure("teacher_usage_invalid_request"); break;
    case "retry": fields(body, ["action"]); break;
    default: failure("teacher_usage_invalid_request");
  }
  return body;
}
export async function createTeacherUsageService(options: TeacherUsageServiceOptions) {
  const health = await options.host.call("health", null);
  const healthResult = usageObject(health.result);
  const ownerResponse = await options.host.callOwnerControl("owner_read", {});
  const ownerRead = usageObject(ownerResponse.result);
  const owner = usageObject(ownerRead?.owner);
  if (ownerResponse.ok !== true || !owner || typeof owner.id !== "string" || !OWNER.test(owner.id)) failure("owner_uninitialized");
  if (!usageHash(healthResult?.data_root_fingerprint) || ownerRead?.root_ref !== healthResult.data_root_fingerprint) failure("usage_runtime_binding_invalid");
  const binding = { root_ref: healthResult.data_root_fingerprint, expected_owner_id: owner.id };
  const outbox = new TeacherUsageOutbox({ ...options, rootRef: binding.root_ref, ownerId: binding.expected_owner_id });
  const docs = (includeText = false) => loadTeacherUsageDocuments(options.registryPath, includeText);
  async function coreRead(extra: Record<string, unknown> = {}) {
    const response = await options.host.callOwnerControl("teacher_usage_read", { ...binding, ...extra });
    if (response.ok !== true) failure(String(response.error_code || "teacher_usage_unavailable"));
    const result = usageObject(response.result);
    if (!result || !usageRevision(result.revision) || !validConsent(result.consent) || !usageObject(result.summary) || !Array.isArray(result.events)) failure("usage_reply_unknown");
    return result as Record<string, unknown> & { revision: number; consent: TeacherUsageConsent };
  }
  function quarantine(state: UsageOutboxState, reason: string, predicate: (entry: UsageEntry) => boolean): void {
    for (const entry of state.entries) if (entry.status === "pending" && predicate(entry)) { entry.status = "quarantined"; entry.reason = reason; }
  }
  function synchronize(state: UsageOutboxState, consent: TeacherUsageConsent, currentDocs: TeacherUsageDocuments): void {
    const before = teacherUsageCanonical(state);
    quarantine(state, "teacher_usage_consent_stale", entry => entry.operation === "teacher_usage_record"
      && (!documentConsentMatches(consent, currentDocs) || entry.payload.consent_ref !== consent.consent_ref));
    quarantine(state, "usage_documents_changed", entry => entry.operation === "teacher_usage_consent_set" && entry.payload.action === "accept" && entry.policy_ref !== currentDocs.policy_ref);
    if (teacherUsageCanonical(state) !== before) outbox.save(state);
  }
  async function dispatch(state: UsageOutboxState, entry: UsageEntry): Promise<Record<string, unknown>> {
    if (entry.status === "quarantined") failure(entry.reason || "teacher_usage_consent_stale");
    if (entry.status === "confirmed") {
      if (entry.operation === "teacher_usage_erase_all") outbox.eraseOtherOwners();
      return entry.result!;
    }
    let response: Record<string, unknown>;
    try { response = await options.host.callOwnerControl(entry.operation, entry.payload); }
    catch { failure("usage_reply_unknown"); }
    if (response.ok !== true) {
      const code = typeof response.error_code === "string" && /^[a-z0-9_]{1,100}$/u.test(response.error_code) ? response.error_code : "teacher_usage_unavailable";
      if (["teacher_usage_conflict", "teacher_usage_capacity", "teacher_usage_target_stale", "teacher_usage_consent_stale", "teacher_usage_consent_required", "teacher_usage_invalid_request", "owner_identity_mismatch", "stale_root"].includes(code)) {
        entry.status = "quarantined"; entry.reason = code;
        if (code === "teacher_usage_capacity") state.stopped = true;
        outbox.save(state);
      }
      failure(code);
    }
    const result = usageObject(response.result);
    if (!result || result.external_send !== false || typeof result.replayed !== "boolean"
      || entry.operation === "teacher_usage_record" && (!usageHash(result.event_ref) || !usageRevision(result.sequence) || result.sequence === 0)
      || entry.operation !== "teacher_usage_record" && !validConsent(result.consent)
      || entry.operation === "teacher_usage_erase_all" && (!usageRevision(result.removed_events) || !usageRevision(result.through_revision))) failure("usage_reply_unknown");
    entry.status = "confirmed"; entry.result = result;
    if (entry.operation === "teacher_usage_consent_set" && entry.payload.action === "accept") state.stopped = false;
    if (entry.operation === "teacher_usage_erase_all") state.entries = [entry];
    outbox.save(state);
    if (entry.operation === "teacher_usage_erase_all") outbox.eraseOtherOwners();
    return result;
  }
  function makeEntry(body: Record<string, unknown>, operation: UsageEntry["operation"], payload: Record<string, unknown>, policyRef: string | null): UsageEntry {
    return { id: String(payload.event_id ?? payload.command_id), operation, payload, policy_ref: policyRef,
      input_digest: teacherUsageDigest(teacherUsageCanonical(body)), status: "pending", result: null, reason: null };
  }
  async function read(includeDocuments = false, filter: Record<string, unknown> = {}) {
    return withTeacherUsageLock(outbox.file, async () => {
      const result = await coreRead(filter);
      let currentDocs: TeacherUsageDocuments;
      try { currentDocs = docs(includeDocuments); }
      catch { currentDocs = { configured: false, policy_ref: null, error_code: "usage_documents_invalid" }; }
      const state = outbox.read();
      synchronize(state, result.consent, currentDocs);
      const usage = Object.fromEntries(Object.entries(result).filter(([key]) => key !== "root_ref"));
      return { usage, documents: currentDocs, outbox: teacherUsageOutboxSummary(state), collecting: !state.stopped && documentConsentMatches(result.consent, currentDocs), externalSend: false };
    });
  }
  async function perform(value: unknown): Promise<Record<string, unknown>> {
    const body = validateTeacherUsageRequest(value);
    if (body.action === "read") return read(false, Object.fromEntries(Object.entries(body).filter(([key]) => key !== "action")));
    return withTeacherUsageLock(outbox.file, async () => {
      const state = outbox.read();
      const snapshot = await coreRead();
      let currentDocs: TeacherUsageDocuments;
      try { currentDocs = docs(); } catch (error) {
        // Withdrawal and erasure stay reachable if host document configuration is broken.
        if (body.action !== "erase_all" && !(body.action === "consent_set" && body.decision === "revoke") && body.action !== "retry") throw error;
        currentDocs = { configured: false, policy_ref: null };
      }
      synchronize(state, snapshot.consent, currentDocs);
      const pendingControls = state.entries.filter(entry => entry.status === "pending" && entry.operation !== "teacher_usage_record");
      const submittedId = body.action === "record" ? usageObject(body.event)?.event_id : body.command_id;
      if (pendingControls.length && body.action !== "retry" && body.action !== "target_read"
        && !pendingControls.some(entry => entry.id === submittedId)) failure("usage_control_pending");
      if (body.action === "event_prepare") {
        if (state.stopped || !documentConsentMatches(snapshot.consent, currentDocs)) failure("teacher_usage_consent_required");
        const prior = state.entries.find(entry => entry.id === body.event_id);
        if (prior) {
          if (prior.operation !== "teacher_usage_record") failure("usage_outbox_conflict");
          const saved = prior.payload;
          const target = usageObject(saved.target)!;
          const requested = usageObject(body.target)!;
          if (saved.session_id !== body.session_id || target.kind !== requested.kind || target.target_id !== requested.target_id
            || saved.action !== body.usage_action || saved.surface !== body.surface
            || body.expected_revision !== undefined && target.expected_revision !== body.expected_revision
            || body.expected_fingerprint !== undefined && target.expected_fingerprint !== body.expected_fingerprint
            || body.domain !== undefined && saved.domain !== body.domain
            || body.scope !== undefined && teacherUsageCanonical(saved.scope) !== teacherUsageCanonical(body.scope)) failure("usage_outbox_conflict");
          if (prior.status === "quarantined" || saved.consent_ref !== snapshot.consent.consent_ref || prior.policy_ref !== currentDocs.policy_ref) failure(prior.reason || "teacher_usage_consent_stale");
          const event = Object.fromEntries(Object.entries(saved).filter(([key]) => !["root_ref", "expected_owner_id", "consent_ref"].includes(key)));
          return { event, status: prior.status, external_send: false };
        }
      }
      if (body.action === "target_read" || body.action === "event_prepare") {
        const response = await options.host.callOwnerControl("teacher_feedback_target_read", { ...binding, target: body.target });
        const target = usageObject(response.result);
        const requested = usageObject(body.target)!;
        if (response.ok !== true || !target || target.kind !== requested.kind || target.target_id !== requested.target_id
          || !usageRevision(target.revision) || !usageHash(target.fingerprint) || !usageScope(target.scope)
          || !TEACHER_USAGE_DOMAINS.includes(target.domain as typeof TEACHER_USAGE_DOMAINS[number])
          || body.expected_revision !== undefined && target.revision !== body.expected_revision
          || body.expected_fingerprint !== undefined && target.fingerprint !== body.expected_fingerprint) failure("teacher_usage_target_stale");
        if (body.action === "target_read") return { kind: target.kind, target_id: target.target_id, revision: target.revision, fingerprint: target.fingerprint, domain: target.domain, scope: target.scope };
        if (body.domain !== undefined && body.domain !== target.domain || body.scope !== undefined && teacherUsageCanonical(body.scope) !== teacherUsageCanonical(target.scope)) failure("teacher_usage_target_stale");
        const event = { event_id: body.event_id, session_id: body.session_id, domain: target.domain, scope: target.scope,
          target: { kind: target.kind, target_id: target.target_id, expected_revision: target.revision, expected_fingerprint: target.fingerprint },
          action: body.usage_action, surface: body.surface, occurred_at: body.occurred_at };
        const input = { action: "record", event };
        outbox.add(state, makeEntry(input, "teacher_usage_record", { ...event, ...binding, consent_ref: snapshot.consent.consent_ref }, currentDocs.policy_ref));
        return { event, status: "pending", external_send: false };
      }
      if (body.action === "upload_batch_read") {
        if (state.stopped || !documentConsentMatches(snapshot.consent, currentDocs)) failure("teacher_usage_consent_required");
        const filter = Object.fromEntries(Object.entries(body).filter(([key]) => key !== "action"));
        if (body.after !== undefined && Number(body.after) < snapshot.consent.start_after) failure("teacher_usage_consent_stale");
        const response = await options.host.callOwnerControl("teacher_usage_upload_batch_read", { ...binding, ...filter,
          after: body.after ?? snapshot.consent.start_after, consent_ref: snapshot.consent.consent_ref });
        if (response.ok !== true) failure(String(response.error_code || "teacher_usage_unavailable"));
        const result = usageObject(response.result);
        if (!result || result.external_send !== false || result.status !== "local_only") failure("usage_reply_unknown");
        return result;
      }
      if (body.action === "retry") {
        let retried = 0;
        for (const entry of state.entries.filter(item => item.status === "pending").slice(0, 20)) {
          if (entry.operation === "teacher_usage_record" && (state.stopped || !documentConsentMatches(snapshot.consent, currentDocs))) continue;
          await dispatch(state, entry); retried++;
        }
        return { retried, outbox: teacherUsageOutboxSummary(state), external_send: false };
      }
      const suppliedId = body.action === "record" ? String(usageObject(body.event)!.event_id) : String(body.command_id);
      const prior = state.entries.find(entry => entry.id === suppliedId);
      if (prior) {
        if (prior.input_digest !== teacherUsageDigest(teacherUsageCanonical(body))) failure("usage_outbox_conflict");
        return dispatch(state, prior);
      }
      let entry: UsageEntry;
      if (body.action === "record") {
        if (state.stopped || !documentConsentMatches(snapshot.consent, currentDocs)) failure("teacher_usage_consent_required");
        entry = makeEntry(body, "teacher_usage_record", { ...usageObject(body.event), ...binding, consent_ref: snapshot.consent.consent_ref }, currentDocs.policy_ref);
      } else if (body.action === "consent_set") {
        if (body.decision === "accept") {
          if (!currentDocs.configured) failure("usage_documents_unconfigured");
          if (body.policy_ref !== currentDocs.policy_ref) failure("usage_documents_changed");
          entry = makeEntry(body, "teacher_usage_consent_set", { ...binding, command_id: body.command_id, expected_revision: snapshot.consent.revision,
            action: "accept", confirmed_at: body.at, privacy_policy_version: currentDocs.privacy_policy!.version, privacy_policy_sha256: currentDocs.privacy_policy!.sha256,
            user_agreement_version: currentDocs.user_agreement!.version, user_agreement_sha256: currentDocs.user_agreement!.sha256 }, currentDocs.policy_ref);
        } else entry = makeEntry(body, "teacher_usage_consent_set", { ...binding, command_id: body.command_id,
          expected_revision: snapshot.consent.revision, action: "revoke", requested_at: body.at }, null);
        state.stopped = true;
        quarantine(state, "teacher_usage_consent_stale", item => item.operation === "teacher_usage_record" || item.payload.action === "accept");
      } else {
        entry = makeEntry(body, "teacher_usage_erase_all", { ...binding, command_id: body.command_id, expected_revision: snapshot.revision, action: "erase_all", requested_at: body.requested_at }, null);
        state.stopped = true;
        quarantine(state, "usage_erasure_pending", item => item.operation === "teacher_usage_record" || item.payload.action === "accept");
      }
      outbox.add(state, entry); // fsync finishes before the first Core mutation.
      return dispatch(state, entry);
    });
  }
  return { read, perform, outbox };
}
