import { createHash, randomUUID } from "node:crypto";
import { realpathSync } from "node:fs";
import { resolve } from "node:path";
import { isDeepStrictEqual } from "node:util";
import type { SessionManager } from "@earendil-works/pi-coding-agent";
import { getRpcSession } from "./rpc-manager";
import { openSessionManagerForRead } from "./session-manager-access";
import { resolveSessionPath } from "./session-reader";
import { readEduPiPromptOutbox, type EduPiPromptOutboxBinding } from "./edupi-prompt-outbox";
import { resolveEduPiBridgeRoots, type EduPiBridgeRoots } from "./edupi-core-snapshot";
import { resolveEduPiDataRoot } from "./edupi-core-root";
import { ensureEduPiRuntime, type EduPiRuntimeHandle } from "./edupi-runtime-supervisor";
import { proactivityConversationId } from "./edupi-proactivity-control";
import { isSafeModeEnabled } from "./safe-mode";
import { CORE_RECALL_ANSWER_MESSAGE, parseCoreRecallAnswer, type CoreRecallAnswerDetails, type CoreRecallAnswerState, type CoreRecallPersonState } from "./edupi-recall-answer";
import { eduPiRecallRootEpoch, eduPiRecallRootLastChange, invalidateEduPiRecallSession, readIssuedEduPiRecall } from "./edupi-recall-state";
import { eduPiRecallConversationId, readEduPiRecallActivation } from "./edupi-recall-config";
import { readRecallIntent } from "./edupi-recall-authorization";

const hash = (value: string) => `sha256:${createHash("sha256").update(value).digest("hex")}`;
const canonical = (value: string) => { try { return realpathSync(value); } catch { return resolve(value); } };
const HASH = /^sha256:[a-f0-9]{64}$/u;
const ID = /^[A-Za-z0-9][A-Za-z0-9_.:@/+~=-]{0,159}$/u;
const object = (value: unknown): Record<string, unknown> | null =>
  value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : null;
const same = isDeepStrictEqual;
const messageText = (content: unknown): string | null => typeof content === "string" ? content
  : Array.isArray(content) && content.every(block => object(block)?.type === "text" && typeof block.text === "string")
    ? content.map(block => block.text).join("\n") : null;

export const eduPiRecallAnswersRequested = () => !isSafeModeEnabled() && readEduPiRecallActivation({
  dataRoot: process.env.EDUPI_DATA_ROOT || process.env.EDUPI_PROJECT_ROOT || "",
}).enabled;

export async function isEduPiRecallReady(): Promise<boolean> {
  if (!eduPiRecallAnswersRequested()) return false;
  try {
    return (await ensureEduPiRuntime(resolveEduPiBridgeRoots())).recallAnswersActive === true;
  }
  catch { return false; }
}
type CapturedMessage = { manager: SessionManager; root: string; sessionId: string; entryId: string; clientRequestId: string;
  text: string; binding: EduPiPromptOutboxBinding; captureKey: string; conversationId?: string };

function assertCurrentDataRoot(roots: EduPiBridgeRoots): void {
  if (canonical(resolveEduPiDataRoot().root) !== canonical(roots.dataRoot.root)) throw new Error("root_changed");
}

