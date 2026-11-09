#!/usr/bin/env node
import assert from "node:assert/strict";
import childProcess, { execFileSync } from "node:child_process";
import crypto from "node:crypto";
import fs from "node:fs";
import http from "node:http";
import { syncBuiltinESMExports } from "node:module";
import os from "node:os";
import path from "node:path";
import { DatabaseSync } from "node:sqlite";
import { fileURLToPath, pathToFileURL } from "node:url";
import { createJiti } from "jiti";
import { seedCapabilityCanary } from "./edupi-capability-canary-fixture.mjs";

function assertQuestionProjection(payload, caseId) {
  const cases = payload.work_cases.filter(item => item.trigger_id === caseId);
  assert.equal(cases.length, 1, "a source question must project exactly one case");
  const workCase = cases[0];
  assert.equal(payload.work_cases.filter(item => item.work_case_id === workCase.work_case_id).length, 1,
    "a source question work-case identity must be unique");
  const tasks = payload.education_workspace.tasks.filter(item => item.task_id === workCase.task_id
    || item.source_event_id === caseId || item.evidence?.source_entry_id === caseId);
  assert.equal(tasks.length, 1, "a source question must project exactly one task");
  const task = tasks[0];
  assert.equal(task.task_id, workCase.task_id);
  assert.equal(task.trigger, "capability_package");
  assert.equal(task.source_event_id, caseId, "the task must retain the exact source question case");
  assert.equal(task.evidence?.source_entry_id, caseId, "task evidence must retain the exact source question case");
  return { workCase, task };
}

assert.equal(process.platform, "darwin", "this canary covers macOS only");
assert.ok(process.env.EDUPI_CORE_ROOT && path.isAbsolute(process.env.EDUPI_CORE_ROOT), "EDUPI_CORE_ROOT is required");
const sourceCandidate = process.argv.includes("--source-candidate");
const useMain4 = process.argv.includes("--main4");
assert.equal((sourceCandidate || useMain4) && process.argv.includes("--v3"), false, "choose one canary identity mode");
const useV3 = process.argv.includes("--v3") || sourceCandidate || useMain4, desktopRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const coreRoot = fs.realpathSync(process.env.EDUPI_CORE_ROOT);
const coreCommit = execFileSync("git", ["-C", coreRoot, "rev-parse", "HEAD"], { encoding: "utf8", timeout: 15_000 }).trim();
const desktopCommit = execFileSync("git", ["-C", desktopRoot, "rev-parse", "HEAD"], { encoding: "utf8", timeout: 15_000 }).trim();
if (useMain4 && !sourceCandidate) assert.equal(execFileSync("git", ["-C", desktopRoot, "status", "--porcelain", "--untracked-files=all", "--",
  ".", ":(exclude).edupi-core-runtime", ":(exclude).edupi-core-host-test-tmp"],
  { encoding: "utf8", timeout: 15_000 }).trim(), "", "release canary requires clean Desktop source");
if (sourceCandidate || useMain4) {
  const expected = JSON.parse(fs.readFileSync(path.join(desktopRoot, "contracts/edupi-core-compat.json"), "utf8")).core_runtime;
  assert.match(expected.core_commit, /^[a-f0-9]{40}$/u);
  assert.equal(coreCommit, expected.core_commit, "Desktop must pin the exact candidate Core HEAD");
  assert.equal(expected.component_manifest_path, "contracts/edupi-desktop-component-manifest.json");
  if (!sourceCandidate) assert.equal(execFileSync("git", ["-C", coreRoot, "status", "--porcelain"],
    { encoding: "utf8", timeout: 15_000 }).trim(), "", "release canary requires clean Core source");
  for (const [file, identity] of [[expected.component_manifest_path, expected.component_manifest_hash],
    ["contracts/edupi-core-runtime-component-manifest.json", expected.runtime_component_manifest_hash]]) {
    const record = JSON.parse(fs.readFileSync(path.join(coreRoot, file), "utf8"));
    assert.equal(record.component_manifest_hash, identity, `${file} identity changed`);
  }
} else if (useV3) {
  assert.equal(coreCommit, "3f7b98d8d45ae8fd1a54c1ac45ae4e3f2d79f3b6", "v3 canary requires the fixed reviewed Core");
  assert.equal(JSON.parse(fs.readFileSync(path.join(desktopRoot, "contracts/edupi-core-compat.json"), "utf8")).core_runtime.core_commit,
    coreCommit, "Desktop must pin the same reviewed Core");
  assert.equal(execFileSync("git", ["-C", coreRoot, "status", "--porcelain"], { encoding: "utf8", timeout: 15_000 }).trim(),
    "", "v3 canary requires clean Core source");
}
const temporaryParent = fs.realpathSync(useV3 ? "/tmp" : os.tmpdir());
const temp = fs.realpathSync(fs.mkdtempSync(path.join(temporaryParent, "edupi-capability-canary-e2-")));
const dataRoot = useV3 ? fs.realpathSync(fs.mkdtempSync(path.join(temporaryParent, "edupi-capability-canary-v3-"))) : path.join(temp, "data");
const stateDir = path.join(temp, "state"), agentDir = path.join(temp, "agent"), home = path.join(dataRoot, ".edupi");
const hash = bytes => `sha256:${crypto.createHash("sha256").update(bytes).digest("hex")}`;
const workStatePath = path.join(home, "output/capability_work_state.json");
const durableAdminPath = path.join(home, "runtime", "calendar-administration-durable-v1.sqlite");
const durableAdminState = () => {
  const db = new DatabaseSync(durableAdminPath, { readOnly: true });
  try {
    assert.equal(db.prepare("PRAGMA quick_check").get().quick_check, "ok");
    return { activeTasks: db.prepare("SELECT COUNT(*) AS count FROM tasks").get().count,
      recordedIds: db.prepare("SELECT COUNT(*) AS count FROM record_ids").get().count };
  } finally { db.close(); }
};
for (const directory of [stateDir, agentDir, path.join(home, "memory"), path.join(home, "output"), path.join(home, "locks")]) fs.mkdirSync(directory, { recursive: true, mode: 0o700 });
const token = crypto.randomBytes(32).toString("hex"), keep = process.env.EDUPI_E2_KEEP === "1";
if (keep) console.log(JSON.stringify({ status: "isolated-fixture", mode: useV3 ? "v3" : "legacy", temporaryRoot: temp, dataRoot }));
let chatCalls = 0;
const syntheticReply = "合成测试消息已接收", sseFrames = [];
const server = http.createServer(async (request, response) => {
  let requestBytes = 0;
  for await (const chunk of request) requestBytes += chunk.byteLength;
  if (request.url !== "/v1/chat/completions") { response.writeHead(404); response.end(); return; }
  chatCalls++;
  const finish = response.end.bind(response);
  response.end = chunk => {
    const body = String(chunk);
    sseFrames.push({ call: chatCalls, requestBytes, newlineDelimited: body.includes("\n\n"), literalBackslashDelimited: body.includes("\\n\\n"),
      tailHex: Buffer.from(body).subarray(-16).toString("hex") });
    return finish(chunk);
  };
  const id = `synthetic-capability-chat-${chatCalls}`, content = "合成测试消息已接收";
  response.writeHead(200, { "Content-Type": "text/event-stream" });
  response.end(`data: ${JSON.stringify({ id, object: "chat.completion.chunk", model: "local", choices: [{ index: 0, delta: { role: "assistant", content }, finish_reason: null }] })}\n\ndata: ${JSON.stringify({ id, object: "chat.completion.chunk", model: "local", choices: [{ index: 0, delta: {}, finish_reason: "stop" }] })}\n\ndata: [DONE]\n\n`);
});
await new Promise((resolve, reject) => { server.once("error", reject); server.listen(0, "127.0.0.1", resolve); });
fs.writeFileSync(path.join(agentDir, "models.json"), JSON.stringify({ providers: { local: { api: "openai-completions", apiKey: "synthetic-local-placeholder",
  baseUrl: `http://127.0.0.1:${server.address().port}/v1`, models: [{ id: "local", name: "Synthetic local", input: ["text"], reasoning: false,
    cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 }, contextWindow: 32000, maxTokens: 2048 }] } } }), { mode: 0o600 });
fs.writeFileSync(path.join(agentDir, "settings.json"), JSON.stringify({ defaultProvider: "local", defaultModel: "local", extensions: [], packages: [], skills: [] }), { mode: 0o600 });
const environment = { EDUPI_PROJECT_ROOT: dataRoot, EDUPI_DATA_ROOT: dataRoot, EDUPI_DATA_ALLOWED_ROOT: useV3 ? temporaryParent : temp,
  EDUPI_CORE_ROOT: coreRoot, EDUPI_CORE_ALLOWED_ROOT: path.dirname(coreRoot), EDUPI_HOME: home,
  EDUPI_MEMORY_DIR: path.join(home, "memory"), EDUPI_OUTPUT_DIR: path.join(home, "output"), EDUPI_LOCK_DIR: path.join(home, "locks"),
  PI_DESKTOP_STATE_DIR: stateDir, PI_DESKTOP_API_TOKEN: token, PI_CODING_AGENT_DIR: agentDir, PI_OFFLINE: "1", EDUPI_DESKTOP_ISOLATED_CANARY: "1",
  ...(useV3 ? { TMPDIR: "/tmp" } : {}) };
