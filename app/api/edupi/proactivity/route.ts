import { NextResponse } from "next/server";
import { isDeepStrictEqual } from "node:util";
import { parseJsonWithinLimit, RequestBodyTooLargeError } from "@/lib/bounded-form-data";
import { isDesktopApiRequestAllowed } from "@/lib/desktop-api-auth";
import { readEduPiEducationSnapshot, resolveEduPiBridgeRoots, type EduPiBridgeRoots } from "@/lib/edupi-core-snapshot";
import { workspaceResourcesRequest } from "@/lib/edupi-generated-artifacts";
import {
  buildProactivityGrantBinding,
  buildProactivityScopeCandidates,
  buildStudentFollowupGrantBinding,
  buildStudentFollowupScopeCandidates,
  buildCapabilityGrantBinding,
  buildCapabilityScopeCandidates,
  capabilityGrantSourceIds,
  readLessonReflectionHistorySourceIds,
  capabilityGrantId,
  EDUPI_PROACTIVITY_DURATION_DAYS,
  EDUPI_PROACTIVITY_MAX_CALLS,
  EDUPI_STUDENT_FOLLOWUP_MAX_CALLS,
  EduPiProactivityControlError,
  type EduPiProactivityGrantBinding,
  type EduPiProactivityScopeCandidate,
} from "@/lib/edupi-proactivity-control";
import { clearEduPiProactivityStopIntent, readEduPiProactivityActivation, writeEduPiProactivityConfig,
  writeEduPiProactivityStopIntent, type EduPiProactivityActivation, type EduPiProactivityDomain, type EduPiProactivityScope } from "@/lib/edupi-proactivity-config";
import { EduPiProactivityRuntimeError, ensureProactivityGrant, inspectProactivityCatchUp, pauseProactivityGrant, proactivityRuntimeError, readProactivityGrantStatus, readProactivityRuntimeState } from "@/lib/edupi-proactivity-runtime";
import { clearEduPiRuntimeQuarantine, ensureEduPiRuntime,
  quarantineEduPiRuntime, restartEduPiRuntime } from "@/lib/edupi-runtime-supervisor";
import { canStartEduPiCapabilityDrafts, canStartEduPiProactivity, canStartEduPiStudentFollowup } from "@/lib/safe-mode";
import type { EduPiCapabilityDomain } from "@/lib/edupi-proactivity-config";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
const MAX_BODY_BYTES = 4096;
type RawRecord = Record<string, unknown>;

declare global {
  // One packaged server owns a data root. Preserve the lock across Next.js module reloads.
  var __edupiProactivityMutationLocks: Map<string, Promise<void>> | undefined;
}

const mutationLocks = globalThis.__edupiProactivityMutationLocks ??= new Map<string, Promise<void>>();

function record(value: unknown): RawRecord | null {
  return value && typeof value === "object" && !Array.isArray(value) ? value as RawRecord : null;
}

function exact(value: RawRecord, keys: string[]): boolean {
  return Object.keys(value).length === keys.length && Object.keys(value).every((key) => keys.includes(key));
}

function requestedDomain(value: unknown): EduPiProactivityDomain | null {
  return value === undefined ? "teaching_preparation"
    : value === "teaching_preparation" || value === "student_followup" || capabilityDomain(value) ? value as EduPiProactivityDomain : null;
}

function capabilityDomain(value: unknown): value is EduPiCapabilityDomain {
  return value === "calendar_administration" || value === "lesson_reflection" || value === "parent_communication";
}

function processorKey(domain: EduPiProactivityDomain): string {
  return domain === "teaching_preparation" ? "g1_processor" : domain === "student_followup" ? "g2_processor" : "g3_processor";
}

function runtimeHealth(value: RawRecord): { rootRef: string; capabilities: RawRecord } {
  const result = record(value.result);
  const capabilities = record(result?.capabilities);
  const rootRef = result?.data_root_fingerprint;
  if (value.ok !== true || typeof rootRef !== "string" || !/^sha256:[a-f0-9]{64}$/u.test(rootRef) || !capabilities) {
    throw new Error("proactivity_runtime_unavailable");
  }
  return { rootRef, capabilities };
}

