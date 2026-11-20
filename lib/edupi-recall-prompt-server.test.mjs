import assert from "node:assert/strict";
import crypto from "node:crypto";
import { execFile } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import test from "node:test";
import { promisify } from "node:util";
import { createJiti } from "jiti";
import { SessionManager } from "@earendil-works/pi-coding-agent";

const jiti = createJiti(import.meta.url, { tsconfigPaths: true, fsCache: false });
const { createEduPiRecallPromptService, recallPromptMetadata } = await jiti.import("./edupi-recall-prompt-server.ts");
const settings = await jiti.import("./edupi-recall-settings-server.ts");
const config = await jiti.import("./edupi-recall-config.ts");
const authorization = await jiti.import("./edupi-recall-authorization.ts");
const outboxes = await jiti.import("./edupi-prompt-outbox.ts");
const { inspectEduPiPromptSession } = await jiti.import("./edupi-prompt-reconciliation.ts");
const { predictEduPiOwnerMessageRef } = await jiti.import("./edupi-ambient-message-runtime.ts");
const { settleRegisteredPrompt, registerAndCapturePrompt } = await jiti.import("./edupi-registered-prompt.ts");
const { proactivityConversationId } = await jiti.import("./edupi-proactivity-control.ts");
const approved = { approveNormal: () => true }, now = "2026-11-18T00:00:00.000Z";
const hash = value => `sha256:${crypto.createHash("sha256").update(value).digest("hex")}`;
const rootRef = `sha256:${"9".repeat(64)}`, ownerId = "synthetic-r04-owner";
const binding = { enabled: true, purpose: "r04_recall_answer", ownerId, grantId: "r04_recall_aabbcc", grantVersion: 1,
  scope: { classId: "synthetic-class", subject: "数学", termId: "synthetic-term" },
  model: { provider: "synthetic-provider", modelId: "synthetic-model" }, budgetId: "r04_recall_budget_aabbcc",
  limit: 2, validUntil: "2026-11-19T00:00:00.000Z", consentId: "synthetic-r04-consent" };
const epoch = "a".repeat(64);

