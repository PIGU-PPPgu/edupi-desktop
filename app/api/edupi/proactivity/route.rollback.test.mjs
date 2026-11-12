import assert from "node:assert/strict";
import { isDeepStrictEqual } from "node:util";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test, { after } from "node:test";
import ts from "typescript";
import { createJiti } from "jiti";

const config = await createJiti(import.meta.url).import("../../../../lib/edupi-proactivity-config.ts");
const control = await createJiti(import.meta.url, { tsconfigPaths: true }).import("../../../../lib/edupi-proactivity-control.ts");
const runtime = await createJiti(import.meta.url, { tsconfigPaths: true }).import("../../../../lib/edupi-proactivity-runtime.ts");
const testRoot = fs.mkdtempSync(path.join(os.tmpdir(), "reflection-activation-"));
after(() => fs.rmSync(testRoot, { recursive: true, force: true }));

function reflectionActivationFixture({ scopeSwitch = false, initialEnabled = true } = {}) {
  const dataRoot = fs.mkdtempSync(path.join(testRoot, "fixture-"));
  const stateDir = path.join(dataRoot, "state");
  fs.mkdirSync(stateDir, { mode: 0o700 });
  const storage = { stateDir, dataRoot, domain: "lesson_reflection" };
  const scope = { classId: "class-1", subject: "math" };
  const otherScope = { classId: "class-2", subject: "english" };
  const original = { scope, grantId: control.capabilityGrantId("lesson_reflection", scope), ownerId: "owner-original" };
  const workspace = { timetable: [{ slot_id: "slot-1", class_id: scope.classId, subject: scope.subject,
    kind: "class", start_time: "08:00", time_zone: "Asia/Shanghai", source_ids: ["source-current"] }],
  fact_spine: { projection_kind: "education_fact_v1", external_send: false, entities: [
    { entity_id: scope.classId, entity_kind: "class", status: "active" },
    { entity_id: "term-1", entity_kind: "term", status: "active" },
  ], observations: [], accepted_facts: [], conflicts: [] } };
  if (scopeSwitch) {
    workspace.timetable.push({ ...workspace.timetable[0], slot_id: "slot-2",
      class_id: otherScope.classId, subject: otherScope.subject, source_ids: ["source-b"] });
    workspace.fact_spine.entities.push({ entity_id: otherScope.classId, entity_kind: "class", status: "active" });
  }
  const binding = control.buildCapabilityGrantBinding("lesson_reflection", scope, workspace);
  let grant = { id: original.grantId, version: 3, status: "active", ...binding.spec,
    source_ids: [...binding.spec.source_ids, "source-history"] };
  const grants = new Map(initialEnabled ? [[grant.id, grant]] : []);
  const histories = new Map([[original.grantId, ["source-history"]]]);
  const rootRef = `sha256:${"a".repeat(64)}`;
  config.writeEduPiProactivityConfig(initialEnabled ? { enabled: true, ...original }
    : { enabled: false, scope: null, grantId: null, historyBinding: null }, storage);
  const events = [];
  const settings = { restartFailure: false, ensureFailure: false, ensureReadFailure: false, pauseFailure: false,
    staleUpdate: false, staleResume: false, lostUpdateReceipt: false, competitorBeforePause: false,
    g3Pending: false, auxiliaryPending: false, ownerId: original.ownerId, ownerRootRef: rootRef,
    ownerIdentityRootRef: rootRef,
    lostCreateReceipt: false, configFailure: false, beforeEnsure: null, afterCreate: null };
  const read = () => config.readEduPiProactivityActivation({ ...storage, env: {} });
  const ownerState = () => ({ ok: true, result: { root_ref: settings.ownerRootRef,
    owner: { id: settings.ownerId, root_ref: settings.ownerIdentityRootRef },
    grants: [...grants.values()].map(item => structuredClone(item)) } });
  const host = { async call(operation, payload) {
    events.push({ operation, payload });
    if (operation === "owner_read") {
      settings.beforeEnsure?.();
      settings.beforeEnsure = null;
      return ownerState();
    }
    assert.equal(operation, "health");
    return { ok: true, result: { data_root_fingerprint: rootRef, capabilities: {
      g3_processor: read().enabled && !settings.g3Pending ? "active" : "activation_pending",
      internal_timer: "active", ambient_planning: "active", owner_authorization: "active",
      owner_conversation: "active", owner_intent: "active",
      attention_delivery: settings.auxiliaryPending ? "activation_pending" : "active",
      teacher_feedback: settings.auxiliaryPending ? "activation_pending" : "active",
    } } };
  }, async callOwnerControl(operation, payload) {
    events.push({ operation, payload: structuredClone(payload) });
    if (operation === "owner_read") return ownerState();
    assert.equal(operation, "owner_control");
    assert.equal(payload.expected_owner_id, original.ownerId);
    let target = grants.get(payload.grant_id);
    assert.equal(payload.expected_version, target?.version ?? 0);
    assert.ok(["create", "update", "resume", "pause"].includes(payload.action));
    if (!target) {
      assert.equal(payload.action, "create");
      target = { id: payload.grant_id, version: 0, status: "active" };
      grants.set(target.id, target);
      if (target.id === original.grantId) grant = target;
    }
    if (payload.action === "update" && settings.staleUpdate || payload.action === "resume" && settings.staleResume) {
      target.version++;
      return { ok: false, error: "stale_version" };
    }
    target.version++;
    if (payload.spec) Object.assign(target, structuredClone(payload.spec));
    if (payload.action === "resume") target.status = "active";
    if (payload.action === "pause") target.status = "paused";
    if (payload.action === "update" && settings.lostUpdateReceipt) throw new Error("synthetic_lost_receipt");
    if (payload.action === "create" && settings.lostCreateReceipt) throw new Error("synthetic_lost_receipt");
    if (payload.action === "create") settings.afterCreate?.(target);
    return { ok: true, result: { owner_id: original.ownerId, grant_id: target.id, grant_version: target.version } };
  } };
  class RuntimeError extends Error { constructor(code) { super(code); this.code = code; } }
  const modules = {
    "node:util": { isDeepStrictEqual },
    "next/server": { NextResponse: { json: (body, options = {}) => Response.json(body, options) } },
    "@/lib/bounded-form-data": { parseJsonWithinLimit: request => request.json(), RequestBodyTooLargeError: class extends Error {} },
    "@/lib/desktop-api-auth": { isDesktopApiRequestAllowed: () => true },
    "@/lib/safe-mode": { canStartEduPiCapabilityDrafts: () => true },
    "@/lib/edupi-core-snapshot": { resolveEduPiBridgeRoots: () => ({ runtime: { root: "/isolated-core" },
      dataRoot: { root: dataRoot, memoryDir: path.join(dataRoot, "memory") } }),
      readEduPiEducationSnapshot: async () => ({ workspace }) },
    "@/lib/edupi-generated-artifacts": { workspaceResourcesRequest: async () => ({ teacherMaterials: [] }) },
    "@/lib/edupi-proactivity-control": {
      ...control,
      readLessonReflectionHistorySourceIds: async input => {
        events.push({ operation: "history", input: structuredClone(input) });
        assert.equal(input.ownerId, original.ownerId);
        assert.equal(input.grant.id, control.capabilityGrantId("lesson_reflection", input.scope));
        assert.equal(input.grant.status, "paused");
        const sources = histories.get(input.grant.id) ?? [];
        assert.ok(sources.every(source => input.grant.source_ids.includes(source)));
        return sources;
      },
    },
    "@/lib/edupi-proactivity-config": {
      readEduPiProactivityActivation: options => config.readEduPiProactivityActivation({ ...options, stateDir, env: {} }),
      writeEduPiProactivityConfig: (input, options) => {
        events.push({ operation: "config", input: structuredClone(input) });
        if (settings.configFailure && !input.enabled) throw new Error("synthetic_config_failure");
        return config.writeEduPiProactivityConfig(input, { ...options, stateDir });
      },
      writeEduPiProactivityStopIntent: (input, options) => config.writeEduPiProactivityStopIntent(input, { ...options, stateDir }),
      clearEduPiProactivityStopIntent: options => config.clearEduPiProactivityStopIntent({ ...options, stateDir }),
    },
    "@/lib/edupi-proactivity-runtime": {
      ...runtime,
      EduPiProactivityRuntimeError: RuntimeError,
      ensureProactivityGrant: async (...args) => {
        events.push({ operation: "ensure_grant" });
        if (settings.ensureReadFailure) throw new RuntimeError("proactivity_grant_denied");
        if (settings.ensureFailure) {
          await runtime.ensureProactivityGrant(...args);
          throw new RuntimeError("proactivity_grant_denied");
        }
        return runtime.ensureProactivityGrant(...args);
      },
      readProactivityRuntimeState: async () => ({ grant: null, execution: null }),
      pauseProactivityGrant: async (targetHost, targetRootRef, grantId, expected) => {
        events.push({ operation: "pause", grantId, expected });
        if (settings.pauseFailure) throw new Error("synthetic_pause_failure");
        if (settings.competitorBeforePause) grant.version++;
        return runtime.pauseProactivityGrant(targetHost, targetRootRef, grantId, expected);
      },
      proactivityRuntimeError: error => error?.code ? error : new RuntimeError("proactivity_runtime_unavailable"),
    },
    "@/lib/edupi-runtime-supervisor": {
      ensureEduPiRuntime: async () => host,
      restartEduPiRuntime: async () => {
        events.push({ operation: "restart" });
        if (settings.restartFailure) {
          settings.restartFailure = false;
          throw new Error("synthetic_restart_failure");
        }
        return host;
      },
      quarantineEduPiRuntime: async () => { events.push({ operation: "quarantine" }); },
      clearEduPiRuntimeQuarantine: () => { events.push({ operation: "clear_quarantine" }); },
    },
  };
  const compiled = ts.transpileModule(fs.readFileSync(new URL("./route.ts", import.meta.url), "utf8"), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, esModuleInterop: true },
  }).outputText;
  const route = { exports: {} };
  new Function("require", "module", "exports", compiled)(name => {
    assert.ok(Object.hasOwn(modules, name), `unexpected dependency ${name}`);
    return modules[name];
  }, route, route.exports);
  return { original, otherScope, workspace, grants, histories, storage, read, settings, events,
    get grant() { return grant; }, post: (enabled, scope = original.scope, expectedUpdatedAt = read().updatedAt) => route.exports.POST(new Request(
    "http://localhost/api/edupi/proactivity", { method: "POST", headers: { "content-type": "application/json" },
      body: JSON.stringify({ enabled, domain: "lesson_reflection", classId: enabled ? scope.classId : null,
        subject: enabled ? scope.subject : null, expectedUpdatedAt }) })) };
}

