import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { isDeepStrictEqual } from "node:util";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import ts from "typescript";
import { createJiti } from "jiti";

const source = fs.readFileSync(new URL("./route.ts", import.meta.url), "utf8");
const compiled = ts.transpileModule(source, { compilerOptions: {
  module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, esModuleInterop: true,
} }).outputText;
const G1 = "teaching_preparation";
const G2 = "student_followup";
const rootRef = `sha256:${"a".repeat(64)}`;
const occurredAt = "2026-10-10T08:00:00.000Z";
const jiti = createJiti(import.meta.url, { tsconfigPaths: true, fsCache: false });
const recallPrompts = await jiti.import("../../../../../lib/edupi-recall-prompt-server.ts");
const recallConfig = await jiti.import("../../../../../lib/edupi-recall-config.ts");
const recallAuth = await jiti.import("../../../../../lib/edupi-recall-authorization.ts");
const actualOutbox = await jiti.import("../../../../../lib/edupi-prompt-outbox.ts");
const actualLedger = await jiti.import("../../../../../lib/edupi-ambient-message-ledger.ts");
const actualRegistration = await jiti.import("../../../../../lib/edupi-registered-prompt.ts");
const { predictEduPiOwnerMessageRef } = await jiti.import("../../../../../lib/edupi-ambient-message-runtime.ts");

