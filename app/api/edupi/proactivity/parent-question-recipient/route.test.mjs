import assert from "node:assert/strict";
import crypto from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import ts from "typescript";

const source = fs.readFileSync(new URL("./route.ts", import.meta.url), "utf8");
const compiled = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.CommonJS,
  target: ts.ScriptTarget.ES2022, esModuleInterop: true } }).outputText;
const rootRef = `sha256:${"a".repeat(64)}`, basis = `sha256:${"b".repeat(64)}`;
const digest = value => crypto.createHash("sha256").update(value).digest("hex");
const messageId = generation => `parent-question-${digest(`question-1\u00001\u0000${generation}`)}`;
const planId = generation => `plan-${digest(messageId(generation)).slice(0, 16)}`;
const initialStateDir = process.env.PI_DESKTOP_STATE_DIR;

function fixture(t, { allowed = true, isolated = true, accepted = true, grant = true, registerFails = false, cancelFails = false,
  foreignQuestionCount = 0, ownerHistoryV3 = true, confirmationText = "确认学生甲的家长沟通收件人是家长乙",
  partialCommit = false, confirmResponse = response => response, cancelResponse = response => response,
  retainCancelledFact = false, confirmFails = false } = {}) {
  const stateDir = fs.mkdtempSync(path.join(os.tmpdir(), "edupi-parent-question-route-"));
  const dataRoot = fs.mkdtempSync(path.join(os.tmpdir(), "edupi-parent-question-data-"));
  fs.chmodSync(stateDir, 0o700);
  t.after(() => { fs.rmSync(stateDir, { recursive: true, force: true }); fs.rmSync(dataRoot, { recursive: true, force: true }); });
  process.env.PI_DESKTOP_STATE_DIR = stateDir;
  t.after(() => { if (initialStateDir === undefined) delete process.env.PI_DESKTOP_STATE_DIR; else process.env.PI_DESKTOP_STATE_DIR = initialStateDir; });
  const calls = [], captures = [], historicalFacts = new Map(), cancellationReceipts = new Map();
  let confirmed = false, failOnce = registerFails, cancelFailOnce = cancelFails, confirmedSourceId = null;
  let capturedMessageRef = null, confirmedMessageRef = null, confirmedPlanId = null;
  let currentAccepted = accepted, currentGrant = grant, currentEnabled = true;
  let currentCancelResponse = cancelResponse;
  let confirmFailOnce = confirmFails, currentQuestionCount = 0;
  const proof = { case_id: "case-1", question_fact_id: "question-1", question_revision: 1,
    student_id: "student-1", recipient_id: "parent-1", term_ref: "term-1",
    scope: { class_id: "class-1", subject: "math" }, deadline_at: "2026-11-07T00:00:00.000Z", grant_version: 1,
    source_basis_hash: basis, confirmation_plan_id: planId(0), confirmation_text: confirmationText,
    confirmed_fact_id: null, message_ref: null };
  const host = {
    async call(operation) { assert.equal(operation, "health"); return { ok: true, result: { data_root_fingerprint: rootRef,
      owner_message_capacity: { record_limit: ownerHistoryV3 ? 512 : 128 },
      capabilities: { g3_processor: "active", owner_message_registration: "active" } } }; },
    async callOwnerControl(operation, input) {
      calls.push({ operation, input });
      if (operation === "owner_read") return { ok: true, result: { owner: { id: "owner-1" }, grants: currentGrant ? [{ id: "grant-1", version: 1,
        status: "active", scope: { class_id: "class-1", subject: "math" } }] : [] } };
      if (operation === "owner_parent_question_recipient_read" && confirmed && partialCommit) {
        return { ok: true, result: { version: 1, status: "held", reason_code: "source_changed", candidate: null,
          fact_write: false, model_execute: false, live_authority: false, external_send: false } };
      }
      if (operation === "owner_parent_question_recipient_read" && input.question_fact_id.startsWith("current-question-")) {
        return { ok: true, result: { version: 1, status: "needs_confirmation", candidate: {
          ...proof, question_fact_id: input.question_fact_id, confirmation_plan_id: `plan-${digest(input.message_id).slice(0, 16)}`,
        }, fact_write: false, model_execute: false, live_authority: false, external_send: false } };
      }
      if (operation === "owner_parent_question_recipient_read") return { ok: true, result: { version: 1,
        status: confirmed ? "confirmed" : "needs_confirmation", reason_code: null,
        candidate: { ...proof, confirmation_plan_id: confirmed ? confirmedPlanId : `plan-${digest(input.message_id).slice(0, 16)}`,
          confirmed_fact_id: confirmed ? "fact-confirmed" : null, message_ref: confirmed ? confirmedMessageRef : null },
        fact_write: false, model_execute: false, live_authority: false, external_send: false } };
      if (operation === "owner_parent_question_recipient_confirm") {
        if (confirmFailOnce) { confirmFailOnce = false; throw new Error("confirmation temporarily unavailable"); }
        assert.equal(input.message_ref, capturedMessageRef); assert.equal(input.expected_source_basis_hash, basis);
        confirmedSourceId = `parent_question_recipient:${crypto.createHash("sha256").update(input.command_id).digest("hex")}`;
        confirmedMessageRef = input.message_ref;
        confirmedPlanId = `plan-${digest(input.message_id).slice(0, 16)}`;
        confirmed = true;
        return confirmResponse({ ok: true, result: { version: 1, status: partialCommit ? "held" : "confirmed",
          ...(partialCommit ? { reason_code: "source_changed" } : {}), case_id: "case-1",
          fact_id: "fact-confirmed", fact_revision: 2, message_ref: confirmedMessageRef,
          source_basis_hash: basis, fact_write: true, model_execute: false, live_authority: false, external_send: false } });
      }
      if (operation === "owner_parent_question_recipient_cancel") {
        if (cancelFailOnce) { cancelFailOnce = false; throw new Error("cancellation temporarily unavailable"); }
        const replay = cancellationReceipts.get(input.command_id);
        if (replay) return currentCancelResponse({ ok: true, result: { ...replay, status: "replayed" } });
        const historicalFact = historicalFacts.get(input.question_fact_id);
        if (historicalFact) historicalFacts.delete(input.question_fact_id);
        else { assert.equal(input.message_ref, confirmedMessageRef); confirmed = retainCancelledFact; }
        const receipt = { version: 1, status: "cancelled", question_fact_id: input.question_fact_id,
          message_ref: input.message_ref, fact_id: historicalFact?.fact_id ?? "fact-confirmed",
          fact_revision: historicalFact ? historicalFact.revision + 1 : 3, source_basis_hash: basis, fact_write: true,
          model_execute: false, live_authority: false, external_send: false };
        cancellationReceipts.set(input.command_id, receipt);
        return currentCancelResponse({ ok: true, result: receipt });
      }
      assert.fail(operation);
    },
  };
  const modules = {
    "node:crypto": crypto, "node:fs": fs, "node:path": path,
    "next/server": { NextResponse: { json: (body, init = {}) => Response.json(body, init) } },
    "@/lib/desktop-api-auth": { isDesktopApiRequestAllowed: () => allowed },
    "@/lib/bounded-form-data": { parseJsonWithinLimit: request => request.json(), RequestBodyTooLargeError: class extends Error {} },
    "@/lib/edupi-core-snapshot": { resolveEduPiBridgeRoots: () => ({ dataRoot: { root: dataRoot } }),
      readEduPiEducationSnapshot: async () => ({ workspace: { fact_spine: { projection_kind: "education_fact_v1", external_send: false,
        observations: [{ observation_id: "observation-1", status: "active", entity_ids: ["class-1"], source_id: "question-source" },
          ...Array.from({ length: foreignQuestionCount }, (_, index) => ({ observation_id: `foreign-observation-${index}`, status: "active",
            entity_ids: ["class-other"], source_id: `foreign-source-${index}` }))],
        accepted_facts: [
          ...historicalFacts.values(),
          ...Array.from({ length: currentQuestionCount }, (_, index) => ({ fact_id: `current-question-${index}`,
            revision: 1, status: "accepted", predicate: "communication.parent_question",
            subject_ref: "math", observation_ids: ["observation-1"], source_ids: ["question-source"] })),
          ...(currentAccepted ? [{ fact_id: "question-1", revision: 1, status: "accepted", predicate: "communication.parent_question",
            subject_ref: "math", observation_ids: ["observation-1"], source_ids: ["question-source"] }] : []),
          ...Array.from({ length: foreignQuestionCount }, (_, index) => ({ fact_id: `foreign-question-${index}`, revision: 1,
            status: "accepted", predicate: "communication.parent_question", subject_ref: "math",
            observation_ids: [`foreign-observation-${index}`], source_ids: [`foreign-source-${index}`] })),
          ...(confirmed && confirmedSourceId ? [{ fact_id: "fact-confirmed", revision: 2, status: "accepted",
            predicate: "communication.question_recipient_confirmed", source_ids: [confirmedSourceId] }] : []),
        ] } } }) },
    "@/lib/edupi-proactivity-config": { readEduPiProactivityActivation: () => ({ enabled: currentEnabled, grantId: "grant-1", ownerId: "owner-1",
      scope: { classId: "class-1", subject: "math" } }) },
    "@/lib/edupi-proactivity-control": { proactivityConversationId: () => "desktop-parent-communication-canary-v1" },
    "@/lib/edupi-runtime-supervisor": { ensureEduPiRuntime: async () => host },
    "@/lib/edupi-registered-prompt": { registerAndCapturePrompt: async (_host, input, hooks) => {
      captures.push(input);
      capturedMessageRef = `owner_message:${digest(input.messageId)}`;
      hooks.onRegistered({ messageRef: capturedMessageRef });
      if (failOnce) { failOnce = false; throw new Error("capture interrupted"); }
      hooks.onCaptured({ messageRef: capturedMessageRef });
      return { messageRef: capturedMessageRef };
    } },
    "@/lib/edupi-ambient-session-lock": { withEduPiAmbientSessionLock: async (_key, run) => run() },
    "@/lib/safe-mode": { canStartEduPiCapabilityDrafts: () => isolated },
    "@/lib/atomic-file": { writePrivateFileAtomicSync: (file, body) => fs.writeFileSync(file, body, { mode: 0o600 }) },
  };
  const routeModule = { exports: {} };
  new Function("require", "module", "exports", compiled)(name => { assert.ok(modules[name], name); return modules[name]; }, routeModule, routeModule.exports);
  const input = (generation = 0, action = "confirm") => ({ action, questionFactId: "question-1", questionRevision: 1,
    messageGeneration: generation, sourceBasisHash: basis, confirmationPlanId: planId(generation),
    ...(action === "confirm" ? { confirmationText } : {}) });
  return { calls, captures, stateDir, input, setSourceCurrent(value) { currentAccepted = value; }, setGrantCurrent(value) { currentGrant = value; },
    setActivationEnabled(value) { currentEnabled = value; },
    setCancelResponse(value) { currentCancelResponse = value; },
    setConfirmedSource(value) { confirmedSourceId = value; },
    setCurrentQuestionCount(value) { currentQuestionCount = value; },
    rewriteJournal(update) {
      const directory = path.join(stateDir, "edupi-parent-question-confirmations-v1");
      const file = path.join(directory, fs.readdirSync(directory)[0]);
      fs.writeFileSync(file, `${JSON.stringify(update(JSON.parse(fs.readFileSync(file, "utf8"))))}\n`);
    },
    removeJournals() {
      const directory = path.join(stateDir, "edupi-parent-question-confirmations-v1");
      for (const name of fs.readdirSync(directory)) fs.unlinkSync(path.join(directory, name));
    },
    journals() {
      const directory = path.join(stateDir, "edupi-parent-question-confirmations-v1");
      return fs.existsSync(directory)
        ? fs.readdirSync(directory).map(name => JSON.parse(fs.readFileSync(path.join(directory, name), "utf8"))) : [];
    },
    seedHistory(count, stage = "cancelled") {
      const directory = path.join(stateDir, "edupi-parent-question-confirmations-v1");
      const original = JSON.parse(fs.readFileSync(path.join(directory, fs.readdirSync(directory)[0]), "utf8"));
      for (let index = 0; index < count; index++) {
        const factId = `history-question-${index}`;
        const base = { ...original };
        delete base.confirmedFactId;
        delete base.confirmedFactRevision;
        const journal = { ...base, questionFactId: factId,
          messageId: `parent-question-${digest(`${factId}\u00001\u00000`)}`,
          commandId: `parent-question-confirm-${digest(`${factId}\u0000${basis}\u00000`)}`,
          messageRef: `owner_message:${digest(factId)}`, stage,
          ...(stage === "captured" ? { confirmedFactId: `confirmed-history-${index}`, confirmedFactRevision: 1 } : {}),
          candidate: { ...original.candidate, question_fact_id: factId, scope: { class_id: "class-other", subject: "math" } } };
        const filename = `${digest(`${rootRef}\u0000${factId}\u00001\u0000${basis}\u00000`)}.json`;
        fs.writeFileSync(path.join(directory, filename), `${JSON.stringify(journal)}\n`, { mode: 0o600 });
        if (stage === "captured") historicalFacts.set(factId, { fact_id: `confirmed-history-${index}`, revision: 1, status: "accepted",
          predicate: "communication.question_recipient_confirmed", source_ids: [`parent_question_recipient:${digest(journal.commandId)}`] });
      }
    },
    get: () => routeModule.exports.GET(new Request("http://localhost/api/edupi/proactivity/parent-question-recipient")),
    post: (body = input()) => routeModule.exports.POST(new Request("http://localhost/api/edupi/proactivity/parent-question-recipient", {
      method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) })) };
}