async function readScopeContext(roots: EduPiBridgeRoots, domain: EduPiProactivityDomain): Promise<{ workspace: RawRecord; teacherMaterials: unknown[]; scopes: EduPiProactivityScopeCandidate[] }> {
  if (capabilityDomain(domain)) {
    const snapshot = await readEduPiEducationSnapshot({ roots });
    return { workspace: snapshot.workspace, teacherMaterials: [], scopes: buildCapabilityScopeCandidates(domain, snapshot.workspace) };
  }
  if (domain === "student_followup") {
    const snapshot = await readEduPiEducationSnapshot({ roots });
    return { workspace: snapshot.workspace, teacherMaterials: [], scopes: buildStudentFollowupScopeCandidates(snapshot.workspace) };
  }
  const [snapshot, resources] = await Promise.all([
    readEduPiEducationSnapshot({ roots }),
    workspaceResourcesRequest(),
  ]);
  const teacherMaterials = Array.isArray(resources.teacherMaterials) ? resources.teacherMaterials : [];
  return { workspace: snapshot.workspace, teacherMaterials, scopes: buildProactivityScopeCandidates(snapshot.workspace, teacherMaterials) };
}

function publicActivation(activation: EduPiProactivityActivation) {
  return {
    enabled: activation.enabled,
    source: activation.source,
    configurationStatus: activation.configurationStatus,
    scope: activation.scope,
    updatedAt: activation.updatedAt,
  };
}

async function currentState(roots: EduPiBridgeRoots, activation: EduPiProactivityActivation,
  domain: EduPiProactivityDomain,
  context?: Awaited<ReturnType<typeof readScopeContext>>, allowDegraded = false) {
  let currentContext = context;
  let degraded = false;
  if (!currentContext) {
    try { currentContext = await readScopeContext(roots, domain); }
    catch (error) {
      if (!allowDegraded) throw error;
      currentContext = { workspace: {}, teacherMaterials: [], scopes: [] };
      degraded = true;
    }
  }
  let grant: Awaited<ReturnType<typeof readProactivityGrantStatus>> = null;
  let execution: Awaited<ReturnType<typeof readProactivityRuntimeState>>["execution"] = null;
  let capabilities: RawRecord | null = null;
  if (activation.enabled || domain !== "teaching_preparation") {
    try {
      const host = await ensureEduPiRuntime(roots);
      const health = runtimeHealth(await host.call("health", null));
      capabilities = health.capabilities;
      ({ grant, execution } = await readProactivityRuntimeState(host, health.rootRef, activation.grantId, domain));
    } catch (error) {
      if (!allowDegraded) throw error;
      degraded = true;
    }
  }
  return {
    ok: true,
    degraded,
    requiresSafeMode: domain === "teaching_preparation" && process.platform === "win32" && !canStartEduPiProactivity(),
    ...(domain !== "teaching_preparation" ? { activationBlocked: process.platform === "win32" ? "windows_unavailable"
      : !(domain === "student_followup" ? canStartEduPiStudentFollowup() : canStartEduPiCapabilityDrafts()) ? "isolated_canary_required" : null } : {}),
    activation: publicActivation(activation),
    scopes: currentContext.scopes,
    grant,
    ...(domain === "student_followup" ? { execution } : {}),
    capabilities: capabilities ? {
      ambientPlanning: capabilities.ambient_planning === "active",
      ownerIntent: capabilities.owner_intent === "active",
      attentionDelivery: capabilities.attention_delivery === "active",
      teacherFeedback: capabilities.teacher_feedback === "active",
      ...(domain === "student_followup" ? { studentFollowup: capabilities.g2_processor === "active" } : {}),
      ...(capabilityDomain(domain) ? { capabilityDrafts: capabilities.g3_processor === "active" } : {}),
    } : null,
    limits: { durationDays: EDUPI_PROACTIVITY_DURATION_DAYS,
      maxModelCalls: domain === "student_followup" ? EDUPI_STUDENT_FOLLOWUP_MAX_CALLS : capabilityDomain(domain) ? 0 : EDUPI_PROACTIVITY_MAX_CALLS, domain },
    externalSend: false,
  };
}

async function withMutationLock<T>(key: string, operation: () => Promise<T>): Promise<T> {
  const previous = mutationLocks.get(key) ?? Promise.resolve();
  let release!: () => void;
  const gate = new Promise<void>((resolve) => { release = resolve; });
  const current = previous.catch(() => {}).then(() => gate);
  mutationLocks.set(key, current);
  await previous.catch(() => {});
  try { return await operation(); }
  finally {
    release();
    if (mutationLocks.get(key) === current) mutationLocks.delete(key);
  }
}

function mutationTime(previous: string | null): string {
  const previousTime = previous === null ? 0 : Date.parse(previous);
  return new Date(Math.max(Date.now(), Number.isFinite(previousTime) ? previousTime + 1 : 0)).toISOString();
}

function sameScope(left: EduPiProactivityScope | null, right: EduPiProactivityScope): boolean {
  return left?.classId === right.classId && left.subject === right.subject;
}

function sameSources(left: unknown, right: string[]): boolean {
  return Array.isArray(left) && left.length === right.length && left.every(item => typeof item === "string")
    && JSON.stringify([...left].sort()) === JSON.stringify([...right].sort());
}

