import { createHash, createHmac, timingSafeEqual } from "node:crypto";
import { realpathSync } from "node:fs";
import { resolve } from "node:path";
import type { AgentMessage, StreamFn } from "@earendil-works/pi-agent-core";
import { lazyStream } from "@earendil-works/pi-ai";
import { compact, convertToLlm, type AgentSessionServices, type ExtensionContext, type SessionBeforeCompactEvent,
  type SessionBeforeCompactResult, type SessionManager } from "@earendil-works/pi-coding-agent";
import { deriveExistingMemorySummaryKey } from "./edupi-owner-control-token";

export type RecalledMemory = { id: string; category: "semester" | "class" | "teaching" | "preferences" | "school";
  content: string; source_fingerprint: string; student_id: string | null; student: string | null; managed_method: boolean };
type MemoryRef = Pick<RecalledMemory, "id" | "category" | "source_fingerprint">;
type Manager = ExtensionContext["sessionManager"];
type Services = Pick<AgentSessionServices, "modelRuntime" | "settingsManager">;
type Snapshot = { entries: RecalledMemory[]; scopeKey: string | null; turnKey: string | null; status: "current" | "held"; active: boolean };
type Provenance = { memories: MemoryRef[]; turnKey: string | null };
const PROOF = "edupi_memory_summary_v1";
const OUTPUT_PROOF = "edupi_memory_output_v1";
const hash = (value: string) => `sha256:${createHash("sha256").update(value).digest("hex")}`;
const directory = (value: string) => { try { return realpathSync(value); } catch { return resolve(value); } };
const memoryTools = new Set(["memory_recall", "memory_write", "memory_forget", "student_note"]);
const digestPattern = /^sha256:[a-f0-9]{64}$/u;
type Verify = (value: Record<string, unknown>) => boolean;
type Entry = ReturnType<Manager["getBranch"]>[number];
const messageHash = (message: AgentMessage) => hash(JSON.stringify(message));
function canonical(value: unknown): string {
  const ordered = (item: unknown): unknown => Array.isArray(item) ? item.map(ordered) : item && typeof item === "object"
    ? Object.fromEntries(Object.entries(item).sort(([a], [b]) => a.localeCompare(b)).map(([key, child]) => [key, ordered(child)])) : item;
  return JSON.stringify(ordered(value));
}
function latestUser(manager: Manager) {
  return manager.getBranch().findLast(entry => entry.type === "message" && entry.message.role === "user");
}
function history(manager: Manager) {
  const branch = manager.getBranch(), byId = new Map(branch.map(entry => [entry.id, entry]));
  const assistants = new Map<string, Entry[]>(), summaries = new Map<string, Entry>(), edited = new Set<string>(), toolOwners = new Map<string, string | null>();
  let userEntryId: string | null = null;
  for (const entry of branch) {
    if (entry.type === "message" && entry.message.role === "user") userEntryId = entry.id;
    if (entry.type === "message" && entry.message.role === "toolResult") {
      const digest = messageHash(entry.message); toolOwners.set(digest, toolOwners.has(digest) ? null : userEntryId);
    }
    if (entry.type === "context_edit") edited.add(entry.targetId);
    if (entry.type === "compaction" || entry.type === "branch_summary") summaries.set(entry.summary, entry);
    if (entry.type === "message" && entry.message.role === "assistant") {
      const digest = messageHash(entry.message), rows = assistants.get(digest) ?? []; rows.push(entry); assistants.set(digest, rows);
    }
  }
  for (const entry of branch) {
    if (entry.type === "message" && entry.message.role === "toolResult" && edited.has(entry.id)) toolOwners.set(messageHash(entry.message), null);
  }
  return { branch, byId, assistants, summaries, edited, toolOwners, userEntryId };
}
type History = ReturnType<typeof history>;
function userBound(value: Record<string, unknown>, view: History): boolean {
  const entry = typeof value.userEntryId === "string" ? view.byId.get(value.userEntryId) : undefined;
  if (typeof value.userEntryId !== "string" || view.edited.has(value.userEntryId)) return false;
  return entry?.type === "message" && entry.message.role === "user" && messageHash(entry.message) === value.userHash;
}
function usableRefs(refs: MemoryRef[], snapshot: Snapshot): boolean {
  return refs.every(ref => snapshot.entries.some(entry => entry.id === ref.id && entry.category === ref.category
    && entry.source_fingerprint === ref.source_fingerprint));
}
function sourceWindow(value: Record<string, unknown>, snapshot: Snapshot, view: History): boolean {
  return value.turnKey === null || typeof value.turnKey === "string" && digestPattern.test(value.turnKey)
    && value.turnKey === snapshot.turnKey && value.userEntryId === view.userEntryId;
}
function summaryText(message: AgentMessage): string | null {
  return message.role === "compactionSummary" || message.role === "branchSummary" ? message.summary : null;
}
function storedProof(text: string, view: History): Record<string, unknown> | null {
  const entry = view.summaries.get(text);
  const value = entry && (entry.type === "compaction" || entry.type === "branch_summary")
    ? (entry.details as Record<string, unknown> | undefined)?.[PROOF] : null;
  return value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : null;
}
function proofRefs(value: Record<string, unknown> | null): MemoryRef[] | null {
  if (!value || !Array.isArray(value.memories) || value.memories.length > 50) return null;
  const refs = value.memories as MemoryRef[];
  if (refs.some(ref => !ref || typeof ref.id !== "string" || ref.id.length > 160
    || !["semester", "class", "teaching", "preferences", "school"].includes(ref.category)
    || !digestPattern.test(ref.source_fingerprint)) || new Set(refs.map(ref => ref.id)).size !== refs.length) return null;
  return refs;
}
export function memoryHistoryIds(messages: AgentMessage[], manager: Manager): string[] {
  const ids = new Set<string>(), view = history(manager);
  for (const message of [...messages].reverse()) {
    const text = summaryText(message);
    const refs = text !== null ? proofRefs(storedProof(text, view)) : message.role === "toolResult" && message.toolName === "memory_recall"
      ? (message.details as { entries?: MemoryRef[] } | undefined)?.entries : null;
    if (!Array.isArray(refs)) continue;
    for (const ref of refs) if (ref && typeof ref.id === "string" && ref.id.length <= 160 && ids.size < 50) ids.add(ref.id);
  }
  for (const entry of [...view.branch].reverse()) {
    if (entry.type !== "custom" || entry.customType !== OUTPUT_PROOF) continue;
    const refs = proofRefs(entry.data as Record<string, unknown>);
    for (const ref of refs ?? []) if (ids.size < 50) ids.add(ref.id);
  }
  return [...ids];
}
function verifiedSummary(manager: Manager, text: string, root: string, snapshot: Snapshot, verify: Verify, view: History): Provenance | null {
  const value = storedProof(text, view), refs = proofRefs(value);
  if (!value || !refs || !verify(value) || value.version !== 1 || value.kind !== "summary" || value.rootHash !== hash(root)
    || value.sessionId !== manager.getSessionId() || value.scopeKey !== snapshot.scopeKey || value.summaryHash !== hash(text)
    || !userBound(value, view) || !sourceWindow(value, snapshot, view)) return null;
  const entry = view.summaries.get(text);
  return entry?.parentId === value.sourceLeafId && usableRefs(refs, snapshot) ? { memories: refs, turnKey: value.turnKey as string | null } : null;
}
function verifiedAssistant(message: AgentMessage, manager: Manager, root: string, snapshot: Snapshot, verify: Verify, view = history(manager)): Provenance | null {
  const digest = messageHash(message), matches = view.assistants.get(digest) ?? [];
  if (matches.length !== 1) return null;
  const entry = matches[0];
  const parent = entry.parentId ? view.byId.get(entry.parentId) : undefined;
  if (parent?.type !== "custom" || parent.customType !== OUTPUT_PROOF || !parent.data || typeof parent.data !== "object") return null;
  const value = parent.data as Record<string, unknown>, refs = proofRefs(value);
  return refs && verify(value) && value.version === 1 && value.kind === "assistant" && value.rootHash === hash(root)
    && value.sessionId === manager.getSessionId() && value.scopeKey === snapshot.scopeKey && value.messageHash === digest
    && value.sourceLeafId === parent.parentId && userBound(value, view) && sourceWindow(value, snapshot, view) && usableRefs(refs, snapshot)
    ? { memories: refs, turnKey: value.turnKey as string | null } : null;
}