test("current accepted question registers the exact owner confirmation and reads back the fact", async t => {
  const f = fixture(t);
  const before = await (await f.get()).json();
  assert.equal(before.entries.length, 1);
  assert.equal(before.entries[0].candidate.confirmation_text, "确认学生甲的家长沟通收件人是家长乙");
  const response = await f.post();
  assert.equal(response.status, 200, JSON.stringify(await response.clone().json()));
  assert.equal((await response.json()).readbackConfirmed, true);
  assert.equal(f.captures.length, 1);
  assert.equal(f.captures[0].text, before.entries[0].candidate.confirmation_text);
  assert.equal(f.captures[0].planId, planId(0));
  assert.equal(f.calls.some(call => call.operation === "owner_parent_question_recipient_confirm"), true);
  assert.equal((await (await f.get()).json()).entries[0].status, "confirmed");
  const cancelled = await f.post(f.input(0, "cancel"));
  assert.equal(cancelled.status, 200);
  assert.equal((await cancelled.json()).status, "cancelled");
});

test("confirm requires seven exact fields and cancel accepts only its six fields", async t => {
  const f = fixture(t);
  const { confirmationText, ...missingText } = f.input();
  assert.equal(Object.keys(f.input()).length, 7);
  assert.equal(Object.keys(f.input(0, "cancel")).length, 6);
  for (const input of [missingText, { ...f.input(), confirmationText: "" },
    { ...f.input(), confirmationText: " " }, { ...f.input(), confirmationText: 42 },
    { ...f.input(), confirmationText: "确".repeat(501) },
    { ...f.input(), unexpected: true }, { ...f.input(0, "cancel"), confirmationText }]) {
    assert.equal((await f.post(input)).status, 400);
  }
  assert.deepEqual(f.calls, []);
  assert.deepEqual(f.captures, []);
  assert.deepEqual(f.journals(), []);
  assert.equal((await f.post()).status, 200);
  assert.equal((await f.post(f.input(0, "cancel"))).status, 200);
});

