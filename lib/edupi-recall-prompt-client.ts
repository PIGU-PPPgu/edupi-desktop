import { desktopApiHeaders, fetchDesktopApi } from "./desktop-native";
import { isTauriDesktop } from "./desktop-updater";

export type RecallPromptInput = { sessionId: string; clientRequestId: string; message: string; occurredAt: string };
export type RecallPromptReply = {
  version: 1; status: "accepted" | "uncertain" | "held"; reasonCode: string | null; externalSend: false;
};
export type RecallPromptInspection = {
  version: 1; status: "accepted" | "uncertain" | "cancelled" | "unavailable" | "not_sent";
  reasonCode: string | null; externalSend: false;
};
export type RecallSettingsView = {
  version: 1; normalApproved: boolean;
  activation: { mode: "off" | "canary" | "normal"; enabled: boolean; reason: string };
  config: {
    enabled: boolean; scope: { classId: string; subject: string } | null;
    model: { provider: string; modelId: string } | null;
    limit: number | null; used: number | null; remaining: number | null;
    validUntil: string | null; updatedAt: string | null;
  };
  stop?: { status: "stopped" | "unknown"; grants: "paused" | "none" | "unknown" };
};
export type RecallSettingsInput = { enabled: false; expectedUpdatedAt: string | null } | {
  enabled: true; expectedUpdatedAt: string | null; scope: { classId: string; subject: string };
  model: { provider: string; modelId: string }; limit: number; validUntil: string;
};
export const RECALL_SETTINGS_CHANGED = "edupi-recall-settings-changed";
const object = (value: unknown): Record<string, unknown> | null =>
  value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : null;
const unavailable = (reasonCode = "recall_unavailable"): RecallPromptInspection =>
  ({ version: 1, status: "unavailable", reasonCode, externalSend: false });

async function readWithDeadline(url: string, init: RequestInit, timeout: number, signal?: AbortSignal) {
  const controller = new AbortController();
  const abort = () => controller.abort();
  signal?.addEventListener("abort", abort, { once: true });
  if (signal?.aborted) abort();
  let timer: ReturnType<typeof setTimeout> | undefined;
  const cancelled = new Promise<never>((_resolve, reject) => {
    controller.signal.addEventListener("abort", () => reject(new Error("recall_read_unavailable")), { once: true });
    if (controller.signal.aborted) reject(new Error("recall_read_unavailable"));
    timer = setTimeout(() => controller.abort(), timeout);
  });
  const operation = (async () => {
    const request = { ...init, cache: "no-store" as const, signal: controller.signal };
    // fetchDesktopApi accepts a path only. The read-only recovery endpoint has
    // encoded query parameters and needs the same native token on a normal GET.
    const response = url.includes("?")
      ? await fetch(url, { ...request, headers: await desktopApiHeaders(init.headers) })
      : await fetchDesktopApi(url, request);
    return { response, body: object(await response.json()) };
  })();
  try { return await Promise.race([operation, cancelled]); }
  finally { clearTimeout(timer); signal?.removeEventListener("abort", abort); }
}

export async function submitRecallPrompt(input: RecallPromptInput): Promise<RecallPromptReply> {
  if (!isTauriDesktop()) return { version: 1, status: "held", reasonCode: "recall_native_required", externalSend: false };
  // Deliberately pick the four public fields. Draft metadata and client approval
  // never enter an authorization request; there is no ordinary Pi fallback.
  const { sessionId, clientRequestId, message, occurredAt } = input;
  const { response, body } = await readWithDeadline("/api/edupi/recall/prompts", {
    method: "POST", headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ sessionId, clientRequestId, message, occurredAt }),
  }, 25_000);
  if (body?.version !== 1 || body.externalSend !== false || !["accepted", "uncertain", "held"].includes(String(body.status))
    || body.reasonCode !== null && typeof body.reasonCode !== "string"
    || body.status !== "held" && !response.ok) throw new Error("recall_persistence_unknown");
  return body as RecallPromptReply;
}