async function fixture(t, { approval = true, active = true } = {}) {
  const root = fs.realpathSync(fs.mkdtempSync("/tmp/edupi-r04-prompts-server-"));
  fs.chmodSync(root, 0o700);
  const options = { dataRoot: path.join(root, "data"), stateDir: path.join(root, "state"), env: {}, now };
  for (const directory of [options.dataRoot, options.stateDir]) fs.mkdirSync(directory, { mode: 0o700 });
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  if (active) await config.writeEduPiRecallConfig(binding, { ...options, expectedUpdatedAt: null }, approved);
  const manager = SessionManager.create(options.dataRoot, path.join(root, "sessions"));
  manager.appendMessage({ role: "user", content: "合成历史", timestamp: Date.parse(now) });
  const input = { sessionId: manager.getSessionId(), clientRequestId: "synthetic-request-1",
    message: " \t合成班会由谁主持？\n", occurredAt: now };
  const grant = { id: binding.grantId, version: 1, status: "active",
    ...settings.recallGrantSpec(binding.scope, options, binding.budgetId, binding.limit, binding.validUntil) };
  const events = [], commands = [];
  const failures = { register: false, capture: false, afterCapture: null, sendBeforeMarker: false,
    sendAfterMarker: false, missingAcceptedMarker: false, inspect: null };
  const registrations = new Map();
  const host = {
    get recallAnswersActive() { return config.readEduPiRecallConfig(options, approved).enabled; },
    async call(operation) {
      events.push({ operation });
      if (operation === "health") return { ok: true, result: {
        data_root_fingerprint: rootRef, fencing_generation: 1, instance_nonce: "synthetic-instance",
      } };
      assert.equal(operation, "owner_read");
      return { ok: true, result: { root_ref: rootRef, owner: { id: ownerId, root_ref: rootRef }, grants: [structuredClone(grant)] } };
    },
    async callOwnerControl(operation, payload) {
      events.push({ operation, payload: structuredClone(payload) });
      assert.equal(payload.root_ref, rootRef);
      assert.equal(payload.expected_owner_id, ownerId);
      assert.equal(payload.grant_id, binding.grantId);
      assert.equal(payload.expected_grant_version, 1);
      const sourceRef = `conversation:${hash(payload.conversation_id).slice(7)}`;
      const messageRef = predictEduPiOwnerMessageRef(rootRef, ownerId, payload.message_id, "teaching_preparation", payload.conversation_id);
      if (operation === "owner_message_register") {
        if (failures.register) throw new Error("synthetic_registration_failure");
        const replayed = registrations.has(payload.message_id);
        registrations.set(payload.message_id, structuredClone(payload));
        return { ok: true, result: { version: 1, status: "registered", root_ref: rootRef, owner_id: ownerId,
          grant_id: binding.grantId, grant_version: 1, source_ref: sourceRef, message_ref: messageRef,
          occurred_at: payload.occurred_at, carrier_id: payload.carrier_id, plan_id: payload.plan_id,
          producer_epoch: epoch, sequence: 1, fencing_generation: 1, instance_nonce: "synthetic-instance", replayed,
          apply: false, live_authority: false, model_execute: false, external_send: false } };
      }
      assert.equal(operation, "owner_message");
      assert.equal(payload.action, "capture");
      assert.equal(payload.text, registrations.get(payload.message_id)?.text);
      if (failures.capture) return { ok: false, error_code: "synthetic_capture_failed" };
      await failures.afterCapture?.();
      return { ok: true, result: { receipt: { action: "capture", message_ref: messageRef, revision: 1,
        owner_id: ownerId, root_ref: rootRef, capture_grant_version: 1, source_ref: sourceRef,
        received_at: now, recorded_at: now, sender_kind: "local_owner_authenticated",
        apply: false, live_authority: false, external_send: false }, replayed: false } };
    },
  };
  const deps = {
    options: () => options, runtime: async () => host,
    sessionPath: async sessionId => sessionId === input.sessionId ? manager.getSessionFile() : null,
    inspectSession: (entry, file) => failures.inspect ?? inspectEduPiPromptSession(entry, file),
    dispatch: async entry => {
      commands.push(structuredClone(entry.command));
      if (failures.sendBeforeMarker) throw new Error("synthetic_no_acceptance");
      const commandHash = hash(JSON.stringify(entry.command));
      manager.appendCustomEntry("edupi_prompt_dispatch_v1", {
        sessionId: input.sessionId, clientRequestId: entry.clientRequestId, commandHash,
      });
      const userEntryId = manager.appendMessage({ role: "user", content: [{ type: "text", text: entry.command.message }],
        timestamp: Date.parse(now) });
      if (!failures.missingAcceptedMarker) manager.appendCustomEntry("edupi_prompt_accepted_v1", {
        sessionId: input.sessionId, clientRequestId: entry.clientRequestId, commandHash, userEntryId,
      });
      if (failures.sendAfterMarker) throw new Error("synthetic_lost_ack");
    },
    ...(approval ? approved : {}),
  };
  return { root, options, manager, input, grant, events, commands, host, failures, deps,
    service: createEduPiRecallPromptService(deps),
    outbox: () => outboxes.readEduPiPromptOutbox(input.sessionId, input.clientRequestId, options),
    intent: () => authorization.readRecallIntent({ sessionId: input.sessionId, clientRequestId: input.clientRequestId }, options, approved) };
}
const code = expected => error => error?.code === expected;