async function preflightReflectionReenable(roots: EduPiBridgeRoots, activation: EduPiProactivityActivation,
  scope: EduPiProactivityScope, binding: EduPiProactivityGrantBinding) {
  const history = activation.historyBinding;
  const validId = (value: unknown): value is string => typeof value === "string"
    && /^[A-Za-z0-9][A-Za-z0-9._:@/+~=-]{0,159}$/u.test(value);
  const validTime = (value: unknown): value is string => typeof value === "string"
    && Number.isFinite(Date.parse(value)) && new Date(value).toISOString() === value;
  if (!history || !validId(history.ownerId)
    || history.grantId !== capabilityGrantId("lesson_reflection", history.scope)) {
    throw new EduPiProactivityControlError("proactivity_scope_conflict");
  }
  const host = await ensureEduPiRuntime(roots);
  const { rootRef } = runtimeHealth(await host.call("health", null));
  const readGrants = async () => {
    const read = await host.callOwnerControl("owner_read", { root_ref: rootRef, expected_owner_id: history.ownerId });
    const state = record(read.result);
    const grants = Array.isArray(state?.grants) ? state.grants.map(record) : null;
    if (read.ok !== true || state?.root_ref !== rootRef || record(state.owner)?.id !== history.ownerId
      || record(state.owner)?.root_ref !== rootRef
      || !grants || grants.some(item => !item)) {
      throw new EduPiProactivityRuntimeError("proactivity_grant_denied");
    }
    return grants as RawRecord[];
  };
  const grants = await readGrants();
  const validatePausedGrant = (grant: RawRecord, expectedScope: EduPiProactivityScope) => {
    const grantScope = record(grant.scope), budget = record(grant.budget);
    if (grant.status !== "paused" || !Number.isSafeInteger(grant.version) || Number(grant.version) < 1
      || !grantScope || !exact(grantScope, ["class_id", "subject"])
      || grantScope.class_id !== expectedScope.classId || grantScope.subject !== expectedScope.subject
      || !sameSources(grant.domains, ["lesson_reflection"]) || !sameSources(grant.actions, ["update"])
      || !validTime(grant.starts_at) || !validTime(grant.ends_at) || Date.parse(grant.ends_at) <= Date.parse(grant.starts_at)
      || !Array.isArray(grant.source_ids) || grant.source_ids.length === 0 || grant.source_ids.length > 128
      || !grant.source_ids.every(validId) || new Set(grant.source_ids).size !== grant.source_ids.length
      || !budget || !exact(budget, ["id", "max_calls"]) || !validId(budget.id)
      || !Number.isSafeInteger(budget.max_calls) || Number(budget.max_calls) < 0 || Number(budget.max_calls) > 4) {
      throw new EduPiProactivityRuntimeError("proactivity_grant_denied");
    }
  };
  // The config keeps only the currently selected history. Core retains all
  // scoped grants, so returning to an older scope must recover its own grant.
  const previous = grants.filter(item => item.id === history.grantId);
  const selected = grants.filter(item => item.id === binding.grantId);
  if (previous.length !== 1 || selected.length > 1
    || grants.some(item => Array.isArray(item.domains) && item.domains.includes("lesson_reflection") && item.status === "active")) {
    throw new EduPiProactivityRuntimeError("proactivity_grant_denied");
  }
  validatePausedGrant(previous[0], history.scope);
  const grant = selected[0];
  if (grant) validatePausedGrant(grant, scope);
  const historicalSources = grant ? await readLessonReflectionHistorySourceIds({
    coreRoot: roots.runtime.root, memoryDir: roots.dataRoot.memoryDir, rootRef, ownerId: history.ownerId, scope, grant,
  }) : [];
  const previousSourceIds = grant?.source_ids as string[] | undefined;
  if (!Array.isArray(historicalSources) || historicalSources.some(source => !validId(source) || !previousSourceIds?.includes(source))) {
    throw new EduPiProactivityControlError("proactivity_response_invalid");
  }
  const sourceIds = [...new Set([...binding.spec.source_ids, ...historicalSources])];
  if (sourceIds.length > 128) throw new EduPiProactivityControlError("proactivity_source_capacity");
  const nextBinding = { ...binding, spec: { ...binding.spec, source_ids: sourceIds } };
  if (!isDeepStrictEqual(await readGrants(), grants)) throw new EduPiProactivityRuntimeError("proactivity_grant_denied");
  return { host, rootRef, binding: nextBinding,
    expected: grant ? { ownerId: history.ownerId, grantVersion: Number(grant.version) } : undefined,
    verifyBeforeMutation(read: unknown) {
      const response = record(read), state = record(response?.result);
      if (response?.ok !== true || state?.root_ref !== rootRef || record(state.owner)?.id !== history.ownerId
        || record(state.owner)?.root_ref !== rootRef
        || !isDeepStrictEqual(state.grants, grants)) {
        throw new EduPiProactivityRuntimeError("proactivity_grant_denied");
      }
    },
    async verifyCommitted(commit: { ownerId: string; grantVersion: number }) {
      const after = await readGrants();
      const selected = after.filter(item => item.id === binding.grantId);
      const next = selected[0];
      if (commit.ownerId !== history.ownerId || selected.length !== 1 || next.status !== "active"
        || next.version !== commit.grantVersion || !sameSources(next.source_ids, sourceIds)
        || Object.entries(nextBinding.spec).some(([key, value]) => key !== "source_ids" && !isDeepStrictEqual(next[key], value))
        || !isDeepStrictEqual(after.filter(item => item.id !== binding.grantId), grants.filter(item => item.id !== binding.grantId))) {
        throw new EduPiProactivityRuntimeError("proactivity_grant_denied");
      }
    },
  };
}