function fixture({ authorized = true, g2 = false, registrationFailure = null,
  captureFailure = null, piError = false, piAsyncFailure = false,
  settleFailure = false, settleStatus = "sealed_absent", reconciliationEvidence = "confirmed", capability = false,
  g1Active = true, answerActive = false, registrationActive = true, text = "请准备数学课" } = {}) {
  // An in-memory transport proves route ordering only: no Core daemon, Pi
  // model, teacher files, or installed app is touched by these tests.
  const events = [];
  const captures = [], settlements = [], piCommands = [];
  let piListener = () => {};
  const outbox = new Map();
  const ledger = new Map();
  let domains = capability ? ["calendar_administration", "lesson_reflection", "parent_communication"] : g2 ? [G1, G2] : [G1];
  const key = (sessionId, clientRequestId) => `${sessionId}\0${clientRequestId}`;
  const get = (sessionId, clientRequestId) => outbox.get(key(sessionId, clientRequestId)) ?? null;
  const mutate = (sessionId, clientRequestId, change) => {
    const entry = get(sessionId, clientRequestId);
    assert.ok(entry, "outbox must already contain the whole prompt");
    change(entry);
    return entry;
  };
  const host = { recallAnswersActive: answerActive, call: async (operation) => {
    assert.equal(operation, "health");
    events.push("health");
    return { ok: true, result: { data_root_fingerprint: rootRef, capabilities: {
      ambient_planning: "active", owner_message_registration: registrationActive ? "active" : "inactive",
      g1_processor: g1Active ? "active" : "activation_pending", g2_processor: "active", g3_processor: "active",
    } } };
  } };
  const modules = {
    "node:crypto": { createHash },
    "node:util": { isDeepStrictEqual },
    "next/server": { NextResponse: { json: (body, options = {}) => Response.json(body, { status: options.status ?? 200 }) } },
    "@/lib/bounded-form-data": { parseJsonWithinLimit: async (request) => {
      events.push("body_read"); return request.json();
    }, RequestBodyTooLargeError: class extends Error {} },
    "@/lib/desktop-api-auth": { isDesktopApiRequestAllowed: () => authorized },
    "@/lib/edupi-recall-prompt-server": { readRecallPromptOutboxBinding: () => null },
    "@/lib/edupi-recall-config": { readEduPiRecallActivation: () => ({
      mode: process.env.EDUPI_CORE_RECALL_ANSWERS === "1" ? "canary" : "off",
    }) },
    "@/lib/edupi-ambient-message-ledger": {
      prepareEduPiAmbientMessageBinding: ({ messageRef }) => { events.push("ledger_prepared"); ledger.set(messageRef, { messageRef, status: "pending" }); },
      confirmEduPiAmbientMessageBinding: (_session, _message, messageRef) => { events.push("ledger_confirmed"); ledger.get(messageRef).status = "captured"; },
      markEduPiAmbientMessageWithdrawn: (_session, messageRef) => { events.push("ledger_withdrawn"); ledger.get(messageRef).status = "withdrawn"; },
      markEduPiAmbientMessageAbandoned: (_session, messageRef) => { events.push("ledger_abandoned"); ledger.get(messageRef).status = "abandoned"; },
      readEduPiAmbientMessagesForSession: () => [...ledger.values()],
    },
    "@/lib/edupi-ambient-session-lock": { withEduPiAmbientSessionLock: async (_sessionId, callback) => callback() },
    "@/lib/edupi-core-snapshot": { resolveEduPiBridgeRoots: () => ({ dataRoot: { root: "/isolated/synthetic" } }) },
    "@/lib/edupi-prompt-intent": {
      listEduPiPromptIntents: () => [{ sessionId: "session-1", clientRequestId: "request-1",
        occurredAt, message: text, cwd: "/synthetic", status: "pending" }],
      readEduPiPromptIntent: (sessionId, clientRequestId) => sessionId === "session-1" && clientRequestId === "request-1"
        ? { sessionId, clientRequestId, occurredAt, message: text, cwd: "/synthetic", status: "pending" } : null,
      resolveEduPiPromptIntent: () => events.push("intent_resolved"),
      discardEduPiPromptIntent: () => events.push("intent_discarded"),
    },
    "@/lib/edupi-proactivity-config": { readEduPiProactivityActivation: ({ domain }) => ({
      enabled: domains.includes(domain), grantId: `grant-${domain}`, scope: { classId: "703", subject: "数学" },
    }) },
    "@/lib/edupi-proactivity-runtime": { readProactivityOwnerContext: async (_host, _rootRef, grantId) => ({
      status: "active", ownerId: "owner-fixture", grantId, grantVersion: 2,
    }) },
    "@/lib/edupi-registered-prompt": { registerAndCapturePrompt: async (_host, input, hooks) => {
      captures.push(structuredClone(input));
      events.push(`register:${input.domain}`);
      if (registrationFailure === input.domain) throw new Error("synthetic_registration_failure");
      const proof = { messageRef: `owner_message:${(input.domain === G1 ? "b" : "c").repeat(64)}`,
        registration: { producer_epoch: "d".repeat(64), sequence: 1 },
        fencingGeneration: 1, instanceNonce: "nonce-1" };
      // The real helper validates the complete affirmative Core receipt
      // before invoking onCaptured. Simulate that boundary, not a HTTP 200.
      hooks.onRegistered(proof);
      events.push(`capture:${input.domain}`);
      if (captureFailure === input.domain) throw new Error("synthetic_capture_failure");
      hooks.onCaptured(proof);
      return proof;
    }, settleRegisteredPrompt: async (_host, input, hooks) => {
      settlements.push(structuredClone(input));
      events.push(`settle:${input.domain}`);
      if (settleFailure) throw new Error("synthetic_settle_unknown");
      const proof = { messageRef: `owner_message:${(input.domain === G1 ? "b" : "c").repeat(64)}`,
        registration: { producer_epoch: "d".repeat(64), sequence: 1 },
        fencingGeneration: 1, instanceNonce: "nonce-1" };
      if (!input.previousRegistration) hooks.onRegistered(proof);
      return { status: settleStatus, messageRef: proof.messageRef,
        recordedAt: settleStatus === "withdrawn" ? "2026-10-10T08:01:00.000Z" : null };
    } },
    "@/lib/edupi-prompt-reconciliation": { inspectEduPiPromptSession: () => reconciliationEvidence },
    "@/lib/edupi-runtime-supervisor": { ensureEduPiRuntime: async () => host },
    "@/lib/rpc-manager": { getRpcSession: () => ({ isAlive: () => true,
      ensureSessionPersisted: () => events.push("session_persisted"),
      onEvent: listener => { piListener = listener; return () => { piListener = () => {}; }; },
      recordEduPiPromptDispatch: (requestId, commandHash) => {
        const persisted = get("session-1", requestId);
        assert.equal(commandHash, `sha256:${createHash("sha256").update(JSON.stringify(persisted.command)).digest("hex")}`);
        events.push("pi_session_marker");
      }, sendCoreCapturedPrompt: async command => {
        piCommands.push(structuredClone(command));
        events.push("pi_send"); if (piError) throw new Error("synthetic_pi_uncertain");
        queueMicrotask(() => piListener(piAsyncFailure
          ? { type: "prompt_error", clientRequestId: command.clientRequestId }
          : { type: "message_end", clientRequestId: command.clientRequestId,
            entryId: "entry-1", message: { role: "user" } }));
      } }) },
    "@/lib/session-reader": { resolveSessionPath: async () => { events.push("session_path"); return "synthetic-session"; } },
    "@/lib/harness/runtime": { startHarnessSession: async () => { throw new Error("unexpected harness start"); } },
    "@/lib/safe-mode": { canStartEduPiProactivity: () => true, canStartEduPiStudentFollowup: () => g2, canStartEduPiCapabilityDrafts: () => capability },
    "@/lib/image-attachments": { validateAgentImages: () => null },
    "@/lib/edupi-prompt-outbox": {
      listEduPiPromptOutbox: () => [...outbox.values()].map(item => ({ sessionId: item.sessionId,
        clientRequestId: item.clientRequestId, stage: item.stage })),
      readEduPiPromptOutbox: get,
      prepareEduPiPromptOutbox: (input) => {
        events.push("outbox_prepared");
        const id = key(input.sessionId, input.clientRequestId);
        const existing = outbox.get(id);
        if (existing) {
          assert.equal(existing.messageId, input.messageId, "retry must reuse identity");
          assert.deepEqual(existing.command, input.command, "retry must reuse exact Pi command");
          return existing;
        }
        const entry = { ...input, command: { type: input.command.type, message: input.command.message, clientRequestId: input.command.clientRequestId }, stage: "prepared", bindings: input.bindings.map(binding => ({
          ...binding, captured: false, registration: null, messageRef: null,
        })) };
        outbox.set(id, entry);
        return entry;
      },
      recordEduPiPromptOutboxRegistration: (sessionId, clientRequestId, domain, registration) => mutate(sessionId, clientRequestId, entry => {
        events.push(`outbox_registered:${domain}`);
        const binding = entry.bindings.find(item => item.domain === domain);
        assert.ok(binding);
        binding.registration = registration;
        binding.messageRef = registration.messageRef;
        entry.stage = entry.bindings.every(item => item.registration) ? "registered" : "prepared";
      }),
      recordEduPiPromptOutboxCapture: (sessionId, clientRequestId, domain, receipt) => mutate(sessionId, clientRequestId, entry => {
        events.push(`outbox_captured:${domain}`);
        const binding = entry.bindings.find(item => item.domain === domain);
        assert.equal(binding.messageRef, receipt.messageRef);
        binding.captured = true;
        entry.stage = entry.bindings.every(item => item.captured) ? "captured" : "registered";
      }),
      markEduPiPromptOutboxPiDispatching: (sessionId, clientRequestId) => mutate(sessionId, clientRequestId, entry => {
        assert.equal(entry.stage, "captured");
        events.push("pi_dispatch_committed"); entry.stage = "pi_dispatching";
      }),
      markEduPiPromptOutboxPiAccepted: (sessionId, clientRequestId) => mutate(sessionId, clientRequestId, entry => {
        events.push("pi_accepted"); entry.stage = entry.stage === "pi_unverified_withdrawn"
          ? "pi_accepted_withdrawn" : "pi_accepted";
      }),
      markEduPiPromptOutboxPiUnknown: (sessionId, clientRequestId) => mutate(sessionId, clientRequestId, entry => {
        events.push("pi_unknown"); entry.stage = "pi_unknown";
      }),
      markEduPiPromptOutboxCancelled: (sessionId, clientRequestId, proofs) => mutate(sessionId, clientRequestId, entry => {
        assert.equal(proofs.length, entry.bindings.length);
        events.push("outbox_cancelled"); entry.stage = "cancelled";
      }),
      markEduPiPromptOutboxSourceWithdrawn: (sessionId, clientRequestId, proofs) => mutate(sessionId, clientRequestId, entry => {
        assert.equal(proofs.length, entry.bindings.length);
        assert.ok(proofs.every(proof => proof.status === "withdrawn"));
        events.push("outbox_source_withdrawn"); entry.stage = "pi_unverified_withdrawn";
      }),
    },
  };
  const routeModule = { exports: {} };
  new Function("require", "module", "exports", compiled)(name => {
    assert.ok(Object.hasOwn(modules, name), `unexpected dependency ${name}`);
    return modules[name];
  }, routeModule, routeModule.exports);
  const body = { sessionId: "session-1", messageId: "message-1", occurredAt,
    command: { type: "prompt", message: text, clientRequestId: "request-1" } };
  const post = (payload = body) => routeModule.exports.POST(new Request("http://localhost/api/edupi/proactivity/prompt", {
    method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(payload),
  }));
  const put = () => routeModule.exports.PUT(new Request("http://localhost/api/edupi/proactivity/prompt", {
    method: "PUT", headers: { "content-type": "application/json" },
    body: JSON.stringify({ sessionId: body.sessionId, clientRequestId: body.command.clientRequestId }),
  }));
  const patch = () => routeModule.exports.PATCH(new Request("http://localhost/api/edupi/proactivity/prompt", {
    method: "PATCH", headers: { "content-type": "application/json" },
    body: JSON.stringify({ sessionId: body.sessionId, clientRequestId: body.command.clientRequestId }),
  }));
  const cancel = () => routeModule.exports.DELETE(new Request("http://localhost/api/edupi/proactivity/prompt", {
    method: "DELETE", headers: { "content-type": "application/json" },
    body: JSON.stringify({ sessionId: body.sessionId, clientRequestId: body.command.clientRequestId }),
  }));
  return { events, captures, settlements, piCommands, outbox, body, post, put, patch, cancel,
    resumeCapture: () => { registrationFailure = captureFailure = null; }, deactivate: () => { domains = []; },
    entry: () => get(body.sessionId, body.command.clientRequestId) };
}

