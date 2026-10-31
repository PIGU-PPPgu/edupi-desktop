import { AsyncLocalStorage } from "node:async_hooks";
import { createHash, randomUUID } from "node:crypto";
import { realpathSync } from "node:fs";
import { resolve } from "node:path";
import { defineTool, SessionManager, type ExtensionFactory } from "@earendil-works/pi-coding-agent";
import { Type, type Static } from "typebox";
import { readEduPiPromptOutbox, type EduPiPromptOutboxEntry } from "./edupi-prompt-outbox";
import { resolveEduPiBridgeRoots } from "./edupi-core-snapshot";
import { ensureEduPiRuntime } from "./edupi-runtime-supervisor";
import { proactivityConversationId } from "./edupi-proactivity-control";
import { isSafeModeEnabled } from "./safe-mode";
import { createMemorySummaryGuard, memoryHistoryIds, projectMemoryHistory } from "./edupi-memory-summary";

const hash = (text: string) => `sha256:${createHash("sha256").update(text).digest("hex")}`;
const canonical = (directory: string) => { try { return realpathSync(directory); } catch { return resolve(directory); } };
const categories = ["semester", "class", "teaching", "preferences", "school"] as const;
const entryFields = "category,content,id,managed_method,source_fingerprint,student,student_id";
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
type SourceProof = { status: "verified" | "held"; case_status: "bound" | "held"; reason_code: string | null };
type Recall = { status: "current" | "held"; reason_code: string | null; entries: Entry[]; source_proof?: SourceProof };
type Turn = { manager: SessionManager; sessionId: string; clientRequestId: string; text: string; active: boolean; captured: boolean;
  sourceNonce: string; startingLeafId: string | null; startingUserId: string | null; boundUserId: string | null; boundUserHash: string | null };
type Dependencies = {
  disabled?: () => boolean;
  readOutbox?: typeof readEduPiPromptOutbox;
  core?: () => Promise<{ rootRef: string; call: (request: Record<string, unknown>, signal?: AbortSignal) => Promise<unknown>;
    proofCall?: (request: Record<string, unknown>, signal?: AbortSignal) => Promise<unknown> }>;
};

function sourceProof(value: unknown, fingerprint: string): SourceProof {
  const envelope = value as { ok?: unknown; result?: Record<string, unknown> } | null;
  const result = envelope?.ok === true ? envelope.result : null;
  const unavailable = { status: "held" as const, case_status: "held" as const, reason_code: "proof_unavailable" };
  if (!result || Object.keys(result).sort().join(",") !== "case_reason_code,case_status,external_send,model_execute,read_only,reason_code,source_fingerprint,status,version,work_case_ref"
    || result.version !== 1 || result.source_fingerprint !== fingerprint || result.read_only !== true
    || result.external_send !== false || result.model_execute !== false) return unavailable;
  const bound = result.status === "verified" && result.reason_code === null && result.case_status === "bound"
    && result.case_reason_code === null && typeof result.work_case_ref === "string"
    && result.work_case_ref.length > 0 && result.work_case_ref.length <= 160;
  const unbound = result.status === "verified" && result.reason_code === null && result.case_status === "held"
    && typeof result.case_reason_code === "string" && result.case_reason_code.length > 0
    && result.case_reason_code.length <= 80 && result.work_case_ref === null;
  const held = result.status === "held" && typeof result.reason_code === "string" && result.case_status === "held"
    && result.reason_code.length > 0 && result.reason_code.length <= 80
    && typeof result.case_reason_code === "string" && result.case_reason_code.length > 0
    && result.case_reason_code.length <= 80 && result.work_case_ref === null;
  if (!bound && !unbound && !held) return unavailable;
  return { status: result.status as SourceProof["status"], case_status: result.case_status as SourceProof["case_status"],
    reason_code: result.status === "held" ? result.reason_code as string : result.case_status === "held"
      ? result.case_reason_code as string : null };
}

