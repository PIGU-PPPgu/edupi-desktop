import { randomBytes } from "node:crypto";
import { isDeepStrictEqual } from "node:util";
import {
  EDUPI_RECALL_NORMAL_RELEASE_APPROVED, eduPiRecallConversationId, readEduPiRecallConfig,
  validRecallModel, validRecallScope, writeEduPiRecallConfig,
  type EduPiRecallBinding, type EduPiRecallConfig, type EduPiRecallDependencies, type EduPiRecallModel,
  type EduPiRecallOptions, type EduPiRecallScope,
} from "./edupi-recall-config.ts";
import { readRecallBudget } from "./edupi-recall-authorization.ts";
import { EduPiRecallError, openRecallStore, recallHash, recallId, recallKeys, recallTime } from "./edupi-recall-store.ts";
import { isSafeModeEnabled } from "./safe-mode.ts";
import { invalidateEduPiRecallRoot } from "./edupi-recall-state.ts";

export type RecallServerHost = {
  readonly recallAnswersActive?: boolean;
  readonly dataRootFingerprint?: string;
  call(operation: string, payload: unknown): Promise<Record<string, unknown>>;
  callOwnerControl(operation: string, payload: unknown): Promise<Record<string, unknown>>;
};
export type RecallSettingsInput = { enabled: false; expectedUpdatedAt: string | null } | {
  enabled: true; expectedUpdatedAt: string | null; scope: EduPiRecallScope; model: EduPiRecallModel;
  limit: number; validUntil: string;
};
export type RecallSettingsView = {
  version: 1; normalApproved: boolean;
  activation: { mode: "off" | "canary" | "normal"; enabled: boolean; reason: string };
  config: {
    enabled: boolean; scope: EduPiRecallScope | null; model: EduPiRecallModel | null;
    limit: number | null; used: number | null; remaining: number | null;
    validUntil: string | null; updatedAt: string | null;
  };
  stop?: { status: "stopped" | "unknown"; grants: "paused" | "none" | "unknown" };
};
/** Dependencies are trusted server code, never HTTP fields. */
export type RecallSettingsDependencies = EduPiRecallDependencies & {
  options?: () => EduPiRecallOptions;
  runtime?: (options: EduPiRecallOptions) => Promise<RecallServerHost>;
  resident?: (options: EduPiRecallOptions) => Promise<RecallServerHost | null>;
  restartRoot?: (options: EduPiRecallOptions) => Promise<RecallServerHost>;
  preflightModel?: (options: EduPiRecallOptions) => Promise<EduPiRecallModel>;
};
export class EduPiRecallServerError extends Error {
  constructor(readonly code: string, readonly status = 503) { super(code); this.name = "EduPiRecallServerError"; }
}
export function recallServerFail(code: string, status = 503): never { throw new EduPiRecallServerError(code, status); }
export const recallNormalApproved = (dependencies: EduPiRecallDependencies = {}): boolean =>
  EDUPI_RECALL_NORMAL_RELEASE_APPROVED || dependencies.approveNormal?.() === true;
export const isR04RecallGrantId = (id: unknown): id is string =>
  typeof id === "string" && /^r04_recall_[a-f0-9]{1,128}$/u.test(id);
const object = (value: unknown): Record<string, unknown> | null =>
  value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : null;
export function recallCoreResult(value: unknown): Record<string, unknown> {
  const envelope = object(value), result = object(envelope?.result);
  if (envelope?.ok !== true || !result) return recallServerFail("recall_core_unavailable");
  return result;
}
export async function verifiedRecallRootRef(host: RecallServerHost): Promise<string> {
  const health = recallCoreResult(await host.call("health", null));
  if (typeof health.data_root_fingerprint !== "string" || !/^sha256:[a-f0-9]{64}$/u.test(health.data_root_fingerprint)) {
    return recallServerFail("recall_core_identity_invalid");
  }
  return health.data_root_fingerprint;
}
type OwnerState = { ownerId: string | null; grants: Record<string, unknown>[] };
export async function readRecallOwner(host: RecallServerHost, rootRef: string): Promise<OwnerState> {
  const result = recallCoreResult(await host.call("owner_read", { root_ref: rootRef }));
  const owner = object(result.owner);
  if (result.root_ref !== rootRef || result.owner !== null && (!owner || !recallId(owner.id) || owner.root_ref !== rootRef)
    || !Array.isArray(result.grants) || result.grants.length > 768) return recallServerFail("recall_owner_invalid");
  const grants = result.grants.map(raw => {
    const grant = object(raw);
    if (!grant || !recallId(grant.id) || !Number.isSafeInteger(grant.version) || Number(grant.version) < 1
      || !["active", "paused", "revoked"].includes(String(grant.status)) || !recallTime(grant.ends_at)) {
      return recallServerFail("recall_owner_invalid");
    }
    return grant;
  });
  if (new Set(grants.map(grant => grant.id)).size !== grants.length) return recallServerFail("recall_owner_invalid");
  return { ownerId: owner ? String(owner.id) : null, grants };
}