function readOnlySnapshot(root) {
  return Object.fromEntries(fs.readdirSync(root, { recursive: true, withFileTypes: true })
    .filter(item => item.isFile()).map(item => {
      const file = path.join(item.parentPath, item.name);
      return [path.relative(root, file), hash(fs.readFileSync(file))];
    }));
}
test("lost ACK then read-only accepted inspection permits the next new recall request without replaying the old one", async t => {
  const f = await fixture(t);
  f.failures.sendAfterMarker = true;
  assert.equal((await f.service.submit(f.input)).status, "uncertain");
  assert.equal(f.outbox().stage, "pi_unknown");
  const before = readOnlySnapshot(f.root);
  assert.equal((await f.service.inspect(f.input.sessionId, f.input.clientRequestId)).status, "accepted");
  assert.deepEqual(readOnlySnapshot(f.root), before);
  assert.equal(f.outbox().stage, "pi_unknown");
  f.failures.sendAfterMarker = false;
  const next = { ...f.input, clientRequestId: "synthetic-next-question", message: "合成第二问由谁记录？" };
  assert.equal((await f.service.submit(next)).status, "accepted");
  assert.equal(f.outbox().stage, "pi_accepted");
  assert.deepEqual(f.commands.map(command => command.clientRequestId), [f.input.clientRequestId, next.clientRequestId]);
  assert.equal(f.events.filter(event => event.operation === "owner_message_register").length, 2);
  assert.equal(f.events.filter(event => event.operation === "owner_message").length, 2);
  assert.equal(authorization.readRecallIntent({ sessionId: next.sessionId, clientRequestId: next.clientRequestId },
    f.options, approved).readyForDispatch, true);
});
test("a new request cannot clear a prior unknown recall without its exact accepted SDK marker", async t => {
  const f = await fixture(t);
  f.failures.missingAcceptedMarker = true;
  assert.equal((await f.service.submit(f.input)).status, "uncertain");
  const before = readOnlySnapshot(f.root), calls = f.events.length;
  await assert.rejects(f.service.submit({ ...f.input, clientRequestId: "must-remain-blocked" }), code("recall_prior_unresolved"));
  assert.equal(f.commands.length, 1);
  assert.equal(f.events.length, calls);
  assert.equal(f.outbox().stage, "pi_unknown");
  assert.deepEqual(readOnlySnapshot(f.root), before);
});
test("a new R04 question cannot reconcile or borrow an unknown ordinary G1 outbox even with SDK acceptance", async t => {
  const f = await fixture(t), clientRequestId = "ordinary-g1-question";
  const command = { type: "prompt", message: "普通课前准备", clientRequestId };
  const messageRef = `owner_message:${"7".repeat(64)}`;
  outboxes.prepareEduPiPromptOutbox({
    sessionId: f.input.sessionId, clientRequestId, messageId: "ordinary-message", occurredAt: now, command,
    bindings: [{ domain: "teaching_preparation", ownerId, grantId: "ordinary-g1-grant", grantVersion: 1,
      captureMessageId: "ordinary-message", carrierId: "edupi.desktop.teaching_preparation", planId: "ordinary.g1.plan" }],
  }, f.options);
  outboxes.recordEduPiPromptOutboxRegistration(f.input.sessionId, clientRequestId, "teaching_preparation", {
    messageRef, producerEpoch: epoch, sequence: 1, fencingGeneration: 1, instanceNonce: "synthetic-instance",
  }, f.options);
  outboxes.recordEduPiPromptOutboxCapture(f.input.sessionId, clientRequestId, "teaching_preparation", { captured: true, messageRef }, f.options);
  outboxes.markEduPiPromptOutboxPiDispatching(f.input.sessionId, clientRequestId, f.options);
  outboxes.markEduPiPromptOutboxPiUnknown(f.input.sessionId, clientRequestId, f.options);
  const commandHash = hash(JSON.stringify(command));
  f.manager.appendCustomEntry("edupi_prompt_dispatch_v1", { sessionId: f.input.sessionId, clientRequestId, commandHash });
  const userEntryId = f.manager.appendMessage({ role: "user", content: command.message, timestamp: Date.parse(now) });
  f.manager.appendCustomEntry("edupi_prompt_accepted_v1", { sessionId: f.input.sessionId, clientRequestId, commandHash, userEntryId });
  const old = outboxes.readEduPiPromptOutbox(f.input.sessionId, clientRequestId, f.options);
  assert.equal(inspectEduPiPromptSession(old, f.manager.getSessionFile()), "confirmed");
  const before = readOnlySnapshot(f.root);
  await assert.rejects(f.service.submit(f.input), code("recall_prior_unresolved"));
  assert.deepEqual(readOnlySnapshot(f.root), before);
  assert.deepEqual(f.commands, []);
  assert.deepEqual(f.events, []);
});
test("read-only recall inspect proves a lost ACK through actual SDK markers without mutation or redispatch after stop", async t => {
  const f = await fixture(t);
  f.failures.sendAfterMarker = true;
  assert.equal((await f.service.submit(f.input)).status, "uncertain");
  const configRead = config.readEduPiRecallConfig(f.options, approved);
  await config.writeEduPiRecallConfig({ enabled: false }, { ...f.options, expectedUpdatedAt: configRead.config.updatedAt });
  const before = readOnlySnapshot(f.root), events = f.events.length, commands = f.commands.length;
  for (let i = 0; i < 3; i++) {
    assert.equal((await f.service.inspect(f.input.sessionId, f.input.clientRequestId)).status, "accepted");
  }
  assert.deepEqual(readOnlySnapshot(f.root), before);
  assert.equal(f.events.length, events);
  assert.equal(f.commands.length, commands);
  assert.equal(f.outbox().stage, "pi_unknown", "inspection does not promote the outbox");
});
test("recall inspect never dispatches a missing, mismatched or uncertain intent", async t => {
  const f = await fixture(t);
  assert.equal((await f.service.inspect(f.input.sessionId, f.input.clientRequestId)).status, "not_sent");
  assert.deepEqual(f.events, []);
  f.failures.missingAcceptedMarker = true;
  assert.equal((await f.service.submit(f.input)).status, "uncertain");
  const before = readOnlySnapshot(f.root), count = f.commands.length;
  assert.equal((await f.service.inspect(f.input.sessionId, f.input.clientRequestId)).status, "uncertain");
  f.failures.inspect = "mismatch";
  assert.equal((await f.service.inspect(f.input.sessionId, f.input.clientRequestId)).status, "unavailable");
  assert.equal((await f.service.inspect("another-session", f.input.clientRequestId)).status, "not_sent");
  await assert.rejects(f.service.inspect("", f.input.clientRequestId), code("recall_invalid_input"));
  assert.equal(f.commands.length, count);
  assert.deepEqual(readOnlySnapshot(f.root), before);
});

