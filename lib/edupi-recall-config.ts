import { isSafeModeEnabled } from "./safe-mode.ts";
import { EduPiRecallError, openRecallStore, readRecallJson, recallFail, recallHash, recallHashValid, recallId, recallKeys,
  recallTime, RECALL_CONFIG_FILE, RECALL_LEDGER_FILE, snapshotRecallInput, withRecallMutation, writeRecallJson,
  type RecallRootOptions } from "./edupi-recall-store.ts";

export { EduPiRecallError };
/** Release decision owned by source control. No setting or environment variable can approve normal recall. */
export const EDUPI_RECALL_NORMAL_RELEASE_APPROVED = false;
export type EduPiRecallScope = { classId: string; subject: string; termId?: string };
export type EduPiRecallModel = { provider: string; modelId: string };
export type EduPiRecallBinding = {
  purpose: "r04_recall_answer";
  ownerId: string;
  grantId: string;
  grantVersion: number;
  scope: EduPiRecallScope;
  model: EduPiRecallModel;
  budgetId: string;
  limit: number;
  validUntil: string;
  consentId: string;
};
export type EduPiRecallConfig = {
  kind: "r04_recall_config"; version: 1; dataRootHash: string; updatedAt: string; authorizationInitialized: boolean;
} & ({ enabled: false } | ({ enabled: true; mode: "normal" } & EduPiRecallBinding));
export type EduPiRecallConfigInput = { enabled: false } | ({ enabled: true; mode?: "normal" } & EduPiRecallBinding);
export type EduPiRecallOptions = RecallRootOptions & { env?: NodeJS.ProcessEnv; now?: string };
/** Trusted code dependencies only. Never populate this argument from HTTP input. */
export type EduPiRecallDependencies = { approveNormal?: () => boolean };
export type EduPiRecallActivation = {
  mode: "off" | "canary" | "normal";
  enabled: boolean;
  reason: "missing" | "invalid" | "root_mismatch" | "safe_mode" | "stopped" | "expired"
    | "normal_not_approved" | "ready";
  /** A persisted request, never an authorization by itself. Use activation.enabled. */
  config: EduPiRecallConfig | null;
};
export type EduPiRecallConfigRead = EduPiRecallActivation & { status: "missing" | "invalid" | "root_mismatch" | "ready" };