export async function defaultRecallOptions(): Promise<EduPiRecallOptions> {
  // Settings and a durable stop do not depend on a healthy Core installation.
  const { resolveEduPiDataRoot } = await import("./edupi-core-root");
  return { dataRoot: resolveEduPiDataRoot().root, stateDir: process.env.PI_DESKTOP_STATE_DIR };
}
export async function defaultRecallRuntime(options: EduPiRecallOptions, restart = false): Promise<RecallServerHost> {
  const [{ resolveEduPiBridgeRoots }, supervisor] = await Promise.all([
    import("./edupi-core-snapshot"), import("./edupi-runtime-supervisor"),
  ]);
  const roots = resolveEduPiBridgeRoots();
  if (roots.dataRoot.root !== options.dataRoot) return recallServerFail("recall_root_changed");
  return restart ? supervisor.restartEduPiRuntime(roots) : supervisor.ensureEduPiRuntime(roots);
}
async function defaultRecallResident(options: EduPiRecallOptions): Promise<RecallServerHost | null> {
  const supervisor = await import("./edupi-runtime-supervisor");
  const shared = globalThis as typeof globalThis & {
    __edupiRuntimeQuarantine?: Set<string>; __edupiRuntimeQuarantineDrains?: Map<string, Promise<void>>;
  };
  if (shared.__edupiRuntimeQuarantine?.has(options.dataRoot) || shared.__edupiRuntimeQuarantineDrains?.has(options.dataRoot)) return null;
  return supervisor.getActiveEduPiRuntime(options.dataRoot);
}
async function restartStoppedRecallRuntime(options: EduPiRecallOptions): Promise<RecallServerHost> {
  const supervisor = await import("./edupi-runtime-supervisor");
  await supervisor.quarantineEduPiRuntime(options.dataRoot, { requireClosed: true });
  const { resolveEduPiBridgeRoots } = await import("./edupi-core-snapshot");
  const roots = resolveEduPiBridgeRoots();
  if (roots.dataRoot.root !== options.dataRoot) return recallServerFail("recall_root_changed");
  supervisor.clearEduPiRuntimeQuarantine(options.dataRoot);
  return supervisor.ensureEduPiRuntime(roots);
}
async function preflightModel(options: EduPiRecallOptions): Promise<EduPiRecallModel> {
  const [{ getAgentDir }, { readRuntimeModelConfiguration }] = await Promise.all([
    import("@earendil-works/pi-coding-agent"), import("./edupi-runtime-model-config"),
  ]);
  const configuration = await readRuntimeModelConfiguration({
    projectRoot: options.dataRoot, agentDir: getAgentDir(), signal: AbortSignal.timeout(15_000),
  });
  const model = { provider: configuration.model.provider, modelId: configuration.model.id };
  if (!validRecallModel(model)) return recallServerFail("recall_model_unavailable");
  return model;
}

// Async orchestration only. The existing interprocess IO/CAS lock never spans a Core await.
const queues = new Map<string, Promise<void>>();
export async function withRecallRootOperation<T>(options: EduPiRecallOptions, operation: () => Promise<T>): Promise<T> {
  const store = openRecallStore(options), key = JSON.stringify([store.stateDir, store.dataRootHash]);
  const previous = queues.get(key) ?? Promise.resolve();
  let release!: () => void;
  const gate = new Promise<void>(resolve => { release = resolve; });
  const pending = previous.catch(() => {}).then(() => gate);
  queues.set(key, pending);
  await previous.catch(() => {});
  try { store.assertCurrent(); return await operation(); }
  finally { release(); if (queues.get(key) === pending) queues.delete(key); }
}

