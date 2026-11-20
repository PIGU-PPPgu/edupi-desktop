import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import test from "node:test";
import { promisify } from "node:util";
import { createJiti } from "jiti";
import lockfile from "proper-lockfile";

const jiti = createJiti(import.meta.url, { fsCache: false });
const auth = await jiti.import("./edupi-recall-authorization.ts"), config = await jiti.import("./edupi-recall-config.ts");
const approved = { approveNormal: () => true };
const now = "2026-11-18T00:00:00.000Z";
const enable = {
  enabled: true, purpose: "r04_recall_answer", ownerId: "r04-test-owner", grantId: "r04_recall_aabbcc",
  grantVersion: 1, scope: { classId: "class-test", subject: "数学", termId: "term-test" },
  model: { provider: "test-provider", modelId: "test-model" }, budgetId: "r04_recall_budget_aabbcc",
  limit: 3, validUntil: "2026-11-19T00:00:00.000Z", consentId: "r04-consent-test",
};
const originalQuery = "  合成测试问题：\n谁参与了第 2 次练习？  ";
const queryHash = value => `sha256:${crypto.createHash("sha256").update(value).digest("hex")}`;
const model = { provider: enable.model.provider, id: enable.model.modelId };
function fixture(t) {
  const root = fs.realpathSync(fs.mkdtempSync("/tmp/edupi-r04-auth-test-"));
  const stateDir = path.join(root, "state"), dataRoot = path.join(root, "data");
  fs.mkdirSync(stateDir, { mode: 0o700 }); fs.mkdirSync(dataRoot, { mode: 0o700 });
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  return { root, stateDir, dataRoot, env: {}, now };
}
const ledgerFile = f => path.join(f.stateDir, "edupi-recall-authorization.json");
const errorCode = code => error => error?.code === code;
const intentInput = (overrides = {}) => ({
  sessionId: "session-test", clientRequestId: "client-test", rawQuery: originalQuery,
  ownerId: enable.ownerId, grantId: enable.grantId, grantVersion: enable.grantVersion,
  scope: enable.scope, configConsentId: enable.consentId, ...overrides,
});
const registration = (seed = "a") => ({ messageRef: `owner_message:${seed.repeat(64)}`,
  producerEpoch: "e".repeat(64), sequence: 1, fencingGeneration: 1, instanceNonce: "r04-test-instance" });
async function setup(f, overrides = {}) {
  return config.writeEduPiRecallConfig({ ...enable, ...overrides }, { ...f, expectedUpdatedAt: null }, approved);
}
async function capture(f, overrides = {}, seed = "a") {
  const intent = await auth.prepareRecallIntent(intentInput(overrides), f, approved), reg = registration(seed);
  return auth.markCapturedRecallIntent({ intentId: intent.intentId, messageRef: reg.messageRef, registration: reg }, f, approved);
}
const reserve = (f, requestId, extra = {}, deps = approved) =>
  auth.reserveRecallModelAttempt({ requestId, rawQuery: originalQuery, model, ...extra }, f, deps);
const workerSource = `
import { createJiti } from "jiti";
const [modulePath, action, optionsJSON, payloadJSON] = process.argv.slice(1);
const a = await createJiti(import.meta.url, { fsCache: false }).import(modulePath);
const options = JSON.parse(optionsJSON), payload = JSON.parse(payloadJSON), deps = {approveNormal:()=>true};
let value;
if (action === "reserve") {
  value = [];
  for (const input of payload) value.push(await a.reserveRecallModelAttempt(input, options, deps));
} else if (action === "read") value = {budget:a.readRecallBudget(payload.budgetId, options),
  intent:a.readRecallIntent({intentId:payload.intentId}, options, deps)};
else if (action === "prepare") value = await a.prepareRecallIntent(payload, options, deps);
console.log(JSON.stringify(value));
`;
async function worker(action, f, payload) {
  const { stdout } = await promisify(execFile)(process.execPath, ["--input-type=module", "-e", workerSource,
    path.resolve("lib/edupi-recall-authorization.ts"), action, JSON.stringify(f), JSON.stringify(payload)],
  { cwd: process.cwd(), timeout: 15_000, maxBuffer: 256_000 });
  return JSON.parse(stdout);
}

