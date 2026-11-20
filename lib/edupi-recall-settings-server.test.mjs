import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import test from "node:test";
import { createJiti } from "jiti";

const jiti = createJiti(import.meta.url, { tsconfigPaths: true, fsCache: false });
const server = await jiti.import("./edupi-recall-settings-server.ts");
const config = await jiti.import("./edupi-recall-config.ts");
const authorization = await jiti.import("./edupi-recall-authorization.ts");
const now = "2026-11-18T00:00:00.000Z";
const rootRef = `sha256:${"8".repeat(64)}`; // deliberately unrelated to the path hash
const approved = { approveNormal: () => true };
const enable = { enabled: true, expectedUpdatedAt: null, scope: { classId: "synthetic-class", subject: "数学" },
  model: { provider: "synthetic-provider", modelId: "synthetic-model" }, limit: 3, validUntil: "2026-11-19T00:00:00.000Z" };

function fixture(t, { approval = true, owner = "synthetic-owner", env = {} } = {}) {
  const root = fs.realpathSync(fs.mkdtempSync("/tmp/edupi-r04-settings-server-"));
  fs.chmodSync(root, 0o700);
  const options = { dataRoot: path.join(root, "data"), stateDir: path.join(root, "state"), env, now };
  for (const dir of [options.dataRoot, options.stateDir]) fs.mkdirSync(dir, { mode: 0o700 });
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const events = [], grants = new Map();
  const failures = { restart: false, pause: false, createReceipt: false, beforeCreate: null, afterCreate: null,
    model: false, foreignRoot: false, unknownStop: false };
  let ownerId = owner;
  const host = {
    dataRootFingerprint: rootRef,
    get recallAnswersActive() { return failures.unknownStop ? undefined : config.readEduPiRecallConfig(options, approved).enabled; },
    async call(operation, payload) {
      events.push({ operation, payload: structuredClone(payload) });
      if (operation === "health") return { ok: true, result: { data_root_fingerprint: rootRef } };
      assert.equal(operation, "owner_read");
      assert.equal(payload.root_ref, rootRef);
      return { ok: true, result: { root_ref: rootRef, owner: ownerId ? {
        id: ownerId, root_ref: failures.foreignRoot ? `sha256:${"9".repeat(64)}` : rootRef,
      } : null, grants: structuredClone([...grants.values()]) } };
    },
    async callOwnerControl(operation, payload) {
      events.push({ operation, payload: structuredClone(payload) });
      assert.equal(operation, "owner_control");
      assert.equal(payload.root_ref, rootRef);
      if (payload.action === "bootstrap") {
        assert.equal(payload.expected_owner_id, null); ownerId = "synthetic-bootstrap-owner";
        return { ok: true, result: { owner_id: ownerId, grant_id: null, grant_version: null } };
      }
      assert.equal(payload.expected_owner_id, ownerId);
      if (payload.action === "create") {
        await failures.beforeCreate?.();
        assert.equal(payload.expected_version, 0);
        grants.set(payload.grant_id, { id: payload.grant_id, version: 1, status: "active", ...structuredClone(payload.spec) });
        await failures.afterCreate?.();
        if (failures.createReceipt) throw new Error("lost_create_receipt");
      } else {
        assert.equal(payload.action, "pause");
        if (failures.pause) throw new Error("lost_pause_result");
        const grant = grants.get(payload.grant_id);
        assert.equal(grant.version, payload.expected_version);
        grant.version++; grant.status = "paused";
      }
      const grant = grants.get(payload.grant_id);
      return { ok: true, result: { owner_id: ownerId, grant_id: grant.id, grant_version: grant.version } };
    },
  };
  const deps = { options: () => options, runtime: async () => { events.push({ operation: "runtime" }); return host; },
    restartRoot: async () => {
      events.push({ operation: "restart", activation: config.readEduPiRecallConfig(options, approved).enabled });
      if (failures.restart) { failures.restart = false; throw new Error("lost_restart_result"); }
      return host;
    },
    preflightModel: async () => {
      events.push({ operation: "model" });
      return failures.model ? { ...enable.model, modelId: "different" } : enable.model;
    },
    ...(approval ? approved : {}) };
  const service = server.createEduPiRecallSettingsService(deps);
  return { options, root, service, deps, events, grants, failures, host,
    setOwner: value => { ownerId = value; },
    saved: () => config.readEduPiRecallConfig(options, approved).config };
}
const code = expected => error => error?.code === expected;

