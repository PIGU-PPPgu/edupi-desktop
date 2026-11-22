import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import http from "node:http";
import { createHash, randomUUID } from "node:crypto";
import { createJiti } from "jiti";
import { cleanupCloudTest } from "./cleanup-edupi-cloud-test.mjs";

const url = process.env.SUPABASE_URL || "https://edupi.intelliclass.online";
const anon = process.env.SUPABASE_ANON_KEY;
if (!anon) throw new Error("SUPABASE_ANON_KEY must be injected securely");
const suffix = randomUUID();
const email = `cloud-worker-${suffix}@example.invalid`;
const password = `${randomUUID()}Aa!`;
const stateDir = fs.mkdtempSync(path.join(os.tmpdir(), "edupi-cloud-worker-"));
const takeoverStateDir = fs.mkdtempSync(path.join(os.tmpdir(), "edupi-cloud-worker-takeover-"));
const agentDir = fs.mkdtempSync(path.join(os.tmpdir(), "edupi-cloud-worker-agent-"));
const cwd = fs.mkdtempSync(path.join(os.tmpdir(), "edupi-cloud-worker-cwd-"));
const normalPrompt = `normal-${suffix}: 只返回合成结果`;
const oldPrompt = `retired-${suffix}: 旧请求不得再次运行`;
const newPrompt = `takeover-${suffix}: 只返回合成结果`;
const modelCalls = [];
const pendingOperations = new Set();
const hash = value => createHash("sha256").update(JSON.stringify(value)).digest("hex");
let userId;
let workspaceId;
let takeoverUserId;
let takeoverWorkspaceId;
let server;
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
    redirect: "error",
  });
  return { status: response.status, data: await response.json().catch(() => ({})) };
}
async function until(check, label) {
  const deadline = Date.now() + 60_000;
  while (Date.now() < deadline) {
    const result = await check();
    if (result) return result;
    await new Promise(resolve => setTimeout(resolve, 500));
  }
  assert.fail(label);
}
function requests(read) { return Array.isArray(read.requests) ? read.requests : []; }
function messages(read) { return Array.isArray(read.messages) ? read.messages : []; }
function assistantRows(read, requestId) {
  return messages(read).filter(row => row.request_id === requestId
    && (row.role === "assistant" || row.message?.role === "assistant"));
}
function observeWorkerClient(client, trace, EduPiCloudError) {
  return { ...client, operation(operation, body, scope) {
    // Observe the real HTTPS client without substituting responses or the executor.
    // Keep only non-secret fields; never retain a runtime proof or auth response.
    const entry = { operation, action: body.action, requestId: body.request_id,
      instanceId: body.instance_id || body.runtime?.instance_id,
      leaseName: body.lease_name || body.runtime?.lease_name };
    trace.push(entry);
    const pending = client.operation(operation, body, scope).then(result => {
      entry.ok = true;
      if (body.action === "claim") entry.claimedRequestId = result.request?.request_id;
      return result;
    }, error => {
      entry.ok = false;
      if (error instanceof EduPiCloudError) {
        entry.cloudError = true;
        entry.code = error.code;
        entry.status = error.status;
      }
      throw error;
    }).finally(() => pendingOperations.delete(pending));
    pendingOperations.add(pending);
    return pending;
  } };
}
async function stopAndDrain() {
  stopWorkers?.();
  for (let idle = 0; idle < 2;) {
    await Promise.allSettled([...pendingOperations]);
    await new Promise(resolve => setImmediate(resolve));
    idle = pendingOperations.size ? 0 : idle + 1;
  }
}
async function createQueuedSession(client, scope, sessionId, requestId, message) {
  const created = await client.operationWithOutbox("sessions", {
    action: "create", session_id: sessionId, request_id: `create-${sessionId}`,
    title: "合成接管验收", model: { provider: "local", modelId: "local" }, thinking_level: "off",
  }, scope);
  assert.equal(created.queued, false, "synthetic session creation must reach HTTPS");
  const queued = await client.operationWithOutbox("sessions", {
    action: "enqueue", session_id: sessionId, request_id: requestId,
    command: { type: "mobile_prompt", message, clientRequestId: requestId },
  }, scope);
  assert.equal(queued.queued, false, "synthetic prompt must reach the cloud queue");
}
try {
  server = http.createServer(async (request, response) => {
    if (request.url !== "/v1/chat/completions") {
      response.writeHead(404).end();
      return;
    }
    const chunks = [];
    for await (const chunk of request) chunks.push(chunk);
    const input = Buffer.concat(chunks).toString("utf8");
    modelCalls.push({ normal: input.includes(normalPrompt),
      old: input.includes(oldPrompt), new: input.includes(newPrompt) });
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
  const jiti = createJiti(import.meta.url, { tsconfigPaths: true });
  const { createEduPiCloudClient, EduPiCloudError } = await jiti.import("../lib/edupi-cloud-client.ts");
  const { ensureCloudChatWorker, stopCloudChatWorkers } = await jiti.import("../lib/edupi-cloud-chat-worker.ts");
  stopWorkers = stopCloudChatWorkers;
  const signup = await call("/auth/v1/signup", { email, password }, null, null);
  assert.equal(signup.status, 200, "normal synthetic signup must succeed");
  userId = signup.data.user.id;
  const provision = await call("/functions/v1/edupi-account", {
    action: "create_workspace", mode: "cloud", request_id: `worker-provision-${suffix}`,
  }, signup.data.access_token, null);
  assert.equal(provision.status, 201, "normal synthetic workspace provisioning must succeed");
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
  assert.equal(created.queued, false, "normal session creation must reach HTTPS");
  const requestId = `prompt-${suffix}`;
  const queued = await client.operationWithOutbox("sessions", {
    action: "enqueue", session_id: sessionId, request_id: requestId,
    command: { type: "mobile_prompt", message: normalPrompt, clientRequestId: requestId },
  }, scope);
  assert.equal(queued.queued, false, "normal prompt must reach the cloud queue");
  pass("desktop-cloud-chat-created-and-queued");
  const normalTrace = [];
  ensureCloudChatWorker(observeWorkerClient(client, normalTrace, EduPiCloudError), scope, { intervalMs: 250 });
  const final = await until(async () => {
    const read = await client.operation("sessions", { action: "read", session_id: sessionId }, scope);
    const current = requests(read).find(row => row.request_id === requestId);
    const assistant = assistantRows(read, requestId);
    return current?.status === "completed" && assistant.length === 1
      && normalTrace.some(entry => entry.action === "event" && entry.ok) && assistant[0];
  }, "cloud worker did not complete a synthetic local-model request");
  const message = final.message || final;
  assert.equal(message.content?.[0]?.text, "合成云端回读", "normal assistant text must read back");
  assert.equal(modelCalls.length, 1, "normal request must invoke the real Pi model once");
  assert.ok(modelCalls[0].normal && !modelCalls[0].old && !modelCalls[0].new,
    "normal model input must contain only the normal synthetic prompt");
  pass("desktop-cloud-chat-local-core-executor-and-readback");
  await stopAndDrain();

  // A separate test account/workspace has no normal-run history. The old and
  // new sessions share this workspace but have independent queued work.
  const takeoverEmail = `cloud-worker-takeover-${suffix}@example.invalid`;
  const takeoverPassword = `${randomUUID()}Aa!`;
  const takeoverSignup = await call("/auth/v1/signup",
    { email: takeoverEmail, password: takeoverPassword }, null, null);
  assert.equal(takeoverSignup.status, 200, "takeover synthetic signup must succeed");
  takeoverUserId = takeoverSignup.data.user.id;
  const takeoverProvision = await call("/functions/v1/edupi-account", {
    action: "create_workspace", mode: "cloud", request_id: `takeover-provision-${suffix}`,
  }, takeoverSignup.data.access_token, null);
  assert.equal(takeoverProvision.status, 201, "takeover synthetic workspace provisioning must succeed");
  takeoverWorkspaceId = takeoverProvision.data.workspace_id;
  assert.notEqual(takeoverUserId, userId, "takeover account must be isolated from the normal run");
  assert.notEqual(takeoverWorkspaceId, workspaceId, "takeover workspace must be isolated from the normal run");
  const takeoverClient = createEduPiCloudClient({ env: { ...env, PI_DESKTOP_STATE_DIR: takeoverStateDir } });
  await takeoverClient.login(takeoverEmail, takeoverPassword);
  await takeoverClient.selectWorkspace(takeoverWorkspaceId);
  const takeoverScope = await takeoverClient.captureScope();
  const oldSessionId = `old-${suffix}`, oldRequestId = `old-prompt-${suffix}`;
  const newSessionId = `new-${suffix}`, newRequestId = `new-prompt-${suffix}`;
  await createQueuedSession(takeoverClient, takeoverScope, oldSessionId, oldRequestId, oldPrompt);

  const oldInstanceId = `retired-${suffix}`, oldNonce = randomUUID();
  const registered = await takeoverClient.operation("runtime", { action: "register",
    instance_id: oldInstanceId, instance_nonce: oldNonce,
    core_commit: "synthetic-old", capabilities: { cloud_chat_text: true, local_tools: false } }, takeoverScope);
  const oldBase = { instance_id: registered.instance_id, instance_nonce: oldNonce,
    fencing_generation: registered.fencing_generation, lease_name: "cloud-chat" };
  const oldLease = await takeoverClient.operation("runtime",
    { action: "lease_acquire", ...oldBase, ttl_seconds: 60 }, takeoverScope);
  assert.ok(typeof oldLease.lease_token === "string", "old instance must receive a real lease");
  const oldProof = { ...oldBase, lease_token: oldLease.lease_token };
  const oldClaim = await takeoverClient.operation("sessions", { action: "claim", runtime: oldProof }, takeoverScope);
  assert.equal(oldClaim.request?.request_id, oldRequestId, "old instance must claim the old request");
  await takeoverClient.operation("sessions", { action: "running", session_id: oldSessionId,
    request_id: oldRequestId, runtime: oldProof }, takeoverScope);

  const scopeHash = hash([takeoverScope.issuer, takeoverScope.accountId, takeoverScope.workspaceId]);
  const journalDirectory = path.join(takeoverClient.runtimeDirectory(), scopeHash);
  fs.mkdirSync(journalDirectory, { recursive: true, mode: 0o700 });
  const journalFile = path.join(journalDirectory, `${hash(oldRequestId)}.json`);
  const journal = { scope: scopeHash, sessionId: oldSessionId, requestId: oldRequestId, status: "final",
    message: { role: "assistant", content: [{ type: "text", text: "合成旧执行结果，必须保留但不得伪造上传" }] } };
  const journalBytes = Buffer.from(`${JSON.stringify(journal, null, 2)}\n`);
  fs.writeFileSync(journalFile, journalBytes, { mode: 0o600, flag: "wx" });
  const released = await takeoverClient.operation("runtime",
    { action: "lease_release", ...oldProof }, takeoverScope);
  assert.equal(released.ok, true, "old cloud-chat lease must be released normally");
  const oldBefore = await takeoverClient.operation("sessions",
    { action: "read", session_id: oldSessionId }, takeoverScope);
  const oldRunning = requests(oldBefore).find(row => row.request_id === oldRequestId);
  assert.equal(oldRunning?.status, "running", "old request must remain running before takeover");
  assert.equal(oldRunning?.instance_id, oldInstanceId, "old running request must belong to the retired instance");
  assert.equal(assistantRows(oldBefore, oldRequestId).length, 0, "old journal must not already be uploaded");
  pass("takeover-isolated-old-instance-claimed-running-final-journal-and-normal-lease-release");

  await createQueuedSession(takeoverClient, takeoverScope, newSessionId, newRequestId, newPrompt);
  const newBefore = await takeoverClient.operation("sessions",
    { action: "read", session_id: newSessionId }, takeoverScope);
  assert.equal(requests(newBefore).find(row => row.request_id === newRequestId)?.status, "queued",
    "new independent request must be queued before the worker starts");
  const newInstanceId = `desktop-${(await takeoverClient.state()).installationId}`;
  // SQL intentionally rebinds recover() for the same instance_id on restart.
  // A distinct, legitimately leased instance must instead be runtime_fenced.
  assert.notEqual(newInstanceId, oldInstanceId, "takeover must use a different instance_id");
  const trace = [];
  const callsBeforeTakeover = modelCalls.length;
  ensureCloudChatWorker(observeWorkerClient(takeoverClient, trace, EduPiCloudError),
    takeoverScope, { intervalMs: 250 });
  const newRead = await until(async () => {
    const read = await takeoverClient.operation("sessions", { action: "read", session_id: newSessionId }, takeoverScope);
    return requests(read).find(row => row.request_id === newRequestId)?.status === "completed"
      && trace.some(entry => entry.action === "event" && entry.ok) && read;
  }, "fenced old final journal blocked the independent queued request");
  await stopAndDrain();

  const recovery = trace.find(entry => entry.action === "recover" && entry.requestId === oldRequestId);
  assert.ok(recovery?.cloudError && !recovery.ok, "recover must fail with a real EduPiCloudError");
  assert.equal(recovery.code, "runtime_fenced", "different-instance recovery must be fenced by HTTPS");
  assert.equal(recovery.status, 409, "fenced recovery must return HTTP 409");
  assert.equal(recovery.instanceId, newInstanceId, "recover must use the default worker's new instance");
  assert.equal(recovery.leaseName, "cloud-chat", "recover must use the dedicated chat lease");
  for (const action of ["register", "lease_acquire", "lease_renew"]) {
    const index = trace.findIndex(entry => entry.operation === "runtime" && entry.action === action
      && entry.instanceId === newInstanceId && entry.ok);
    assert.ok(index >= 0 && index < trace.indexOf(recovery), `new worker must successfully ${action} before recover`);
  }
  const claimedIndex = trace.findIndex(entry => entry.action === "claim" && entry.ok
    && entry.claimedRequestId === newRequestId && entry.instanceId === newInstanceId);
  assert.ok(claimedIndex > trace.indexOf(recovery), "worker must claim new work after the fenced recovery");
  pass("takeover-real-https-recover-runtime-fenced-409-then-claim-under-new-valid-lease");

  // Recreate the client to prove the outcome is persisted, rather than relying
  // on a worker response or an in-memory session.
  const rereadClient = createEduPiCloudClient({ env: { ...env, PI_DESKTOP_STATE_DIR: takeoverStateDir } });
  const rereadScope = await rereadClient.captureScope();
  const oldAfter = await rereadClient.operation("sessions", { action: "read", session_id: oldSessionId }, rereadScope);
  const newAfter = await rereadClient.operation("sessions", { action: "read", session_id: newSessionId }, rereadScope);
  const oldRequest = requests(oldAfter).find(row => row.request_id === oldRequestId);
  assert.equal(oldRequest?.status, "uncertain", "claim must reconcile the stale old running request as uncertain");
  assert.equal(oldRequest?.error_code, "executor_interrupted", "stale request must retain the interruption reason");
  assert.equal(oldRequest?.instance_id, oldInstanceId, "new worker must not rebind the old request");
  assert.equal(assistantRows(oldAfter, oldRequestId).length, 0, "old request must have no fabricated assistant");
  assert.ok(fs.readFileSync(journalFile).equals(journalBytes), "old final journal bytes must remain identical");
  assert.equal(JSON.parse(fs.readFileSync(journalFile, "utf8")).status, "final", "old journal must remain final");
  assert.equal(requests(newAfter).find(row => row.request_id === newRequestId)?.status, "completed",
    "new request completion must persist after client recreation");
  assert.equal(assistantRows(newAfter, newRequestId).length, 1, "new request must persist one assistant");
  assert.equal(assistantRows(newAfter, newRequestId)[0].message?.content?.[0]?.text, "合成云端回读",
    "new request must read back the actual Pi local-model response");
  assert.equal(assistantRows(newRead, newRequestId).length, 1, "first and recreated-client reads must agree");
  const takeoverCalls = modelCalls.slice(callsBeforeTakeover);
  assert.equal(takeoverCalls.length, 1, "takeover must make exactly one real model call");
  assert.ok(takeoverCalls[0].new && !takeoverCalls[0].old && !takeoverCalls[0].normal,
    "only the new queued request may reach the real Pi model");
  assert.equal(modelCalls.filter(call => call.old).length, 0, "old request must never reach the model");
  pass("takeover-old-uncertain-no-assistant-final-journal-byte-identical");
  pass("takeover-only-new-model-call-1-completed-and-recreated-client-readback");
  console.log(`EVIDENCE ${JSON.stringify({ oldStatus: oldRequest.status, recoverStatus: recovery.status,
    recoverCode: recovery.code, claimAfterRecover: true, oldAssistantCount: 0, oldModelCalls: 0,
    newModelCalls: takeoverCalls.length, newStatus: "completed", journalStatus: "final",
    journalBytes: journalBytes.length, journalSha256: createHash("sha256").update(journalBytes).digest("hex") })}`);
} finally {
  await stopAndDrain();
  if (server) await new Promise(resolve => server.close(resolve));
  fs.rmSync(stateDir, { recursive: true, force: true });
  fs.rmSync(takeoverStateDir, { recursive: true, force: true });
  fs.rmSync(agentDir, { recursive: true, force: true });
  fs.rmSync(cwd, { recursive: true, force: true });
  for (const [label, accountId, spaceId] of [
    ["normal", userId, workspaceId], ["takeover", takeoverUserId, takeoverWorkspaceId],
  ]) {
    if (!accountId) continue;
    try {
      cleanupCloudTest(accountId, spaceId);
      pass(`${label}-synthetic-account-and-workspace-cleaned`);
    } catch {
      console.error(`FAIL ${label}-fixture-cleanup user=${accountId} workspace=${spaceId || "none"}`);
      process.exitCode = 1;
    }
  }
  pass("isolated-local-state-agent-and-cwd-removed");
}