export function validRecallScope(value: unknown): value is EduPiRecallScope {
  return recallKeys(value, ["classId", "subject"], ["termId"]) && recallId(value.classId)
    && typeof value.subject === "string" && value.subject.length >= 1 && value.subject.length <= 128
    && value.subject.trim() === value.subject && !/[\u0000-\u001f\u007f]/u.test(value.subject)
    && (!Object.hasOwn(value, "termId") || recallId(value.termId));
}
export function validRecallModel(value: unknown): value is EduPiRecallModel {
  return recallKeys(value, ["provider", "modelId"]) && recallId(value.provider) && recallId(value.modelId);
}
const BINDING_KEYS = ["purpose", "ownerId", "grantId", "grantVersion", "scope", "model", "budgetId", "limit", "validUntil", "consentId"];
export function validRecallBinding(value: Record<string, unknown>): boolean {
  return value.purpose === "r04_recall_answer"
    && typeof value.ownerId === "string" && /^[A-Za-z0-9_][A-Za-z0-9_.:-]{0,127}$/u.test(value.ownerId)
    && typeof value.grantId === "string" && /^r04_recall_[a-f0-9]{1,128}$/u.test(value.grantId)
    && Number.isSafeInteger(value.grantVersion) && Number(value.grantVersion) >= 1
    && validRecallScope(value.scope) && validRecallModel(value.model)
    && typeof value.budgetId === "string" && /^r04_recall_budget_[a-f0-9]{1,128}$/u.test(value.budgetId)
    && Number.isSafeInteger(value.limit) && Number(value.limit) >= 1 && Number(value.limit) <= 12
    && recallTime(value.validUntil) && recallId(value.consentId);
}
function validStored(value: unknown): value is EduPiRecallConfig {
  if (!recallKeys(value, ["kind", "version", "dataRootHash", "enabled", "updatedAt", "authorizationInitialized"],
    ["mode", ...BINDING_KEYS]) || value.kind !== "r04_recall_config" || value.version !== 1
    || !recallHashValid(value.dataRootHash) || !recallTime(value.updatedAt) || typeof value.authorizationInitialized !== "boolean") return false;
  return value.enabled === false
    ? recallKeys(value, ["kind", "version", "dataRootHash", "enabled", "updatedAt", "authorizationInitialized"])
    : value.enabled === true && value.authorizationInitialized === true
      && recallKeys(value, ["kind", "version", "dataRootHash", "enabled", "updatedAt", "authorizationInitialized", "mode", ...BINDING_KEYS])
      && value.mode === "normal" && validRecallBinding(value);
}
function approved(dependencies: EduPiRecallDependencies): boolean {
  return EDUPI_RECALL_NORMAL_RELEASE_APPROVED || dependencies.approveNormal?.() === true;
}
function canaryRequested(env: NodeJS.ProcessEnv): boolean {
  return env.EDUPI_CORE_RECALL_ANSWERS === "1" && env.EDUPI_DESKTOP_ISOLATED_CANARY === "1";
}
export function readEduPiRecallConfig(options: EduPiRecallOptions, dependencies: EduPiRecallDependencies = {}): EduPiRecallConfigRead {
  const off = (reason: EduPiRecallActivation["reason"], config: EduPiRecallConfig | null = null,
    status: EduPiRecallConfigRead["status"] = "ready"): EduPiRecallConfigRead => ({ mode: "off", enabled: false, reason, config, status });
  try {
    const store = openRecallStore(options), value = readRecallJson(store, RECALL_CONFIG_FILE);
    const env = options.env ?? process.env;
    // Legacy isolated QA has no config file. Its environment never approves normal mode.
    if (!value) return isSafeModeEnabled(env) ? off("safe_mode", null, "missing")
      : canaryRequested(env) ? { mode: "canary", enabled: true, reason: "ready", config: null, status: "missing" }
        : off("missing", null, "missing");
    if (!validStored(value)) return off("invalid", null, "invalid");
    if (value.dataRootHash !== store.dataRootHash) return off("root_mismatch", null, "root_mismatch");
    const now = options.now ?? new Date().toISOString();
    if (!recallTime(now)) return off("invalid", null, "invalid");
    if (isSafeModeEnabled(options.env ?? process.env)) return off("safe_mode", value);
    if (!value.enabled) return off("stopped", value);
    if (Date.parse(value.validUntil) <= Date.parse(now)) return off("expired", value);
    if (!approved(dependencies)) return off("normal_not_approved", value);
    return { mode: value.mode, enabled: true, reason: "ready", config: value, status: "ready" };
  } catch { return off("invalid", null, "invalid"); }
}
export function readEduPiRecallActivation(options: EduPiRecallOptions, dependencies: EduPiRecallDependencies = {}): EduPiRecallActivation {
  const value = readEduPiRecallConfig(options, dependencies);
  return { mode: value.mode, enabled: value.enabled, reason: value.reason, config: value.config };
}

export function eduPiRecallConversationId(scope: EduPiRecallScope, options: RecallRootOptions): string {
  if (!validRecallScope(scope)) recallFail("recall_invalid_input");
  const store = openRecallStore(options);
  return `edupi.desktop.recall.${recallHash(JSON.stringify([store.dataRootHash, scope.classId, scope.subject, scope.termId ?? null])).slice(7)}`;
}

/**
 * CAS is mandatory, including null for first creation. enabled:false is an R04 stop fence;
 * it never changes G1. normalApproved is deliberately false-only and cannot open the release gate.
 */
