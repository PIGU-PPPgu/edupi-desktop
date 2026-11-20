import { randomUUID } from "node:crypto";
import path from "node:path";
import {
  mutateEduPiTeacherTemplateConfig, parseEduPiTeacherTemplateBinding, readEduPiTeacherTemplateConfig, writeEduPiTeacherTemplateConfig,
  teacherTemplateFail, teacherTemplateHash, teacherTemplateId, teacherTemplateKeys, teacherTemplateTime,
  validTeacherTemplateIds, validTeacherTemplateScope,
  type EduPiTeacherTemplateBinding, type EduPiTeacherTemplateConfig, type EduPiTeacherTemplateMutation, type EduPiTeacherTemplateRoot,
  type EduPiTeacherTemplateScope,
} from "./edupi-teacher-template-config";

/** Trusted adapters only; no supervisor startup, route dispatch or model side effects on import. */
export type EduPiTeacherTemplateTransport = {
  call(operation: string, payload: unknown, signal?: AbortSignal): Promise<unknown>;
  callOwnerControl(operation: string, payload: unknown, signal?: AbortSignal): Promise<unknown>;
};
export type EduPiTeacherTemplateRuntimeOptions = EduPiTeacherTemplateRoot & { rootRef: string; now?: string; signal?: AbortSignal };
export type EduPiTeacherTemplateGrantSelection = {
  templateIds: readonly string[]; scope: EduPiTeacherTemplateScope; endsAt: string;
};
export type EduPiTeacherTemplateBindingProof = Readonly<{
  binding: EduPiTeacherTemplateBinding; grantVersion: number; updatedAt: string; rootRef: string;
}>;
export type EduPiTeacherTemplateBindingProofOptions = Pick<EduPiTeacherTemplateRuntimeOptions, "dataRoot" | "rootRef" | "now" | "signal">;
type Grant = {
  id: string; version: number; status: "active" | "paused" | "revoked"; scope: EduPiTeacherTemplateScope;
  domains: string[]; actions: string[]; source_ids: string[];
  starts_at: string; ends_at: string; updated_at: string; budget: { id: string; max_calls: number };
};
type OwnerRead = { ownerId: string | null; grants: Grant[]; controlAvailable: boolean };
const HASH = /^sha256:[a-f0-9]{64}$/u;
const GRANT_PREFIX = "desktop_teacher_template_";
const BASE_FRAME = ["protocol", "protocol_version", "producer", "request_id", "operation"];
function invalid(): never { return teacherTemplateFail("teacher_template_response_invalid"); }
function denied(): never { return teacherTemplateFail("teacher_template_grant_denied"); }
function object(value: unknown): Record<string, unknown> | null {
  if (!value || typeof value !== "object" || Array.isArray(value)
    || ![Object.prototype, null].includes(Object.getPrototypeOf(value))) return null;
  return Reflect.ownKeys(value).every(key => {
    const descriptor = Object.getOwnPropertyDescriptor(value, key);
    return typeof key === "string" && descriptor?.enumerable && Object.hasOwn(descriptor, "value");
  }) ? value as Record<string, unknown> : null;
}
function plainArray(value: unknown): value is unknown[] {
  if (!Array.isArray(value) || Object.getPrototypeOf(value) !== Array.prototype
    || Reflect.ownKeys(value).length !== value.length + 1) return false;
  for (let index = 0; index < value.length; index++) {
    const slot = Object.getOwnPropertyDescriptor(value, index);
    if (!slot?.enumerable || !Object.hasOwn(slot, "value")) return false;
  }
  return true;
}
function list(value: unknown, validate: (item: unknown) => boolean): value is string[] {
  if (!plainArray(value) || value.length < 1 || value.length > 128) return false;
  const items: string[] = [];
  for (let index = 0; index < value.length; index++) {
    const slot = Object.getOwnPropertyDescriptor(value, index);
    if (!slot?.enumerable || !Object.hasOwn(slot, "value") || typeof slot.value !== "string"
      || !validate(slot.value) || items.includes(slot.value)) return false;
    items.push(slot.value);
  }
  return true;
}
const coreId = (value: unknown): value is string => typeof value === "string" && /^[\w.:-]{1,128}$/u.test(value);
const equalScope = (a: EduPiTeacherTemplateScope, b: EduPiTeacherTemplateScope) => a.class_id === b.class_id && a.subject === b.subject;
const equalList = (a: readonly string[], b: readonly string[]) => {
  const right = [...b].sort();
  return a.length === b.length && [...a].sort().every((item, index) => item === right[index]);
};
function coreScope(value: unknown): value is EduPiTeacherTemplateScope {
  return teacherTemplateKeys(value, ["class_id", "subject"]) && typeof value.class_id === "string"
    && /^[\w.:-]{1,128}$/u.test(value.class_id) && typeof value.subject === "string" && Boolean(value.subject.trim())
    && value.subject.length <= 128 && !/[\u0000-\u001f\u007f]/u.test(value.subject);
}
export const teacherTemplateGrantSource = (templateId: string): string => `teacher_template:${templateId}`;
export function teacherTemplateTaskId(clientRequestId: string): string {
  if (typeof clientRequestId !== "string" || !/^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/iu.test(clientRequestId)) {
    teacherTemplateFail("teacher_template_invalid_input");
  }
  return `teacher-task-${clientRequestId.toLowerCase()}`;
}
function now(options: { now?: string }): string {
  const value = options.now ?? new Date().toISOString();
  if (!teacherTemplateTime(value)) teacherTemplateFail("teacher_template_invalid_input");
  return value;
}
function checkAbort(options: { signal?: AbortSignal }): void {
  if (options.signal?.aborted) throw options.signal.reason;
}
function parseOwnerRead(value: unknown, rootRef: string): OwnerRead {
  const response = object(value), result = object(response?.result);
  if (response?.ok !== true || !result || result.version !== 1 || result.root_ref !== rootRef
    || !Number.isSafeInteger(result.revision) || Number(result.revision) < 0
    || typeof result.control_available !== "boolean" || !teacherTemplateTime(result.received_at)
    || result.apply !== false || result.live_authority !== false || result.external_send !== false
    || !plainArray(result.grants) || result.grants.length > 128) invalid();
  let ownerId: string | null = null;
  if (result.owner !== null) {
    const owner = result.owner;
    if (!teacherTemplateKeys(owner, ["id", "root_ref", "created_at", "kind"]) || !coreId(owner.id)
      || owner.root_ref !== rootRef || owner.kind !== "local_owner" || !teacherTemplateTime(owner.created_at)) invalid();
    ownerId = owner.id;
  }
  const grants = result.grants.map((raw: unknown): Grant => {
    if (!teacherTemplateKeys(raw, ["id", "scope", "domains", "actions", "source_ids", "starts_at", "ends_at", "budget", "version", "status", "updated_at"])
      || !coreId(raw.id) || !coreScope(raw.scope)
      || !Number.isSafeInteger(raw.version) || Number(raw.version) < 1 || typeof raw.status !== "string" || !["active", "paused", "revoked"].includes(raw.status)
      || !teacherTemplateTime(raw.starts_at) || !teacherTemplateTime(raw.ends_at) || !teacherTemplateTime(raw.updated_at)
      || raw.starts_at >= raw.ends_at
      || !list(raw.domains, item => typeof item === "string" && ["teaching_preparation", "student_followup", "lesson_reflection", "calendar_administration", "parent_communication", "safety_privacy"].includes(item))
      || !list(raw.actions, item => item === "prepare" || item === "update") || !list(raw.source_ids, coreId)
      || !teacherTemplateKeys(raw.budget, ["id", "max_calls"]) || !coreId(raw.budget.id)
      || !Number.isSafeInteger(raw.budget.max_calls) || Number(raw.budget.max_calls) < 0) invalid();
    return structuredClone(raw) as Grant;
  });
  if (new Set(grants.map(grant => grant.id)).size !== grants.length || !ownerId && grants.length) invalid();
  return { ownerId, grants, controlAvailable: result.control_available };
}
async function readOwner(host: Pick<EduPiTeacherTemplateTransport, "call">,
  options: Pick<EduPiTeacherTemplateRuntimeOptions, "rootRef" | "signal">): Promise<OwnerRead> {
  if (!HASH.test(options.rootRef)) teacherTemplateFail("teacher_template_invalid_input");
  checkAbort(options);
  const response = await host.call("owner_read", { root_ref: options.rootRef }, options.signal);
  checkAbort(options);
  return parseOwnerRead(response, options.rootRef);
}
function dedicatedGrant(grant: Grant, binding: EduPiTeacherTemplateBinding): boolean {
  return grant.id === binding.grantId && grant.id.startsWith(GRANT_PREFIX) && equalScope(grant.scope, binding.scope)
    && equalList(grant.domains, ["calendar_administration"]) && equalList(grant.actions, ["update"])
    && equalList(grant.source_ids, binding.templateIds.map(teacherTemplateGrantSource)) && grant.budget.max_calls === 0;
}
function activeGrant(grant: Grant, at: string): boolean {
  return grant.status === "active" && grant.starts_at <= at && grant.updated_at <= at && grant.ends_at > at;
}
function bindingProofSnapshot(snapshot: EduPiTeacherTemplateConfig,
  options: EduPiTeacherTemplateBindingProofOptions): EduPiTeacherTemplateBindingProof {
  if (!teacherTemplateKeys(snapshot, ["version", "dataRootHash", "updatedAt", "enabled", "binding", "grantVersion"])
    || snapshot.version !== 1 || typeof snapshot.dataRootHash !== "string" || !HASH.test(snapshot.dataRootHash)
    || !teacherTemplateTime(snapshot.updatedAt) || typeof snapshot.enabled !== "boolean"
    || typeof options.rootRef !== "string" || !HASH.test(options.rootRef)
    || typeof options.dataRoot !== "string" || !path.isAbsolute(options.dataRoot)) teacherTemplateFail("teacher_template_invalid_input");
  if (!snapshot.enabled || snapshot.dataRootHash !== teacherTemplateHash(path.resolve(options.dataRoot))) denied();
  const binding = parseEduPiTeacherTemplateBinding(snapshot.binding);
  if (!binding || !Number.isSafeInteger(snapshot.grantVersion) || Number(snapshot.grantVersion) < 1) {
    teacherTemplateFail("teacher_template_invalid_input");
  }
  now(options); checkAbort(options);
  return Object.freeze({ binding, grantVersion: snapshot.grantVersion!, updatedAt: snapshot.updatedAt, rootRef: options.rootRef });
}
function proveOwnerRead(proof: EduPiTeacherTemplateBindingProof, state: OwnerRead,
  options: EduPiTeacherTemplateBindingProofOptions): EduPiTeacherTemplateBindingProof {
  checkAbort(options);
  const grant = state.grants.find(item => item.id === proof.binding.grantId);
  if (!state.controlAvailable || state.ownerId !== proof.binding.ownerId || !grant || grant.version !== proof.grantVersion
    || !dedicatedGrant(grant, proof.binding) || !activeGrant(grant, now(options))) denied();
  return proof;
}
/**
 * Validate a captured full owner_read response after a template-free probe is closed.
 * This does not fetch or make an old response fresh. The caller must retain the verified
 * ready fingerprint, recheck config.updatedAt, and perform another live read after startup.
 */
