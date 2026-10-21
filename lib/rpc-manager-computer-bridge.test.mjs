import assert from "node:assert/strict";
import fs from "node:fs";
import http from "node:http";
import os from "node:os";
import path from "node:path";
import { randomUUID } from "node:crypto";
import test from "node:test";
import { SessionManager } from "@earendil-works/pi-coding-agent";
import { createJiti } from "jiti";

function deferred() {
  let resolve;
  const promise = new Promise(done => { resolve = done; });
  return { promise, resolve };
}

async function within(promise, label) {
  let timer;
  try {
    return await Promise.race([promise, new Promise((_, reject) => {
      timer = setTimeout(() => reject(new Error(`${label} timed out`)), 5_000);
    })]);
  } finally { clearTimeout(timer); }
}

async function fixture(t) {
  const root = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), "edupi-computer-bridge-")));
  const agentDir = path.join(root, "agent"), dataRoot = path.join(root, "teacher"), coreRoot = path.join(root, "empty-core");
  for (const directory of [agentDir, dataRoot, path.join(coreRoot, "contracts"), path.join(root, "state")]) {
    fs.mkdirSync(directory, { recursive: true });
  }
  fs.writeFileSync(path.join(coreRoot, "contracts/edupi-desktop-component-manifest.json"), JSON.stringify({ modules: [], assets: [] }));
  fs.writeFileSync(path.join(agentDir, "settings.json"), JSON.stringify({
    compaction: { enabled: false }, retry: { enabled: false }, cacheWarming: "off",
  }));
  const environment = {
    PI_CODING_AGENT_DIR: agentDir, PI_OFFLINE: "1", PI_DESKTOP_API_TOKEN: "", EDUPI_SAFE_MODE: "1",
    EDUPI_DATA_ROOT: dataRoot, EDUPI_DATA_ALLOWED_ROOT: root,
    EDUPI_CORE_ROOT: coreRoot, EDUPI_CORE_ALLOWED_ROOT: root,
    EDUPI_PROJECT_ROOT: dataRoot, EDUPI_HOME: path.join(dataRoot, ".edupi"),
    EDUPI_MEMORY_DIR: path.join(dataRoot, ".edupi/memory"), EDUPI_OUTPUT_DIR: path.join(dataRoot, ".edupi/output"),
    EDUPI_LOCK_DIR: path.join(dataRoot, ".edupi/locks"), EDUPI_SKILLS_DIR: path.join(dataRoot, "skills"),
    EDUPI_DATA_DIR: path.join(dataRoot, "data"), EDUPI_CONFIG_DIR: path.join(dataRoot, "config"),
    PI_DESKTOP_STATE_DIR: path.join(root, "state"),
  };
  const previous = Object.fromEntries(Object.keys(environment).map(key => [key, process.env[key]]));
  Object.assign(process.env, environment);
  const replies = [], requests = [], wrappers = [], actionOwners = [];
  const server = http.createServer(async (request, response) => {
    let body = "";
    for await (const chunk of request) body += chunk;
    const step = replies.shift();
    requests.push({ url: request.url, body: JSON.parse(body) });
    if (request.url !== "/v1/chat/completions" || !step) {
      response.writeHead(500).end("Unexpected synthetic provider request");
      return;
    }
    const delta = step.kind === "observe"
      ? { role: "assistant", tool_calls: [{ index: 0, id: step.callId, type: "function",
        function: { name: "edupi_computer_use", arguments: JSON.stringify({ action: "observe" }) } }] }
      : { role: "assistant", content: "SYNTHETIC_OBSERVE_COMPLETE" };
    const chunk = (value, finish_reason) => `data: ${JSON.stringify({ id: step.callId,
      object: "chat.completion.chunk", created: 1, model: "synthetic", choices: [{ index: 0, delta: value, finish_reason }] })}\n\n`;
    response.writeHead(200, { "content-type": "text/event-stream" });
    response.end(chunk(delta, null) + chunk({}, step.kind === "observe" ? "tool_calls" : "stop") + "data: [DONE]\n\n");
  });
  t.after(async () => {
    for (const wrapper of wrappers) {
      if (wrapper.isAlive()) {
        await wrapper.send({ type: "abort" }).catch(() => {});
        await wrapper.shutdown();
      }
    }
    server.closeAllConnections();
    await new Promise(resolve => server.close(resolve));
    for (const [key, value] of Object.entries(previous)) {
      if (value === undefined) delete process.env[key]; else process.env[key] = value;
    }
    fs.rmSync(root, { recursive: true, force: true });
  });
  await new Promise(resolve => server.listen(0, "127.0.0.1", resolve));
  fs.writeFileSync(path.join(agentDir, "models.json"), JSON.stringify({ providers: {
    "computer-bridge-local": { api: "openai-completions", baseUrl: `http://127.0.0.1:${server.address().port}/v1`,
      models: [{ id: "synthetic", name: "Synthetic computer bridge", input: ["text"], reasoning: false,
        cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 }, contextWindow: 32_000, maxTokens: 512 }] },
  } }));
  const api = await createJiti(import.meta.url, { tsconfigPaths: true, moduleCache: false }).import("./rpc-manager.ts");
  const f = { root, dataRoot, api, replies, requests, wrappers, actionOwners, actionStarted: null };
  f.open = async (sessionId = randomUUID(), file = "") => {
    const { session: wrapper, realSessionId } = await api.startRpcSession(sessionId, file, file ? undefined : dataRoot,
      { ...(file ? {} : { toolNames: ["edupi_computer_use"] }), initialModel: { provider: "computer-bridge-local", modelId: "synthetic" } });
    wrappers.push(wrapper);
    await wrapper.waitUntilReady();
    assert.equal(wrapper instanceof api.AgentSessionWrapper, true);
    assert.equal(api.getRpcSession(realSessionId), wrapper);
    assert.ok(wrapper.inner.getActiveToolNames().includes("edupi_computer_use"));
    const requestAction = wrapper.requestEduPiComputerAction;
    wrapper.requestEduPiComputerAction = function (...args) {
      const record = { wrapper: this, registry: api.getRpcSession(this.sessionId), action: args[0] };
      actionOwners.push(record);
      f.actionStarted?.resolve(record);
      return requestAction.apply(this, args);
    };
    return wrapper;
  };
  return f;
}