test("default gate and exact four-field intent body reject client authority without any Core or SDK send", async t => {
  const f = await fixture(t, { approval: false });
  await assert.rejects(f.service.submit(f.input), code("recall_normal_not_approved"));
  for (const key of ["ownerId", "grantId", "grantVersion", "model", "budgetId", "approveNormal", "conversationId", "command", "rawQuery"]) {
    await assert.rejects(f.service.submit({ ...f.input, [key]: "untrusted" }), code("recall_invalid_input"));
  }
  assert.deepEqual(f.events, []);
  assert.deepEqual(f.commands, []);
  assert.equal(f.outbox(), null);
});

test("approved dependency cannot turn a missing config, canary or off config into normal", async t => {
  const f = await fixture(t, { active: false });
  f.options.env = { EDUPI_CORE_RECALL_ANSWERS: "1", EDUPI_DESKTOP_ISOLATED_CANARY: "1" };
  assert.deepEqual(await f.service.submit(f.input), { version: 1, status: "held", reasonCode: "recall_inactive", externalSend: false });
  assert.deepEqual(f.events, []);
  await config.writeEduPiRecallConfig({ enabled: false }, { ...f.options, expectedUpdatedAt: null });
  assert.equal((await f.service.submit(f.input)).status, "held");
  assert.deepEqual(f.commands, []);
});

test("real private intent/outbox and real SDK marker bind exact raw text to independent R04 registration/capture", async t => {
  const f = await fixture(t);
  const response = await f.service.submit(f.input);
  assert.deepEqual(response, { version: 1, status: "accepted", reasonCode: null, externalSend: false });
  const read = f.intent(), saved = f.outbox();
  assert.equal(read.readyForDispatch, true);
  assert.equal(read.intent.rawQuery, f.input.message);
  assert.equal(saved.stage, "pi_accepted");
  assert.equal(saved.command.message, f.input.message);
  const metadata = recallPromptMetadata(read.intent, f.options);
  assert.notEqual(metadata.conversationId, proactivityConversationId("teaching_preparation"));
  const calls = f.events.filter(event => event.payload);
  assert.deepEqual(calls.map(event => event.operation), ["owner_message_register", "owner_message"]);
  assert.ok(calls.every(event => event.payload.conversation_id === metadata.conversationId));
  assert.ok(calls.every(event => event.payload.grant_id === binding.grantId));
  assert.equal(calls[0].payload.carrier_id, "edupi.desktop.r04.recall");
  assert.equal(calls[0].payload.plan_id, metadata.planId);
  assert.equal(inspectEduPiPromptSession(saved, f.manager.getSessionFile()), "confirmed");
  assert.deepEqual(f.commands, [{ type: "prompt", message: f.input.message, clientRequestId: f.input.clientRequestId }]);
  assert.equal(authorization.readRecallBudget(binding.budgetId, f.options), null);
  assert.equal((await settings.createEduPiRecallSettingsService({ ...f.deps }).get()).config.used, 0);
  const ledger = JSON.parse(fs.readFileSync(path.join(f.options.stateDir, "edupi-recall-authorization.json"), "utf8"));
  assert.deepEqual(ledger.attempts, []);
  assert.equal(f.manager.getBranch().some(entry => entry.type === "message" && entry.message.role === "user"
    && Array.isArray(entry.message.content) && entry.message.content[0].text === f.input.message), true);
});