test("capture, retry and Pi dispatch bind the exact raw prompt including surrounding whitespace", async () => {
  for (const text of [" \t\n请准备数学课\r\n ", "\u3000请准备数学课\u00a0"]) {
    const f = fixture({ text, g2: true, captureFailure: G1 });
    assert.equal((await f.post()).status, 202);
    assert.equal(f.entry().command.message, text);
    assert.equal(f.captures[0].text, text);
    assert.equal(f.piCommands.length, 0);
    f.resumeCapture();
    assert.equal((await f.put()).status, 200);
    assert.ok(f.captures.every(input => input.text === text));
    assert.deepEqual(f.piCommands, [f.body.command]);
    assert.equal((await f.post()).status, 200);
    assert.equal(f.piCommands.length, 1);
    const changed = await f.post({ ...f.body, command: { ...f.body.command, message: text.trim() } });
    assert.equal(changed.status, 409, "trimming the same request changes its identity");
  }
});

test("cancellation and withdrawal reuse the raw prompt for settlement and registration repair", async () => {
  const text = " \n请准备数学课\t ";
  for (const failure of [
    { registrationFailure: G1, settleStatus: "sealed_absent" },
    { captureFailure: G1, settleStatus: "withdrawn" },
    { piError: true, settleStatus: "withdrawn" },
  ]) {
    const f = fixture({ text, ...failure });
    assert.equal((await f.post()).status, 202);
    assert.equal((await f.cancel()).status, 200);
    assert.equal(f.captures[0].text, text);
    assert.equal(f.settlements[0].text, text);
    assert.equal(Boolean(f.settlements[0].previousRegistration), !failure.registrationFailure);
    assert.equal((await f.put()).status, 409);
  }
});