test("durable prepare is byte-for-byte idempotent, including a cold process, and rejects changed owner/grant/scope/consent", async t => {
  const f = fixture(t); await setup(f);
  const first = await auth.prepareRecallIntent(intentInput(), f, approved);
  assert.equal(first.rawQuery, originalQuery); assert.equal(first.queryHash, queryHash(originalQuery));
  assert.deepEqual(await worker("prepare", f, intentInput()), first);
  for (const changed of [
    { rawQuery: originalQuery.trim() }, { rawQuery: originalQuery.replace("\n", " ") },
    { ownerId: "other-owner" }, { grantId: "g1-grant" }, { grantVersion: 2 },
    { scope: { ...enable.scope, termId: "other-term" } }, { configConsentId: "other-consent" },
  ]) {
    await assert.rejects(auth.prepareRecallIntent(intentInput(changed), f, approved));
  }
  assert.equal(fs.statSync(ledgerFile(f)).mode & 0o777, 0o600);
  const ledger = JSON.parse(fs.readFileSync(ledgerFile(f), "utf8"));
  assert.equal(ledger.intents.length, 1); assert.equal(ledger.budgets.length, 0); assert.equal(ledger.attempts.length, 0);
  assert.equal(auth.readRecallIntent({ intentId: first.intentId }, f, approved).readyForDispatch, false);
  await assert.rejects(auth.prepareRecallIntent(intentInput({ clientRequestId: "bad-unicode", rawQuery: "\ud800" }), f, approved),
    errorCode("recall_invalid_input"));
});

test("waiting mutations snapshot caller input and captured registration", async t => {
  const f = fixture(t); await setup(f);
  const input = intentInput(), preparing = auth.prepareRecallIntent(input, f, approved);
  input.rawQuery = "changed-while-waiting"; input.scope = { ...enable.scope, classId: "other" };
  const intent = await preparing;
  assert.equal(intent.rawQuery, originalQuery);
  const reg = registration(), captureInput = { intentId: intent.intentId, messageRef: reg.messageRef, registration: reg };
  const capturing = auth.markCapturedRecallIntent(captureInput, f, approved);
  captureInput.registration.instanceNonce = "changed-while-waiting";
  const captured = await capturing;
  assert.equal(captured.registration.instanceNonce, "r04-test-instance");
  const dispatch = { requestId: "snapshot-dispatch", rawQuery: originalQuery, model: { ...model } };
  const reserving = auth.reserveRecallModelAttempt(dispatch, f, approved);
  dispatch.model.id = "changed-while-waiting"; dispatch.rawQuery = "changed";
  assert.equal((await reserving).permitted, true);
});

test("only captured R04 intent with matching raw query or hash/model can get one permit", async t => {
  const f = fixture(t); await setup(f);
  const prepared = await auth.prepareRecallIntent(intentInput(), f, approved);
  assert.equal((await reserve(f, "before-capture")).reason, "recall_intent_unavailable");
  const reg = registration();
  await assert.rejects(auth.markCapturedRecallIntent({ intentId: prepared.intentId,
    messageRef: registration("b").messageRef, registration: reg }, f, approved), errorCode("recall_invalid_input"));
  const captured = await auth.markCapturedRecallIntent({ intentId: prepared.intentId, messageRef: reg.messageRef, registration: reg }, f, approved);
  assert.equal(captured.state, "captured");
  assert.deepEqual(await auth.markCapturedRecallIntent({ intentId: prepared.intentId, messageRef: reg.messageRef, registration: reg }, f, approved), captured);
  await assert.rejects(auth.markCapturedRecallIntent({ intentId: prepared.intentId,
    messageRef: registration("b").messageRef, registration: registration("b") }, f, approved), errorCode("recall_intent_conflict"));
  assert.equal((await reserve(f, "wrong-query", { rawQuery: originalQuery.trim() })).permitted, false);
  assert.equal((await reserve(f, "wrong-model", { model: { provider: model.provider, id: "g1-model" } })).reason, "recall_binding_mismatch");
  assert.equal((await reserve(f, "wrong-purpose", { purpose: "teaching_preparation" })).reason, "recall_model_dispatch_only");
  assert.equal((await reserve(f, "g1-outbox-budget", { budgetId: "g1-budget" })).reason, "recall_invalid_input");
  assert.equal(auth.readRecallBudget(enable.budgetId, f), null);
  const permit = await reserve(f, "ipc-dispatch-1");
  assert.equal(permit.permitted, true); assert.equal(permit.used, 1); assert.equal(permit.remaining, 2);
  assert.equal(permit.intentId, captured.intentId);
  assert.equal((await reserve(f, "ipc-dispatch-1")).reason, "recall_request_replayed");
  const hashed = await auth.reserveRecallModelAttempt({ requestId: "ipc-dispatch-2", queryHash: queryHash(originalQuery), model }, f, approved);
  assert.equal(hashed.permitted, true);
  assert.equal(auth.readRecallBudget(enable.budgetId, f).used, 2);
});