export function recallGrantSpec(scope: EduPiRecallScope, options: EduPiRecallOptions,
  budgetId: string, limit: number, validUntil: string) {
  const now = options.now ?? new Date().toISOString();
  return {
    scope: { class_id: scope.classId, subject: scope.subject },
    domains: ["teaching_preparation"], actions: ["prepare"],
    source_ids: [`conversation:${recallHash(eduPiRecallConversationId(scope, options)).slice(7)}`],
    starts_at: now, ends_at: validUntil, budget: { id: budgetId, max_calls: limit },
  };
}
/** Exact independent grant binding; G1 authority and its usage projection are irrelevant. */
export async function assertRecallGrantCurrent(host: RecallServerHost, rootRef: string,
  config: EduPiRecallBinding, options: EduPiRecallOptions): Promise<void> {
  const state = await readRecallOwner(host, rootRef), grant = state.grants.find(item => item.id === config.grantId);
  const spec = recallGrantSpec(config.scope, options, config.budgetId, config.limit, config.validUntil);
  if (state.ownerId !== config.ownerId || !isR04RecallGrantId(config.grantId) || !grant || grant.status !== "active"
    || grant.version !== config.grantVersion || grant.ends_at !== config.validUntil
    || !recallTime(grant.starts_at) || Date.parse(grant.starts_at) > Date.parse(options.now ?? new Date().toISOString())
    || Date.parse(config.validUntil) <= Date.parse(options.now ?? new Date().toISOString())
    || !["scope", "domains", "actions", "source_ids", "budget"].every(key =>
      isDeepStrictEqual(grant[key], spec[key as keyof typeof spec]))) recallServerFail("recall_grant_changed", 409);
}

function view(options: EduPiRecallOptions, dependencies: EduPiRecallDependencies): RecallSettingsView {
  const read = readEduPiRecallConfig(options, dependencies), config = read.config;
  let used: number | null = null, remaining: number | null = null;
  if (config?.enabled) {
    try {
      const budget = readRecallBudget(config.budgetId, options);
      if (budget && !Object.entries(budget.binding).every(([key, value]) =>
        isDeepStrictEqual(value, config[key as keyof typeof config]))) throw new Error("changed");
      used = budget?.used ?? 0; remaining = budget?.remaining ?? config.limit;
    } catch { read.enabled = false; read.mode = "off"; read.reason = "invalid"; }
  }
  return {
    version: 1, normalApproved: recallNormalApproved(dependencies),
    activation: { mode: read.mode, enabled: read.enabled, reason: read.reason },
    config: {
      enabled: config?.enabled === true, scope: config?.enabled ? structuredClone(config.scope) : null,
      model: config?.enabled ? structuredClone(config.model) : null, limit: config?.enabled ? config.limit : null,
      used, remaining, validUntil: config?.enabled ? config.validUntil : null, updatedAt: config?.updatedAt ?? null,
    },
  };
}
function validateInput(input: unknown, now?: string): asserts input is RecallSettingsInput {
  // Core grants bind class/subject. Term authority remains Core's canonical
  // single-term proof; do not accept a client restriction the grant cannot hold.
  if (!recallKeys(input, ["enabled", "expectedUpdatedAt"], ["scope", "model", "limit", "validUntil"])
    || typeof input.enabled !== "boolean" || input.expectedUpdatedAt !== null && !recallTime(input.expectedUpdatedAt)
    || now !== undefined && !recallTime(now)) recallServerFail("recall_invalid_input", 400);
  if (!input.enabled) {
    if (!recallKeys(input, ["enabled", "expectedUpdatedAt"])) recallServerFail("recall_invalid_input", 400);
  } else if (!validRecallScope(input.scope) || !validRecallModel(input.model)
    || input.scope.termId !== undefined
    || !Number.isSafeInteger(input.limit) || Number(input.limit) < 1 || Number(input.limit) > 12
    || !recallTime(input.validUntil) || now !== undefined && (Date.parse(input.validUntil) <= Date.parse(now)
      || Date.parse(input.validUntil) > Date.parse(now) + 7 * 86_400_000)) recallServerFail("recall_invalid_input", 400);
}