test("reflection handler enables A, stops, enables B, stops and restores A with exact historical source union", async () => {
  const current = reflectionActivationFixture({ scopeSwitch: true, initialEnabled: false });
  assert.equal((await current.post(true)).status, 200);
  const a = current.grant;
  const activeA = structuredClone(a);
  const activationA = current.read();
  const eventStart = current.events.length;
  assert.equal((await current.post(true, current.otherScope)).status, 409);
  assert.deepEqual(a, activeA);
  assert.deepEqual(current.read(), activationA);
  assert.equal(current.events.slice(eventStart).some(event => ["owner_control", "config", "restart"].includes(event.operation)), false);
  const history = ["source-accepted", "source-pending", "source-rejected"];
  current.histories.set(a.id, history);
  a.source_ids.push(...history, "source-withdrawn");
  assert.equal((await current.post(false)).status, 200);
  const pausedA = structuredClone(a);
  const responseB = await current.post(true, current.otherScope);
  assert.equal(responseB.status, 200, JSON.stringify(await responseB.json()));
  const bId = control.capabilityGrantId("lesson_reflection", current.otherScope);
  const b = current.grants.get(bId);
  assert.deepEqual(a, pausedA, "switching scope cannot rewrite A authority");
  assert.equal(b.status, "active");
  assert.deepEqual(b.scope, { class_id: current.otherScope.classId, subject: current.otherScope.subject });
  assert.deepEqual([...b.source_ids].sort(),
    control.capabilityGrantSourceIds("lesson_reflection", current.otherScope, current.workspace).sort());
  assert.deepEqual(current.read().historyBinding, { ...current.original, scope: current.otherScope, grantId: bId });
  assert.equal([...current.grants.values()].filter(item => item.status === "active").length, 1);
  assert.equal((await current.post(false)).status, 200);
  const pausedB = structuredClone(b);
  current.workspace.timetable[0].source_ids = ["source-a-new"];
  assert.equal((await current.post(true)).status, 200);
  assert.deepEqual(b, pausedB);
  assert.equal(a.status, "active");
  assert.deepEqual([...a.source_ids].sort(), [
    ...control.capabilityGrantSourceIds("lesson_reflection", current.original.scope, current.workspace), ...history,
  ].sort());
  assert.deepEqual(current.read().historyBinding, current.original);
  assert.equal(current.grants.size, 2);
  assert.equal([...current.grants.values()].filter(item => item.status === "active").length, 1);
  const writes = current.events.filter(event => event.operation === "owner_control");
  assert.deepEqual(writes.filter(event => event.payload.action === "create").map(event => event.payload.grant_id),
    [a.id, b.id]);
});