export function inspectEduPiTeacherTemplateBindingProof(snapshot: EduPiTeacherTemplateConfig, ownerReadResponse: unknown,
  options: EduPiTeacherTemplateBindingProofOptions): EduPiTeacherTemplateBindingProof {
  options = { ...options };
  const proof = bindingProofSnapshot(snapshot, options);
  return proveOwnerRead(proof, parseOwnerRead(ownerReadResponse, proof.rootRef), options);
}
/** One fresh owner_read against the supplied handle. No config IO, runtime discovery/start, grant mutation or environment gates. */
export async function readEduPiTeacherTemplateBindingProof(host: Pick<EduPiTeacherTemplateTransport, "call">,
  snapshot: EduPiTeacherTemplateConfig, options: EduPiTeacherTemplateBindingProofOptions): Promise<EduPiTeacherTemplateBindingProof> {
  options = { ...options };
  const proof = bindingProofSnapshot(snapshot, options);
  return proveOwnerRead(proof, await readOwner(host, options), options);
}
async function control(host: EduPiTeacherTemplateTransport, options: EduPiTeacherTemplateRuntimeOptions,
  ownerId: string | null, command: Record<string, unknown>): Promise<{ ownerId: string; grantVersion: number | null }> {
  checkAbort(options);
  const commandId = `desktop-teacher-template-${randomUUID()}`;
  const raw = await host.callOwnerControl("owner_control", {
    command_id: commandId, root_ref: options.rootRef, expected_owner_id: ownerId, ...command,
  }, options.signal);
  checkAbort(options);
  const response = object(raw), result = object(response?.result);
  if (response?.ok === false) denied();
  if (response?.ok !== true || !result || result.command_id !== commandId || result.root_ref !== options.rootRef
    || !coreId(result.owner_id) || ownerId !== null && result.owner_id !== ownerId
    || result.grant_id !== (command.grant_id ?? null)
    || (command.action === "bootstrap" ? result.grant_version !== null
      : result.grant_version !== Number(command.expected_version) + 1)) invalid();
  if (!result || result.apply !== false || result.live_authority !== false || result.external_send !== false
    || !Number.isSafeInteger(result.revision) || Number(result.revision) < 1 || !teacherTemplateTime(result.received_at)) invalid();
  return { ownerId: String(result.owner_id), grantVersion: result.grant_version as number | null };
}
/**
 * The caller supplies the teacher's explicit selection and exact scope, never owner/grant IDs.
 * Bootstrap/control receipts and the final owner read supply those identities. No template is auto-selected.
 */