test("receipt/person reads and wrong kinds never mutate or consume budget; legacy canary never borrows normal budget", async t => {
  const f = fixture(t); await setup(f); const intent = await capture(f);
  const before = fs.readFileSync(ledgerFile(f), "utf8");
  for (let i = 0; i < 3; i++) {
    assert.equal(auth.readRecallIntent({ intentId: intent.intentId }, f, approved).usable, true);
    assert.equal(auth.readRecallBudget(enable.budgetId, f), null);
  }
  for (const purpose of ["receipt_read", "person_read", "memory_recall"]) {
    assert.equal((await reserve(f, `read-${purpose}`, { purpose })).reason, "recall_model_dispatch_only");
  }
  assert.equal(fs.readFileSync(ledgerFile(f), "utf8"), before);
  assert.equal((await reserve(f, "default-gate", {}, {})).reason, "recall_inactive");
  const canaryFixture = fixture(t), env = { EDUPI_CORE_RECALL_ANSWERS: "1", EDUPI_DESKTOP_ISOLATED_CANARY: "1" };
  assert.equal(config.readEduPiRecallActivation({ ...canaryFixture, env }).mode, "canary");
  assert.equal((await reserve({ ...canaryFixture, env }, "canary-not-durable")).reason, "recall_inactive");
  assert.equal(fs.existsSync(ledgerFile(canaryFixture)), false);
});

test("unknown and used consume after a cold process; failure/cancel cannot refund or replay", async t => {
  const f = fixture(t); await setup(f); const intent = await capture(f);
  assert.equal((await reserve(f, "ipc-used")).permitted, true);
  await auth.markRecallModelAttempt({ requestId: "ipc-used", status: "used" }, f);
  assert.equal((await reserve(f, "ipc-unknown-cancelled")).permitted, true);
  await auth.markRecallModelAttempt({ requestId: "ipc-unknown-cancelled", status: "unknown" }, f);
  const cold = await worker("read", f, { budgetId: enable.budgetId, intentId: intent.intentId });
  assert.equal(cold.budget.used, 2); assert.equal(cold.budget.remaining, 1);
  assert.deepEqual(cold.budget.attempts.map(item => item.status), ["used", "unknown"]);
  assert.equal(cold.intent.readyForDispatch, true);
  const results = await worker("reserve", f, [
    { requestId: "ipc-unknown-cancelled", rawQuery: originalQuery, model },
    { requestId: "ipc-last", queryHash: queryHash(originalQuery), model },
    { requestId: "ipc-over", rawQuery: originalQuery, model },
  ]);
  assert.equal(results[0].reason, "recall_request_replayed"); assert.equal(results[1].permitted, true);
  assert.equal(results[2].reason, "recall_budget_exhausted");
  await assert.rejects(auth.markRecallModelAttempt({ requestId: "ipc-used", status: "refunded" }, f), errorCode("recall_invalid_input"));
  assert.equal(auth.readRecallBudget(enable.budgetId, f).used, 3);
});

