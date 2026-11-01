#!/usr/bin/env node
import assert from "node:assert/strict";
import crypto from "node:crypto";
import fs from "node:fs";
import http from "node:http";
import os from "node:os";
import path from "node:path";
import { createJiti } from "jiti";

assert.ok(process.env.EDUPI_CORE_ROOT && path.isAbsolute(process.env.EDUPI_CORE_ROOT), "exact Core root required");
const coreRoot = fs.realpathSync(process.env.EDUPI_CORE_ROOT);
const root = fs.mkdtempSync(path.join(os.tmpdir(), "edupi-workflow-core-first-"));
const dataRoot = path.join(root, "data"), stateDir = path.join(root, "state"), agentDir = path.join(root, "agent");
for (const directory of [dataRoot, stateDir, agentDir]) fs.mkdirSync(directory, { mode: 0o700 });
const token = crypto.randomBytes(32).toString("hex");
const environment = {
  EDUPI_PROJECT_ROOT: dataRoot, EDUPI_DATA_ROOT: dataRoot, EDUPI_DATA_ALLOWED_ROOT: root,
  EDUPI_CORE_ROOT: coreRoot, EDUPI_CORE_ALLOWED_ROOT: path.dirname(coreRoot),
  PI_DESKTOP_STATE_DIR: stateDir, PI_CODING_AGENT_DIR: agentDir, PI_DESKTOP_API_TOKEN: token,
  PI_OFFLINE: "1", EDUPI_DESKTOP_ISOLATED_CANARY: "1",
};
const prior = new Map(Object.keys(environment).map(key => [key, process.env[key]]));
Object.assign(process.env, environment);
const plan = { title: "合成捕获工作流", phases: [{ name: "读取", agents: [{ name: "核对员", task: "只回复合成子任务完成" }] }] };
const responseChunk = (id, delta, finishReason) => `data: ${JSON.stringify({ id, object: "chat.completion.chunk", model: "local",
  choices: [{ index: 0, delta, finish_reason: finishReason }] })}\n\n`;
let parentCalls = 0, childCalls = 0, confirms = 0, serverRequests = 0;
const server = http.createServer(async (request, response) => {
  if (request.url !== "/v1/chat/completions") { response.writeHead(404); response.end(); return; }
  let raw = "";
  for await (const chunk of request) raw += chunk;
  const body = JSON.parse(raw), id = `synthetic-workflow-${++serverRequests}`;
  const hasWorkflowTool = body.tools?.some(item => item.function?.name === "edupi_workflow");
  const isChild = !hasWorkflowTool;
  if (isChild) childCalls++; else parentCalls++;
  const hasToolResult = body.messages?.some(item => item.role === "tool");
  const toolCall = hasWorkflowTool && !hasToolResult ? { id: "synthetic-workflow-tool", type: "function",
    function: { name: "edupi_workflow", arguments: JSON.stringify(plan) } } : null;
  const content = isChild ? "合成子任务完成" : "合成父会话完成";
  response.writeHead(200, { "Content-Type": "text/event-stream", "Cache-Control": "no-cache" });
  response.write(responseChunk(id, toolCall ? { role: "assistant", tool_calls: [{ index: 0, ...toolCall }] }
    : { role: "assistant", content }, null));
  response.end(responseChunk(id, {}, toolCall ? "tool_calls" : "stop") + "data: [DONE]\n\n");
});
await new Promise((resolve, reject) => { server.once("error", reject); server.listen(0, "127.0.0.1", resolve); });
fs.writeFileSync(path.join(agentDir, "models.json"), JSON.stringify({ providers: { local: { api: "openai-completions",
  apiKey: "synthetic-local-placeholder", baseUrl: `http://127.0.0.1:${server.address().port}/v1`,
  models: [{ id: "local", name: "Synthetic local", input: ["text"], reasoning: false,
    cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 }, contextWindow: 32000, maxTokens: 2048 }] } } }), { mode: 0o600 });
fs.writeFileSync(path.join(agentDir, "settings.json"), JSON.stringify({ defaultProvider: "local", defaultModel: "local",
  extensions: [], packages: [], skills: [], cacheWarming: "off" }), { mode: 0o600 });
