import type { ChildProcess } from "node:child_process";
import path from "node:path";
import { existsSync } from "node:fs";
import { createHash } from "node:crypto";
import { isDeepStrictEqual } from "node:util";
import { pathToFileURL } from "node:url";
import { getAgentDir, ModelRuntime, SettingsManager } from "@earendil-works/pi-coding-agent";
import { readRuntimeModelConfiguration, type PrivateRuntimeModelConfiguration } from "./edupi-runtime-model-config";
import { isTeachingModelIneligible } from "./model-setup-presets";
import { boundedPrivateData, privateDataKeys, validatePrivateModelConfiguration, RECALL_MODEL_MAX_CALLS, RECALL_MODEL_TIMEOUT_MS } from "../desktop/core-runtime-model-config.mjs";
import { readEduPiRecallActivation } from "./edupi-recall-config";
import { markRecallModelAttempt, reserveRecallModelAttempt } from "./edupi-recall-authorization";
import { claimEduPiRecallQuestion, clearEduPiRecallQuestions, settleEduPiRecallModel } from "./edupi-recall-state";

// Keep attempts and unfinished work across child restarts and server reloads.
// Only counters/model identity live here; no prompt bodies or judgments are cached.
const recallGlobals = globalThis as typeof globalThis & { __edupiRecallModelBudgets?: Map<string, { calls: number; active: boolean }> };
const recallBudgets = recallGlobals.__edupiRecallModelBudgets ||= new Map<string, { calls: number; active: boolean }>();

type LiveRequest = Record<string, unknown>;
type LiveResult = Record<string, unknown>;
type ModelHost = { run(request: LiveRequest, options: { signal: AbortSignal; requestId?: string }): Promise<LiveResult>;
  configuration?(options: { signal: AbortSignal }): Promise<PrivateRuntimeModelConfiguration>; close(): Promise<void> };