test("two independent process writers cannot overspend N, and a duplicate IPC id cannot get two network permits", async t => {
  const f = fixture(t); await setup(f); await capture(f);
  const inputs = seed => Array.from({ length: 4 }, (_, index) => ({ requestId: `ipc-${seed}-${index}`, rawQuery: originalQuery, model }));
  const results = (await Promise.all([worker("reserve", f, inputs("one")), worker("reserve", f, inputs("two"))])).flat();
  assert.equal(results.filter(item => item.permitted).length, enable.limit);
  assert.equal(results.filter(item => item.reason === "recall_budget_exhausted").length, 8 - enable.limit);
  assert.equal(auth.readRecallBudget(enable.budgetId, f).used, enable.limit);
  const other = fixture(t); await setup(other); await capture(other);
  const sameRequest = [{ requestId: "ipc-same", rawQuery: originalQuery, model }];
  const duplicate = (await Promise.all([worker("reserve", other, sameRequest), worker("reserve", other, sameRequest)])).flat();
  assert.equal(duplicate.filter(item => item.permitted).length, 1);
  assert.equal(duplicate.find(item => !item.permitted).reason, "recall_request_replayed");
  assert.equal(auth.readRecallBudget(enable.budgetId, other).used, 1);
});

test("stop denies capture/read/reserve and re-enable cannot resurrect old captured intents", async t => {
  const f = fixture(t), initial = await setup(f), captured = await capture(f);
  assert.equal((await reserve(f, "before-stop")).permitted, true);
  const stopped = await config.writeEduPiRecallConfig({ enabled: false }, { ...f, expectedUpdatedAt: initial.updatedAt });
  const canary = { ...f, env: { EDUPI_CORE_RECALL_ANSWERS: "1", EDUPI_DESKTOP_ISOLATED_CANARY: "1" } };
  assert.equal(config.readEduPiRecallActivation(canary, approved).reason, "stopped");
  assert.equal(auth.readRecallIntent({ intentId: captured.intentId }, f, approved).usable, false);
  assert.equal((await reserve(f, "after-stop")).reason, "recall_inactive");
  await assert.rejects(auth.markCapturedRecallIntent({ intentId: captured.intentId,
    messageRef: captured.messageRef, registration: captured.registration }, f, approved), errorCode("recall_inactive"));
  await config.writeEduPiRecallConfig(enable, { ...f, expectedUpdatedAt: stopped.updatedAt }, approved);
  assert.equal(auth.readRecallIntent({ intentId: captured.intentId }, f, approved).reason, "binding_changed");
  assert.equal((await reserve(f, "after-re-enable")).reason, "recall_intent_unavailable");
  await assert.rejects(auth.prepareRecallIntent(intentInput(), f, approved), errorCode("recall_intent_conflict"));
  assert.equal(auth.readRecallBudget(enable.budgetId, f).used, 1);
});

test("durable revoke cannot be prepared/captured/reserved again, including a cold process", async t => {
  const f = fixture(t); await setup(f); const captured = await capture(f);
  await auth.revokeRecallIntent({ intentId: captured.intentId }, f);
  assert.equal(auth.readRecallIntent({ sessionId: captured.sessionId, clientRequestId: captured.clientRequestId }, f, approved).reason, "revoked");
  assert.equal((await worker("read", f, { budgetId: enable.budgetId, intentId: captured.intentId })).intent.reason, "revoked");
  await assert.rejects(auth.prepareRecallIntent(intentInput(), f, approved), errorCode("recall_intent_conflict"));
  await assert.rejects(auth.markCapturedRecallIntent({ intentId: captured.intentId,
    messageRef: captured.messageRef, registration: captured.registration }, f, approved), errorCode("recall_intent_unavailable"));
  assert.equal((await reserve(f, "after-revoke")).reason, "recall_intent_unavailable");
  assert.equal(auth.readRecallBudget(enable.budgetId, f), null);
});