/** Invalid memory-derived assistant spans are omitted as units, never scrubbed by a name glob.
 * Current surviving entries are reconstructed from Core, not copied from old tool bodies. */
function projectHistory(messages: AgentMessage[], manager: Manager, root: string, snapshot: Snapshot, verify: Verify,
  currentAssistant: (message: AgentMessage, view: History) => Provenance | null = () => null, allowCurrentReceipts = false) {
  const current = new Map(snapshot.entries.map(entry => [entry.id, entry])), view = history(manager);
  const turnFor = new Map<AgentMessage, number>(), tainted = new Set<number>(), surviving = new Map<number, Map<string, RecalledMemory>>();
  const provedResults = new Map<AgentMessage, RecalledMemory[]>(), provedAssistants = new Map<AgentMessage, Provenance>(), turnOnly = new Set<AgentMessage>(); let turn = 0;
  for (const message of messages) {
    if (message.role === "user") turn++;
    turnFor.set(message, turn);
    if (message.role === "assistant") {
      const proof = verifiedAssistant(message, manager, root, snapshot, verify, view) ?? currentAssistant(message, view);
      if (!proof) tainted.add(turn); else provedAssistants.set(message, proof);
    }
    if (message.role !== "toolResult") continue;
    if (!memoryTools.has(message.toolName) || allowCurrentReceipts && message.toolName !== "memory_recall") {
      // Current mutation receipts share the ordinary tool-result window. They
      // acknowledge this execution without minting memory/source authority.
      if (snapshot.turnKey
        && view.userEntryId && view.toolOwners.get(messageHash(message)) === view.userEntryId) turnOnly.add(message);
      else tainted.add(turn);
      continue;
    }
    const old = (message.details as { entries?: MemoryRef[] } | undefined)?.entries;
    const proved = message.toolName === "memory_recall" && Array.isArray(old) ? old.flatMap(ref => {
      const entry = ref && current.get(ref.id);
      return entry && entry.source_fingerprint === ref.source_fingerprint ? [entry] : [];
    }) : [];
    provedResults.set(message, proved);
    if (message.toolName !== "memory_recall" || !Array.isArray(old) || proved.length !== old.length) tainted.add(turn);
    const rows = surviving.get(turn) ?? new Map(); for (const entry of proved) rows.set(entry.id, entry); surviving.set(turn, rows);
  }
  const used = new Map<string, MemoryRef>(), inserted = new Set<number>(), projected: AgentMessage[] = []; let needsTurn = false;
  const remember = (refs: MemoryRef[]) => { for (const ref of refs) used.set(ref.id, { id: ref.id, category: ref.category, source_fingerprint: ref.source_fingerprint }); };
  for (const message of messages) {
    // Neither legacy shell output nor extension custom content carries an
    // independently revalidatable source. Keep the original/UI history only.
    if (message.role === "custom" || message.role === "bashExecution") continue;
    const text = summaryText(message);
    if (text !== null) {
      const proof = verifiedSummary(manager, text, root, snapshot, verify, view);
      if (proof) { remember(proof.memories); needsTurn ||= proof.turnKey !== null; projected.push(message); }
      continue;
    }
    const group = turnFor.get(message)!;
    if (tainted.has(group) && (message.role === "assistant" || message.role === "toolResult")) {
      if (!inserted.has(group)) {
        inserted.add(group); const entries = [...(surviving.get(group)?.values() ?? [])];
        if (entries.length) {
          remember(entries);
          projected.push({ role: "user", content: [{ type: "text", text: `[已重新核对的历史记忆]\n${entries.map(entry => entry.content).join("\n")}` }], timestamp: 0 });
        }
      }
      if (allowCurrentReceipts && message.role === "toolResult" && memoryTools.has(message.toolName)
        && message.toolName !== "memory_recall" && turnOnly.has(message)) {
        // A mutation can revoke the source used by its assistant call. Keep
        // that call held, but acknowledge this exact execution without an
        // orphaned tool message or any persistent memory/source authority.
        needsTurn = true;
        projected.push({ role: "user", content: [{ type: "text", text: `[本轮工具回执：${message.toolName}]\n` }, ...message.content], timestamp: message.timestamp });
      }
      continue;
    }
    const entries = provedResults.get(message);
    if (entries && message.role === "toolResult") {
      remember(entries);
      projected.push({ ...message, content: [{ type: "text", text: entries.length ? entries.map(entry => entry.content).join("\n") : "历史记忆结果已失效。" }], details: { entries } });
    } else {
      const proof = provedAssistants.get(message);
      if (proof) { remember(proof.memories); needsTurn ||= proof.turnKey !== null; }
      needsTurn ||= turnOnly.has(message);
      projected.push(message);
    }
  }
  return { messages: projected, memories: [...used.values()], turnKey: needsTurn ? snapshot.turnKey : null };
}
export function projectMemoryHistory(messages: AgentMessage[], manager: Manager, root: string, snapshot: Snapshot, verify: Verify = () => false) {
  return projectHistory(messages, manager, root, snapshot, verify);
}
const summarizable = (messages: AgentMessage[]) => messages.filter(message => message.role !== "system"
  && message.role !== "custom" && message.role !== "bashExecution");