async function refreshCapabilitySources(roots: EduPiBridgeRoots, activation: EduPiProactivityActivation,
  scope: EduPiProactivityScope, context: Awaited<ReturnType<typeof readScopeContext>>,
  domain: "parent_communication" | "lesson_reflection") {
  if (!activation.enabled || !activation.ownerId || !activation.grantId || !sameScope(activation.scope, scope)) {
    throw new EduPiProactivityControlError("proactivity_scope_conflict");
  }
  const expectedGrantId = capabilityGrantId(domain, scope);
  if (expectedGrantId !== activation.grantId) throw new EduPiProactivityControlError("proactivity_scope_conflict");
  const host = await ensureEduPiRuntime(roots);
  const { rootRef } = runtimeHealth(await host.call("health", null));
  const read = await host.callOwnerControl("owner_read", { root_ref: rootRef, expected_owner_id: activation.ownerId });
  const ownerState = record(read.result), owner = record(ownerState?.owner);
  const grant = Array.isArray(ownerState?.grants) ? ownerState.grants.map(record).find(item => item?.id === activation.grantId) : null;
  if (read.ok !== true || owner?.id !== activation.ownerId || !grant || grant.status !== "active"
    || !Number.isSafeInteger(grant.version) || Number(grant.version) < 1
    || typeof grant.starts_at !== "string" || typeof grant.ends_at !== "string"
    || !Number.isFinite(Date.parse(grant.starts_at)) || Date.parse(grant.starts_at) > Date.now()
    || !Number.isFinite(Date.parse(grant.ends_at)) || Date.parse(grant.ends_at) <= Date.now() || !Array.isArray(grant.source_ids)
    || !Array.isArray(grant.domains) || grant.domains.length !== 1 || grant.domains[0] !== domain
    || !Array.isArray(grant.actions) || grant.actions.length !== 1 || grant.actions[0] !== "update"
    || record(grant.scope)?.class_id !== scope.classId || record(grant.scope)?.subject !== scope.subject
    || !record(grant.budget)) throw new EduPiProactivityRuntimeError("proactivity_grant_denied");
  const historicalSources = domain === "lesson_reflection" ? await readLessonReflectionHistorySourceIds({
    coreRoot: roots.runtime.root, memoryDir: roots.dataRoot.memoryDir, rootRef, ownerId: activation.ownerId, scope, grant,
  }) : [];
  const sourceIds = [...new Set([...capabilityGrantSourceIds(domain, scope, context.workspace), ...historicalSources])];
  if (sourceIds.length > 128) throw new EduPiProactivityControlError("proactivity_source_capacity");
  if (sameSources(grant.source_ids, sourceIds)) return currentState(roots, activation, domain, context);
  const updated = await host.callOwnerControl("owner_control", {
    command_id: `desktop-${domain}-sources-${crypto.randomUUID()}`, root_ref: rootRef,
    expected_owner_id: activation.ownerId, action: "update", grant_id: activation.grantId,
    expected_version: grant.version,
    spec: { scope: grant.scope, domains: grant.domains, actions: grant.actions,
      source_ids: sourceIds, starts_at: grant.starts_at, ends_at: grant.ends_at, budget: grant.budget },
  });
  if (updated.ok !== true || record(updated.result)?.grant_version !== Number(grant.version) + 1) {
    throw new EduPiProactivityRuntimeError("proactivity_grant_denied");
  }
  const after = await host.callOwnerControl("owner_read", { root_ref: rootRef, expected_owner_id: activation.ownerId });
  const next = Array.isArray(record(after.result)?.grants) ? (record(after.result)!.grants as unknown[]).map(record)
    .find(item => item?.id === activation.grantId) : null;
  if (after.ok !== true || next?.status !== "active" || next.version !== Number(grant.version) + 1
    || record(record(after.result)?.owner)?.id !== activation.ownerId
    || ["scope", "domains", "actions", "starts_at", "ends_at", "budget"].some(key => !isDeepStrictEqual(next[key], grant[key]))
    || !sameSources(next.source_ids, sourceIds)) {
    throw new EduPiProactivityRuntimeError("proactivity_grant_denied");
  }
  return currentState(roots, activation, domain, context);
}