export async function prepareEduPiTeacherTemplateGrant(host: EduPiTeacherTemplateTransport, selection: EduPiTeacherTemplateGrantSelection,
  options: EduPiTeacherTemplateRuntimeOptions & Pick<EduPiTeacherTemplateMutation, "expectedUpdatedAt">) {
  if (!teacherTemplateKeys(selection, ["templateIds", "scope", "endsAt"]) || !validTeacherTemplateIds(selection.templateIds)
    || !validTeacherTemplateScope(selection.scope) || !teacherTemplateTime(selection.endsAt)
    || selection.endsAt <= now(options) || selection.templateIds.some(id => !coreId(teacherTemplateGrantSource(id)))) {
    teacherTemplateFail("teacher_template_invalid_input");
  }
  selection = structuredClone(selection);
  options = { ...options };
  const config = await mutateEduPiTeacherTemplateConfig(options, async current => {
    const previousBinding = parseEduPiTeacherTemplateBinding(current?.binding);
    if (previousBinding && !equalScope(previousBinding.scope, selection.scope)) {
      teacherTemplateFail("teacher_template_config_conflict");
    }
    let state = await readOwner(host, options);
    if (!state.controlAvailable) teacherTemplateFail("teacher_template_owner_unavailable");
    if (previousBinding && state.ownerId !== previousBinding.ownerId) denied();
    if (!state.ownerId) {
      const boot = await control(host, options, null, { action: "bootstrap" });
      state = await readOwner(host, options);
      if (state.ownerId !== boot.ownerId) invalid();
    }
    if (!state.ownerId) invalid();
    const identity = teacherTemplateHash(JSON.stringify([
      options.rootRef, state.ownerId, selection.scope.class_id, selection.scope.subject,
    ])).slice(7, 39);
    // Keep a verified prior binding, including a pre-scope-ID binding, so already-created
    // templates retain their Core _activation_binding when explicit selections change.
    const binding = parseEduPiTeacherTemplateBinding({ ownerId: state.ownerId,
      grantId: previousBinding?.grantId ?? `${GRANT_PREFIX}${identity}`,
      scope: selection.scope, templateIds: selection.templateIds });
    if (!binding) teacherTemplateFail("teacher_template_invalid_input");
    let grant = state.grants.find(item => item.id === binding.grantId);
    if (previousBinding) {
      if (!grant || grant.version !== current?.grantVersion || !dedicatedGrant(grant, previousBinding) || grant.status === "revoked") denied();
    } else if (grant) denied(); // Never adopt an orphan/unknown grant, even if its new desired sources happen to match.
    const endsAt = grant && grant.ends_at > selection.endsAt ? grant.ends_at : selection.endsAt;
    const changedSources = grant && !equalList(grant.source_ids, binding.templateIds.map(teacherTemplateGrantSource));
    const resumeUnconfirmedStop = current?.enabled === false && grant?.status === "active";
    if (!grant || grant.ends_at !== endsAt || changedSources || resumeUnconfirmedStop) {
      const applied = await control(host, options, binding.ownerId, { action: grant ? "update" : "create",
        grant_id: binding.grantId, expected_version: grant?.version ?? 0, spec: {
          scope: binding.scope, domains: ["calendar_administration"], actions: ["update"],
          source_ids: binding.templateIds.map(teacherTemplateGrantSource),
          starts_at: grant?.starts_at ?? now(options), ends_at: endsAt,
          budget: grant?.budget ?? { id: `teacher_template_budget_${identity}`, max_calls: 0 },
        } });
      state = await readOwner(host, options);
      grant = state.grants.find(item => item.id === binding.grantId);
      if (state.ownerId !== binding.ownerId || !grant || grant.version !== applied.grantVersion || !dedicatedGrant(grant, binding)
        || grant.ends_at !== endsAt) invalid();
    }
    if (!grant) invalid();
    if (grant.status === "paused") {
      const resumed = await control(host, options, binding.ownerId, { action: "resume", grant_id: binding.grantId, expected_version: grant.version });
      state = await readOwner(host, options);
      grant = state.grants.find(item => item.id === binding.grantId);
      if (state.ownerId !== binding.ownerId || !grant || grant.version !== resumed.grantVersion) invalid();
    }
    if (!state.controlAvailable || !grant || !dedicatedGrant(grant, binding) || !activeGrant(grant, now(options))) denied();
    return { enabled: true, binding, grantVersion: grant.version };
  });
  return { config, binding: parseEduPiTeacherTemplateBinding(config.binding)!, grantVersion: config.grantVersion! };
}
export type EduPiTeacherTemplateStopOptions = EduPiTeacherTemplateRuntimeOptions
  & Pick<EduPiTeacherTemplateMutation, "expectedUpdatedAt"> & {
    /** Trusted server callback. Resolve only after the current template host is closed or isolated. */
    onLocalStop?: (config: Readonly<EduPiTeacherTemplateConfig>) => Promise<void>;
  };