test("expiry/safe mode/model/scope/term/consent/version changes refuse the old intent without consumption", async t => {
  for (const change of [
    { model: { ...enable.model, modelId: "new-model" } }, { scope: { ...enable.scope, classId: "new-class" } },
    { scope: { ...enable.scope, subject: "语文" } }, { scope: { ...enable.scope, termId: "new-term" } },
    { consentId: "new-consent" }, { grantVersion: 2 }, { ownerId: "new-owner" },
  ]) {
    const f = fixture(t), initial = await setup(f); await capture(f);
    await config.writeEduPiRecallConfig({ ...enable, ...change }, { ...f, expectedUpdatedAt: initial.updatedAt }, approved);
    assert.equal((await reserve(f, "changed")).permitted, false);
    assert.equal(auth.readRecallBudget(enable.budgetId, f), null);
  }
  const f = fixture(t); await setup(f); await capture(f);
  assert.equal((await reserve({ ...f, now: enable.validUntil }, "expired")).reason, "recall_inactive");
  assert.equal((await reserve({ ...f, env: { EDUPI_SAFE_MODE: "1" } }, "safe-mode")).reason, "recall_inactive");
  assert.equal(auth.readRecallBudget(enable.budgetId, f), null);
});

test("same grant/version cannot reset budget via new ID/consent/limit/expiry; changed bindings are pinned", async t => {
  for (const change of [
    { budgetId: "r04_recall_budget_ffdd" }, { consentId: "new-consent" }, { limit: 12 },
    { validUntil: "2026-11-20T00:00:00.000Z" }, { model: { provider: "test-provider", modelId: "new-model" } },
    { scope: { ...enable.scope, termId: "new-term" } },
  ]) {
    const f = fixture(t), initial = await setup(f); await capture(f);
    assert.equal((await reserve(f, "first")).permitted, true);
    const next = { ...enable, ...change };
    await config.writeEduPiRecallConfig(next, { ...f, expectedUpdatedAt: initial.updatedAt }, approved);
    await capture(f, { sessionId: "session-next", clientRequestId: "client-next", scope: next.scope,
      configConsentId: next.consentId }, "b");
    const result = await reserve(f, "cannot-reset", { model: { provider: next.model.provider, id: next.model.modelId } });
    assert.equal(result.reason, "recall_budget_binding_changed");
    assert.equal(auth.readRecallBudget(enable.budgetId, f).used, 1);
  }
});

test("losing the accounting ledger never bootstraps a fresh budget, including after stop/re-enable", async t => {
  const f = fixture(t), initial = await setup(f); await capture(f);
  assert.equal((await reserve(f, "before-ledger-loss")).permitted, true);
  fs.unlinkSync(ledgerFile(f));
  assert.equal((await reserve(f, "after-ledger-loss")).reason, "recall_storage_unavailable");
  await assert.rejects(auth.prepareRecallIntent(intentInput({ clientRequestId: "cannot-reset" }), f, approved),
    errorCode("recall_storage_unavailable"));
  const stopped = await config.writeEduPiRecallConfig({ enabled: false }, { ...f, expectedUpdatedAt: initial.updatedAt });
  assert.equal(stopped.authorizationInitialized, true);
  await assert.rejects(config.writeEduPiRecallConfig(enable, { ...f, expectedUpdatedAt: stopped.updatedAt }, approved),
    errorCode("recall_storage_unavailable"));
  assert.equal(fs.existsSync(ledgerFile(f)), false);
  assert.equal(config.readEduPiRecallConfig(f, approved).enabled, false);
});

test("a grant expiring while waiting for the interprocess lock cannot receive a late dispatch permit", async t => {
  const f = fixture(t), validUntil = new Date(Date.now() + 1_000).toISOString();
  const live = { ...f, now: undefined };
  await setup(live, { validUntil }); await capture(live);
  const release = await lockfile.lock(f.stateDir, {
    realpath: false, lockfilePath: path.join(f.stateDir, ".edupi-recall-mutation.lock"),
  });
  let pending;
  try {
    assert.ok(Date.now() < Date.parse(validUntil));
    pending = reserve(live, "expired-in-lock-queue");
    await new Promise(resolve => setTimeout(resolve, Math.max(0, Date.parse(validUntil) - Date.now() + 20)));
  } finally { await release(); }
  assert.equal((await pending).reason, "recall_inactive");
  assert.equal(auth.readRecallBudget(enable.budgetId, f), null);
});