test("a different teacher confirmation text cannot register a message or commit a fact", async t => {
  const f = fixture(t);
  const response = await f.post({ ...f.input(), confirmationText: "确认学生甲的家长沟通收件人是家长丙" });
  assert.equal(response.status, 409);
  assert.equal((await response.json()).code, "confirmation_text_mismatch");
  assert.equal(f.captures.length, 0);
  assert.equal(f.calls.some(call => call.operation === "owner_parent_question_recipient_confirm"), false);
  assert.deepEqual(f.journals(), []);
  assert.equal((await (await f.get()).json()).entries[0].status, "needs_confirmation");
});

test("equivalent teacher text is captured verbatim and survives journal readback", async t => {
  const f = fixture(t, { confirmationText: "确认学生甲1班的家长沟通收件人是家长乙" });
  const teacherText = "\n确认 学生甲１班的家长沟通收件人是家长乙 ";
  assert.equal((await f.post({ ...f.input(), confirmationText: teacherText })).status, 200);
  assert.equal(f.captures[0].text, teacherText);
  assert.equal(f.journals()[0].confirmationText, teacherText);
  assert.equal((await (await f.get()).json()).entries[0].status, "confirmed");
  assert.equal((await f.post(f.input(0, "cancel"))).status, 200);
});

test("cancel rejects a tampered Core receipt even when its fact is already absent, then retries the exact command", async t => {
  const variants = [
    ["question identity", response => ({ ...response, result: { ...response.result, question_fact_id: "foreign-question" } })],
    ["message identity", response => ({ ...response, result: { ...response.result, message_ref: `owner_message:${"f".repeat(64)}` } })],
    ["fact identity", response => ({ ...response, result: { ...response.result, fact_id: "foreign-fact" } })],
    ["source identity", response => ({ ...response, result: { ...response.result, source_basis_hash: `sha256:${"f".repeat(64)}` } })],
    ["missing fact identity", response => {
      const { fact_id, ...result } = response.result;
      assert.ok(fact_id);
      return { ...response, result };
    }],
    ["protocol version", response => ({ ...response, result: { ...response.result, version: 2 } })],
    ["string protocol version", response => ({ ...response, result: { ...response.result, version: "1" } })],
    ["fact revision", response => ({ ...response, result: { ...response.result, fact_revision: 0 } })],
    ["outer ok false", response => ({ ...response, ok: false })],
    ["outer ok missing", response => ({ result: response.result })],
    ["fact_write false", response => ({ ...response, result: { ...response.result, fact_write: false } })],
    ["external send", response => ({ ...response, result: { ...response.result, external_send: true } })],
    ["model execution", response => ({ ...response, result: { ...response.result, model_execute: true } })],
    ["live authority", response => ({ ...response, result: { ...response.result, live_authority: true } })],
  ];
  for (const [name, cancelResponse] of variants) await t.test(name, async child => {
    const f = fixture(child, { cancelResponse });
    assert.equal((await f.post()).status, 200);
    const failed = await f.post(f.input(0, "cancel"));
    assert.equal(failed.status, 503);
    assert.notEqual((await failed.json()).readbackConfirmed, true);
    assert.equal(f.journals()[0].stage, "cancel_pending");
    f.setCancelResponse(response => {
      assert.equal(response.result.status, "replayed");
      return response;
    });
    const retried = await f.post(f.input(0, "cancel"));
    assert.equal(retried.status, 200);
    assert.equal((await retried.json()).readbackConfirmed, true);
    assert.equal(f.journals()[0].stage, "cancelled");
    const cancellations = f.calls.filter(call => call.operation === "owner_parent_question_recipient_cancel");
    assert.equal(cancellations.length, 2);
    assert.deepEqual(cancellations[0].input, cancellations[1].input);
    const next = (await (await f.get()).json()).entries[0];
    assert.equal(next.status, "needs_confirmation");
    assert.equal(next.messageGeneration, 1);
    assert.equal(f.captures.length, 1);
  });
});