test("reflection scope switch rejects foreign roots, owners and unsafe prior grants without writes", async context => {
  for (const [name, change] of [
    ["foreign root", current => { current.settings.ownerRootRef = `sha256:${"b".repeat(64)}`; }],
    ["owner root missing", current => { current.settings.ownerIdentityRootRef = undefined; }],
    ["owner root differs", current => { current.settings.ownerIdentityRootRef = `sha256:${"b".repeat(64)}`; }],
    ["foreign owner", current => { current.settings.ownerId = "owner-other"; }],
    ["prior grant active", current => { current.grant.status = "active"; }],
    ["prior grant revoked", current => { current.grant.status = "revoked"; }],
    ["prior grant missing", current => { current.grants.clear(); }],
    ["prior scope expanded", current => { current.grant.scope.student_id = "student-other"; }],
    ["prior grant sources invalid", current => { current.grant.source_ids = ["invalid source"]; }],
  ]) {
    await context.test(name, async () => {
      const current = reflectionActivationFixture({ scopeSwitch: true });
      assert.equal((await current.post(false)).status, 200);
      const previous = current.read();
      change(current);
      current.events.length = 0;
      const response = await current.post(true, current.otherScope);
      assert.equal(response.status, 409);
      assert.equal((await response.json()).code, "proactivity_grant_denied");
      assert.deepEqual(current.read(), previous);
      assert.equal(current.events.some(event => ["owner_control", "config", "restart", "quarantine"].includes(event.operation)), false);
    });
  }
});

