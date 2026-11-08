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

function fixture(t, { allowed = true, isolated = true, accepted = true, grant = true, registerFails = false,
  foreignQuestionCount = 0, ownerHistoryV3 = true, confirmationText = "确认学生甲的家长沟通收件人是家长乙" } = {}) {
  const stateDir = fs.mkdtempSync(path.join(os.tmpdir(), "edupi-parent-question-route-"));
  const dataRoot = fs.mkdtempSync(path.join(os.tmpdir(), "edupi-parent-question-data-"));
  fs.chmodSync(stateDir, 0o700);
  t.after(() => { fs.rmSync(stateDir, { recursive: true, force: true }); fs.rmSync(dataRoot, { recursive: true, force: true }); });
  process.env.PI_DESKTOP_STATE_DIR = stateDir;
  t.after(() => { if (initialStateDir === undefined) delete process.env.PI_DESKTOP_STATE_DIR; else process.env.PI_DESKTOP_STATE_DIR = initialStateDir; });
  const calls = [], captures = [], historicalFacts = new Map();
  let confirmed = false, failOnce = registerFails, confirmedSourceId = null;
  let capturedMessageRef = null, confirmedMessageRef = null, confirmedPlanId = null;
  let currentAccepted = accepted, currentGrant = grant;
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
      if (operation === "owner_parent_question_recipient_read") return { ok: true, result: { version: 1,
        status: confirmed ? "confirmed" : "needs_confirmation", reason_code: null,
        candidate: { ...proof, confirmation_plan_id: confirmed ? confirmedPlanId : `plan-${digest(input.message_id).slice(0, 16)}`,
          confirmed_fact_id: confirmed ? "fact-confirmed" : null, message_ref: confirmed ? confirmedMessageRef : null },
        fact_write: false, model_execute: false, live_authority: false, external_send: false } };
      if (operation === "owner_parent_question_recipient_confirm") {
        assert.equal(input.message_ref, capturedMessageRef); assert.equal(input.expected_source_basis_hash, basis);
        confirmedSourceId = `parent_question_recipient:${crypto.createHash("sha256").update(input.command_id).digest("hex")}`;
        confirmedMessageRef = input.message_ref;
        confirmedPlanId = `plan-${digest(input.message_id).slice(0, 16)}`;
        confirmed = true;
        return { ok: true, result: { version: 1, status: "confirmed", fact_id: "fact-confirmed", message_ref: confirmedMessageRef,
          source_basis_hash: basis, fact_write: true, model_execute: false, live_authority: false, external_send: false } };
      }
      if (operation === "owner_parent_question_recipient_cancel") {
        if (historicalFacts.has(input.question_fact_id)) historicalFacts.delete(input.question_fact_id);
        else { assert.equal(input.message_ref, confirmedMessageRef); confirmed = false; }
        return { ok: true, result: { version: 1, status: "cancelled", fact_write: true,
          model_execute: false, live_authority: false, external_send: false } };
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
          ...(currentAccepted ? [{ fact_id: "question-1", revision: 1, status: "accepted", predicate: "communication.parent_question",
            subject_ref: "math", observation_ids: ["observation-1"], source_ids: ["question-source"] }] : []),
          ...Array.from({ length: foreignQuestionCount }, (_, index) => ({ fact_id: `foreign-question-${index}`, revision: 1,
            status: "accepted", predicate: "communication.parent_question", subject_ref: "math",
            observation_ids: [`foreign-observation-${index}`], source_ids: [`foreign-source-${index}`] })),
          ...(confirmed && confirmedSourceId ? [{ fact_id: "fact-confirmed", revision: 1, status: "accepted",
            predicate: "communication.question_recipient_confirmed", source_ids: [confirmedSourceId] }] : []),
        ] } } }) },
    "@/lib/edupi-proactivity-config": { readEduPiProactivityActivation: () => ({ enabled: true, grantId: "grant-1", ownerId: "owner-1",
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
    messageGeneration: generation, sourceBasisHash: basis, confirmationPlanId: planId(generation) });
  return { calls, captures, stateDir, input, setSourceCurrent(value) { currentAccepted = value; }, setGrantCurrent(value) { currentGrant = value; },
    seedHistory(count, stage = "cancelled") {
      const directory = path.join(stateDir, "edupi-parent-question-confirmations-v1");
      const original = JSON.parse(fs.readFileSync(path.join(directory, fs.readdirSync(directory)[0]), "utf8"));
      for (let index = 0; index < count; index++) {
        const factId = `history-question-${index}`;
        const journal = { ...original, questionFactId: factId,
          messageId: `parent-question-${digest(`${factId}\u00001\u00000`)}`,
          commandId: `parent-question-confirm-${digest(`${factId}\u0000${basis}\u00000`)}`,
          messageRef: `owner_message:${digest(factId)}`, stage,
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

test("interrupted capture retries the same durable owner message", async t => {
  const f = fixture(t, { registerFails: true });
  assert.equal((await f.post()).status, 503);
  assert.equal((await f.post()).status, 200);
  assert.equal(f.captures.length, 2);
  assert.equal(f.captures[0].messageId, f.captures[1].messageId);
  assert.equal(f.captures[0].occurredAt, f.captures[1].occurredAt);
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
