import { AsyncLocalStorage } from "node:async_hooks";
import { createHash } from "node:crypto";
import { realpathSync } from "node:fs";
import { resolve } from "node:path";
import { defineTool, SessionManager, type ExtensionFactory } from "@earendil-works/pi-coding-agent";
import { Type, type Static } from "typebox";
import { readEduPiPromptOutbox, type EduPiPromptOutboxEntry } from "./edupi-prompt-outbox";
import { resolveEduPiBridgeRoots } from "./edupi-core-snapshot";
import { ensureEduPiRuntime } from "./edupi-runtime-supervisor";
import { proactivityConversationId } from "./edupi-proactivity-control";
import { isSafeModeEnabled } from "./safe-mode";

const hash = (text: string) => `sha256:${createHash("sha256").update(text).digest("hex")}`;
const canonical = (directory: string) => { try { return realpathSync(directory); } catch { return resolve(directory); } };
const categories = ["semester", "class", "teaching", "preferences", "school"] as const;
const parameters = Type.Object({
  category: Type.Optional(Type.Union([...categories.map(value => Type.Literal(value)), Type.Literal("all")])),
  query: Type.Optional(Type.String({ minLength: 2, maxLength: 512 })),
  student: Type.Optional(Type.String({ minLength: 1, maxLength: 160 })),
  student_id: Type.Optional(Type.String({ minLength: 1, maxLength: 160 })),
  limit: Type.Optional(Type.Integer({ minimum: 1, maximum: 50 })),
}, { additionalProperties: false });
type RecallParameters = Static<typeof parameters>;
type Entry = { id: string; category: typeof categories[number]; content: string; source_fingerprint: string;
  student_id: string | null; student: string | null; managed_method: boolean };
type Recall = { status: "current" | "held"; reason_code: string | null; entries: Entry[] };
type Turn = { manager: SessionManager; sessionId: string; clientRequestId: string; text: string; active: boolean };
type Dependencies = {
  disabled?: () => boolean;
  readOutbox?: typeof readEduPiPromptOutbox;
  core?: () => Promise<{ rootRef: string; call: (request: Record<string, unknown>, signal?: AbortSignal) => Promise<unknown> }>;
};

function response(value: unknown, identity: Record<string, unknown>): Recall {
  const envelope = value as { ok?: unknown; result?: Record<string, unknown> } | null;
  const result = envelope?.ok === true ? envelope.result : null;
  if (!result || result.version !== 1 || !["current", "held"].includes(String(result.status))
    || result.external_send !== false || result.model_execute !== false
    || Object.keys(identity).some(key => result[key] !== identity[key])
    || !Array.isArray(result.entries) || result.entries.length > 50 || JSON.stringify(result).length > 70000) {
    return { status: "held", reason_code: "recall_unavailable", entries: [] };
  }
  const valid = result.entries.every((entry: Entry) => entry && typeof entry.id === "string"
    && categories.includes(entry.category) && typeof entry.content === "string" && entry.content.length <= 12000
    && /^sha256:[a-f0-9]{64}$/u.test(entry.source_fingerprint)
    && (entry.student_id === null || typeof entry.student_id === "string")
    && (entry.student === null || typeof entry.student === "string") && typeof entry.managed_method === "boolean");
  if (!valid || new Set(result.entries.map((entry: Entry) => entry.id)).size !== result.entries.length) {
    return { status: "held", reason_code: "recall_unavailable", entries: [] };
  }
  return { status: result.status as Recall["status"], reason_code: typeof result.reason_code === "string" ? result.reason_code : null,
    entries: result.status === "current" ? result.entries as Entry[] : [] };
}