test("an exact cancellation receipt cannot succeed while the accepted fact still exists", async t => {
  const f = fixture(t, { retainCancelledFact: true });
  assert.equal((await f.post()).status, 200);
  assert.equal((await f.post(f.input(0, "cancel"))).status, 503);
  assert.equal(f.journals()[0].stage, "cancel_pending");
  assert.equal((await (await f.get()).json()).entries[0].status, "confirmed");
});

test("held with fact_write preserves the committed confirmation for explicit cancellation after refresh", async t => {
  const f = fixture(t, { partialCommit: true });
  const response = await f.post();
  assert.notEqual(response.status, 200);
  assert.notEqual((await response.json()).readbackConfirmed, true);
  assert.equal(f.captures.length, 1);
  assert.equal(f.journals()[0].stage, "captured");
  const entries = (await (await f.get()).json()).entries;
  assert.equal(entries.length, 1);
  assert.equal(entries[0].status, "stale_confirmed");
  assert.equal(entries[0].candidate.confirmed_fact_id, "fact-confirmed");
  assert.equal(entries[0].messageGeneration, 0);
  assert.equal((await f.post()).status, 409);
  assert.equal(f.captures.length, 1);
  const cancelled = await f.post(f.input(0, "cancel"));
  assert.equal(cancelled.status, 200);
  assert.equal((await cancelled.json()).readbackConfirmed, true);
  assert.equal(f.journals()[0].stage, "cancelled");
  const next = (await (await f.get()).json()).entries[0];
  assert.equal(next.status, "needs_confirmation");
  assert.equal(next.messageGeneration, 1);
  assert.notEqual(next.candidate.confirmation_plan_id, entries[0].candidate.confirmation_plan_id);
});

