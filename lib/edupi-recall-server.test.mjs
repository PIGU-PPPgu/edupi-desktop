import assert from "node:assert/strict";
import * as crypto from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { isDeepStrictEqual } from "node:util";
import test from "node:test";
import { SessionManager } from "@earendil-works/pi-coding-agent";
import ts from "typescript";

// These are Desktop contract tests with synthetic Core responses, not evidence
// of real Core semantics. The import allow-list prevents loading a runtime,
// installed App, model provider, or real outbox/configuration.
const compile = name => ts.transpileModule(fs.readFileSync(new URL(name, import.meta.url), "utf8"), {
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, esModuleInterop: true },
}).outputText;
const compiled = Object.fromEntries(["edupi-recall-server", "edupi-recall-state", "edupi-recall-answer", "edupi-proactivity-control"]
  .map(name => [name, compile(`./${name}.ts`)]));
function evaluate(output, dependencies = {}, globals = {}) {
  const testModule = { exports: {} };
  const allowed = { "node:crypto": crypto, "node:fs": fs, "node:path": path,
    "node:url": { pathToFileURL }, "node:util": { isDeepStrictEqual }, ...dependencies };
  new Function("require", "module", "exports", "globalThis", output)(name => {
    assert.ok(Object.hasOwn(allowed, name), `unexpected dependency: ${name}`);
    return allowed[name];
  }, testModule, testModule.exports, globals);
  return testModule.exports;
}
const dto = evaluate(compiled["edupi-recall-answer"]);
const conversation = evaluate(compiled["edupi-proactivity-control"]);
const hash = text => `sha256:${crypto.createHash("sha256").update(text).digest("hex")}`;
const unavailable = () => assert.fail("real Core/runtime access is forbidden in this test");
const QUESTION = "合成班会由张老师主持，李老师协助，安排在第几场？";
const SOURCES = [
  { id: "synthetic-host", content: "合成班会由张老师主持。", source_fingerprint: hash("host-v1") },
  { id: "synthetic-order", content: "合成班会安排在第二场。", source_fingerprint: hash("order-v1") },
];
const ANSWER = {
  policy: "current-case-facets-v1", work_case_ref: "synthetic-case", anchor: "合成班会",
  text: SOURCES.map(source => source.content).join("\n"), question_case_verified: true, answer_verified: true,
  facets: [
    { facet_id: "facet_0", question: "谁主持？", kind: "person", source_id: SOURCES[0].id,
      source_fingerprint: SOURCES[0].source_fingerprint, answer: ["张老师"], evidence: [SOURCES[0].content] },
    { facet_id: "facet_1", question: "第几场？", kind: "ordinal", source_id: SOURCES[1].id,
      source_fingerprint: SOURCES[1].source_fingerprint, answer: ["第二场"], evidence: [SOURCES[1].content] },
  ],
};
const deferred = () => {
  let resolve;
  const promise = new Promise(done => { resolve = done; });
  return { promise, resolve };
};