test("accepted duplicate and cold service reconcile from the exact SDK markers without another Core capture or send", async t => {
  const f = await fixture(t);
  await f.service.submit(f.input);
  const events = f.events.length;
  const cold = createEduPiRecallPromptService({ ...f.deps });
  assert.equal((await cold.submit(f.input)).status, "accepted");
  assert.equal(f.events.length, events);
  assert.equal(f.commands.length, 1);
  await assert.rejects(cold.submit({ ...f.input, message: f.input.message.trim() }), code("recall_intent_conflict"));
  await assert.rejects(cold.submit({ ...f.input, occurredAt: "2026-11-18T00:01:00.000Z" }), code("recall_intent_conflict"));
});

test("lost ACK with real SDK evidence reconciles, while unknown dispatch without evidence is never resent", async t => {
  const persisted = await fixture(t);
  persisted.failures.sendAfterMarker = true;
  assert.equal((await persisted.service.submit(persisted.input)).status, "uncertain");
  assert.equal(persisted.outbox().stage, "pi_unknown");
  assert.equal((await createEduPiRecallPromptService(persisted.deps).submit(persisted.input)).status, "accepted");
  assert.equal(persisted.commands.length, 1);
  const unknown = await fixture(t);
  unknown.failures.sendBeforeMarker = true;
  assert.equal((await unknown.service.submit(unknown.input)).status, "uncertain");
  assert.equal((await createEduPiRecallPromptService(unknown.deps).submit(unknown.input)).status, "uncertain");
  assert.equal(unknown.commands.length, 1);
  await assert.rejects(unknown.service.submit({ ...unknown.input, clientRequestId: "synthetic-request-2" }), code("recall_prior_unresolved"));
});

test("missing accepted marker cannot be relabelled accepted despite dispatch return or persisted user text", async t => {
  const f = await fixture(t);
  f.failures.missingAcceptedMarker = true;
  assert.equal((await f.service.submit(f.input)).status, "uncertain");
  assert.equal(f.outbox().stage, "pi_unknown");
  assert.equal((await f.service.submit(f.input)).status, "uncertain");
  assert.equal(f.commands.length, 1);
});

test("registration/capture failure is recoverable through the same R04 plan and never dispatches before capture", async t => {
  const f = await fixture(t);
  f.failures.capture = true;
  assert.equal((await f.service.submit(f.input)).status, "uncertain");
  assert.equal(f.outbox().stage, "registered");
  assert.equal(f.intent().intent.state, "prepared");
  assert.equal(f.commands.length, 0);
  f.failures.capture = false;
  assert.equal((await createEduPiRecallPromptService(f.deps).submit(f.input)).status, "accepted");
  assert.equal(f.commands.length, 1);
  const registrations = f.events.filter(event => event.operation === "owner_message_register");
  assert.equal(registrations.length, 2);
  assert.deepEqual(registrations[0].payload, registrations[1].payload);
});

test("Core grant scope, source, actions, version and owner are rechecked before preparing an intent", async t => {
  for (const change of [
    grant => { grant.version++; }, grant => { grant.scope.class_id = "foreign-class"; },
    grant => { grant.source_ids = ["conversation:" + "b".repeat(64)]; },
    grant => { grant.actions.push("update"); }, grant => { grant.status = "paused"; },
    grant => { grant.budget.max_calls = 64; },
  ]) {
    const f = await fixture(t);
    change(f.grant);
    await assert.rejects(f.service.submit(f.input), code("recall_grant_changed"));
    assert.equal(f.outbox(), null);
    assert.equal(f.commands.length, 0);
  }
});