test("reflection scope switch fences races before a new grant can be created", async context => {
  for (const [name, change] of [
    ["owner changed", current => { current.settings.ownerId = "owner-raced"; }],
    ["root changed", current => { current.settings.ownerRootRef = `sha256:${"b".repeat(64)}`; }],
    ["owner root disappeared", current => { current.settings.ownerIdentityRootRef = undefined; }],
    ["owner root changed", current => { current.settings.ownerIdentityRootRef = `sha256:${"b".repeat(64)}`; }],
    ["prior grant resumed", current => { current.grant.status = "active"; current.grant.version++; }],
    ["selected grant appeared", current => {
      const binding = control.buildCapabilityGrantBinding("lesson_reflection", current.otherScope, current.workspace);
      current.grants.set(binding.grantId, { id: binding.grantId, status: "paused", version: 1, ...binding.spec });
    }],
  ]) {
    await context.test(name, async () => {
      const current = reflectionActivationFixture({ scopeSwitch: true });
      assert.equal((await current.post(false)).status, 200);
      const previous = current.read();
      current.events.length = 0;
      current.settings.beforeEnsure = () => change(current);
      const response = await current.post(true, current.otherScope);
      assert.equal(response.status, 409);
      assert.equal((await response.json()).code, "proactivity_grant_denied");
      assert.deepEqual(current.read(), previous);
      assert.equal(current.events.some(event => ["owner_control", "config", "restart", "quarantine"].includes(event.operation)), false);
    });
  }
});

test("reflection scope switch rollback restores A history and pauses only the attempted B grant", async context => {
  for (const [name, change] of [
    ["restart failed", current => { current.settings.restartFailure = true; }],
    ["source readback differs", current => { current.settings.afterCreate = grant => { grant.source_ids.push("source-forged"); }; }],
    ["scope readback differs", current => { current.settings.afterCreate = grant => { grant.scope.subject = "forged"; }; }],
  ]) {
    await context.test(name, async () => {
      const current = reflectionActivationFixture({ scopeSwitch: true });
      assert.equal((await current.post(false)).status, 200);
      const previous = current.read();
      const pausedA = structuredClone(current.grant);
      change(current);
      current.events.length = 0;
      const response = await current.post(true, current.otherScope);
      assert.ok(response.status >= 400);
      assert.equal(current.read().enabled, false);
      assert.equal(current.read().scope, null);
      assert.equal(current.read().configurationStatus, "ready");
      assert.deepEqual(current.read().historyBinding, previous.historyBinding);
      assert.deepEqual(current.grant, pausedA);
      const b = current.grants.get(control.capabilityGrantId("lesson_reflection", current.otherScope));
      assert.equal(b.status, "paused");
      assert.deepEqual(current.events.filter(event => event.operation === "pause").map(event => event.grantId), [b.id]);
    });
  }
});

test("reflection scope switch uncertain creation and rollback never report enabled", async context => {
  for (const [name, change] of [
    ["lost create receipt", current => { current.settings.lostCreateReceipt = true; }],
    ["rollback pause failed", current => { current.settings.restartFailure = true; current.settings.pauseFailure = true; }],
    ["rollback persistence failed", current => { current.settings.restartFailure = true; current.settings.configFailure = true; }],
  ]) {
    await context.test(name, async () => {
      const current = reflectionActivationFixture({ scopeSwitch: true });
      assert.equal((await current.post(false)).status, 200);
      const pausedA = structuredClone(current.grant);
      change(current);
      const response = await current.post(true, current.otherScope);
      assert.equal(response.status, 503);
      assert.equal((await response.json()).code, "proactivity_stop_uncertain");
      assert.equal(current.read().enabled, false);
      assert.equal(current.read().configurationStatus, "stop_pending");
      assert.deepEqual(current.grant, pausedA);
      assert.equal(fs.existsSync(path.join(current.storage.stateDir, "edupi-lesson-reflection-stop.json")), true);
      current.events.length = 0;
      assert.equal((await current.post(true, current.otherScope)).status, 409);
      assert.deepEqual(current.events, []);
    });
  }
});

test("reflection scope switch requires a completed stop and a current configuration token", async () => {
  const current = reflectionActivationFixture({ scopeSwitch: true });
  const staleToken = current.read().updatedAt;
  current.settings.pauseFailure = true;
  assert.equal((await current.post(false)).status, 503);
  assert.equal((await current.post(true, current.otherScope)).status, 409);
  assert.equal(current.grants.size, 1);
  current.settings.pauseFailure = false;
  assert.equal((await current.post(false)).status, 200);
  const previous = current.read();
  current.events.length = 0;
  const stale = await current.post(true, current.otherScope, staleToken);
  assert.equal(stale.status, 409);
  assert.equal((await stale.json()).code, "proactivity_configuration_stale");
  assert.deepEqual(current.events, []);
  assert.deepEqual(current.read(), previous);
  assert.equal((await current.post(true, current.otherScope)).status, 200);
});

