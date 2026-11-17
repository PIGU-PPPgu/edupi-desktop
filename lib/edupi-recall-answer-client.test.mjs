import assert from "node:assert/strict";
import test from "node:test";
import { createJiti } from "jiti";

const { createCoreRecallClient, parseCoreRecallPersonState, parseCoreRecallAnswerState } = await createJiti(import.meta.url, {
  tsconfigPaths: true,
}).import("./edupi-recall-answer-client.ts");
const state = extra => ({ version: 1, status: "current", reasonCode: null, personName: "张老师",
  personId: "synthetic-person", personRevision: 0, sourceFingerprint: "synthetic-fingerprint",
  previewId: "synthetic-preview", factWrite: false, ...extra });
const response = (body, status = 200) => ({ ok: status >= 200 && status < 300, json: async () => body });

test("enabled is a nonprivileged GET; every answer/person action uses the injected desktop transport and exact identity", async () => {
  const reads = [], writes = [], signal = new AbortController().signal;
  const client = createCoreRecallClient(async (url, init) => {
    writes.push({ url, init, body: JSON.parse(init.body) });
    return response(url.endsWith("answer-state") ? { version: 1, status: "current", reasonCode: null } : state({}));
  }, async (url, init) => { reads.push({ url, init }); return response({ version: 1, enabled: true }); });
  assert.equal(await client.enabled(signal), true);
  assert.equal(writes.length, 0);
  assert.equal(reads[0].url, "/api/edupi/recall/answer-state");
  assert.equal(reads[0].init.cache, "no-store");
  const identity = { sessionId: "synthetic-session", userEntryId: "synthetic-entry", receiptId: "synthetic-receipt" };
  await client.answerState(identity, signal);
  const person = { action: "read", sessionId: "synthetic-session", entryId: "earlier-source", personName: "张老师" };
  await client.person(person, signal);
  await client.person({ ...person, action: "confirm", previewId: "synthetic-preview" }, signal);
  assert.deepEqual(writes.map(item => item.url), [
    "/api/edupi/recall/answer-state", "/api/edupi/recall/person", "/api/edupi/recall/person",
  ]);
  assert.deepEqual(writes.map(item => item.body), [identity, person, { ...person, action: "confirm", previewId: "synthetic-preview" }]);
  assert.ok(writes.every(item => item.init.method === "POST" && item.init.cache === "no-store" && item.init.signal === signal));
  assert.ok(writes.every(item => !JSON.stringify(item.body).includes("owner") && !JSON.stringify(item.body).includes("messageRef")));
});

test("revision zero is valid and only the explicit unknown state accepts null factWrite", () => {
  assert.equal(parseCoreRecallPersonState(state({})).personRevision, 0);
  assert.equal(parseCoreRecallPersonState(state({ status: "held", reasonCode: "confirmation_unknown", factWrite: null })).factWrite, null);
  assert.throws(() => parseCoreRecallPersonState(state({ factWrite: null })));
  assert.throws(() => parseCoreRecallPersonState(state({ personRevision: -1 })));
  assert.throws(() => parseCoreRecallPersonState(state({ personRevision: 0.5 })));
  assert.throws(() => parseCoreRecallPersonState(state({ personName: ["张老师"] })));
  assert.throws(() => parseCoreRecallPersonState(state({ factWrite: "true" })));
  assert.throws(() => parseCoreRecallAnswerState({ version: 1, status: "verified", reasonCode: null }));
});

test("held conflicts preserve true and unknown write results, while non-success responses cannot grant current authority", async () => {
  const signal = new AbortController().signal;
  const request = { action: "confirm", sessionId: "synthetic", entryId: "source", personName: "张老师", previewId: "preview" };
  for (const [factWrite, reasonCode] of [[true, "source_changed"], [null, "confirmation_unknown"]]) {
    const client = createCoreRecallClient(async () => response(state({ status: "held", factWrite, reasonCode }), 409));
    assert.equal((await client.person(request, signal)).factWrite, factWrite);
  }
  const denied = createCoreRecallClient(async () => response({ version: 1, status: "current", reasonCode: null }, 403));
  await assert.rejects(denied.answerState({ sessionId: "synthetic", userEntryId: "source", receiptId: "receipt" }, signal));
});

test("a failed confirmation transport is attempted once and never converted to a successful or unwritten result", async () => {
  let calls = 0;
  const client = createCoreRecallClient(async () => { calls++; throw new Error("synthetic interrupted confirmation"); });
  await assert.rejects(client.person({ action: "confirm", sessionId: "synthetic", entryId: "source", personName: "张老师", previewId: "preview" },
    new AbortController().signal), /synthetic interrupted confirmation/);
  assert.equal(calls, 1);
});