test("source gate rejects normal before model/Core/Profile or a future true write", async t => {
  const f = fixture(t, { approval: false });
  assert.equal(config.EDUPI_RECALL_NORMAL_RELEASE_APPROVED, false);
  await assert.rejects(f.service.update(enable), code("recall_normal_not_approved"));
  assert.deepEqual(f.events, []);
  const discoveryForbidden = server.createEduPiRecallSettingsService({
    options() { assert.fail("source gate must precede Core/root/profile discovery"); },
  });
  await assert.rejects(discoveryForbidden.update(enable), code("recall_normal_not_approved"));
  assert.deepEqual(fs.readdirSync(f.options.stateDir), []);
  for (const extra of ["normalApproved", "approveNormal", "ownerId", "grantId", "budgetId", "consentId"]) {
    await assert.rejects(f.service.update({ ...enable, [extra]: true }), code("recall_invalid_input"));
  }
  assert.deepEqual(f.events, []);
});

test("approved server writes independent exact grant then config then restart; sanitized read has no credentials", async t => {
  const f = fixture(t);
  const response = await f.service.update(enable), saved = f.saved();
  assert.equal(response.activation.mode, "normal");
  assert.equal(response.activation.enabled, true);
  assert.equal(response.normalApproved, true);
  assert.deepEqual(response.config, { enabled: true, scope: enable.scope, model: enable.model, limit: 3,
    used: 0, remaining: 3, validUntil: enable.validUntil, updatedAt: saved.updatedAt });
  const grant = f.grants.get(saved.grantId);
  assert.match(saved.grantId, /^r04_recall_[a-f0-9]+$/u);
  assert.match(saved.budgetId, /^r04_recall_budget_[a-f0-9]+$/u);
  assert.deepEqual(grant.actions, ["prepare"]);
  assert.deepEqual(grant.domains, ["teaching_preparation"]);
  assert.deepEqual(grant.scope, { class_id: enable.scope.classId, subject: enable.scope.subject });
  assert.deepEqual(grant.budget, { id: saved.budgetId, max_calls: 3 });
  assert.deepEqual(grant.source_ids, server.recallGrantSpec(enable.scope, f.options, saved.budgetId, 3, enable.validUntil).source_ids);
  assert.notEqual(rootRef, saved.dataRootHash, "Core root_ref must not be fabricated from the path hash");
  const createIndex = f.events.findIndex(event => event.payload?.action === "create");
  const restartIndex = f.events.findIndex(event => event.operation === "restart");
  assert.ok(createIndex > f.events.findIndex(event => event.operation === "model"));
  assert.ok(restartIndex > createIndex);
  assert.equal(f.events[restartIndex].activation, true);
  assert.deepEqual(await f.service.get(), response);
  assert.equal(fs.statSync(path.join(f.options.stateDir, "edupi-recall-config.json")).mode & 0o777, 0o600);
  for (const privateText of [saved.ownerId, saved.grantId, saved.budgetId, saved.consentId, rootRef]) {
    assert.equal(JSON.stringify(response).includes(privateText), false);
  }
});