function assertReenablePreflight(current) {
  const historyIndex = current.events.findIndex(event => event.operation === "history");
  const ensureIndex = current.events.findIndex(event => event.operation === "ensure_grant");
  assert.ok(historyIndex >= 0 && ensureIndex > historyIndex);
  assert.ok(current.events.slice(0, historyIndex).some(event => event.operation === "owner_read"));
  assert.deepEqual(current.events[historyIndex].input.grant.scope,
    { class_id: current.original.scope.classId, subject: current.original.scope.subject });
}

test("safe reflection disable clears execution identity while persisting read-only history and re-enable refreshes it", async () => {
  const current = reflectionActivationFixture();
  const response = await current.post(false);
  assert.equal(response.status, 200);
  assert.equal((await response.json()).grantPaused, true);
  const stopped = current.read();
  assert.equal(stopped.enabled, false);
  assert.equal(stopped.scope, null);
  assert.equal(stopped.grantId, null);
  assert.equal(stopped.ownerId, undefined);
  assert.deepEqual(stopped.historyBinding, current.original);
  assert.equal(fs.existsSync(path.join(current.storage.stateDir, "edupi-lesson-reflection-stop.json")), false);
  assert.equal((await current.post(false)).status, 200);
  assert.deepEqual(current.read().historyBinding, current.original, "repeated disable preserves history");
  current.events.length = 0;
  assert.equal((await current.post(true)).status, 200);
  assertReenablePreflight(current);
  assert.deepEqual(current.read().historyBinding, current.original);
  assert.equal(current.grant.status, "active");
  assert.ok(current.grant.source_ids.includes("source-history"));
  assert.equal(current.read().enabled, true);
});

test("reflection re-enable accepts Main4 health with G3 active and auxiliary capabilities pending", async () => {
  const current = reflectionActivationFixture();
  assert.equal((await current.post(false)).status, 200);
  current.settings.auxiliaryPending = true;
  current.events.length = 0;
  const response = await current.post(true);
  assert.equal(response.status, 200);
  assertReenablePreflight(current);
  assert.equal(current.read().enabled, true);
  assert.equal(current.grant.status, "active");
  assert.equal(current.events.some(event => event.operation === "pause"), false);
});

test("reflection re-enable rejects pending G3 and restores its disabled historical binding", async () => {
  const current = reflectionActivationFixture();
  assert.equal((await current.post(false)).status, 200);
  const previous = current.read().historyBinding;
  current.settings.auxiliaryPending = true;
  current.settings.g3Pending = true;
  current.events.length = 0;
  const response = await current.post(true);
  assert.equal(response.status, 503);
  assert.equal((await response.json()).code, "proactivity_runtime_unavailable");
  assertReenablePreflight(current);
  assert.equal(current.read().enabled, false);
  assert.deepEqual(current.read().historyBinding, previous);
  assert.equal(current.grant.status, "paused");
  assert.equal(current.events.some(event => event.operation === "pause"), true);
});

test("failed reflection re-enable restores the previous historical binding after pausing the attempted grant", async () => {
  const current = reflectionActivationFixture();
  assert.equal((await current.post(false)).status, 200);
  const previous = current.read().historyBinding;
  assert.deepEqual(previous, current.original);
  current.events.length = 0;
  current.settings.restartFailure = true;
  const response = await current.post(true);
  assert.equal(response.status, 503);
  assert.equal((await response.json()).code, "proactivity_runtime_unavailable");
  const restored = current.read();
  assert.equal(restored.enabled, false);
  assert.equal(restored.configurationStatus, "ready");
  assert.equal(restored.scope, null);
  assert.equal(restored.grantId, null);
  assert.equal(restored.ownerId, undefined);
  assert.deepEqual(restored.historyBinding, previous);
  assertReenablePreflight(current);
  assert.equal(current.events.some(event => event.operation === "pause" && event.grantId === current.original.grantId), true);
  assert.equal(current.grant.status, "paused");
  assert.equal(fs.existsSync(path.join(current.storage.stateDir, "edupi-lesson-reflection-stop.json")), false);
});

test("failed reflection owner grant after mutation restores disabled history and pauses the attempted grant", async () => {
  const current = reflectionActivationFixture();
  assert.equal((await current.post(false)).status, 200);
  const previous = current.read().historyBinding;
  current.events.length = 0;
  current.settings.ensureFailure = true;
  const response = await current.post(true);
  assert.equal(response.status, 409);
  assert.equal((await response.json()).code, "proactivity_grant_denied");
  const restored = current.read();
  assert.equal(restored.enabled, false);
  assert.equal(restored.configurationStatus, "ready");
  assert.deepEqual(restored.historyBinding, previous);
  assertReenablePreflight(current);
  assert.equal(current.events.some(event => event.operation === "pause" && event.grantId === current.original.grantId), true);
  assert.equal(current.grant.status, "paused");
  assert.equal(fs.existsSync(path.join(current.storage.stateDir, "edupi-lesson-reflection-stop.json")), false);
});