test("a whitespace-only prompt is rejected before registration", async () => {
  const f = fixture({ text: " \t\n\u3000" });
  assert.equal((await f.post()).status, 400);
  assert.equal(f.captures.length, 0);
  assert.equal(f.entry(), null);
});

test("unauthorized request never reads private body or touches Core and Pi", async () => {
  const f = fixture({ authorized: false });
  const result = await f.post();
  assert.equal(result.status, 403);
  assert.equal((await result.json()).status, "rejected");
  assert.deepEqual(f.events, []);
  assert.equal(f.entry(), null);
});

test("G1 affirmative capture is durable before the sole Pi dispatch", async () => {
  const f = fixture();
  const result = await f.post();
  assert.equal(result.status, 200);
  assert.equal((await result.json()).status, "accepted");
  assert.equal(f.entry().stage, "pi_accepted");
  const position = label => f.events.indexOf(label);
  assert.ok(position("outbox_prepared") < position(`register:${G1}`));
  assert.ok(position("session_persisted") < position(`register:${G1}`));
  assert.ok(position(`outbox_registered:${G1}`) < position(`capture:${G1}`));
  assert.ok(position(`outbox_captured:${G1}`) < position("pi_dispatch_committed"));
  assert.ok(position("pi_dispatch_committed") < position("pi_send"));
  assert.ok(position("pi_session_marker") < position("pi_send"));
  assert.ok(position("pi_accepted") < position("intent_resolved"));
  assert.equal(f.events.filter(event => event === "pi_send").length, 1);
  assert.equal(f.events.includes("pi_accepted"), true);
});

test("explicit branded R04 answer support captures the owner question without a G1 generation processor", async () => {
  const previous = process.env.EDUPI_CORE_RECALL_ANSWERS;
  process.env.EDUPI_CORE_RECALL_ANSWERS = "1";
  try {
    const f = fixture({ g1Active: false, answerActive: true });
    const result = await f.post();
    assert.equal(result.status, 200);
    assert.equal(f.entry().stage, "pi_accepted");
    assert.ok(f.events.indexOf(`capture:${G1}`) < f.events.indexOf("pi_send"));
    assert.equal(f.events.filter(event => event === "pi_send").length, 1);
  } finally {
    if (previous === undefined) delete process.env.EDUPI_CORE_RECALL_ANSWERS; else process.env.EDUPI_CORE_RECALL_ANSWERS = previous;
  }
});

test("R04 cannot manufacture registration or an answer processor from a flag or an inactive bootstrap", async () => {
  const previous = process.env.EDUPI_CORE_RECALL_ANSWERS;
  try {
    for (const [flag, answerActive, registrationActive] of [[undefined, true, true], ["0", true, true], ["1", false, true], ["1", true, false]]) {
      if (flag === undefined) delete process.env.EDUPI_CORE_RECALL_ANSWERS; else process.env.EDUPI_CORE_RECALL_ANSWERS = flag;
      const f = fixture({ g1Active: false, answerActive, registrationActive });
      const result = await f.post();
      assert.equal(result.status, 503);
      assert.equal(f.events.includes("pi_send"), false);
      assert.equal(f.events.some(event => event.startsWith("register:")), false);
    }
  } finally {
    if (previous === undefined) delete process.env.EDUPI_CORE_RECALL_ANSWERS; else process.env.EDUPI_CORE_RECALL_ANSWERS = previous;
  }
});

test("a legal JSON key order uses the durable command hash for its Pi marker", async () => {
  const f = fixture();
  const response = await f.post({ ...f.body, command: { type: "prompt", clientRequestId: "request-1", message: "请准备数学课" } });
  assert.equal(response.status, 200); assert.equal(f.entry().stage, "pi_accepted");
});

test("G3 G4 G5 all persist independent registration bindings before one Pi dispatch", async () => {
  const f = fixture({ capability: true });
  assert.equal((await f.post()).status, 200);
  const bindings = f.entry().bindings;
  assert.deepEqual(bindings.map(item => item.domain), ["calendar_administration", "lesson_reflection", "parent_communication"]);
  assert.equal(new Set(bindings.map(item => item.captureMessageId)).size, 3);
  assert.equal(new Set(bindings.map(item => item.carrierId)).size, 3);
  assert.ok(bindings.every(item => item.captured && item.registration));
  assert.equal(f.events.filter(item => item === "pi_send").length, 1);
});

test("G1 and G2 both capture before Pi dispatch in isolated canary", async () => {
  const f = fixture({ g2: true });
  const result = await f.post();
  assert.equal(result.status, 200);
  assert.deepEqual(f.entry().bindings.map(binding => binding.domain), [G1, G2]);
  assert.equal(f.entry().bindings.every(binding => binding.captured), true);
  assert.ok(f.events.indexOf(`outbox_captured:${G2}`) < f.events.indexOf("pi_send"));
  assert.equal(f.events.filter(event => event === "pi_send").length, 1);
});

test("registration or capture failure never dispatches Pi", async () => {
  for (const failure of [{ registrationFailure: G1 }, { captureFailure: G1 }, { captureFailure: G2, g2: true }]) {
    const f = fixture(failure);
    const result = await f.post();
    assert.equal(result.status, 202);
    assert.equal((await result.json()).status, "uncertain");
    assert.equal(f.events.includes("pi_send"), false);
    assert.equal(f.events.includes("pi_dispatch_committed"), false);
    assert.notEqual(f.entry().stage, "pi_accepted");
  }
});