export type EduPiTeacherTemplateLocalFirstStopResult = {
  /** Persisted stop snapshot; a newer explicit config mutation may supersede it. */
  config: EduPiTeacherTemplateConfig;
  localStatus: "disabled" | "superseded" | "unknown";
  runtimeStatus: "verified" | "unknown";
  coreStatus: "paused" | "revoked" | "missing" | "unknown";
  grantVersion: number | null;
};
export type EduPiTeacherTemplatePauseResult = EduPiTeacherTemplateLocalFirstStopResult;
/**
 * Persist the local stop before touching any host or Core transport. A remote failure never
 * re-enables the config. The callback must close/isolate the resident host before remote pause;
 * callers may pass a lazy template-free transport if closing the host retires its old handle.
 * Local, runtime and Core results are independent; local disabled alone is not a safe-stop receipt.
 */
export async function pauseEduPiTeacherTemplateGrant(host: EduPiTeacherTemplateTransport,
  options: EduPiTeacherTemplateStopOptions): Promise<EduPiTeacherTemplateLocalFirstStopResult> {
  options = { ...options };
  let config = await writeEduPiTeacherTemplateConfig({ enabled: false }, options);
  let runtimeStatus: EduPiTeacherTemplateLocalFirstStopResult["runtimeStatus"] = "unknown";
  let coreStatus: EduPiTeacherTemplateLocalFirstStopResult["coreStatus"] = "unknown";
  let grantVersion: number | null = null;
  if (options.onLocalStop) {
    try {
      await options.onLocalStop(Object.freeze({ ...config, binding: parseEduPiTeacherTemplateBinding(config.binding) }));
      runtimeStatus = "verified";
    } catch { /* The durable stop is retained; never claim an unverified host closure. */ }
  }
  try {
    config = await mutateEduPiTeacherTemplateConfig({ ...options, expectedUpdatedAt: config.updatedAt }, async current => {
      const binding = parseEduPiTeacherTemplateBinding(current?.binding);
      if (!binding) { coreStatus = "missing"; return { enabled: false }; }
      let state = await readOwner(host, options);
      if (!state.controlAvailable || state.ownerId !== binding.ownerId) denied();
      let grant = state.grants.find(item => item.id === binding.grantId);
      if (!grant) { coreStatus = "missing"; return { enabled: false }; }
      if (!dedicatedGrant(grant, binding)) denied();
      if (grant.status === "active") {
        const paused = await control(host, options, binding.ownerId, {
          action: "pause", grant_id: binding.grantId, expected_version: grant.version,
        });
        state = await readOwner(host, options);
        grant = state.grants.find(item => item.id === binding.grantId);
        if (!state.controlAvailable || state.ownerId !== binding.ownerId || !grant || grant.status !== "paused"
          || grant.version !== paused.grantVersion || !dedicatedGrant(grant, binding)) invalid();
      }
      grantVersion = grant.version;
      coreStatus = grant.status;
      return { enabled: false, grantVersion };
    });
  } catch {
    coreStatus = "unknown";
    grantVersion = null;
  }
  const latest = readEduPiTeacherTemplateConfig(options);
  const localStatus = latest.status !== "ready" || !latest.config ? "unknown"
    : latest.config.updatedAt !== config.updatedAt ? "superseded" : latest.config.enabled ? "unknown" : "disabled";
  return { config, localStatus, runtimeStatus, coreStatus, grantVersion };
}
/**
 * Header routing predicate only. Core remains authoritative for source/currentness/CAS/proposal refs.
 * Snapshot, generated listing and artifact read are the fc89 paths that pass teacherTemplateAccess;
 * they do not authorize writes, and Core still checks each artifact and its retained activation.
 */