const originalFetch = globalThis.fetch;
globalThis.fetch = (input, options) => {
  const url = new URL(typeof input === "string" || input instanceof URL ? input : input.url);
  assert.ok(["127.0.0.1", "localhost"].includes(url.hostname), "synthetic test forbids external requests");
  return originalFetch(input, options);
};

let session, unauthorizedChild, deadline;
try {
  const jiti = createJiti(import.meta.url, { tsconfigPaths: true });
  const { writeEduPiProactivityConfig } = await jiti.import("../lib/edupi-proactivity-config.ts");
  const { eduPiDirectPromptGate } = await jiti.import("../lib/edupi-direct-prompt-gate.ts");
  const { startHarnessSession } = await jiti.import("../lib/harness/runtime.ts");
  const { readDynamicWorkflowRun, workflowChildSessionDir } = await jiti.import("../lib/edupi-dynamic-workflow.ts");
  writeEduPiProactivityConfig({ enabled: true, scope: { classId: "synthetic-class", subject: "math" },
    grantId: "synthetic-grant" }, { stateDir, dataRoot, domain: "teaching_preparation" });
  assert.equal(eduPiDirectPromptGate(), "core_first_required");
  ({ session } = await startHarnessSession(`workflow-parent-${crypto.randomUUID()}`, "", dataRoot,
    { toolNames: ["read", "edupi_workflow"], initialModel: { provider: "local", modelId: "local" } }));
  await session.waitUntilReady();
  const active = (await session.send({ type: "get_tools" })).filter(item => item.active).map(item => item.name);
  assert.ok(active.includes("edupi_workflow"));
  const settled = new Promise((resolve, reject) => {
    const unsubscribe = session.onEvent(event => {
      if (event.type === "extension_ui_request" && event.method === "confirm") {
        confirms++;
        queueMicrotask(() => { void session.send({ type: "extension_ui_response", id: event.id, confirmed: true }); });
      }
      if (event.type === "prompt_error") { unsubscribe(); reject(new Error("parent_prompt_error")); }
      if (event.type === "prompt_done") { unsubscribe(); resolve(); }
    });
    deadline = setTimeout(() => { unsubscribe(); reject(new Error("workflow_core_first_timeout")); }, 45_000);
  });
  await session.sendCoreCapturedPrompt({ type: "prompt", message: "请运行合成工作流", clientRequestId: "synthetic-captured-workflow" });
  await settled;
  const run = readDynamicWorkflowRun(session.sessionId);
  assert.equal(run?.status, "done");
  assert.equal(run?.phases[0].agents[0].status, "done");
  assert.equal(confirms, 1);
  assert.equal(childCalls, 1);
  assert.equal(parentCalls, 2);
  assert.equal(fs.readdirSync(workflowChildSessionDir()).filter(name => name.endsWith(".jsonl")).length, 1);
  ({ session: unauthorizedChild } = await startHarnessSession(`workflow-denied-${crypto.randomUUID()}`, "", dataRoot, {
    toolNames: ["read", "find", "grep", "ls"], strictToolNames: true,
    isolatedSessionDir: workflowChildSessionDir(),
    workflowParent: { sessionId: session.sessionId, sourceEntryId: run.sourceEntryId },
    initialModel: { provider: "local", modelId: "local" },
  }));
  await unauthorizedChild.waitUntilReady();
  await assert.rejects(unauthorizedChild.send({ type: "prompt", message: "未授权直接消息" }), /core_first_required/);
  await assert.rejects(unauthorizedChild.sendWorkflowChildPrompt({ type: "prompt", message: "父回合已结束" }), /core_first_required/);
  console.log(JSON.stringify({ status: "passed", coreFirstGate: true, capturedParent: true,
    syntheticConfirmation: true, childCalls, parentCalls, privateChild: true, expiredParentDenied: true,
    parentFetchLoopbackOnly: true }));
} finally {
  if (deadline) clearTimeout(deadline);
  unauthorizedChild?.destroy();
  session?.destroy();
  globalThis.fetch = originalFetch;
  server.closeAllConnections();
  await new Promise(resolve => server.close(resolve));
  for (const [key, value] of prior) { if (value === undefined) delete process.env[key]; else process.env[key] = value; }
  fs.rmSync(root, { recursive: true, force: true });
}