function fixture(t, options = {}) {
  const root = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), "edupi-r04-recall-server-")));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const memoryDir = path.join(root, ".edupi", "memory");
  fs.mkdirSync(memoryDir, { recursive: true });
  fs.writeFileSync(path.join(memoryDir, "synthetic-selected.json"), JSON.stringify(SOURCES));
  const unselected = path.join(memoryDir, "synthetic-unselected.json");
  fs.writeFileSync(unselected, '{"synthetic":"unselected-v1"}');
  const state = evaluate(compiled["edupi-recall-state"]);
  const manager = SessionManager.create(root, path.join(root, "sessions"));
  const sessionId = manager.getSessionId(), clientRequestId = "synthetic-request-1";
  const text = options.text ?? QUESTION;
  const messageRef = `owner_message:${hash("synthetic-message").slice(7)}`;
  const binding = {
    domain: "teaching_preparation", ownerId: "synthetic-owner", grantId: "synthetic-grant", grantVersion: 1,
    captureMessageId: "synthetic-capture", carrierId: "synthetic-carrier", planId: "synthetic-plan",
    messageRef, captured: true,
    registration: { messageRef, producerEpoch: "a".repeat(64), sequence: 1, fencingGeneration: 1, instanceNonce: "synthetic-instance" },
  };
  const outbox = {
    sessionId, clientRequestId, messageId: "synthetic-message", occurredAt: "2026-11-17T00:00:00.000Z",
    command: { type: "prompt", message: text, clientRequestId }, bindings: [binding],
    stage: "pi_accepted", cancellationProofs: null,
  };
  const markerId = manager.appendCustomEntry("edupi_prompt_dispatch_v1", {
    sessionId, clientRequestId, commandHash: hash(JSON.stringify(outbox.command)),
  });
  const entryId = manager.appendMessage({ role: "user", content: [{ type: "text", text }], timestamp: Date.now() });
  const details = {
    version: 1, receiptId: crypto.randomUUID(), sessionId, userEntryId: entryId, clientRequestId,
    originalTextHash: hash(text), issuedAt: "2026-11-17T00:00:00.000Z",
    answer: structuredClone(ANSWER), sources: structuredClone(SOURCES), reasonCode: null,
  };
  const f = {
    root, state, unselected, manager, file: manager.getSessionFile(),
    sessionId, clientRequestId, entryId, markerId, details, binding, outbox,
    enabled: true, loads: 0, runtimeCalls: 0, rootScans: 0, currentRoot: root, productionHost: null, calls: [], transformLoad: null,
    coreReceipts: new Map(), formalQueries: 0,
    input: { sessionId, userEntryId: entryId, receiptId: details.receiptId },
    personInput: { action: "read", sessionId, entryId, personName: "张老师" },
    rootRef: hash("synthetic-root"), termRef: "synthetic-term",
    rewrite(change) {
      const entries = fs.readFileSync(f.file, "utf8").trim().split("\n").map(line => JSON.parse(line));
      change(entries);
      fs.writeFileSync(f.file, `${entries.map(entry => JSON.stringify(entry)).join("\n")}\n`);
      f.manager = SessionManager.open(f.file);
    },
  };
  const serviceModule = evaluate(compiled["edupi-recall-server"], {
    "./rpc-manager": { getRpcSession: () => null },
    "./session-reader": { resolveSessionPath: async id => id === sessionId ? f.file : null },
    "./session-manager-access": { openSessionManagerForRead: (id, file) => {
      assert.equal(id, sessionId); assert.equal(file, f.file);
      return f.manager;
    } },
    "./edupi-prompt-outbox": { readEduPiPromptOutbox: (id, requestId, roots) => {
      assert.equal(roots.dataRoot, root);
      return id === outbox.sessionId && requestId === outbox.clientRequestId ? outbox : null;
    } },
    "./edupi-core-snapshot": { resolveEduPiBridgeRoots: () => { f.rootScans++; return { dataRoot: { root } }; } },
    "./edupi-core-root": { resolveEduPiDataRoot: () => ({ root: f.currentRoot }) },
    "./edupi-runtime-supervisor": { ensureEduPiRuntime: async () => f.productionHost ?? unavailable() },
    "./edupi-proactivity-control": conversation,
    "./edupi-recall-config": {
      readEduPiRecallActivation: () => ({ mode: "canary", enabled: f.enabled, config: null }),
      eduPiRecallConversationId: unavailable,
    },
    "./edupi-recall-authorization": { readRecallIntent: unavailable },
    "./safe-mode": { isSafeModeEnabled: () => false },
    "./edupi-recall-answer": dto, "./edupi-recall-state": state,
  });
  f.readCaptured = serviceModule.readCapturedRecallMessage;
  f.identity = {
    root_ref: f.rootRef, message_ref: messageRef,
    conversation_id: conversation.proactivityConversationId(binding.domain),
    message_id: binding.captureMessageId, original_text_hash: details.originalTextHash,
  };
  f.originalRequest = {
    ...f.identity, expected_owner_id: binding.ownerId,
    registration: { carrier_id: binding.carrierId, plan_id: binding.planId,
      producer_epoch: binding.registration.producerEpoch, sequence: binding.registration.sequence },
    query: text, ...structuredClone(options.selection ?? {}),
  };
  f.answerEnvelope = (overrides = {}) => ({ ok: true, result: {
    version: 1, status: "current", ...f.identity, term_ref: f.termRef,
    entries: structuredClone(SOURCES), answer: structuredClone(f.details.answer),
    reason_code: null, model_execute: false, external_send: false, ...overrides,
  } });
  f.personEnvelope = (overrides = {}) => ({ ok: true, result: {
    version: 1, status: "current", message_ref: messageRef, source_fingerprint: hash("person-v1"),
    person_id: "synthetic-person", person_revision: 0,
    model_execute: false, live_authority: false, external_send: false, fact_write: false, ...overrides,
  } });
  f.confirmEnvelope = (overrides = {}) => f.personEnvelope({
    status: "confirmed", fact_id: "synthetic-fact", fact_revision: 1, fact_write: true, ...overrides,
  });
  f.handleCore = (operation, payload) => {
    if (operation === "owner_memory_recall") {
      if (!Object.hasOwn(payload, "answer_receipt_ref")) {
        assert.equal(f.formalQueries, 0, "a recheck must not issue another formal query or request model execution");
        assert.deepEqual(payload, f.originalRequest);
        assert.equal(typeof payload.query, "string");
        f.formalQueries++;
        const answer = { ...structuredClone(ANSWER),
          receipt_ref: `recall_answer:${crypto.randomBytes(32).toString("hex")}`,
          valid_until: new Date(Date.now() + 60_000).toISOString() };
        f.coreReceipts.set(answer.receipt_ref, { request: structuredClone(payload), answer: structuredClone(answer) });
        return f.answerEnvelope({ answer, model_execute: true });
      }
      const { answer_receipt_ref: ref, ...request } = payload;
      const ticket = f.coreReceipts.get(ref);
      if (!ticket || !isDeepStrictEqual(ticket.request, request) || Date.parse(ticket.answer.valid_until) <= Date.now()) {
        return f.answerEnvelope({ status: "held", reason_code: "answer_receipt_unavailable", answer: null, entries: [] });
      }
      return f.answerEnvelope({ answer: structuredClone(ticket.answer) });
    }
    if (operation === "owner_recall_person_read") return f.personEnvelope();
    if (operation === "owner_recall_person_confirm") return f.confirmEnvelope();
    assert.fail(`unexpected Core operation: ${operation}`);
  };
  // Only this initial synthetic Core call issues an answer. The map represents
  // private runtime receipts, never persisted SDK history or a real Core oracle.
  f.initialCall = { operation: "owner_memory_recall", payload: structuredClone(f.originalRequest) };
  f.initialResponse = f.handleCore(f.initialCall.operation, f.initialCall.payload);
  f.details.answer = structuredClone(f.initialResponse.result.answer);
  assert.match(f.details.answer.receipt_ref, /^recall_answer:[a-f0-9]{64}$/u);
  assert.equal(new Date(f.details.answer.valid_until).toISOString(), f.details.answer.valid_until);
  assert.ok(dto.parseCoreRecallAnswerDetails(details), "the synthetic saved receipt must satisfy the shared DTO");
  f.savedId = manager.appendCustomMessageEntry(dto.CORE_RECALL_ANSWER_MESSAGE, details.answer.text, true, structuredClone(details));
  f.manager = SessionManager.open(f.file);
  f.createService = (dependencies = {}) => serviceModule.createEduPiRecallService({
    enabled: () => f.enabled,
    load: async (id, userId) => {
      f.loads++;
      const captured = await f.readCaptured(id, userId);
      return f.transformLoad ? f.transformLoad(captured, f.loads) : captured;
    },
    runtime: async message => {
      f.runtimeCalls++;
      assert.equal(message.root, root);
      return { rootRef: f.rootRef, host: { callOwnerControl: async (operation, payload) => {
        f.calls.push({ operation, payload: structuredClone(payload) });
        return f.handleCore(operation, payload);
      } } };
    },
    ...dependencies,
  });
  f.service = f.createService();
  if (options.issue !== false) assert.equal(state.issueEduPiRecall(root, state.eduPiRecallRootEpoch(root), details, f.termRef, f.originalRequest), true);
  f.confirm = preview => f.service.person({ ...f.personInput, action: "confirm", previewId: preview.previewId });
  return f;
}

const recheckCall = f => ({ operation: "owner_memory_recall", payload: {
  ...structuredClone(f.initialCall.payload), answer_receipt_ref: f.details.answer.receipt_ref,
} });

function productionContextService(f) {
  f.productionHost = {
    recallAnswersActive: true,
    async call(operation) {
      assert.equal(operation, "health");
      return { ok: true, result: { data_root_fingerprint: f.rootRef } };
    },
    async callOwnerControl(operation, payload) {
      f.calls.push({ operation, payload: structuredClone(payload) });
      return f.handleCore(operation, payload);
    },
  };
  return f.createService({ load: undefined, runtime: undefined });
}

test("a production recheck verifies Core files once per request while re-reading SDK and captured authority", async t => {
  const f = fixture(t), service = productionContextService(f);
  assert.equal((await service.answerState(f.input)).status, "current");
  assert.equal(f.rootScans, 1);
  assert.equal(f.calls.length, 1);
  assert.deepEqual(f.calls[0], recheckCall(f));
  assert.equal((await service.answerState(f.input)).status, "current");
  assert.equal(f.rootScans, 2, "a later request must verify files and pin again");
  assert.equal(f.formalQueries, 1, "all rechecks remain model-free receipt reads");
});

test("request-local verified roots cannot hide a data-root change across the Core await", async t => {
  const f = fixture(t), service = productionContextService(f), original = f.handleCore;
  f.handleCore = (operation, payload) => {
    const response = original(operation, payload);
    f.currentRoot = path.join(f.root, "different-synthetic-root");
    return response;
  };
  assert.equal((await service.answerState(f.input)).status, "held");
  assert.equal(f.rootScans, 1);
  assert.equal(f.calls.length, 1);
});

