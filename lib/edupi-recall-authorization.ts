import { isDeepStrictEqual } from "node:util";
import { readEduPiRecallActivation, validRecallBinding, validRecallModel, validRecallScope,
  type EduPiRecallBinding, type EduPiRecallConfig, type EduPiRecallDependencies, type EduPiRecallModel,
  type EduPiRecallOptions, type EduPiRecallScope } from "./edupi-recall-config.ts";
import { EduPiRecallError, openRecallStore, readRecallJson, recallFail, recallHash, recallHashValid, recallId,
  recallKeys, recallTime, RECALL_LEDGER_FILE, withRecallMutation, writeRecallJson,
  snapshotRecallInput, type RecallErrorCode, type RecallStore } from "./edupi-recall-store.ts";

export type EduPiRecallRegistration = {
  messageRef: string; producerEpoch: string; sequence: number; fencingGeneration: number; instanceNonce: string;
};
export type EduPiRecallIntentInput = {
  sessionId: string; clientRequestId: string; rawQuery: string;
  ownerId: string; grantId: string; grantVersion: number; scope: EduPiRecallScope; configConsentId: string;
};
export type EduPiRecallIntent = {
  intentId: string; sessionId: string; clientRequestId: string; rawQuery: string; queryHash: string;
  binding: EduPiRecallBinding; configUpdatedAt: string; state: "prepared" | "captured" | "revoked";
  messageRef: string | null; registration: EduPiRecallRegistration | null; createdAt: string; updatedAt: string;
};
export type EduPiRecallIntentSelector = { intentId: string } | { sessionId: string; clientRequestId: string };
export type EduPiRecallIntentRead = {
  intent: EduPiRecallIntent | null; usable: boolean; readyForDispatch: boolean;
  reason: "ready" | "missing" | "revoked" | "binding_changed" | "inactive" | "invalid";
};
export type EduPiRecallModelAttempt = {
  requestId: string; intentId: string; budgetId: string; queryHash: string; modelKey: EduPiRecallModel;
  reservedAt: string; status: "unknown" | "used";
};
export type EduPiRecallModelAttemptInput = {
  requestId: string; intentId?: string; model: { provider: string; id: string };
  rawQuery?: string; queryHash?: string;
  purpose?: "r04_recall_answer";
};
export type EduPiRecallModelPermit = {
  permitted: true; requestId: string; intentId: string; budgetId: string; queryHash: string;
  modelKey: EduPiRecallModel; used: number; remaining: number;
} | { permitted: false; reason: RecallErrorCode };
type Budget = { binding: EduPiRecallBinding; createdAt: string };
type Ledger = {
  kind: "r04_recall_authorization"; version: 1; dataRootHash: string;
  intents: EduPiRecallIntent[]; budgets: Budget[]; attempts: EduPiRecallModelAttempt[];
};
type ActiveConfig = Extract<EduPiRecallConfig, { enabled: true }>;
const BINDING_KEYS = ["purpose", "ownerId", "grantId", "grantVersion", "scope", "model", "budgetId", "limit", "validUntil", "consentId"];
const INTENT_KEYS = ["intentId", "sessionId", "clientRequestId", "rawQuery", "queryHash", "binding",
  "configUpdatedAt", "state", "messageRef", "registration", "createdAt", "updatedAt"];
const INTENT_ID = /^r04_intent_[a-f0-9]{64}$/u;
const MESSAGE_REF = /^owner_message:[a-f0-9]{64}$/u;
const same = isDeepStrictEqual;
const validQuery = (value: unknown): value is string => typeof value === "string"
  && value.length <= 24_000 && value.trim().length > 0 && !value.includes("\0")
  && Buffer.from(value, "utf8").toString("utf8") === value;