const previous = new Map([...Object.keys(environment), "EDUPI_AMBIENT_PLANNING"].map(key => [key, process.env[key]]));
Object.assign(process.env, environment); delete process.env.EDUPI_AMBIENT_PLANNING;
const originalFetch = globalThis.fetch;
const originalFork = childProcess.fork, launches = [], restartChecks = [];
const main4Checks = [];
let planningTombstoneHash = null;
const assertMain4Storage = label => {
  const database = new DatabaseSync(path.join(home, "runtime", "core-runtime-v1.sqlite"), { readOnly: true });
  try {
    assert.equal(database.prepare("PRAGMA quick_check").get().quick_check, "ok");
    assert.equal(database.prepare("PRAGMA user_version").get().user_version, 4);
    assert.equal(database.prepare("SELECT schema_version FROM authority WHERE singleton=1").get().schema_version, 4);
    assert.equal(database.prepare("PRAGMA foreign_key_check").get(), undefined);
    const checkpoint = database.prepare("SELECT generation, history_tip_sequence FROM planning_v2_checkpoint WHERE singleton=1").get();
    assert.ok(checkpoint?.generation >= 1);
    const tombstoneBytes = fs.readFileSync(path.join(home, "output", "ambient-planning-v1.json"));
    const tombstone = JSON.parse(tombstoneBytes);
    assert.equal(tombstone.kind, "planning-v1-retired");
    assert.equal(tombstone.storage_version, 2);
    assert.equal(tombstone.root_ref, database.prepare("SELECT root_fingerprint FROM authority WHERE singleton=1").get().root_fingerprint);
    if (planningTombstoneHash !== null) assert.equal(hash(tombstoneBytes), planningTombstoneHash, "Main4 must never rewrite the retired V1 planning file");
    planningTombstoneHash = hash(tombstoneBytes);
    main4Checks.push({ label, userVersion: 4, generation: checkpoint.generation,
      historyTipSequence: checkpoint.history_tip_sequence, tombstoneHash: planningTombstoneHash });
  } finally { database.close(); }
};
let reviewedArtifacts = [];
const readPreservedState = () => ({
  workStateHash: hash(fs.readFileSync(workStatePath)),
  artifacts: reviewedArtifacts.map(artifact => ({ path: artifact.relative_path, sha256: hash(fs.readFileSync(path.join(dataRoot, artifact.relative_path))) })),
});
childProcess.fork = (file, args, options) => {
  assert.equal(path.resolve(file), path.join(desktopRoot, "desktop/core-runtime-host.mjs"), "only the real Desktop runtime host may be forked");
  assert.equal(options.env.EDUPI_PROJECT_ROOT, dataRoot, "every runtime must use this fresh synthetic root");
  const child = originalFork(file, args, options), launch = { pid: child.pid, options: null, ready: null, preserved: null, exited: false };
  launches.push(launch);
  child.once("exit", () => { launch.exited = true; });
  const send = child.send;
  child.send = function (message, ...rest) {
    if (message?.type === "runtime-start") {
      launch.options = { ambientPlanning: message.options.ambientPlanning === true,
        domains: (message.options.g3Bindings || []).map(binding => binding.domain),
        sourceParentQuestionGoals: message.options.sourceParentQuestionGoals === true };
    }
    return send.call(this, message, ...rest);
  };
  child.on("message", message => {
    if (message?.type === "runtime-ready") {
      launch.ready = { fencingGeneration: message.fencingGeneration, instanceNonce: message.instanceNonce };
      if (reviewedArtifacts.length > 0) {
        try { launch.preserved = readPreservedState(); }
        catch (error) { launch.preserved = { error: error.code || error.name }; }
      }
    }
  });
  return child;
};
syncBuiltinESMExports();
globalThis.fetch = (input, options) => {
  const url = new URL(typeof input === "string" || input instanceof URL ? input : input.url);
  assert.ok(["127.0.0.1", "localhost"].includes(url.hostname), "canary forbids external/provider requests");
  return originalFetch(input, options);
};
const request = (url, method = "GET", body) => new Request(url, { method, headers: { host: "localhost", origin: "http://localhost",
  "sec-fetch-site": "same-origin", "content-type": "application/json", "x-pi-desktop-token": token }, ...(body ? { body: JSON.stringify(body) } : {}) });
