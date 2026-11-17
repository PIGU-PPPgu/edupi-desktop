import assert from "node:assert/strict";
import crypto from "node:crypto";
import { execFile } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import test from "node:test";
import { promisify } from "node:util";
import { createJiti } from "jiti";

const config = await createJiti(import.meta.url, { fsCache: false }).import("./edupi-recall-config.ts");
const approved = { approveNormal: () => true };
const canary = { EDUPI_CORE_RECALL_ANSWERS: "1", EDUPI_DESKTOP_ISOLATED_CANARY: "1" };
const now = "2026-11-18T00:00:00.000Z";
const enable = {
  enabled: true, purpose: "r04_recall_answer", ownerId: "r04-test-owner", grantId: "r04_recall_aabbcc",
  grantVersion: 1, scope: { classId: "class-test", subject: "数学", termId: "term-test" },
  model: { provider: "test-provider", modelId: "test-model" }, budgetId: "r04_recall_budget_aabbcc",
  limit: 3, validUntil: "2026-11-19T00:00:00.000Z", consentId: "r04-consent-test",
};
function fixture(t) {
  const root = fs.realpathSync(fs.mkdtempSync("/tmp/edupi-r04-config-test-"));
  const stateDir = path.join(root, "state"), dataRoot = path.join(root, "data");
  fs.mkdirSync(stateDir, { mode: 0o700 }); fs.mkdirSync(dataRoot, { mode: 0o700 });
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  return { root, stateDir, dataRoot, env: {}, now };
}
const file = f => path.join(f.stateDir, "edupi-recall-config.json");
const cas = (f, expectedUpdatedAt = null) => ({ ...f, expectedUpdatedAt });
const errorCode = code => error => error?.code === code;
const workerSource = `
import { createJiti } from "jiti";
const [modulePath, options] = process.argv.slice(1);
const c = await createJiti(import.meta.url, { fsCache: false }).import(modulePath);
try { const value = await c.writeEduPiRecallConfig({enabled:false}, JSON.parse(options)); console.log(JSON.stringify({ok:true,value})); }
catch (error) { console.log(JSON.stringify({ok:false,code:error.code})); }
`;
const runWorker = async (options) => {
  const { stdout } = await promisify(execFile)(process.execPath,
    ["--input-type=module", "-e", workerSource, path.resolve("lib/edupi-recall-config.ts"), JSON.stringify(options)],
    { cwd: process.cwd(), timeout: 15_000, maxBuffer: 32_768 });
  return JSON.parse(stdout);
};

test("normal is source-gated; only the two explicit isolated canary flags preserve missing-config QA", t => {
  const f = fixture(t);
  assert.equal(config.EDUPI_RECALL_NORMAL_RELEASE_APPROVED, false);
  assert.deepEqual(config.readEduPiRecallActivation(f), { mode: "off", enabled: false, reason: "missing", config: null });
  for (const env of [{ EDUPI_CORE_RECALL_ANSWERS: "1" }, { EDUPI_DESKTOP_ISOLATED_CANARY: "1" },
    { EDUPI_RECALL_NORMAL_APPROVED: "1" }]) {
    assert.equal(config.readEduPiRecallActivation({ ...f, env }).enabled, false);
  }
  assert.deepEqual(config.readEduPiRecallActivation({ ...f, env: canary }),
    { mode: "canary", enabled: true, reason: "ready", config: null });
  assert.equal(config.readEduPiRecallActivation({ ...f, env: { ...canary, EDUPI_SAFE_MODE: "yes" } }).reason, "safe_mode");
  assert.deepEqual(fs.readdirSync(f.stateDir), [], "reads create no config or grant");
});