test("failed reflection read before owner mutation leaves disabled history untouched", async () => {
  const current = reflectionActivationFixture();
  assert.equal((await current.post(false)).status, 200);
  const previous = current.read();
  current.events.length = 0;
  current.settings.ensureReadFailure = true;
  const response = await current.post(true);
  assert.equal(response.status, 409);
  assert.equal((await response.json()).code, "proactivity_grant_denied");
  assert.deepEqual(current.read(), previous);
  assertReenablePreflight(current);
  assert.deepEqual(current.events.filter(event => ["owner_control", "config", "pause", "restart"].includes(event.operation)), []);
  assert.equal(fs.existsSync(path.join(current.storage.stateDir, "edupi-lesson-reflection-stop.json")), false);
});

test("stale reflection update rejection leaves competitor grant and disabled history alone", async () => {
  const current = reflectionActivationFixture();
  assert.equal((await current.post(false)).status, 200);
  const previous = current.read();
  current.events.length = 0;
  current.settings.staleUpdate = true;
  const response = await current.post(true);
  assert.equal(response.status, 409);
  assert.equal((await response.json()).code, "proactivity_grant_denied");
  assert.equal(current.grant.version, 5);
  assert.equal(current.grant.status, "paused");
  assert.deepEqual(current.read(), previous);
  assert.equal(current.events.some(event => ["pause", "restart", "quarantine"].includes(event.operation)), false);
});

test("stale reflection resume refuses to pause a newer competitor version and holds the stop fence", async () => {
  const current = reflectionActivationFixture();
  assert.equal((await current.post(false)).status, 200);
  current.events.length = 0;
  current.settings.staleResume = true;
  const response = await current.post(true);
  assert.equal(response.status, 503);
  assert.equal((await response.json()).code, "proactivity_stop_uncertain");
  assert.equal(current.grant.version, 6);
  assert.equal(current.grant.status, "paused");
  assert.deepEqual(current.events.find(event => event.operation === "pause")?.expected,
    { ownerId: current.original.ownerId, grantVersion: 5 });
  assert.equal(current.events.some(event => event.operation === "owner_control" && event.payload.action === "pause"), false);
  assert.ok(current.events.findLastIndex(event => event.operation === "quarantine") >
    current.events.findLastIndex(event => event.operation === "clear_quarantine"));
  assert.equal(current.events.some(event => event.operation === "restart"), false);
  assert.equal(current.read().configurationStatus, "stop_pending");
  assert.equal(current.read().historyBinding, undefined);
});

test("lost reflection update receipt holds a durable stop fence without speculative pause", async () => {
  const current = reflectionActivationFixture();
  assert.equal((await current.post(false)).status, 200);
  current.events.length = 0;
  current.settings.lostUpdateReceipt = true;
  const response = await current.post(true);
  assert.equal(response.status, 503);
  assert.equal((await response.json()).code, "proactivity_stop_uncertain");
  assert.equal(current.grant.version, 5);
  assert.equal(current.grant.status, "paused");
  assert.equal(current.events.some(event => ["pause", "restart"].includes(event.operation)), false);
  assert.ok(current.events.some(event => event.operation === "quarantine"));
  assert.equal(current.events.some(event => ["clear_quarantine", "restart"].includes(event.operation)), false);
  assert.equal(current.read().configurationStatus, "stop_pending");
  assert.equal(current.read().historyBinding, undefined);
  current.events.length = 0;
  assert.equal((await current.post(true)).status, 409);
  assert.deepEqual(current.events, []);
});

test("reflection compensation cannot pause a grant changed after the committed receipt", async () => {
  const current = reflectionActivationFixture();
  assert.equal((await current.post(false)).status, 200);
  current.events.length = 0;
  current.settings.ensureFailure = true;
  current.settings.competitorBeforePause = true;
  const response = await current.post(true);
  assert.equal(response.status, 503);
  assert.equal((await response.json()).code, "proactivity_stop_uncertain");
  assert.equal(current.grant.version, 7);
  assert.equal(current.grant.status, "active");
  assert.deepEqual(current.events.find(event => event.operation === "pause")?.expected,
    { ownerId: current.original.ownerId, grantVersion: 6 });
  assert.equal(current.events.some(event => event.operation === "owner_control" && event.payload.action === "pause"), false);
  assert.ok(current.events.findLastIndex(event => event.operation === "quarantine") >
    current.events.findLastIndex(event => event.operation === "clear_quarantine"));
  assert.equal(current.events.some(event => event.operation === "restart"), false);
  assert.equal(current.read().configurationStatus, "stop_pending");
  assert.equal(current.read().historyBinding, undefined);
});

