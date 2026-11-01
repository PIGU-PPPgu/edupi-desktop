#!/usr/bin/env node
import assert from "node:assert/strict";
import crypto from "node:crypto";
import fs from "node:fs";
import http from "node:http";
import os from "node:os";
import path from "node:path";
import { DatabaseSync } from "node:sqlite";
import { pathToFileURL } from "node:url";
import { createJiti } from "jiti";
import { seedCapabilityCanary } from "./edupi-capability-canary-fixture.mjs";

assert.equal(process.platform, "darwin", "this canary covers macOS only");
assert.ok(process.env.EDUPI_CORE_ROOT && path.isAbsolute(process.env.EDUPI_CORE_ROOT), "EDUPI_CORE_ROOT is required");
const coreRoot = fs.realpathSync(process.env.EDUPI_CORE_ROOT), temp = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), "edupi-capability-canary-e2-")));
const dataRoot = path.join(temp, "data"), stateDir = path.join(temp, "state"), agentDir = path.join(temp, "agent"), home = path.join(dataRoot, ".edupi");
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
const environment = { EDUPI_PROJECT_ROOT: dataRoot, EDUPI_DATA_ROOT: dataRoot, EDUPI_DATA_ALLOWED_ROOT: temp,
  EDUPI_CORE_ROOT: coreRoot, EDUPI_CORE_ALLOWED_ROOT: path.dirname(coreRoot), EDUPI_HOME: home,
  EDUPI_MEMORY_DIR: path.join(home, "memory"), EDUPI_OUTPUT_DIR: path.join(home, "output"), EDUPI_LOCK_DIR: path.join(home, "locks"),
  PI_DESKTOP_STATE_DIR: stateDir, PI_DESKTOP_API_TOKEN: token, PI_CODING_AGENT_DIR: agentDir, PI_OFFLINE: "1", EDUPI_DESKTOP_ISOLATED_CANARY: "1" };
const previous = new Map([...Object.keys(environment), "EDUPI_AMBIENT_PLANNING"].map(key => [key, process.env[key]]));
Object.assign(process.env, environment); delete process.env.EDUPI_AMBIENT_PLANNING;
const originalFetch = globalThis.fetch;
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
  const outbox = await jiti.import("../lib/edupi-prompt-outbox.ts");
  const ambientLedger = await jiti.import("../lib/edupi-ambient-message-ledger.ts");
  const config = await jiti.import("../lib/edupi-proactivity-config.ts");
  const sessionReader = await jiti.import("../lib/session-reader.ts");
  supervisor = await jiti.import("../lib/edupi-runtime-supervisor.ts");
  rpc = await jiti.import("../lib/rpc-manager.ts");
  const roots = rootsModule.resolveEduPiBridgeRoots(), domains = ["calendar_administration", "lesson_reflection", "parent_communication"];
  const get = async domain => {
    const response = await route.GET(request(`http://localhost/api/edupi/proactivity?domain=${domain}`)), state = await response.json();
    assert.equal(response.status, 200, JSON.stringify(state)); return state;
  };
  const toggle = async (domain, enabled) => {
    const state = await get(domain), scope = state.scopes.find(item => item.classId === selected.classroom.entity_id && item.ready);
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
  const deadline = Date.now() + 15_000;
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
  const { buildCommandEnvelope } = await import(pathToFileURL(path.join(coreRoot, "scripts/edupi_bridge_command.mjs")).href);
  const feedbackFetcher = async (_url, init = {}) => init.method === "POST"
    ? feedbackRoute.POST(request("http://localhost/api/edupi/teacher-feedback", "POST", JSON.parse(init.body)))
    : feedbackRoute.GET(request("http://localhost/api/edupi/teacher-feedback"));
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
    const reviewedAt = new Date().toISOString(), source = { source_id: task.task_id, source_kind: "core_task", source_hash: snapshot.state_hash, evidence_ids: [workCase.trigger_id] };
    const envelope = buildCommandEnvelope({ messageId: `review-${task.task_id}`, requestId: `review-${task.task_id}`, issuedAt: reviewedAt,
      snapshotId: snapshot.snapshot_id, idempotencyKey: `review-${task.task_id}`, provenance: [{ ...source, source_path: null, observed_at: reviewedAt, actor: "core", parent_ids: [] }],
      teacherReview: { state: "pending_review", reviewer_id: "synthetic-capability-teacher", reviewed_at: null, note: "隔离合成审核", revision: task.revision },
      command: { command_type: "review_task", task_id: task.task_id, expected_revision: task.revision, decision: "accept", patch: null, rollback_id: null, source, note: "隔离合成审核" } });
    assert.equal((await bridge("command", { envelope })).receipt.payload.status, "accepted");
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
  for (const domain of domains) assert.equal((await toggle(domain, false)).activation.enabled, false);
  host = await supervisor.ensureEduPiRuntime(roots);
  assert.equal((await host.call("health", null)).result.capabilities.g3_processor, "activation_pending");
  const stoppedBytes = fs.readFileSync(path.join(home, "output/capability_work_state.json"));
  await supervisor.closeAllEduPiRuntimes(); host = await supervisor.ensureEduPiRuntime(roots);
  assert.equal((await host.call("health", null)).result.capabilities.g3_processor, "activation_pending");
  assert.deepEqual(fs.readFileSync(path.join(home, "output/capability_work_state.json")), stoppedBytes);
  for (const domain of domains) await toggle(domain, true);
  host = await supervisor.ensureEduPiRuntime(roots);
  assert.deepEqual(fs.readFileSync(path.join(home, "output/capability_work_state.json")), stoppedBytes, "resume never executes foreign grants or duplicates reviewed drafts");
  assert.equal(fs.existsSync(durableAdminPath), true);
  const durableAfterRestart = durableAdminState();
  assert.equal(durableAfterRestart.recordedIds, durableBeforeRestart.recordedIds, "restart cannot duplicate the Durable admin task");
  console.log(JSON.stringify({ status: "passed", domains: summaries, defaultOff: true, exactGrantFence: true, productionOutbox: true,
    registeredContinuation: true, artifactHashReadback: true, reviewReadback: true, syntheticFeedback: true, recipientRefusal: true,
    recipientPublicConfirmation: publicRecipientConfirmation, threeDomainSettlement: true, durableAdmin: true,
    crossStudentRefusal: true, unsafeRefusal: true, stopRestartResume: true,
    capabilityModelCalls: 0, syntheticChatCalls: chatCalls, assistantChecks, sseNewlineDelimited: sseFrames.every(frame => frame.newlineDelimited), externalSend: false }));
  if (keep) console.log(JSON.stringify({ status: "retained", temporaryRoot: temp, dataRoot, stateDir, agentDir, requests: selected.requests, recipientFactId: recipientReference.fact_id, publicRecipientConfirmation }));
} finally {
  await rpc?.destroyRpcSessionsForCwd(dataRoot);
  await supervisor?.closeAllEduPiRuntimes();
  server.closeAllConnections(); await new Promise(resolve => server.close(resolve)); globalThis.fetch = originalFetch;
  if (!keep) fs.rmSync(temp, { recursive: true, force: true });
  for (const [key, value] of previous) { if (value === undefined) delete process.env[key]; else process.env[key] = value; }
}
