import { realpathSync } from "node:fs";
import { isDeepStrictEqual } from "node:util";
import { eduPiRecallConversationId, readEduPiRecallActivation, type EduPiRecallOptions } from "./edupi-recall-config.ts";
import {
  markCapturedRecallIntent, prepareRecallIntent, readRecallIntent, revokeRecallIntent,
  type EduPiRecallIntent,
} from "./edupi-recall-authorization.ts";
import { recallHash, recallKeys, recallTime, withRecallMutation } from "./edupi-recall-store.ts";
import {
  assertRecallGrantCurrent, defaultRecallOptions, defaultRecallRuntime, recallNormalApproved,
  recallCoreResult, recallServerFail, verifiedRecallRootRef,
  type RecallSettingsDependencies,
} from "./edupi-recall-settings-server.ts";
import { registerPrompt, type RegisteredPromptInput, type RegisteredPromptProof } from "./edupi-registered-prompt";
import { predictEduPiOwnerMessageRef } from "./edupi-ambient-message-runtime";
import { withEduPiAmbientSessionLock } from "./edupi-ambient-session-lock";
import { prepareEduPiAmbientMessageBinding, confirmEduPiAmbientMessageBinding } from "./edupi-ambient-message-ledger";
import {
  listEduPiPromptOutbox, markEduPiPromptOutboxPiAccepted, markEduPiPromptOutboxPiDispatching,
  markEduPiPromptOutboxPiUnknown, prepareEduPiPromptOutbox, readEduPiPromptOutbox,
  recordEduPiPromptOutboxCapture, recordEduPiPromptOutboxRegistration,
  type EduPiPromptOutboxEntry, type EduPiPromptOutboxPrompt,
} from "./edupi-prompt-outbox";

export type RecallPromptInput = { sessionId: string; clientRequestId: string; message: string; occurredAt: string };
export type RecallPromptResult = {
  version: 1; status: "accepted" | "uncertain" | "held"; reasonCode: string | null; externalSend: false;
};
export type RecallPromptInspection = {
  version: 1; status: "accepted" | "uncertain" | "cancelled" | "unavailable" | "not_sent";
  reasonCode: string | null; externalSend: false;
};
type SessionEvidence = "confirmed" | "marker_only" | "mismatch" | "unknown";
export type RecallPromptDependencies = Pick<RecallSettingsDependencies, "options" | "runtime" | "approveNormal"> & {
  sessionPath?: (sessionId: string, options: EduPiRecallOptions) => Promise<string | null>;
  inspectSessionPath?: (sessionId: string, options: EduPiRecallOptions) => Promise<string | null>;
  inspectSession?: (entry: EduPiPromptOutboxEntry, file: string) => Promise<SessionEvidence> | SessionEvidence;
  dispatch?: (entry: EduPiPromptOutboxEntry, options: EduPiRecallOptions) => Promise<void>;
};
const DOMAIN = "teaching_preparation";
const SESSION_ID = /^[A-Za-z0-9][A-Za-z0-9._:@/+~=-]{0,127}$/u;
const REQUEST_ID = /^[A-Za-z0-9_.:-]{1,128}$/u;
const result = (status: RecallPromptResult["status"], reasonCode: string | null = null): RecallPromptResult =>
  ({ version: 1, status, reasonCode, externalSend: false });