test("request-local verified roots cannot cache an activation across the Core await", async t => {
  const f = fixture(t), service = productionContextService(f), original = f.handleCore;
  f.handleCore = (operation, payload) => {
    const response = original(operation, payload);
    f.enabled = false;
    return response;
  };
  assert.equal((await service.answerState(f.input)).status, "held");
  assert.equal(f.rootScans, 1);
});

test("unknown receipts and a cold registry remain historical even with the exact saved SDK answer", async t => {
  const f = fixture(t, { issue: false });
  assert.equal((await f.service.answerState(f.input)).status, "historical");
  assert.equal((await f.service.answerState({ ...f.input, receiptId: crypto.randomUUID() })).status, "historical");
  assert.equal(f.loads, 0); assert.equal(f.runtimeCalls, 0); assert.equal(f.calls.length, 0);
  assert.equal(f.manager.getEntry(f.savedId).content, ANSWER.text);
});

test("a current answer rechecks the issued full query and opaque receipt without another model request", async t => {
  const f = fixture(t);
  const captured = await f.readCaptured(f.sessionId, f.entryId);
  assert.equal(captured.text, QUESTION);
  assert.deepEqual(captured.binding, f.binding);
  assert.equal(captured.manager.getEntry(f.markerId).type, "custom");
  assert.equal(captured.manager.getEntry(f.savedId).type, "custom_message");
  const before = fs.readFileSync(f.file, "utf8");
  const issuedBefore = structuredClone(f.state.readIssuedEduPiRecall(f.input.receiptId));
  assert.equal(f.initialResponse.result.model_execute, true, "only the synthetic initial query represents answer issuance");
  assert.deepEqual(f.initialCall.payload, f.originalRequest);
  assert.equal(f.initialCall.payload.query, QUESTION);
  assert.equal(Object.hasOwn(f.initialCall.payload, "answer_receipt_ref"), false);
  assert.notEqual(f.input.receiptId, f.details.answer.receipt_ref, "the Desktop receipt id is not the opaque Core ticket");
  assert.deepEqual(issuedBefore.request, f.initialCall.payload);
  assert.deepEqual(issuedBefore.details.answer, f.initialResponse.result.answer);
  assert.deepEqual(issuedBefore.details.sources, f.initialResponse.result.entries);
  assert.deepEqual(await f.service.answerState(f.input), { version: 1, status: "current", reasonCode: null });
  assert.deepEqual(f.calls, [recheckCall(f)], "identity, registration and the entire original query are forwarded with only the Core ticket added");
  assert.equal(f.formalQueries, 1);
  assert.equal(f.answerEnvelope().result.model_execute, false);
  assert.deepEqual(f.state.readIssuedEduPiRecall(f.input.receiptId), issuedBefore, "revalidation never renews or rewrites the old assertion");
  assert.equal(fs.readFileSync(f.file, "utf8"), before);
});

test("rechecks preserve raw query whitespace and every original selection field without adding defaults", async t => {
  const selections = {
    "no selection": {},
    "bounded sources": { category: "class", memory_ids: [SOURCES[1].id, SOURCES[0].id], limit: 7 },
    "person selection": { category: "student", student: "合成学生", student_id: "synthetic-student",
      memory_ids: [SOURCES[0].id, SOURCES[1].id], limit: 2 },
  };
  for (const [name, selection] of Object.entries(selections)) await t.test(name, async t => {
    const text = ` \n${QUESTION}\n `;
    const f = fixture(t, { text, selection });
    assert.equal((await f.service.answerState({
      ...f.input, query: "客户端伪造查询", memory_ids: ["forged-source"], limit: 50,
      expected_owner_id: "forged-owner", registration: { sequence: 999 }, answer_receipt_ref: "forged-ticket",
    })).status, "current");
    assert.deepEqual(f.calls, [recheckCall(f)]);
    const request = f.calls[0].payload;
    assert.equal(request.query, text, "the complete original raw text is replayed");
    assert.equal(request.original_text_hash, hash(text));
    assert.equal(f.details.originalTextHash, hash(text));
    assert.notEqual(request.original_text_hash, hash(text.trim()));
    for (const key of ["category", "student", "student_id", "memory_ids", "limit"]) {
      assert.equal(Object.hasOwn(request, key), Object.hasOwn(selection, key), `${key} presence must not change`);
      if (Object.hasOwn(selection, key)) assert.deepEqual(request[key], selection[key], `${key} must be forwarded unchanged`);
    }
    assert.equal(f.formalQueries, 1);
  });
});

test("a saved answer with a legacy trimmed hash cannot recheck a raw whitespace prompt", async t => {
  const f = fixture(t, { text: ` \n${QUESTION}\t `, issue: false });
  f.details.originalTextHash = hash(f.outbox.command.message.trim());
  f.rewrite(entries => {
    entries.find(entry => entry.id === f.savedId).details = structuredClone(f.details);
  });
  const request = { ...f.originalRequest, original_text_hash: f.details.originalTextHash };
  assert.equal(f.state.issueEduPiRecall(f.root, f.state.eduPiRecallRootEpoch(f.root), f.details, f.termRef, request), true);
  assert.equal((await f.service.answerState(f.input)).status, "held");
  assert.equal(f.calls.length, 0, "a mismatched raw-text hash cannot reach Core");
});

test("issuance privately snapshots the original request instead of borrowing mutable caller selection", async t => {
  const f = fixture(t, { selection: { category: "class", memory_ids: SOURCES.map(source => source.id), limit: 2 } });
  f.originalRequest.query = "调用者后来改动的问题";
  f.originalRequest.registration.sequence++;
  f.originalRequest.memory_ids.reverse();
  f.originalRequest.limit = 50;
  assert.deepEqual(f.state.readIssuedEduPiRecall(f.input.receiptId).request, f.initialCall.payload);
  assert.equal((await f.service.answerState(f.input)).status, "current");
  assert.deepEqual(f.calls, [recheckCall(f)]);
  assert.equal(f.formalQueries, 1);
});

test("disabled recall, mismatched session/user, held issuance, root epochs and withdrawn sessions avoid Core", async t => {
  const cases = {
    disabled: f => { f.enabled = false; },
    session: f => { f.input.sessionId = "synthetic-other-session"; },
    user: f => { f.input.userEntryId = "synthetic-other-user"; },
    epoch: f => f.state.invalidateEduPiRecallRoot(f.root),
    withdrawn: f => f.state.invalidateEduPiRecallSession(f.sessionId, "source_withdrawn"),
    "new receipt": f => {
      assert.equal(f.state.issueEduPiRecall(f.root, 0, { ...f.details, receiptId: crypto.randomUUID(), userEntryId: "new-user" },
        f.termRef, f.originalRequest), true);
    },
  };
  for (const [name, change] of Object.entries(cases)) await t.test(name, async t => {
    const f = fixture(t); change(f);
    assert.equal((await f.service.answerState(f.input)).status, name === "disabled" ? "historical" : "held");
    assert.equal(f.runtimeCalls, 0); assert.equal(f.calls.length, 0);
  });
  await t.test("held receipt cannot be upgraded by a Core answer proof", async t => {
    const f = fixture(t, { issue: false });
    assert.equal(f.state.issueEduPiRecall(f.root, 0, { ...f.details, answer: null, sources: [], reasonCode: "answer_unverified" }), true);
    assert.deepEqual(await f.service.answerState(f.input), { version: 1, status: "held", reasonCode: "answer_unverified" });
    assert.equal(f.calls.length, 0);
  });
});