test("confirm rejects invalid receipt authority and identity while retaining cancellation of the committed fact", async t => {
  const variants = [
    ["outer ok", response => ({ ...response, ok: false })],
    ["version", response => ({ ...response, result: { ...response.result, version: 2 } })],
    ["case identity", response => ({ ...response, result: { ...response.result, case_id: "foreign-case" } })],
    ["fact revision", response => ({ ...response, result: { ...response.result, fact_revision: 0 } })],
    ["fact identity", response => ({ ...response, result: { ...response.result, fact_id: "foreign-fact" } })],
  ];
  for (const [name, confirmResponse] of variants) await t.test(name, async child => {
    const f = fixture(child, { confirmResponse });
    const response = await f.post();
    assert.equal(response.status, 503);
    assert.notEqual((await response.json()).readbackConfirmed, true);
    assert.equal(f.journals()[0].stage, "captured");
    const entries = (await (await f.get()).json()).entries;
    assert.equal(entries.length, 1);
    assert.equal(entries[0].candidate.confirmed_fact_id, "fact-confirmed");
    const cancelled = await f.post(f.input(0, "cancel"));
    assert.equal(cancelled.status, 200);
    assert.equal((await cancelled.json()).readbackConfirmed, true);
  });
});

test("interrupted capture retries the same durable owner message", async t => {
  const f = fixture(t, { registerFails: true });
  assert.equal((await f.post()).status, 503);
  assert.equal((await f.post()).status, 200);
  assert.equal(f.captures.length, 2);
  assert.equal(f.captures[0].messageId, f.captures[1].messageId);
  assert.equal(f.captures[0].occurredAt, f.captures[1].occurredAt);
});

test("v1 interrupted journals resume the original message and command at every confirmation stage", async t => {
  for (const stage of ["prepared", "registered", "captured"]) await t.test(stage, async child => {
    const f = fixture(child, stage === "captured" ? { confirmFails: true } : { registerFails: true });
    assert.equal((await f.post()).status, 503);
    f.rewriteJournal(journal => ({ ...journal, version: 1, stage,
      messageRef: stage === "prepared" ? null : journal.messageRef }));
    const original = f.journals()[0];
    const response = await f.post();
    assert.equal(response.status, 200);
    assert.equal((await response.json()).readbackConfirmed, true);
    assert.equal(f.journals()[0].messageId, original.messageId);
    assert.equal(f.journals()[0].commandId, original.commandId);
    assert.equal(f.journals()[0].occurredAt, original.occurredAt);
    assert.equal(f.journals()[0].confirmationText, original.confirmationText);
    assert.equal(f.captures.length, stage === "captured" ? 1 : 2);
  });
});

test("v1 cancellation pins the original fact before an interrupted Core commit and exact replay", async t => {
  const f = fixture(t, { cancelResponse: () => { throw new Error("response lost after deletion"); } });
  assert.equal((await f.post()).status, 200);
  f.rewriteJournal(({ confirmedFactId, confirmedFactRevision, ...journal }) => {
    assert.equal(confirmedFactId, "fact-confirmed");
    assert.equal(confirmedFactRevision, 2);
    return { ...journal, version: 1 };
  });
  assert.equal((await f.post(f.input(0, "cancel"))).status, 503);
  assert.equal(f.journals()[0].confirmedFactId, "fact-confirmed");
  assert.equal(f.journals()[0].confirmedFactRevision, 2);
  const pending = (await (await f.get()).json()).entries.find(entry => entry.status === "stale_confirmed");
  assert.equal(pending.candidate.confirmed_fact_id, "fact-confirmed");
  f.setCancelResponse(response => ({ ...response, result: { ...response.result, fact_id: "foreign-fact" } }));
  assert.equal((await f.post(f.input(0, "cancel"))).status, 503);
  f.setCancelResponse(response => {
    assert.equal(response.result.status, "replayed");
    return response;
  });
  assert.equal((await f.post(f.input(0, "cancel"))).status, 200);
  const cancellations = f.calls.filter(call => call.operation === "owner_parent_question_recipient_cancel");
  assert.equal(cancellations.length, 3);
  assert.deepEqual(cancellations[1].input, cancellations[0].input);
  assert.deepEqual(cancellations[2].input, cancellations[0].input);
  assert.equal(f.journals()[0].stage, "cancelled");
});

test("v1 captured confirmation retries a lost Core response without capturing a new message", async t => {
  let loseResponse = true;
  const f = fixture(t, { confirmResponse: response => {
    if (loseResponse) { loseResponse = false; throw new Error("response lost after confirmation"); }
    return { ...response, result: { ...response.result, status: "replayed" } };
  } });
  assert.equal((await f.post()).status, 503);
  f.rewriteJournal(journal => ({ ...journal, version: 1 }));
  assert.equal(f.journals()[0].confirmedFactId, undefined);
  assert.equal((await f.post()).status, 200);
  assert.equal(f.captures.length, 1);
  const confirmations = f.calls.filter(call => call.operation === "owner_parent_question_recipient_confirm");
  assert.equal(confirmations.length, 2);
  assert.deepEqual(confirmations[1].input, confirmations[0].input);
  assert.equal(f.journals()[0].confirmedFactId, "fact-confirmed");
});