test("failed reflection owner grant with failed pause holds a stop fence and denies re-enable", async () => {
  const current = reflectionActivationFixture();
  assert.equal((await current.post(false)).status, 200);
  current.events.length = 0;
  current.settings.ensureFailure = true;
  current.settings.pauseFailure = true;
  const response = await current.post(true);
  assert.equal(response.status, 503);
  assert.equal((await response.json()).code, "proactivity_stop_uncertain");
  const stopped = current.read();
  assert.equal(stopped.enabled, false);
  assert.equal(stopped.configurationStatus, "stop_pending");
  assert.equal(stopped.historyBinding, undefined);
  assertReenablePreflight(current);
  assert.equal(current.events.some(event => event.operation === "pause" && event.grantId === current.original.grantId), true);
  current.events.length = 0;
  assert.equal((await current.post(true)).status, 409);
  assert.deepEqual(current.events, []);
});

test("uncertain reflection disable keeps its durable stop fence and withholds historical authority", async () => {
  const current = reflectionActivationFixture();
  current.settings.pauseFailure = true;
  const response = await current.post(false);
  assert.equal(response.status, 503);
  assert.equal((await response.json()).code, "proactivity_stop_uncertain");
  const stopped = current.read();
  assert.equal(stopped.enabled, false);
  assert.equal(stopped.configurationStatus, "stop_pending");
  assert.equal(stopped.historyBinding, undefined);
  assert.equal((await current.post(true)).status, 409);
});

test("retrying an uncertain reflection disable preserves the historical binding for re-enable", async () => {
  const current = reflectionActivationFixture();
  current.settings.pauseFailure = true;
  assert.equal((await current.post(false)).status, 503);
  assert.equal(current.read().configurationStatus, "stop_pending");
  assert.equal(current.read().historyBinding, undefined);

  current.settings.pauseFailure = false;
  const response = await current.post(false);
  assert.equal(response.status, 200);
  assert.equal((await response.json()).grantPaused, true);
  assert.equal(current.read().configurationStatus, "ready");
  assert.deepEqual(current.read().historyBinding, current.original);
  assert.equal(fs.existsSync(path.join(current.storage.stateDir, "edupi-lesson-reflection-stop.json")), false);

  current.events.length = 0;
  assert.equal((await current.post(true)).status, 200);
  assertReenablePreflight(current);
  assert.deepEqual(current.read().historyBinding, current.original);
});