/** Lost-ACK recovery is GET only, including after a cold start or a stop. */
export async function inspectRecallPrompt(sessionId: string, clientRequestId: string, signal?: AbortSignal): Promise<RecallPromptInspection> {
  if (!isTauriDesktop()) return unavailable("recall_native_required");
  try {
    const query = new URLSearchParams({ sessionId, clientRequestId });
    const { response, body } = await readWithDeadline(`/api/edupi/recall/prompts?${query}`, { method: "GET" }, 6_000, signal);
    if (!response.ok || body?.version !== 1 || body.externalSend !== false
      || !["accepted", "uncertain", "cancelled", "unavailable", "not_sent"].includes(String(body.status))
      || body.reasonCode !== null && typeof body.reasonCode !== "string") return unavailable();
    return body as RecallPromptInspection;
  } catch { return unavailable(); }
}

export async function readRecallSettings(signal?: AbortSignal): Promise<RecallSettingsView> {
  if (!isTauriDesktop()) throw new Error("记忆核验仅在桌面端可用");
  const { response, body } = await readWithDeadline("/api/edupi/recall/settings", { method: "GET" }, 10_000, signal);
  const activation = object(body?.activation), config = object(body?.config);
  const scope = object(config?.scope), model = object(config?.model);
  if (!response.ok || body?.version !== 1 || typeof body.normalApproved !== "boolean"
    || !activation || typeof activation.enabled !== "boolean" || !["off", "canary", "normal"].includes(String(activation.mode))
    || typeof activation.reason !== "string" || !config || typeof config.enabled !== "boolean"
    || config.scope !== null && (!scope || typeof scope.classId !== "string" || !scope.classId
      || typeof scope.subject !== "string" || !scope.subject)
    || config.model !== null && (!model || typeof model.provider !== "string" || !model.provider
      || typeof model.modelId !== "string" || !model.modelId)
    || ![config.limit, config.used, config.remaining].every(value => value === null || Number.isSafeInteger(value) && Number(value) >= 0)
    || config.updatedAt !== null && typeof config.updatedAt !== "string"
    || config.validUntil !== null && typeof config.validUntil !== "string") throw new Error("记忆核验设置暂不可用");
  return body as RecallSettingsView;
}

export async function updateRecallSettings(input: RecallSettingsInput): Promise<RecallSettingsView> {
  if (!isTauriDesktop()) throw new Error("记忆核验仅在桌面端可用");
  const { response, body } = await readWithDeadline("/api/edupi/recall/settings", {
    method: "POST", cache: "no-store", headers: { "Content-Type": "application/json" }, body: JSON.stringify(input),
  }, 25_000);
  if (!response.ok) throw new Error(response.status === 409 ? "设置已变化，请刷新后重试" : response.status === 403 ? "记忆核验待验收" : "设置未保存");
  // Re-read authoritative public settings instead of trusting submitted state.
  const value = await readRecallSettings();
  const stop = object(body?.stop);
  if (stop && ["stopped", "unknown"].includes(String(stop.status)) && ["paused", "none", "unknown"].includes(String(stop.grants))) {
    value.stop = { status: stop.status as "stopped" | "unknown", grants: stop.grants as "paused" | "none" | "unknown" };
  }
  window.dispatchEvent(new Event(RECALL_SETTINGS_CHANGED));
  return value;
}

export function recallSendAvailable(value: RecallSettingsView | null): boolean {
  return Boolean(value?.normalApproved && value.activation.enabled && value.activation.mode === "normal"
    && value.config.enabled && value.config.scope?.classId && value.config.scope.subject
    && value.config.model?.provider && value.config.model.modelId
    && value.config.remaining !== null && value.config.remaining > 0
    && value.config.validUntil && Date.parse(value.config.validUntil) > Date.now());
}