test("a later disabled grant never replays a prepared Core source as plain Pi chat", async () => {
  const f = fixture({ captureFailure: G1 });
  assert.equal((await f.post()).status, 202);
  f.deactivate();
  const retry = await f.post();
  assert.equal(retry.status, 202);
  assert.equal((await retry.json()).status, "uncertain");
  assert.equal(f.events.includes("pi_send"), false);
});

test("long desktop text still falls back to direct Pi when proactive Core capture is off", async () => {
  const longMessage = "合成教学上下文".repeat(700);
  const disabled = fixture();
  disabled.deactivate();
  const response = await disabled.post({ ...disabled.body,
    command: { ...disabled.body.command, message: longMessage } });
  assert.equal(response.status, 202);
  assert.equal((await response.json()).status, "disabled");
  assert.equal(disabled.entry(), null);
  const active = fixture();
  const refused = await active.post({ ...active.body,
    command: { ...active.body.command, message: longMessage } });
  assert.equal(refused.status, 400);
  assert.equal(active.events.includes("pi_send"), false);
});

test("Pi error is uncertain and a repeated request never blindly replays it", async () => {
  const f = fixture({ piError: true });
  const first = await f.post();
  assert.equal(first.status, 202);
  assert.equal((await first.json()).status, "uncertain");
  assert.equal(f.entry().stage, "pi_unknown");
  const second = await f.post();
  assert.equal(second.status, 202);
  assert.equal((await second.json()).status, "uncertain");
  assert.equal(f.events.filter(event => event === "pi_send").length, 1);
  assert.equal(f.events.filter(event => event === `register:${G1}`).length, 1);
  const manual = await f.put();
  assert.equal(manual.status, 202);
  assert.equal(f.events.filter(event => event === "pi_send").length, 1);
});

test("a new request ID cannot bypass an unresolved prompt in the same session", async () => {
  const f = fixture({ piError: true });
  assert.equal((await f.post()).status, 202);
  const replacement = await f.post({ ...f.body, messageId: "message-2",
    command: { ...f.body.command, clientRequestId: "request-2" } });
  assert.equal(replacement.status, 409);
  assert.equal((await replacement.json()).status, "prior_unresolved");
  assert.equal(f.events.filter(event => event === "pi_send").length, 1);
});

test("an async Pi preflight failure after RPC scheduling never becomes an accepted outbox entry", async () => {
  const f = fixture({ piAsyncFailure: true });
  const result = await f.post();
  assert.equal(result.status, 202);
  assert.equal((await result.json()).status, "uncertain");
  assert.equal(f.entry().stage, "pi_unknown");
  assert.equal(f.events.filter(event => event === "pi_accepted").length, 0);
});

test("only exact Pi session evidence settles an uncertain send after restart", async () => {
  const confirmed = fixture({ piError: true });
  assert.equal((await confirmed.post()).status, 202);
  assert.equal((await confirmed.patch()).status, 200);
  assert.equal(confirmed.entry().stage, "pi_accepted");
  assert.equal(confirmed.events.filter(event => event === "pi_send").length, 1);
  const missing = fixture({ piError: true, reconciliationEvidence: "marker_only" });
  assert.equal((await missing.post()).status, 202);
  const result = await missing.patch();
  assert.equal(result.status, 202);
  assert.equal((await result.json()).evidence, "marker_only");
  assert.equal(missing.entry().stage, "pi_unknown");
});

test("an uncertain Pi dispatch may withdraw Core sources without claiming Pi was absent", async () => {
  const f = fixture({ piError: true, reconciliationEvidence: "marker_only", settleStatus: "withdrawn" });
  assert.equal((await f.post()).status, 202);
  assert.equal((await f.patch()).status, 202);
  const withdrawn = await f.cancel();
  assert.equal(withdrawn.status, 200);
  assert.equal((await withdrawn.json()).status, "source_withdrawn");
  assert.equal(f.entry().stage, "pi_unverified_withdrawn");
  assert.equal(f.events.filter(event => event === "pi_send").length, 1);
  assert.equal(f.events.includes("ledger_withdrawn"), true);
  assert.equal((await f.put()).status, 409);
  assert.equal((await f.post()).status, 409);
  assert.equal((await f.patch()).status, 202);
});

test("a Core-withdrawn prompt becomes settled only after exact Pi session evidence", async () => {
  const f = fixture({ piError: true, settleStatus: "withdrawn", reconciliationEvidence: "confirmed" });
  assert.equal((await f.post()).status, 202);
  assert.equal((await f.cancel()).status, 200);
  assert.equal((await f.patch()).status, 200);
  assert.equal(f.entry().stage, "pi_accepted_withdrawn");
  assert.equal((await f.post()).status, 200);
  assert.equal(f.events.filter(event => event === "pi_send").length, 1);
});

test("an uncertain Pi dispatch cannot be relabelled as withdrawn without Core proof", async () => {
  const f = fixture({ piError: true, settleStatus: "sealed_absent" });
  assert.equal((await f.post()).status, 202);
  assert.equal((await f.cancel()).status, 503);
  assert.equal(f.entry().stage, "pi_unknown");
});