test("a missing journal recovers only the exact Core-confirmed Desktop generation for cancellation", async t => {
  const f = fixture(t);
  assert.equal((await f.post()).status, 200);
  assert.equal((await f.post(f.input(0, "cancel"))).status, 200);
  assert.equal((await f.post(f.input(1))).status, 200);
  f.removeJournals();
  const entry = (await (await f.get()).json()).entries[0];
  assert.equal(entry.messageGeneration, 1);
  assert.equal(entry.status, "confirmed");
  assert.deepEqual(f.journals(), []);
  assert.equal((await f.post(f.input(0, "cancel"))).status, 409);
  assert.equal((await f.post({ ...f.input(1, "cancel"), sourceBasisHash: `sha256:${"f".repeat(64)}` })).status, 409);
  assert.equal((await f.post(f.input(1, "cancel"))).status, 200);
  assert.equal(f.journals()[0].confirmedFactId, "fact-confirmed");
  assert.equal(f.journals()[0].stage, "cancelled");
  assert.equal(f.captures.length, 2);
});

test("missing-journal cancellation persists recovery before Core deletion and validates replay", async t => {
  const f = fixture(t, { cancelResponse: () => { throw new Error("response lost"); } });
  assert.equal((await f.post()).status, 200);
  f.removeJournals();
  assert.equal((await f.post(f.input(0, "cancel"))).status, 503);
  assert.equal(f.journals()[0].stage, "cancel_pending");
  assert.equal(f.journals()[0].confirmedFactId, "fact-confirmed");
  assert.equal(f.journals()[0].confirmedFactRevision, 2);
  f.setCancelResponse(response => {
    assert.equal(response.result.status, "replayed");
    return response;
  });
  assert.equal((await f.post(f.input(0, "cancel"))).status, 200);
  assert.equal(f.journals()[0].stage, "cancelled");
  assert.equal(f.captures.length, 1);
});

test("missing-journal recovery refuses an unbound fact or an unavailable current authority", async t => {
  for (const change of [
    f => f.setConfirmedSource("parent_question_recipient:foreign"),
    f => f.setGrantCurrent(false),
    f => f.setSourceCurrent(false),
    f => f.setActivationEnabled(false),
  ]) await t.test(change.toString(), async child => {
    const f = fixture(child);
    assert.equal((await f.post()).status, 200);
    f.removeJournals();
    change(f);
    assert.equal((await f.post(f.input(0, "cancel"))).status, 409);
    assert.deepEqual(f.journals(), []);
    assert.equal(f.calls.some(call => call.operation === "owner_parent_question_recipient_cancel"), false);
  });
});

test("an old pending cancellation without an original fact identity cannot trust a replay receipt", async t => {
  const f = fixture(t, { cancelResponse: () => { throw new Error("response lost"); } });
  assert.equal((await f.post()).status, 200);
  assert.equal((await f.post(f.input(0, "cancel"))).status, 503);
  f.rewriteJournal(journal => {
    delete journal.confirmedFactId;
    delete journal.confirmedFactRevision;
    return { ...journal, version: 1 };
  });
  f.setCancelResponse(response => response);
  assert.equal((await f.post(f.input(0, "cancel"))).status, 409);
  assert.equal(f.journals()[0].stage, "cancel_pending");
  assert.equal(f.calls.filter(call => call.operation === "owner_parent_question_recipient_cancel").length, 1);
});

test("journal versions are numbers and legacy text is not reinterpreted by v2 normalization", async t => {
  for (const update of [
    journal => ({ ...journal, version: "1" }),
    journal => ({ ...journal, version: 1, confirmationText: ` ${journal.confirmationText} ` }),
  ]) await t.test(update.toString(), async child => {
    const f = fixture(child, { registerFails: true });
    assert.equal((await f.post()).status, 503);
    f.rewriteJournal(update);
    assert.equal((await f.post()).status, 503);
    assert.equal(f.captures.length, 1);
    assert.equal(f.calls.some(call => call.operation === "owner_parent_question_recipient_confirm"), false);
  });
});

test("128 current questions cannot hide historical cancellation", async t => {
  const f = fixture(t);
  assert.equal((await f.post()).status, 200);
  f.seedHistory(2, "captured");
  f.setCurrentQuestionCount(127);
  const entries = (await (await f.get()).json()).entries;
  assert.ok(entries.length <= 128);
  const historical = entries.find(entry => entry.status === "stale_confirmed");
  assert.ok(historical);
  const response = await f.post({ action: "cancel", questionFactId: historical.questionFactId,
    questionRevision: historical.questionRevision, messageGeneration: historical.messageGeneration,
    sourceBasisHash: historical.candidate.source_basis_hash, confirmationPlanId: historical.candidate.confirmation_plan_id });
  assert.equal(response.status, 200);
  f.setCurrentQuestionCount(128);
  assert.equal((await f.get()).status, 200);
  assert.ok((await (await f.get()).json()).entries.some(entry => entry.status === "stale_confirmed"));
});