test("same raw text across two captures is ambiguous unless an exact intentId is supplied", async t => {
  const f = fixture(t); await setup(f); const first = await capture(f);
  await capture(f, { sessionId: "second-session", clientRequestId: "second-client" }, "b");
  assert.equal((await reserve(f, "ambiguous")).reason, "recall_intent_ambiguous");
  assert.equal((await reserve(f, "exact", { intentId: first.intentId })).permitted, true);
});

test("bad/foreign/G1 ledger cannot authorize, be reset, or overwrite another root", async t => {
  const f = fixture(t); await setup(f); await capture(f);
  const goodBytes = fs.readFileSync(ledgerFile(f), "utf8");
  const otherData = path.join(f.root, "other-data"); fs.mkdirSync(otherData, { mode: 0o700 });
  assert.equal((await reserve({ ...f, dataRoot: otherData }, "foreign")).permitted, false);
  assert.equal(fs.readFileSync(ledgerFile(f), "utf8"), goodBytes);
  const corruptions = ["{broken", "null", '{"kind":"g1_outbox","budgets":[],"intents":[],"attempts":[]}',
    JSON.stringify({ ...JSON.parse(goodBytes), dataRootHash: queryHash("other-root") })];
  for (const bytes of corruptions) {
    fs.writeFileSync(ledgerFile(f), bytes, { mode: 0o600 });
    assert.equal((await reserve(f, "invalid-ledger")).permitted, false);
    assert.equal(auth.readRecallIntent({ sessionId: "session-test", clientRequestId: "client-test" }, f, approved).reason, "invalid");
    await assert.rejects(auth.prepareRecallIntent(intentInput(), f, approved), errorCode("recall_storage_unavailable"));
    assert.equal(fs.readFileSync(ledgerFile(f), "utf8"), bytes);
  }
});

test("ledger symlink and public permissions fail closed with no external writes", async t => {
  const f = fixture(t); await setup(f); await capture(f);
  const outside = path.join(f.root, "outside.json"), bytes = fs.readFileSync(ledgerFile(f), "utf8");
  fs.writeFileSync(outside, bytes, { mode: 0o600 }); fs.unlinkSync(ledgerFile(f)); fs.symlinkSync(outside, ledgerFile(f));
  assert.equal((await reserve(f, "symlink")).permitted, false);
  await assert.rejects(auth.revokeRecallIntent({ sessionId: "session-test", clientRequestId: "client-test" }, f), errorCode("recall_storage_unavailable"));
  assert.equal(fs.readFileSync(outside, "utf8"), bytes);
  fs.unlinkSync(ledgerFile(f)); fs.writeFileSync(ledgerFile(f), bytes, { mode: 0o644 });
  assert.equal((await reserve(f, "public-file")).permitted, false);
  assert.equal(fs.readFileSync(ledgerFile(f), "utf8"), bytes);
});

test("failed durable reservation never returns a permit, and uncertain writes remain counted", async t => {
  const f = fixture(t); await setup(f); await capture(f);
  const original = fs.fsyncSync;
  try {
    fs.fsyncSync = fd => {
      if (fs.fstatSync(fd).isDirectory()) throw new Error("synthetic_directory_sync_failure");
      return original(fd);
    };
    assert.equal((await reserve(f, "uncertain-write")).permitted, false);
  } finally { fs.fsyncSync = original; }
  assert.equal(auth.readRecallBudget(enable.budgetId, f).used, 1);
  assert.equal((await reserve(f, "uncertain-write")).reason, "recall_request_replayed");
  assert.equal(fs.readdirSync(f.stateDir).some(name => name.endsWith(".tmp") || name.endsWith(".lock")), false);
});