test("stop after actual capture invalidates intent, holds the explicit R04 turn and never falls back to chat", async t => {
  const f = await fixture(t);
  f.failures.afterCapture = async () => {
    const current = config.readEduPiRecallConfig(f.options, approved).config;
    await config.writeEduPiRecallConfig({ enabled: false }, { ...f.options, expectedUpdatedAt: current.updatedAt });
  };
  assert.equal((await f.service.submit(f.input)).status, "held");
  assert.equal(f.commands.length, 0);
  assert.equal(f.intent().usable, false);
  assert.equal(f.outbox().stage, "captured");
  assert.equal((await createEduPiRecallPromptService(f.deps).submit(f.input)).status, "held");
});

test("stop after dispatch claim still uses the private R04 dispatch adapter and never replays an ordinary prompt", async t => {
  const f = await fixture(t);
  let calls = 0;
  const service = createEduPiRecallPromptService({ ...f.deps, dispatch: async entry => {
    calls++;
    const current = config.readEduPiRecallConfig(f.options, approved).config;
    await config.writeEduPiRecallConfig({ enabled: false }, { ...f.options, expectedUpdatedAt: current.updatedAt });
    assert.equal(entry.command.type, "prompt");
    assert.deepEqual(Object.keys(entry.command).sort(), ["clientRequestId", "message", "type"]);
    throw new Error("canonical_R04_held");
  } });
  assert.equal((await service.submit(f.input)).status, "uncertain");
  assert.equal(f.outbox().stage, "pi_unknown");
  assert.equal((await service.submit(f.input)).status, "held");
  assert.equal(calls, 1);
});

test("optional conversation predicts a distinct message identity and is preserved in fenced settlement", async t => {
  const f = await fixture(t);
  await f.service.submit(f.input);
  const intent = f.intent().intent, metadata = recallPromptMetadata(intent, f.options), saved = f.outbox().bindings[0];
  assert.notEqual(saved.messageRef, predictEduPiOwnerMessageRef(rootRef, ownerId, metadata.captureMessageId));
  const host = {
    call: f.host.call,
    async callOwnerControl(operation, payload) {
      assert.equal(operation, "owner_message_settle");
      assert.equal(payload.conversation_id, metadata.conversationId);
      assert.equal(payload.expected_message_ref, saved.messageRef);
      return { ok: true, result: { version: 1, status: "sealed_absent", receipt: null,
        root_ref: rootRef, owner_id: ownerId, grant_id: binding.grantId, grant_version: 1,
        message_ref: saved.messageRef, occurred_at: now, fencing_generation: 1, instance_nonce: "synthetic-instance",
        apply: false, live_authority: false, model_execute: false, external_send: false } };
    },
  };
  const settled = await settleRegisteredPrompt(host, { rootRef, sessionId: f.input.sessionId,
    grantId: binding.grantId, messageId: metadata.captureMessageId, text: f.input.message, occurredAt: now,
    domain: "teaching_preparation", ...metadata,
    previousBinding: { ownerId, grantId: binding.grantId, grantVersion: 1 },
    previousRegistration: { carrier_id: metadata.carrierId, plan_id: metadata.planId, producer_epoch: epoch, sequence: 1 },
  }, { onRegistered() { assert.fail("must not re-register"); } });
  assert.equal(settled.messageRef, saved.messageRef);
});

test("optional conversation rejects a registration source from the legacy G1 conversation", async t => {
  const f = await fixture(t), original = f.host.callOwnerControl;
  const host = { ...f.host, async callOwnerControl(operation, payload) {
    const value = await original.call(f.host, operation, payload);
    if (operation === "owner_message_register") value.result.source_ref = `conversation:${"d".repeat(64)}`;
    return value;
  } };
  await assert.rejects(registerAndCapturePrompt(host, { rootRef, sessionId: f.input.sessionId,
    grantId: binding.grantId, messageId: "synthetic-capture", text: f.input.message, occurredAt: now,
    domain: "teaching_preparation", conversationId: config.eduPiRecallConversationId(binding.scope, f.options),
    carrierId: "edupi.desktop.r04.recall", planId: "r04.plan",
    previousBinding: { ownerId, grantId: binding.grantId, grantVersion: 1 },
  }, { onBound() {}, onRegistered() { assert.fail("must not record wrong source"); }, onCaptured() { assert.fail("must not capture"); } }),
  /owner_message_registration_invalid/u);
});