export function createEduPiRecallSettingsService(dependencies: RecallSettingsDependencies = {}) {
  const runtime = dependencies.runtime ?? defaultRecallRuntime;
  const restart = dependencies.restartRoot ?? (options => defaultRecallRuntime(options, true));
  const resident = dependencies.resident ?? (dependencies.runtime ? async () => null : defaultRecallResident);
  const restartStopped = dependencies.restartRoot ?? restartStoppedRecallRuntime;
  const optionsFor = async () => ({ ...(dependencies.options ? dependencies.options() : await defaultRecallOptions()) });
  async function pause(host: RecallServerHost, rootRef: string, ownerId: string, grant: Record<string, unknown>) {
    if (!isR04RecallGrantId(grant.id)) recallServerFail("recall_grant_changed", 409);
    if (grant.status !== "active") return;
    const result = recallCoreResult(await host.callOwnerControl("owner_control", {
      command_id: `r04-stop-${randomBytes(16).toString("hex")}`, root_ref: rootRef, expected_owner_id: ownerId,
      action: "pause", grant_id: grant.id, expected_version: grant.version,
    }));
    if (result.owner_id !== ownerId || result.grant_id !== grant.id || result.grant_version !== Number(grant.version) + 1) {
      recallServerFail("recall_stop_unknown");
    }
    const state = await readRecallOwner(host, rootRef), saved = state.grants.find(item => item.id === grant.id);
    if (state.ownerId !== ownerId || saved?.status !== "paused" || saved.version !== result.grant_version) {
      recallServerFail("recall_stop_unknown");
    }
  }
  return {
    async get(): Promise<RecallSettingsView> { return view(await optionsFor(), dependencies); },
    async update(value: unknown): Promise<RecallSettingsView> {
      const input = structuredClone(value);
      validateInput(input);
      if (input.enabled && !recallNormalApproved(dependencies)) recallServerFail("recall_normal_not_approved", 403);
      const options = await optionsFor();
      validateInput(input, options.now ?? new Date().toISOString());
      if (input.enabled && isSafeModeEnabled(options.env ?? process.env)) recallServerFail("recall_inactive", 409);
      return withRecallRootOperation(options, async () => {
        const previous = readEduPiRecallConfig(options, dependencies);
        if (["invalid", "root_mismatch"].includes(previous.status)) recallServerFail("recall_storage_unavailable");
        if ((previous.config?.updatedAt ?? null) !== input.expectedUpdatedAt) recallServerFail("recall_config_conflict", 409);
        if (!input.enabled) {
          // The durable stop fence is first and defeats the isolated canary environment too.
          const off = await writeEduPiRecallConfig({ enabled: false }, { ...options, expectedUpdatedAt: input.expectedUpdatedAt });
          invalidateEduPiRecallRoot(options.dataRoot);
          let grants: "paused" | "none" | "unknown" = "unknown", stopped = false;
          let offHost: RecallServerHost | null = null;
          let fallbackAttempted = false, previousRootRef: string | null = null;
          const assertOff = () => {
            const current = readEduPiRecallConfig(options, dependencies);
            if (current.status !== "ready" || current.config?.enabled !== false || current.config.updatedAt !== off.updatedAt) {
              recallServerFail("recall_config_conflict", 409);
            }
          };
          try {
            let host = await resident(options);
            if (!host) { fallbackAttempted = true; offHost = await restartStopped(options); host = offHost; }
            assertOff();
            const rootRef = await verifiedRecallRootRef(host);
            if (host !== offHost && host.dataRootFingerprint !== rootRef) recallServerFail("recall_root_changed");
            previousRootRef = rootRef;
            const state = await readRecallOwner(host, rootRef);
            if (previous.config?.enabled && state.ownerId !== previous.config.ownerId) recallServerFail("recall_owner_invalid");
            const targets = state.grants.filter(item => isR04RecallGrantId(item.id)
              && (!previous.config?.enabled || item.id === previous.config.grantId));
            if (targets.length && !state.ownerId) throw new Error("owner_missing");
            if (previous.config?.enabled && targets.length) {
              const expected = previous.config;
              const spec = recallGrantSpec(expected.scope, options, expected.budgetId, expected.limit, expected.validUntil);
              if (targets[0].version !== expected.grantVersion || targets[0].ends_at !== expected.validUntil
                || !["scope", "domains", "actions", "source_ids", "budget"].every(key =>
                  isDeepStrictEqual(targets[0][key], spec[key as keyof typeof spec]))) recallServerFail("recall_grant_changed");
            }
            for (const grant of targets) { assertOff(); await pause(host, rootRef, state.ownerId!, grant); }
            grants = targets.length ? "paused" : "none";
          } catch { /* Off is durable; an unknown Core stop is reported as unknown. */ }
          assertOff();
          try {
            if (fallbackAttempted && !offHost) throw new Error("restart_unknown");
            const host = offHost ?? await restartStopped(options);
            const rootRef = await verifiedRecallRootRef(host);
            stopped = (!previousRootRef || previousRootRef === rootRef) && host.recallAnswersActive === false;
          } catch { /* Do not claim a process stopped after a lost restart result. */ }
          assertOff();
          return { ...view(options, dependencies), stop: { status: stopped && grants !== "unknown" ? "stopped" : "unknown", grants } };
        }
        const selected = await (dependencies.preflightModel ?? preflightModel)(options);
        if (!isDeepStrictEqual(selected, input.model)) recallServerFail("recall_model_mismatch", 409);
        if (!recallNormalApproved(dependencies)) recallServerFail("recall_normal_not_approved", 403);
        const token = randomBytes(24).toString("hex"), grantId = `r04_recall_${token}`;
        const budgetId = `r04_recall_budget_${token}`, consentId = `r04-consent-${token}`;
        let host: RecallServerHost | undefined, rootRef: string | undefined, ownerId: string | null = null;
        let committed: EduPiRecallConfig | null = null;
        try {
          host = await runtime(options); rootRef = await verifiedRecallRootRef(host);
          let state = await readRecallOwner(host, rootRef); ownerId = state.ownerId;
          if (!ownerId) {
            const boot = recallCoreResult(await host.callOwnerControl("owner_control", {
              command_id: `r04-bootstrap-${token}`, root_ref: rootRef, expected_owner_id: null, action: "bootstrap",
            }));
            if (!recallId(boot.owner_id)) recallServerFail("recall_owner_invalid");
            state = await readRecallOwner(host, rootRef); ownerId = state.ownerId;
            if (ownerId !== boot.owner_id) recallServerFail("recall_owner_invalid");
          }
          if (!ownerId || state.grants.some(item => item.id === grantId)) recallServerFail("recall_grant_changed", 409);
          const spec = recallGrantSpec(input.scope, options, budgetId, input.limit, input.validUntil);
          const created = recallCoreResult(await host.callOwnerControl("owner_control", {
            command_id: `r04-grant-${token}`, root_ref: rootRef, expected_owner_id: ownerId,
            action: "create", grant_id: grantId, expected_version: 0, spec,
          }));
          if (created.owner_id !== ownerId || created.grant_id !== grantId || created.grant_version !== 1) {
            recallServerFail("recall_grant_changed", 409);
          }
          const binding = { enabled: true as const, purpose: "r04_recall_answer" as const, ownerId, grantId,
            grantVersion: 1, scope: input.scope, model: input.model, budgetId, limit: input.limit,
            validUntil: input.validUntil, consentId };
          await assertRecallGrantCurrent(host, rootRef, binding, options);
          committed = await writeEduPiRecallConfig(binding, { ...options, expectedUpdatedAt: input.expectedUpdatedAt }, dependencies);
          const restarted = await restart(options), restartedRoot = await verifiedRecallRootRef(restarted);
          if (restartedRoot !== rootRef || restarted.recallAnswersActive !== true) recallServerFail("recall_activation_failed");
          if (!committed.enabled) recallServerFail("recall_activation_failed");
          await assertRecallGrantCurrent(restarted, rootRef, committed, options);
          const current = readEduPiRecallConfig(options, dependencies);
          if (!current.enabled || current.config?.updatedAt !== committed.updatedAt) recallServerFail("recall_config_conflict", 409);
          return view(options, dependencies);
        } catch (error) {
          // A CAS loser owns only its newly generated grant, never the winning config.
          const current = readEduPiRecallConfig(options, dependencies).config;
          if (current?.enabled && current.consentId === consentId
            || (current?.updatedAt ?? null) === input.expectedUpdatedAt) {
            try { await writeEduPiRecallConfig({ enabled: false }, { ...options, expectedUpdatedAt: current?.updatedAt ?? null }); }
            catch { /* A later writer must not be overwritten by rollback. */ }
          }
          if (host && rootRef && ownerId) {
            try {
              const state = await readRecallOwner(host, rootRef), own = state.grants.find(item => item.id === grantId);
              if (state.ownerId === ownerId && own) await pause(host, rootRef, ownerId, own);
            } catch { /* Never broaden cleanup to another grant or owner. */ }
          }
          // Revoke the failed activation in the host only if it is still our off revision.
          const after = readEduPiRecallConfig(options, dependencies).config;
          if (committed && after && !after.enabled) { try { await restart(options); } catch { /* unknown, still off */ } }
          throw error;
        }
      });
    },
  };
}

export function recallServerError(error: unknown): { status: number; code: string } {
  if (error instanceof EduPiRecallServerError) return { status: error.status, code: error.code };
  if (error instanceof EduPiRecallError) return { status: error.code.includes("conflict") ? 409
    : error.code === "recall_invalid_input" ? 400 : error.code === "recall_normal_not_approved" ? 403 : 503, code: error.code };
  return { status: 503, code: "recall_unavailable" };
}