export function createRuntimeModelHost({ coreRoot, projectRoot, agentDir = getAgentDir(), allowLoopback = false }: { coreRoot: string; projectRoot: string; agentDir?: string; allowLoopback?: boolean }): ModelHost {
  const packagedAdapter = path.join(process.cwd(), "scripts/core_runtime_model_adapter.mjs");
  const adapterFile = existsSync(packagedAdapter) ? packagedAdapter : path.join(coreRoot, "scripts/core_runtime_model_adapter.mjs");
  const running = new Map<AbortController, Promise<unknown>>();
  let closed = false;
  return {
    configuration({ signal }) {
      const controller = new AbortController();
      let rejectCancelled: (reason: Error) => void;
      const cancelled = new Promise<never>((_resolve, reject) => { rejectCancelled = reject; });
      const cancel = () => { controller.abort(); rejectCancelled(Object.assign(new Error("Model host unavailable."), { code: "model_unavailable" })); };
      signal.addEventListener("abort", cancel, { once: true });
      if (closed || signal.aborted) cancel();
      const operation = Promise.race([cancelled, readRuntimeModelConfiguration({ projectRoot, agentDir, signal: controller.signal, allowLoopback })])
        .finally(() => { signal.removeEventListener("abort", cancel); running.delete(controller); });
      controller.signal.addEventListener("abort", () => rejectCancelled(Object.assign(new Error("Model host unavailable."), { code: "model_unavailable" })), { once: true });
      running.set(controller, operation);
      return operation;
    },
    run(value, { signal, requestId }) {
      const controller = new AbortController();
      const cancel = () => controller.abort();
      signal.addEventListener("abort", cancel, { once: true });
      if (closed || signal.aborted) controller.abort();
      const operation = (async () => {
        const g2 = value.model_kind === "student_followup";
        const answer = value.model_kind === "recall_answer";
        const recall = value.model_kind === "memory_recall" || answer;
        if (Object.hasOwn(value, "model_kind") && !g2 && !recall) throw Object.assign(new Error("Invalid model request."), { code: "invalid_model_request" });
        let request: LiveRequest;
        if (g2 || recall) {
          const deadline = typeof value.deadline_at === "string" ? Date.parse(value.deadline_at) : NaN;
          if (Object.keys(value).sort().join(",") !== "deadline_at,model_kind,prompt"
            || typeof value.prompt !== "string" || !value.prompt.trim() || Buffer.byteLength(value.prompt) > 70000
            || !Number.isFinite(deadline) || deadline <= Date.now() || deadline > Date.now() + (recall ? RECALL_MODEL_TIMEOUT_MS + 1000 : 125000)) {
            throw Object.assign(new Error("Invalid model request."), { code: "invalid_model_request" });
          }
          request = value;
        } else {
          const { buildG1LiveRequest } = await import(/* webpackIgnore: true */ pathToFileURL(adapterFile).href);
          const { materials, ...lease } = value;
          request = buildG1LiveRequest({ lease, materials });
        }
        const binding = { ...request };
        delete binding.input;
        delete binding.materials;
        const failure = (error_code: string): LiveResult => {
          if (g2 || recall) throw Object.assign(new Error("Model host unavailable."), { code: error_code });
          return { ...binding, ok: false, error_code, retryable: error_code === "model_unavailable", output: null, external_send: false };
        };
        if (controller.signal.aborted) return failure("cancelled");
        try {
          if (recall) {
            const activation = answer ? readEduPiRecallActivation({ dataRoot: projectRoot }) : null;
            if (answer && !activation?.enabled) return failure("model_unavailable");
            const marker = "UNTRUSTED_INPUT_JSON:\n";
            let normalQuestion: ReturnType<typeof claimEduPiRecallQuestion> = null;
            let normalQueryHash: string | null = null;
            if (answer && activation?.mode === "normal") {
              const prompt = String(request.prompt);
              const index = prompt.indexOf(marker);
              if (!requestId || !prompt.startsWith("Select exactly one current case") || index < 0) return failure("model_unavailable");
              let query: unknown;
              try { query = JSON.parse(prompt.slice(index + marker.length)).query; } catch { return failure("model_unavailable"); }
              if (typeof query !== "string") return failure("model_unavailable");
              normalQueryHash = `sha256:${createHash("sha256").update(query).digest("hex")}`;
              normalQuestion = claimEduPiRecallQuestion(path.resolve(projectRoot), normalQueryHash, requestId);
              if (!normalQuestion) return failure("model_unavailable");
            }
            try {
              const configuration = await readRuntimeModelConfiguration({ projectRoot, agentDir, signal: controller.signal, allowLoopback });
              const remaining = Date.parse(String(request.deadline_at)) - Date.now();
              if (controller.signal.aborted || remaining <= 0) return failure("cancelled");
              const key = JSON.stringify([path.resolve(projectRoot), configuration.model.provider, configuration.model.id]);
              let budget = recallBudgets.get(key);
              if (!budget) { budget = { calls: 0, active: false }; recallBudgets.set(key, budget); }
              if (budget.active || budget.calls >= RECALL_MODEL_MAX_CALLS) return failure("model_unavailable");
              const { createIsolatedG1ModelRunner } = await import(/* webpackIgnore: true */ pathToFileURL(path.join(path.dirname(adapterFile), "core_runtime_isolated_model.mjs")).href);
              if (controller.signal.aborted) return failure("cancelled");
              if (budget.active || budget.calls >= RECALL_MODEL_MAX_CALLS) return failure("model_unavailable");
              const runner = createIsolatedG1ModelRunner({ ...configuration, maxCalls: 1, temperature: 0,
                maxTokens: Math.min(configuration.maxTokens, 4096),
                timeoutMs: Math.max(1, Math.min(RECALL_MODEL_TIMEOUT_MS, Date.parse(String(request.deadline_at)) - Date.now())) });
              // Hold the in-process completion slot during the durable reserve.
              // It is a concurrency bound; the ledger is the authorization.
              budget.active = true;
              try {
                if (normalQuestion) {
                  const permit = await reserveRecallModelAttempt({
                    requestId: requestId!, intentId: normalQuestion.intentId, model: {
                      provider: String(configuration.model.provider), id: String(configuration.model.id),
                    }, purpose: "r04_recall_answer", queryHash: normalQueryHash!,
                  }, { dataRoot: projectRoot });
                  if (!permit.permitted) return failure("model_unavailable");
                }
                if (controller.signal.aborted || Date.parse(String(request.deadline_at)) <= Date.now()) return failure("cancelled");
                if (answer) {
                  const latest = readEduPiRecallActivation({ dataRoot: projectRoot });
                  if (!latest.enabled || latest.mode !== activation?.mode
                    || !isDeepStrictEqual(latest.config, activation.config)) return failure("model_unavailable");
                }
                budget.calls++;
                const result = await runner({ prompt: request.prompt, signal: controller.signal });
                if (normalQuestion) await markRecallModelAttempt({ requestId: requestId!, status: "used" }, { dataRoot: projectRoot });
                return { output: result.output };
              } finally {
                try { await runner.waitForIdle(); } finally { budget.active = false; }
              }
            } finally {
              if (normalQuestion && requestId) settleEduPiRecallModel(normalQuestion.token, requestId);
            }
          }
          const settings = SettingsManager.create(projectRoot, agentDir);
          const runtime = await ModelRuntime.create({ authPath: path.join(agentDir, "auth.json"), modelsPath: path.join(agentDir, "models.json"), signal: controller.signal });
          const provider = settings.getDefaultProvider();
          const id = settings.getDefaultModel();
          if (provider && isTeachingModelIneligible(provider)) return failure("model_unavailable");
          const model = provider && id ? runtime.getModel(provider, id) : undefined;
          if (!model) return failure("model_unavailable");
          if (isTeachingModelIneligible(model.provider, model.baseUrl)) return failure("model_unavailable");
          const auth = await runtime.getAuth(model, { signal: controller.signal });
          const compatibility = runtime.getCompatibilityRequestConfig(model);
          // The isolated SDK accepts apiKey/baseUrl, but not resolved auth headers.
          if (!auth?.auth.apiKey || Object.keys(auth.auth.headers || {}).length || Object.keys(compatibility.headers || {}).length || runtime.isUsingOAuth(model.provider)) return failure("model_unavailable");
          if (controller.signal.aborted) return failure("cancelled");
          const endpoint = new URL(auth.auth.baseUrl || model.baseUrl);
          if (isTeachingModelIneligible(model.provider, endpoint.href)) return failure("model_unavailable");
          const configuredLoopback = endpoint.protocol === "http:" && ["localhost", "127.0.0.1", "::1", "[::1]"].includes(endpoint.hostname);
          if (configuredLoopback) endpoint.hostname = "127.0.0.1";
          const configuration = { model: { ...model, baseUrl: endpoint.href }, apiKey: auth.auth.apiKey,
            maxTokens: Math.min(model.maxTokens || 4096, 8192), maxCalls: 1, allowLoopback: allowLoopback || configuredLoopback };
          if (g2) {
            const remaining = Date.parse(String(request.deadline_at)) - Date.now();
            if (remaining <= 0) return failure("deadline_exceeded");
            const { createIsolatedG1ModelRunner } = await import(/* webpackIgnore: true */ pathToFileURL(path.join(path.dirname(adapterFile), "core_runtime_isolated_model.mjs")).href);
            const runner = createIsolatedG1ModelRunner({ ...configuration, timeoutMs: Math.min(120000, remaining) });
            const result = await runner({ prompt: request.prompt, signal: controller.signal });
            return { output: result.output };
          }
          const { createIsolatedG1ModelAdapter } = await import(/* webpackIgnore: true */ pathToFileURL(adapterFile).href);
          const adapter = createIsolatedG1ModelAdapter({ ...configuration, timeoutMs: 300000 });
          return await adapter.run(request, { signal: controller.signal });
        } catch { return failure(controller.signal.aborted ? "cancelled" : "model_unavailable"); }
      })().finally(() => { signal.removeEventListener("abort", cancel); running.delete(controller); });
      running.set(controller, operation);
      return operation;
    },
    async close() {
      closed = true;
      for (const controller of running.keys()) controller.abort();
      await Promise.allSettled(running.values());
      clearEduPiRecallQuestions(path.resolve(projectRoot));
    },
  };
}