test("failed enable orders stop marker and quarantine before rollback retries", async () => {
  // This stubs dependencies to prove route ordering only; filesystem and
  // cross-process durability are exercised by separate isolated tests.
  const events = [];
  const root = `/isolated-proactivity-rollback-${Date.now()}`;
  const scope = { classId: "class-7-1", subject: "数学" };
  const grantId = "desktop_canary_v2_test";
  let marker = null;
  let activation = { enabled: false, source: "desktop_canary", configurationStatus: "ready",
    scope: null, grantId: null, updatedAt: null };
  const fingerprint = `sha256:${"a".repeat(64)}`;
  const capabilities = { g1_processor: "active", internal_timer: "active", ambient_planning: "active",
    owner_authorization: "active", owner_conversation: "active", owner_intent: "active",
    attention_delivery: "active", teacher_feedback: "active" };
  const host = { async call(operation) {
    events.push(operation);
    if (operation === "health") return { ok: true, result: { data_root_fingerprint: fingerprint, capabilities } };
    if (operation === "prepare_due") return { ok: true, result: { tasks: [], failures: [] } };
    throw new Error(`unexpected operation ${operation}`);
  } };
  class RuntimeError extends Error { constructor(code) { super(code); this.code = code; } }
  class ControlError extends Error { constructor(code) { super(code); this.code = code; } }
  class BodyTooLarge extends Error {}
  const modules = {
    "next/server": { NextResponse: { json: (body, options = {}) => Response.json(body, { status: options.status || 200 }) } },
    "@/lib/bounded-form-data": { parseJsonWithinLimit: request => request.json(), RequestBodyTooLargeError: BodyTooLarge },
    "@/lib/desktop-api-auth": { isDesktopApiRequestAllowed: () => true },
    "@/lib/safe-mode": { canStartEduPiProactivity: () => true },
    "@/lib/edupi-core-snapshot": { resolveEduPiBridgeRoots: () => ({ dataRoot: { root } }),
      readEduPiEducationSnapshot: async () => ({ workspace: {} }) },
    "@/lib/edupi-generated-artifacts": { workspaceResourcesRequest: async () => ({ teacherMaterials: [] }) },
    "@/lib/edupi-proactivity-control": { buildProactivityScopeCandidates: () => [{ ...scope, ready: true }],
      buildProactivityGrantBinding: () => ({ grantId, endsAt: "2099-01-01T00:00:00.000Z", spec: {} }),
      EDUPI_PROACTIVITY_DURATION_DAYS: 7, EDUPI_PROACTIVITY_MAX_CALLS: 12, EduPiProactivityControlError: ControlError },
    "@/lib/edupi-proactivity-config": {
      readEduPiProactivityActivation: () => marker ? { enabled: false, source: "desktop_canary",
        configurationStatus: "stop_pending", scope, grantId, updatedAt: marker.updatedAt } : activation,
      writeEduPiProactivityConfig: input => {
        events.push(input.enabled ? "config-enabled" : "config-rollback-failed");
        if (!input.enabled) throw new Error("synthetic_directory_sync_failure");
        activation = { ...activation, ...input, updatedAt: "2026-09-27T00:00:00.000Z" };
      },
      writeEduPiProactivityStopIntent: input => { events.push("marker-durable"); marker = { ...input, updatedAt: "2026-09-27T00:00:01.000Z" }; },
      clearEduPiProactivityStopIntent: () => { throw new Error("marker must remain"); },
    },
    "@/lib/edupi-proactivity-runtime": { EduPiProactivityRuntimeError: RuntimeError,
      ensureProactivityGrant: async () => { events.push("grant-active"); },
      readProactivityGrantStatus: async () => ({ modelBudget: { remainingCalls: 12, usageUnverified: false } }),
      inspectProactivityCatchUp: () => { events.push("catchup-failed"); throw new Error("synthetic_catchup_failure"); },
      pauseProactivityGrant: async () => { events.push("pause-failed"); throw new Error("synthetic_pause_failure"); },
      proactivityRuntimeError: error => error?.code ? error : new RuntimeError("proactivity_runtime_unavailable") },
    "@/lib/edupi-runtime-supervisor": { ensureEduPiRuntime: async () => { events.push("ensure-default-off"); return host; },
      restartEduPiRuntime: async () => { events.push("restart-scoped"); return host; },
      quarantineEduPiRuntime: async () => { events.push("quarantine"); },
      clearEduPiRuntimeQuarantine: () => { events.push("release-quarantine"); } },
  };
  const source = fs.readFileSync(new URL("./route.ts", import.meta.url), "utf8");
  const compiled = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.CommonJS,
    target: ts.ScriptTarget.ES2022, esModuleInterop: true } }).outputText;
  const route = { exports: {} };
  new Function("require", "module", "exports", compiled)(name => {
    if (name === "node:util") return { isDeepStrictEqual };
    if (!Object.hasOwn(modules, name)) throw new Error(`unexpected dependency ${name}`);
    return modules[name];
  }, route, route.exports);
  const request = body => new Request("http://localhost/api/edupi/proactivity", { method: "POST",
    headers: { "content-type": "application/json" }, body: JSON.stringify(body) });
  const failed = await route.exports.POST(request({ enabled: true, classId: scope.classId,
    subject: scope.subject, expectedUpdatedAt: null }));
  assert.equal(failed.status, 503);
  assert.equal((await failed.json()).code, "proactivity_stop_uncertain");
  assert.equal(events.indexOf("grant-active") < events.indexOf("catchup-failed"), true);
  assert.equal(events.indexOf("catchup-failed") < events.indexOf("marker-durable"), true);
  assert.equal(events.indexOf("marker-durable") < events.indexOf("pause-failed"), true);
  assert.equal(events.at(-1), "quarantine", "failed fallback never leaves a scoped executor available");
  assert.ok(marker, "the durable marker survives both Core and config rollback failures");
  const blocked = await route.exports.POST(request({ enabled: true, classId: scope.classId,
    subject: scope.subject, expectedUpdatedAt: marker.updatedAt }));
  assert.equal(blocked.status, 409, "same-scope re-enable cannot bypass a pending stop fence");
});

test("Windows normal mode refuses G1 enable before reading or mutating Core", async () => {
  const modules = {
    "next/server": { NextResponse: { json: (body, options = {}) => Response.json(body, { status: options.status || 200 }) } },
    "@/lib/bounded-form-data": { parseJsonWithinLimit: request => request.json(), RequestBodyTooLargeError: class extends Error {} },
    "@/lib/desktop-api-auth": { isDesktopApiRequestAllowed: () => true },
    "@/lib/safe-mode": { canStartEduPiProactivity: () => false },
    "@/lib/edupi-core-snapshot": { resolveEduPiBridgeRoots: () => { throw new Error("Core must not be read"); } },
    "@/lib/edupi-generated-artifacts": {},
    "@/lib/edupi-proactivity-control": {},
    "@/lib/edupi-proactivity-config": {},
    "@/lib/edupi-proactivity-runtime": {},
    "@/lib/edupi-runtime-supervisor": {},
  };
  const source = fs.readFileSync(new URL("./route.ts", import.meta.url), "utf8");
  const compiled = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.CommonJS,
    target: ts.ScriptTarget.ES2022, esModuleInterop: true } }).outputText;
  const route = { exports: {} };
  new Function("require", "module", "exports", compiled)(name => {
    if (name === "node:util") return { isDeepStrictEqual };
    if (!Object.hasOwn(modules, name)) throw new Error(`unexpected dependency ${name}`);
    return modules[name];
  }, route, route.exports);
  const response = await route.exports.POST(new Request("http://localhost/api/edupi/proactivity", { method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ enabled: true, classId: "class-7-1", subject: "数学", expectedUpdatedAt: null }) }));
  assert.equal(response.status, 409);
  const body = await response.json();
  assert.equal(body.code, "proactivity_safe_mode_required");
  assert.equal(body.externalSend, false);
});