/** Resolve the actual SDK user entry and its host-owned durable dispatch. */
export async function readCapturedRecallMessage(sessionId: string, entryId: string, verifiedRoots?: EduPiBridgeRoots): Promise<CapturedMessage> {
  if (!ID.test(sessionId) || !ID.test(entryId)) throw new Error("message_unavailable");
  const roots = verifiedRoots ?? resolveEduPiBridgeRoots(), root = canonical(roots.dataRoot.root);
  assertCurrentDataRoot(roots);
  const live = getRpcSession(sessionId);
  const file = live?.sessionFile ?? await resolveSessionPath(sessionId);
  const manager = live?.isAlive() ? live.inner.sessionManager : file ? openSessionManagerForRead(sessionId, file) : null;
  if (!manager || manager.getSessionId() !== sessionId || canonical(manager.getCwd()) !== root) throw new Error("message_unavailable");
  const branch = manager.getBranch(), index = branch.findIndex(entry => entry.id === entryId);
  const entry = branch[index];
  if (!entry || entry.type !== "message" || entry.message.role !== "user"
    || branch.some(row => row.type === "context_edit" && row.targetId === entryId)) throw new Error("message_unavailable");
  const text = messageText(entry.message.content);
  const prior = branch.slice(0, index).findLast(row => row.type === "message" && row.message.role === "user"
    || row.type === "custom" && row.customType === "edupi_prompt_dispatch_v1");
  const marker = prior?.type === "custom" ? object(prior.data) : null;
  if (!text || prior?.type !== "custom" || prior.customType !== "edupi_prompt_dispatch_v1"
    || marker?.sessionId !== sessionId || typeof marker.clientRequestId !== "string") throw new Error("message_unavailable");
  const outbox = readEduPiPromptOutbox(sessionId, marker.clientRequestId, { dataRoot: root });
  if (!outbox || !["pi_dispatching", "pi_accepted"].includes(outbox.stage) || outbox.cancellationProofs !== null
    || outbox.command.message !== text || outbox.sessionId !== sessionId
    || marker.commandHash !== hash(JSON.stringify(outbox.command)) || !outbox.bindings.length
    || outbox.bindings.some(binding => !binding.captured || !binding.registration || !binding.messageRef)) throw new Error("message_unavailable");
  const binding = outbox.bindings.find(item => item.domain === "teaching_preparation") ?? outbox.bindings[0];
  const r04 = /^r04_recall_[a-f0-9]+$/u.test(binding.grantId)
    ? readRecallIntent({ sessionId, clientRequestId: marker.clientRequestId }, { dataRoot: root }) : null;
  if (r04 && (!r04.usable || !r04.readyForDispatch || r04.intent?.rawQuery !== text
    || r04.intent.binding.ownerId !== binding.ownerId || r04.intent.binding.grantId !== binding.grantId
    || r04.intent.binding.grantVersion !== binding.grantVersion || r04.intent.messageRef !== binding.messageRef)) {
    throw new Error("message_unavailable");
  }
  const conversationId = r04?.intent ? eduPiRecallConversationId(r04.intent.binding.scope, { dataRoot: root })
    : proactivityConversationId(binding.domain);
  const captureKey = hash(JSON.stringify([root, sessionId, entryId, marker.clientRequestId, text, outbox.bindings,
    r04?.intent?.intentId ?? null, r04?.intent?.configUpdatedAt ?? null]));
  return { manager, root, sessionId, entryId, clientRequestId: marker.clientRequestId, text, binding, captureKey, conversationId };
}

async function runtimeFor(message: CapturedMessage, verifiedRoots?: EduPiBridgeRoots) {
  const roots = verifiedRoots ?? resolveEduPiBridgeRoots();
  assertCurrentDataRoot(roots);
  if (canonical(roots.dataRoot.root) !== message.root) throw new Error("root_changed");
  const host = await ensureEduPiRuntime(roots), health = await host.call("health", null);
  const rootRef = object(health.result)?.data_root_fingerprint;
  if (host.recallAnswersActive !== true || health.ok !== true || typeof rootRef !== "string" || !HASH.test(rootRef)) throw new Error("runtime_unavailable");
  return { host, rootRef };
}

type Dependencies = {
  enabled?: () => boolean;
  load?: typeof readCapturedRecallMessage;
  runtime?: (message: CapturedMessage) => Promise<{ host: Pick<EduPiRuntimeHandle, "callOwnerControl">; rootRef: string }>;
};
type PersonPreview = { message: CapturedMessage; personName: string; sourceFingerprint: string; personId: string;
  personRevision: number; epoch: number; expiresAt: number };

