import { fetchDesktopApi } from "./desktop-native";
import {
  CORE_RECALL_ANSWER_MESSAGE,
  parseCoreRecallAnswerDetails,
  type CoreRecallAnswerDetails,
  type CoreRecallAnswerState,
  type CoreRecallPersonState,
} from "./edupi-recall-answer";
import type { AgentMessage } from "./types";

export const CORE_RECALL_INVALIDATED_EVENT = "edupi-core-recall-invalidated";
const ANSWER_STATE_URL = "/api/edupi/recall/answer-state";
const PERSON_URL = "/api/edupi/recall/person";

export function coreRecallAnswerDetails(message: AgentMessage): CoreRecallAnswerDetails | null {
  if (message.role !== "custom" || message.customType !== CORE_RECALL_ANSWER_MESSAGE) return null;
  const details = parseCoreRecallAnswerDetails(message.details);
  return details && message.content === (details.answer?.text ?? "当前资料尚不能核验这个问题。") ? details : null;
}

type AnswerIdentity = { sessionId: string; userEntryId: string; receiptId: string };
type PersonIdentity = { sessionId: string; entryId: string; personName: string };
type PersonRequest = PersonIdentity & ({ action: "read" } | { action: "confirm"; previewId: string });

export interface CoreRecallClient {
  enabled(signal: AbortSignal): Promise<boolean>;
  answerState(identity: AnswerIdentity, signal: AbortSignal): Promise<CoreRecallAnswerState>;
  person(request: PersonRequest, signal: AbortSignal): Promise<CoreRecallPersonState>;
}

function object(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : {};
}

function reason(value: unknown): value is string | null {
  return value === null || typeof value === "string";
}

export function parseCoreRecallAnswerState(value: unknown): CoreRecallAnswerState {
  const state = object(value);
  if (state.version !== 1 || !["current", "held", "historical"].includes(String(state.status)) || !reason(state.reasonCode)) {
    throw new Error("核验结果不可用");
  }
  return state as CoreRecallAnswerState;
}

export function parseCoreRecallPersonState(value: unknown): CoreRecallPersonState {
  const state = object(value);
  if (state.version !== 1 || !["current", "confirmed", "replayed", "held"].includes(String(state.status))
    || typeof state.personName !== "string" || !reason(state.reasonCode) || !reason(state.previewId)
    || !reason(state.personId) || !reason(state.sourceFingerprint) || state.factWrite !== null && typeof state.factWrite !== "boolean"
    || state.factWrite === null && (state.status !== "held" || state.reasonCode !== "confirmation_unknown")
    || state.personRevision !== null && (!Number.isSafeInteger(state.personRevision) || Number(state.personRevision) < 0)) {
    throw new Error("人物核对结果不可用");
  }
  return state as CoreRecallPersonState;
}

/** Tests may inject a synthetic transport without changing native authorization. */
export function createCoreRecallClient(
  write: typeof fetchDesktopApi = fetchDesktopApi,
  read: typeof fetch = (...args) => fetch(...args),
): CoreRecallClient {
  async function post(url: string, body: AnswerIdentity | PersonRequest, signal: AbortSignal): Promise<unknown> {
    const response = await write(url, {
      method: "POST", cache: "no-store", signal,
      headers: { "Content-Type": "application/json" }, body: JSON.stringify(body),
    });
    // Conflict responses can carry a held state, including a completed fact write.
    const value: unknown = await response.json();
    if (!response.ok && (object(value).version !== 1 || !["held", "historical"].includes(String(object(value).status)))) {
      throw new Error("核对请求未完成，请重试");
    }
    return value;
  }
  return {
    async enabled(signal) {
      const response = await read(ANSWER_STATE_URL, { cache: "no-store", signal });
      if (response.status >= 500) throw new Error("Core 核验暂不可用");
      if (!response.ok) return false;
      const state = object(await response.json());
      return state.version === 1 && state.enabled === true;
    },
    async answerState(identity, signal) {
      return parseCoreRecallAnswerState(await post(ANSWER_STATE_URL, identity, signal));
    },
    async person(request, signal) {
      return parseCoreRecallPersonState(await post(PERSON_URL, request, signal));
    },
  };
}

export const coreRecallClient = createCoreRecallClient();

export function recallViewIsActive(): boolean {
  return typeof document === "undefined"
    || document.visibilityState !== "hidden" && (typeof document.hasFocus !== "function" || document.hasFocus());
}

/** A source or view change only revokes authority; focus never restores it. */
export function subscribeCoreRecallInvalidation(invalidate: () => void): () => void {
  const sourceEvents = [CORE_RECALL_INVALIDATED_EVENT, "edupi-facts-updated", "edupi-student-records-updated",
    "edupi-education-refresh", "edupi-artifacts-updated"];
  const onSource = (event: Event) => {
    // Settling any conversation refreshes file panels without asserting a write.
    // Actual artifact mutations keep the normal invalidation event.
    if (event.type === "edupi-artifacts-updated" && (event as CustomEvent<{ refreshOnly?: boolean }>).detail?.refreshOnly === true) return;
    invalidate();
  };
  const onHidden = () => { if (!recallViewIsActive()) invalidate(); };
  sourceEvents.forEach(name => window.addEventListener(name, onSource));
  window.addEventListener("blur", invalidate);
  window.addEventListener("pagehide", invalidate);
  document.addEventListener("visibilitychange", onHidden);
  return () => {
    sourceEvents.forEach(name => window.removeEventListener(name, onSource));
    window.removeEventListener("blur", invalidate);
    window.removeEventListener("pagehide", invalidate);
    document.removeEventListener("visibilitychange", onHidden);
  };
}