test("durable dispatch and user identity must match the captured outbox exactly", async t => {
  const cases = {
    "wrong SDK session": f => f.rewrite(rows => { rows[0].id = crypto.randomUUID(); }),
    "wrong SDK root": f => f.rewrite(rows => { rows[0].cwd = path.join(f.root, "other"); }),
    "wrong marker command": f => f.rewrite(rows => { rows.find(row => row.id === f.markerId).data.commandHash = hash("other"); }),
    "wrong marker session": f => f.rewrite(rows => { rows.find(row => row.id === f.markerId).data.sessionId = "other"; }),
    "user content tampering": f => f.rewrite(rows => { rows.find(row => row.id === f.entryId).message.content = "篡改的合成问题"; }),
    "user context edit": f => f.manager.appendContextEdit(f.entryId, { content: "改后的合成问题" }),
    "uncaptured binding": f => { f.binding.captured = false; },
    "missing registration": f => { f.binding.registration = null; },
    "missing message ref": f => { f.binding.messageRef = null; },
    "withdrawn outbox": f => { f.outbox.stage = "pi_accepted_withdrawn"; },
    "cancelled outbox": f => { f.outbox.cancellationProofs = [{ domain: f.binding.domain, messageRef: f.binding.messageRef, status: "withdrawn" }]; },
    "marker cannot bind the next user": f => {
      f.entryId = f.manager.appendMessage({ role: "user", content: QUESTION, timestamp: Date.now() });
    },
  };
  for (const [name, change] of Object.entries(cases)) await t.test(name, async t => {
    const f = fixture(t); change(f);
    await assert.rejects(f.readCaptured(f.sessionId, f.entryId), /message_unavailable/);
    assert.equal(f.calls.length, 0);
  });
});

test("answer history tampering and a newer user turn hold the old answer before Core", async t => {
  const cases = {
    "custom content changed": f => f.rewrite(rows => { rows.find(row => row.id === f.savedId).content = "篡改的合成答案"; }),
    "custom details changed": f => f.rewrite(rows => { rows.find(row => row.id === f.savedId).details.sources[0].content = "篡改引用"; }),
    "wrong custom type": f => f.rewrite(rows => { rows.find(row => row.id === f.savedId).customType = "synthetic-untrusted"; }),
    "missing custom receipt": f => f.rewrite(rows => { rows.splice(rows.findIndex(row => row.id === f.savedId), 1); }),
    "later user": f => f.manager.appendMessage({ role: "user", content: "后续问题", timestamp: Date.now() }),
  };
  for (const [name, change] of Object.entries(cases)) await t.test(name, async t => {
    const f = fixture(t); change(f);
    assert.equal((await f.service.answerState(f.input)).status, "held");
    assert.equal(f.calls.length, 0);
  });
});

test("Core identity, every source and answer field, receipt, deadline and no-model guarantees must match", async t => {
  const cases = {
    "wrong result version": value => { value.result.version = 2; },
    "current with a non-null reason": value => { value.result.reason_code = "query_ineligible"; },
    "foreign root": value => { value.result.root_ref = hash("other-root"); },
    "foreign message ref": value => { value.result.message_ref = `owner_message:${"b".repeat(64)}`; },
    "foreign conversation": value => { value.result.conversation_id = "other-conversation"; },
    "foreign captured message": value => { value.result.message_id = "other-message"; },
    "foreign text hash": value => { value.result.original_text_hash = hash("other-question"); },
    "changed term": value => { value.result.term_ref = "next-term"; },
    "changed source fingerprint": value => { value.result.entries[0].source_fingerprint = hash("host-v2"); },
    "changed source content": value => { value.result.entries[0].content = "合成班会改由李老师主持。"; },
    "withdrawn source": value => { value.result.entries.shift(); },
    "extra unrelated source": value => { value.result.entries.push({ id: "extra-source", content: "额外合成来源", source_fingerprint: hash("extra") }); },
    "duplicate source": value => { value.result.entries.push(structuredClone(value.result.entries[0])); },
    "duplicate unrelated ids": value => { value.result.entries.push({ id: "other" }, { id: "other" }); },
    "too many entries": value => { value.result.entries.push(...Array.from({ length: 49 }, (_, i) => ({ id: `extra-${i}` }))); },
    "held Core result": value => { value.result.status = "held"; },
    "missing entries": value => { delete value.result.entries; },
    "model execution": value => { value.result.model_execute = true; },
    "missing no-model guarantee": value => { delete value.result.model_execute; },
    "null no-model guarantee": value => { value.result.model_execute = null; },
    "zero is not a no-model guarantee": value => { value.result.model_execute = 0; },
    "external send": value => { value.result.external_send = true; },
    "missing no-send guarantee": value => { delete value.result.external_send; },
    "missing answer": value => { delete value.result.answer; },
    "null answer": value => { value.result.answer = null; },
    "changed answer policy": value => { value.result.answer.policy = "source-support-v1"; },
    "changed work case": value => { value.result.answer.work_case_ref = "other-case"; },
    "changed anchor": value => { value.result.answer.anchor = "另一个合成班会"; },
    "new answer in recheck": value => { value.result.answer.text = "重新生成的合成答案"; },
    "unverified question": value => { value.result.answer.question_case_verified = false; },
    "unverified answer": value => { value.result.answer.answer_verified = false; },
    "different opaque receipt": value => { value.result.answer.receipt_ref = `recall_answer:${"b".repeat(64)}`; },
    "missing opaque receipt": value => { delete value.result.answer.receipt_ref; },
    "malformed opaque receipt": value => { value.result.answer.receipt_ref = `recall_answer:${"G".repeat(64)}`; },
    "changed canonical deadline": value => { value.result.answer.valid_until = new Date(Date.parse(value.result.answer.valid_until) + 1000).toISOString(); },
    "missing deadline": value => { delete value.result.answer.valid_until; },
    "invalid deadline": value => { value.result.answer.valid_until = "not-a-date"; },
    "noncanonical deadline": value => { value.result.answer.valid_until = value.result.answer.valid_until.replace("Z", "+00:00"); },
    "expired deadline": value => { value.result.answer.valid_until = new Date(Date.now() - 1).toISOString(); },
    "reordered facets": value => { value.result.answer.facets.reverse(); },
    "missing facet": value => { value.result.answer.facets.pop(); },
    "extra answer field": value => { value.result.answer.current = true; },
    "old proof": value => { value.result = { status: "verified", case_status: "bound", proof: { source_support: true } }; },
    "failed envelope": value => { value.ok = false; },
  };
  for (const key of ["root_ref", "message_ref", "conversation_id", "message_id", "original_text_hash", "term_ref"]) {
    cases[`missing ${key}`] = value => { delete value.result[key]; };
  }
  for (let index = 0; index < SOURCES.length; index++) {
    for (const [key, replacement] of Object.entries({
      id: `other-source-${index}`, content: `第${index + 1}个来源已修订`, source_fingerprint: hash(`other-source-${index}`),
    })) {
      cases[`source ${index} changed ${key}`] = value => { value.result.entries[index][key] = replacement; };
      cases[`source ${index} missing ${key}`] = value => { delete value.result.entries[index][key]; };
    }
  }
  for (let index = 0; index < ANSWER.facets.length; index++) {
    for (const [key, replacement] of Object.entries({
      facet_id: "facet_2", question: "修改后的合成问题", kind: "value",
      source_id: SOURCES[1 - index].id, source_fingerprint: hash(`other-facet-${index}`),
      answer: ["另一个答案"], evidence: [SOURCES[index].content.slice(0, -1)],
    })) {
      cases[`facet ${index} changed ${key}`] = value => { value.result.answer.facets[index][key] = structuredClone(replacement); };
      cases[`facet ${index} missing ${key}`] = value => { delete value.result.answer.facets[index][key]; };
    }
  }
  for (const [name, change] of Object.entries(cases)) await t.test(name, async t => {
    const f = fixture(t), bad = f.answerEnvelope(); change(bad);
    f.handleCore = async () => bad;
    assert.equal((await f.service.answerState(f.input)).status, "held");
    f.handleCore = async () => f.answerEnvelope();
    assert.equal((await f.service.answerState(f.input)).status, "held", "a later proof cannot resurrect a withdrawn assertion");
    assert.deepEqual(f.calls, [recheckCall(f)], "rejecting a full proof must not fall back to another lookup");
    assert.equal(f.formalQueries, 1);
  });
});