async function recallCancellationFixture(t, stage, corrupt = null) {
  const root = fs.mkdtempSync(path.join(fs.realpathSync(os.tmpdir()), "edupi-r04-delete-review-"));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const options = { dataRoot: path.join(root, "data"), stateDir: path.join(root, "state"), env: {},
    now: "2026-11-18T00:00:00.000Z" };
  for (const folder of [options.dataRoot, options.stateDir]) fs.mkdirSync(folder, { mode: 0o700 });
  const approved = { approveNormal: () => true };
  const configuration = {
    enabled: true, purpose: "r04_recall_answer", ownerId: "synthetic-owner", grantId: "r04_recall_abcdef",
    grantVersion: 1, scope: { classId: "synthetic-class", subject: "数学" },
    model: { provider: "synthetic", modelId: "synthetic-model" },
    budgetId: "r04_recall_budget_abcdef", limit: 2, validUntil: "2026-11-19T00:00:00.000Z", consentId: "synthetic-consent",
  };
  await recallConfig.writeEduPiRecallConfig(configuration, { ...options, expectedUpdatedAt: null }, approved);
  const intent = await recallAuth.prepareRecallIntent({
    sessionId: "synthetic-recall-session", clientRequestId: "synthetic-recall-request",
    rawQuery: "合成班会由谁主持？", ownerId: configuration.ownerId, grantId: configuration.grantId,
    grantVersion: 1, scope: configuration.scope, configConsentId: configuration.consentId,
  }, options, approved);
  const metadata = recallPrompts.recallPromptMetadata(intent, options);
  const expectedRef = predictEduPiOwnerMessageRef(rootRef, configuration.ownerId, metadata.captureMessageId, G1, metadata.conversationId);
  const transport = [], registered = new Map();
  let captured = false, withdrawn = false;
  const host = {
    async call(operation) {
      assert.equal(operation, "health");
      transport.push({ operation });
      return { ok: true, result: { data_root_fingerprint: rootRef, fencing_generation: 1, instance_nonce: "synthetic-instance" } };
    },
    async callOwnerControl(operation, input) {
      transport.push({ operation, input: structuredClone(input) });
      assert.equal(input.root_ref, rootRef);
      assert.equal(input.expected_owner_id, configuration.ownerId);
      if (operation === "owner_message_register") {
        assert.equal(input.conversation_id, metadata.conversationId);
        const replayed = registered.has(input.message_id);
        registered.set(input.message_id, input);
        return { ok: true, result: {
          version: 1, status: "registered", root_ref: rootRef, owner_id: configuration.ownerId,
          grant_id: configuration.grantId, grant_version: 1,
          message_ref: expectedRef, source_ref: `conversation:${createHash("sha256").update(metadata.conversationId).digest("hex")}`,
          occurred_at: options.now, carrier_id: metadata.carrierId, plan_id: metadata.planId,
          producer_epoch: "a".repeat(64), sequence: 1, fencing_generation: 1, instance_nonce: "synthetic-instance",
          replayed, apply: false, live_authority: false, model_execute: false, external_send: false,
        } };
      }
      if (operation === "owner_message_settle") {
        // Model Core's exact original registration check. The G1 default
        // conversation computes a different ref and must fail this transport.
        assert.equal(input.conversation_id, registered.get(metadata.captureMessageId).conversation_id);
        assert.equal(input.expected_message_ref, expectedRef);
        assert.equal(input.message_id, metadata.captureMessageId);
        assert.equal(input.grant_id, configuration.grantId);
        return { ok: true, result: {
          version: 1, status: captured ? "captured" : "sealed_absent",
          root_ref: rootRef, owner_id: configuration.ownerId, grant_id: configuration.grantId, grant_version: 1,
          message_ref: expectedRef, occurred_at: options.now, fencing_generation: 1, instance_nonce: "synthetic-instance",
          receipt: captured ? { action: "capture", message_ref: expectedRef } : null,
          apply: false, live_authority: false, model_execute: false, external_send: false,
        } };
      }
      assert.equal(operation, "owner_message");
      if (input.action === "capture") {
        assert.equal(input.conversation_id, metadata.conversationId);
        captured = true;
        return { ok: true, result: { replayed: false, receipt: {
          action: "capture", message_ref: expectedRef, revision: 1, owner_id: configuration.ownerId,
          root_ref: rootRef, capture_grant_version: 1,
          source_ref: `conversation:${createHash("sha256").update(metadata.conversationId).digest("hex")}`,
          received_at: options.now, recorded_at: options.now, sender_kind: "local_owner_authenticated",
          apply: false, live_authority: false, external_send: false,
        } } };
      }
      assert.equal(input.action, "withdraw");
      assert.equal(input.message_ref, expectedRef);
      assert.equal(input.expected_revision, 1);
      assert.equal(captured, true);
      withdrawn = true;
      return { ok: true, result: { receipt: {
        action: "withdraw", message_ref: expectedRef, revision: 2, root_ref: rootRef,
        owner_id: configuration.ownerId, recorded_at: "2026-11-18T00:01:00.000Z",
        apply: false, live_authority: false, external_send: false,
      } } };
    },
  };
  const preparedBinding = {
    domain: G1, ownerId: configuration.ownerId, grantId: configuration.grantId, grantVersion: 1,
    captureMessageId: metadata.captureMessageId, carrierId: metadata.carrierId, planId: metadata.planId,
    ...(corrupt === "owner" ? { ownerId: "wrong-owner" } : {}),
    ...(corrupt === "grant" ? { grantId: "r04_recall_112233" } : {}),
    ...(corrupt === "plan" ? { planId: "wrong-plan" } : {}),
  };
  actualOutbox.prepareEduPiPromptOutbox({
    sessionId: intent.sessionId, clientRequestId: intent.clientRequestId, messageId: metadata.captureMessageId,
    occurredAt: options.now, command: { type: "prompt", message: intent.rawQuery, clientRequestId: intent.clientRequestId },
    bindings: [preparedBinding],
  }, options);
  const registrationInput = {
    rootRef, grantId: configuration.grantId, sessionId: intent.sessionId, messageId: metadata.captureMessageId,
    text: intent.rawQuery, occurredAt: options.now, domain: G1, conversationId: metadata.conversationId,
    carrierId: metadata.carrierId, planId: metadata.planId,
    previousBinding: { ownerId: configuration.ownerId, grantId: configuration.grantId, grantVersion: 1 },
  };
  const hooks = {
    onBound: assert.fail,
    onRegistered(proof) {
      actualOutbox.recordEduPiPromptOutboxRegistration(intent.sessionId, intent.clientRequestId, G1, {
        messageRef: corrupt === "message-ref" ? `owner_message:${"0".repeat(64)}` : proof.messageRef,
        producerEpoch: proof.registration.producer_epoch, sequence: proof.registration.sequence,
        fencingGeneration: proof.fencingGeneration, instanceNonce: proof.instanceNonce,
      }, options);
      actualLedger.prepareEduPiAmbientMessageBinding({
        sessionId: intent.sessionId, messageId: metadata.captureMessageId, messageRef: proof.messageRef,
        ownerId: configuration.ownerId, grantId: configuration.grantId, captureGrantVersion: 1, occurredAt: options.now,
      }, options);
    },
    onCaptured(proof) {
      actualLedger.confirmEduPiAmbientMessageBinding(intent.sessionId, metadata.captureMessageId, proof.messageRef, options);
      actualOutbox.recordEduPiPromptOutboxCapture(intent.sessionId, intent.clientRequestId, G1, { captured: true, messageRef: proof.messageRef }, options);
    },
  };
  const proof = stage === "registered"
    ? await actualRegistration.registerPrompt(host, registrationInput, hooks)
    : await actualRegistration.registerAndCapturePrompt(host, registrationInput, hooks);
  if (stage !== "registered") {
    await recallAuth.markCapturedRecallIntent({ intentId: intent.intentId, messageRef: proof.messageRef,
      registration: { messageRef: proof.messageRef, producerEpoch: proof.registration.producer_epoch, sequence: proof.registration.sequence,
        fencingGeneration: proof.fencingGeneration, instanceNonce: proof.instanceNonce } }, options, approved);
  }
  if (stage === "pi_unknown") {
    actualOutbox.markEduPiPromptOutboxPiDispatching(intent.sessionId, intent.clientRequestId, options);
    actualOutbox.markEduPiPromptOutboxPiUnknown(intent.sessionId, intent.clientRequestId, options);
  }
  const stateOptions = value => { assert.equal(value.dataRoot, options.dataRoot); return { ...value, stateDir: options.stateDir }; };
  const injectStore = (module, names) => Object.fromEntries(names.map(name => [name, (...args) => {
    args[args.length - 1] = stateOptions(args.at(-1));
    return module[name](...args);
  }]));
  const modules = {
    "node:crypto": { createHash }, "node:util": { isDeepStrictEqual },
    "next/server": { NextResponse: { json: (body, init = {}) => Response.json(body, init) } },
    "@/lib/bounded-form-data": { parseJsonWithinLimit: request => request.json(), RequestBodyTooLargeError: class extends Error {} },
    "@/lib/desktop-api-auth": { isDesktopApiRequestAllowed: () => true },
    "@/lib/edupi-core-snapshot": { resolveEduPiBridgeRoots: () => ({ dataRoot: { root: options.dataRoot } }) },
    "@/lib/edupi-ambient-session-lock": await jiti.import("../../../../../lib/edupi-ambient-session-lock.ts"),
    "@/lib/edupi-registered-prompt": actualRegistration,
    "@/lib/edupi-runtime-supervisor": { ensureEduPiRuntime: async () => host },
    "@/lib/edupi-recall-prompt-server": { readRecallPromptOutboxBinding: (entry, value, rootRef) =>
      recallPrompts.readRecallPromptOutboxBinding(entry, stateOptions(value), rootRef) },
    "@/lib/edupi-prompt-outbox": injectStore(actualOutbox, [
      "readEduPiPromptOutbox", "recordEduPiPromptOutboxRegistration", "markEduPiPromptOutboxCancelled", "markEduPiPromptOutboxSourceWithdrawn",
    ]),
    "@/lib/edupi-ambient-message-ledger": injectStore(actualLedger, [
      "readEduPiAmbientMessagesForSession", "markEduPiAmbientMessageWithdrawn", "markEduPiAmbientMessageAbandoned", "prepareEduPiAmbientMessageBinding",
    ]),
    "@/lib/edupi-prompt-intent": { readEduPiPromptIntent: () => null, discardEduPiPromptIntent: assert.fail },
  };
  for (const name of ["@/lib/edupi-recall-config", "@/lib/edupi-proactivity-config", "@/lib/edupi-proactivity-runtime",
    "@/lib/rpc-manager", "@/lib/edupi-prompt-reconciliation", "@/lib/session-reader", "@/lib/harness/runtime",
    "@/lib/safe-mode", "@/lib/image-attachments"]) modules[name] = {};
  const exported = { exports: {} };
  new Function("require", "module", "exports", compiled)(name => {
    assert.ok(Object.hasOwn(modules, name), name); return modules[name];
  }, exported, exported.exports);
  const entry = () => actualOutbox.readEduPiPromptOutbox(intent.sessionId, intent.clientRequestId, options);
  const cancel = (extra = {}) => exported.exports.DELETE(new Request("http://localhost/api/edupi/proactivity/prompt", {
    method: "DELETE", headers: { "content-type": "application/json" },
    body: JSON.stringify({ sessionId: intent.sessionId, clientRequestId: intent.clientRequestId, ...extra }),
  }));
  transport.length = 0;
  return { entry, cancel, transport, expectedRef, metadata, options, intent, root, get withdrawn() { return withdrawn; } };
}