test("failed cancellation remains retryable after refresh and advances generation only after cancellation", async t => {
  const f = fixture(t, { cancelFails: true });
  assert.equal((await f.post()).status, 200);
  assert.equal((await f.post(f.input(0, "cancel"))).status, 503);
  const directory = path.join(f.stateDir, "edupi-parent-question-confirmations-v1");
  const journalPath = path.join(directory, fs.readdirSync(directory)[0]);
  assert.equal(JSON.parse(fs.readFileSync(journalPath, "utf8")).stage, "cancel_pending");
  const response = await f.get();
  assert.equal(response.status, 200);
  const entries = (await response.json()).entries;
  assert.equal(entries.length, 1);
  const entry = entries[0];
  assert.equal(entry.status, "confirmed");
  const retry = await f.post({ action: "cancel", questionFactId: entry.questionFactId, questionRevision: entry.questionRevision,
    messageGeneration: entry.messageGeneration, sourceBasisHash: entry.candidate.source_basis_hash,
    confirmationPlanId: entry.candidate.confirmation_plan_id });
  assert.equal(retry.status, 200);
  assert.equal((await retry.json()).readbackConfirmed, true);
  assert.equal(entry.messageGeneration, 0);
  assert.equal(entry.candidate.confirmation_plan_id, planId(0));
  assert.equal(JSON.parse(fs.readFileSync(journalPath, "utf8")).stage, "cancelled");
  const cancellations = f.calls.filter(call => call.operation === "owner_parent_question_recipient_cancel");
  assert.equal(cancellations.length, 2);
  assert.deepEqual(cancellations[1].input, cancellations[0].input);
  const next = (await (await f.get()).json()).entries;
  assert.equal(next.length, 1);
  assert.equal(next[0].status, "needs_confirmation");
  assert.equal(next[0].messageGeneration, 1);
  assert.equal(next[0].candidate.confirmation_plan_id, planId(1));
  assert.equal((await f.post(f.input(1))).status, 200);
  const reconfirmed = (await (await f.get()).json()).entries;
  assert.equal(reconfirmed.length, 1);
  assert.equal(reconfirmed[0].status, "confirmed");
  assert.equal(reconfirmed[0].messageGeneration, 1);
  assert.equal(reconfirmed[0].candidate.confirmation_plan_id, planId(1));
  assert.notEqual(f.captures[0].messageId, f.captures[1].messageId);
});

test("legacy owner history leaves existing G3 running but does not claim G5 confirmation", async t => {
  const f = fixture(t, { ownerHistoryV3: false });
  const response = await f.get();
  assert.equal(response.status, 409);
  assert.equal((await response.json()).code, "owner_history_upgrade_required");
  assert.equal((await f.post()).status, 409);
  assert.equal(f.calls.some(call => call.operation === "owner_parent_question_recipient_confirm"), false);
});

test("a narrowed grant and withdrawn question still expose owner cancellation from the journal", async t => {
  const f = fixture(t);
  assert.equal((await f.post()).status, 200);
  f.setGrantCurrent(false);
  f.setSourceCurrent(false);
  const entries = (await (await f.get()).json()).entries;
  assert.equal(entries.length, 1);
  assert.equal(entries[0].status, "stale_confirmed");
  const response = await f.post(f.input(0, "cancel"));
  assert.equal(response.status, 200);
  assert.equal((await response.json()).readbackConfirmed, true);
  assert.equal((await (await f.get()).json()).entries.length, 0);
});

test("disabling parent communication still permits cancellation of an earlier confirmation", async t => {
  const f = fixture(t);
  assert.equal((await f.post()).status, 200);
  f.setActivationEnabled(false);
  const entries = (await (await f.get()).json()).entries;
  assert.equal(entries.length, 1);
  assert.equal(entries[0].status, "stale_confirmed");
  assert.equal((await f.post()).status, 409);
  const response = await f.post(f.input(0, "cancel"));
  assert.equal(response.status, 200);
  assert.equal((await response.json()).readbackConfirmed, true);
  assert.equal((await (await f.get()).json()).entries.length, 0);
});

test("confirm, cancel, then reconfirm uses a new owner message and plan while retaining the old receipt", async t => {
  const f = fixture(t);
  assert.equal((await f.post(f.input(0))).status, 200);
  const first = f.captures[0];
  const firstCommand = f.calls.find(call => call.operation === "owner_parent_question_recipient_confirm").input.command_id;
  assert.equal((await f.post(f.input(0, "cancel"))).status, 200);
  const next = (await (await f.get()).json()).entries;
  assert.equal(next.length, 1);
  assert.equal(next[0].messageGeneration, 1);
  assert.equal(next[0].candidate.confirmation_plan_id, planId(1));
  assert.equal((await f.post(f.input(1))).status, 200);
  assert.equal(f.captures.length, 2);
  assert.notEqual(f.captures[1].messageId, first.messageId);
  assert.notEqual(f.captures[1].planId, first.planId);
  const commands = f.calls.filter(call => call.operation === "owner_parent_question_recipient_confirm").map(call => call.input.command_id);
  assert.notEqual(commands[1], firstCommand);
  const receipts = fs.readdirSync(path.join(f.stateDir, "edupi-parent-question-confirmations-v1"))
    .map(name => JSON.parse(fs.readFileSync(path.join(f.stateDir, "edupi-parent-question-confirmations-v1", name), "utf8")));
  assert.deepEqual(receipts.map(item => item.stage).sort(), ["cancelled", "captured"]);
  assert.deepEqual(receipts.map(item => item.generation).sort(), [0, 1]);
  assert.equal((await f.post(f.input(0))).status, 409);
});

test("non-isolated, foreign grant, missing source and injected fields never confirm", async t => {
  for (const options of [{ allowed: false }, { isolated: false }, { accepted: false }, { grant: false }]) {
    const f = fixture(t, options), response = await f.post();
    assert.notEqual(response.status, 200);
    assert.equal(f.calls.some(call => call.operation === "owner_parent_question_recipient_confirm"), false);
  }
  const extra = fixture(t), response = await extra.post({ ...extra.input(), arbitrary: "value" });
  assert.equal(response.status, 400);
});

