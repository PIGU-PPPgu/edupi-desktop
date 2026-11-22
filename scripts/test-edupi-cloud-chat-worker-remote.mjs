import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import http from "node:http";
import { randomUUID } from "node:crypto";
import { createJiti } from "jiti";
import { cleanupCloudTest } from "./cleanup-edupi-cloud-test.mjs";

const url = process.env.SUPABASE_URL || "https://edupi.intelliclass.online";
const anon = process.env.SUPABASE_ANON_KEY;
if (!anon) throw new Error("SUPABASE_ANON_KEY must be injected securely");
const suffix = randomUUID();
const email = `cloud-worker-${suffix}@example.invalid`;
const password = `${randomUUID()}Aa!`;
const stateDir = fs.mkdtempSync(path.join(os.tmpdir(), "edupi-cloud-worker-"));
const agentDir = fs.mkdtempSync(path.join(os.tmpdir(), "edupi-cloud-worker-agent-"));
const cwd = fs.mkdtempSync(path.join(os.tmpdir(), "edupi-cloud-worker-cwd-"));
let userId;
let workspaceId;
let server;
let worker;
let stopWorkers;
const pass = label => console.log(`PASS ${label}`);
async function call(pathname, body, token, workspace = workspaceId) {
  const response = await fetch(`${url}${pathname}`, {
    method: "POST",
    headers: {
      apikey: anon, Authorization: `Bearer ${token || ""}`, "content-type": "application/json",
      ...(workspace ? { "x-edupi-workspace-id": workspace } : {}),
    },
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(20_000),
  });
  return { status: response.status, data: await response.json().catch(() => ({})) };
}
try {
  server = http.createServer((request, response) => {
    if (request.url !== "/v1/chat/completions") {
      response.writeHead(404).end();
      return;
    }
    response.writeHead(200, { "content-type": "text/event-stream" });
    const chunk = value => `data: ${JSON.stringify({
      id: "synthetic", object: "chat.completion.chunk", created: 1, model: "local",
      choices: [{ index: 0, delta: value, finish_reason: null }],
    })}\n\n`;
    response.write(chunk({ role: "assistant", content: "合成云端回读" }));
    response.write(`data: ${JSON.stringify({
      id: "synthetic", object: "chat.completion.chunk", created: 1, model: "local",
      choices: [{ index: 0, delta: {}, finish_reason: "stop" }],
    })}\n\n`);
    response.end("data: [DONE]\n\n");
  });
  await new Promise(resolve => server.listen(0, "127.0.0.1", resolve));
  const port = server.address().port;
  fs.writeFileSync(path.join(agentDir, "settings.json"), JSON.stringify({
    defaultProvider: "local", defaultModel: "local", defaultThinkingLevel: "off",
  }));
  fs.writeFileSync(path.join(agentDir, "auth.json"), JSON.stringify({
    local: { type: "api_key", key: "synthetic-local-key" },
  }));
  fs.writeFileSync(path.join(agentDir, "models.json"), JSON.stringify({
    providers: {
      local: {
        baseUrl: `http://127.0.0.1:${port}/v1`, api: "openai-completions",
        models: [{
          id: "local", name: "local", reasoning: false, input: ["text"],
          cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
          contextWindow: 32_000, maxTokens: 128,
        }],
      },
    },
  }));
  process.env.PI_CODING_AGENT_DIR = agentDir;
  process.env.PI_DESKTOP_STATE_DIR = stateDir;
  const { createEduPiCloudClient } = await createJiti(import.meta.url, { tsconfigPaths: true })
    .import("../lib/edupi-cloud-client.ts");
  const { ensureCloudChatWorker, stopCloudChatWorkers } = await createJiti(import.meta.url, { tsconfigPaths: true })
    .import("../lib/edupi-cloud-chat-worker.ts");
  stopWorkers = stopCloudChatWorkers;
  const signup = await call("/auth/v1/signup", { email, password }, null, null);
  assert.equal(signup.status, 200, JSON.stringify(signup.data));
  userId = signup.data.user.id;
  const provision = await call("/functions/v1/edupi-account", {
    action: "create_workspace", mode: "cloud", request_id: `worker-provision-${suffix}`,
  }, signup.data.access_token, null);
  assert.equal(provision.status, 201, JSON.stringify(provision.data));
  workspaceId = provision.data.workspace_id;
  const env = {
    SUPABASE_URL: url, SUPABASE_ANON_KEY: anon, PI_DESKTOP_STATE_DIR: stateDir,
  };
  const client = createEduPiCloudClient({ env });
  await client.login(email, password);
  await client.selectWorkspace(workspaceId);
  const scope = await client.captureScope();
  const sessionId = `worker-${suffix}`;
  const created = await client.operationWithOutbox("sessions", {
    action: "create", session_id: sessionId, request_id: `create-${suffix}`,
    title: "合成云端执行", model: { provider: "local", modelId: "local" }, thinking_level: "off",
  }, scope);
  assert.equal(created.queued, false, JSON.stringify(created));
  const requestId = `prompt-${suffix}`;
  const queued = await client.operationWithOutbox("sessions", {
    action: "enqueue", session_id: sessionId, request_id: requestId,
    command: { type: "mobile_prompt", message: "只返回合成结果", clientRequestId: requestId },
  }, scope);
  assert.equal(queued.queued, false, JSON.stringify(queued));
  pass("desktop-cloud-chat-created-and-queued");
  worker = ensureCloudChatWorker(client, scope, { intervalMs: 250 });
  const deadline = Date.now() + 60_000;
  let final;
  while (Date.now() < deadline) {
    const read = await client.operation("sessions", { action: "read", session_id: sessionId }, scope);
    const requests = Array.isArray(read.requests) ? read.requests : [];
    const messages = Array.isArray(read.messages) ? read.messages : [];
    const current = requests.find(row => row.request_id === requestId);
    const assistant = messages.find(row => row.role === "assistant" || row.message?.role === "assistant");
    if (current?.status === "completed" && assistant) {
      final = assistant;
      break;
    }
    await new Promise(resolve => setTimeout(resolve, 500));
  }
  assert.ok(final, "cloud worker did not complete a synthetic local-model request");
  const message = final.message || final;
  assert.equal(message.content?.[0]?.text, "合成云端回读", JSON.stringify(message));
  pass("desktop-cloud-chat-local-core-executor-and-readback");
  stopWorkers();
} finally {
  if (worker?.stop) worker.stop();
  stopWorkers?.();
  if (server) await new Promise(resolve => server.close(resolve));
  fs.rmSync(stateDir, { recursive: true, force: true });
  fs.rmSync(agentDir, { recursive: true, force: true });
  fs.rmSync(cwd, { recursive: true, force: true });
  if (userId) cleanupCloudTest(userId, workspaceId);
}