test("client approval never opens normal or writes future enabled:true; stop defeats old canary independently of G1", async t => {
  const f = fixture(t);
  const g1 = path.join(f.stateDir, "edupi-proactivity.json");
  const g1Bytes = '{"synthetic_g1":"untouched","enabled":true}\n';
  fs.writeFileSync(g1, g1Bytes, { mode: 0o600 });
  await assert.rejects(config.writeEduPiRecallConfig(enable, { ...cas(f), normalApproved: false }),
    errorCode("recall_normal_not_approved"));
  await assert.rejects(config.writeEduPiRecallConfig({ ...enable, normalApproved: true }, cas(f)),
    errorCode("recall_invalid_input"));
  await assert.rejects(config.writeEduPiRecallConfig(enable, { ...cas(f), normalApproved: true }, approved),
    errorCode("recall_invalid_input"));
  await assert.rejects(config.writeEduPiRecallConfig(enable, { ...cas(f), env: { ...canary, EDUPI_RECALL_NORMAL_APPROVED: "1" } }),
    errorCode("recall_normal_not_approved"));
  assert.equal(fs.existsSync(file(f)), false);
  const stopped = await config.writeEduPiRecallConfig({ enabled: false }, cas(f));
  assert.equal(stopped.enabled, false);
  assert.equal(config.readEduPiRecallActivation({ ...f, env: canary }).reason, "stopped");
  assert.equal(config.readEduPiRecallConfig({ ...f, env: canary }).enabled, false);
  assert.equal(JSON.parse(fs.readFileSync(file(f), "utf8")).enabled, false);
  assert.equal(fs.readFileSync(g1, "utf8"), g1Bytes);
  await assert.rejects(config.writeEduPiRecallConfig(enable, cas(f, stopped.updatedAt)),
    errorCode("recall_normal_not_approved"));
  assert.equal(JSON.parse(fs.readFileSync(file(f), "utf8")).enabled, false);
});

test("explicit server test dependency exercises normal with private root hash and atomic readback", async t => {
  const f = fixture(t), written = await config.writeEduPiRecallConfig(enable, cas(f), approved);
  assert.equal(written.enabled, true);
  assert.equal(written.dataRootHash, `sha256:${crypto.createHash("sha256").update(f.dataRoot).digest("hex")}`);
  assert.deepEqual(JSON.parse(fs.readFileSync(file(f), "utf8")), written);
  assert.equal(fs.statSync(file(f)).mode & 0o777, 0o600);
  assert.deepEqual(fs.readdirSync(f.stateDir).sort(), ["edupi-recall-authorization.json", "edupi-recall-config.json"]);
  assert.equal(config.readEduPiRecallConfig(f).enabled, false, "persisted enabled is not authority");
  assert.equal(config.readEduPiRecallActivation({ ...f, env: canary }).reason, "normal_not_approved");
  assert.equal(config.readEduPiRecallActivation(f, approved).mode, "normal");
  assert.equal(config.readEduPiRecallActivation({ ...f, env: { EDUPI_SAFE_MODE: "true" } }, approved).enabled, false);
  assert.equal(config.readEduPiRecallActivation({ ...f, now: written.validUntil }, approved).reason, "expired");
  assert.match(config.eduPiRecallConversationId(enable.scope, f), /^edupi\.desktop\.recall\.[a-f0-9]{64}$/u);
  assert.notEqual(config.eduPiRecallConversationId(enable.scope, f),
    config.eduPiRecallConversationId({ ...enable.scope, termId: "other-term" }, f));
});

test("complete explicit R04 bindings and limits 1..12 are required; legacy/G1 fields never authorize", async t => {
  const f = fixture(t);
  const invalid = [
    { ...enable, limit: undefined }, { ...enable, limit: 0 }, { ...enable, limit: 13 }, { ...enable, limit: 64 },
    { ...enable, limit: 1.5 }, { ...enable, grantId: "desktop_canary_123" },
    { ...enable, grantId: "g1-grant" }, { ...enable, budgetId: "g1-budget" },
    { ...enable, purpose: "teaching_preparation" }, { ...enable, grantVersion: 0 },
    { ...enable, mode: "canary" },
    { ...enable, ownerId: "" }, { ...enable, scope: { classId: "class-test", subject: "" } },
    { ...enable, scope: { ...enable.scope, extra: true } }, { ...enable, model: { provider: "test-provider" } },
    { ...enable, consentId: "" }, { ...enable, validUntil: "tomorrow" },
  ];
  for (const input of invalid) {
    await assert.rejects(config.writeEduPiRecallConfig(input, cas(f), approved), errorCode("recall_invalid_input"));
  }
  await assert.rejects(config.writeEduPiRecallConfig(enable, f, approved), errorCode("recall_invalid_input"));
  await assert.rejects(config.writeEduPiRecallConfig(enable, { ...cas(f), now: enable.validUntil }, approved), errorCode("recall_inactive"));
  assert.equal(fs.existsSync(file(f)), false);
  for (const limit of [1, 12]) {
    const previous = config.readEduPiRecallConfig(f).config?.updatedAt ?? null;
    await config.writeEduPiRecallConfig({ ...enable, limit }, cas(f, previous), approved);
  }
});