test("scope filtering occurs before the 128 current-question limit", async t => {
  const f = fixture(t, { foreignQuestionCount: 200 });
  const response = await f.get();
  assert.equal(response.status, 200);
  const entries = (await response.json()).entries;
  assert.deepEqual(entries.map(item => item.questionFactId), ["question-1"]);
  assert.equal(f.calls.filter(item => item.operation === "owner_parent_question_recipient_read").length, 1);
});

test("maximum-length Chinese confirmation survives journal readback, cancellation and reconfirmation", async t => {
  const confirmationText = "确".repeat(500), f = fixture(t, { confirmationText });
  assert.equal((await f.post()).status, 200);
  const directory = path.join(f.stateDir, "edupi-parent-question-confirmations-v1");
  assert.ok(fs.statSync(path.join(directory, fs.readdirSync(directory)[0])).size > 4096);
  const response = await f.get();
  assert.equal(response.status, 200);
  assert.equal((await response.json()).entries[0].candidate.confirmation_text, confirmationText);
  assert.equal((await f.post(f.input(0, "cancel"))).status, 200);
  assert.equal((await f.post(f.input(1))).status, 200);
  assert.equal((await (await f.get()).json()).entries[0].status, "confirmed");
});

test("cross-class confirmation history keeps the current list usable and each historical cancellation reachable", async t => {
  const f = fixture(t);
  assert.equal((await f.post()).status, 200);
  f.seedHistory(129, "captured");
  const cancelled = new Set();
  for (let index = 0; index < 129; index++) {
    const response = await f.get();
    assert.equal(response.status, 200);
    const entries = (await response.json()).entries;
    assert.ok(entries.length <= 128);
    assert.equal(entries[0].questionFactId, "question-1");
    assert.equal(entries[0].status, "confirmed");
    const historical = entries.find(item => item.status === "stale_confirmed");
    assert.ok(historical);
    assert.equal(cancelled.has(historical.questionFactId), false);
    const result = await f.post({ action: "cancel", questionFactId: historical.questionFactId,
      questionRevision: historical.questionRevision, messageGeneration: historical.messageGeneration,
      sourceBasisHash: historical.candidate.source_basis_hash, confirmationPlanId: historical.candidate.confirmation_plan_id });
    assert.equal(result.status, 200);
    assert.equal((await result.json()).readbackConfirmed, true);
    cancelled.add(historical.questionFactId);
  }
  assert.equal(cancelled.size, 129);
  assert.equal((await (await f.get()).json()).entries.length, 1);
  assert.equal(fs.readdirSync(path.join(f.stateDir, "edupi-parent-question-confirmations-v1")).length, 130);
});

test("more than 500 cancelled journals do not block reads, cancellation or a new confirmation generation", async t => {
  const f = fixture(t);
  assert.equal((await f.post()).status, 200);
  f.seedHistory(501);
  assert.equal((await f.post(f.input(0, "cancel"))).status, 200);
  const response = await f.get();
  assert.equal(response.status, 200);
  assert.equal((await response.json()).entries[0].messageGeneration, 1);
  assert.equal((await f.post(f.input(1))).status, 200);
  assert.equal((await (await f.get()).json()).entries[0].status, "confirmed");
  assert.equal(fs.readdirSync(path.join(f.stateDir, "edupi-parent-question-confirmations-v1")).length, 503);
});

test("cancellation reads only its target journal even if unrelated history is unreadable", async t => {
  const f = fixture(t);
  assert.equal((await f.post()).status, 200);
  const directory = path.join(f.stateDir, "edupi-parent-question-confirmations-v1");
  fs.writeFileSync(path.join(directory, `${digest("unrelated-history")}.json`), "{", { mode: 0o600 });
  const response = await f.post(f.input(0, "cancel"));
  assert.equal(response.status, 200);
  assert.equal((await response.json()).readbackConfirmed, true);
});

test("direct cancellation rejects a target journal substituted from another root", async t => {
  const f = fixture(t);
  assert.equal((await f.post()).status, 200);
  const directory = path.join(f.stateDir, "edupi-parent-question-confirmations-v1");
  const file = path.join(directory, fs.readdirSync(directory)[0]);
  const saved = JSON.parse(fs.readFileSync(file, "utf8"));
  saved.rootRef = `sha256:${"c".repeat(64)}`;
  fs.writeFileSync(file, `${JSON.stringify(saved)}\n`);
  assert.equal((await f.post(f.input(0, "cancel"))).status, 409);
  assert.equal(f.calls.some(call => call.operation === "owner_parent_question_recipient_cancel"), false);
  assert.equal(JSON.parse(fs.readFileSync(file, "utf8")).stage, "captured");
});

test("oversized target journals remain rejected without invoking Core cancellation", async t => {
  const f = fixture(t);
  assert.equal((await f.post()).status, 200);
  const directory = path.join(f.stateDir, "edupi-parent-question-confirmations-v1");
  const file = path.join(directory, fs.readdirSync(directory)[0]);
  fs.appendFileSync(file, " ".repeat(16 * 1024));
  assert.equal((await f.get()).status, 503);
  assert.equal((await f.post(f.input(0, "cancel"))).status, 503);
  assert.equal(f.calls.some(call => call.operation === "owner_parent_question_recipient_cancel"), false);
});