test("settings projects persisted unknown model reservations without spending on reads or accepting a changed budget binding", async t => {
  const f = fixture(t);
  await f.service.update(enable);
  const current = f.saved(), rawQuery = "合成计数问题";
  const intent = await authorization.prepareRecallIntent({ sessionId: "synthetic-session", clientRequestId: "synthetic-budget-request",
    rawQuery, ownerId: current.ownerId, grantId: current.grantId, grantVersion: current.grantVersion,
    scope: current.scope, configConsentId: current.consentId }, f.options, approved);
  const messageRef = `owner_message:${"a".repeat(64)}`;
  await authorization.markCapturedRecallIntent({ intentId: intent.intentId, messageRef,
    registration: { messageRef, producerEpoch: "b".repeat(64), sequence: 1, fencingGeneration: 1, instanceNonce: "synthetic-instance" },
  }, f.options, approved);
  assert.equal((await f.service.get()).config.used, 0);
  const permit = await authorization.reserveRecallModelAttempt({ requestId: "synthetic-IPC-id", intentId: intent.intentId,
    rawQuery, model: { provider: enable.model.provider, id: enable.model.modelId } }, f.options, approved);
  assert.equal(permit.permitted, true);
  for (let i = 0; i < 2; i++) {
    const read = await f.service.get();
    assert.equal(read.config.used, 1);
    assert.equal(read.config.remaining, 2);
  }
  const input = Object.fromEntries(Object.entries(current).filter(([key]) =>
    !["kind", "version", "dataRootHash", "updatedAt", "authorizationInitialized"].includes(key)));
  await config.writeEduPiRecallConfig({ ...input, consentId: "synthetic-changed-consent" },
    { ...f.options, expectedUpdatedAt: current.updatedAt }, approved);
  const changed = await f.service.get();
  assert.equal(changed.activation.enabled, false);
  assert.equal(changed.activation.reason, "invalid");
  assert.equal(changed.config.used, null);
  assert.equal(changed.config.remaining, null);
});

test("only explicit bounded scope/model/limit/expiry and exact expectedUpdatedAt are accepted", async t => {
  const f = fixture(t);
  for (const change of [{ limit: 0 }, { limit: 13 }, { limit: 1.5 }, { scope: null }, { model: null },
    { validUntil: now }, { validUntil: "2026-11-25T00:00:00.001Z" }, { expectedUpdatedAt: undefined },
    { validUntil: "2026-11-19" }, { scope: { ...enable.scope, unexpected: true } },
    { scope: { ...enable.scope, termId: "client-selected-term" } }]) {
    await assert.rejects(f.service.update({ ...enable, ...change }), code("recall_invalid_input"));
  }
  assert.deepEqual(f.events, []);
  f.failures.model = true;
  await assert.rejects(f.service.update(enable), code("recall_model_mismatch"));
  assert.deepEqual(f.events.map(event => event.operation), ["model"]);
  assert.equal(f.saved(), null);
  f.failures.model = false;
  const response = await f.service.update({ ...enable, validUntil: "2026-11-25T00:00:00.000Z", limit: 12 });
  const before = fs.readFileSync(path.join(f.options.stateDir, "edupi-recall-config.json"), "utf8");
  const length = f.events.length;
  await assert.rejects(f.service.update({ enabled: false, expectedUpdatedAt: null }), code("recall_config_conflict"));
  assert.equal(f.events.length, length);
  assert.equal(fs.readFileSync(path.join(f.options.stateDir, "edupi-recall-config.json"), "utf8"), before);
  assert.ok(response.config.updatedAt);
});