function response(value: unknown, identity: Record<string, unknown>, queried: boolean): Recall {
  const envelope = value as { ok?: unknown; result?: Record<string, unknown> } | null;
  const result = envelope?.ok === true ? envelope.result : null;
  if (!result || result.version !== 1 || !["current", "held"].includes(String(result.status))
    || result.external_send !== false || typeof result.model_execute !== "boolean"
    || Object.keys(identity).some(key => result[key] !== identity[key])
    || !Array.isArray(result.entries) || result.entries.length > 50 || JSON.stringify(result).length > 70000) {
    return { status: "held", reason_code: "recall_unavailable", entries: [] };
  }
  const support = result.source_support as Record<string, unknown> | undefined;
  if (support !== undefined && (!queried || !support || typeof support !== "object" || Array.isArray(support)
    || Object.keys(support).sort().join(",") !== "policy,reason_code,status" || support.policy !== "source-support-v1"
    || !["assessed", "held"].includes(String(support.status))
    || support.reason_code !== null && (typeof support.reason_code !== "string" || support.reason_code.length > 80)
    || support.status === "assessed" && (result.model_execute !== true
      || support.reason_code !== null && support.reason_code !== "requested_contact_evidence_missing")
    || support.status === "held" && (result.status !== "held" || result.entries.length !== 0))
    || result.model_execute && (!queried || !support)
    || queried && result.entries.length > 0 && (support?.status !== "assessed" || result.model_execute !== true)) {
    return { status: "held", reason_code: "recall_unavailable", entries: [] };
  }
  const valid = result.entries.every((entry: Entry) => entry && Object.keys(entry).sort().join(",") === entryFields
    && typeof entry.id === "string"
    && categories.includes(entry.category) && typeof entry.content === "string" && entry.content.length <= 12000
    && /^sha256:[a-f0-9]{64}$/u.test(entry.source_fingerprint)
    && (entry.student_id === null || typeof entry.student_id === "string")
    && (entry.student === null || typeof entry.student === "string") && typeof entry.managed_method === "boolean");
  if (!valid || new Set(result.entries.map((entry: Entry) => entry.id)).size !== result.entries.length) {
    return { status: "held", reason_code: "recall_unavailable", entries: [] };
  }
  return { status: result.status as Recall["status"], reason_code: typeof result.reason_code === "string" ? result.reason_code
    : typeof support?.reason_code === "string" ? support.reason_code : null,
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
    return { rootRef, call: (request: Record<string, unknown>, signal?: AbortSignal) => host.callOwnerControl("owner_memory_recall", request, signal),
      proofCall: (request: Record<string, unknown>, signal?: AbortSignal) => host.callOwnerControl("owner_recall_source_proof_read", request, signal) };
  });

  function sourceCurrent(turn: Turn, manager: unknown): boolean {
    if (!turn.active || activeTurns.get(turn.manager) !== turn || manager !== turn.manager || !(manager instanceof SessionManager)
      || manager.getSessionId() !== turn.sessionId || canonical(manager.getCwd()) !== root) return false;
    const branch = manager.getBranch(), start = turn.startingLeafId === null ? -1 : branch.findIndex(entry => entry.id === turn.startingLeafId);
    if (turn.startingLeafId !== null && start < 0) return false;
    const users = branch.slice(start + 1).filter(entry => entry.type === "message" && entry.message.role === "user");
    const latest = users[0];
    if (users.length !== 1 || latest?.type !== "message" || latest.message.role !== "user" || latest.id === turn.startingUserId
      || turn.boundUserId !== null && latest.id !== turn.boundUserId
      || branch.some(entry => entry.type === "context_edit" && entry.targetId === latest.id)) return false;
    const digest = hash(JSON.stringify(latest.message));
    if (turn.boundUserHash !== null && digest !== turn.boundUserHash) return false;
    // Bind the actual public SDK entry after legitimate input/skill/image
    // normalization. Core capture below still requires the original raw text.
    turn.boundUserId = latest.id; turn.boundUserHash = digest;
    return true;
  }

  function current(turn: Turn, manager: unknown): EduPiPromptOutboxEntry | null {
    if (!turn.captured || disabled() || !sourceCurrent(turn, manager) || !(manager instanceof SessionManager)) return null;
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
      const result = response(value, identity, Boolean(params.query));
      // This is a provenance hint for one displayed result, never an answer
      // support decision or a permit to combine sources. Keep private refs in Core.
      if (!params.query || result.entries.length !== 1 || !host.proofCall) return result;
      const entry = result.entries[0];
      let proof: SourceProof;
      try {
        const proofSignal = signal ? AbortSignal.any([signal, AbortSignal.timeout(3000)]) : AbortSignal.timeout(3000);
        const answer = await host.proofCall({ root_ref: host.rootRef, expected_owner_id: binding.ownerId,
          query_message_ref: binding.messageRef!,
          ...(entry.student_id ? { student_id: entry.student_id } : {}), memory_id: entry.id,
          category: entry.category, source_fingerprint: entry.source_fingerprint }, proofSignal);
        proof = sourceProof(answer, entry.source_fingerprint);
      } catch { proof = { status: "held", case_status: "held", reason_code: "proof_unavailable" }; }
      if (!current(turn, manager)) return denied();
      return { ...result, source_proof: proof };
    } catch { return denied("recall_unavailable"); }
  }

  const tool = defineTool({ name: "memory_recall", label: "检索记忆", parameters, executionMode: "sequential",
      description: "检索当前已授权班级和学期的已审核记忆。学生同名时使用学生ID。",
      promptSnippet: "memory_recall: 检索当前会话可用的长期记忆",
      async execute(_id, params, signal, _update, ctx) {
        const result = await recall(ctx.sessionManager, params, signal);
        return { content: [{ type: "text", text: result.entries.length
          ? result.entries.map(entry => `${entry.student ? `${entry.student}：` : ""}${entry.content}`).join("\n")
          : result.status === "held" ? result.reason_code === "recall_unavailable" || result.reason_code?.startsWith("source_support_")
            ? "记忆来源尚未完成核验。" : "当前会话未绑定可用记忆范围。"
            : result.reason_code === "requested_contact_evidence_missing" ? "当前来源没有完整答案。" : "没有找到当前范围的相关记忆。" }], details: result };
      },
  });
  function scopeKey(manager: unknown): string | null {
    const turn = turns.getStore(), outbox = turn ? current(turn, manager) : null;
    if (!outbox) return null;
    const binding = outbox.bindings.find(item => item.domain === "teaching_preparation") ?? outbox.bindings[0];
    return hash(JSON.stringify([root, outbox.sessionId, binding.domain, binding.ownerId, binding.grantId, binding.grantVersion]));
  }
  function currentTurnKey(manager: unknown): string | null {
    const turn = turns.getStore();
    // This is only a local current-run identity. It never grants Core recall.
    return turn && sourceCurrent(turn, manager) ? hash(JSON.stringify([root, turn.sessionId, turn.boundUserId, turn.sourceNonce])) : null;
  }
  async function memorySnapshot(manager: Parameters<typeof projectMemoryHistory>[1], messages: Parameters<typeof projectMemoryHistory>[0]) {
    let result = await recall(manager, { limit: 50 });
    // Revalidate recent returned IDs per category, before Core applies its
    // result cap. A category/query result can lie beyond the general summary.
    const history = memoryHistoryIds(messages, manager);
    if (history.length) {
      const ids = [...new Set([...history, ...result.entries.map(entry => entry.id)])].slice(0, 50);
      // Discard earlier bodies after awaiting the authoritative batch. A
      // revoked grant or changed source cannot survive as cached context.
      result = await recall(manager, { limit: 50 }, undefined, ids);
    }
    const scope = scopeKey(manager);
    return { entries: result.entries, scopeKey: scope, turnKey: currentTurnKey(manager), status: result.status, active: scope !== null };
  }
  const summary = createMemorySummaryGuard(root, memorySnapshot, scopeKey, currentTurnKey);
  const extension: ExtensionFactory = pi => {
    pi.on("session_before_compact", (event, ctx) => summary.compact(event, ctx));
    // The public tree hook cannot replace the default summarizer's inputs.
    // Navigation itself stays available; a protected abandoned-branch summary is held.
    pi.on("session_before_tree", (event, ctx) => canonical(ctx.sessionManager.getCwd()) === root
      && event.preparation.userWantsSummary ? { cancel: true } : undefined);
    pi.on("message_end", (event, ctx) => summary.sealAssistant(event.message, ctx));
    pi.on("context", async (event, ctx) => {
      try {
        if (canonical(ctx.sessionManager.getCwd()) !== root) return undefined;
        const snapshot = await memorySnapshot(ctx.sessionManager, event.messages);
        const entries = snapshot.entries;
        const { messages, memories, turnKey } = summary.project(event.messages, ctx.sessionManager, snapshot);
        const automatic = entries.filter(entry => ["preferences", "semester", "class"].includes(entry.category)
          || entry.category === "teaching" && entry.managed_method).slice(0, 12);
        const projected = automatic.length ? [{ role: "user" as const, content: [{ type: "text" as const, text: `[EduPi 长期记忆]\n${automatic.map(entry => entry.content).join("\n")}\n[历史记忆供参考]` }], timestamp: Date.now() }, ...messages] : messages;
        summary.rememberContext(ctx.sessionManager, event.messages, projected, snapshot,
          [...new Map([...memories, ...automatic].map(entry => [entry.id, { id: entry.id, category: entry.category, source_fingerprint: entry.source_fingerprint }])).values()], turnKey);
        return { messages: projected };
      } catch {
        // Extension errors are non-fatal in Pi. Abort explicitly so a failed
        // privacy projection cannot be swallowed and replaced by raw history.
        try { ctx.abort(); } catch { /* Empty history remains fail-closed. */ }
        return { messages: [] };
      }
    });
  };

  return { extension, tool, recall, invalidate, bindSummarization: summary.bind,
    async run<T>(manager: SessionManager, command: { message: string; clientRequestId?: string },
      captured: boolean, callback: () => Promise<T>): Promise<T> {
      invalidate(manager);
      if (!(manager instanceof SessionManager)
        || canonical(manager.getCwd()) !== root) return turns.run(null, callback);
      const previousUser = manager.getBranch().findLast(entry => entry.type === "message" && entry.message.role === "user");
      const turn: Turn = { manager, sessionId: manager.getSessionId(), clientRequestId: command.clientRequestId ?? "", text: command.message, active: true,
        captured: captured && !!command.clientRequestId && !disabled(), sourceNonce: randomUUID(), startingLeafId: manager.getLeafId(),
        startingUserId: previousUser?.id ?? null, boundUserId: null, boundUserHash: null };
      activeTurns.set(manager, turn);
      try { return await turns.run(turn, callback); } finally {
        turn.active = false;
        if (activeTurns.get(manager) === turn) activeTurns.delete(manager);
      }
    },
  };
}

export type EduPiMemoryRecallAccess = ReturnType<typeof createEduPiMemoryRecallAccess>;