/** The private turn capability is never stored in a session, command, tool parameter, or extension context. */
export function createEduPiMemoryRecallAccess(dataRoot: string, dependencies: Dependencies = {}) {
  const root = canonical(dataRoot);
  const turns = new AsyncLocalStorage<Turn | null>();
  const activeTurns = new WeakMap<SessionManager, Turn>();
  const disabled = () => isSafeModeEnabled() || dependencies.disabled?.() === true;
  const denied = (reason_code = "scope_unverified"): Recall => ({ status: "held", reason_code, entries: [] });
  const readOutbox = dependencies.readOutbox ?? readEduPiPromptOutbox;
  function invalidate(manager: unknown): void {
    if (!(manager instanceof SessionManager)) return;
    const turn = activeTurns.get(manager);
    if (turn) turn.active = false;
    activeTurns.delete(manager);
  }
  const core = dependencies.core ?? (async () => {
    const roots = resolveEduPiBridgeRoots();
    if (canonical(roots.dataRoot.root) !== root) throw new Error("recall_root_changed");
    const host = await ensureEduPiRuntime(roots);
    const health = await host.call("health", null);
    const rootRef = (health.result as { data_root_fingerprint?: unknown } | undefined)?.data_root_fingerprint;
    if (health.ok !== true || typeof rootRef !== "string" || !/^sha256:[a-f0-9]{64}$/u.test(rootRef)) throw new Error("recall_unavailable");
    return { rootRef, call: (request: Record<string, unknown>, signal?: AbortSignal) => host.callOwnerControl("owner_memory_recall", request, signal) };
  });

  function current(turn: Turn, manager: unknown): EduPiPromptOutboxEntry | null {
    if (!turn.active || activeTurns.get(turn.manager) !== turn || disabled() || manager !== turn.manager || !(manager instanceof SessionManager)
      || manager.getSessionId() !== turn.sessionId || canonical(manager.getCwd()) !== root) return null;
    const branch = manager.getBranch();
    const latestUserIndex = branch.findLastIndex(entry => entry.type === "message" && entry.message.role === "user");
    const latest = branch[latestUserIndex];
    if (!latest || latest.type !== "message" || latest.message.role !== "user") return null;
    const content = latest.message.content;
    const text = typeof content === "string" ? content : content.filter(block => block.type === "text").map(block => block.text).join("\n");
    if (text !== turn.text) return null;
    const prior = branch.slice(0, latestUserIndex).findLast(entry => entry.type === "message" && entry.message.role === "user"
      || entry.type === "custom" && entry.customType === "edupi_prompt_dispatch_v1");
    if (prior?.type !== "custom" || prior.customType !== "edupi_prompt_dispatch_v1"
      || (prior.data as { clientRequestId?: unknown } | undefined)?.clientRequestId !== turn.clientRequestId) return null;
    const outbox = readOutbox(turn.sessionId, turn.clientRequestId, { dataRoot: root });
    if (!outbox || !["pi_dispatching", "pi_accepted"].includes(outbox.stage)
      || outbox.sessionId !== turn.sessionId || outbox.command.message !== turn.text
      || (prior.data as { commandHash?: unknown }).commandHash !== hash(JSON.stringify(outbox.command))
      || outbox.command.clientRequestId !== turn.clientRequestId || outbox.cancellationProofs !== null
      || !outbox.bindings.length || outbox.bindings.some(binding => !binding.captured || !binding.registration || !binding.messageRef)) return null;
    return outbox;
  }

  async function recall(manager: unknown, params: RecallParameters = {}, signal?: AbortSignal, memoryIds?: string[]): Promise<Recall> {
    const turn = turns.getStore();
    if (!turn) return denied();
    try {
      const outbox = current(turn, manager);
      if (!outbox) return denied();
      const host = await core();
      if (!current(turn, manager)) return denied();
      // An ambiguous multi-domain capture must not combine different class scopes.
      const binding = outbox.bindings.find(item => item.domain === "teaching_preparation") ?? outbox.bindings[0];
      const identity = { root_ref: host.rootRef, message_ref: binding.messageRef!,
        conversation_id: proactivityConversationId(binding.domain), message_id: binding.captureMessageId,
        original_text_hash: hash(turn.text.trim()) };
      const value = await host.call({ ...identity, expected_owner_id: binding.ownerId,
        registration: { carrier_id: binding.carrierId, plan_id: binding.planId,
          producer_epoch: binding.registration!.producerEpoch, sequence: binding.registration!.sequence },
        ...(params.category && params.category !== "all" ? { category: params.category } : {}),
        ...(params.query ? { query: params.query } : {}), ...(params.student ? { student: params.student } : {}),
        ...(params.student_id ? { student_id: params.student_id } : {}), ...(memoryIds?.length ? { memory_ids: memoryIds } : {}),
        limit: params.limit ?? 30 }, signal);
      if (!current(turn, manager)) return denied();
      return response(value, identity);
    } catch { return denied("recall_unavailable"); }
  }

  const tool = defineTool({ name: "memory_recall", label: "检索记忆", parameters, executionMode: "sequential",
      description: "检索当前已授权班级和学期的已审核记忆。学生同名时使用学生ID。",
      promptSnippet: "memory_recall: 检索当前会话可用的长期记忆",
      async execute(_id, params, signal, _update, ctx) {
        const result = await recall(ctx.sessionManager, params, signal);
        return { content: [{ type: "text", text: result.entries.length
          ? result.entries.map(entry => `${entry.student ? `${entry.student}：` : ""}${entry.content}`).join("\n")
          : result.status === "held" ? "当前会话未绑定可用记忆范围。" : "没有找到当前范围的相关记忆。" }], details: result };
      },
  });
  const extension: ExtensionFactory = pi => {
    pi.on("context", async (event, ctx) => {
      let result = await recall(ctx.sessionManager, { limit: 50 });
      // Revalidate recent returned IDs per category, before Core applies its
      // result cap. A category/query result can lie beyond the general summary.
      const history = new Map<string, Entry["category"]>();
      for (const message of [...event.messages].reverse()) {
        if (message.role !== "toolResult" || message.toolName !== "memory_recall") continue;
        const previous = message.details as { entries?: Entry[] } | undefined;
        if (!Array.isArray(previous?.entries)) continue;
        for (const entry of previous.entries) {
          if (history.size >= 50) break;
          if (entry && typeof entry.id === "string" && entry.id.length <= 160 && categories.includes(entry.category)) history.set(entry.id, entry.category);
        }
      }
      if (history.size) {
        const ids = [...new Set([...history.keys(), ...result.entries.map(entry => entry.id)])].slice(0, 50);
        // Discard earlier bodies after awaiting the authoritative batch. A
        // revoked grant or changed source cannot survive as cached context.
        result = await recall(ctx.sessionManager, { limit: 50 }, undefined, ids);
      }
      const entries = result.entries;
      const provedEntries = new Map(entries.map(entry => [entry.id, entry]));
      const messages = event.messages.map(message => {
        if (message.role !== "toolResult" || !["memory_recall", "memory_write", "memory_forget", "student_note"].includes(message.toolName)) return message;
        const previous = message.details as { entries?: Entry[] } | undefined;
        const proved = message.toolName === "memory_recall" && Array.isArray(previous?.entries)
          ? previous.entries.flatMap(old => {
            const current = old && typeof old === "object" ? provedEntries.get(old.id) : undefined;
            return current && current.source_fingerprint === old?.source_fingerprint ? [current] : [];
          }) : [];
        return { ...message, content: [{ type: "text" as const, text: proved.length ? proved.map(entry => entry.content).join("\n") : "历史记忆结果已失效。" }], details: { entries: proved } };
      });
      const automatic = entries.filter(entry => ["preferences", "semester", "class"].includes(entry.category)
        || entry.category === "teaching" && entry.managed_method).slice(0, 12);
      if (!automatic.length) return { messages };
      return { messages: [{ role: "user", content: [{ type: "text", text: `[EduPi 长期记忆]\n${automatic.map(entry => entry.content).join("\n")}\n[历史记忆供参考]` }], timestamp: Date.now() }, ...messages] };
    });
  };

  return { extension, tool, recall, invalidate,
    async run<T>(manager: SessionManager, command: { message: string; clientRequestId?: string },
      captured: boolean, callback: () => Promise<T>): Promise<T> {
      invalidate(manager);
      if (!captured || !command.clientRequestId || disabled() || !(manager instanceof SessionManager)
        || canonical(manager.getCwd()) !== root) return turns.run(null, callback);
      const turn = { manager, sessionId: manager.getSessionId(), clientRequestId: command.clientRequestId, text: command.message, active: true };
      activeTurns.set(manager, turn);
      try { return await turns.run(turn, callback); } finally {
        turn.active = false;
        if (activeTurns.get(manager) === turn) activeTurns.delete(manager);
      }
    },
  };
}

export type EduPiMemoryRecallAccess = ReturnType<typeof createEduPiMemoryRecallAccess>;