/** Recover the independent conversation from the private intent, never a client field or G1. */
export function recallPromptMetadata(intent: EduPiRecallIntent, options: EduPiRecallOptions) {
  const suffix = intent.intentId.slice("r04_intent_".length);
  return {
    conversationId: eduPiRecallConversationId(intent.binding.scope, options),
    captureMessageId: `r04_${suffix}`, carrierId: "edupi.desktop.r04.recall", planId: `r04.recall.${suffix}`,
  };
}
/** Recovery identity comes from the private intent, including after stop/revoke. */
export function readRecallPromptOutboxBinding(entry: EduPiPromptOutboxEntry, options: EduPiRecallOptions, rootRef?: string) {
  const intent = readRecallIntent({ sessionId: entry.sessionId, clientRequestId: entry.clientRequestId }, options).intent;
  const declared = entry.bindings.some(binding =>
    binding.carrierId === "edupi.desktop.r04.recall" || binding.planId.startsWith("r04.recall.")
    || binding.grantId.startsWith("r04_recall_"));
  if (!intent) {
    if (declared) recallServerFail("recall_intent_conflict", 409);
    return null;
  }
  const metadata = recallPromptMetadata(intent, options), binding = entry.bindings[0];
  if (entry.bindings.length !== 1 || !binding || entry.command.type !== "prompt"
    || entry.command.clientRequestId !== intent.clientRequestId || entry.command.message !== intent.rawQuery
    || Object.keys(entry.command).sort().join(",") !== "clientRequestId,message,type"
    || binding.domain !== DOMAIN || binding.ownerId !== intent.binding.ownerId
    || binding.grantId !== intent.binding.grantId || binding.grantVersion !== intent.binding.grantVersion
    || binding.captureMessageId !== metadata.captureMessageId || binding.carrierId !== metadata.carrierId
    || binding.planId !== metadata.planId || entry.messageId !== metadata.captureMessageId
    || binding.registration !== null && binding.registration.messageRef !== binding.messageRef
    || intent.messageRef !== null && (intent.messageRef !== binding.messageRef || !binding.captured
      || !isDeepStrictEqual(intent.registration, binding.registration))) recallServerFail("recall_intent_conflict", 409);
  const expectedMessageRef = rootRef
    ? predictEduPiOwnerMessageRef(rootRef, intent.binding.ownerId, metadata.captureMessageId, DOMAIN, metadata.conversationId)
    : binding.messageRef;
  if (rootRef && binding.messageRef !== null && binding.messageRef !== expectedMessageRef) {
    recallServerFail("recall_intent_conflict", 409);
  }
  return { intent, ...metadata, expectedMessageRef };
}
function validateInput(input: unknown): asserts input is RecallPromptInput {
  if (!recallKeys(input, ["sessionId", "clientRequestId", "message", "occurredAt"])
    || typeof input.sessionId !== "string" || !SESSION_ID.test(input.sessionId)
    || typeof input.clientRequestId !== "string" || !REQUEST_ID.test(input.clientRequestId)
    || typeof input.message !== "string" || !input.message.trim() || input.message.length > 512
    || input.message.includes("\0") || Buffer.from(input.message, "utf8").toString("utf8") !== input.message
    || !recallTime(input.occurredAt)) recallServerFail("recall_invalid_input", 400);
}
async function captureRecallPrompt(host: Awaited<ReturnType<typeof defaultRecallRuntime>>,
  input: RegisteredPromptInput, proof: RegisteredPromptProof): Promise<void> {
  const output = recallCoreResult(await host.callOwnerControl("owner_message", {
    action: "capture", root_ref: input.rootRef, expected_owner_id: proof.binding.ownerId,
    grant_id: proof.binding.grantId, expected_grant_version: proof.binding.grantVersion,
    conversation_id: input.conversationId, message_id: input.messageId, occurred_at: input.occurredAt,
    text: input.text, registration: proof.registration,
  }));
  const receipt = output.receipt;
  if (!receipt || typeof receipt !== "object" || Array.isArray(receipt)) recallServerFail("recall_capture_unknown");
  const item = receipt as Record<string, unknown>;
  if (item.action !== "capture" || item.message_ref !== proof.messageRef || item.revision !== 1
    || item.owner_id !== proof.binding.ownerId || item.root_ref !== input.rootRef
    || item.capture_grant_version !== proof.binding.grantVersion || item.sender_kind !== "local_owner_authenticated"
    || item.source_ref !== `conversation:${recallHash(input.conversationId!).slice(7)}`
    || !recallTime(item.received_at) || !recallTime(item.recorded_at)
    || item.apply !== false || item.live_authority !== false || item.external_send !== false
    || typeof output.replayed !== "boolean") recallServerFail("recall_capture_unknown");
}
async function defaultSessionPath(sessionId: string, options: EduPiRecallOptions): Promise<string | null> {
  const [{ getRpcSession }, { resolveSessionPath }, { openSessionManagerForRead }] = await Promise.all([
    import("./rpc-manager"), import("./session-reader"), import("./session-manager-access"),
  ]);
  const live = getRpcSession(sessionId);
  if (live?.isAlive()) live.ensureSessionPersisted();
  const file = live?.sessionFile ?? await resolveSessionPath(sessionId);
  if (!file) return null;
  const manager = live?.isAlive() ? live.inner.sessionManager : openSessionManagerForRead(sessionId, file);
  if (!manager || manager.getSessionId() !== sessionId || realpathSync(manager.getCwd()) !== realpathSync(options.dataRoot)) return null;
  return file;
}
async function defaultInspect(entry: EduPiPromptOutboxEntry, file: string): Promise<SessionEvidence> {
  const { inspectEduPiPromptSession } = await import("./edupi-prompt-reconciliation");
  return inspectEduPiPromptSession(entry, file);
}
async function readOnlySessionPath(sessionId: string, options: EduPiRecallOptions): Promise<string | null> {
  const [{ getRpcSession }, { resolveSessionPath }, { openSessionManagerForRead }] = await Promise.all([
    import("./rpc-manager"), import("./session-reader"), import("./session-manager-access"),
  ]);
  const live = getRpcSession(sessionId);
  const file = live?.sessionFile ?? await resolveSessionPath(sessionId);
  if (!file) return null;
  const manager = live?.isAlive() ? live.inner.sessionManager : openSessionManagerForRead(sessionId, file);
  return manager?.getSessionId() === sessionId && realpathSync(manager.getCwd()) === realpathSync(options.dataRoot)
    ? file : null;
}
async function defaultDispatch(entry: EduPiPromptOutboxEntry, options: EduPiRecallOptions): Promise<void> {
  const [{ getRpcSession }, { resolveSessionPath }] = await Promise.all([
    import("./rpc-manager"), import("./session-reader"),
  ]);
  let wrapper = getRpcSession(entry.sessionId);
  if (!wrapper?.isAlive()) {
    const file = await resolveSessionPath(entry.sessionId);
    if (!file) recallServerFail("recall_session_unavailable", 409);
    const { startHarnessSession } = await import("./harness/runtime");
    await startHarnessSession(entry.sessionId, file, undefined);
    wrapper = getRpcSession(entry.sessionId);
  }
  if (!wrapper?.isAlive() || realpathSync(wrapper.inner.sessionManager.getCwd()) !== realpathSync(options.dataRoot)) {
    recallServerFail("recall_session_unavailable", 409);
  }
  // This is a private method, not an extra C0 JSON command or a user-controlled latch.
  const current = wrapper;
  let received!: (value: boolean) => void;
  const persisted = new Promise<boolean>(resolve => { received = resolve; });
  const unsubscribe = current.onEvent(event => {
    const item = event as Record<string, unknown>, message = item.message as { role?: unknown } | undefined;
    if (item.clientRequestId !== entry.clientRequestId) return;
    if (item.type === "message_end" && message?.role === "user" && typeof item.entryId === "string") received(true);
    if (["prompt_error", "prompt_done"].includes(String(item.type))) queueMicrotask(() => received(false));
  });
  const deadline = setTimeout(() => received(false), 20_000);
  try {
    current.recordEduPiPromptDispatch(entry.clientRequestId, recallHash(JSON.stringify(entry.command)));
    await current.sendCoreCapturedRecallPrompt(entry.command);
    if (!await persisted) recallServerFail("recall_persistence_unknown");
  } finally { clearTimeout(deadline); unsubscribe(); }
}