function requireActiveCapabilities(capabilities: RawRecord, domain: EduPiProactivityDomain): void {
  const required = [processorKey(domain), "internal_timer", "ambient_planning", "owner_authorization", "owner_conversation", "owner_intent"];
  if (domain !== "lesson_reflection") required.push("attention_delivery", "teacher_feedback");
  for (const key of required) {
    if (capabilities[key] !== "active") throw new Error("proactivity_activation_incomplete");
  }
}

async function recoverFailedEnable(roots: EduPiBridgeRoots, previous: EduPiProactivityActivation,
  target: { scope: EduPiProactivityScope; grantId: string }, domain: EduPiProactivityDomain,
  committed?: { ownerId: string; grantVersion: number }): Promise<boolean> {
  try {
    writeEduPiProactivityStopIntent(target, { dataRoot: roots.dataRoot.root, now: mutationTime(previous.updatedAt), domain });
  } catch {
    await quarantineEduPiRuntime(roots.dataRoot.root);
    return false;
  }
  await quarantineEduPiRuntime(roots.dataRoot.root);
  clearEduPiRuntimeQuarantine(roots.dataRoot.root);
  let cleanupSafe = false;
  try {
    const host = await ensureEduPiRuntime(roots);
    const health = runtimeHealth(await host.call("health", null));
    await pauseProactivityGrant(host, health.rootRef, target.grantId, committed);
    cleanupSafe = true;
  } catch { await quarantineEduPiRuntime(roots.dataRoot.root); }
  const fallback = cleanupSafe
    ? previous.enabled && previous.scope && previous.grantId
      ? { enabled: true, scope: previous.scope, grantId: previous.grantId, ...(previous.ownerId ? { ownerId: previous.ownerId } : {}) }
      : { enabled: false, scope: null, grantId: null }
    : { enabled: false, scope: target.scope, grantId: target.grantId };
  try {
    writeEduPiProactivityConfig({ ...fallback, ...(domain === "lesson_reflection"
      ? { historyBinding: previous.historyBinding ?? null } : {}) },
    { dataRoot: roots.dataRoot.root, now: mutationTime(previous.updatedAt), domain });
    if (!cleanupSafe) return false;
    clearEduPiProactivityStopIntent({ dataRoot: roots.dataRoot.root, grantId: target.grantId, domain });
    clearEduPiRuntimeQuarantine(roots.dataRoot.root);
    await restartEduPiRuntime(roots);
    return true;
  } catch {
    await quarantineEduPiRuntime(roots.dataRoot.root);
    return false;
  }
}

async function fenceUncertainEnable(roots: EduPiBridgeRoots,
  target: { scope: EduPiProactivityScope; grantId: string }, domain: EduPiProactivityDomain): Promise<void> {
  try {
    writeEduPiProactivityStopIntent(target, { dataRoot: roots.dataRoot.root, domain });
  } finally {
    await quarantineEduPiRuntime(roots.dataRoot.root);
  }
}