test("two cold OS servers racing the same captured request claim only one private SDK dispatch", { timeout: 20_000 }, async t => {
  const f = await fixture(t);
  const intent = await authorization.prepareRecallIntent({ sessionId: f.input.sessionId,
    clientRequestId: f.input.clientRequestId, rawQuery: f.input.message, ownerId,
    grantId: binding.grantId, grantVersion: 1, scope: binding.scope, configConsentId: binding.consentId }, f.options, approved);
  const metadata = recallPromptMetadata(intent, f.options);
  const messageRef = predictEduPiOwnerMessageRef(rootRef, ownerId, metadata.captureMessageId, "teaching_preparation", metadata.conversationId);
  const registration = { messageRef, producerEpoch: epoch, sequence: 1, fencingGeneration: 1, instanceNonce: "synthetic-instance" };
  outboxes.prepareEduPiPromptOutbox({ sessionId: f.input.sessionId, clientRequestId: f.input.clientRequestId,
    messageId: metadata.captureMessageId, occurredAt: now,
    command: { type: "prompt", message: f.input.message, clientRequestId: f.input.clientRequestId },
    bindings: [{ domain: "teaching_preparation", ownerId, grantId: binding.grantId, grantVersion: 1,
      captureMessageId: metadata.captureMessageId, carrierId: metadata.carrierId, planId: metadata.planId }],
  }, f.options);
  outboxes.recordEduPiPromptOutboxRegistration(f.input.sessionId, f.input.clientRequestId, "teaching_preparation", registration, f.options);
  outboxes.recordEduPiPromptOutboxCapture(f.input.sessionId, f.input.clientRequestId, "teaching_preparation", { captured: true, messageRef }, f.options);
  await authorization.markCapturedRecallIntent({ intentId: intent.intentId, messageRef, registration }, f.options, approved);
  const barrier = path.join(f.root, "workers"); fs.mkdirSync(barrier, { mode: 0o700 });
  const dispatchLog = path.join(f.root, "synthetic-dispatch.log");
  const worker = `
import fs from "node:fs";
import path from "node:path";
import { setTimeout as delay } from "node:timers/promises";
import { createJiti } from "jiti";
const [sourceRoot, args] = process.argv.slice(1), data = JSON.parse(args);
const jiti = createJiti(import.meta.url, {tsconfigPaths:true,fsCache:false});
const {createEduPiRecallPromptService} = await jiti.import(path.join(sourceRoot,"lib/edupi-recall-prompt-server.ts"));
let reads = 0;
const host = {recallAnswersActive:true, async call(operation) {
 if(operation === "health") return {ok:true,result:{data_root_fingerprint:data.rootRef}};
 if(operation !== "owner_read") throw Error("unexpected_core_operation");
 if(++reads === 2) {
   fs.writeFileSync(path.join(data.barrier,String(process.pid)), "synthetic", {mode:0o600});
   const until=Date.now()+5000;
   while(fs.readdirSync(data.barrier).length<2) {if(Date.now()>until) throw Error("barrier_timeout");await delay(5);}
 }
 return {ok:true,result:{root_ref:data.rootRef,owner:{id:data.ownerId,root_ref:data.rootRef},grants:[data.grant]}};
}, async callOwnerControl() { throw Error("must_not_recapture"); }};
const service=createEduPiRecallPromptService({approveNormal:()=>true,options:()=>data.options,
 runtime:async()=>host,sessionPath:async()=>data.file,inspectSession:()=>"unknown",
 dispatch:async()=>{fs.appendFileSync(data.log,String(process.pid)+"\\n",{mode:0o600});throw Error("synthetic_lost_ack");}});
console.log(JSON.stringify(await service.submit(data.input)));
`;
  const args = JSON.stringify({ rootRef, ownerId, grant: f.grant, options: f.options, input: f.input,
    barrier, log: dispatchLog, file: f.manager.getSessionFile() });
  const run = () => promisify(execFile)(process.execPath, ["--input-type=module", "-e", worker, process.cwd(), args],
    { cwd: process.cwd(), timeout: 15_000, maxBuffer: 32_768 });
  const results = await Promise.allSettled([run(), run()]);
  for (const finished of results) {
    assert.equal(finished.status, "fulfilled", finished.status === "rejected" ? String(finished.reason) : undefined);
    assert.equal(JSON.parse(finished.value.stdout).status, "uncertain");
  }
  assert.equal(fs.readFileSync(dispatchLog, "utf8").trim().split("\n").length, 1);
  assert.equal(f.outbox().stage, "pi_unknown");
});