test("source, capture, epoch and turn changes during an answer recheck reject an obsolete response", async t => {
  const cases = {
    "capture revision": f => { f.binding.registration.sequence++; },
    "root epoch": f => f.state.invalidateEduPiRecallRoot(f.root),
    "turn invalidated": f => f.state.invalidateEduPiRecallSession(f.sessionId),
    "source withdrawn": f => { f.outbox.stage = "pi_accepted_withdrawn"; },
    "unselected C1 source changed": f => {
      fs.writeFileSync(f.unselected, '{"synthetic":"unselected-source-revised-v2"}');
      f.lateResponse = f.answerEnvelope({ status: "held", reason_code: "source_changed", answer: null, entries: [] });
    },
  };
  for (const [name, change] of Object.entries(cases)) await t.test(name, async t => {
    const f = fixture(t), started = deferred(), response = deferred();
    f.handleCore = async () => { started.resolve(); return response.promise; };
    const pending = f.service.answerState(f.input);
    await started.promise; change(f); response.resolve(f.lateResponse ?? f.answerEnvelope());
    assert.equal((await pending).status, "held");
    assert.deepEqual(f.calls, [recheckCall(f)]);
    assert.equal(f.formalQueries, 1);
  });
});

test("an unselected C1 full-check failure cannot fall back to a still-current no-query source lookup", async t => {
  const f = fixture(t);
  assert.equal((await f.service.answerState(f.input)).status, "current");
  const legacyLookup = { ...f.identity, expected_owner_id: f.binding.ownerId,
    registration: structuredClone(f.originalRequest.registration), memory_ids: SOURCES.map(source => source.id), limit: 50 };
  fs.writeFileSync(f.unselected, '{"synthetic":"third-source-changed-outside-supervisor"}');
  f.handleCore = (operation, payload) => {
    assert.equal(operation, "owner_memory_recall");
    if (!Object.hasOwn(payload, "query")) {
      const value = f.answerEnvelope();
      delete value.result.answer;
      return value;
    }
    return f.answerEnvelope({ status: "held", reason_code: "source_changed", answer: null });
  };
  const legacy = f.handleCore("owner_memory_recall", legacyLookup);
  assert.equal(legacy.result.status, "current");
  assert.deepEqual(legacy.result.entries, f.details.sources, "the old two selected memories alone remain insufficient");
  assert.equal(legacy.result.model_execute, false);
  assert.equal((await f.service.answerState(f.input)).status, "held");
  assert.deepEqual(f.calls, [recheckCall(f), recheckCall(f)], "Core must receive the full receipt check with no legacy fallback");
  assert.equal(f.formalQueries, 1);
  assert.equal(f.state.readIssuedEduPiRecall(f.input.receiptId).invalidated, "source_changed");
});

test("a no-op chmod stays current when Core confirms the complete original answer receipt", async t => {
  const f = fixture(t), before = fs.statSync(f.unselected, { bigint: true }), content = fs.readFileSync(f.unselected, "utf8");
  assert.equal((await f.service.answerState(f.input)).status, "current");
  fs.chmodSync(f.unselected, Number(before.mode & 0o777n));
  const after = fs.statSync(f.unselected, { bigint: true });
  assert.equal(after.mode, before.mode);
  assert.equal(after.mtimeNs, before.mtimeNs);
  assert.notEqual(after.ctimeNs, before.ctimeNs, "this counterexample changes metadata without changing any source bytes");
  assert.equal(fs.readFileSync(f.unselected, "utf8"), content);
  assert.deepEqual(await f.service.answerState(f.input), { version: 1, status: "current", reasonCode: null });
  assert.deepEqual(f.calls, [recheckCall(f), recheckCall(f)]);
  assert.equal(f.state.readIssuedEduPiRecall(f.input.receiptId).invalidated, null);
  assert.equal(f.formalQueries, 1);
});

test("missing or legacy private requests cannot be reconstructed from the saved answer or current memories", async t => {
  const cases = {
    omitted: () => undefined,
    null: () => null,
    "legacy metadata fingerprint": () => hash("obsolete-metadata-fence"),
    "missing query": f => { const request = structuredClone(f.originalRequest); delete request.query; return request; },
    "query is not text": f => ({ ...f.originalRequest, query: null }),
    "recheck request stored as original": f => ({ ...f.originalRequest, answer_receipt_ref: f.details.answer.receipt_ref }),
  };
  for (const [name, request] of Object.entries(cases)) await t.test(name, async t => {
    const f = fixture(t, { issue: false });
    assert.equal(f.state.issueEduPiRecall(f.root, 0, f.details, f.termRef, request(f)), true);
    assert.deepEqual(await f.service.answerState(f.input), { version: 1, status: "held", reasonCode: "source_changed" });
    assert.equal(f.loads, 0); assert.equal(f.runtimeCalls, 0); assert.equal(f.calls.length, 0);
    assert.equal(f.manager.getEntry(f.savedId).details.answer.receipt_ref, f.details.answer.receipt_ref);
  });
  await t.test("private request lost after a current check", async t => {
    const f = fixture(t);
    assert.equal((await f.service.answerState(f.input)).status, "current");
    f.state.readIssuedEduPiRecall(f.input.receiptId).request = null;
    assert.equal((await f.service.answerState(f.input)).status, "held");
    assert.deepEqual(f.calls, [recheckCall(f)], "saved SDK details must not recreate the missing private original");
  });
});