export function isOwnerAuthorizedTemplateBridge(request: unknown, bindingValue: unknown): boolean {
  const binding = parseEduPiTeacherTemplateBinding(bindingValue);
  if (!binding || !teacherTemplateKeys(request, BASE_FRAME, ["action", "input", "envelope", "schedule_occurrence_version"])
    || request.protocol !== "edupi-desktop-bridge" || request.protocol_version !== 1 || request.producer !== "edupi-desktop"
    || !teacherTemplateId(request.request_id)) return false;
  if (request.operation === "snapshot") return teacherTemplateKeys(request, BASE_FRAME, ["schedule_occurrence_version"])
    && (request.schedule_occurrence_version === undefined || request.schedule_occurrence_version === "1.2");
  if (request.operation === "generated-artifacts") return teacherTemplateKeys(request, [...BASE_FRAME, "action"]) && request.action === "list";
  if (request.operation === "preparation-artifacts") return teacherTemplateKeys(request, [...BASE_FRAME, "action", "input"])
    && request.action === "read" && teacherTemplateKeys(request.input, ["artifact_id"], ["revision"])
    && typeof request.input.artifact_id === "string" && /^artifact_[a-f0-9]{32}$/u.test(request.input.artifact_id)
    && (request.input.revision === undefined || Number.isSafeInteger(request.input.revision) && Number(request.input.revision) >= 1);
  if (request.operation !== "command" || !teacherTemplateKeys(request, [...BASE_FRAME, "envelope"])) return false;
  const envelope = object(request.envelope), command = object(envelope?.command), review = object(envelope?.teacher_review);
  if (!envelope || envelope.external_send !== false || review?.reviewer_id !== binding.ownerId || !command) return false;
  if (command.command_type === "create_task") {
    const task = object(command.task), recurrence = object(task?.recurrence);
    return typeof task?.task_id === "string" && binding.templateIds.includes(task.task_id)
      && recurrence?.kind === "teacher_internal_materials" && task.preparation_source == null;
  }
  if (typeof command.task_id !== "string" || !binding.templateIds.includes(command.task_id)
    || !Number.isSafeInteger(command.expected_revision) || Number(command.expected_revision) < 0) return false;
  if (command.command_type === "move_task_stage") return command.to_stage === "done" || command.to_stage === "progress";
  return command.command_type === "review_task" && typeof command.decision === "string" && ["accept", "modify", "reject", "hold"].includes(command.decision)
    && (command.decision !== "modify" || object(command.patch) !== null);
}
/** Fresh proof for one selected template; private config alone never elevates a request. */
export async function ownerForSelectedTemplate(host: EduPiTeacherTemplateTransport, templateId: string,
  options: EduPiTeacherTemplateRuntimeOptions): Promise<string | null> {
  options = { ...options };
  const { config } = readEduPiTeacherTemplateConfig(options);
  const binding = config?.enabled ? parseEduPiTeacherTemplateBinding(config.binding) : null;
  if (!binding || !binding.templateIds.includes(templateId)) return null;
  const proof = await readEduPiTeacherTemplateBindingProof(host, config!, options);
  if (readEduPiTeacherTemplateConfig(options).config?.updatedAt !== config?.updatedAt) denied();
  return proof.binding.ownerId;
}
export async function ownerForTeacherTemplateBridge(host: EduPiTeacherTemplateTransport, request: unknown,
  options: EduPiTeacherTemplateRuntimeOptions): Promise<string | null> {
  options = { ...options };
  const { config } = readEduPiTeacherTemplateConfig(options), binding = parseEduPiTeacherTemplateBinding(config?.binding);
  if (!binding || !isOwnerAuthorizedTemplateBridge(request, binding)) return null;
  const frame = request as Record<string, unknown>;
  if (frame.operation === "command") {
    const command = object(object(frame.envelope)?.command)!;
    const templateId = command.command_type === "create_task" ? object(command.task)!.task_id : command.task_id;
    const reducing = command.command_type === "move_task_stage" && command.to_stage === "done"
      || command.command_type === "review_task" && typeof command.decision === "string" && ["reject", "hold"].includes(command.decision);
    if (!reducing) return ownerForSelectedTemplate(host, String(templateId), options);
  }
  const state = await readOwner(host, options);
  // Stopped/expired/revoked automation can retain owner-only history, never current/edit authority.
  if (!state.controlAvailable || state.ownerId !== binding.ownerId) denied();
  if (readEduPiTeacherTemplateConfig(options).config?.updatedAt !== config?.updatedAt) denied();
  return binding.ownerId;
}
