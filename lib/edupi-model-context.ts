import { AsyncLocalStorage } from "node:async_hooks";
import { completeSimple } from "@earendil-works/pi-ai/compat";
import type { ModelRuntime } from "@earendil-works/pi-coding-agent";
import type { AgentSessionLike } from "./pi-types";

type Request = { messages: Array<{ role: string; content: unknown }>; temperature?: number; maxTokens?: number };
const shared = globalThis as typeof globalThis & {
  __edupiModelContext?: AsyncLocalStorage<AgentSessionLike>;
  __edupiModelBridge?: { available: () => boolean; complete: (request: Request) => Promise<string> };
};
const context = shared.__edupiModelContext ||= new AsyncLocalStorage<AgentSessionLike>();
shared.__edupiModelBridge = {
  available: () => Boolean(context.getStore()?.model),
  complete: async (request) => {
    const session = context.getStore();
    if (!session?.model) throw new Error("当前会话没有可用模型");
    const model = session.model as unknown as Parameters<typeof completeSimple>[0];
    const runtime = session.modelRuntime as unknown as ModelRuntime;
    const auth = await runtime.getAuth(model);
    if (!auth?.auth.apiKey) throw new Error("当前模型尚未配置凭据");
    const content: Array<{ type: "text"; text: string } | { type: "image"; data: string; mimeType: string }> = [];
    const systemPrompt = request.messages.filter(message => message.role === "system" && typeof message.content === "string").map(message => message.content).join("\n\n");
    for (const message of request.messages) {
      if (message.role === "system") continue;
      if (typeof message.content === "string") content.push({ type: "text", text: `${message.role}: ${message.content}` });
      else if (Array.isArray(message.content)) for (const block of message.content) {
        if (block.type === "text") content.push({ type: "text", text: String(block.text) });
        if (block.type === "image_url") {
          const match = /^data:([^;]+);base64,([\s\S]+)$/.exec(block.image_url?.url || "");
          if (match) content.push({ type: "image", mimeType: match[1], data: match[2] });
        }
      }
    }
    const result = await completeSimple(model, { systemPrompt, messages: [{ role: "user", content, timestamp: Date.now() }] }, { apiKey: auth.auth.apiKey, headers: auth.auth.headers, temperature: request.temperature, maxTokens: request.maxTokens || 3000, timeoutMs: 30000, maxRetries: 0 });
    if (result.stopReason === "error" || result.stopReason === "aborted") throw new Error(result.errorMessage || "模型调用失败");
    return result.content.filter(block => block.type === "text").map(block => block.text).join("\n");
  },
};

export function withEducationModel<T>(session: AgentSessionLike, run: () => T): T {
  return context.run(session, run);
}