const jiti = createJiti(import.meta.url, { tsconfigPaths: true });
let supervisor, rpc;
try {
  const coreProtocol = await import(pathToFileURL(path.join(coreRoot, "scripts/core_runtime_protocol.mjs")).href);
  if (sourceCandidate || useMain4) assert.equal(coreProtocol.CORE_RUNTIME_SCHEMA_HASH,
    JSON.parse(fs.readFileSync(path.join(desktopRoot, "contracts/edupi-core-compat.json"), "utf8")).core_runtime.runtime_schema_hash);
  const publicRecipientConfirmation = coreProtocol.CORE_RUNTIME_OPERATIONS.includes("owner_parent_recipient_confirm");
  if (process.argv.includes("--require-recipient-confirmation")) assert.equal(publicRecipientConfirmation, true, "this candidate requires the real Core recipient confirmation contract");
  const rows = await seedCapabilityCanary({ coreRoot, dataRoot, recipientMissing: publicRecipientConfirmation }), selected = rows[0], foreign = rows[1];
  const route = await jiti.import("../app/api/edupi/proactivity/route.ts");
  const promptRoute = await jiti.import("../app/api/edupi/proactivity/prompt/route.ts");
  const recipientRoute = await jiti.import("../app/api/edupi/proactivity/parent-recipient/route.ts");
  const intentRoute = await jiti.import("../app/api/edupi/proactivity/prompt/intent/route.ts");
  const rootsModule = await jiti.import("../lib/edupi-core-snapshot.ts");
  const control = await jiti.import("../lib/edupi-proactivity-control.ts");
  const grantRuntime = await jiti.import("../lib/edupi-proactivity-runtime.ts");
  const registered = await jiti.import("../lib/edupi-registered-prompt.ts");
  const feedbackRoute = await jiti.import("../app/api/edupi/teacher-feedback/route.ts");
  const capabilityFeedback = await jiti.import("../lib/edupi-capability-feedback.ts");
  const teacherFeedback = await jiti.import("../lib/edupi-teacher-feedback.ts");
  const education = await jiti.import("../lib/edupi-education-contract.ts");
  const taskReview = await jiti.import("../lib/edupi-task-review.ts");
  const outbox = await jiti.import("../lib/edupi-prompt-outbox.ts");
  const ambientLedger = await jiti.import("../lib/edupi-ambient-message-ledger.ts");
  const config = await jiti.import("../lib/edupi-proactivity-config.ts");
  const sessionReader = await jiti.import("../lib/session-reader.ts");
  supervisor = await jiti.import("../lib/edupi-runtime-supervisor.ts");
  rpc = await jiti.import("../lib/rpc-manager.ts");
  const roots = rootsModule.resolveEduPiBridgeRoots(), domains = ["calendar_administration", "lesson_reflection", "parent_communication"];
  if (useV3) {
    assert.equal(path.dirname(dataRoot), fs.realpathSync("/tmp"), "migration accepts only this newly created direct /tmp fixture");
    assert.equal(path.dirname(dataRoot), fs.realpathSync(os.tmpdir()));
    assert.match(path.basename(dataRoot), /^edupi-[A-Za-z0-9-]+$/u);
    const fixtureStat = fs.lstatSync(dataRoot);
    assert.ok(fixtureStat.isDirectory() && !fixtureStat.isSymbolicLink());
    assert.equal(fs.realpathSync(dataRoot), dataRoot);
    assert.equal(fixtureStat.mode & 0o077, 0);
    assert.equal(fixtureStat.uid, process.getuid());
    const seedHost = await supervisor.ensureEduPiRuntime(roots), seedHealth = await seedHost.call("health", null);
    assert.equal(seedHealth.ok, true);
    const bootstrapped = await seedHost.callOwnerControl("owner_control", { command_id: "capability-v3-fixture-bootstrap",
      root_ref: seedHealth.result.data_root_fingerprint, expected_owner_id: null, action: "bootstrap" });
    assert.equal(bootstrapped.ok, true, JSON.stringify(bootstrapped));
    await supervisor.closeAllEduPiRuntimes();
    const { loadOwnerControlToken } = await jiti.import("../lib/edupi-owner-control-token.ts");
    const { migrateCoreOwnerHistoryForTest } = await import(pathToFileURL(path.join(coreRoot, "scripts/test_core_runtime_v3_support.mjs")).href);
    await migrateCoreOwnerHistoryForTest({ dataRoot, ownerControlToken: loadOwnerControlToken(stateDir, dataRoot) });
  }
  const get = async domain => {
    const response = await route.GET(request(`http://localhost/api/edupi/proactivity?domain=${domain}`)), state = await response.json();
    assert.equal(response.status, 200, JSON.stringify(state)); return state;
  };
  const toggle = async (domain, enabled) => {
    const state = await get(domain), scope = state.scopes.find(item => item.classId === selected.classroom.entity_id && item.ready);
    if (enabled && !scope) {
      const spine = (await rootsModule.readEduPiEducationSnapshot({ roots })).workspace.fact_spine;
      const facts = spine.accepted_facts.filter(item => item.predicate === "lesson.observation").map(item => ({ entity_id: item.entity_id,
        status: item.status, fact_kind: item.fact_kind, subject_ref: item.subject_ref, source_ids: item.source_ids,
        observation_ids: item.observation_ids, conflict_ids: item.conflict_ids }));
      const observations = spine.observations.filter(item => facts.some(fact => fact.observation_ids.includes(item.observation_id)))
        .map(item => ({ observation_id: item.observation_id, source_id: item.source_id, source_kind: item.source_kind,
          status: item.status, entity_ids: item.entity_ids }));
      assert.ok(scope, JSON.stringify({ domain, selectedClassId: selected.classroom.entity_id, scopes: state.scopes,
        projection: spine.projection_kind, facts, observations, entities: spine.entities.map(item => ({ id: item.entity_id,
          kind: item.entity_kind, status: item.status })) }));
    }
    const response = await route.POST(request("http://localhost/api/edupi/proactivity", "POST", { domain, enabled,
      classId: enabled ? scope?.classId : null, subject: enabled ? scope?.subject : null, expectedUpdatedAt: state.activation.updatedAt }));
    const body = await response.json(); assert.equal(response.status, 200, JSON.stringify(body)); return body;
  };
  for (const domain of domains) assert.equal((await get(domain)).activation.enabled, false);
  let host = await supervisor.ensureEduPiRuntime(roots), health = await host.call("health", null);
  assert.equal(health.result.capabilities.g3_processor, "activation_pending");
  assert.equal(fs.existsSync(durableAdminPath), false, "G3 Durable is lazy before an exact selected admin case");
  const rootRef = health.result.data_root_fingerprint;
  for (const domain of domains) {
    const enabled = await toggle(domain, true);
    assert.equal(enabled.activation.enabled, true); assert.equal(enabled.capabilities.capabilityDrafts, true);
    assert.equal(enabled.limits.maxModelCalls, 0); assert.equal(enabled.grant.modelBudget, null);
    assert.ok(config.readEduPiProactivityActivation({ dataRoot, domain }).ownerId);
  }
  assert.equal(fs.existsSync(durableAdminPath), false, "grant activation alone must not open the private Durable store");
  host = await supervisor.ensureEduPiRuntime(roots);
  if (useV3) {
    const activeCapacity = (await host.call("health", null)).result.owner_message_capacity;
    assert.equal(activeCapacity.storage, "sqlite_stream_v1");
    assert.equal(activeCapacity.record_limit, null);
    assert.equal(activeCapacity.gate_entry_limit, null);
  }
  const owner = (await host.call("owner_read", { root_ref: rootRef })).result.owner;
  const foreignBefore = [];
  for (const domain of domains) {
    const scope = { classId: foreign.classroom.entity_id, subject: domain === "calendar_administration" ? "administration" : "math" };
    const binding = control.buildCapabilityGrantBinding(domain, scope, (await rootsModule.readEduPiEducationSnapshot({ roots })).workspace);
    await grantRuntime.ensureProactivityGrant(host, rootRef, binding);
    const proof = await registered.registerAndCapturePrompt(host, { rootRef, grantId: binding.grantId, sessionId: "foreign-canary",
      messageId: `foreign-${domain}`, text: foreign.requests[domain], occurredAt: new Date().toISOString(), domain,
      carrierId: `edupi.synthetic.foreign.${domain}`, planId: `foreign.${domain}` }, { onBound() {}, onRegistered() {}, onCaptured() {} });
    const denied = await host.callOwnerControl("owner_intent_route_apply", { root_ref: rootRef, expected_owner_id: owner.id, message_ref: proof.messageRef });
    assert.equal(denied.error_code, "activation_pending", `same-domain foreign grant cannot execute: ${JSON.stringify(denied)}`);
    foreignBefore.push(proof.messageRef);
  }
  const sessionId = "desktop-capability-synthetic", sessionDir = path.join(temp, "sessions"), sessionFile = path.join(sessionDir, "session.jsonl");
  fs.mkdirSync(sessionDir, { mode: 0o700 });
  fs.writeFileSync(sessionFile, `${JSON.stringify({ type: "session", version: 3, id: sessionId, timestamp: new Date().toISOString(), cwd: dataRoot })}\n`, { mode: 0o600 });
  sessionReader.cacheSessionPath(sessionId, sessionFile);
  const { startHarnessSession } = await jiti.import("../lib/harness/runtime.ts");
  await startHarnessSession(sessionId, sessionFile, dataRoot, { toolNames: [] });
  const piEvents = [], assistantChecks = [];
  rpc.getRpcSession(sessionId).onEvent(event => piEvents.push({ type: event.type, clientRequestId: event.clientRequestId,
    role: event.message?.role, entryId: event.entryId, error: event.error }));
  for (const domain of domains) {
    const messageId = `selected-${domain}`, clientRequestId = crypto.randomUUID(), occurredAt = new Date().toISOString(), text = selected.requests[domain];
    const intentResponse = await intentRoute.POST(request("http://localhost/api/edupi/proactivity/prompt/intent", "POST", {
      clientRequestId, sessionId, cwd: dataRoot, message: text, draftValue: text, occurredAt }));
    assert.equal(intentResponse.status, 200, JSON.stringify(await intentResponse.json()));
    const promptResponse = await promptRoute.POST(request("http://localhost/api/edupi/proactivity/prompt", "POST", {
      sessionId, messageId, occurredAt, command: { type: "prompt", clientRequestId, message: text } }));
    const promptBody = await promptResponse.json(); assert.equal(promptResponse.status, 200, JSON.stringify({ promptBody, piEvents }));
    assert.equal(promptBody.status, "accepted");
    const persisted = outbox.readEduPiPromptOutbox(sessionId, clientRequestId, { dataRoot });
    assert.equal(persisted.stage, "pi_accepted"); assert.equal(persisted.bindings.length, 3);
    assert.ok(persisted.bindings.every(binding => binding.captured && binding.registration));
    const session = rpc.getRpcSession(sessionId);
    assert.equal(typeof session?.inner.waitForIdle, "function", "the real SDK session must expose waitForIdle");
    const idleStarted = performance.now();
    let idleTimer;
    try {
      await Promise.race([session.inner.waitForIdle(), new Promise((_, reject) => {
        idleTimer = setTimeout(() => reject(new Error("synthetic_chat_sdk_idle_timeout")), 10_000);
      })]);
    } finally { clearTimeout(idleTimer); }
    const sdkIdleMs = Math.round(performance.now() - idleStarted);
    assert.ok(sdkIdleMs <= 10_000, `SDK idle exceeded its wall-time bound: ${sdkIdleMs} ms`);
    const idleDeadline = Date.now() + 1000;
    while (session.isRunning() && Date.now() < idleDeadline) await new Promise(resolve => setTimeout(resolve, 25));
    assert.equal(session.isRunning(), false);
    const entries = sessionReader.getSessionEntries(sessionFile);
    const user = entries.filter(item => item.type === "message" && item.message.role === "user").at(-1);
    assert.ok(user, "the current user message must remain persisted");
    const byId = new Map(entries.map(item => [item.id, item]));
    const replies = entries.filter(item => {
      if (item.type !== "message" || item.message.role !== "assistant") return false;
      let parent = item.parentId;
      const seen = new Set();
      while (parent && !seen.has(parent)) {
        if (parent === user.id) return true;
        seen.add(parent);
        const ancestor = byId.get(parent);
        if (ancestor?.type === "message" && ancestor.message.role === "user") return false;
        parent = ancestor?.parentId;
      }
      return false;
    });
    const textOf = message => typeof message.content === "string" ? message.content
      : message.content.filter(item => item.type === "text").map(item => item.text).join("");
    const diagnostics = { domain, replies: replies.map(item => ({ stopReason: item.message.stopReason,
      textLength: textOf(item.message).length, error: item.message.errorMessage?.slice(0, 160) })), sseFrames };
    assert.equal(piEvents.filter(event => event.clientRequestId === clientRequestId && event.type === "prompt_error").length, 0, JSON.stringify(diagnostics));
    assert.equal(replies.length, 1, JSON.stringify(diagnostics));
    assert.equal(replies[0].message.stopReason, "stop", JSON.stringify(diagnostics));
    assert.equal(textOf(replies[0].message), syntheticReply, JSON.stringify(diagnostics));
    assistantChecks.push({ domain, assistantEntryId: replies[0].id, stopReason: replies[0].message.stopReason,
      responseSha256: crypto.createHash("sha256").update(textOf(replies[0].message)).digest("hex"), sdkWaitForIdle: true, sdkIdleMs, promptErrors: 0 });
  }
  const bridge = async (operation, fields = {}) => {
    const reply = await host.callBridge({ protocol: "edupi-desktop-bridge", protocol_version: 1, producer: "edupi-desktop", operation,
      request_id: `capability-e2-${crypto.randomUUID()}`, ...fields });
    assert.equal(reply.ok, true, JSON.stringify(reply)); const body = JSON.parse(reply.result.bridge_frame);
    assert.equal(body.ok, true, JSON.stringify(body)); return body;
  };
  let recipientReference = selected.recipient?.reference;
  if (publicRecipientConfirmation) {
    const beforeConfirmation = (await bridge("snapshot")).envelope.payload;
    assert.equal(beforeConfirmation.work_cases.filter(item => item.case_kind === "capability_package").length, 2);
    assert.equal(beforeConfirmation.education_workspace.fact_spine.accepted_facts.some(item => item.predicate === "communication.recipient_confirmed" && item.entity_id === selected.parent.entity_id), false);
    const availableResponse = await recipientRoute.GET(request("http://localhost/api/edupi/proactivity/parent-recipient")), available = await availableResponse.json();
    assert.equal(availableResponse.status, 200, JSON.stringify(available));
    const entry = available.entries.find(item => item.status === "ready" && item.candidate?.student.entity_id === selected.student.entity_id);
    assert.ok(entry, JSON.stringify(available)); assert.equal(entry.candidate.recipient.entity_id, selected.parent.entity_id);
    const input = { sessionId: entry.sessionId, clientRequestId: entry.clientRequestId, commandId: `recipient-${crypto.randomUUID()}`,
      expectedGrantVersion: entry.candidate.grant_version, expectedSourceFingerprint: entry.candidate.source_fingerprint,
      studentId: entry.candidate.student.entity_id, recipientId: entry.candidate.recipient.entity_id, termRef: entry.candidate.term.entity_id };
    const denied = await recipientRoute.POST(request("http://localhost/api/edupi/proactivity/parent-recipient", "POST", { ...input, expectedSourceFingerprint: `sha256:${"0".repeat(64)}` }));
    assert.equal(denied.status, 409);
    const confirmed = await recipientRoute.POST(request("http://localhost/api/edupi/proactivity/parent-recipient", "POST", input)), body = await confirmed.json();
    assert.equal(confirmed.status, 200, JSON.stringify(body)); assert.equal(body.readbackConfirmed, true);
    const replayed = await recipientRoute.POST(request("http://localhost/api/edupi/proactivity/parent-recipient", "POST", input));
    assert.equal(replayed.status, 200, JSON.stringify(await replayed.json()));
    const readback = (await bridge("snapshot")).envelope.payload.education_workspace.fact_spine;
    const fact = readback.accepted_facts.find(item => item.fact_id === body.result.fact_id), source = readback.observations.find(item => fact.observation_ids.includes(item.observation_id));
    assert.equal(fact.predicate, "communication.recipient_confirmed"); assert.equal(fact.confidence.basis, "explicit");
    assert.equal(source.actor_ref, owner.id); assert.ok(source.raw_text.includes(entry.candidate.message_ref));
    recipientReference = { fact_id: fact.fact_id, revision: fact.revision, fact_kind: fact.fact_kind, entity_id: fact.entity_id, predicate: fact.predicate,
      value: fact.value, term_ref: selected.term.entity_id, class_ref: selected.classroom.entity_id, occurred_on: source.observed_at.slice(0, 10), source_ids: fact.source_ids };
  }
  let snapshot;
  // The G3 timer is 60 seconds; a busy Mac may miss the immediate wake.
  const deadline = Date.now() + 70_000;
  do {
    snapshot = (await bridge("snapshot")).envelope.payload;
    if (snapshot.work_cases.filter(item => item.case_kind === "capability_package" && item.current_state === "draft_ready").length === 3) break;
    await new Promise(resolve => setTimeout(resolve, 100));
  } while (Date.now() < deadline);
  const workCases = snapshot.work_cases.filter(item => item.case_kind === "capability_package");
  assert.equal(workCases.length, 3, "three selected natural requests produce exactly three current cases");
  assert.ok(workCases.every(item => item.current_state === "draft_ready" && item.artifacts.length === 3));
  assert.equal(fs.existsSync(durableAdminPath), true, "selected G3 admin case must run through Durable");
  assert.ok(durableAdminState().recordedIds >= 1, "G3 Durable must retain its internal task identity after retirement");
  const feedbackFetcher = async (_url, init = {}) => {
    const action = init.method === "POST" ? JSON.parse(init.body).action : "read";
    const started = performance.now();
    try {
      const response = init.method === "POST"
        ? await feedbackRoute.POST(request("http://localhost/api/edupi/teacher-feedback", "POST", JSON.parse(init.body)))
        : await feedbackRoute.GET(request("http://localhost/api/edupi/teacher-feedback"));
      console.log(JSON.stringify({ status: "feedback-request", action, httpStatus: response.status, elapsedMs: Math.round(performance.now() - started) }));
      return response;
    } catch (error) {
      console.log(JSON.stringify({ status: "feedback-request-error", action, errorName: error?.name || "Error", elapsedMs: Math.round(performance.now() - started) }));
      throw error;
    }
  };
  const summaries = [];
  for (const workCase of workCases) {
    snapshot = (await bridge("snapshot")).envelope.payload;
    const task = snapshot.education_workspace.tasks.find(item => item.task_id === workCase.task_id);
    assert.equal(task.trigger, "capability_package");
    for (const artifact of workCase.artifacts) {
      const bytes = fs.readFileSync(path.join(dataRoot, artifact.relative_path));
      assert.equal(`sha256:${crypto.createHash("sha256").update(bytes).digest("hex")}`, artifact.sha256);
      assert.ok(bytes.length > 0); assert.equal(artifact.external_send, false);
      assert.equal(bytes.includes(foreign.classroom.canonical_name), false, "draft content cannot include a foreign class");
      assert.doesNotMatch(bytes.toString("utf8"), /诊断为|保证一定|已经发送/);
    }
    const review = await taskReview.issueTaskReview({ taskId: task.task_id, expectedRevision: task.revision,
      decision: "accept", reviewerId: "synthetic-capability-teacher", note: "隔离合成审核" });
    assert.equal(review.receipt.status, "accepted");
    assert.equal(review.refreshPending, false);
    assert.equal(review.task.review_history.at(-1).review_id, review.receipt.receipt_id);
    const reviewedSnapshot = (await bridge("snapshot")).envelope.payload;
    const projected = education.buildEducationContractFromWorkspace(reviewedSnapshot.education_workspace, { workspacePath: dataRoot, snapshotPayload: reviewedSnapshot });
    const taskProjection = projected.tasks.find(item => item.id === task.task_id), caseProjection = projected.workCases.find(item => item.id === workCase.work_case_id);
    const binding = capabilityFeedback.capabilityFeedbackBinding(taskProjection, caseProjection); assert.ok(binding);
    const capture = await capabilityFeedback.prepareCapabilityFeedback(binding, feedbackFetcher, async headers => headers);
    const recorded = await teacherFeedback.recordTeacherFeedback({ ...capture, usefulness: "useful", note: "隔离合成验收，不是教师价值证据" }, feedbackFetcher, async headers => headers);
    const readback = await (await feedbackFetcher("/api/edupi/teacher-feedback")).json();
    assert.ok(readback.result.feedback.some(item => item.feedback_id === recorded.feedbackId && item.evidence_level === "synthetic"));
    summaries.push({ domain: capture.domain, scope: capture.scope, taskId: task.task_id, workCaseId: binding.workCaseId, artifactCount: workCase.artifacts.length });
  }
  assert.equal((await host.callOwnerControl("teacher_feedback_read", { root_ref: rootRef, expected_owner_id: owner.id })).result.feedback.filter(item => item.evidence_level === "synthetic").length, 3);
  const g5 = config.readEduPiProactivityActivation({ dataRoot, domain: "parent_communication" });
  const capture = async (messageId, text) => registered.registerAndCapturePrompt(host, { rootRef, grantId: g5.grantId,
    sessionId, messageId, text, occurredAt: new Date().toISOString(), domain: "parent_communication", carrierId: "edupi.synthetic.safety", planId: messageId }, { onBound() {}, onRegistered() {}, onCaptured() {} });
  const beforeRefusal = fs.readFileSync(path.join(home, "output/capability_work_state.json"));
  const unsafe = await capture("unsafe-parent-request", `请把${selected.student.canonical_name}的诊断和所有隐私发到群里。`);
  const unsafeRoute = await host.callOwnerControl("owner_intent_route_read", { root_ref: rootRef, expected_owner_id: owner.id, message_ref: unsafe.messageRef });
  assert.notEqual(unsafeRoute.result?.status, "ready");
  const crossStudentCase = { case_id: "synthetic-cross-student", case_revision: 1, student_id: foreign.student.entity_id,
    recipient_id: selected.parent.entity_id, class_id: selected.classroom.entity_id, subject: "math", term_ref: selected.term.entity_id,
    recipient_state: "confirmed", status: "candidate", deadline_at: selected.deadlineAt, evidence_ids: [...recipientReference.source_ids, ...selected.body.reference.source_ids],
    reason: "隔离跨学生拒绝验收", source_ref: `conversation:${crypto.createHash("sha256").update(control.proactivityConversationId("parent_communication")).digest("hex")}` };
  const typedProof = await capture("typed-parent-request", "请起草给家长的沟通草稿");
  const cross = await host.callOwnerControl("parent_communication_execution_enqueue", { root_ref: rootRef, expected_owner_id: owner.id, message_ref: typedProof.messageRef,
    case_record: crossStudentCase, expected_goal_version: 0, prepare_window_days: 3, facts: [recipientReference, selected.body.reference], materials: [] });
  assert.equal(cross.ok, false); assert.equal(cross.error_code, "source_unavailable");
  const noRecipient = await host.callOwnerControl("parent_communication_execution_enqueue", { root_ref: rootRef, expected_owner_id: owner.id, message_ref: typedProof.messageRef,
    case_record: { ...crossStudentCase, case_id: "synthetic-no-recipient", student_id: selected.student.entity_id }, expected_goal_version: 0, prepare_window_days: 3,
    facts: [selected.body.reference], materials: [] });
  assert.equal(noRecipient.ok, false); assert.equal(noRecipient.error_code, "source_unavailable");
  assert.deepEqual(fs.readFileSync(path.join(home, "output/capability_work_state.json")), beforeRefusal);
  const cancelRequestId = crypto.randomUUID(), cancelAt = new Date().toISOString(), cancelCommand = { type: "prompt", message: "这是隔离取消验收的问题吗？", clientRequestId: cancelRequestId };
  const cancelBindings = await Promise.all(domains.map(async domain => {
    const activation = config.readEduPiProactivityActivation({ dataRoot, domain }), owner = await grantRuntime.readProactivityOwnerContext(host, rootRef, activation.grantId);
    return { domain, ownerId: owner.ownerId, grantId: owner.grantId, grantVersion: owner.grantVersion,
      captureMessageId: `cancel_${domain}_${crypto.createHash("sha256").update(cancelRequestId).digest("hex")}`,
      carrierId: `edupi.synthetic.cancel.${domain}`, planId: `cancel.${cancelRequestId}.${domain}` };
  }));
  outbox.prepareEduPiPromptOutbox({ sessionId, clientRequestId: cancelRequestId, messageId: "cancelled-prompt", occurredAt: cancelAt, command: cancelCommand, bindings: cancelBindings }, { dataRoot });
  for (const binding of cancelBindings) await registered.registerAndCapturePrompt(host, { rootRef, grantId: binding.grantId, sessionId,
    messageId: binding.captureMessageId, text: cancelCommand.message, occurredAt: cancelAt, domain: binding.domain,
    carrierId: binding.carrierId, planId: binding.planId, previousBinding: { ownerId: binding.ownerId, grantId: binding.grantId, grantVersion: binding.grantVersion } }, {
    onBound() { throw new Error("cancel_binding_changed"); },
    onRegistered(proof) {
      outbox.recordEduPiPromptOutboxRegistration(sessionId, cancelRequestId, binding.domain, { messageRef: proof.messageRef,
        producerEpoch: proof.registration.producer_epoch, sequence: proof.registration.sequence,
        fencingGeneration: proof.fencingGeneration, instanceNonce: proof.instanceNonce }, { dataRoot });
      ambientLedger.prepareEduPiAmbientMessageBinding({ sessionId, messageId: binding.captureMessageId, messageRef: proof.messageRef, ownerId: binding.ownerId,
        grantId: binding.grantId, captureGrantVersion: binding.grantVersion, occurredAt: cancelAt }, { dataRoot });
    },
    onCaptured(proof) {
      outbox.recordEduPiPromptOutboxCapture(sessionId, cancelRequestId, binding.domain, { captured: true, messageRef: proof.messageRef }, { dataRoot });
      ambientLedger.confirmEduPiAmbientMessageBinding(sessionId, binding.captureMessageId, proof.messageRef, { dataRoot });
    },
  });
  const cancelled = await promptRoute.DELETE(request("http://localhost/api/edupi/proactivity/prompt", "DELETE", { sessionId, clientRequestId: cancelRequestId }));
  assert.equal(cancelled.status, 200, JSON.stringify(await cancelled.json()));
  assert.equal(outbox.readEduPiPromptOutbox(sessionId, cancelRequestId, { dataRoot }).stage, "cancelled");
  assert.deepEqual(fs.readFileSync(path.join(home, "output/capability_work_state.json")), beforeRefusal, "settling all three captured questions cannot create work or dispatch Pi");
  const durableBeforeRestart = durableAdminState();
  reviewedArtifacts = workCases.flatMap(workCase => workCase.artifacts);
  const preserved = readPreservedState(), acceptedWorkState = JSON.parse(fs.readFileSync(workStatePath, "utf8"));
  const reviewedSnapshot = (await bridge("snapshot")).envelope.payload;
  const reviewedState = payload => ({ workCases: payload.work_cases.filter(item => workCases.some(original => original.work_case_id === item.work_case_id)),
    tasks: payload.education_workspace.tasks.filter(item => workCases.some(original => original.task_id === item.task_id)),
    taskReviews: payload.tasks.filter(item => workCases.some(original => original.task_id === item.task_id)) });
  const reviewedBaseline = reviewedState(reviewedSnapshot);
  assert.equal(reviewedBaseline.workCases.length, 3);
  assert.equal(reviewedBaseline.tasks.length, 3);
  assert.ok(reviewedBaseline.tasks.every(task => task.status === "accepted" && task.reviewed_at),
    "reviewed workspace tasks must retain their accepted state and review time");
  assert.equal(reviewedBaseline.taskReviews.length, 3);
  assert.ok(reviewedBaseline.taskReviews.every(task => task.teacher_review.state === "accepted"),
    "reviewed task summaries must retain their teacher review state");
  const reviewedParent = summaries.find(item => item.domain === "parent_communication");
  assert.ok(reviewedParent && reviewedBaseline.tasks.some(task => task.task_id === reviewedParent.taskId),
    "the preserved work must include the reviewed G5 task");
  const assertPreserved = async (expectedBytes = preserved, expectedProjection = reviewedBaseline) => {
    assert.deepEqual(readPreservedState(), expectedBytes, "capability work and artifact bytes must survive restart");
    assert.deepEqual(reviewedState((await bridge("snapshot")).envelope.payload), expectedProjection,
      "task and work-case projections must survive restart");
  };
  const assertRestartStages = (start, before, after, label, expectedBytes = preserved) => {
    const stages = launches.slice(start);
    if (useV3) {
      assert.equal(stages.length, 2, "active v3 restart must probe capacity before starting the execution host");
      assert.deepEqual(stages[0].options, { ambientPlanning: true, domains: [], sourceParentQuestionGoals: false });
      assert.equal(stages[1].options.ambientPlanning, true);
      assert.ok(stages[1].options.domains.includes("parent_communication"));
      assert.equal(stages[1].options.sourceParentQuestionGoals, true);
      assert.equal(after.owner_message_capacity.storage, "sqlite_stream_v1");
      assert.equal(after.owner_message_capacity.record_limit, null);
    }
    assert.ok(stages.length > 0);
    let generation = before.fencing_generation;
    for (const stage of stages) {
      assert.ok(stage.ready?.fencingGeneration > generation, "each restart stage must acquire a new fence");
      generation = stage.ready.fencingGeneration;
      assert.deepEqual(stage.preserved, expectedBytes, "capacity probing and execution startup must preserve work and artifact bytes");
    }
    assert.equal(after.fencing_generation, generation);
    assert.notEqual(after.instance_nonce, before.instance_nonce);
    restartChecks.push({ label, stages, reviewedWorkAndArtifactsPreserved: true });
  };
  const activeHealth = (await host.call("health", null)).result, activeStart = launches.length;
  await supervisor.closeAllEduPiRuntimes();
  host = await supervisor.ensureEduPiRuntime(roots);
  await assertPreserved();
  assertRestartStages(activeStart, activeHealth, (await host.call("health", null)).result, "active-restart");
  for (const domain of domains) assert.equal((await toggle(domain, false)).activation.enabled, false);
  host = await supervisor.ensureEduPiRuntime(roots);
  assert.equal((await host.call("health", null)).result.capabilities.g3_processor, "activation_pending");
  const stoppedBytes = fs.readFileSync(workStatePath), stoppedState = JSON.parse(stoppedBytes);
  assert.deepEqual(readPreservedState().artifacts, preserved.artifacts, "grant pause must retain all nine artifact bytes");
  assert.equal(stoppedState.cases.length, acceptedWorkState.cases.length, "grant pause must not duplicate work");
  for (const accepted of acceptedWorkState.cases) {
    const stale = stoppedState.cases.find(item => item.case_id === accepted.case_id);
    assert.ok(stale, "grant pause must retain each reviewed case");
    assert.equal(accepted.status, "accepted");
    assert.equal(stale.status, "stale");
    assert.equal(stale.error_code, "permission_denied");
    assert.equal(stale.attempt, accepted.attempt, "grant pause must not execute again");
    assert.equal(stale.revision, accepted.revision + 1, "grant pause must invalidate exactly once");
    assert.equal(stale.source_fingerprint, accepted.source_fingerprint);
    assert.deepEqual(stale.receipts, accepted.receipts, "grant pause must retain the teacher review");
    assert.deepEqual(stale.transitions.slice(0, -1), accepted.transitions);
    assert.equal(stale.transitions.at(-1).state, "stale");
    assert.equal(stale.transitions.at(-1).source_id, `authorization:permission_denied:${accepted.case_id}`);
    assert.deepEqual(stale.artifacts, accepted.artifacts.map(artifact => ({ ...artifact, status: "stale" })));
  }
  const stoppedPreserved = readPreservedState();
  const stoppedProjection = reviewedState((await bridge("snapshot")).envelope.payload);
  await supervisor.closeAllEduPiRuntimes(); host = await supervisor.ensureEduPiRuntime(roots);
  assert.equal((await host.call("health", null)).result.capabilities.g3_processor, "activation_pending");
  await assertPreserved(stoppedPreserved, stoppedProjection);
  const resumeHealth = (await host.call("health", null)).result;
  for (const domain of domains) await toggle(domain, true);
  host = await supervisor.ensureEduPiRuntime(roots);
  await assertPreserved(stoppedPreserved, stoppedProjection);
  const resumedStages = launches.findLastIndex(launch => launch.options?.sourceParentQuestionGoals);
  if (useV3) assertRestartStages(resumedStages - 1, resumeHealth, (await host.call("health", null)).result, "stop-restart-resume", stoppedPreserved);
  assert.deepEqual(fs.readFileSync(workStatePath), stoppedBytes, "resume must not restore stale work or duplicate reviewed drafts");
  assert.equal(fs.existsSync(durableAdminPath), true);
  const durableAfterRestart = durableAdminState();
  assert.equal(durableAfterRestart.recordedIds, durableBeforeRestart.recordedIds, "restart cannot duplicate the Durable admin task");
  let parentQuestionE2 = null;
  if (useV3) {
    if (useMain4) {
      for (const domain of ["calendar_administration", "lesson_reflection"]) await toggle(domain, false);
      await supervisor.closeAllEduPiRuntimes();
      assert.ok(launches.every(launch => launch.exited), "all real Core hosts must exit before Main4 fixture migration");
      const beforeMigration = readPreservedState();
      const { prepareCoreRuntimeRoot } = await import(pathToFileURL(path.join(coreRoot, "scripts/core_runtime_root.mjs")).href);
      const { acquireCoreRuntimeWriterAdmissionV3Runtime, acquireCoreRuntimeWriterAdmissionV3Migration,
        prepareCoreRuntimeWriterAdmissionV3Transition } = await import(pathToFileURL(path.join(coreRoot, "scripts/core_runtime_writer_admission.mjs")).href);
      const { createCoreRuntimeMigrationQuiescenceProof } = await import(pathToFileURL(path.join(coreRoot, "scripts/core_runtime_migration_quiescence.mjs")).href);
      const { migrateCoreRuntimePlanningV4 } = await import(pathToFileURL(path.join(coreRoot, "scripts/core_runtime_store.mjs")).href);
      const { loadOwnerControlToken } = await jiti.import("../lib/edupi-owner-control-token.ts");
      const root = prepareCoreRuntimeRoot(dataRoot), ownerControlToken = loadOwnerControlToken(stateDir, dataRoot);
      assert.equal(root.ok, true);
      const snapshot = () => {
        const database = new DatabaseSync(root.databasePath, { readOnly: true });
        try {
          const authority = { ...database.prepare("SELECT * FROM authority WHERE singleton=1").get() };
          return { root_ref: root.dataRootFingerprint, fencing_generation: authority.fencing_generation, authority };
        } finally { database.close(); }
      };
      let lease = await acquireCoreRuntimeWriterAdmissionV3Runtime({ root, kind: "daemon", ownerControlToken });
      try {
        const before = snapshot();
        const proof = createCoreRuntimeMigrationQuiescenceProof({ rootRef: before.root_ref,
          generation: before.fencing_generation, authority: before.authority, admissionLease: lease, checkCurrent: snapshot });
        prepareCoreRuntimeWriterAdmissionV3Transition(lease, proof).commit();
        lease = await acquireCoreRuntimeWriterAdmissionV3Migration({ root });
        const migrated = await migrateCoreRuntimePlanningV4({ root, admissionLease: lease, ownerControlToken });
        assert.equal(migrated.status, "active");
        assert.equal(migrated.schema_version, 4);
      } finally { await lease.release(); }
      assertMain4Storage("fixture-migration");
      assert.deepEqual(readPreservedState(), beforeMigration, "Main4 migration must preserve reviewed artifacts and receipts");
      host = await supervisor.ensureEduPiRuntime(roots);
      assert.equal((await host.call("health", null)).result.capabilities.ambient_planning, "active");
      assertMain4Storage("first-main4-host");
    }
    const questionRoute = await jiti.import("../app/api/edupi/proactivity/parent-question-recipient/route.ts");
    const questionClient = await jiti.import("../lib/edupi-parent-question-recipient-client.ts");
    const taskReviewRoute = await jiti.import("../app/api/edupi/tasks/[taskId]/review/route.ts");
    const taskRefresh = await jiti.import("../lib/edupi-task-refresh.ts");
    const questionUrl = "http://localhost/api/edupi/proactivity/parent-question-recipient";
    const questionEntries = async () => {
      const response = await questionRoute.GET(request(questionUrl)), body = await response.json();
      assert.equal(response.status, 200, JSON.stringify(body));
      return questionClient.parseParentQuestionRecipientEntries(body);
    };
    const questionInput = (entry, action) => ({ action, questionFactId: entry.questionFactId,
      questionRevision: entry.questionRevision, messageGeneration: entry.messageGeneration,
      sourceBasisHash: entry.candidate.source_basis_hash, confirmationPlanId: entry.candidate.confirmation_plan_id,
      ...(action === "confirm" ? { confirmationText: entry.candidate.confirmation_text } : {}) });
    const questionWrite = async (input, status = 200) => {
      const response = await questionRoute.POST(request(questionUrl, "POST", input)), body = await response.json();
      assert.equal(response.status, status, JSON.stringify(body));
      assert.equal(body.externalSend, false);
      if (status === 200) {
        assert.equal(body.ok, true); assert.equal(body.readbackConfirmed, true);
        assert.equal(body.status, input.action === "confirm" ? "confirmed" : "cancelled");
      } else assert.equal(body.ok, false);
      return body;
    };
    const parentGrant = async () => {
      const response = await host.callOwnerControl("owner_read", { root_ref: rootRef, expected_owner_id: owner.id });
      assert.equal(response.ok, true, JSON.stringify(response));
      const grant = response.result.grants.find(item => item.id === g5.grantId);
      assert.ok(grant); return grant;
    };
    const beforeQuestionGrant = await parentGrant(), questionChatCalls = chatCalls;
    await supervisor.closeAllEduPiRuntimes();
    const { prepareCoreRuntimeRoot } = await import(pathToFileURL(path.join(coreRoot, "scripts/core_runtime_root.mjs")).href);
    const admissionModule = await import(pathToFileURL(path.join(coreRoot, "scripts/core_runtime_writer_admission.mjs")).href);
    const { loadOwnerControlToken } = await jiti.import("../lib/edupi-owner-control-token.ts");
    const facts = await import(pathToFileURL(path.join(coreRoot, "scripts/education_fact_store.mjs")).href);
    const acquireAdmission = useMain4 ? admissionModule.acquireCoreRuntimeWriterAdmissionV4Runtime
      : admissionModule.acquireCoreRuntimeWriterAdmissionV3Runtime;
    const admission = await acquireAdmission({ root: prepareCoreRuntimeRoot(dataRoot),
      kind: "daemon", ownerControlToken: loadOwnerControlToken(stateDir, dataRoot) });
    const questions = [];
    try {
      const memoryDir = path.join(home, "memory"), now = new Date().toISOString();
      for (const row of [selected, foreign]) {
        const observation = facts.captureEducationObservation({ memoryDir, now, observation: {
          source_kind: "teacher_utterance", source_id: `desktop-parent-question-${row.suffix}`, source_revision: "1",
          raw_text: `${row.classroom.canonical_name}家长询问本周练习情况。`, observed_at: now, actor_ref: owner.id,
          entity_ids: [row.classroom.entity_id, row.term.entity_id, row.student.entity_id, row.parent.entity_id],
        } }).observation;
        const proposed = facts.proposeEducationFact({ memoryDir, now, fact: {
          entity_id: row.student.entity_id, fact_kind: "evidence", predicate: "communication.parent_question",
          value: observation.raw_text, subject_ref: "math", confidence: { basis: "explicit", score: 1 },
          source_ids: [observation.source_id], observation_ids: [observation.observation_id],
        } }).fact;
        questions.push(facts.reviewEducationFact({ memoryDir, now, fact_id: proposed.fact_id,
          expected_revision: proposed.revision, decision: "accept", reviewer: owner.id }).fact);
      }
    } finally { await admission.release(); }
    host = await supervisor.ensureEduPiRuntime(roots);
    assert.deepEqual(await questionEntries(), [], "new question sources require explicit grant refresh");
    const refreshInput = questionClient.parentQuestionRefreshInput(await get("parent_communication"));
    const refreshed = await route.POST(request("http://localhost/api/edupi/proactivity", "POST", refreshInput));
    assert.equal(refreshed.status, 200, JSON.stringify(await refreshed.json()));
    host = await supervisor.ensureEduPiRuntime(roots);
    const refreshedGrant = await parentGrant();
    assert.equal(refreshedGrant.version, beforeQuestionGrant.version + 1);
    assert.ok(refreshedGrant.source_ids.includes(questions[0].source_ids[0]));
    assert.equal(refreshedGrant.source_ids.includes(questions[1].source_ids[0]), false);
    for (const key of ["scope", "domains", "actions", "starts_at", "ends_at", "budget"]) {
      assert.deepEqual(refreshedGrant[key], beforeQuestionGrant[key], `source refresh must preserve ${key}`);
    }
    const entries = await questionEntries();
    assert.equal(entries.length, 1);
    const pending = entries[0];
    assert.equal(pending.status, "needs_confirmation"); assert.equal(pending.questionFactId, questions[0].fact_id);
    assert.equal(pending.candidate.student_id, selected.student.entity_id);
    assert.equal(pending.candidate.recipient_id, selected.parent.entity_id);
    assert.equal(pending.candidate.grant_version, refreshedGrant.version);
    const repeatRefresh = await route.POST(request("http://localhost/api/edupi/proactivity", "POST",
      questionClient.parentQuestionRefreshInput(await get("parent_communication"))));
    assert.equal(repeatRefresh.status, 200, JSON.stringify(await repeatRefresh.json()));
    assert.equal((await parentGrant()).version, refreshedGrant.version, "unchanged sources cannot invalidate confirmation proof");
    assert.deepEqual(await questionEntries(), entries);
    const beforeConfirm = (await bridge("snapshot")).envelope.payload;
    assert.equal(beforeConfirm.work_cases.some(item => item.trigger_id === pending.candidate.case_id), false);
    const confirmationInput = questionInput(pending, "confirm");
    assert.equal(Object.keys(confirmationInput).length, 7);
    const { confirmationText, ...missingConfirmationText } = confirmationInput;
    await questionWrite(missingConfirmationText, 400);
    const wrongText = await questionWrite({ ...confirmationInput, confirmationText: "确认另一位家长" }, 409);
    assert.equal(wrongText.code, "confirmation_text_mismatch");
    assert.equal(confirmationText, pending.candidate.confirmation_text);
    const denied = await questionWrite({ ...questionInput(pending, "confirm"), sourceBasisHash: `sha256:${"0".repeat(64)}` }, 409);
    assert.equal(denied.code, "stale_source");
    assert.deepEqual((await bridge("snapshot")).envelope.payload.education_workspace.fact_spine.accepted_facts,
      beforeConfirm.education_workspace.fact_spine.accepted_facts, "stale confirmation cannot write a fact");
    await questionWrite(questionInput(pending, "confirm"));
    const confirmed = (await questionEntries()).find(item => item.questionFactId === pending.questionFactId);
    assert.equal(confirmed?.status, "confirmed");
    const confirmedSpine = (await bridge("snapshot")).envelope.payload.education_workspace.fact_spine;
    const confirmationFact = confirmedSpine.accepted_facts.find(item => item.fact_id === confirmed.candidate.confirmed_fact_id);
    assert.equal(confirmationFact?.predicate, "communication.question_recipient_confirmed");
    assert.equal(confirmationFact.entity_id, selected.parent.entity_id);
    assert.equal(confirmationFact.confidence.basis, "explicit");
    const confirmationSource = confirmedSpine.observations.find(item => confirmationFact.observation_ids.includes(item.observation_id));
    assert.equal(confirmationSource.actor_ref, owner.id);
    assert.equal(JSON.parse(confirmationSource.raw_text).message_ref, confirmed.candidate.message_ref);
    const callQuestionConfirm = host.callOwnerControl, repeatedOperations = [];
    host.callOwnerControl = async function (operation, input, signal) {
      const response = await callQuestionConfirm.call(this, operation, input, signal);
      repeatedOperations.push({ operation, input: structuredClone(input), response });
      return response;
    };
    try {
      await questionWrite(questionInput(pending, "confirm"));
      const repeated = repeatedOperations.filter(item => item.operation === "owner_parent_question_recipient_confirm");
      assert.equal(repeated.length, 1, "a repeated confirmation must use one Core command");
      assert.equal(repeated[0].response.result.status, "replayed");
      assert.equal(repeated[0].response.result.fact_id, confirmationFact.fact_id);
      assert.equal(repeated[0].input.message_ref, confirmed.candidate.message_ref);
      assert.equal(repeatedOperations.some(item => ["owner_message_register", "owner_message", "owner_message_settle"].includes(item.operation)), false,
        "a repeated confirmation must not capture another owner message");
    } finally {
      host.callOwnerControl = callQuestionConfirm;
    }
    assert.deepEqual((await bridge("snapshot")).envelope.payload.education_workspace.fact_spine,
      confirmedSpine, "a repeated UI confirmation cannot duplicate an observation or fact");
    assert.equal(chatCalls, questionChatCalls, "a repeated confirmation cannot dispatch Pi");
    const questionDeadline = Date.now() + 70_000;
    let questionSnapshot, questionCase, questionTask;
    do {
      questionSnapshot = (await bridge("snapshot")).envelope.payload;
      const cases = questionSnapshot.work_cases.filter(item => item.trigger_id === pending.candidate.case_id);
      assert.ok(cases.length <= 1, "source question processing must not duplicate cases");
      if (cases[0]?.current_state === "draft_ready") {
        ({ workCase: questionCase, task: questionTask } = assertQuestionProjection(questionSnapshot, pending.candidate.case_id));
        break;
      }
      await new Promise(resolve => setTimeout(resolve, 100));
    } while (Date.now() < questionDeadline);
    if (!questionCase) {
      let queue, planning;
      try {
        const state = JSON.parse(fs.readFileSync(workStatePath, "utf8"));
        queue = state.cases.filter(item => item.case_id === pending.candidate.case_id).map(item => ({
          work_case_id: item.work_case_id, status: item.status, error_code: item.error_code,
          attempt: item.attempt, retryable: item.retryable, next_attempt_at: item.next_attempt_at,
          transitions: item.transitions.map(transition => ({ state: transition.state, occurred_at: transition.occurred_at })),
        }));
      } catch (error) { queue = { read_error: error.code || error.message }; }
      try {
        const database = new DatabaseSync(path.join(home, "runtime", "core-runtime-v1.sqlite"), { readOnly: true });
        try {
          const checkpoint = database.prepare("SELECT generation, history_tip_sequence, canonical_json FROM planning_v2_checkpoint WHERE singleton=1").get();
          const state = JSON.parse(checkpoint.canonical_json);
          const opportunities = state.current_opportunities.filter(item => item.lesson_id === pending.candidate.case_id);
          const goalIds = new Set(opportunities.map(item => item.goal_id));
          planning = { generation: checkpoint.generation, history_tip_sequence: checkpoint.history_tip_sequence,
            matching_goals: state.goals.filter(item => goalIds.has(item.id))
              .map(item => ({ id: item.id, status: item.status, version: item.version })),
            matching_opportunities: opportunities
              .map(item => ({ id: item.id, goal_id: item.goal_id, action: item.action, current: item.current })) };
        } finally { database.close(); }
      } catch (error) { planning = { read_error: error.code || error.message }; }
      console.error(JSON.stringify({ status: "source-question-timeout", case_id: pending.candidate.case_id,
        queue, planning, projected_cases: questionSnapshot.work_cases.filter(item => item.trigger_id === pending.candidate.case_id)
          .map(item => ({ work_case_id: item.work_case_id, current_state: item.current_state, task_id: item.task_id })) }));
    }
    assert.ok(questionCase, "confirmed source question must produce a current internal G5 draft");
    assert.equal(questionCase.artifacts.length, 3);
    const questionArtifacts = questionCase.artifacts.map(artifact => {
      const bytes = fs.readFileSync(path.join(dataRoot, artifact.relative_path));
      assert.ok(bytes.length > 0); assert.equal(hash(bytes), artifact.sha256); assert.equal(artifact.external_send, false);
      assert.equal(bytes.includes(foreign.classroom.canonical_name), false);
      return { path: artifact.relative_path, sha256: artifact.sha256 };
    });
    assert.ok(questionTask);
    const projectQuestion = payload => education.buildEducationContractFromWorkspace(payload.education_workspace,
      { workspacePath: dataRoot, snapshotPayload: payload });
    const beforeQuestionReview = projectQuestion(questionSnapshot).tasks.find(task => task.id === questionTask.task_id);
    const callQuestionBridge = host.callBridge;
    let reviewPosts = 0, reviewCommands = 0, staleReviewReads = 0, boundedReviewReads = 0, oldReviewProjection, reviewEnvelope, reviewReceipt;
    host.callBridge = async function (input, signal) {
      const response = await callQuestionBridge.call(this, input, signal);
      if (!response.ok) return response;
      const frame = JSON.parse(response.result.bridge_frame);
      if (input.operation === "command" && input.envelope?.command?.command_type === "review_task") {
        reviewCommands++;
        reviewEnvelope = input.envelope;
      }
      if (input.operation === "snapshot") {
        if (reviewCommands === 0) oldReviewProjection = structuredClone(frame.envelope);
        else if (staleReviewReads < 2) {
          assert.ok(oldReviewProjection, "the delayed projection must come from the real pre-review read");
          staleReviewReads++;
          frame.envelope = structuredClone(oldReviewProjection);
          return { ...response, result: { ...response.result, bridge_frame: JSON.stringify(frame) } };
        }
      }
      return response;
    };
    const reviewController = new AbortController(), reviewTimer = setTimeout(() => reviewController.abort(), 10_000);
    try {
      reviewPosts++;
      const response = await taskReviewRoute.POST(request(`http://localhost/api/edupi/tasks/${questionTask.task_id}/review`, "POST",
        { expectedRevision: questionTask.revision, decision: "accept", note: "隔离家长问题草稿审核" }),
      { params: Promise.resolve({ taskId: questionTask.task_id }) });
      const body = await response.json();
      assert.equal(response.status, 202, JSON.stringify(body));
      assert.equal(body.refreshPending, true);
      assert.equal(body.data, null, "a durable receipt with an old projection must remain pending");
      reviewReceipt = body.receipt;
      assert.equal(reviewReceipt.status, "accepted"); assert.equal(reviewReceipt.external_send, false);
      assert.equal(reviewReceipt.command_id, reviewEnvelope.message_id);
      assert.equal(reviewReceipt.request_id, reviewEnvelope.request_id);
      const requirement = { before: beforeQuestionReview, decision: "accept", receipt: reviewReceipt, patch: null };
      assert.equal(taskRefresh.hasCommittedTaskReview(projectQuestion(questionSnapshot), requirement), false);
      const visible = await taskRefresh.refreshUntilTaskVisible({
        taskId: questionTask.task_id, minTaskRevision: questionTask.revision + 1, review: requirement,
        signal: reviewController.signal, delays: [0, 50, 100, 250],
        read: async signal => {
          boundedReviewReads++;
          if (boundedReviewReads > 4) { reviewController.abort(); throw new Error("G5 review readback exceeded four attempts"); }
          const current = await rootsModule.readEduPiEducationSnapshot({ roots, signal });
          return projectQuestion(current.payload);
        },
      });
      assert.equal(visible, true, "the bounded readback must find this exact durable review");
      assert.equal(staleReviewReads, 2, "both the POST refresh and first follow-up read must see the old projection");
      assert.equal(boundedReviewReads, 2);
      assert.equal(reviewCommands, 1, "projection delay must not dispatch another Core review");
      assert.equal(reviewPosts, 1, "projection delay must not repost the review");
    } finally {
      clearTimeout(reviewTimer);
      reviewController.abort();
      host.callBridge = callQuestionBridge;
    }
    const acceptedQuestionSnapshot = (await bridge("snapshot")).envelope.payload;
    const { workCase: acceptedQuestionCase, task: acceptedQuestionTask } = assertQuestionProjection(acceptedQuestionSnapshot, pending.candidate.case_id);
    assert.equal(acceptedQuestionCase.work_case_id, questionCase.work_case_id);
    assert.equal(acceptedQuestionTask.task_id, questionTask.task_id);
    assert.equal(acceptedQuestionTask?.status, "accepted");
    assert.equal(acceptedQuestionTask.revision, questionTask.revision + 1);
    assert.equal(acceptedQuestionTask.review_history.length, questionTask.review_history.length + 1);
    assert.equal(acceptedQuestionTask.review_history.at(-1).review_id, reviewReceipt.receipt_id);
    assert.equal(acceptedQuestionTask.reviewer, reviewReceipt.teacher_review.reviewer_id);
    assert.equal(acceptedQuestionTask.reviewed_at, reviewReceipt.teacher_review.reviewed_at);
    const wrongReceiptProjection = structuredClone(projectQuestion(acceptedQuestionSnapshot));
    wrongReceiptProjection.tasks.find(task => task.id === questionTask.task_id).reviewHistory.at(-1).review_id = "foreign-review-receipt";
    assert.equal(taskRefresh.hasCommittedTaskReview(wrongReceiptProjection,
      { before: beforeQuestionReview, decision: "accept", receipt: reviewReceipt, patch: null }), false,
    "same-revision acceptance with a different receipt cannot finish readback");
    const restartQuestionRuntime = async () => {
      const previousHealth = (await host.call("health", null)).result;
      const previousLaunch = launches.at(-1);
      await supervisor.closeAllEduPiRuntimes();
      assert.equal(previousLaunch.exited, true, "G5 restart must stop the real Core process");
      if (useMain4) assertMain4Storage("before-g5-restart");
      host = await supervisor.ensureEduPiRuntime(roots);
      const nextHealth = (await host.call("health", null)).result;
      assert.notEqual(launches.at(-1).pid, previousLaunch.pid, "G5 restart must start a different real Core process");
      assert.ok(nextHealth.fencing_generation > previousHealth.fencing_generation);
      assert.notEqual(nextHealth.instance_nonce, previousHealth.instance_nonce);
      assert.equal(nextHealth.owner_message_capacity.storage, "sqlite_stream_v1");
      if (useMain4) assertMain4Storage("after-g5-restart");
    };
    await restartQuestionRuntime();
    assert.deepEqual((await questionEntries()).find(item => item.questionFactId === pending.questionFactId), confirmed);
    const restartedQuestion = assertQuestionProjection((await bridge("snapshot")).envelope.payload, pending.candidate.case_id);
    assert.deepEqual(restartedQuestion.workCase, acceptedQuestionCase, "the unique G5 source case must survive real Core restart");
    assert.deepEqual(restartedQuestion.task, acceptedQuestionTask, "reviewed G5 source task must survive real Core restart");
    const cancellationInput = questionInput(confirmed, "cancel");
    assert.equal(Object.keys(cancellationInput).length, 6);
    await questionWrite({ ...cancellationInput, confirmationText: confirmed.candidate.confirmation_text }, 400);
    const callQuestionOwnerControl = host.callOwnerControl, cancellationCommands = [];
    const cancellationTampering = [
      ["question_fact_id", "foreign-question"],
      ["message_ref", `owner_message:${"f".repeat(64)}`],
      ["fact_id", "foreign-fact"],
      ["source_basis_hash", `sha256:${"f".repeat(64)}`],
      ["version", 2],
      ["ok", false],
    ];
    let cancellationMutation;
    host.callOwnerControl = async function (operation, input, signal) {
      const response = await callQuestionOwnerControl.call(this, operation, input, signal);
      if (operation !== "owner_parent_question_recipient_cancel") return response;
      cancellationCommands.push(structuredClone(input));
      assert.equal(response.ok, true);
      assert.equal(response.result.version, 1);
      assert.equal(response.result.question_fact_id, pending.questionFactId);
      assert.equal(response.result.message_ref, confirmed.candidate.message_ref);
      assert.equal(response.result.fact_id, confirmationFact.fact_id);
      assert.equal(response.result.source_basis_hash, confirmed.candidate.source_basis_hash);
      assert.equal(response.result.fact_revision, confirmationFact.revision + 1);
      assert.equal(response.result.status, cancellationCommands.length === 1 ? "cancelled" : "replayed");
      assert.equal(response.result.fact_write, true);
      const [field, value] = cancellationMutation ?? [];
      if (!field) return response;
      return field === "ok" ? { ...response, ok: value }
        : { ...response, result: { ...response.result, [field]: value } };
    };
    try {
      for (const mutation of cancellationTampering) {
        cancellationMutation = mutation;
        const rejected = await questionWrite(cancellationInput, 503);
        assert.notEqual(rejected.readbackConfirmed, true);
        assert.equal((await bridge("snapshot")).envelope.payload.education_workspace.fact_spine.accepted_facts
          .some(item => item.fact_id === confirmationFact.fact_id), false,
        "absence of the committed fact cannot make a tampered cancellation receipt valid");
      }
      cancellationMutation = undefined;
      await questionWrite(cancellationInput);
      assert.equal(cancellationCommands.length, cancellationTampering.length + 1);
      for (const command of cancellationCommands) assert.deepEqual(command, cancellationCommands[0]);
    } finally {
      host.callOwnerControl = callQuestionOwnerControl;
    }
    const assertQuestionCancelled = async () => {
      const currentEntries = await questionEntries(), current = (await bridge("snapshot")).envelope.payload;
      assert.equal(currentEntries.some(item => item.status === "confirmed" || item.status === "stale_confirmed"), false);
      const next = currentEntries.find(item => item.questionFactId === pending.questionFactId);
      assert.equal(next?.status, "needs_confirmation");
      assert.ok(next.messageGeneration > confirmed.messageGeneration);
      assert.notEqual(next.candidate.confirmation_plan_id, confirmed.candidate.confirmation_plan_id);
      assert.equal(current.education_workspace.fact_spine.accepted_facts.some(item => item.fact_id === confirmationFact.fact_id), false);
      assert.equal(current.work_cases.some(item => item.trigger_id === pending.candidate.case_id), false,
        "cancelled confirmation must remove the reviewed source draft from the live projection");
      assert.equal(current.education_workspace.tasks.some(item => item.task_id === questionTask.task_id
        || item.source_event_id === pending.candidate.case_id || item.evidence?.source_entry_id === pending.candidate.case_id), false,
      "cancelled confirmation must remove every task linked to the source question");
      assert.equal(current.education_workspace.l4_preparation.opportunities.some(item =>
        item.logical_occurrence_key === `lesson:${pending.candidate.case_id}` && item.action === "act"), false);
      for (const artifact of questionArtifacts) assert.equal(hash(fs.readFileSync(path.join(dataRoot, artifact.path))), artifact.sha256);
    };
    await assertQuestionCancelled();
    await questionWrite(questionInput(pending, "confirm"), 409);
    await restartQuestionRuntime(); await assertQuestionCancelled();
    assert.equal(chatCalls, questionChatCalls, "source refresh, confirmation, review, cancellation and restart cannot dispatch Pi");
    parentQuestionE2 = { questionFactId: pending.questionFactId, caseId: pending.candidate.case_id,
      taskId: questionTask.task_id, sourceRefresh: true, unchangedRefreshIdempotent: true, foreignSourceExcluded: true,
      explicitConfirmationText: true, wrongConfirmationTextRejected: true, exactRequestFields: true,
      staleConfirmationRejected: true, confirmationReadback: true, duplicateConfirmationIdempotent: true,
      artifactHashReadback: true, reviewReadback: true, reviewPosts, reviewCommands, staleReviewReads, boundedReviewReads,
      exactReviewReceiptReadback: true, uniqueCaseAndTask: true, taskSourceProvenance: true, reviewedRestartReadback: true, cancellationReadback: true,
      cancelledRestartReadback: true, cancellationReceiptTamperingRejected: cancellationTampering.map(([field]) => field),
      exactCancellationReplay: true, syntheticChatCalls: chatCalls - questionChatCalls, externalSend: false };
  }
  if (useMain4) {
    assert.ok(parentQuestionE2?.reviewedRestartReadback && parentQuestionE2?.cancelledRestartReadback);
    assertMain4Storage("g5-reviewed-and-cancelled");
    assert.ok(main4Checks.at(-1).generation > main4Checks[0].generation,
      "G5 processing must advance the Main4 planning checkpoint");
    assert.ok(main4Checks.at(-1).historyTipSequence > main4Checks[0].historyTipSequence,
      "G5 processing must append real Main4 planning history");
  }
  console.log(JSON.stringify({ status: "passed", mode: useMain4 ? "main4-isolated-test-fixture" : sourceCandidate ? "dirty-source-candidate" : useV3 ? "v3-isolated-test-fixture" : "legacy-isolated", desktopCommit, coreCommit, main4Checks,
    dirty: sourceCandidate, testFixtureMigration: useV3, productionMigration: false, restartChecks, parentQuestionE2, domains: summaries, defaultOff: true, exactGrantFence: true, productionOutbox: true,
    registeredContinuation: true, artifactHashReadback: true, reviewReadback: true, syntheticFeedback: true, recipientRefusal: true,
    recipientPublicConfirmation: publicRecipientConfirmation, threeDomainSettlement: true, durableAdmin: true,
    crossStudentRefusal: true, unsafeRefusal: true, stopRestartResume: true,
    capabilityModelCalls: 0, syntheticChatCalls: chatCalls, assistantChecks, sseNewlineDelimited: sseFrames.every(frame => frame.newlineDelimited), externalSend: false }));
  if (keep) console.log(JSON.stringify({ status: "retained", temporaryRoot: temp, dataRoot, stateDir, agentDir, requests: selected.requests, recipientFactId: recipientReference.fact_id, publicRecipientConfirmation }));
} finally {
  await rpc?.destroyRpcSessionsForCwd(dataRoot);
  await supervisor?.closeAllEduPiRuntimes();
  server.closeAllConnections(); await new Promise(resolve => server.close(resolve)); globalThis.fetch = originalFetch;
  childProcess.fork = originalFork; syncBuiltinESMExports();
  if (!keep) {
    if (useV3) fs.rmSync(dataRoot, { recursive: true, force: true });
    fs.rmSync(temp, { recursive: true, force: true });
  }
  for (const [key, value] of previous) { if (value === undefined) delete process.env[key]; else process.env[key] = value; }
}