function publishedMessageCurrent(message: CapturedMessage, details: CoreRecallAnswerDetails): boolean {
  const branch = message.manager.getBranch();
  const latest = branch.findLast(row => row.type === "message" && row.message.role === "user");
  const saved = branch.filter(row => row.type === "custom_message" && row.customType === CORE_RECALL_ANSWER_MESSAGE
    && object(row.details)?.receiptId === details.receiptId);
  const entry = saved[0];
  return latest?.id === message.entryId && message.entryId === details.userEntryId
    && message.clientRequestId === details.clientRequestId && hash(message.text) === details.originalTextHash
    && saved.length === 1 && entry.type === "custom_message" && entry.display === true && same(entry.details, details)
    && entry.content === details.answer?.text
    && !branch.some(row => row.type === "context_edit" && row.targetId === entry.id);
}

export function createEduPiRecallService(dependencies: Dependencies = {}) {
  const enabled = dependencies.enabled ?? eduPiRecallAnswersRequested;
  const requestContext = () => {
    // One complete root/pin/file verification per request. SDK entries, outbox,
    // intent, data-root selection and Core authority are still read after awaits.
    let roots: EduPiBridgeRoots | undefined;
    const verifiedRoots = () => roots ??= resolveEduPiBridgeRoots();
    return {
      load: dependencies.load ?? ((sessionId: string, entryId: string) => readCapturedRecallMessage(sessionId, entryId, verifiedRoots())),
      runtime: dependencies.runtime ?? ((message: CapturedMessage) => runtimeFor(message, verifiedRoots())),
    };
  };
  const previews = new Map<string, PersonPreview>(), confirming = new Set<string>();
  const personHeld = (name: string, reasonCode: string, factWrite: boolean | null = false): CoreRecallPersonState => ({
    version: 1, status: "held", reasonCode, personName: name, previewId: null, personId: null,
    personRevision: null, sourceFingerprint: null, factWrite,
  });
  const personResult = (value: unknown, messageRef: string, confirmation: boolean) => {
    const envelope = object(value), result = object(envelope?.result);
    if (envelope?.ok !== true || !result || result.version !== 1 || result.message_ref !== messageRef
      || result.model_execute !== false || result.live_authority !== false || result.external_send !== false
      || typeof result.fact_write !== "boolean" || !confirmation && result.fact_write !== false
      || !["held", ...(confirmation ? ["confirmed", "replayed"] : ["current"])].includes(String(result.status))) throw new Error("person_unavailable");
    if (result.status === "held") return result;
    if (typeof result.source_fingerprint !== "string" || !HASH.test(result.source_fingerprint)
      || typeof result.person_id !== "string" || !ID.test(result.person_id)
      || !Number.isSafeInteger(result.person_revision) || Number(result.person_revision) < 0
      || confirmation && (typeof result.fact_id !== "string" || !ID.test(result.fact_id)
        || !Number.isSafeInteger(result.fact_revision) || Number(result.fact_revision) < 1)) throw new Error("person_unavailable");
    return result;
  };

  return {
    enabled,
    async answerState(input: { sessionId: string; userEntryId: string; receiptId: string }): Promise<CoreRecallAnswerState> {
      const historical: CoreRecallAnswerState = { version: 1, status: "historical", reasonCode: null };
      if (!enabled()) return historical;
      const issued = readIssuedEduPiRecall(input.receiptId);
      if (!issued) return historical; // A cold restart cannot renew a receipt.
      if (issued.invalidated || issued.epoch !== eduPiRecallRootEpoch(issued.root)) {
        return { version: 1, status: "held", reasonCode: issued.invalidated ?? "source_changed" };
      }
      if (issued.details.sessionId !== input.sessionId || issued.details.userEntryId !== input.userEntryId) {
        return { version: 1, status: "held", reasonCode: "message_changed" };
      }
      if (!issued.details.answer) {
        return { version: 1, status: "held", reasonCode: issued.details.reasonCode };
      }
      if (Date.parse(issued.details.answer.valid_until) <= Date.now()) {
        invalidateEduPiRecallSession(input.sessionId, "answer_expired");
        return { version: 1, status: "held", reasonCode: "answer_expired" };
      }
      try {
        const { load, runtime } = requestContext();
        if (!issued.request || typeof issued.request.query !== "string"
          || Object.hasOwn(issued.request, "answer_receipt_ref")) throw new Error("full_proof_unavailable");
        const message = await load(input.sessionId, input.userEntryId);
        if (message.root !== issued.root || !publishedMessageCurrent(message, issued.details)) throw new Error("message_changed");
        const { host, rootRef } = await runtime(message);
        const identity = { root_ref: rootRef, message_ref: message.binding.messageRef,
          conversation_id: message.conversationId ?? proactivityConversationId(message.binding.domain), message_id: message.binding.captureMessageId,
          original_text_hash: hash(message.text) };
        const registration = message.binding.registration!;
        if (Object.entries({ ...identity, expected_owner_id: message.binding.ownerId, query: message.text }).some(([key, value]) =>
          issued.request![key] !== value) || !same(issued.request.registration, {
          carrier_id: message.binding.carrierId, plan_id: message.binding.planId,
          producer_epoch: registration.producerEpoch, sequence: registration.sequence,
        })) throw new Error("message_changed");
        // The opaque runtime receipt rechecks the complete original query and
        // selection in Core, including canonical goals and time-only expiry.
        // The legacy no-query memory list is never an answer proof.
        const checked = await host.callOwnerControl("owner_memory_recall", {
          ...issued.request, answer_receipt_ref: issued.details.answer.receipt_ref,
        });
        const result = object(checked.result);
        const entries = result?.entries;
        const latestMessage = await load(input.sessionId, input.userEntryId);
        const matches = {
          envelope: checked.ok === true && result?.version === 1 && result.status === "current"
            && result.reason_code === null && result.model_execute === false && result.external_send === false,
          term: result?.term_ref === issued.termRef,
          identity: Object.entries(identity).every(([key, value]) => result?.[key] === value),
          entries: Array.isArray(entries) && entries.length <= 50
            && new Set(entries.map(entry => object(entry)?.id)).size === entries.length
            && issued.details.sources.every(source => entries.filter((entry: unknown) => {
              const item = object(entry);
              return item?.id === source.id && item.source_fingerprint === source.source_fingerprint && item.content === source.content;
            }).length === 1) && entries.length === issued.details.sources.length,
          parseanswer: same(parseCoreRecallAnswer(result?.answer, issued.details.sources), issued.details.answer),
          expiry: Date.parse(issued.details.answer.valid_until) > Date.now(),
          epoch: !issued.invalidated && issued.epoch === eduPiRecallRootEpoch(message.root),
          capture: latestMessage.captureKey === message.captureKey,
          published: publishedMessageCurrent(latestMessage, issued.details),
          enabled: enabled(),
        };
        if (!Object.values(matches).every(Boolean)) throw new Error("source_changed");
        return { version: 1, status: "current", reasonCode: null };
      } catch {
        invalidateEduPiRecallSession(input.sessionId, "source_changed");
        return { version: 1, status: "held", reasonCode: "source_changed" };
      }
    },

    async person(input: { action: "read" | "confirm"; sessionId: string; entryId: string; personName: string; previewId?: string }): Promise<CoreRecallPersonState> {
      const name = input.personName;
      if (!enabled() || !name || name.trim() !== name || name.length > 160 || /[\u0000-\u001f]/u.test(name)) return personHeld(name, "person_unavailable");
      let confirmationStarted = false;
      try {
        const { load, runtime } = requestContext();
        const message = await load(input.sessionId, input.entryId);
        if (!message.text.includes(name)) return personHeld(name, "person_not_in_message");
        const { host, rootRef } = await runtime(message);
        const payload = { root_ref: rootRef, expected_owner_id: message.binding.ownerId,
          message_ref: message.binding.messageRef!, person_name: name };
        if (input.action === "read") {
          const epoch = eduPiRecallRootEpoch(message.root);
          const result = personResult(await host.callOwnerControl("owner_recall_person_read", payload), payload.message_ref, false);
          const latest = await load(input.sessionId, input.entryId);
          if (result.status !== "current" || epoch !== eduPiRecallRootEpoch(message.root)
            || latest.captureKey !== message.captureKey) return personHeld(name, "source_changed");
          const previewId = randomUUID();
          previews.set(previewId, { message, personName: name, sourceFingerprint: result.source_fingerprint as string,
            personId: result.person_id as string, personRevision: Number(result.person_revision), epoch,
            expiresAt: Date.now() + 5 * 60_000 });
          while (previews.size > 100) previews.delete(previews.keys().next().value!);
          return { version: 1, status: "current", reasonCode: null, personName: name, previewId,
            personId: result.person_id as string, personRevision: Number(result.person_revision),
            sourceFingerprint: result.source_fingerprint as string, factWrite: false };
        }
        const preview = input.previewId ? previews.get(input.previewId) : null;
        if (!preview || confirming.has(input.previewId!) || preview.expiresAt < Date.now() || preview.personName !== name
          || preview.message.captureKey !== message.captureKey || preview.epoch !== eduPiRecallRootEpoch(message.root)) return personHeld(name, "preview_changed");
        confirming.add(input.previewId!);
        const commandId = `recall-person-${hash(JSON.stringify([message.root, message.binding.ownerId,
          message.binding.messageRef, name, preview.sourceFingerprint, preview.personRevision])).slice(7)}`;
        const beforeEpoch = eduPiRecallRootEpoch(message.root);
        const confirmationEpochCurrent = () => {
          const epoch = eduPiRecallRootEpoch(message.root), changed = eduPiRecallRootLastChange(message.root);
          return epoch === beforeEpoch || epoch === beforeEpoch + 1 && changed?.epoch === epoch
            && changed.operation === "owner_recall_person_confirm";
        };
        try {
          confirmationStarted = true;
          const confirmed = personResult(await host.callOwnerControl("owner_recall_person_confirm", {
            ...payload, command_id: commandId, expected_source_fingerprint: preview.sourceFingerprint,
            expected_person_revision: preview.personRevision,
          }), payload.message_ref, true);
          if (confirmed.status === "held") return personHeld(name, "source_changed", confirmed.fact_write as boolean);
          if (!confirmationEpochCurrent()) return personHeld(name, "source_changed", confirmed.fact_write as boolean);
          const reread = personResult(await host.callOwnerControl("owner_recall_person_read", payload), payload.message_ref, false);
          const latest = await load(input.sessionId, input.entryId);
          if (reread.status !== "current" || reread.source_fingerprint !== confirmed.source_fingerprint
            || reread.person_id !== confirmed.person_id || reread.person_revision !== confirmed.person_revision
            || !confirmationEpochCurrent()
            || latest.captureKey !== message.captureKey) {
            return personHeld(name, "source_changed", confirmed.fact_write as boolean);
          }
          return { version: 1, status: confirmed.status as "confirmed" | "replayed", reasonCode: null, personName: name,
            previewId: null, personId: reread.person_id as string, personRevision: Number(reread.person_revision),
            sourceFingerprint: reread.source_fingerprint as string, factWrite: confirmed.fact_write as boolean };
        } finally {
          confirming.delete(input.previewId!);
          previews.delete(input.previewId!);
        }
      } catch {
        return personHeld(name, confirmationStarted ? "confirmation_unknown" : "person_unavailable", confirmationStarted ? null : false);
      }
    },
  };
}

export const eduPiRecallService = createEduPiRecallService();