test("stop writes an independent fence, revokes intents across cold reads and never mutates G1", async t => {
  const f = fixture(t, { env: { EDUPI_CORE_RECALL_ANSWERS: "1", EDUPI_DESKTOP_ISOLATED_CANARY: "1" } });
  const g1Id = "desktop_canary_v2_synthetic", g1 = { id: g1Id, version: 7, status: "active", ends_at: enable.validUntil };
  f.grants.set(g1Id, structuredClone(g1));
  const g1File = path.join(f.options.stateDir, "edupi-proactivity.json");
  fs.writeFileSync(g1File, '{"syntheticG1":"unchanged"}', { mode: 0o600 });
  await f.service.update(enable);
  const configBefore = f.saved();
  const intent = await authorization.prepareRecallIntent({ sessionId: "synthetic-session", clientRequestId: "synthetic-request",
    rawQuery: "  合成原文\n", ownerId: configBefore.ownerId, grantId: configBefore.grantId,
    grantVersion: configBefore.grantVersion, scope: configBefore.scope, configConsentId: configBefore.consentId }, f.options, approved);
  const stopped = await f.service.update({ enabled: false, expectedUpdatedAt: configBefore.updatedAt });
  assert.equal(stopped.activation.enabled, false);
  assert.equal(stopped.activation.reason, "stopped");
  assert.deepEqual(stopped.stop, { status: "stopped", grants: "paused" });
  assert.equal(f.grants.get(configBefore.grantId).status, "paused");
  assert.deepEqual(f.grants.get(g1Id), g1);
  assert.equal(fs.readFileSync(g1File, "utf8"), '{"syntheticG1":"unchanged"}');
  assert.equal(authorization.readRecallIntent({ intentId: intent.intentId }, f.options, approved).usable, false);
  const cold = server.createEduPiRecallSettingsService({ ...f.deps });
  assert.equal((await cold.get()).activation.enabled, false);
  assert.equal(config.readEduPiRecallConfig(f.options).enabled, false);
});

test("stop remains available with source gate false; uncertain Core stop is never reported stopped", async t => {
  const f = fixture(t, { approval: false, env: { EDUPI_CORE_RECALL_ANSWERS: "1", EDUPI_DESKTOP_ISOLATED_CANARY: "1" } });
  assert.equal((await f.service.get()).activation.mode, "canary");
  f.failures.unknownStop = true;
  const response = await f.service.update({ enabled: false, expectedUpdatedAt: null });
  assert.equal(response.config.enabled, false);
  assert.equal(response.stop.status, "unknown");
  assert.equal(f.saved().enabled, false);
  assert.equal((await f.service.get()).activation.reason, "stopped");
});

test("approved first enable uses Core bootstrap and refuses a foreign owner root", async t => {
  const fresh = fixture(t, { owner: null });
  await fresh.service.update(enable);
  assert.equal(fresh.events.filter(event => event.payload?.action === "bootstrap").length, 1);
  const foreign = fixture(t);
  foreign.failures.foreignRoot = true;
  await assert.rejects(foreign.service.update(enable), code("recall_owner_invalid"));
  assert.equal(foreign.events.some(event => event.payload?.action === "create"), false);
});

test("failed restart rolls config off and pauses only the newly created grant", async t => {
  const f = fixture(t);
  f.failures.restart = true;
  await assert.rejects(f.service.update(enable), /lost_restart_result/u);
  assert.equal(f.saved().enabled, false);
  assert.equal(f.grants.size, 1);
  assert.equal([...f.grants.values()][0].status, "paused");
  assert.equal((await f.service.get()).activation.enabled, false);
});

test("lost create receipt persists a stop fence and recovers only its own independent R04 grant", async t => {
  const f = fixture(t);
  f.failures.createReceipt = true;
  await assert.rejects(f.service.update(enable), /lost_create_receipt/u);
  assert.equal(f.saved().enabled, false);
  assert.equal([...f.grants.values()][0].status, "paused");
});

test("a failed R04 grant pause remains unknown even if the replacement host reports recall off", async t => {
  const f = fixture(t);
  await f.service.update(enable);
  f.failures.pause = true;
  const response = await f.service.update({ enabled: false, expectedUpdatedAt: f.saved().updatedAt });
  assert.equal(response.activation.enabled, false);
  assert.deepEqual(response.stop, { status: "unknown", grants: "unknown" });
  assert.equal([...f.grants.values()][0].status, "active");
});