test("the private original identity, owner, raw query and registration must still bind the captured message", async t => {
  const cases = {
    root_ref: request => { request.root_ref = hash("other-root"); },
    message_ref: request => { request.message_ref = `owner_message:${"c".repeat(64)}`; },
    conversation_id: request => { request.conversation_id = "other-conversation"; },
    message_id: request => { request.message_id = "other-message"; },
    original_text_hash: request => { request.original_text_hash = hash("other-query"); },
    expected_owner_id: request => { request.expected_owner_id = "other-owner"; },
    query: request => { request.query = "另一个原问题"; },
    "registration.carrier_id": request => { request.registration.carrier_id = "other-carrier"; },
    "registration.plan_id": request => { request.registration.plan_id = "other-plan"; },
    "registration.producer_epoch": request => { request.registration.producer_epoch = "c".repeat(64); },
    "registration.sequence": request => { request.registration.sequence++; },
    "extra registration field": request => { request.registration.instance_nonce = "unbound-instance"; },
    "missing registration": request => { delete request.registration; },
  };
  for (const [name, change] of Object.entries(cases)) await t.test(name, async t => {
    const f = fixture(t, { issue: false }), request = structuredClone(f.originalRequest); change(request);
    assert.equal(f.state.issueEduPiRecall(f.root, 0, f.details, f.termRef, request), true);
    assert.equal((await f.service.answerState(f.input)).status, "held");
    assert.equal(f.calls.length, 0, "a mismatched private original must not be sent as a replacement Core query");
    assert.equal(f.formalQueries, 1);
  });
});

test("Goal and person time-only expiry revoke current through the full receipt check without a model request", async t => {
  for (const source of ["Goal", "person"]) await t.test(source, async t => {
    t.mock.timers.enable({ apis: ["Date"], now: Date.now() });
    const f = fixture(t), expiresAt = Date.now() + 1000, handleCore = f.handleCore;
    const sourceBefore = fs.readFileSync(f.unselected, "utf8"), epoch = f.state.eduPiRecallRootEpoch(f.root);
    f.handleCore = (operation, payload) => {
      if (!Object.hasOwn(payload, "query")) {
        const legacy = f.answerEnvelope(); delete legacy.result.answer; return legacy;
      }
      if (Date.now() >= expiresAt) return f.answerEnvelope({
        status: "held", reason_code: `${source.toLowerCase()}_expired`, answer: null,
      });
      return handleCore(operation, payload);
    };
    assert.equal((await f.service.answerState(f.input)).status, "current");
    t.mock.timers.tick(1000);
    assert.ok(Date.parse(f.details.answer.valid_until) > Date.now(), "the answer deadline alone has not expired");
    const legacy = f.handleCore("owner_memory_recall", {
      ...f.identity, memory_ids: SOURCES.map(item => item.id), limit: 50,
    });
    assert.equal(legacy.result.status, "current");
    assert.deepEqual(legacy.result.entries, f.details.sources);
    assert.equal((await f.service.answerState(f.input)).status, "held");
    assert.deepEqual(f.calls, [recheckCall(f), recheckCall(f)]);
    assert.equal(f.state.eduPiRecallRootEpoch(f.root), epoch);
    assert.equal(fs.readFileSync(f.unselected, "utf8"), sourceBefore);
    assert.equal(f.formalQueries, 1);
    const count = f.calls.length;
    assert.equal((await f.service.answerState(f.input)).status, "held");
    assert.equal(f.calls.length, count, "a later poll cannot renew an expired Core assertion");
  });
});

test("valid_until at its exact deadline clears current locally without another Core or model request", async t => {
  t.mock.timers.enable({ apis: ["Date"], now: Date.now() });
  const f = fixture(t), before = fs.readFileSync(f.file, "utf8");
  assert.equal((await f.service.answerState(f.input)).status, "current");
  const loads = f.loads, runtimeCalls = f.runtimeCalls;
  t.mock.timers.tick(Date.parse(f.details.answer.valid_until) - Date.now());
  assert.deepEqual(await f.service.answerState(f.input), { version: 1, status: "held", reasonCode: "answer_expired" });
  assert.equal(f.state.readIssuedEduPiRecall(f.input.receiptId).invalidated, "answer_expired");
  assert.equal(f.loads, loads); assert.equal(f.runtimeCalls, runtimeCalls);
  assert.deepEqual(f.calls, [recheckCall(f)]);
  assert.equal(f.formalQueries, 1);
  assert.equal(fs.readFileSync(f.file, "utf8"), before);
});

test("a receipt expiring during its Core recheck cannot accept a late full-current response", async t => {
  t.mock.timers.enable({ apis: ["Date"], now: Date.now() });
  const f = fixture(t), started = deferred(), response = deferred();
  f.handleCore = async () => { started.resolve(); return response.promise; };
  const pending = f.service.answerState(f.input);
  await started.promise;
  t.mock.timers.tick(Date.parse(f.details.answer.valid_until) - Date.now());
  response.resolve(f.answerEnvelope());
  assert.equal((await pending).status, "held");
  assert.deepEqual(f.calls, [recheckCall(f)]);
  assert.equal(f.formalQueries, 1);
});

test("a Core restart losing its private ticket holds the saved Desktop answer without issuing another query", async t => {
  const f = fixture(t), before = fs.readFileSync(f.file, "utf8");
  assert.equal((await f.service.answerState(f.input)).status, "current");
  f.coreReceipts.clear(); // Simulate only the Core runtime's volatile receipt registry restarting.
  assert.equal((await f.service.answerState(f.input)).status, "held");
  assert.deepEqual(f.calls, [recheckCall(f), recheckCall(f)]);
  assert.equal(f.formalQueries, 1);
  assert.equal(fs.readFileSync(f.file, "utf8"), before);
  assert.equal(f.manager.getEntry(f.savedId).details.answer.receipt_ref, f.details.answer.receipt_ref);
  assert.equal((await f.service.answerState(f.input)).status, "held");
  assert.equal(f.calls.length, 2);
});

test("a later user arriving during the final answer load also holds the old answer", async t => {
  const f = fixture(t);
  f.transformLoad = (captured, count) => {
    if (count === 2) {
      f.manager.appendMessage({ role: "user", content: "异步到达的下一轮", timestamp: Date.now() });
    }
    return captured;
  };
  assert.equal((await f.service.answerState(f.input)).status, "held");
  assert.deepEqual(f.calls, [recheckCall(f)]);
});

test("an SDK context edit arriving during the final load withdraws the custom answer authorization", async t => {
  const f = fixture(t);
  f.transformLoad = (captured, count) => {
    if (count === 2) f.manager.appendContextEdit(f.savedId, null);
    return captured;
  };
  assert.equal((await f.service.answerState(f.input)).status, "held");
  assert.deepEqual(f.calls, [recheckCall(f)]);
});

