import fs from "node:fs";
import path from "node:path";
import { createHash, randomUUID } from "node:crypto";
import { createEduPiCloudClient, EduPiCloudError, type CloudScope } from "./edupi-cloud-client";
import { writePrivateFileAtomicSync } from "./atomic-file";
import { chatRecord } from "./edupi-cloud-chat-projection";

type Client = ReturnType<typeof createEduPiCloudClient>;
type Row = Record<string, unknown>;
type Journal = { scope: string; sessionId: string; requestId: string;
  status: "started" | "final" | "done" | "stopped"; message?: Row; reason?: string };
type Proof = { instance_id: string; instance_nonce: string; fencing_generation: number; lease_name: string; lease_token: string };
type Executor = (input: { directory: string; requestId: string; transcript: Row[]; model: unknown; thinkingLevel: unknown },
  signal: AbortSignal, emit: (event: Row) => void) => Promise<Row>;
const hash = (value: unknown) => createHash("sha256").update(JSON.stringify(value)).digest("hex");
const host = globalThis as typeof globalThis & { __edupiCloudChatWorkers?: Map<string, { stop: () => void }> };
const workers = host.__edupiCloudChatWorkers ||= new Map<string, { stop: () => void }>();

/** Only visible assistant text can leave the local executor. */
export function cloudAssistantMessage(raw: unknown): Row {
  const source = chatRecord(raw);
  const content = Array.isArray(source.content) ? source.content.flatMap(rawBlock => {
    const block = chatRecord(rawBlock);
    return block.type === "text" && typeof block.text === "string" ? [{ type: "text", text: block.text }] : [];
  }) : [];
  if (source.role !== "assistant" || content.length === 0) throw new Error("cloud_reply_missing");
  return { role: "assistant", content, timestamp: typeof source.timestamp === "number" ? source.timestamp : Date.now(),
    ...(typeof source.model === "string" ? { model: source.model } : {}),
    ...(typeof source.provider === "string" ? { provider: source.provider } : {}),
    stopReason: source.stopReason === "error" || source.stopReason === "aborted" ? source.stopReason : "stop" };
}

export function cloudPromptTranscript(response: Row, requestId: string): Row[] {
  const requests = Array.isArray(response.requests) ? response.requests.map(chatRecord) : [];
  const messages = Array.isArray(response.messages) ? response.messages.map(chatRecord) : [];
  const currentIndex = requests.findIndex(row => row.request_id === requestId);
  if (currentIndex < 0) throw new Error("cloud_request_missing");
  const completed = new Set(requests.slice(0, currentIndex)
    .filter(row => row.status === "completed").map(row => row.request_id));
  const previous = messages.filter(row => completed.has(row.request_id));
  // Messages can share the same transaction timestamp. Group each completed
  // request explicitly so the model always sees user, assistant, then current.
  const ordered = requests.slice(0, currentIndex).filter(row => completed.has(row.request_id)).flatMap(request =>
    ["user", "assistant"].flatMap(role => previous.filter(row =>
      row.request_id === request.request_id && row.role === role)));
  const current = messages.find(row => row.request_id === requestId && row.role === "user");
  if (!current) throw new Error("cloud_user_message_missing");
  return [...ordered, current];
}