async function observe(f, wrapper, stage, { lateListener = false, cancel = false } = {}) {
  const callId = `synthetic-observe-${randomUUID()}`;
  const content = `SYNTHETIC_OBSERVE_RESULT_${stage}`;
  const responseValue = cancel ? { ok: false, error: "SYNTHETIC_TEACHER_CANCELLED" }
    : { ok: true, result: { content, isError: false, images: [], snapshotId: `snapshot-${randomUUID()}`, operationId: callId } };
  const requestSeen = deferred(), done = deferred(), events = [];
  f.actionStarted = deferred();
  let off = () => {};
  const listen = () => wrapper.onEvent(event => {
    events.push(event);
    if (event.type === "extension_ui_request" && event.method === "edupi_computer_action") requestSeen.resolve(event);
    if (event.type === "prompt_done") done.resolve();
  });
  if (!lateListener) off = listen();
  const beforeCalls = f.requests.length;
  f.replies.push({ kind: "observe", callId }, { kind: "reply", callId });
  try {
    await wrapper.send({ type: "prompt", message: `SYNTHETIC_DESKTOP_OBSERVE_${stage}` });
    const owner = await within(f.actionStarted.promise, `${stage} actual SDK tool dispatch`);
    assert.equal(owner.wrapper, wrapper, "the SDK tool's requestAction must belong to the current wrapper, never a disposed cached wrapper");
    assert.equal(owner.registry, wrapper, "requestAction's owner must be the current registry wrapper");
    assert.deepEqual(owner.action, { action: "observe" });
    if (lateListener) {
      assert.equal(wrapper.pendingUiRequests.size, 1, "the real host request must already be pending before reconnect");
      off = listen();
    }
    const request = await within(requestSeen.promise, `${stage} extension_ui_request`);
    assert.deepEqual(request.action, { action: "observe" });
    assert.equal(request.timeout, 45_000);
    assert.ok(request.expiresAt > Date.now());
    assert.equal(request.clientRequestId, undefined, "host UI requests are not prompt-run-tagged SSE events");
    assert.equal(wrapper.pendingUiRequests.get(request.id), request);
    assert.equal(wrapper.pendingUiResponses.has(request.id), true);
    await wrapper.send({ type: "extension_ui_response", id: `wrong-${request.id}`, value: JSON.stringify(responseValue) });
    assert.equal(wrapper.pendingUiResponses.has(request.id), true, "a different nonce cannot settle this tool");
    await wrapper.send({ type: "extension_ui_response", id: request.id, value: JSON.stringify(responseValue) });
    await within(done.promise, `${stage} prompt completion after bridge response`);
    await wrapper.inner.waitForIdle();
    assert.equal(wrapper.pendingUiRequests.size, 0);
    assert.equal(wrapper.pendingUiResponses.size, 0);
    assert.equal(events.filter(event => event.type === "extension_ui_request" && event.id === request.id).length, 1);
    assert.equal(events.some(event => event.type === "prompt_error"), false);
    const toolEnd = events.find(event => event.type === "tool_execution_end" && event.toolName === "edupi_computer_use");
    assert.ok(toolEnd, "the real SDK must complete the actual host-owned computer tool");
    assert.equal(toolEnd.isError, cancel);
    const expected = cancel ? "SYNTHETIC_TEACHER_CANCELLED" : content;
    assert.ok(JSON.stringify(toolEnd.result).includes(expected));
    assert.equal(f.requests.length - beforeCalls, 2, "the real SDK must resume the deterministic model after the bridge response");
    assert.ok(JSON.stringify(f.requests.at(-1).body.messages).includes(expected));
    assert.equal(f.replies.length, 0);
    const persisted = SessionManager.open(wrapper.sessionFile).getEntries();
    const savedToolResult = persisted.find(entry => entry.type === "message" && entry.message.role === "toolResult"
      && entry.message.toolCallId === callId);
    assert.ok(savedToolResult, "a fresh SDK manager must read back the exact tool result from disk");
    assert.equal(savedToolResult.message.isError, cancel);
    assert.ok(JSON.stringify(savedToolResult.message.content).includes(expected));
    assert.equal(JSON.stringify(savedToolResult).includes("EduPi 桌面窗口未连接"), false);
    return { requestId: request.id, sessionFile: wrapper.sessionFile };
  } finally { off(); f.actionStarted = null; }
}