test("an SDK edit withdrawing the saved custom answer cannot keep its current display authorization", async t => {
  const f = fixture(t);
  f.manager.appendContextEdit(f.savedId, null);
  assert.equal((await f.service.answerState(f.input)).status, "held");
  assert.equal(f.calls.length, 0);
});

test("person read accepts an older still captured source and only names actually present in its user message", async t => {
  const f = fixture(t);
  f.manager.appendMessage({ role: "user", content: "后续不含人名的问题", timestamp: Date.now() });
  const preview = await f.service.person(f.personInput);
  assert.equal(preview.status, "current"); assert.equal(preview.personRevision, 0);
  assert.equal(preview.factWrite, false); assert.ok(preview.previewId);
  assert.deepEqual(f.calls, [{ operation: "owner_recall_person_read", payload: {
    root_ref: f.rootRef, expected_owner_id: f.binding.ownerId, message_ref: f.binding.messageRef, person_name: "张老师",
  } }]);
  assert.equal((await f.service.person({ ...f.personInput, personName: "王老师" })).reasonCode, "person_not_in_message");
  assert.equal(f.calls.length, 1, "a name found only in another source cannot reach Core");
  assert.equal((await f.confirm(preview)).status, "confirmed", "being older than the newest turn alone does not invalidate a captured source");
});

test("person confirmation accepts revision zero and waits for confirm plus a matching reread", async t => {
  const f = fixture(t), rereadStarted = deferred(), rereadReply = deferred();
  const preview = await f.service.person(f.personInput);
  let settled = false;
  f.handleCore = async operation => {
    if (operation === "owner_recall_person_confirm") return f.confirmEnvelope({ person_revision: 1 });
    rereadStarted.resolve();
    return rereadReply.promise;
  };
  const pending = f.confirm(preview).then(value => { settled = true; return value; });
  await rereadStarted.promise;
  assert.equal(settled, false);
  assert.equal(f.calls[1].payload.expected_person_revision, 0);
  assert.equal(f.calls[1].payload.expected_source_fingerprint, preview.sourceFingerprint);
  assert.match(f.calls[1].payload.command_id, /^recall-person-[a-f0-9]{64}$/u);
  rereadReply.resolve(f.personEnvelope({ person_revision: 1 }));
  const confirmed = await pending;
  assert.equal(confirmed.status, "confirmed"); assert.equal(confirmed.personRevision, 1); assert.equal(confirmed.factWrite, true);
  assert.deepEqual(f.calls.map(call => call.operation), ["owner_recall_person_read", "owner_recall_person_confirm", "owner_recall_person_read"]);
  assert.equal((await f.confirm(preview)).status, "held", "a consumed preview cannot be reused");
  assert.equal(f.calls.length, 3);
});

test("person confirm accepts one private Supervisor operation tag while preserving generic source_changed invalidation", async t => {
  const f = fixture(t), preview = await f.service.person(f.personInput), epoch = f.state.eduPiRecallRootEpoch(f.root);
  f.handleCore = operation => {
    if (operation === "owner_recall_person_confirm") {
      f.state.invalidateEduPiRecallRoot(f.root, "source_changed", operation);
      return f.confirmEnvelope({ person_revision: 1 });
    }
    assert.equal(operation, "owner_recall_person_read");
    return f.personEnvelope({ person_revision: 1 });
  };
  const result = await f.confirm(preview);
  assert.equal(result.status, "confirmed"); assert.equal(result.factWrite, true); assert.equal(result.personRevision, 1);
  assert.deepEqual(f.state.eduPiRecallRootLastChange(f.root), {
    epoch: epoch + 1, reason: "source_changed", operation: "owner_recall_person_confirm",
  });
  assert.equal(f.state.readIssuedEduPiRecall(f.input.receiptId).invalidated, "source_changed");
  assert.deepEqual(await f.service.answerState(f.input), { version: 1, status: "held", reasonCode: "source_changed" });
  assert.deepEqual(f.calls.map(call => call.operation), [
    "owner_recall_person_read", "owner_recall_person_confirm", "owner_recall_person_read",
  ]);
  assert.equal((await f.confirm(preview)).status, "held", "the operation exception does not allow preview reuse");
  assert.equal(f.calls.length, 3);
});

test("invalid preview, changed name/source, expiry and root epoch cannot issue a person confirmation", async t => {
  const cases = {
    "unknown preview": (f, preview) => { preview.previewId = crypto.randomUUID(); },
    "renamed person": f => { f.personInput.personName = "李老师"; },
    "changed capture": f => { f.binding.registration.sequence++; },
    "old source": f => { f.outbox.stage = "pi_accepted_withdrawn"; },
    "root epoch": f => f.state.invalidateEduPiRecallRoot(f.root),
    expired: (_f, _preview, t) => { t.mock.timers.enable({ apis: ["Date"], now: Date.now() }); t.mock.timers.tick(5 * 60_000 + 1); },
  };
  for (const [name, change] of Object.entries(cases)) await t.test(name, async t => {
    const f = fixture(t), preview = await f.service.person(f.personInput);
    change(f, preview, t);
    const result = await f.confirm(preview);
    assert.equal(result.status, "held"); assert.equal(result.factWrite, false);
    assert.equal(f.calls.length, 1);
  });
});

test("person read fails closed for untrusted Core identities, writes, authority and old proof", async t => {
  const cases = {
    "wrong message": value => { value.result.message_ref = "other"; },
    "model executed": value => { value.result.model_execute = true; },
    "live authority": value => { value.result.live_authority = true; },
    "external send": value => { value.result.external_send = true; },
    "read wrote fact": value => { value.result.fact_write = true; },
    "negative revision": value => { value.result.person_revision = -1; },
    "unsafe revision": value => { value.result.person_revision = Number.MAX_SAFE_INTEGER + 1; },
    "missing source fingerprint": value => { delete value.result.source_fingerprint; },
    "old proof": value => { value.result = { status: "verified", proof: "synthetic-old-proof" }; },
  };
  for (const [name, change] of Object.entries(cases)) await t.test(name, async t => {
    const f = fixture(t), bad = f.personEnvelope(); change(bad);
    f.handleCore = async () => bad;
    const result = await f.service.person(f.personInput);
    assert.equal(result.status, "held"); assert.equal(result.previewId, null); assert.equal(result.factWrite, false);
    assert.equal(f.calls.length, 1);
  });
});

test("a source or epoch change during person preview creation holds its late response", async t => {
  for (const change of ["capture", "epoch"]) await t.test(change, async t => {
    const f = fixture(t), started = deferred(), response = deferred();
    f.handleCore = async () => { started.resolve(); return response.promise; };
    const pending = f.service.person(f.personInput);
    await started.promise;
    if (change === "capture") f.binding.registration.sequence++;
    else f.state.invalidateEduPiRecallRoot(f.root);
    response.resolve(f.personEnvelope());
    const result = await pending;
    assert.equal(result.status, "held"); assert.equal(result.previewId, null); assert.equal(result.factWrite, false);
  });
});