for (const stage of ["registered", "captured", "pi_unknown"]) {
  test(`actual DELETE settles durable R04 ${stage} in its original conversation and messageRef`, async t => {
    const f = await recallCancellationFixture(t, stage);
    assert.equal(f.entry().stage, stage);
    const response = await f.cancel();
    assert.equal(response.status, 200);
    assert.equal((await response.json()).status, stage === "pi_unknown" ? "source_withdrawn" : "cancelled");
    assert.equal(f.entry().stage, stage === "pi_unknown" ? "pi_unverified_withdrawn" : "cancelled");
    const settlement = f.transport.find(event => event.operation === "owner_message_settle");
    assert.equal(settlement.input.conversation_id, f.metadata.conversationId);
    assert.equal(settlement.input.expected_message_ref, f.expectedRef);
    assert.equal(f.withdrawn, stage !== "registered");
    const count = f.transport.length;
    assert.equal((await f.cancel()).status, 200);
    assert.equal(f.transport.length, count);
  });
}
for (const corrupt of ["owner", "grant", "plan", "message-ref"]) {
  test(`DELETE refuses a durable R04 ${corrupt} binding mismatch before any Core settlement`, async t => {
    const f = await recallCancellationFixture(t, "registered", corrupt);
    const before = structuredClone(f.entry());
    assert.equal((await f.cancel()).status, 503);
    assert.deepEqual(f.entry(), before);
    assert.deepEqual(f.transport.map(event => event.operation), corrupt === "message-ref" ? ["health"] : []);
    for (const extra of [{ purpose: "recall" }, { rootRef }, { grantId: "forged" }]) {
      assert.equal((await f.cancel(extra)).status, 400);
    }
  });
}
test("a legacy G1 outbox with a recall-looking client message ID retains ordinary recovery identity", async t => {
  const f = await recallCancellationFixture(t, "registered");
  const legacy = actualOutbox.prepareEduPiPromptOutbox({
    sessionId: f.intent.sessionId, clientRequestId: "legacy-request", messageId: "r04_ordinary-client-id",
    occurredAt: "2026-11-18T00:00:00.000Z",
    command: { type: "prompt", message: "普通课前准备", clientRequestId: "legacy-request" },
    bindings: [{ domain: G1, ownerId: "synthetic-owner", grantId: "ordinary-g1-grant", grantVersion: 1,
      captureMessageId: "r04_ordinary-client-id", carrierId: "edupi.desktop.teaching_preparation",
      planId: "ordinary.g1.plan" }],
  }, f.options);
  assert.equal(recallPrompts.readRecallPromptOutboxBinding(legacy, f.options, rootRef), null);
  assert.deepEqual(f.transport, []);
});

