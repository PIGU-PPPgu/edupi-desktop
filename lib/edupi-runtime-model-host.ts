import type { ChildProcess } from "node:child_process";
import path from "node:path";
import { existsSync } from "node:fs";
import { pathToFileURL } from "node:url";
import { getAgentDir, ModelRuntime, SettingsManager } from "@earendil-works/pi-coding-agent";

type LiveRequest = Record<string, unknown>;
type LiveResult = Record<string, unknown>;
type ModelHost = { run(request: LiveRequest, options: { signal: AbortSignal }): Promise<LiveResult>; close(): Promise<void> };

export function createRuntimeModelHost({ coreRoot, projectRoot, agentDir = getAgentDir(), allowLoopback = false }: { coreRoot: string; projectRoot: string; agentDir?: string; allowLoopback?: boolean }): ModelHost {
  const packagedAdapter = path.join(process.cwd(), "scripts/core_runtime_model_adapter.mjs");
  const adapterFile = existsSync(packagedAdapter) ? packagedAdapter : path.join(coreRoot, "scripts/core_runtime_model_adapter.mjs");
  const running = new Map<AbortController, Promise<LiveResult>>();
  let closed = false;
  return {
    run(value, { signal }) {
      const controller = new AbortController();
      const cancel = () => controller.abort();
      signal.addEventListener("abort", cancel, { once: true });
      if (closed || signal.aborted) controller.abort();
      const operation = (async () => {
        const { buildG1LiveRequest, createIsolatedG1ModelAdapter } = await import(/* webpackIgnore: true */ pathToFileURL(adapterFile).href);
        const { materials, ...lease } = value;
        const request = buildG1LiveRequest({ lease, materials });
        const binding = { ...request };
        delete binding.input;
        delete binding.materials;
        const failure = (error_code: string) => ({ ...binding, ok: false, error_code, retryable: error_code === "model_unavailable", output: null, external_send: false });
        if (controller.signal.aborted) return failure("cancelled");
        try {
          const settings = SettingsManager.create(projectRoot, agentDir);
          const runtime = await ModelRuntime.create({ authPath: path.join(agentDir, "auth.json"), modelsPath: path.join(agentDir, "models.json"), signal: controller.signal });
          const provider = settings.getDefaultProvider();
          const id = settings.getDefaultModel();
          const model = provider && id ? runtime.getModel(provider, id) : undefined;
          if (!model) return failure("model_unavailable");
          const auth = await runtime.getAuth(model, { signal: controller.signal });
          const compatibility = runtime.getCompatibilityRequestConfig(model);
          // The isolated SDK accepts apiKey/baseUrl, but not resolved auth headers.
          if (!auth?.auth.apiKey || Object.keys(auth.auth.headers || {}).length || Object.keys(compatibility.headers || {}).length || runtime.isUsingOAuth(model.provider)) return failure("model_unavailable");
          if (controller.signal.aborted) return failure("cancelled");
          const adapter = createIsolatedG1ModelAdapter({ model: { ...model, ...(auth.auth.baseUrl ? { baseUrl: auth.auth.baseUrl } : {}) }, apiKey: auth.auth.apiKey, maxTokens: Math.min(model.maxTokens || 4096, 8192), timeoutMs: 300000, maxCalls: 1, allowLoopback });
          return await adapter.run(request, { signal: controller.signal });
        } catch { return failure(controller.signal.aborted ? "cancelled" : "model_unavailable"); }
      })().finally(() => { signal.removeEventListener("abort", cancel); running.delete(controller); });
      running.set(controller, operation);
      return operation;
    },
    async close() { closed = true; for (const controller of running.keys()) controller.abort(); await Promise.allSettled(running.values()); },
  };
}

export function attachRuntimeModelHost(child: ChildProcess, host: ModelHost) {
  const pending = new Map<string, AbortController>();
  let closed = false;
  let closing: Promise<void> | undefined;
  const close = () => {
    if (closing) return closing;
    closed = true;
    child.off("message", message);
    for (const controller of pending.values()) controller.abort();
    closing = host.close().finally(() => pending.clear());
    return closing;
  };
  const message = (value: unknown) => {
    if (closed || !value || typeof value !== "object") return;
    const data = value as { type?: string; id?: string; request?: LiveRequest };
    if (typeof data.id !== "string" || !/^[a-zA-Z0-9-]{1,100}$/.test(data.id)) return;
    if (data.type === "model-cancel") { pending.get(data.id)?.abort(); return; }
    if (data.type !== "model-run" || !data.request || pending.has(data.id)) return;
    if (pending.size >= 2) { if (child.connected) child.send({ type: "model-error", id: data.id, code: "model_unavailable" }, () => {}); return; }
    const id = data.id;
    const controller = new AbortController();
    pending.set(id, controller);
    void host.run(data.request, { signal: controller.signal }).then(result => {
      if (!closed && child.connected) child.send({ type: "model-result", id, result }, () => {});
    }, () => {
      if (!closed && child.connected) child.send({ type: "model-error", id, code: "model_unavailable" }, () => {});
    }).finally(() => pending.delete(id));
  };
  child.on("message", message);
  child.once("disconnect", () => { void close(); });
  child.once("exit", () => { void close(); });
  return { close };
}