test("a double click sends one confirm, and a late changed source preserves the reported fact write", async t => {
  const f = fixture(t), preview = await f.service.person(f.personInput), started = deferred(), response = deferred();
  f.handleCore = async operation => {
    if (operation === "owner_recall_person_confirm") { started.resolve(); return response.promise; }
    return f.personEnvelope();
  };
  const first = f.confirm(preview);
  await started.promise;
  const second = await f.confirm(preview);
  assert.equal(second.status, "held"); assert.equal(second.factWrite, false);
  assert.equal(f.calls.filter(call => call.operation === "owner_recall_person_confirm").length, 1);
  f.binding.registration.sequence++;
  response.resolve(f.confirmEnvelope());
  const late = await first;
  assert.equal(late.status, "held"); assert.equal(late.factWrite, true);
});

test("a root epoch revoked while confirm is in flight cannot return confirmed", async t => {
  const f = fixture(t), preview = await f.service.person(f.personInput), started = deferred(), response = deferred();
  f.handleCore = async operation => {
    if (operation === "owner_recall_person_confirm") { started.resolve(); return response.promise; }
    return f.personEnvelope();
  };
  const pending = f.confirm(preview);
  await started.promise; f.state.invalidateEduPiRecallRoot(f.root);
  response.resolve(f.confirmEnvelope());
  const result = await pending;
  assert.equal(result.status, "held"); assert.equal(result.factWrite, true);
});

test("external, repeated or untagged epoch changes cannot use the private person-confirm exception", async t => {
  const cases = {
    "other operation": f => f.state.invalidateEduPiRecallRoot(f.root, "source_changed", "owner_memory_update"),
    "reason is not an operation tag": f => f.state.invalidateEduPiRecallRoot(f.root, "owner_recall_person_confirm"),
    "two confirm revocations": f => {
      f.state.invalidateEduPiRecallRoot(f.root, "source_changed", "owner_recall_person_confirm");
      f.state.invalidateEduPiRecallRoot(f.root, "source_changed", "owner_recall_person_confirm");
    },
    "external then own": f => {
      f.state.invalidateEduPiRecallRoot(f.root);
      f.state.invalidateEduPiRecallRoot(f.root, "source_changed", "owner_recall_person_confirm");
    },
    "own then external": f => {
      f.state.invalidateEduPiRecallRoot(f.root, "source_changed", "owner_recall_person_confirm");
      f.state.invalidateEduPiRecallRoot(f.root);
    },
  };
  for (const [name, revoke] of Object.entries(cases)) await t.test(name, async t => {
    const f = fixture(t), preview = await f.service.person(f.personInput);
    f.handleCore = operation => {
      assert.equal(operation, "owner_recall_person_confirm");
      revoke(f);
      return f.confirmEnvelope();
    };
    const result = await f.confirm(preview);
    assert.equal(result.status, "held"); assert.equal(result.factWrite, true);
    assert.deepEqual(f.calls.map(call => call.operation), ["owner_recall_person_read", "owner_recall_person_confirm"]);
  });
  await t.test("external revocation during reread after the own operation", async t => {
    const f = fixture(t), preview = await f.service.person(f.personInput);
    f.handleCore = operation => {
      if (operation === "owner_recall_person_confirm") {
        f.state.invalidateEduPiRecallRoot(f.root, "source_changed", operation);
        return f.confirmEnvelope();
      }
      f.state.invalidateEduPiRecallRoot(f.root);
      return f.personEnvelope();
    };
    const result = await f.confirm(preview);
    assert.equal(result.status, "held"); assert.equal(result.factWrite, true);
    assert.equal(f.calls.length, 3);
  });
});

test("held confirmation and divergent rereads preserve the Core fact_write boolean", async t => {
  for (const factWrite of [false, true]) {
    await t.test(`held with fact_write=${factWrite}`, async t => {
      const f = fixture(t), preview = await f.service.person(f.personInput);
      f.handleCore = async () => f.confirmEnvelope({ status: "held", fact_write: factWrite });
      const result = await f.confirm(preview);
      assert.equal(result.status, "held"); assert.equal(result.factWrite, factWrite); assert.equal(f.calls.length, 2);
    });
  }
  for (const [name, change] of Object.entries({
    fingerprint: result => { result.source_fingerprint = hash("person-v2"); },
    person: result => { result.person_id = "other-person"; },
    revision: result => { result.person_revision = 2; },
    held: result => { result.status = "held"; },
  })) await t.test(`reread ${name}`, async t => {
    const f = fixture(t), preview = await f.service.person(f.personInput);
    f.handleCore = async operation => {
      if (operation === "owner_recall_person_confirm") return f.confirmEnvelope();
      const reread = f.personEnvelope(); change(reread.result); return reread;
    };
    const result = await f.confirm(preview);
    assert.equal(result.status, "held"); assert.equal(result.factWrite, true);
  });
});

test("unknown confirmation transport returns factWrite:null, consumes its preview, and never retries automatically", async t => {
  for (const failedOperation of ["owner_recall_person_confirm", "owner_recall_person_read"]) await t.test(failedOperation, async t => {
    const f = fixture(t), preview = await f.service.person(f.personInput);
    f.handleCore = async operation => {
      if (operation === failedOperation) throw new Error("synthetic transport closed");
      return f.confirmEnvelope();
    };
    const result = await f.confirm(preview);
    assert.equal(result.status, "held"); assert.equal(result.reasonCode, "confirmation_unknown"); assert.equal(result.factWrite, null);
    const count = f.calls.length;
    assert.equal((await f.confirm(preview)).status, "held"); assert.equal(f.calls.length, count);
    assert.equal(f.calls.filter(call => call.operation === "owner_recall_person_confirm").length, 1);
  });
});

test("explicit retries from fresh previews use a deterministic command id and expose Core replay only after reread", async t => {
  const f = fixture(t), commands = new Set();
  let writes = 0;
  f.handleCore = async (operation, payload) => {
    if (operation === "owner_recall_person_read") return f.personEnvelope();
    const replayed = commands.has(payload.command_id);
    if (!replayed) { commands.add(payload.command_id); writes++; }
    return f.confirmEnvelope({ status: replayed ? "replayed" : "confirmed", fact_write: !replayed });
  };
  const first = await f.service.person(f.personInput);
  assert.equal((await f.confirm(first)).status, "confirmed");
  const second = await f.service.person(f.personInput);
  assert.notEqual(first.previewId, second.previewId);
  const replay = await f.confirm(second);
  assert.equal(replay.status, "replayed"); assert.equal(replay.factWrite, false);
  const confirms = f.calls.filter(call => call.operation === "owner_recall_person_confirm");
  assert.equal(confirms[0].payload.command_id, confirms[1].payload.command_id); assert.equal(writes, 1);
  assert.deepEqual(f.calls.map(call => call.operation), [
    "owner_recall_person_read", "owner_recall_person_confirm", "owner_recall_person_read",
    "owner_recall_person_read", "owner_recall_person_confirm", "owner_recall_person_read",
  ]);
});