async function enableCanary(roots: EduPiBridgeRoots, activation: EduPiProactivityActivation, scope: EduPiProactivityScope, domain: EduPiProactivityDomain) {
  const context = await readScopeContext(roots, domain);
  if (activation.enabled && (domain === "parent_communication" || domain === "lesson_reflection")) {
    return refreshCapabilitySources(roots, activation, scope, context, domain);
  }
  const binding = domain === "student_followup" ? buildStudentFollowupGrantBinding(scope, context.workspace)
    : capabilityDomain(domain) ? buildCapabilityGrantBinding(domain, scope, context.workspace)
      : buildProactivityGrantBinding(scope, context.workspace, context.teacherMaterials);
  if (!activation.enabled && activation.scope) throw new EduPiProactivityControlError("proactivity_scope_conflict");
  if (activation.scope && (!sameScope(activation.scope, scope) || activation.grantId !== binding.grantId)) {
    throw new EduPiProactivityControlError("proactivity_scope_conflict");
  }
  if (activation.enabled) return currentState(roots, activation, domain, context);
  if (capabilityDomain(domain)) {
    const preflight = domain === "lesson_reflection" && activation.historyBinding
      ? await preflightReflectionReenable(roots, activation, scope, binding) : null;
    let mutationStarted = preflight === null;
    let pendingOwnerMutation = false;
    let committedGrant: { ownerId: string; grantVersion: number } | undefined;
    try {
      // Establish the exact current owner grant while this domain is still
      // disabled, then persist its owner binding before admitting execution.
      const dormantHost = preflight?.host ?? await ensureEduPiRuntime(roots);
      const rootRef = preflight?.rootRef ?? runtimeHealth(await dormantHost.call("health", null)).rootRef;
      let initialOwnerRead = true;
      const grantHost = preflight ? {
        call: async (...args: Parameters<typeof dormantHost.call>) => {
          const response = await dormantHost.call(...args);
          if (args[0] === "owner_read" && initialOwnerRead) {
            preflight.verifyBeforeMutation(response);
            initialOwnerRead = false;
          }
          return response;
        },
        callOwnerControl: async (...args: Parameters<typeof dormantHost.callOwnerControl>) => {
          if (args[0] === "owner_control") pendingOwnerMutation = true;
          const response = await dormantHost.callOwnerControl(...args);
          if (record(response)?.ok === false) pendingOwnerMutation = false;
          return response;
        },
      } : dormantHost;
      const owner = await ensureProactivityGrant(grantHost, rootRef, preflight?.binding ?? binding,
        preflight?.expected, preflight ? commit => { committedGrant = commit; pendingOwnerMutation = false; mutationStarted = true; } : undefined);
      await preflight?.verifyCommitted(owner);
      writeEduPiProactivityConfig({ enabled: true, scope, grantId: binding.grantId, ownerId: owner.ownerId },
        { dataRoot: roots.dataRoot.root, now: mutationTime(activation.updatedAt), domain });
      const host = await restartEduPiRuntime(roots);
      requireActiveCapabilities(runtimeHealth(await host.call("health", null)).capabilities, domain);
      return await currentState(roots, readEduPiProactivityActivation({ dataRoot: roots.dataRoot.root, domain }), domain, context);
    } catch (error) {
      if (preflight && pendingOwnerMutation) {
        try { await fenceUncertainEnable(roots, { scope, grantId: binding.grantId }, domain); }
        catch { /* Quarantine remains the fallback if the stop marker cannot be persisted. */ }
        throw new EduPiProactivityRuntimeError("proactivity_stop_uncertain");
      }
      if (preflight && !committedGrant) throw error;
      if (!mutationStarted) throw error;
      if (!await recoverFailedEnable(roots, activation, { scope, grantId: binding.grantId }, domain, committedGrant)) {
        throw new EduPiProactivityRuntimeError("proactivity_stop_uncertain");
      }
      throw error;
    }
  }
  writeEduPiProactivityConfig({ enabled: true, scope, grantId: binding.grantId },
    { dataRoot: roots.dataRoot.root, now: mutationTime(activation.updatedAt), domain });
  try {
    const host = await restartEduPiRuntime(roots);
    const health = runtimeHealth(await host.call("health", null));
    requireActiveCapabilities(health.capabilities, domain);
    await ensureProactivityGrant(host, health.rootRef, binding);
    if (domain === "student_followup") {
      const next = readEduPiProactivityActivation({ dataRoot: roots.dataRoot.root, domain });
      return await currentState(roots, next, domain, context);
    }
    const budget = (await readProactivityGrantStatus(host, health.rootRef, binding.grantId))?.modelBudget;
    if (!budget || budget.usageUnverified) throw new EduPiProactivityRuntimeError("proactivity_grant_denied");
    if (budget.remainingCalls === 0) throw new EduPiProactivityRuntimeError("proactivity_budget_exhausted");
    // The runtime starts before its owner grant is created. Wake the scoped
    // scan now so the teacher does not wait for the next five-minute tick.
    const catchUp = await host.call("prepare_due", null);
    if (!catchUp.ok) throw new EduPiProactivityRuntimeError("proactivity_runtime_unavailable");
    const initialScan = inspectProactivityCatchUp(catchUp);
    const next = readEduPiProactivityActivation({ dataRoot: roots.dataRoot.root, domain });
    return { ...(await currentState(roots, next, domain, context)), initialScan };
  } catch (error) {
    if (!await recoverFailedEnable(roots, activation, { scope, grantId: binding.grantId }, domain)) {
      throw new EduPiProactivityRuntimeError("proactivity_stop_uncertain");
    }
    throw error;
  }
}