export function attachRuntimeModelHost(child: ChildProcess, host: ModelHost) {
  const pending = new Map<string, { controller: AbortController; configuration: boolean }>();
  const seenConfigurations = new Set<string>();
  let closed = false;
  let closing: Promise<void> | undefined;
  const close = () => {
    if (closing) return closing;
    closed = true;
    child.off("message", message);
    for (const item of pending.values()) item.controller.abort();
    closing = host.close().finally(() => pending.clear());
    return closing;
  };
  const message = (value: unknown) => {
    if (closed || !value || typeof value !== "object") return;
    const data = value as { type?: string; id?: string; request?: LiveRequest };
    if (typeof data.id !== "string" || !/^[a-zA-Z0-9-]{1,100}$/.test(data.id)) return;
    if (data.type === "model-cancel" || data.type === "model-config-cancel") {
      if (!privateDataKeys(data, ["type", "id"])) return;
      const item = pending.get(data.id);
      if (item && item.configuration === (data.type === "model-config-cancel")) item.controller.abort();
      return;
    }
    const configuration = data.type === "model-config-request";
    if (!configuration && data.type !== "model-run") return;
    if (!privateDataKeys(data, configuration ? ["type", "id"] : ["type", "id", "request"])
      || !boundedPrivateData(data, configuration ? 1024 : 100_256) || !configuration && !data.request || pending.has(data.id)) return;
    const errorType = configuration ? "model-config-error" : "model-error";
    const fail = () => { if (!closed && child.connected) child.send({ type: errorType, id: data.id, code: "model_unavailable" }, () => {}); };
    if (pending.size >= 2 || configuration && (seenConfigurations.has(data.id) || seenConfigurations.size >= 32 || !host.configuration)) { fail(); return; }
    const id = data.id;
    const controller = new AbortController();
    if (configuration) seenConfigurations.add(id);
    pending.set(id, { controller, configuration });
    let operation: Promise<unknown>;
    try { operation = configuration ? host.configuration!({ signal: controller.signal }) : host.run(data.request!, { signal: controller.signal, requestId: id }); }
    catch { pending.delete(id); fail(); return; }
    void operation.then(result => {
      if (closed || !child.connected || controller.signal.aborted) return;
      try {
        if (configuration) child.send({ type: "model-config-result", id, configuration: validatePrivateModelConfiguration(result) }, () => {});
        else if (boundedPrivateData(result, 2 * 1024 * 1024 + 4096)) child.send({ type: "model-result", id, result }, () => {});
        else fail();
      } catch { fail(); }
    }, fail).finally(() => pending.delete(id));
  };
  child.on("message", message);
  child.once("disconnect", () => { void close(); });
  child.once("exit", () => { void close(); });
  return { close };
}