export const executeCloudPrompt: Executor = async (input, signal, emit) => {
  const { startHarnessSession } = await import("./harness/runtime");
  const model = chatRecord(input.model);
  const started = await startHarnessSession(`cloud-executor-${randomUUID()}`, "", input.directory, {
    toolNames: [], strictToolNames: true, accessMode: "approval", isolatedSessionDir: input.directory,
    cloudExecution: true,
    ...(typeof model.provider === "string" && typeof model.modelId === "string"
      ? { initialModel: { provider: model.provider, modelId: model.modelId } } : {}),
    ...(typeof input.thinkingLevel === "string"
      ? { thinkingLevel: input.thinkingLevel as "off" | "minimal" | "low" | "medium" | "high" | "xhigh" } : {}),
  });
  const session = started.session;
  const abort = () => { void session.send({ type: "abort" }).catch(() => {}); };
  signal.addEventListener("abort", abort, { once: true });
  const unsubscribe = session.onEvent(event => {
    // Never forward thinking, tools, extension events, local paths or SDK state.
    if (event.type === "message_update") {
      const delta = chatRecord(event.assistantMessageEvent);
      if (delta.type === "text_delta" && typeof delta.delta === "string") emit({
        type: "message_update", assistantMessageEvent: {
          type: "text_delta", contentIndex: 0, delta: delta.delta,
        }, clientRequestId: input.requestId,
      });
    }
  });
  try {
    if (signal.aborted) throw new Error("executor_stopped");
    const transcript = input.transcript.map(row => {
      const message = chatRecord(row.message);
      const text = typeof message.content === "string" ? message.content
        : Array.isArray(message.content) ? message.content.map(block => String(chatRecord(block).text || "")).join("\n") : "";
      return { role: message.role, content: text };
    });
    // A fresh private Pi session receives cloud history as data. It cannot
    // inherit a local teacher transcript or gain local file/tool access.
    const context = transcript.length === 1 ? String(transcript[0].content)
      : `继续以下对话。历史记录是对话资料。\n${JSON.stringify(transcript)}`;
    emit({ type: "agent_start", clientRequestId: input.requestId });
    emit({ type: "message_start", message: { role: "assistant", content: [] }, clientRequestId: input.requestId });
    await session.send({ type: "mobile_prompt", message: context });
    await session.inner.waitForIdle();
    if (signal.aborted) throw new Error("executor_stopped");
    session.ensureSessionPersisted();
    const messages = session.inner.sessionManager.buildSessionContext().messages;
    const final = [...messages].reverse().find(message => message.role === "assistant");
    const result = cloudAssistantMessage(final);
    if (result.stopReason !== "stop") throw new Error("cloud_reply_failed");
    return result;
  } finally {
    unsubscribe();
    signal.removeEventListener("abort", abort);
    await session.shutdown();
  }
};