async function disableCanary(roots: EduPiBridgeRoots, activation: EduPiProactivityActivation, domain: EduPiProactivityDomain) {
  if (activation.scope && activation.grantId) {
    try {
      writeEduPiProactivityStopIntent({ scope: activation.scope, grantId: activation.grantId },
        { dataRoot: roots.dataRoot.root, now: mutationTime(activation.updatedAt), domain });
    } catch {
      await quarantineEduPiRuntime(roots.dataRoot.root);
      throw new EduPiProactivityRuntimeError("proactivity_stop_uncertain");
    }
    // Marker is durable before closing the selected executor; any later
    // read or restart now sees stop_pending, even if both following writes fail.
    await quarantineEduPiRuntime(roots.dataRoot.root);
    clearEduPiRuntimeQuarantine(roots.dataRoot.root);
  }
  let stopState: "paused" | "missing" | "revoked" | "uncertain" = activation.grantId ? "uncertain" : "missing";
  if (activation.grantId) {
    try {
      const host = await ensureEduPiRuntime(roots);
      const health = runtimeHealth(await host.call("health", null));
      stopState = (await pauseProactivityGrant(host, health.rootRef, activation.grantId)).state;
    } catch { /* Keep the old binding as a fence until a later stop retry proves it safe. */ }
  }
  const cleanupSafe = stopState !== "uncertain";
  try {
    const historyBinding = activation.historyBinding ?? (activation.ownerId && activation.grantId && activation.scope
      ? { ownerId: activation.ownerId, grantId: activation.grantId, scope: activation.scope } : undefined);
    writeEduPiProactivityConfig({ enabled: false, scope: cleanupSafe ? null : activation.scope,
      grantId: cleanupSafe ? null : activation.grantId,
      ...(domain === "lesson_reflection" && historyBinding !== undefined ? { historyBinding } : {}) },
    { dataRoot: roots.dataRoot.root, now: mutationTime(activation.updatedAt), domain });
  } catch {
    await quarantineEduPiRuntime(roots.dataRoot.root);
    throw new EduPiProactivityRuntimeError("proactivity_stop_uncertain");
  }
  if (cleanupSafe && activation.grantId) {
    try { clearEduPiProactivityStopIntent({ dataRoot: roots.dataRoot.root, grantId: activation.grantId, domain }); }
    catch {
      await quarantineEduPiRuntime(roots.dataRoot.root);
      throw new EduPiProactivityRuntimeError("proactivity_stop_uncertain");
    }
  }
  clearEduPiRuntimeQuarantine(roots.dataRoot.root);
  try {
    const host = await restartEduPiRuntime(roots);
    const health = runtimeHealth(await host.call("health", null));
    const anotherCapabilityEnabled = capabilityDomain(domain) && (["calendar_administration", "lesson_reflection", "parent_communication"] as const)
      .some((item) => item !== domain && canStartEduPiCapabilityDrafts()
        && readEduPiProactivityActivation({ dataRoot: roots.dataRoot.root, domain: item }).enabled);
    if (health.capabilities[processorKey(domain)] !== (anotherCapabilityEnabled ? "active" : "activation_pending")) {
      throw new Error("proactivity_deactivation_incomplete");
    }
  } catch {
    await quarantineEduPiRuntime(roots.dataRoot.root);
    throw new EduPiProactivityRuntimeError("proactivity_stop_uncertain");
  }
  if (!cleanupSafe) throw new EduPiProactivityRuntimeError("proactivity_stop_uncertain");
  const next = readEduPiProactivityActivation({ dataRoot: roots.dataRoot.root, domain });
  return { ...(await currentState(roots, next, domain, undefined, true)), grantPaused: stopState === "paused" };
}

export async function GET(request: Request) {
  if (!isDesktopApiRequestAllowed(request)) return NextResponse.json({ ok: false, error: "主动运行设置请求被拒绝" }, { status: 403 });
  try {
    const domains = new URL(request.url).searchParams.getAll("domain");
    const domain = domains.length > 1 ? null : requestedDomain(domains[0]);
    if (!domain) return NextResponse.json({ ok: false, error: "主动运行领域无效", externalSend: false }, { status: 400 });
    const roots = resolveEduPiBridgeRoots();
    const activation = readEduPiProactivityActivation({ dataRoot: roots.dataRoot.root, domain });
    return NextResponse.json(await currentState(roots, activation, domain, undefined, true));
  } catch {
    return NextResponse.json({ ok: false, error: "主动运行状态暂不可用", externalSend: false }, { status: 503 });
  }
}