test("CAS is serialized across two cold OS writers, and same-millisecond stop advances revision", async t => {
  const f = fixture(t);
  const results = await Promise.all([runWorker(cas(f)), runWorker(cas(f))]);
  assert.equal(results.filter(result => result.ok).length, 1);
  assert.equal(results.find(result => !result.ok).code, "recall_config_conflict");
  const previous = config.readEduPiRecallConfig(f).config;
  const next = await config.writeEduPiRecallConfig({ enabled: false }, cas(f, previous.updatedAt));
  assert.equal(Date.parse(next.updatedAt), Date.parse(previous.updatedAt) + 1);
  await assert.rejects(config.writeEduPiRecallConfig({ enabled: false }, cas(f, previous.updatedAt)),
    errorCode("recall_config_conflict"));
  assert.equal(config.readEduPiRecallConfig(f).config.updatedAt, next.updatedAt);
});

test("normal approval is checked again under lock and client objects cannot change during the wait", async t => {
  const f = fixture(t);
  let allow = true;
  const pending = config.writeEduPiRecallConfig(enable, cas(f), { approveNormal: () => allow });
  allow = false;
  await assert.rejects(pending, errorCode("recall_normal_not_approved"));
  assert.equal(fs.existsSync(file(f)), false);
  const input = structuredClone(enable), options = cas(f);
  const committed = config.writeEduPiRecallConfig(input, options, approved);
  input.limit = 64; input.model.modelId = "changed-while-waiting";
  options.expectedUpdatedAt = "2026-11-17T00:00:00.000Z";
  assert.equal((await committed).limit, enable.limit);
  assert.equal(config.readEduPiRecallConfig(f, approved).config.model.modelId, enable.model.modelId);
});

test("foreign/corrupt/old config fails closed even with canary; writes do not repair or overwrite it", async t => {
  const f = fixture(t);
  const written = await config.writeEduPiRecallConfig(enable, cas(f), approved);
  const otherData = path.join(f.root, "other-data");
  fs.mkdirSync(otherData, { mode: 0o700 });
  const before = fs.readFileSync(file(f), "utf8");
  assert.equal(config.readEduPiRecallActivation({ ...f, dataRoot: otherData, env: canary }, approved).reason, "root_mismatch");
  await assert.rejects(config.writeEduPiRecallConfig({ enabled: false },
    { ...cas(f, written.updatedAt), dataRoot: otherData }), errorCode("recall_storage_unavailable"));
  assert.equal(fs.readFileSync(file(f), "utf8"), before);
  for (const malformed of ["{broken", "null", "[]", '{"version":0,"enabled":true}', Buffer.from([0xff, 0xfe])]) {
    fs.writeFileSync(file(f), malformed, { mode: 0o600 });
    assert.equal(config.readEduPiRecallActivation({ ...f, env: canary }, approved).reason, "invalid");
    await assert.rejects(config.writeEduPiRecallConfig({ enabled: false }, cas(f)), errorCode("recall_storage_unavailable"));
  }
});