test("stopping uses the real supervisor resident after identity changes, then closes it before off restart", async t => {
  const f = fixture(t);
  await f.service.update(enable);
  const supervisor = await jiti.import("./edupi-runtime-supervisor.ts");
  const entries = globalThis.__edupiRuntimeSupervisors;
  let closed = false;
  const resident = { ...f.host, close: async () => { closed = true; } };
  const entry = { identity: "old-enabled-identity", handle: resident, startup: Promise.resolve(resident) };
  entries.set(f.options.dataRoot, entry);
  t.after(() => { if (entries.get(f.options.dataRoot) === entry) entries.delete(f.options.dataRoot); });
  const deps = { ...f.deps,
    resident: async options => {
      assert.equal(f.saved().enabled, false);
      await assert.rejects(supervisor.ensureEduPiRuntime({ runtime: { root: "synthetic" },
        dataRoot: { root: options.dataRoot } }), { code: "runtime_unavailable" });
      return supervisor.getActiveEduPiRuntime(options.dataRoot);
    },
    restartRoot: async options => {
      await supervisor.quarantineEduPiRuntime(options.dataRoot, { requireClosed: true });
      supervisor.clearEduPiRuntimeQuarantine(options.dataRoot);
      assert.equal(closed, true);
      assert.equal(f.saved().enabled, false);
      return f.host;
    },
  };
  const before = f.events.length;
  const result = await server.createEduPiRecallSettingsService(deps).update({ enabled: false, expectedUpdatedAt: f.saved().updatedAt });
  assert.deepEqual(result.stop, { status: "stopped", grants: "paused" });
  assert.equal(f.events.slice(before).some(event => event.operation === "runtime" || event.operation === "model"), false);
});

test("stop rejects a foreign resident fingerprint or owner without pausing its grants", async t => {
  for (const mismatch of ["root", "owner", "scope"]) {
    const f = fixture(t);
    await f.service.update(enable);
    if (mismatch === "owner") f.setOwner("other-owner");
    if (mismatch === "scope") [...f.grants.values()][0].scope.class_id = "other-class";
    const resident = mismatch === "root" ? { ...f.host, dataRootFingerprint: `sha256:${"9".repeat(64)}` } : f.host;
    const result = await server.createEduPiRecallSettingsService({ ...f.deps, resident: async () => resident })
      .update({ enabled: false, expectedUpdatedAt: f.saved().updatedAt });
    assert.deepEqual(result.stop, { status: "unknown", grants: "unknown" });
    assert.equal([...f.grants.values()][0].status, "active");
    assert.equal(f.saved().enabled, false);
  }
});

test("without a resident the stopped replacement is started once before Core pause", async t => {
  const f = fixture(t);
  await f.service.update(enable);
  let restarts = 0;
  const service = server.createEduPiRecallSettingsService({ ...f.deps, resident: async () => null,
    restartRoot: async () => {
      assert.equal(f.saved().enabled, false);
      restarts++;
      return f.host;
    } });
  const result = await service.update({ enabled: false, expectedUpdatedAt: f.saved().updatedAt });
  assert.equal(restarts, 1);
  assert.deepEqual(result.stop, { status: "stopped", grants: "paused" });
});

test("stop fallback does not retry a failed close or report a stopped runtime", async t => {
  const f = fixture(t);
  await f.service.update(enable);
  let calls = 0;
  const service = server.createEduPiRecallSettingsService({ ...f.deps, resident: async () => null,
    restartRoot: async () => { calls++; throw new Error("close unresolved"); } });
  const result = await service.update({ enabled: false, expectedUpdatedAt: f.saved().updatedAt });
  assert.equal(calls, 1);
  assert.deepEqual(result.stop, { status: "unknown", grants: "unknown" });
  assert.equal(f.saved().enabled, false);
});