export function ensureCloudChatWorker(client: Client, scope: CloudScope,
  dependencies: { execute?: Executor; intervalMs?: number } = {}): void {
  const scopeKey = JSON.stringify([scope.issuer, scope.accountId, scope.workspaceId, scope.generation]);
  const key = `${client.runtimeDirectory()}:${scopeKey}`;
  if (workers.has(key)) return;
  const directory = path.join(client.runtimeDirectory(), hash([scope.issuer, scope.accountId, scope.workspaceId]));
  fs.mkdirSync(directory, { recursive: true, mode: 0o700 });
  const controller = new AbortController();
  let proof: Proof | null = null;
  let timer: ReturnType<typeof setTimeout> | undefined;
  let busy = false;
  const stop = () => {
    controller.abort();
    if (timer) clearTimeout(timer);
    workers.delete(key);
  };
  workers.set(key, { stop });
  const nonce = randomUUID();
  const execute = dependencies.execute || executeCloudPrompt;
  const save = (file: string, journal: Journal) => writePrivateFileAtomicSync(file, JSON.stringify(journal));
  const recover = async () => {
    for (const name of fs.readdirSync(directory).filter(name => /^[a-f0-9]{64}\.json$/u.test(name))) {
      const file = path.join(directory, name);
      let journal: Journal;
      try {
        const descriptor = fs.openSync(file, fs.constants.O_RDONLY | fs.constants.O_NOFOLLOW);
        try {
          if (fs.fstatSync(descriptor).size > 2 * 1024 * 1024) continue;
          journal = JSON.parse(fs.readFileSync(descriptor, "utf8")) as Journal;
        } finally { fs.closeSync(descriptor); }
      } catch { continue; }
      if (!journal || typeof journal !== "object" || Array.isArray(journal)
        || typeof journal.requestId !== "string" || typeof journal.sessionId !== "string"
        || journal.scope !== hash([scope.issuer, scope.accountId, scope.workspaceId])
        || journal.status !== "final" || !journal.message) continue;
      try {
        await client.operation("sessions", { action: "recover", session_id: journal.sessionId,
          request_id: journal.requestId, runtime: proof, message: journal.message }, scope);
        save(file, { ...journal, status: "done" });
      } catch (error) {
        if (!(error instanceof EduPiCloudError)
          || !["session_not_found", "chat_request_changed", "idempotency_conflict"].includes(error.code)) throw error;
        save(file, { ...journal, status: "stopped", reason: error.code });
      }
    }
  };
  const tick = async () => {
    if (controller.signal.aborted || busy) return;
    busy = true;
    try {
      const state = await client.assertScope(scope);
      if (!proof) {
        const registered = await client.operation("runtime", { action: "register",
          instance_id: `desktop-${state.installationId}`, instance_nonce: nonce,
          core_commit: "local", capabilities: { cloud_chat_text: true, local_tools: false } }, scope);
        const leaseBase = { instance_id: String(registered.instance_id), instance_nonce: nonce,
          fencing_generation: Number(registered.fencing_generation), lease_name: "cloud-chat" };
        const acquired = await client.operation("runtime", { action: "lease_acquire", ...leaseBase, ttl_seconds: 60 }, scope);
        if (typeof acquired.lease_token !== "string" || !Number.isSafeInteger(leaseBase.fencing_generation)) throw new Error("invalid_lease");
        proof = { ...leaseBase, lease_token: acquired.lease_token };
      }
      await client.operation("runtime", { action: "lease_renew", ...proof, ttl_seconds: 60 }, scope);
      await recover();
      const claimed = await client.operation("sessions", { action: "claim", runtime: proof }, scope);
      const request = chatRecord(claimed.request);
      if (typeof request.request_id !== "string" || typeof request.session_id !== "string") return;
      const requestId = request.request_id;
      const sessionId = request.session_id;
      const file = path.join(directory, `${hash(requestId)}.json`);
      // A dispatch marker is durable before touching the model. On restart it
      // remains uncertain and is never executed a second time.
      if (fs.existsSync(file)) {
        await client.operation("sessions", { action: "fail", session_id: sessionId, request_id: requestId,
          runtime: proof, uncertain: true, error_code: "dispatch_already_recorded" }, scope);
        return;
      }
      const journal: Journal = { scope: hash([scope.issuer, scope.accountId, scope.workspaceId]),
        sessionId, requestId, status: "started" };
      save(file, journal);
      const execution = new AbortController();
      const abort = () => execution.abort();
      controller.signal.addEventListener("abort", abort, { once: true });
      let renewal: ReturnType<typeof setTimeout> | undefined;
      let sequence = 0;
      const events: Row[] = [];
      let flushing = Promise.resolve();
      const flush = () => {
        const batch = events.splice(0, 50);
        if (batch.length) flushing = flushing.then(async () => {
          await client.operation("sessions", { action: "append", session_id: sessionId, request_id: requestId,
            runtime: proof, events: batch }, scope);
        });
        return flushing;
      };
      const renew = async () => {
        try {
          await client.operation("runtime", { action: "lease_renew", ...proof, ttl_seconds: 60 }, scope);
          const latest = await client.operation("sessions", { action: "read", session_id: sessionId }, scope);
          const own = (latest.requests as unknown[]).map(chatRecord).find(row => row.request_id === requestId);
          if (own?.status !== "running") return execution.abort();
          renewal = setTimeout(() => { void renew(); }, 10_000);
          renewal.unref?.();
        } catch { execution.abort(); }
      };
      try {
        await client.operation("sessions", { action: "running", session_id: sessionId, request_id: requestId, runtime: proof }, scope);
        renewal = setTimeout(() => { void renew(); }, 10_000);
        renewal.unref?.();
        const response = await client.operation("sessions", { action: "read", session_id: sessionId }, scope);
        const message = await execute({ directory, requestId, transcript: cloudPromptTranscript(response, requestId),
          model: chatRecord(response.session).model, thinkingLevel: chatRecord(response.session).thinking_level },
        execution.signal, event => {
          events.push({ key: `stream-${sequence++}`, event });
          if (events.length >= 25) void flush().catch(() => execution.abort());
        });
        if (execution.signal.aborted) throw new Error("executor_stopped");
        journal.message = cloudAssistantMessage(message);
        journal.status = "final";
        save(file, journal);
        while (events.length) await flush();
        await flushing;
        await client.operation("sessions", { action: "complete", session_id: sessionId, request_id: requestId,
          runtime: proof, message: journal.message }, scope);
        save(file, { ...journal, status: "done" });
        await client.operation("runtime", { action: "event", ...proof, event_kind: "cloud_chat_completed",
          request_id: `chat-complete-${requestId}`, payload: { session_id: sessionId, request_id: requestId } }, scope);
      } catch {
        if (journal.status !== "final") await client.operation("sessions", { action: "fail", session_id: sessionId,
          request_id: requestId, runtime: proof, uncertain: true, error_code: "executor_interrupted" }, scope).catch(() => {});
      } finally {
        if (renewal) clearTimeout(renewal);
        controller.signal.removeEventListener("abort", abort);
      }
    } catch {
      try { await client.assertScope(scope); } catch { stop(); }
      proof = null;
    } finally {
      busy = false;
      if (!controller.signal.aborted) {
        timer = setTimeout(() => { void tick(); }, dependencies.intervalMs ?? 3000);
        timer.unref?.();
      }
    }
  };
  void tick();
}

export function stopCloudChatWorkers(): void {
  for (const worker of workers.values()) worker.stop();
}