test("state/data roots, ancestors, files, hardlinks and lock symlinks are refused without touching targets", async t => {
  const f = fixture(t), outside = path.join(f.root, "outside.json");
  fs.writeFileSync(outside, '{"outside":"synthetic"}', { mode: 0o600 });
  const outsideBefore = fs.readFileSync(outside, "utf8");
  const linkedState = path.join(f.root, "state-link"), linkedData = path.join(f.root, "data-link");
  const ancestor = path.join(f.root, "ancestor-link");
  fs.symlinkSync(f.stateDir, linkedState); fs.symlinkSync(f.dataRoot, linkedData); fs.symlinkSync(f.root, ancestor);
  for (const options of [
    { ...f, stateDir: linkedState }, { ...f, dataRoot: linkedData },
    { ...f, stateDir: path.join(ancestor, "state") }, { ...f, stateDir: "relative" },
  ]) {
    assert.equal(config.readEduPiRecallActivation({ ...options, env: canary }, approved).enabled, false);
    await assert.rejects(config.writeEduPiRecallConfig({ enabled: false }, { ...options, expectedUpdatedAt: null }),
      errorCode("recall_storage_unavailable"));
  }
  fs.symlinkSync(outside, file(f));
  assert.equal(config.readEduPiRecallActivation({ ...f, env: canary }, approved).enabled, false);
  await assert.rejects(config.writeEduPiRecallConfig({ enabled: false }, cas(f)), errorCode("recall_storage_unavailable"));
  fs.unlinkSync(file(f)); fs.linkSync(outside, file(f));
  assert.equal(config.readEduPiRecallActivation({ ...f, env: canary }, approved).enabled, false);
  await assert.rejects(config.writeEduPiRecallConfig({ enabled: false }, cas(f)), errorCode("recall_storage_unavailable"));
  fs.unlinkSync(file(f));
  fs.symlinkSync(f.dataRoot, path.join(f.stateDir, ".edupi-recall-mutation.lock"));
  await assert.rejects(config.writeEduPiRecallConfig({ enabled: false }, cas(f)), errorCode("recall_storage_unavailable"));
  assert.equal(fs.readFileSync(outside, "utf8"), outsideBefore);
  assert.deepEqual(fs.readdirSync(f.dataRoot), []);
});

test("public permissions on root or file deny activation; PI_DESKTOP_STATE_DIR is the only default state location", async t => {
  const f = fixture(t);
  const previous = process.env.PI_DESKTOP_STATE_DIR;
  process.env.PI_DESKTOP_STATE_DIR = f.stateDir;
  try {
    const options = { dataRoot: f.dataRoot, now, env: {}, expectedUpdatedAt: null };
    await config.writeEduPiRecallConfig(enable, options, approved);
    assert.equal(config.readEduPiRecallConfig(options, approved).enabled, true);
  } finally {
    if (previous === undefined) delete process.env.PI_DESKTOP_STATE_DIR;
    else process.env.PI_DESKTOP_STATE_DIR = previous;
  }
  fs.chmodSync(file(f), 0o644);
  assert.equal(config.readEduPiRecallActivation({ ...f, env: canary }, approved).enabled, false);
  fs.chmodSync(file(f), 0o600); fs.chmodSync(f.stateDir, 0o755);
  assert.equal(config.readEduPiRecallActivation({ ...f, env: canary }, approved).enabled, false);
  fs.chmodSync(f.stateDir, 0o700); fs.chmodSync(f.dataRoot, 0o755);
  assert.equal(config.readEduPiRecallActivation({ ...f, env: canary }, approved).enabled, false);
});

test("failed directory fsync or mismatching atomic readback is not acknowledged", async t => {
  const f = fixture(t), originalSync = fs.fsyncSync, originalRename = fs.renameSync;
  try {
    fs.fsyncSync = fd => {
      if (fs.fstatSync(fd).isDirectory()) throw new Error("synthetic_directory_fsync");
      return originalSync(fd);
    };
    await assert.rejects(config.writeEduPiRecallConfig({ enabled: false }, cas(f)), errorCode("recall_storage_unavailable"));
    fs.fsyncSync = originalSync;
    const previous = config.readEduPiRecallConfig(f).config;
    fs.renameSync = (source, destination) => {
      originalRename(source, destination);
      const value = JSON.parse(fs.readFileSync(destination, "utf8"));
      value.updatedAt = "2026-11-18T00:00:10.000Z";
      fs.writeFileSync(destination, JSON.stringify(value), { mode: 0o600 });
    };
    await assert.rejects(config.writeEduPiRecallConfig({ enabled: false }, cas(f, previous.updatedAt)),
      errorCode("recall_storage_unavailable"));
  } finally { fs.fsyncSync = originalSync; fs.renameSync = originalRename; }
  assert.equal(fs.readdirSync(f.stateDir).some(name => name.endsWith(".tmp") || name.endsWith(".lock")), false);
});