/** Public SDK custom-compaction contract; never fall back to raw input after a guard failure. */
export function createMemorySummaryGuard(root: string, snapshot: (manager: Manager, messages: AgentMessage[]) => Promise<Snapshot>,
  scopeKey: (manager: Manager) => string | null, currentTurnKey: (manager: Manager) => string | null) {
  type Binding = { services: Services; runtime: Services["modelRuntime"]; manager: SessionManager; sessionId: string; stateDir: string | undefined };
  let binding: Binding | undefined;
  type Request = { binding: Binding; key: Buffer | null; userEntryId: string; userHash: string; runKey: string | null;
    sourceLeafId: string | null; scopeKey: string | null; turnKey: string | null; memories: MemoryRef[]; inputHash: string };
  const pending = new WeakMap<Manager, Request>();
  const currentOutputs = new WeakMap<Manager, { runKey: string; messages: Map<string, { request: Request; parentId: string | null }> }>();
  const keyFor = (manager: Manager) => deriveExistingMemorySummaryKey(binding?.stateDir, root, manager.getSessionId());
  const sign = (value: Record<string, unknown>, key: Buffer) => ({ ...value,
    mac: createHmac("sha256", key).update("edupi.memory.provenance.v1\0").update(canonical(value)).digest("hex") });
  const verifier = (key: Buffer): Verify => value => {
    const { mac, ...body } = value;
    if (typeof mac !== "string" || !/^[a-f0-9]{64}$/u.test(mac)) return false;
    const expected = sign(body, key).mac;
    return timingSafeEqual(Buffer.from(mac, "hex"), Buffer.from(expected, "hex"));
  };
  const currentReceiptWindow = (manager: Manager, checked: Snapshot) => Boolean(binding?.manager === manager
    && binding.sessionId === manager.getSessionId() && directory(manager.getCwd()) === root
    && checked.turnKey && currentTurnKey(manager) === checked.turnKey && scopeKey(manager) === checked.scopeKey);
  function currentAssistant(message: AgentMessage, manager: Manager, checked: Snapshot, view = history(manager)): Provenance | null {
    const current = currentOutputs.get(manager);
    if (!current || !checked.turnKey || current.runKey !== checked.turnKey || currentTurnKey(manager) !== checked.turnKey) {
      currentOutputs.delete(manager); return null;
    }
    const digest = messageHash(message), output = current.messages.get(digest), request = output?.request;
    const matches = view.assistants.get(digest) ?? [];
    if (!output || !request || binding !== request.binding || binding.manager !== manager || binding.sessionId !== manager.getSessionId()
      || directory(manager.getCwd()) !== root || request.scopeKey !== checked.scopeKey || scopeKey(manager) !== checked.scopeKey
      || request.userEntryId !== view.userEntryId || !userBound(request, view) || !usableRefs(request.memories, checked)
      || matches.length !== 1 || matches[0].parentId !== output.parentId || view.edited.has(matches[0].id)) return null;
    return { memories: request.memories, turnKey: current.runKey };
  }
  function bind(services: Services, manager: SessionManager, stateDir = process.env.PI_DESKTOP_STATE_DIR) {
    const pinned = { services, runtime: services.modelRuntime, manager, sessionId: manager.getSessionId(), stateDir };
    binding = pinned;
    if (directory(manager.getCwd()) !== root) return;
    const held = () => new Error("memory_model_route_held");
    const resolveModel: Services["modelRuntime"]["resolveModel"] = async (model, _messages, options) => {
      try {
        const leaf = manager.getLeafId(), scope = scopeKey(manager), capture = currentTurnKey(manager);
        const assertCurrent = () => {
          if (binding !== pinned || manager.getSessionId() !== pinned.sessionId || directory(manager.getCwd()) !== root || manager.getLeafId() !== leaf
            || scopeKey(manager) !== scope || currentTurnKey(manager) !== capture || options.signal?.aborted) throw held();
        };
        assertCurrent();
        // Routing precedes Pi's context hook. Rebuild from the public structured
        // projection instead of trusting already-converted summaries or tool state.
        // Opaque persisted router state has no host provenance and cannot be forwarded.
        if (options.state !== undefined) throw held();
        const source = manager.buildSessionProjection().messages;
        const checked = await snapshot(manager, source); assertCurrent();
        if (checked.active && checked.status !== "current") throw held();
        let verify: Verify = () => false;
        try { verify = verifier(keyFor(manager)); } catch { /* Legacy derived content is omitted. */ }
        if (options.failed && !verifiedAssistant(options.failed, manager, root, checked, verify)
          && !currentAssistant(options.failed, manager, checked)) throw held();
        const projected = projectHistory(source, manager, root, checked, verify,
          (message, view) => currentAssistant(message, manager, checked, view), currentReceiptWindow(manager, checked));
        const messages = convertToLlm(summarizable(projected.messages));
        assertCurrent();
        const route = await pinned.runtime.resolveModel(model, messages, options);
        assertCurrent();
        return route;
      } catch { throw held(); }
    };
    // A facade is scoped to one services/manager pair. Public methods keep their
    // original receiver; no SDK instance method or agent state is replaced.
    services.modelRuntime = new Proxy(pinned.runtime, { get(target, property) {
      if (property === "resolveModel") return resolveModel;
      if (property === "streamSimple" || property === "completeSimple") {
        const streamSimple: Services["modelRuntime"]["streamSimple"] = (model, context, options) => {
          if (!target.getPhysicalModel(model.provider, model.id)) {
            // SDK direct streaming routes internally on its original receiver.
            // Only custom compaction has a proved prepared-input path below.
            return lazyStream(model, async () => { throw held(); });
          }
          return target.streamSimple(model, context, options);
        };
        return property === "streamSimple" ? streamSimple
          : (...args: Parameters<typeof streamSimple>) => streamSimple(...args).result();
      }
      const value = Reflect.get(target, property, target);
      return typeof value === "function" ? value.bind(target) : value;
    } });
  }
  return {
    bind,
    project(messages: AgentMessage[], manager: Manager, checked: Snapshot) {
      let verify: Verify = () => false;
      try { if (binding?.manager === manager && binding.sessionId === manager.getSessionId()) verify = verifier(keyFor(manager)); } catch { /* Unproved derived history is held. */ }
      return projectHistory(messages, manager, root, checked, verify,
        (message, view) => currentAssistant(message, manager, checked, view), currentReceiptWindow(manager, checked));
    },
    rememberContext(manager: Manager, original: AgentMessage[], projected: AgentMessage[], checked: Snapshot, memories: MemoryRef[], turnKey: string | null) {
      pending.delete(manager);
      try {
        const user = latestUser(manager);
        if (!binding || binding.manager !== manager || binding.sessionId !== manager.getSessionId() || user?.type !== "message" || user.message.role !== "user"
          || !original.some(message => message.role === "user" && messageHash(message) === messageHash(user.message))) return;
        let key: Buffer | null = null;
        try { key = keyFor(manager); } catch { /* A live tool chain does not require a persistent owner signature. */ }
        pending.set(manager, { binding, key, userEntryId: user.id, userHash: messageHash(user.message), runKey: checked.turnKey,
          sourceLeafId: manager.getLeafId(), scopeKey: checked.scopeKey, turnKey, memories, inputHash: hash(JSON.stringify(projected)) });
      } catch { pending.delete(manager); }
    },
    sealAssistant(message: AgentMessage, ctx: ExtensionContext) {
      if (message.role !== "assistant") return;
      const manager = ctx.sessionManager, request = pending.get(manager); pending.delete(manager);
      try {
        if (!request || binding !== request.binding || binding.manager !== manager || binding.sessionId !== manager.getSessionId() || manager.getLeafId() !== request.sourceLeafId
          || scopeKey(manager) !== request.scopeKey || request.runKey !== currentTurnKey(manager)
          || latestUser(manager)?.id !== request.userEntryId) return;
        // SDK emits message_end before appending the finalized assistant. Its
        // immediate parent must be this host-signed, content-bound metadata.
        if (request.key) {
          if (!timingSafeEqual(keyFor(manager), request.key)) return;
          binding.manager.appendCustomEntry(OUTPUT_PROOF, sign({ version: 1, kind: "assistant", rootHash: hash(root),
            sessionId: manager.getSessionId(), userEntryId: request.userEntryId, userHash: request.userHash,
            sourceLeafId: request.sourceLeafId, scopeKey: request.scopeKey, turnKey: request.turnKey, memories: request.memories,
            messageHash: messageHash(message), inputHash: request.inputHash }, request.key));
        }
        if (request.runKey) {
          // Private proof binds the actual SDK output to this checked input and
          // run only. It is never written to disk or accepted by compaction.
          let current = currentOutputs.get(manager);
          if (current?.runKey !== request.runKey) { current = { runKey: request.runKey, messages: new Map() }; currentOutputs.set(manager, current); }
          current.messages.set(messageHash(message), { request, parentId: manager.getLeafId() });
        }
      } catch { /* Never claim an output has provenance when the key/branch changed. */ }
    },
    async compact(event: SessionBeforeCompactEvent, ctx: ExtensionContext): Promise<SessionBeforeCompactResult | undefined> {
      try {
        const pinned = binding, manager = ctx.sessionManager;
        if (directory(manager.getCwd()) !== root) return undefined;
        if (!pinned || pinned.manager !== manager || pinned.sessionId !== manager.getSessionId() || !ctx.model) return { cancel: true };
        const leaf = manager.getLeafId(), scope = scopeKey(manager), capture = currentTurnKey(manager);
        const assertCurrent = () => {
          if (binding !== pinned || pinned.manager !== manager || manager.getSessionId() !== pinned.sessionId || manager.getLeafId() !== leaf || scopeKey(manager) !== scope
            || currentTurnKey(manager) !== capture || event.signal.aborted) throw new Error("memory_summary_scope_changed");
        };
        const key = keyFor(manager), verify = verifier(key), user = latestUser(manager);
        if (user?.type !== "message" || user.message.role !== "user") return { cancel: true };
        const preparation = event.preparation;
        const previous: AgentMessage[] = preparation.previousSummary === undefined ? []
          : [{ role: "compactionSummary", summary: preparation.previousSummary, tokensBefore: 0, timestamp: 0 }];
        const source = [...preparation.messagesToSummarize, ...preparation.turnPrefixMessages, ...previous];
        const checked = await snapshot(manager, source); assertCurrent();
        if (checked.active && checked.status !== "current") return { cancel: true };
        const history = projectMemoryHistory(preparation.messagesToSummarize, manager, root, checked, verify);
        const prefix = projectMemoryHistory(preparation.turnPrefixMessages, manager, root, checked, verify);
        const old = projectMemoryHistory(previous, manager, root, checked, verify);
        const turnKey = history.turnKey ?? prefix.turnKey ?? old.turnKey;
        const memories = [...new Map([...history.memories, ...prefix.memories, ...old.memories].map(ref => [ref.id, ref])).values()];
        const safe = { ...preparation, messagesToSummarize: summarizable(history.messages), turnPrefixMessages: summarizable(prefix.messages),
          previousSummary: old.messages.length ? preparation.previousSummary : undefined,
          // Legacy file-operation strings have no current memory/source proof.
          fileOps: { read: new Set<string>(), written: new Set<string>(), edited: new Set<string>() } };
        const services = pinned.services;
        const route = services.modelRuntime.getPhysicalModel(ctx.model.provider, ctx.model.id)
          ? { model: ctx.model, thinkingLevel: ctx.thinkingLevel ?? "off" as const }
          : await pinned.runtime.resolveModel(ctx.model, convertToLlm(summarizable([...history.messages, ...prefix.messages, ...old.messages])), {
            reason: "direct", thinkingLevel: ctx.thinkingLevel ?? "off", signal: event.signal });
        assertCurrent();
        const stream: StreamFn = async (model, context, options) => {
          const latest = await snapshot(manager, source); assertCurrent();
          if (latest.active && latest.status !== "current") throw new Error("memory_summary_recheck_held");
          if (!timingSafeEqual(keyFor(manager), key)) throw new Error("memory_summary_key_changed");
          if (memories.some(ref => !latest.entries.some(entry => entry.id === ref.id && entry.category === ref.category
            && entry.source_fingerprint === ref.source_fingerprint))) throw new Error("memory_summary_source_changed");
          const provider = services.settingsManager.getProviderRetrySettings();
          return services.modelRuntime.streamSimple(model, context, { ...options,
            timeoutMs: options?.timeoutMs ?? provider.timeoutMs, maxRetries: options?.maxRetries ?? provider.maxRetries,
            maxRetryDelayMs: options?.maxRetryDelayMs ?? provider.maxRetryDelayMs,
            websocketConnectTimeoutMs: services.settingsManager.getWebSocketConnectTimeoutMs() });
        };
        const result = await compact(safe, route.model, undefined, undefined, event.customInstructions, event.signal,
          route.thinkingLevel, stream, undefined, services.settingsManager.getRetrySettings());
        assertCurrent();
        const latest = await snapshot(manager, source); assertCurrent();
        if (latest.active && latest.status !== "current" || !timingSafeEqual(keyFor(manager), key)
          || memories.some(ref => !latest.entries.some(entry => entry.id === ref.id && entry.source_fingerprint === ref.source_fingerprint))) return { cancel: true };
        const details = result.details && typeof result.details === "object" && !Array.isArray(result.details) ? result.details : {};
        return { compaction: { ...result, details: { ...details, [PROOF]: sign({ version: 1, kind: "summary", rootHash: hash(root),
          sessionId: manager.getSessionId(), sourceLeafId: leaf, userEntryId: user.id, userHash: messageHash(user.message),
          scopeKey: scope, turnKey, summaryHash: hash(result.summary), memories }, key) } } };
      } catch { return { cancel: true }; }
    },
  };
}