export async function POST(request: Request) {
  if (!isDesktopApiRequestAllowed(request)) return NextResponse.json({ ok: false, error: "主动运行设置请求被拒绝" }, { status: 403 });
  try {
    const body = record(await parseJsonWithinLimit(request, MAX_BODY_BYTES));
    const domain = requestedDomain(body?.domain);
    if (!body || !domain || !exact(body, ["enabled", "classId", "subject", "expectedUpdatedAt", ...(Object.hasOwn(body, "domain") ? ["domain"] : [])]) || typeof body.enabled !== "boolean"
      || body.classId !== null && typeof body.classId !== "string" || body.subject !== null && typeof body.subject !== "string"
      || body.expectedUpdatedAt !== null && (typeof body.expectedUpdatedAt !== "string"
        || !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/u.test(body.expectedUpdatedAt))
      || body.enabled && (typeof body.classId !== "string" || !body.classId.trim() || typeof body.subject !== "string" || !body.subject.trim())
      || !body.enabled && (body.classId !== null || body.subject !== null)) {
      return NextResponse.json({ ok: false, error: "主动运行设置无效", externalSend: false }, { status: 400 });
    }
    if (body.enabled && domain === "student_followup" && !canStartEduPiStudentFollowup()) {
      return NextResponse.json({ ok: false, code: "proactivity_isolated_canary_required",
        error: process.platform === "win32" ? "Windows 暂不支持学生跟进试用" : "学生跟进仅可在隔离数据目录试用", externalSend: false }, { status: 409 });
    }
    if (body.enabled && capabilityDomain(domain) && !canStartEduPiCapabilityDrafts()) {
      return NextResponse.json({ ok: false, code: "proactivity_isolated_canary_required",
        error: process.platform === "win32" ? "Windows 暂不支持内部草稿试用" : "内部草稿仅可在 macOS 隔离数据目录试用", externalSend: false }, { status: 409 });
    }
    if (body.enabled && domain === "teaching_preparation" && !canStartEduPiProactivity()) {
      return NextResponse.json({ ok: false, code: "proactivity_safe_mode_required",
        error: "Windows 主动运行仅可在隔离安全模式试用", externalSend: false }, { status: 409 });
    }
    const roots = resolveEduPiBridgeRoots();
    return await withMutationLock(roots.dataRoot.root, async () => {
      const activation = readEduPiProactivityActivation({ dataRoot: roots.dataRoot.root, domain });
      if (activation.source === "environment") {
        return NextResponse.json({ ok: false, error: "主动运行由当前启动环境管理", externalSend: false }, { status: 409 });
      }
      if (activation.updatedAt !== body.expectedUpdatedAt) {
        return NextResponse.json({ ok: false, code: "proactivity_configuration_stale", error: "主动运行状态已变化，请刷新后重试", externalSend: false }, { status: 409 });
      }
      try {
        const result = body.enabled
          ? await enableCanary(roots, activation, { classId: String(body.classId).trim(), subject: String(body.subject).trim() }, domain)
          : await disableCanary(roots, activation, domain);
        return NextResponse.json(result);
      } catch (error) {
        const cause = proactivityRuntimeError(error);
        const conflict = cause instanceof EduPiProactivityControlError
          && ["proactivity_scope_unavailable", "proactivity_scope_conflict", "proactivity_source_capacity"].includes(cause.code);
        const blocked = ["proactivity_budget_exhausted", "proactivity_grant_denied", "proactivity_preparation_blocked"].includes(cause.code);
        return NextResponse.json({ ok: false, code: cause.code,
          error: cause.code === "proactivity_scope_conflict" ? "请先完成当前主动运行的停止恢复"
            : cause.code === "proactivity_source_capacity" ? "当前来源超过 127 项，请先缩小来源范围"
            : cause.code === "proactivity_budget_exhausted" ? "本次模型调用额度已用完"
              : cause.code === "proactivity_grant_denied" ? domain === "student_followup" ? "学生跟进授权范围已变化，请停止后重试" : "授权或材料范围已变化，请停止后重试"
                : cause.code === "proactivity_preparation_blocked" ? "课前任务需要先核对材料或课程"
                  : cause.code === "proactivity_stop_uncertain" ? "停止未完成，请检查存储后重试"
                  : conflict ? domain === "student_followup" ? "所选班级需要数学课表和当前学生名单"
                    : capabilityDomain(domain) ? domain === "parent_communication" ? "需要同一学生、收件人和学期的已审核证据及收件人确认" : "所选范围需要当前已审核的学期与课程证据"
                      : "所选班级和学科需要明确课表与材料" : "主动运行设置暂不可用", externalSend: false },
        { status: conflict || blocked ? 409 : 503 });
      }
    });
  } catch (error) {
    if (error instanceof RequestBodyTooLargeError) return NextResponse.json({ ok: false, error: "主动运行设置过大", externalSend: false }, { status: 413 });
    const cause = proactivityRuntimeError(error);
    return NextResponse.json({ ok: false, code: cause.code, error: "主动运行设置暂不可用", externalSend: false }, { status: 503 });
  }
}