test("explicit cancellation seals a pre-Pi registration; unknown settlement preserves it", async () => {
  const sealed = fixture({ registrationFailure: G1 });
  assert.equal((await sealed.post()).status, 202);
  const cancelled = await sealed.cancel();
  assert.equal(cancelled.status, 200);
  assert.equal((await cancelled.json()).status, "cancelled");
  assert.equal(sealed.entry().stage, "cancelled");
  assert.equal(sealed.events.includes("intent_discarded"), true);
  assert.equal((await sealed.cancel()).status, 200, "repeated cancellation repairs any missed intent settlement");
  assert.equal(sealed.events.includes("pi_send"), false);
  const uncertain = fixture({ registrationFailure: G1, settleFailure: true });
  assert.equal((await uncertain.post()).status, 202);
  assert.equal((await uncertain.cancel()).status, 503);
  assert.equal(uncertain.entry().stage, "prepared");
});

test("accepted request is idempotent and unsupported body cannot start a capture", async () => {
  const accepted = fixture();
  assert.equal((await accepted.post()).status, 200);
  assert.equal((await accepted.post()).status, 200);
  const altered = await accepted.post({ ...accepted.body,
    command: { ...accepted.body.command, message: "不同内容" } });
  assert.equal(altered.status, 409);
  assert.equal((await altered.json()).status, "conflict");
  assert.equal(accepted.events.filter(event => event === "pi_send").length, 1);
  const invalid = fixture();
  const result = await invalid.post({ ...invalid.body, command: { ...invalid.body.command, type: "steer" } });
  assert.equal(result.status, 400);
  assert.equal((await result.json()).status, "invalid");
  assert.equal(invalid.events.includes("outbox_prepared"), false);
  assert.equal(invalid.events.includes("pi_send"), false);
});