export async function writeEduPiRecallConfig(input: EduPiRecallConfigInput,
  options: EduPiRecallOptions & { expectedUpdatedAt: string | null; normalApproved?: false },
  dependencies: EduPiRecallDependencies = {}): Promise<EduPiRecallConfig> {
  input = snapshotRecallInput(input);
  options = { ...options };
  if (!recallKeys(input, ["enabled"], ["mode", ...BINDING_KEYS]) || typeof input.enabled !== "boolean"
    || !Object.hasOwn(options, "expectedUpdatedAt")
    || options.expectedUpdatedAt !== null && !recallTime(options.expectedUpdatedAt)
    || options.normalApproved !== undefined && options.normalApproved !== false) recallFail("recall_invalid_input");
  if (!input.enabled && !recallKeys(input, ["enabled"])) recallFail("recall_invalid_input");
  if (input.enabled && (!recallKeys(input, ["enabled", ...BINDING_KEYS], ["mode"])
    || !validRecallBinding(input) || input.mode !== undefined && input.mode !== "normal")) recallFail("recall_invalid_input");
  if (input.enabled && !approved(dependencies)) recallFail("recall_normal_not_approved");
  const env = options.env ?? process.env, now = options.now ?? new Date().toISOString();
  if (!recallTime(now)) recallFail("recall_invalid_input");
  if (input.enabled && (isSafeModeEnabled(env) || Date.parse(input.validUntil) <= Date.parse(now))) recallFail("recall_inactive");
  return withRecallMutation(options, store => {
    if (input.enabled && !approved(dependencies)) recallFail("recall_normal_not_approved");
    if (input.enabled && isSafeModeEnabled(options.env ?? process.env)) recallFail("recall_inactive");
    const current = readRecallJson(store, RECALL_CONFIG_FILE);
    if (current !== null && (!validStored(current) || current.dataRootHash !== store.dataRootHash)) recallFail();
    const previous = current as EduPiRecallConfig | null;
    if ((previous?.updatedAt ?? null) !== options.expectedUpdatedAt) recallFail("recall_config_conflict");
    const mutationNow = options.now ?? new Date().toISOString();
    if (input.enabled && Date.parse(input.validUntil) <= Date.parse(mutationNow)) recallFail("recall_inactive");
    if (input.enabled) {
      const ledger = readRecallJson(store, RECALL_LEDGER_FILE);
      if (ledger === null) {
        // Only the first enable bootstraps accounting. Losing a ledger must not reset quota.
        if (previous?.authorizationInitialized) recallFail();
        writeRecallJson(store, RECALL_LEDGER_FILE, { kind: "r04_recall_authorization", version: 1,
          dataRootHash: store.dataRootHash, intents: [], budgets: [], attempts: [] });
      } else if (!recallKeys(ledger, ["kind", "version", "dataRootHash", "intents", "budgets", "attempts"])
        || ledger.kind !== "r04_recall_authorization" || ledger.version !== 1 || ledger.dataRootHash !== store.dataRootHash
        || !Array.isArray(ledger.intents) || !Array.isArray(ledger.budgets) || !Array.isArray(ledger.attempts)) recallFail();
    }
    // Monotonic revisions also fence stop/re-enable within the same millisecond.
    const updatedAt = new Date(Math.max(Date.parse(mutationNow), previous ? Date.parse(previous.updatedAt) + 1 : 0)).toISOString();
    const value: EduPiRecallConfig = input.enabled
      ? { ...input, kind: "r04_recall_config", version: 1, dataRootHash: store.dataRootHash,
        mode: "normal", updatedAt, authorizationInitialized: true }
      : { kind: "r04_recall_config", version: 1, dataRootHash: store.dataRootHash, enabled: false,
        updatedAt, authorizationInitialized: previous?.authorizationInitialized ?? false };
    if (!validStored(value)) recallFail("recall_invalid_input");
    writeRecallJson(store, RECALL_CONFIG_FILE, value);
    return value;
  });
}