function intentId(rootHash: string, sessionId: string, clientRequestId: string): string {
  return `r04_intent_${recallHash(JSON.stringify([rootHash, sessionId, clientRequestId])).slice(7)}`;
}
function binding(config: ActiveConfig): EduPiRecallBinding {
  const { ownerId, grantId, grantVersion, scope, model, budgetId, limit, validUntil, consentId } = config;
  return structuredClone({ purpose: "r04_recall_answer", ownerId, grantId, grantVersion, scope, model, budgetId, limit, validUntil, consentId });
}
function validBinding(value: unknown): value is EduPiRecallBinding {
  return recallKeys(value, BINDING_KEYS) && validRecallBinding(value);
}
function validRegistration(value: unknown): value is EduPiRecallRegistration {
  return recallKeys(value, ["messageRef", "producerEpoch", "sequence", "fencingGeneration", "instanceNonce"])
    && typeof value.messageRef === "string" && MESSAGE_REF.test(value.messageRef)
    && typeof value.producerEpoch === "string" && /^[a-f0-9]{64}$/u.test(value.producerEpoch)
    && Number.isSafeInteger(value.sequence) && Number(value.sequence) >= 1
    && Number.isSafeInteger(value.fencingGeneration) && Number(value.fencingGeneration) >= 1
    && recallId(value.instanceNonce);
}
function validIntent(value: unknown, rootHash: string): value is EduPiRecallIntent {
  if (!recallKeys(value, INTENT_KEYS) || !recallId(value.sessionId) || !recallId(value.clientRequestId)
    || value.intentId !== intentId(rootHash, value.sessionId, value.clientRequestId)
    || !validQuery(value.rawQuery) || value.queryHash !== recallHash(value.rawQuery) || !validBinding(value.binding)
    || !recallTime(value.configUpdatedAt) || !recallTime(value.createdAt) || !recallTime(value.updatedAt)
    || Date.parse(value.updatedAt) < Date.parse(value.createdAt)
    || !["prepared", "captured", "revoked"].includes(String(value.state))) return false;
  if (value.state === "prepared") return value.messageRef === null && value.registration === null;
  return value.messageRef === null && value.registration === null && value.state === "revoked"
    || validRegistration(value.registration) && value.registration.messageRef === value.messageRef;
}
function validAttempt(value: unknown): value is EduPiRecallModelAttempt {
  return recallKeys(value, ["requestId", "intentId", "budgetId", "queryHash", "modelKey", "reservedAt", "status"])
    && recallId(value.requestId) && typeof value.intentId === "string" && INTENT_ID.test(value.intentId)
    && typeof value.budgetId === "string" && /^r04_recall_budget_[a-f0-9]{1,128}$/u.test(value.budgetId)
    && recallHashValid(value.queryHash) && validRecallModel(value.modelKey) && recallTime(value.reservedAt)
    && (value.status === "unknown" || value.status === "used");
}
function readLedger(store: RecallStore): Ledger {
  const value = readRecallJson(store, RECALL_LEDGER_FILE);
  if (!value) recallFail();
  if (!recallKeys(value, ["kind", "version", "dataRootHash", "intents", "budgets", "attempts"])
    || value.kind !== "r04_recall_authorization" || value.version !== 1 || value.dataRootHash !== store.dataRootHash
    || !Array.isArray(value.intents) || value.intents.length > 2_000 || !value.intents.every(item => validIntent(item, store.dataRootHash))
    || !Array.isArray(value.budgets) || value.budgets.length > 2_000
    || !value.budgets.every(item => recallKeys(item, ["binding", "createdAt"]) && validBinding(item.binding) && recallTime(item.createdAt))
    || !Array.isArray(value.attempts) || value.attempts.length > 24_000 || !value.attempts.every(validAttempt)) recallFail();
  const ledger = value as Ledger;
  const intents = new Map(ledger.intents.map(item => [item.intentId, item]));
  const budgets = new Map(ledger.budgets.map(item => [item.binding.budgetId, item]));
  if (intents.size !== ledger.intents.length || budgets.size !== ledger.budgets.length
    || new Set(ledger.intents.flatMap(item => item.messageRef === null ? [] : [item.messageRef])).size
      !== ledger.intents.filter(item => item.messageRef !== null).length
    || new Set(ledger.budgets.map(item => JSON.stringify([item.binding.grantId, item.binding.grantVersion]))).size !== budgets.size
    || new Set(ledger.attempts.map(item => item.requestId)).size !== ledger.attempts.length) recallFail();
  const counts = new Map<string, number>();
  for (const attempt of ledger.attempts) {
    const intent = intents.get(attempt.intentId), budget = budgets.get(attempt.budgetId);
    if (!intent || !budget || !same(intent.binding, budget.binding) || attempt.queryHash !== intent.queryHash
      || !same(attempt.modelKey, intent.binding.model) || intent.messageRef === null
      || Date.parse(attempt.reservedAt) >= Date.parse(budget.binding.validUntil)) recallFail();
    const used = (counts.get(attempt.budgetId) ?? 0) + 1;
    if (used > budget.binding.limit) recallFail();
    counts.set(attempt.budgetId, used);
  }
  return ledger;
}
function nowFor(options: EduPiRecallOptions): string {
  const now = options.now ?? new Date().toISOString();
  if (!recallTime(now)) recallFail("recall_invalid_input");
  return now;
}
function currentConfig(options: EduPiRecallOptions, dependencies: EduPiRecallDependencies): ActiveConfig {
  const activation = readEduPiRecallActivation(options, dependencies);
  if (!activation.enabled || activation.mode !== "normal" || !activation.config?.enabled) recallFail("recall_inactive");
  return activation.config;
}
function currentIntent(intent: EduPiRecallIntent, config: ActiveConfig): boolean {
  return intent.state !== "revoked" && intent.configUpdatedAt === config.updatedAt && same(intent.binding, binding(config));
}
function validSelector(value: unknown): value is EduPiRecallIntentSelector {
  return recallKeys(value, ["intentId"]) && typeof value.intentId === "string" && INTENT_ID.test(value.intentId)
    || recallKeys(value, ["sessionId", "clientRequestId"]) && recallId(value.sessionId) && recallId(value.clientRequestId);
}
function selectIntent(ledger: Ledger, selector: EduPiRecallIntentSelector, rootHash: string): EduPiRecallIntent | undefined {
  const id = "intentId" in selector ? selector.intentId : intentId(rootHash, selector.sessionId, selector.clientRequestId);
  return ledger.intents.find(item => item.intentId === id);
}