test("real Pi 1.0.2 startRpcSession computer bridge survives fresh, cold and forked sessions without native access",
  { timeout: 40_000 }, async t => {
    const sdk = JSON.parse(fs.readFileSync(new URL("../node_modules/@earendil-works/pi-coding-agent/package.json", import.meta.url), "utf8"));
    assert.equal(sdk.version, "1.0.2");
    const f = await fixture(t);
    let current, freshInner, freshWrapper, freshResult, coldResult;
    await t.test("fresh actual SDK observe reaches the registry wrapper and exact response nonce", async () => {
      current = await f.open(); freshWrapper = current; freshInner = current.inner;
      freshResult = await observe(f, current, "FRESH");
    });
    await t.test("cold actual SDK reconstruction replays a pending request to its new listener", async () => {
      const sessionId = current.sessionId;
      await current.shutdown();
      assert.equal(f.api.getRpcSession(sessionId), undefined);
      current = await f.open(sessionId, freshResult.sessionFile);
      assert.notEqual(current, freshWrapper);
      assert.notEqual(current.inner, freshInner);
      coldResult = await observe(f, current, "COLD", { lateListener: true, cancel: true });
      assert.notEqual(coldResult.requestId, freshResult.requestId);
      assert.equal(freshWrapper.pendingUiRequests.size, 0);
    });
    await t.test("real runtime fork and subsequent startup never dispatch through the disposed parent wrapper", async () => {
      const parent = current, previousId = parent.sessionId;
      const user = SessionManager.open(parent.sessionFile).getBranch().filter(entry => entry.type === "message" && entry.message.role === "user").at(-1);
      const forked = await parent.send({ type: "fork", entryId: user.id });
      assert.equal(forked.cancelled, false);
      assert.notEqual(forked.newSessionId, previousId);
      assert.equal(parent.isAlive(), false);
      assert.equal(f.api.getRpcSession(previousId), undefined);
      current = await f.open(forked.newSessionId, parent.sessionFile);
      const result = await observe(f, current, "FORK");
      assert.notEqual(result.requestId, coldResult.requestId);
      assert.equal(parent.pendingUiRequests.size, 0);
    });
    assert.equal(f.actionOwners.length, 3);
    assert.equal(f.requests.length, 6);
    console.log(JSON.stringify({ status: "passed", sdk: sdk.version, actual_startRpcSession: true,
      fresh: true, cold_reconstruction: true, pending_request_replay: true, runtime_fork: true,
      current_registry_wrapper: true, exact_response_nonce: true, cold_tool_result_reread: true,
      native_access: false, external_network: false, real_teacher_data: false, safe_mode: true }));
  });