test("a concurrent config winner during stop is never reported as disabled or paused", async t => {
  const f = fixture(t);
  await f.service.update(enable);
  const saved = f.saved();
  const input = Object.fromEntries(Object.entries(saved).filter(([key]) =>
    !["kind", "version", "dataRootHash", "updatedAt", "authorizationInitialized"].includes(key)));
  const service = server.createEduPiRecallSettingsService({ ...f.deps, resident: async () => {
    const off = f.saved();
    await config.writeEduPiRecallConfig({ ...input, grantId: `r04_recall_${"f".repeat(48)}`, consentId: "winner" },
      { ...f.options, expectedUpdatedAt: off.updatedAt }, approved);
    return f.host;
  } });
  await assert.rejects(service.update({ enabled: false, expectedUpdatedAt: saved.updatedAt }), code("recall_config_conflict"));
  assert.equal(f.saved().enabled, true);
  assert.equal(f.saved().consentId, "winner");
  assert.equal(f.grants.get(saved.grantId).status, "active");
});

test("a cross-server CAS loser cleans its own new grant without touching a winner", async t => {
  const f = fixture(t);
  let winning;
  f.failures.afterCreate = async () => {
    const grant = [...f.grants.values()][0];
    const otherId = `r04_recall_${"f".repeat(48)}`;
    f.grants.set(otherId, { ...structuredClone(grant), id: otherId });
    winning = await config.writeEduPiRecallConfig({ enabled: true, purpose: "r04_recall_answer",
      ownerId: "synthetic-owner", grantId: otherId, grantVersion: 1, scope: enable.scope, model: enable.model,
      budgetId: `r04_recall_budget_${"f".repeat(48)}`, limit: 3, validUntil: enable.validUntil, consentId: "winner-consent" },
    { ...f.options, expectedUpdatedAt: null }, approved);
  };
  await assert.rejects(f.service.update(enable), code("recall_config_conflict"));
  assert.deepEqual(f.saved(), winning);
  assert.equal(f.grants.get(winning.grantId).status, "active");
  assert.equal([...f.grants.values()].find(grant => grant.id !== winning.grantId).status, "paused");
});

test("same-root async operations serialize without holding the synchronous IO lock across network work", async t => {
  const f = fixture(t);
  let notified, release;
  const entered = new Promise(resolve => { notified = resolve; }), gate = new Promise(resolve => { release = resolve; });
  f.failures.beforeCreate = async () => { notified(); await gate; };
  const pending = f.service.update(enable);
  await entered;
  assert.equal(fs.existsSync(path.join(f.options.stateDir, ".edupi-recall-mutation.lock")), false);
  const stop = f.service.update({ enabled: false, expectedUpdatedAt: null });
  release();
  await pending;
  await assert.rejects(stop, code("recall_config_conflict"));
});

test("default production settings can persist an independent stop with a missing Core installation", async t => {
  const f = fixture(t, { approval: false });
  const env = { EDUPI_DATA_ROOT: f.options.dataRoot, EDUPI_DATA_ALLOWED_ROOT: f.root,
    PI_DESKTOP_STATE_DIR: f.options.stateDir, EDUPI_CORE_ROOT: path.join(f.root, "missing-core"),
    EDUPI_CORE_ALLOWED_ROOT: f.root };
  const previous = new Map(Object.keys(env).map(key => [key, process.env[key]]));
  Object.assign(process.env, env);
  try {
    const production = server.createEduPiRecallSettingsService();
    assert.equal((await production.get()).config.enabled, false);
    const stopped = await production.update({ enabled: false, expectedUpdatedAt: null });
    assert.equal(stopped.config.enabled, false);
    assert.equal(stopped.activation.reason, "stopped");
    assert.equal(stopped.stop.status, "unknown");
    assert.equal((await production.get()).config.updatedAt, stopped.config.updatedAt);
    assert.equal(JSON.parse(fs.readFileSync(path.join(f.options.stateDir, "edupi-recall-config.json"), "utf8")).enabled, false);
  } finally {
    for (const [key, value] of previous) {
      if (value === undefined) delete process.env[key]; else process.env[key] = value;
    }
  }
});