/** Host-owned user intent only; no G1 outbox or grant is consulted or created. */
export async function prepareRecallIntent(input: EduPiRecallIntentInput, options: EduPiRecallOptions,
  dependencies: EduPiRecallDependencies = {}): Promise<EduPiRecallIntent> {
  input = snapshotRecallInput(input);
  options = { ...options };
  if (!recallKeys(input, ["sessionId", "clientRequestId", "rawQuery", "ownerId", "grantId", "grantVersion", "scope", "configConsentId"])
    || !recallId(input.sessionId) || !recallId(input.clientRequestId) || !validQuery(input.rawQuery)
    || !validRecallScope(input.scope)) recallFail("recall_invalid_input");
  return withRecallMutation(options, store => {
    const now = nowFor(options);
    const config = currentConfig({ ...options, stateDir: store.stateDir, dataRoot: store.dataRoot, now }, dependencies), ledger = readLedger(store);
    if (input.ownerId !== config.ownerId || input.grantId !== config.grantId || input.grantVersion !== config.grantVersion
      || !same(input.scope, config.scope) || input.configConsentId !== config.consentId) recallFail("recall_binding_mismatch");
    const id = intentId(store.dataRootHash, input.sessionId, input.clientRequestId);
    const previous = ledger.intents.find(item => item.intentId === id);
    if (previous) {
      if (previous.rawQuery !== input.rawQuery || !currentIntent(previous, config)) recallFail("recall_intent_conflict");
      return previous;
    }
    if (ledger.intents.length >= 2_000) recallFail("recall_capacity");
    const intent: EduPiRecallIntent = {
      intentId: id, sessionId: input.sessionId, clientRequestId: input.clientRequestId,
      rawQuery: input.rawQuery, queryHash: recallHash(input.rawQuery), binding: binding(config),
      configUpdatedAt: config.updatedAt, state: "prepared", messageRef: null, registration: null, createdAt: now, updatedAt: now,
    };
    ledger.intents.push(intent);
    writeRecallJson(store, RECALL_LEDGER_FILE, ledger);
    return intent;
  });
}
/** Read-only receipt/person checks use this function and never reserve model budget. */
export function readRecallIntent(selector: EduPiRecallIntentSelector, options: EduPiRecallOptions,
  dependencies: EduPiRecallDependencies = {}): EduPiRecallIntentRead {
  const result = (intent: EduPiRecallIntent | null, reason: EduPiRecallIntentRead["reason"]): EduPiRecallIntentRead =>
    ({ intent, usable: reason === "ready", readyForDispatch: reason === "ready" && intent?.state === "captured", reason });
  try {
    if (!validSelector(selector)) return result(null, "invalid");
    const store = openRecallStore(options), intent = selectIntent(readLedger(store), selector, store.dataRootHash) ?? null;
    if (!intent) return result(null, "missing");
    if (intent.state === "revoked") return result(intent, "revoked");
    const activation = readEduPiRecallActivation(options, dependencies);
    if (!activation.enabled || activation.mode !== "normal" || !activation.config?.enabled) return result(intent, "inactive");
    return result(intent, currentIntent(intent, activation.config) ? "ready" : "binding_changed");
  } catch { return result(null, "invalid"); }
}
export async function markCapturedRecallIntent(input: { intentId: string; messageRef: string; registration: EduPiRecallRegistration },
  options: EduPiRecallOptions, dependencies: EduPiRecallDependencies = {}): Promise<EduPiRecallIntent> {
  input = snapshotRecallInput(input);
  options = { ...options };
  if (!recallKeys(input, ["intentId", "messageRef", "registration"]) || !INTENT_ID.test(input.intentId)
    || !validRegistration(input.registration) || input.messageRef !== input.registration.messageRef) recallFail("recall_invalid_input");
  return withRecallMutation(options, store => {
    const now = nowFor(options);
    const config = currentConfig({ ...options, stateDir: store.stateDir, dataRoot: store.dataRoot, now }, dependencies), ledger = readLedger(store);
    const intent = selectIntent(ledger, { intentId: input.intentId }, store.dataRootHash);
    if (!intent || !currentIntent(intent, config)) recallFail("recall_intent_unavailable");
    if (intent.state === "captured") {
      if (intent.messageRef !== input.messageRef || !same(intent.registration, input.registration)) recallFail("recall_intent_conflict");
      return intent;
    }
    if (ledger.intents.some(other => other.intentId !== intent.intentId && other.messageRef === input.messageRef)) recallFail("recall_intent_conflict");
    intent.state = "captured"; intent.messageRef = input.messageRef; intent.registration = structuredClone(input.registration);
    intent.updatedAt = new Date(Math.max(Date.parse(now), Date.parse(intent.updatedAt))).toISOString();
    writeRecallJson(store, RECALL_LEDGER_FILE, ledger);
    return intent;
  });
}
export async function revokeRecallIntent(selector: EduPiRecallIntentSelector, options: EduPiRecallOptions): Promise<EduPiRecallIntent | null> {
  selector = snapshotRecallInput(selector);
  if (!validSelector(selector)) recallFail("recall_invalid_input");
  return withRecallMutation(options, store => {
    const now = nowFor(options);
    const ledger = readLedger(store), intent = selectIntent(ledger, selector, store.dataRootHash);
    if (!intent) return null;
    if (intent.state !== "revoked") {
      intent.state = "revoked";
      intent.updatedAt = new Date(Math.max(Date.parse(now), Date.parse(intent.updatedAt))).toISOString();
      writeRecallJson(store, RECALL_LEDGER_FILE, ledger);
    }
    return intent;
  });
}