export function createEduPiRecallPromptService(dependencies: RecallPromptDependencies = {}) {
  const runtime = dependencies.runtime ?? defaultRecallRuntime;
  const sessionPath = dependencies.sessionPath ?? defaultSessionPath;
  const inspect = dependencies.inspectSession ?? defaultInspect;
  const dispatch = dependencies.dispatch ?? defaultDispatch;
  async function reconcilePriorRecall(sessionId: string, options: EduPiRecallOptions): Promise<void> {
    const unresolved = listEduPiPromptOutbox(options).filter(entry => entry.sessionId === sessionId
      && !["pi_accepted", "pi_accepted_withdrawn", "cancelled"].includes(entry.stage));
    for (const summary of unresolved) {
      const entry = readEduPiPromptOutbox(sessionId, summary.clientRequestId, options);
      if (!entry || !["pi_dispatching", "pi_unknown"].includes(entry.stage)) recallServerFail("recall_prior_unresolved", 409);
      const binding = readRecallPromptOutboxBinding(entry, options);
      if (!binding?.intent.messageRef || !binding.intent.registration) recallServerFail("recall_prior_unresolved", 409);
      const file = await (dependencies.inspectSessionPath ?? dependencies.sessionPath ?? readOnlySessionPath)(sessionId, options);
      if (!file || await inspect(entry, file) !== "confirmed") recallServerFail("recall_prior_unresolved", 409);
      // This runs under the caller's session lock. The root IO lock protects
      // the final comparison and accounting transition, never an SDK await.
      await withRecallMutation(options, () => {
        const latest = readEduPiPromptOutbox(sessionId, entry.clientRequestId, options);
        if (!latest || !readRecallPromptOutboxBinding(latest, options)) recallServerFail("recall_prior_unresolved", 409);
        if (latest.stage === "pi_accepted" && isDeepStrictEqual(latest.command, entry.command)) return;
        if (!isDeepStrictEqual(latest, entry)) recallServerFail("recall_prior_unresolved", 409);
        markEduPiPromptOutboxPiAccepted(sessionId, entry.clientRequestId, options);
      });
    }
  }
  return {
    /** Proof only. Never persist, register, capture, dispatch, or start a runtime. */
    async inspect(sessionId: string, clientRequestId: string): Promise<RecallPromptInspection> {
      if (typeof sessionId !== "string" || !SESSION_ID.test(sessionId)
        || typeof clientRequestId !== "string" || !REQUEST_ID.test(clientRequestId)) {
        recallServerFail("recall_invalid_input", 400);
      }
      const inspection = (status: RecallPromptInspection["status"], reasonCode: string | null = null): RecallPromptInspection =>
        ({ version: 1, status, reasonCode, externalSend: false });
      try {
        const options = { ...(dependencies.options ? dependencies.options() : await defaultRecallOptions()) };
        const read = readRecallIntent({ sessionId, clientRequestId }, options, dependencies);
        const prior = readEduPiPromptOutbox(sessionId, clientRequestId, options);
        if (read.reason === "invalid") return inspection("unavailable", "recall_storage_unavailable");
        if (!prior) return inspection(read.intent && read.intent.state !== "prepared" ? "unavailable" : "not_sent");
        if (!read.intent) return inspection("unavailable", "recall_intent_unavailable");
        if (prior.sessionId !== sessionId || prior.clientRequestId !== clientRequestId
          || !readRecallPromptOutboxBinding(prior, options)) {
          return inspection("unavailable", "recall_intent_conflict");
        }
        if (["cancelled", "pi_unverified_withdrawn"].includes(prior.stage)) return inspection("cancelled");
        if (["prepared", "registered", "captured"].includes(prior.stage)) return inspection("not_sent");
        const file = await (dependencies.inspectSessionPath ?? dependencies.sessionPath ?? readOnlySessionPath)(sessionId, options);
        if (!file) return inspection("unavailable", "recall_session_unavailable");
        const evidence = await inspect(prior, file);
        if (evidence === "confirmed") return inspection("accepted");
        return inspection(evidence === "mismatch" ? "unavailable" : "uncertain", "recall_persistence_unknown");
      } catch { return inspection("unavailable", "recall_persistence_unknown"); }
    },
    async submit(value: unknown): Promise<RecallPromptResult> {
      const input = structuredClone(value);
      validateInput(input);
      if (!recallNormalApproved(dependencies)) recallServerFail("recall_normal_not_approved", 403);
      const options = { ...(dependencies.options ? dependencies.options() : await defaultRecallOptions()) };
      const activation = readEduPiRecallActivation(options, dependencies);
      if (!activation.enabled || activation.mode !== "normal" || !activation.config?.enabled) {
        return result("held", "recall_inactive");
      }
      return withEduPiAmbientSessionLock(input.sessionId, async () => {
        const selector = { sessionId: input.sessionId, clientRequestId: input.clientRequestId };
        const command: EduPiPromptOutboxPrompt = { type: "prompt", message: input.message, clientRequestId: input.clientRequestId };
        const prior = readEduPiPromptOutbox(input.sessionId, input.clientRequestId, options);
        const read = readRecallIntent(selector, options, dependencies);
        if (prior) {
          if (!read.intent || read.intent.rawQuery !== input.message || prior.occurredAt !== input.occurredAt
            || !isDeepStrictEqual(prior.command, command)) recallServerFail("recall_intent_conflict", 409);
          if (!readRecallPromptOutboxBinding(prior, options)) {
            recallServerFail("recall_intent_conflict", 409);
          }
          // Dispatching/unknown is never sent again, even after an OS/server restart.
          if (["pi_dispatching", "pi_unknown", "pi_accepted"].includes(prior.stage)) {
            const file = await sessionPath(input.sessionId, options);
            if (file && await inspect(prior, file) === "confirmed") {
              await withRecallMutation(options, () => markEduPiPromptOutboxPiAccepted(input.sessionId, input.clientRequestId, options));
              return result("accepted");
            }
            return result("uncertain", "recall_persistence_unknown");
          }
          if (["cancelled", "pi_unverified_withdrawn", "pi_accepted_withdrawn"].includes(prior.stage)) {
            return result("held", "recall_source_withdrawn");
          }
          if (!read.usable) return result("held", `recall_${read.reason}`);
        } else await reconcilePriorRecall(input.sessionId, options);
        const active = readEduPiRecallActivation(options, dependencies);
        if (!recallNormalApproved(dependencies) || !active.enabled || active.mode !== "normal" || !active.config?.enabled) {
          return result("held", "recall_inactive");
        }
        const config = active.config, host = await runtime(options), rootRef = await verifiedRecallRootRef(host);
        if (host.recallAnswersActive !== true) recallServerFail("recall_runtime_inactive", 409);
        await assertRecallGrantCurrent(host, rootRef, config, options);
        if (!await sessionPath(input.sessionId, options)) recallServerFail("recall_session_unavailable", 409);
        const intent = await prepareRecallIntent({
          ...selector, rawQuery: input.message, ownerId: config.ownerId, grantId: config.grantId,
          grantVersion: config.grantVersion, scope: config.scope, configConsentId: config.consentId,
        }, options, dependencies);
        const metadata = recallPromptMetadata(intent, options);
        let outbox = await withRecallMutation(options, () => prepareEduPiPromptOutbox({
          ...selector, messageId: metadata.captureMessageId, occurredAt: input.occurredAt, command,
          bindings: [{ domain: DOMAIN, ownerId: config.ownerId, grantId: config.grantId,
            grantVersion: config.grantVersion, captureMessageId: metadata.captureMessageId,
            carrierId: metadata.carrierId, planId: metadata.planId }],
        }, options));
        try {
          const binding = outbox.bindings[0];
          if (!binding.captured) {
            const registrationInput: RegisteredPromptInput = {
              rootRef, grantId: config.grantId, sessionId: input.sessionId,
              messageId: metadata.captureMessageId, text: input.message, occurredAt: input.occurredAt,
              domain: DOMAIN, conversationId: metadata.conversationId, carrierId: metadata.carrierId, planId: metadata.planId,
              previousBinding: { ownerId: config.ownerId, grantId: config.grantId, grantVersion: config.grantVersion },
            };
            const proof = await registerPrompt(host, registrationInput, {
              onBound: () => recallServerFail("recall_binding_changed", 409),
              onRegistered() {},
            });
            // Persist registration before sending capture, under the same root IO lock as the dispatch claim.
            outbox = await withRecallMutation(options, () => {
              const latest = readEduPiPromptOutbox(input.sessionId, input.clientRequestId, options);
              if (!latest) recallServerFail("recall_capture_unknown");
              if (!["prepared", "registered", "captured"].includes(latest.stage)) return latest;
              if (!latest.bindings[0].captured) {
                outbox = recordEduPiPromptOutboxRegistration(input.sessionId, input.clientRequestId, DOMAIN, {
                  messageRef: proof.messageRef, producerEpoch: proof.registration.producer_epoch,
                  sequence: proof.registration.sequence, fencingGeneration: proof.fencingGeneration, instanceNonce: proof.instanceNonce,
                }, options);
                prepareEduPiAmbientMessageBinding({ sessionId: input.sessionId, messageId: metadata.captureMessageId,
                  messageRef: proof.messageRef, ownerId: config.ownerId, grantId: config.grantId,
                  captureGrantVersion: config.grantVersion, occurredAt: input.occurredAt }, options);
                return outbox;
              }
              return latest;
            });
            if (!outbox.bindings[0].captured && ["prepared", "registered"].includes(outbox.stage)) {
              await captureRecallPrompt(host, registrationInput, proof);
              outbox = await withRecallMutation(options, () => {
                const latest = readEduPiPromptOutbox(input.sessionId, input.clientRequestId, options);
                if (!latest) recallServerFail("recall_capture_unknown");
                if (!["prepared", "registered", "captured"].includes(latest.stage)) return latest;
                confirmEduPiAmbientMessageBinding(input.sessionId, metadata.captureMessageId, proof.messageRef, options);
                return recordEduPiPromptOutboxCapture(input.sessionId, input.clientRequestId, DOMAIN,
                  { captured: true, messageRef: proof.messageRef }, options);
              });
            }
          }
          if (["pi_dispatching", "pi_unknown", "pi_accepted"].includes(outbox.stage)) {
            return result("uncertain", "recall_persistence_unknown");
          }
          const captured = outbox.bindings[0];
          if (outbox.stage !== "captured" || !captured.registration || !captured.messageRef) {
            recallServerFail("recall_capture_unknown");
          }
          await markCapturedRecallIntent({ intentId: intent.intentId, messageRef: captured.messageRef,
            registration: captured.registration }, options, dependencies);
          // Recheck after capture. A stop race cannot become an ordinary chat.
          const current = readRecallIntent(selector, options, dependencies);
          if (!current.readyForDispatch) {
            await revokeRecallIntent(selector, options);
            return result("held", "recall_inactive");
          }
          await assertRecallGrantCurrent(host, rootRef, config, options);
          const claimed = await withRecallMutation(options, () => {
            const latest = readEduPiPromptOutbox(input.sessionId, input.clientRequestId, options);
            if (!readRecallIntent(selector, options, dependencies).readyForDispatch) return false;
            if (latest?.stage !== "captured") return false;
            markEduPiPromptOutboxPiDispatching(input.sessionId, input.clientRequestId, options);
            return true;
          });
          if (!claimed) return result("uncertain", "recall_dispatch_claimed");
          try {
            await dispatch(outbox, options);
            const file = await sessionPath(input.sessionId, options);
            if (!file || await inspect(outbox, file) !== "confirmed") throw new Error("persistence_unknown");
            await withRecallMutation(options, () => markEduPiPromptOutboxPiAccepted(input.sessionId, input.clientRequestId, options));
            return result("accepted");
          } catch {
            await withRecallMutation(options, () => markEduPiPromptOutboxPiUnknown(input.sessionId, input.clientRequestId, options));
            return result("uncertain", "recall_persistence_unknown");
          }
        } catch {
          const current = readRecallIntent(selector, options, dependencies);
          if (!current.usable) return result("held", "recall_inactive");
          return result("uncertain", "recall_capture_unknown");
        }
      });
    },
  };
}
