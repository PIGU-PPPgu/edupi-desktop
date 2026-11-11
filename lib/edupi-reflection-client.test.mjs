import assert from "node:assert/strict";
import { createHash, randomUUID, webcrypto } from "node:crypto";
import { readFile } from "node:fs/promises";
import test from "node:test";
import vm from "node:vm";
import ts from "typescript";

const compiled = ts.transpileModule(await readFile(new URL("./edupi-reflection-client.ts", import.meta.url), "utf8"),
  { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText;
const hash = value => `sha256:${value.repeat(64)}`;
const entry = {
  classId: "class-1", subject: "数学", date: "2026-11-10", slotId: "slot-1", lessonId: "lesson-1",
  lessonAt: "2026-11-10T09:00:00.000Z", registrationStatus: "unregistered", status: "ready",
  reasonCode: null, sourceBasisHash: hash("a"), grantVersion: 1, completionSourceIds: ["source-1"], completion: null,
  contentSourceIds: ["content-source-1"], content: null,
};
const completion = {
  factId: "fact-1", revision: 0, status: "candidate", sourceBasisHash: hash("b"),
  sourceId: "source-1", sourceRevision: "1", rawText: "合成完课记录\n2026-11-10T10:00:00.000Z", completedAt: "2026-11-10T10:00:00.000Z",
};
const registered = { ...entry, registrationStatus: "registered" };
const content = { factId: "content-fact-1", revision: 0, status: "pending_review", predicate: "lesson.observation",
  rawText: "学生说明等式两边同减的依据", value: "学生说明等式两边同减的依据",
  sourceBasisHash: hash("e"), sourceId: "content-source-1", sourceRevision: "1" };
const receipt = (id, status = "prepared", changes = {}) => ({
  id, fingerprint: hash("c"), status, terminal: ["committed", "not_committed"].includes(status), ...changes,
});
const response = (body, status = 200) => new Response(JSON.stringify({ externalSend: false, ...body }), { status });
const success = (id, saved = registered) => response({
  ok: true, readbackConfirmed: true, operation: receipt(id, "committed"), entry: saved,
});
const load = fetch => {
  const exports = {};
  vm.runInNewContext(compiled, { exports, URLSearchParams, Date, Number, Error, TextEncoder, crypto: webcrypto, fetch,
    require: name => name === "./desktop-native" ? {
      fetchDesktopApi: (url, options) => { assert.match(url, /^\/api\/[a-z0-9/_-]+$/iu); return fetch(url, options); },
      desktopApiHeaders: async () => new Headers({ "x-pi-desktop-token": "synthetic-reflection-read-token" }),
    } : {} });
  return exports;
};

test("date and both history reads preserve desktop authorization on their query URLs", async () => {
  const requests = [], controller = new AbortController();
  const client = load(async (url, init) => {
    requests.push(url);
    assert.equal(init.headers.get("x-pi-desktop-token"), "synthetic-reflection-read-token");
    assert.equal(init.signal, controller.signal);
    assert.equal(init.cache, "no-store");
    const query = new URL(url, "http://localhost").searchParams;
    return query.get("history") === "true"
      ? response({ ok: true, enabled: true, history: true, readOnly: true,
        ...(query.get("content") === "true" ? { content: true } : {}),
        entries: [], nextCursor: null, snapshotHash: hash("a") })
      : response({ ok: true, enabled: true, date: entry.date, truncated: false, entries: [] });
  });
  await client.readReflection(entry.date, controller.signal);
  await client.readReflectionHistory(undefined, controller.signal);
  await client.readReflectionContentHistory(undefined, controller.signal);
  assert.deepEqual(requests, ["/api/edupi/proactivity/reflection?date=2026-11-10",
    "/api/edupi/proactivity/reflection?history=true", "/api/edupi/proactivity/reflection?history=true&content=true"]);
});

test("prepare, commit and recover bind the same id and fingerprint with the route envelopes", async () => {
  const id = randomUUID(), requests = [], controller = new AbortController();
  const client = load(async (url, options) => {
    requests.push({ url, ...options, body: JSON.parse(options.body) });
    return options.method === "PUT" ? response({ ok: true, operation: receipt(id) }) : success(id);
  });
  const mutation = client.reflectionRequest(entry, { action: "register" });
  const prepared = await client.prepareReflectionOperation(id, mutation, controller.signal);
  const committed = await client.commitReflectionOperation(id, prepared.fingerprint, mutation, controller.signal);
  const recovered = await client.recoverReflectionOperation(id, prepared.fingerprint, controller.signal);
  assert.equal(committed.entry.lessonId, entry.lessonId);
  assert.equal(recovered.operation.status, "committed");
  assert.deepEqual(requests.map(request => request.method), ["PUT", "POST", "PATCH"]);
  assert.deepEqual(requests[0].body, { operationId: id, mutation: JSON.parse(JSON.stringify(mutation)) });
  assert.deepEqual(requests[1].body, { ...JSON.parse(JSON.stringify(mutation)), operationId: id, operationFingerprint: hash("c") });
  assert.deepEqual(requests[2].body, { operationId: id, operationFingerprint: hash("c") });
  for (const request of requests) {
    assert.equal(request.url, "/api/edupi/proactivity/reflection");
    assert.equal(request.cache, "no-store");
    assert.equal(request.signal, controller.signal);
  }
});

test("prepare refuses invalid or mismatched receipts without issuing POST", async () => {
  const id = randomUUID();
  for (const operation of [receipt(randomUUID()), receipt(id, "prepared", { terminal: true }), receipt(id, "prepared", { fingerprint: "bad" })]) {
    const requests = [];
    const client = load(async (_url, options) => { requests.push(options.method); return response({ ok: true, operation }); });
    await assert.rejects(client.prepareReflectionOperation(id, client.reflectionRequest(entry, { action: "register" })),
      error => error.code === "invalid_response" && error.uncertain === false);
    assert.deepEqual(requests, ["PUT"]);
  }
});

test("operation errors preserve server code and only matched terminal refusal proves no commit", async () => {
  const id = randomUUID();
  for (const method of ["commitReflectionOperation", "recoverReflectionOperation"]) {
    const client = load(async () => response({
      ok: false, readbackConfirmed: false, code: "source_changed", operation: receipt(id, "not_committed"),
    }, 409));
    const outcome = await client[method](id, hash("c"), ...(method.startsWith("commit") ? [client.reflectionRequest(entry, { action: "register" })] : []));
    assert.equal(outcome.operation.status, "not_committed");
    assert.equal(outcome.operation.terminal, true);
    assert.equal(outcome.entry, null);
    assert.equal(outcome.code, "source_changed");
  }
  const client = load(async () => response({ ok: false, code: "operation_mismatch" }, 409));
  await assert.rejects(client.recoverReflectionOperation(id, hash("c")),
    error => error.code === "operation_mismatch" && error.uncertain === true);
});

test("transport loss is uncertain for writes and recovery but cannot commit during prepare", async () => {
  const id = randomUUID(), client = load(async () => { throw new Error("connection lost"); });
  const mutation = client.reflectionRequest(entry, { action: "register" });
  await assert.rejects(client.prepareReflectionOperation(id, mutation), error => error.uncertain === false);
  await assert.rejects(client.commitReflectionOperation(id, hash("c"), mutation), error => error.uncertain === true);
  await assert.rejects(client.recoverReflectionOperation(id, hash("c")), error => error.uncertain === true);
});

test("unknown recovery remains nonterminal and never becomes an absence claim", async () => {
  const id = randomUUID(), client = load(async () => response({
    ok: false, readbackConfirmed: false, code: "operation_pending", operation: receipt(id, "unknown"),
  }, 409));
  const outcome = await client.recoverReflectionOperation(id, hash("c"));
  assert.equal(outcome.operation.terminal, false);
  assert.equal(outcome.entry, null);
  assert.equal(outcome.code, "operation_pending");
});

test("malformed, contradictory and foreign commit acknowledgments stay uncertain", async () => {
  const id = randomUUID();
  for (const changes of [
    { operation: receipt(randomUUID(), "committed") },
    { operation: receipt(id, "committed", { fingerprint: hash("d") }) },
    { readbackConfirmed: false },
    { externalSend: true },
    { result: { status: "commit_unknown" } },
    { entry: { ...registered, grantVersion: 0 } },
  ]) {
    const client = load(async () => response({
      ok: true, operation: receipt(id, "committed"), readbackConfirmed: true, entry: registered, ...changes,
    }));
    await assert.rejects(client.commitReflectionOperation(id, hash("c"), client.reflectionRequest(entry, { action: "register" })),
      error => error.uncertain === true);
  }
});

test("update compatibility requires preparation and checks the selected fact and advancing revision", async () => {
  const id = randomUUID(), captured = { ...registered, completion };
  let calls = 0;
  const client = load(async () => { calls++; return success(id, { ...captured, completion: { ...completion, status: "accepted" } }); });
  await assert.rejects(client.updateReflection(entry, { action: "register" }),
    error => error.code === "operation_not_prepared" && !error.uncertain);
  assert.equal(calls, 0);
  await assert.rejects(client.updateReflection(captured, { action: "review", decision: "accept" }, receipt(id)),
    error => error.uncertain === true);
  const accepted = { ...captured, completion: { ...completion, revision: 1, status: "accepted" } };
  const valid = load(async () => success(id, accepted));
  assert.equal((await valid.updateReflection(captured, { action: "review", decision: "accept" }, receipt(id))).completion.status, "accepted");
});

const historical = {
  lesson_id: "lesson-old", date: "2026-09-01", slot_id: "slot-old", term_id: "term-old", fact_id: "fact-old",
  revision: 2, status: "rejected", source_id: "source-old", source_revision: "1", observation_id: "observation-old",
  raw_text: "合成历史记录\n2026-09-01T10:00:00.000Z", completed_at: "2026-09-01T10:00:00.000Z",
  created_at: "2026-09-01T10:00:00.000Z", updated_at: "2026-09-02T10:00:00.000Z",
  last_review: { action: "reject", reviewed_at: "2026-09-02T10:00:00.000Z" },
};
const history = (changes = {}) => ({ ok: true, externalSend: false, enabled: true, history: true, readOnly: true,
  entries: [historical], nextCursor: "cursor_next", snapshotHash: hash("d"), ...changes });

test("history exports readable older facts and paginates without restricting the current date", async () => {
  const controller = new AbortController(), requests = [];
  const client = load(async (url, options) => {
    requests.push({ url, options });
    return response(history({ nextCursor: requests.length === 1 ? "cursor_next" : null }));
  });
  const first = await client.readReflectionHistory(undefined, controller.signal);
  assert.equal(first.entries[0].term_id, "term-old");
  assert.equal(first.entries[0].last_review.action, "reject");
  assert.equal((await client.readReflectionHistory(first.nextCursor, controller.signal)).nextCursor, null);
  assert.equal(requests[0].url, "/api/edupi/proactivity/reflection?history=true");
  assert.equal(requests[1].url, "/api/edupi/proactivity/reflection?history=true&cursor=cursor_next");
  assert.equal(requests[0].options.signal, controller.signal);
});

test("history_changed remains available to the component reset-and-reload path", async () => {
  const client = load(async () => response({ ok: false, code: "history_changed" }, 409));
  await assert.rejects(client.readReflectionHistory("cursor_old"), { code: "history_changed" });
});

test("history rejects unsafe, duplicate, invalid-date and contradictory pages", () => {
  const client = load(() => assert.fail("unexpected request"));
  for (const changes of [
    { externalSend: true }, { readOnly: false }, { snapshotHash: "bad" }, { nextCursor: "../bad" },
    { entries: [] }, { entries: [historical, historical] },
    { entries: [{ ...historical, date: "2026-02-30" }] },
    { entries: [{ ...historical, last_review: null }] },
    { entries: [{ ...historical, raw_text: "missing timestamp" }] },
    { entries: [{ ...historical, status: "invented" }] },
  ]) assert.throws(() => client.parseReflectionHistory(history(changes)), { code: "invalid_response" });
  assert.throws(() => client.parseReflectionHistory(history(), "cursor_next"), { code: "invalid_response" });
  assert.equal(client.parseReflectionHistory(history({ entries: [], nextCursor: null })).entries.length, 0);
});

const contentHistorical = {
  lesson_id: "lesson-old", date: "2026-09-01", slot_id: "slot-old", term_id: "term-old",
  fact_id: "content-fact-old", revision: 2, status: "rejected", source_id: "source-old",
  source_revision: "1", observation_id: "observation-old", raw_text: "Ａ Ｂ\n课堂观察",
  created_at: "2026-09-01T10:00:00.000Z", updated_at: "2026-09-02T10:00:00.000Z",
  last_review: { action: "reject", reviewed_at: "2026-09-02T10:00:00.000Z" },
  predicate: "lesson.observation", value: "A B 课堂观察",
};
const contentHistory = (changes = {}) => ({ ...history({ entries: [contentHistorical] }), content: true, ...changes });

test("content history reads normalized older facts, paginates and forwards AbortSignal", async () => {
  const controller = new AbortController(), requests = [];
  const client = load(async (url, options) => {
    requests.push({ url, options });
    return response(contentHistory({ nextCursor: requests.length === 1 ? "cursor_next" : null }));
  });
  const first = await client.readReflectionContentHistory(undefined, controller.signal);
  assert.equal(first.entries[0].value, "A B 课堂观察");
  assert.equal(first.entries[0].predicate, "lesson.observation");
  assert.equal((await client.readReflectionContentHistory(first.nextCursor, controller.signal)).nextCursor, null);
  assert.deepEqual(requests.map(request => request.url), [
    "/api/edupi/proactivity/reflection?history=true&content=true",
    "/api/edupi/proactivity/reflection?history=true&content=true&cursor=cursor_next",
  ]);
  assert.ok(requests.every(request => request.options.signal === controller.signal && request.options.cache === "no-store"));
});

test("content history exposes history_changed and rejects malformed cursors before fetching", async () => {
  const client = load(async () => response({ ok: false, code: "history_changed" }, 409));
  await assert.rejects(client.readReflectionContentHistory("cursor_old"), { code: "history_changed" });
  const unreachable = load(() => assert.fail("invalid cursor must not reach Core"));
  for (const cursor of ["../bad", "x".repeat(513)]) {
    await assert.rejects(unreachable.readReflectionContentHistory(cursor), { code: "invalid_cursor" });
  }
});

test("content history rejects malformed facts, unsafe pages, ordering and repeated cursors", () => {
  const client = load(() => assert.fail("unexpected request"));
  const earlier = { ...contentHistorical, date: "2026-08-31", fact_id: "content-fact-earlier" };
  const later = { ...contentHistorical, date: "2026-09-02", fact_id: "content-fact-later" };
  const sameDayEarlier = { ...contentHistorical, fact_id: "content-fact-earlier",
    created_at: "2026-09-01T09:00:00.000Z" };
  const sameTimeEarlierId = { ...contentHistorical, fact_id: "a-content-fact" };
  for (const changes of [
    { externalSend: true }, { readOnly: false }, { content: false }, { snapshotHash: "bad" },
    { nextCursor: "../bad" }, { entries: [] }, { entries: [contentHistorical, contentHistorical] },
    { entries: [earlier, later] }, { entries: [contentHistorical, sameDayEarlier, sameTimeEarlierId] },
    { entries: [contentHistorical, sameTimeEarlierId] },
    { entries: [{ ...contentHistorical, completed_at: "2026-09-01T10:00:00.000Z" }] },
    { entries: [{ ...contentHistorical, predicate: "lesson.completed" }] },
    { entries: [{ ...contentHistorical, value: "Ａ Ｂ 课堂观察" }] },
    { entries: [{ ...contentHistorical, date: "2026-02-30" }] },
    { entries: [{ ...contentHistorical, last_review: null }] },
    { entries: [{ ...contentHistorical, status: "invented" }] },
  ]) assert.throws(() => client.parseReflectionContentHistory(contentHistory(changes)), { code: "invalid_response" });
  assert.throws(() => client.parseReflectionContentHistory(contentHistory(), "cursor_next"), { code: "invalid_response" });
  assert.equal(client.parseReflectionContentHistory(contentHistory({ entries: [], nextCursor: null })).entries.length, 0);
  assert.equal(client.parseReflectionContentHistory(contentHistory({ entries: [contentHistorical, earlier], nextCursor: null })).entries.length, 2);
});

test("content capture binds the authorized source and review binds the selected fact and CAS evidence", () => {
  const client = load(() => assert.fail("unexpected request"));
  const action = { action: "contentCapture", sourceId: "content-source-1", sourceRevision: "1",
    predicate: "lesson.observation", rawText: content.rawText };
  const mutation = client.reflectionRequest(registered, action);
  assert.deepEqual(JSON.parse(JSON.stringify(mutation)), {
    classId: entry.classId, subject: entry.subject, date: entry.date, slotId: entry.slotId,
    expectedSourceBasisHash: hash("a"), expectedGrantVersion: 1, ...action,
  });
  for (const change of [{ sourceId: "foreign" }, { sourceRevision: "bad\tversion" },
    { predicate: "lesson.completed" }, { rawText: "  " }, { rawText: "x\0y" }, { rawText: "x".repeat(4001) }]) {
    assert.throws(() => client.reflectionRequest(registered, { ...action, ...change }));
  }
  assert.throws(() => client.reflectionRequest(entry, action));
  const pending = { ...registered, content };
  const review = { action: "contentReview", factId: content.factId, expectedFactRevision: 0,
    expectedContentBasisHash: hash("e"), decision: "accept" };
  assert.deepEqual(JSON.parse(JSON.stringify(client.reflectionRequest(pending, review))), {
    classId: entry.classId, subject: entry.subject, date: entry.date, slotId: entry.slotId,
    expectedSourceBasisHash: hash("a"), expectedGrantVersion: 1, ...review,
  });
  for (const change of [{ factId: "other" }, { expectedFactRevision: 1 }, { expectedContentBasisHash: hash("f") },
    { decision: "withdraw" }]) assert.throws(() => client.reflectionRequest(pending, { ...review, ...change }));
  assert.throws(() => client.reflectionRequest({ ...pending, content: { ...content, status: "accepted" } }, review));
});

test("content list validation refuses malformed records and held entries with content", () => {
  const client = load(() => assert.fail("unexpected request"));
  const list = item => ({ ok: true, externalSend: false, enabled: true, date: entry.date, truncated: false, entries: [item] });
  assert.equal(client.parseReflectionList(list({ ...registered, content }), entry.date).entries[0].content.factId, content.factId);
  for (const change of [{ predicate: "lesson.completed" }, { status: "other" }, { revision: -1 },
    { rawText: "" }, { sourceBasisHash: "bad" }, { sourceId: "" }, { sourceRevision: "" }]) {
    assert.throws(() => client.parseReflectionList(list({ ...registered, content: { ...content, ...change } }), entry.date));
  }
  assert.throws(() => client.parseReflectionList(list({ ...registered, contentSourceIds: [""] }), entry.date));
  assert.throws(() => client.parseReflectionList(list({ ...registered, status: "held", reasonCode: "lesson_ambiguous",
    lessonId: null, lessonAt: null, sourceBasisHash: null, grantVersion: null, content }), entry.date));
});

test("content prepare, commit and recovery preserve CAS binding and reject mismatched readback", async () => {
  const id = randomUUID(), requests = [];
  const pending = { ...registered, content }, accepted = { ...pending, content: { ...content, revision: 1,
    status: "accepted", sourceBasisHash: hash("f") } };
  const action = { action: "contentReview", factId: content.factId, expectedFactRevision: 0,
    expectedContentBasisHash: hash("e"), decision: "accept" };
  let saved = accepted;
  const client = load(async (_url, options) => {
    requests.push({ method: options.method, body: JSON.parse(options.body) });
    return options.method === "PUT" ? response({ ok: true, operation: receipt(id) }) : success(id, saved);
  });
  const prepared = await client.prepareReflection(pending, action, id);
  const committed = await client.commitReflection(pending, action, prepared);
  assert.equal(committed.content.status, "accepted");
  assert.equal(committed.completion, null);
  assert.equal((await client.recoverReflection(prepared)).entry.content.factId, content.factId);
  assert.equal(requests[1].body.expectedContentBasisHash, hash("e"));
  for (const change of [{ factId: "other" }, { revision: 0 }, { status: "rejected" }, { sourceBasisHash: hash("e") }]) {
    saved = { ...accepted, content: { ...accepted.content, ...change } };
    await assert.rejects(client.commitReflection(pending, action, prepared), error => error.uncertain === true);
  }
});

test("content capture readback requires identical source, version, predicate and raw evidence", () => {
  const client = load(() => assert.fail("unexpected request"));
  const action = { action: "contentCapture", sourceId: content.sourceId, sourceRevision: content.sourceRevision,
    predicate: content.predicate, rawText: content.rawText };
  assert.equal(client.reflectionReadbackMatches(registered, action, [{ ...registered, content }]), true);
  for (const change of [{ sourceId: "other" }, { sourceRevision: "2" }, { predicate: "lesson.feedback" },
    { rawText: "其他内容" }]) {
    assert.equal(client.reflectionReadbackMatches(registered, action, [{ ...registered, content: { ...content, ...change } }]), false);
  }
});

test("capture commit rejects an incorrect or malformed returned fact as uncertain", async () => {
  const id = randomUUID();
  const action = { action: "contentCapture", sourceId: content.sourceId, sourceRevision: content.sourceRevision,
    predicate: content.predicate, rawText: content.rawText };
  let saved = { ...registered, content };
  const client = load(async () => success(id, saved));
  assert.equal((await client.commitReflection(registered, action, receipt(id))).content.status, "pending_review");
  for (const change of [{ predicate: "lesson.feedback" }, { rawText: "其他内容" },
    { sourceId: "other" }, { sourceRevision: "2" }, { sourceBasisHash: "invalid" }]) {
    saved = { ...registered, content: { ...content, ...change } };
    await assert.rejects(client.commitReflection(registered, action, receipt(id)), error => error.uncertain === true);
  }
});

const contentSourceId = (entry, input) => `lesson-content:${createHash("sha256").update(JSON.stringify([entry.classId, entry.subject, entry.lessonId])).digest("hex").slice(0, 24)}:${createHash("sha256").update(JSON.stringify([input.predicate, input.rawText])).digest("hex")}`;
const sourceInput = { predicate: "lesson.observation", rawText: "  合成课堂内容\n保留原文  " };
const sourceSuccess = (current = registered, input = sourceInput) => {
  const sourceId = contentSourceId(current, input);
  return { ok: true, externalSend: false, readbackConfirmed: true, sourceId,
    entry: { ...current, grantVersion: current.grantVersion + 1, contentSourceIds: [...current.contentSourceIds, sourceId] } };
};

test("source registration sends exactly the source action, unchanged raw evidence and CAS, without operation fields", async () => {
  const current = { ...registered, contentSourceIds: [] }, requests = [], controller = new AbortController();
  const client = load(async (url, options) => {
    requests.push({ url, ...options, body: JSON.parse(options.body) });
    return response(sourceSuccess(current));
  });
  const result = await client.registerReflectionContentSource(current, sourceInput, controller.signal);
  assert.equal(requests.length, 1);
  assert.deepEqual(requests[0].body, { action: "registerContentSource", classId: current.classId,
    subject: current.subject, date: current.date, slotId: current.slotId,
    expectedSourceBasisHash: current.sourceBasisHash, expectedGrantVersion: current.grantVersion, ...sourceInput });
  assert.equal(requests[0].url, "/api/edupi/proactivity/reflection");
  assert.equal(requests[0].method, "POST");
  assert.equal(requests[0].cache, "no-store");
  assert.equal(requests[0].signal, controller.signal);
  assert.equal(result.sourceId, contentSourceId(current, sourceInput));
  assert.equal(result.entry.grantVersion, current.grantVersion + 1);
  const idempotent = load(async () => response({ ...sourceSuccess(current), entry: {
    ...sourceSuccess(current).entry, grantVersion: current.grantVersion } }));
  assert.equal((await idempotent.registerReflectionContentSource(current, sourceInput)).entry.grantVersion, current.grantVersion);
});

test("source registration rejects invalid inputs before sending anything", async () => {
  const requests = [], client = load(async (...args) => { requests.push(args); throw new Error("unexpected fetch"); });
  for (const invalid of [null, {}, { ...sourceInput, rawText: " \n " }, { ...sourceInput, rawText: "x".repeat(4001) },
    { ...sourceInput, rawText: "bad\0text" }, { ...sourceInput, predicate: "lesson.unknown" }, { ...sourceInput, sourceId: "forged" }]) {
    await assert.rejects(client.registerReflectionContentSource(registered, invalid), error => error.code === "invalid_content");
  }
  for (const invalid of [entry, { ...registered, date: "2026-02-30" }, { ...registered, grantVersion: 0 },
    { ...registered, status: "held" }, { ...registered, lessonId: null }, { ...registered, content }]) {
    await assert.rejects(client.registerReflectionContentSource(invalid, sourceInput), error => error.code === "invalid_content");
  }
  assert.equal(requests.length, 0);
});

test("source registration rejects foreign occurrence, stale CAS, missing source and incorrect deterministic identity", async () => {
  const valid = sourceSuccess();
  const entries = [
    { ...valid.entry, classId: "class-2" }, { ...valid.entry, subject: "语文" },
    { ...valid.entry, date: "2026-11-11" }, { ...valid.entry, slotId: "slot-2" },
    { ...valid.entry, lessonId: "lesson-2" }, { ...valid.entry, lessonAt: "2026-11-10T10:00:00.000Z" },
    { ...valid.entry, sourceBasisHash: hash("b") }, { ...valid.entry, grantVersion: 0 },
    { ...valid.entry, grantVersion: 1.5 }, { ...valid.entry, registrationStatus: "unregistered" },
    { ...valid.entry, contentSourceIds: [] }, { ...valid.entry, contentSourceIds: [valid.sourceId] },
    { ...valid.entry, completionSourceIds: [] },
  ];
  for (const saved of entries) {
    const client = load(async () => response({ ...valid, entry: saved }));
    await assert.rejects(client.registerReflectionContentSource(registered, sourceInput),
      error => error.code === "content_source_unverified" && /课堂内容来源/.test(error.message));
  }
  const newer = { ...registered, grantVersion: 3 };
  await assert.rejects(load(async () => response(valid)).registerReflectionContentSource(newer, sourceInput));
  for (const changes of [{ sourceId: "content-source-1" }, { sourceId: contentSourceId(registered, { ...sourceInput, rawText: sourceInput.rawText.trim() }) },
    { readbackConfirmed: false }, { externalSend: true }, { entry: null }, { operationId: randomUUID() }]) {
    await assert.rejects(load(async () => response({ ...valid, ...changes })).registerReflectionContentSource(registered, sourceInput),
      error => error.code === "content_source_unverified");
  }
});

test("source registration failures and unknown replies remain Chinese errors and never turn into capture", async () => {
  for (const code of ["source_changed", "content_source_unverified", "content_source_capacity"]) {
    const calls = [], client = load(async (_url, options) => { calls.push(JSON.parse(options.body)); return response({ ok: false, code }, 409); });
    await assert.rejects(client.registerReflectionContentSource(registered, sourceInput),
      error => error.code === code && /[\u4e00-\u9fff]/u.test(error.message));
    assert.deepEqual(calls.map(call => call.action), ["registerContentSource"]);
  }
  for (const fetch of [async () => { throw new Error("offline"); }, async () => ({ ok: true, json: async () => { throw new Error("bad json"); } }),
    async () => response({ ok: false }), async () => response({ ok: true })]) {
    await assert.rejects(load(fetch).registerReflectionContentSource(registered, sourceInput),
      error => error.code === "content_source_unverified" && /[\u4e00-\u9fff]/u.test(error.message));
  }
});