/**
 * Call immediately before each actual R04 model IPC dispatch, with that IPC requestId.
 * Only the first successful call grants network permission. Persisted unknown/used attempts
 * both consume quota forever; retrying, cancellation and process death do not refund it.
 */
export async function reserveRecallModelAttempt(input: EduPiRecallModelAttemptInput, options: EduPiRecallOptions,
  dependencies: EduPiRecallDependencies = {}): Promise<EduPiRecallModelPermit> {
  try {
    input = snapshotRecallInput(input);
    options = { ...options };
    if (!recallKeys(input, ["requestId", "model"], ["intentId", "rawQuery", "queryHash", "purpose"])
      || !recallId(input.requestId) || input.intentId !== undefined && !INTENT_ID.test(input.intentId)
      || !recallKeys(input.model, ["provider", "id"]) || !recallId(input.model.provider) || !recallId(input.model.id)
      || Object.hasOwn(input, "rawQuery") === Object.hasOwn(input, "queryHash")
      || Object.hasOwn(input, "rawQuery") && !validQuery(input.rawQuery)
      || Object.hasOwn(input, "queryHash") && !recallHashValid(input.queryHash)) recallFail("recall_invalid_input");
    if (input.purpose !== undefined && input.purpose !== "r04_recall_answer") recallFail("recall_model_dispatch_only");
    const queryHash = input.rawQuery === undefined ? input.queryHash! : recallHash(input.rawQuery);
    const modelKey = { provider: input.model.provider, modelId: input.model.id };
    return await withRecallMutation(options, store => {
      const now = nowFor(options);
      const config = currentConfig({ ...options, stateDir: store.stateDir, dataRoot: store.dataRoot, now }, dependencies), ledger = readLedger(store);
      if (ledger.attempts.some(item => item.requestId === input.requestId)) recallFail("recall_request_replayed");
      const matches = ledger.intents.filter(intent => intent.state === "captured" && currentIntent(intent, config)
        && intent.queryHash === queryHash && (input.rawQuery === undefined || input.rawQuery === intent.rawQuery)
        && (input.intentId === undefined || intent.intentId === input.intentId));
      if (!matches.length) recallFail("recall_intent_unavailable");
      if (matches.length !== 1) recallFail("recall_intent_ambiguous");
      const intent = matches[0];
      if (!same(modelKey, config.model)) recallFail("recall_binding_mismatch");
      const currentBinding = binding(config);
      const budget = ledger.budgets.find(item => item.binding.budgetId === config.budgetId);
      // No implicit rollover, including a new budget ID under the same grant/version.
      if (budget && !same(budget.binding, currentBinding)
        || ledger.budgets.some(item => item.binding.grantId === config.grantId && item.binding.grantVersion === config.grantVersion
          && !same(item.binding, currentBinding))) recallFail("recall_budget_binding_changed");
      const used = ledger.attempts.filter(item => item.budgetId === config.budgetId).length;
      if (used >= config.limit) recallFail("recall_budget_exhausted");
      if (ledger.attempts.length >= 24_000 || !budget && ledger.budgets.length >= 2_000) recallFail("recall_capacity");
      if (!budget) ledger.budgets.push({ binding: currentBinding, createdAt: now });
      ledger.attempts.push({ requestId: input.requestId, intentId: intent.intentId, budgetId: config.budgetId,
        queryHash, modelKey, reservedAt: now, status: "unknown" });
      writeRecallJson(store, RECALL_LEDGER_FILE, ledger);
      return { permitted: true, requestId: input.requestId, intentId: intent.intentId, budgetId: config.budgetId,
        queryHash, modelKey, used: used + 1, remaining: config.limit - used - 1 };
    });
  } catch (error) {
    return { permitted: false, reason: error instanceof EduPiRecallError ? error.code : "recall_storage_unavailable" };
  }
}
/** Accounting only, including after stop/revoke; this function never issues another permit. */
export async function markRecallModelAttempt(input: { requestId: string; status: "used" | "unknown" },
  options: EduPiRecallOptions): Promise<EduPiRecallModelAttempt> {
  input = snapshotRecallInput(input);
  if (!recallKeys(input, ["requestId", "status"]) || !recallId(input.requestId)
    || input.status !== "used" && input.status !== "unknown") recallFail("recall_invalid_input");
  return withRecallMutation(options, store => {
    const ledger = readLedger(store), attempt = ledger.attempts.find(item => item.requestId === input.requestId);
    if (!attempt) recallFail("recall_intent_unavailable");
    if (attempt.status !== input.status) {
      attempt.status = input.status;
      writeRecallJson(store, RECALL_LEDGER_FILE, ledger);
    }
    return attempt;
  });
}
/** Observability for settings; no activation, reservation, rollover or repair occurs on read. */
export function readRecallBudget(budgetId: string, options: EduPiRecallOptions): {
  binding: EduPiRecallBinding; used: number; remaining: number; attempts: EduPiRecallModelAttempt[];
} | null {
  const store = openRecallStore(options), ledger = readLedger(store);
  const budget = ledger.budgets.find(item => item.binding.budgetId === budgetId);
  if (!budget) return null;
  const attempts = ledger.attempts.filter(item => item.budgetId === budgetId);
  return { binding: budget.binding, used: attempts.length, remaining: budget.binding.limit - attempts.length, attempts };
}
