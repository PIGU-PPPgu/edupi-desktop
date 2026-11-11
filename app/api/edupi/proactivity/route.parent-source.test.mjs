import assert from "node:assert/strict";
import fs from "node:fs";
import test from "node:test";
import { isDeepStrictEqual } from "node:util";
import ts from "typescript";
import { createJiti } from "jiti";

const control = await createJiti(import.meta.url, { tsconfigPaths: true }).import("../../../../lib/edupi-proactivity-control.ts");
const runtime = await createJiti(import.meta.url, { tsconfigPaths: true }).import("../../../../lib/edupi-proactivity-runtime.ts");
const compiled = ts.transpileModule(fs.readFileSync(new URL("./route.ts", import.meta.url), "utf8"), {
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, esModuleInterop: true },
}).outputText;
const rootRef = `sha256:${"a".repeat(64)}`;
const scope = { classId: "class-1", subject: "math" };

function workspace(sources) {
  const entities = ["class", "term", "student", "parent"].map(kind => ({
    entity_id: `${kind}-1`, entity_kind: kind, canonical_name: kind, status: "active",
  }));
  return { fact_spine: { projection_kind: "education_fact_v1", external_send: false, entities, conflicts: [],
    observations: sources.map((source, index) => ({ observation_id: `observation-${index}`, source_id: source,
      source_kind: "teacher_utterance", observed_at: "2026-11-05T00:00:00.000Z",
      entity_ids: entities.map(item => item.entity_id), status: "active" })),
    accepted_facts: sources.map((source, index) => ({ fact_id: `question-${index}`, status: "accepted", fact_kind: "evidence",
      predicate: "communication.parent_question", entity_id: "student-1", subject_ref: "math", source_ids: [source],
      observation_ids: [`observation-${index}`], conflict_ids: [], confidence: { basis: "explicit" } })),
  } };
}

function fixture({ initialSources = [], sources = initialSources, ownerId = "owner-1", updateOk = true,
  isolated = true, readbackOverride = {}, domain = "parent_communication", snapshot = workspace,
  grantOverride = {}, historicalSources = [], historyError = false, enabled = true, historyBindingOverride = {},
  grantMissing = false, afterHistory = null, beforeEnsure = null, ownerRootRef = rootRef } = {}) {
  const events = [];
  const binding = control.buildCapabilityGrantBinding(domain, scope, snapshot(initialSources));
  let activation = { enabled, source: "desktop_canary", configurationStatus: "ready", scope: enabled ? scope : null,
    grantId: enabled ? binding.grantId : null, ownerId: enabled ? "owner-1" : null,
    updatedAt: "2026-11-05T00:00:00.000Z",
    ...(domain === "lesson_reflection" ? { historyBinding: historyBindingOverride === null ? null
      : { ownerId: "owner-1", grantId: binding.grantId, scope, ...historyBindingOverride } } : {}) };
  const grant = { id: binding.grantId, version: 3, status: enabled ? "active" : "paused", starts_at: "2026-11-05T00:00:00.000Z",
    ends_at: "2099-11-05T00:00:00.000Z", source_ids: [...binding.spec.source_ids].sort(),
    scope: { class_id: scope.classId, subject: scope.subject }, domains: [domain], actions: ["update"],
    budget: { id: "budget-original", max_calls: 4 }, ...grantOverride };
  const ownerState = () => ({ ok: true, result: { root_ref: ownerRootRef, owner: ownerId ? { id: ownerId } : null,
    grants: grantMissing ? [] : [{ ...structuredClone(grant), ...(grant.version > 3 ? readbackOverride : {}) }] } });
  const host = {
    async call(operation, payload) {
      if (operation === "owner_read") {
        events.push({ operation, payload });
        if (beforeEnsure) {
          const changed = beforeEnsure({ grant, ownerId });
          if (changed && Object.hasOwn(changed, "ownerId")) ownerId = changed.ownerId;
          if (changed?.grantMissing !== undefined) grantMissing = changed.grantMissing;
          beforeEnsure = null;
        }
        return ownerState();
      }
      return { ok: true, result: { data_root_fingerprint: rootRef, capabilities: { g3_processor: "active",
        internal_timer: "active", ambient_planning: "active", owner_authorization: "active",
        owner_conversation: "active", owner_intent: "active", attention_delivery: "active", teacher_feedback: "active" } } };
    },
    async callOwnerControl(operation, payload) {
      events.push({ operation, payload });
      if (operation === "owner_read") return ownerState();
      assert.equal(operation, "owner_control");
      if (!updateOk) return { ok: false, error_code: "stale_source" };
      assert.equal(payload.expected_owner_id, ownerId);
      assert.equal(payload.grant_id, grant.id);
      assert.equal(payload.expected_version, grantMissing ? 0 : grant.version);
      grant.version = grantMissing ? 1 : grant.version + 1;
      grantMissing = false;
      if (payload.spec) Object.assign(grant, payload.spec, { source_ids: [...payload.spec.source_ids].sort() });
      if (payload.action === "create" || payload.action === "resume") grant.status = "active";
      if (payload.action === "pause") grant.status = "paused";
      return { ok: true, result: { owner_id: ownerId, grant_id: grant.id, grant_version: grant.version } };
    },
  };
  class RuntimeError extends Error { constructor(code) { super(code); this.code = code; } }
  const modules = {
    "node:util": { isDeepStrictEqual },
    "next/server": { NextResponse: { json: (body, options = {}) => Response.json(body, { status: options.status || 200 }) } },
    "@/lib/bounded-form-data": { parseJsonWithinLimit: request => request.json(), RequestBodyTooLargeError: class extends Error {} },
    "@/lib/desktop-api-auth": { isDesktopApiRequestAllowed: () => true },
    "@/lib/edupi-core-snapshot": { resolveEduPiBridgeRoots: () => ({ runtime: { root: "/isolated-core" },
      dataRoot: { root: "/isolated-parent-source", memoryDir: "/isolated-parent-source/.edupi/memory" } }),
      readEduPiEducationSnapshot: async () => ({ workspace: snapshot(sources) }) },
    "@/lib/edupi-generated-artifacts": { workspaceResourcesRequest: async () => ({ teacherMaterials: [] }) },
    "@/lib/edupi-proactivity-control": { ...control, readLessonReflectionHistorySourceIds: async input => {
      events.push({ operation: "history_read", payload: structuredClone(input) });
      assert.equal(domain, "lesson_reflection");
      assert.equal(input.ownerId, "owner-1");
      assert.equal(input.grant.id, grant.id);
      assert.deepEqual(input.scope, scope);
      if (historyError) throw new control.EduPiProactivityControlError("proactivity_response_invalid");
      if (afterHistory) {
        const changed = afterHistory({ grant, ownerId });
        if (changed?.ownerId) ownerId = changed.ownerId;
        if (changed?.grantMissing !== undefined) grantMissing = changed.grantMissing;
      }
      return historicalSources;
    } },
    "@/lib/edupi-proactivity-config": { readEduPiProactivityActivation: () => activation,
      writeEduPiProactivityConfig: (value, options) => {
        events.push({ operation: "config_write", payload: structuredClone(value) });
        activation = { ...activation, ...value, updatedAt: options.now };
      },
      writeEduPiProactivityStopIntent: value => { events.push({ operation: "stop_write", payload: value }); },
      clearEduPiProactivityStopIntent: () => { events.push({ operation: "stop_clear" }); } },
    "@/lib/edupi-proactivity-runtime": { ...runtime, EduPiProactivityRuntimeError: RuntimeError,
      ensureProactivityGrant: async (...args) => {
        events.push({ operation: "ensure_grant", payload: { binding: structuredClone(args[2]), expected: args[3] } });
        return runtime.ensureProactivityGrant(...args);
      },
      readProactivityRuntimeState: async () => ({ grant: { id: grant.id, status: grant.status }, execution: null }),
      proactivityRuntimeError: error => error?.code ? error : new RuntimeError("proactivity_runtime_unavailable") },
    "@/lib/edupi-runtime-supervisor": { ensureEduPiRuntime: async () => host,
      restartEduPiRuntime: async () => { events.push({ operation: "restart" }); return host; },
      quarantineEduPiRuntime: async () => { events.push({ operation: "quarantine" }); },
      clearEduPiRuntimeQuarantine: () => { events.push({ operation: "quarantine_clear" }); } },
    "@/lib/safe-mode": { canStartEduPiCapabilityDrafts: () => isolated,
      canStartEduPiProactivity: () => false, canStartEduPiStudentFollowup: () => false },
  };
  const route = { exports: {} };
  new Function("require", "module", "exports", compiled)(name => {
    assert.ok(Object.hasOwn(modules, name), `unexpected dependency ${name}`);
    return modules[name];
  }, route, route.exports);
  return { events, grant, get activation() { return activation; }, post: () => route.exports.POST(new Request("http://localhost/api/edupi/proactivity", {
    method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ enabled: true, domain,
      classId: scope.classId, subject: scope.subject, expectedUpdatedAt: activation.updatedAt }),
  })) };
}

function assertNoActivationWrites(current, previousActivation) {
  assert.deepEqual(current.activation, previousActivation);
  assert.deepEqual(current.events.filter(event => [
    "owner_control", "config_write", "stop_write", "stop_clear", "restart", "quarantine", "quarantine_clear",
  ].includes(event.operation)), []);
}

test("unchanged parent sources preserve the grant without a write", async () => {
  const current = fixture({ initialSources: ["source-1"] });
  assert.equal((await current.post()).status, 200);
  assert.equal(current.grant.version, 3);
  assert.equal(current.events.some(event => event.operation === "owner_control"), false);
});

test("source refresh uses CAS and preserves duration, budget and exact scope", async () => {
  const current = fixture({ initialSources: ["source-old"], sources: ["source-new"] });
  const before = structuredClone(current.grant);
  const response = await current.post();
  assert.equal(response.status, 200);
  assert.equal((await response.json()).externalSend, false);
  const write = current.events.find(event => event.operation === "owner_control");
  assert.equal(write.payload.expected_version, 3);
  assert.deepEqual(write.payload.spec.source_ids, [
    ...before.source_ids.filter(source => source !== "source-old"), "source-new",
  ]);
  for (const key of ["scope", "domains", "actions", "starts_at", "ends_at", "budget"]) {
    assert.deepEqual(current.grant[key], before[key]);
  }
  assert.equal(current.grant.version, 4);
});

test("foreign owners, failed CAS and changed readback never report refreshed authority", async () => {
  for (const options of [{ ownerId: "owner-other" }, { updateOk: false },
    { readbackOverride: { budget: { id: "budget-other", max_calls: 40 } } }]) {
    const current = fixture({ initialSources: ["source-old"], sources: ["source-new"], ...options });
    assert.equal((await current.post()).status, 409);
  }
  const unavailable = fixture({ initialSources: ["source-old"], sources: ["source-new"], isolated: false });
  assert.equal((await unavailable.post()).status, 409);
  assert.equal(unavailable.events.length, 0);
});

function reflectionWorkspace(sources) {
  return { timetable: sources.length ? [{ slot_id: "slot-1", class_id: scope.classId, subject: scope.subject,
    kind: "class", start_time: "08:00", time_zone: "Asia/Shanghai", source_ids: sources }] : [],
  fact_spine: { projection_kind: "education_fact_v1", external_send: false, entities: [
    { entity_id: scope.classId, entity_kind: "class", status: "active" },
    { entity_id: "term-1", entity_kind: "term", status: "active" },
  ], observations: [], accepted_facts: [], conflicts: [] } };
}

test("G4 refresh preserves its owner, scope, lifetime and budget and removes withdrawn sources", async () => {
  for (const sources of [["source-new"], []]) {
    const current = fixture({ domain: "lesson_reflection", snapshot: reflectionWorkspace,
      initialSources: ["source-old"], sources });
    const before = structuredClone(current.grant);
    assert.equal((await current.post()).status, 200);
    assert.equal(current.grant.version, 4);
    assert.deepEqual(current.grant.source_ids, control.capabilityGrantSourceIds("lesson_reflection", scope, reflectionWorkspace(sources)).sort());
    const write = current.events.find(event => event.operation === "owner_control");
    assert.equal(write.payload.expected_version, 3);
    assert.equal(write.payload.expected_owner_id, "owner-1");
    for (const key of ["scope", "domains", "actions", "starts_at", "ends_at", "budget"]) {
      assert.deepEqual(current.grant[key], before[key]);
    }
  }
});

test("unchanged G4 sources never renew or rewrite its grant", async () => {
  const current = fixture({ domain: "lesson_reflection", snapshot: reflectionWorkspace, initialSources: ["source-1"] });
  assert.equal((await current.post()).status, 200);
  assert.equal(current.grant.version, 3);
  assert.equal(current.events.some(event => event.operation === "owner_control"), false);
});

test("G4 refresh retains verified history sources after timetable removal without retaining unrelated grant sources", async () => {
  const historicalSources = ["source-old", "lesson-completion:history"];
  const current = fixture({ domain: "lesson_reflection", snapshot: reflectionWorkspace,
    initialSources: ["source-old"], sources: [], historicalSources,
    grantOverride: { source_ids: [...historicalSources, "source-foreign", "source-withdrawn"] } });
  const before = structuredClone(current.grant);
  assert.equal((await current.post()).status, 200);
  assert.deepEqual(current.grant.source_ids, [
    ...control.capabilityGrantSourceIds("lesson_reflection", scope, reflectionWorkspace([])), ...historicalSources,
  ].sort());
  for (const key of ["scope", "domains", "actions", "starts_at", "ends_at", "budget"]) {
    assert.deepEqual(current.grant[key], before[key]);
  }
  assert.equal(current.grant.version, 4);
});

test("G4 history read failures and combined source overflow prevent grant writes", async () => {
  for (const options of [
    { historyError: true },
    { historicalSources: Array.from({ length: 127 }, (_, index) => `history-${index}`) },
  ]) {
    const current = fixture({ domain: "lesson_reflection", snapshot: reflectionWorkspace,
      initialSources: ["source-old"], sources: ["source-new"], ...options });
    const response = await current.post();
    assert.ok(response.status >= 400);
    assert.equal(current.grant.version, 3);
    assert.equal(current.events.some(event => event.operation === "owner_control"), false);
  }
});

test("G4 refresh rejects foreign ownership, stale CAS, altered readback and invalid grants", async () => {
  for (const options of [
    { ownerId: "owner-other" }, { updateOk: false }, { isolated: false },
    { readbackOverride: { source_ids: ["forged"] } },
    { readbackOverride: { ends_at: "2099-12-01T00:00:00.000Z" } },
    { readbackOverride: { scope: { class_id: "class-other", subject: "math" } } },
    { grantOverride: { status: "paused" } },
    { grantOverride: { ends_at: "2026-01-01T00:00:00.000Z" } },
    { grantOverride: { domains: ["parent_communication"] } },
    { grantOverride: { actions: ["prepare", "update"] } },
  ]) {
    const current = fixture({ domain: "lesson_reflection", snapshot: reflectionWorkspace,
      initialSources: ["source-old"], sources: ["source-new"], ...options });
    assert.equal((await current.post()).status, 409);
  }
});

test("G4 re-enable preflights the paused grant and retains only verified history with current sources", async () => {
  const historicalSources = ["source-old", "lesson-completion:history"];
  const current = fixture({ domain: "lesson_reflection", snapshot: reflectionWorkspace, enabled: false,
    initialSources: ["source-old"], sources: ["source-new"], historicalSources,
    grantOverride: { source_ids: [...historicalSources, "source-unrelated", "source-withdrawn"] } });
  const response = await current.post();
  assert.equal(response.status, 200);
  assert.equal((await response.json()).activation.enabled, true);
  assert.equal(current.grant.status, "active");
  assert.deepEqual(current.grant.source_ids, [
    ...control.capabilityGrantSourceIds("lesson_reflection", scope, reflectionWorkspace(["source-new"])), ...historicalSources,
  ].sort());
  const historyIndex = current.events.findIndex(event => event.operation === "history_read");
  const updateIndex = current.events.findIndex(event => event.payload.action === "update");
  const ensure = current.events.find(event => event.operation === "ensure_grant");
  assert.deepEqual(ensure.payload.expected, { ownerId: "owner-1", grantVersion: 3 });
  assert.deepEqual(ensure.payload.binding.spec, current.events[updateIndex].payload.spec);
  assert.ok(historyIndex >= 0 && historyIndex < updateIndex);
  assert.equal(current.events[historyIndex].payload.grant.status, "paused");
  assert.equal(current.events[historyIndex].payload.grant.version, 3);
  assert.deepEqual(current.events[historyIndex].payload.grant.source_ids,
    [...historicalSources, "source-unrelated", "source-withdrawn"]);
  assert.equal(current.events[updateIndex].payload.expected_version, 3);
  assert.deepEqual(current.events.filter(event => event.operation === "owner_control").map(event => event.payload.action),
    ["update", "resume"]);
});

test("G4 re-enable deduplicates history before enforcing the 128 source limit", async () => {
  const currentSources = control.capabilityGrantSourceIds("lesson_reflection", scope, reflectionWorkspace(["source-new"]));
  const historicalSources = Array.from({ length: 128 - currentSources.length }, (_, index) => `history-${index}`);
  const current = fixture({ domain: "lesson_reflection", snapshot: reflectionWorkspace, enabled: false,
    initialSources: ["source-old"], sources: ["source-new"],
    historicalSources: [...historicalSources, ...historicalSources, ...currentSources],
    grantOverride: { source_ids: [...historicalSources, ...currentSources] } });
  assert.equal((await current.post()).status, 200);
  assert.equal(current.grant.source_ids.length, 128);
  assert.deepEqual(current.grant.source_ids, [...currentSources, ...historicalSources].sort());
});

test("G4 re-enable history failure and source overflow cannot update or resume the old grant", async context => {
  for (const [name, options, expectedCode] of [
    ["unreadable history", { historyError: true }, "proactivity_response_invalid"],
    ["129 distinct sources", {
      historicalSources: Array.from({ length: 127 }, (_, index) => `history-${index}`),
      grantOverride: { source_ids: Array.from({ length: 127 }, (_, index) => `history-${index}`) },
    }, "proactivity_source_capacity"],
    ["history outside old grant", { historicalSources: ["source-not-authorized"] }, "proactivity_response_invalid"],
  ]) {
    await context.test(name, async () => {
      const current = fixture({ domain: "lesson_reflection", snapshot: reflectionWorkspace, enabled: false,
        initialSources: ["source-old"], sources: ["source-new"], ...options });
      const before = structuredClone(current.grant);
      const previousActivation = structuredClone(current.activation);
      const response = await current.post();
      assert.ok(response.status >= 400);
      assert.equal((await response.json()).code, expectedCode);
      assert.deepEqual(current.grant, before);
      assert.equal(current.events.filter(event => event.operation === "history_read").length, 1);
      assertNoActivationWrites(current, previousActivation);
    });
  }
});

test("G4 re-enable rejects mismatched history owner, grant, scope and revoked authority before updating", async context => {
  for (const [name, options] of [
    ["current owner changed", { ownerId: "owner-other" }],
    ["root changed", { ownerRootRef: `sha256:${"b".repeat(64)}` }],
    ["history owner differs", { historyBindingOverride: { ownerId: "owner-other" } }],
    ["history grant differs", { historyBindingOverride: { grantId: "grant-other" } }],
    ["history class differs", { historyBindingOverride: { scope: { ...scope, classId: "class-other" } } }],
    ["history subject differs", { historyBindingOverride: { scope: { ...scope, subject: "english" } } }],
    ["history grant missing", { grantMissing: true }],
    ["grant revoked", { grantOverride: { status: "revoked" } }],
    ["grant active", { grantOverride: { status: "active" } }],
    ["grant version invalid", { grantOverride: { version: 0 } }],
    ["grant class differs", { grantOverride: { scope: { class_id: "class-other", subject: scope.subject } } }],
    ["grant subject differs", { grantOverride: { scope: { class_id: scope.classId, subject: "english" } } }],
    ["grant domain differs", { grantOverride: { domains: ["parent_communication"] } }],
    ["grant domain expanded", { grantOverride: { domains: ["lesson_reflection", "parent_communication"] } }],
    ["grant actions expanded", { grantOverride: { actions: ["prepare", "update"] } }],
    ["grant scope expanded", { grantOverride: { scope: { class_id: scope.classId, subject: scope.subject, student_id: "student-1" } } }],
    ["grant sources missing", { grantOverride: { source_ids: undefined } }],
    ["grant sources invalid", { grantOverride: { source_ids: ["source with spaces"] } }],
    ["grant sources duplicated", { grantOverride: { source_ids: ["source-old", "source-old"] } }],
    ["grant sources oversized", { grantOverride: { source_ids: Array.from({ length: 129 }, (_, index) => `source-${index}`) } }],
    ["grant start invalid", { grantOverride: { starts_at: "invalid" } }],
    ["grant end invalid", { grantOverride: { ends_at: "invalid" } }],
    ["grant lifetime reversed", { grantOverride: { ends_at: "2026-11-04T00:00:00.000Z" } }],
    ["grant budget missing", { grantOverride: { budget: undefined } }],
    ["grant budget id invalid", { grantOverride: { budget: { id: "", max_calls: 4 } } }],
    ["grant budget expanded", { grantOverride: { budget: { id: "budget-original", max_calls: 5 } } }],
    ["grant budget malformed", { grantOverride: { budget: { id: "budget-original", max_calls: "4" } } }],
    ["grant budget extra field", { grantOverride: { budget: { id: "budget-original", max_calls: 4, extra: true } } }],
  ]) {
    await context.test(name, async () => {
      const current = fixture({ domain: "lesson_reflection", snapshot: reflectionWorkspace, enabled: false,
        initialSources: ["source-old"], sources: ["source-new"], ...options });
      const previousActivation = structuredClone(current.activation);
      const previousGrant = structuredClone(current.grant);
      const response = await current.post();
      assert.equal(response.status, 409);
      assert.ok(["proactivity_scope_conflict", "proactivity_grant_denied"].includes((await response.json()).code));
      assert.deepEqual(current.grant, previousGrant);
      assert.equal(current.events.some(event => event.operation === "history_read"), false);
      assertNoActivationWrites(current, previousActivation);
    });
  }
});

test("G4 re-enable rejects owner and grant version changes during history reads", async context => {
  for (const [name, afterHistory] of [
    ["grant version changed", ({ grant }) => { grant.version++; }],
    ["owner changed", () => ({ ownerId: "owner-raced" })],
    ["grant deleted", () => ({ grantMissing: true })],
    ["grant revoked", ({ grant }) => { grant.status = "revoked"; }],
    ["grant sources changed without version", ({ grant }) => { grant.source_ids = ["source-forged"]; }],
    ["grant budget changed without version", ({ grant }) => { grant.budget.max_calls = 3; }],
  ]) {
    await context.test(name, async () => {
      const current = fixture({ domain: "lesson_reflection", snapshot: reflectionWorkspace, enabled: false,
        initialSources: ["source-old"], sources: ["source-new"], historicalSources: ["source-old"], afterHistory });
      const previousActivation = structuredClone(current.activation);
      const response = await current.post();
      assert.equal(response.status, 409);
      assert.equal((await response.json()).code, "proactivity_grant_denied");
      const historyIndex = current.events.findIndex(event => event.operation === "history_read");
      assert.ok(historyIndex >= 0);
      assert.ok(current.events.slice(historyIndex + 1).some(event => event.operation === "owner_read"));
      assertNoActivationWrites(current, previousActivation);
    });
  }
});

test("G4 re-enable rejects authority changes immediately before committing without rollback writes", async context => {
  for (const [name, beforeEnsure] of [
    ["grant version changed", ({ grant }) => { grant.version++; }],
    ["owner changed", () => ({ ownerId: "owner-raced" })],
    ["owner missing", () => ({ ownerId: null })],
    ["grant deleted", () => ({ grantMissing: true })],
    ["grant revoked", ({ grant }) => { grant.status = "revoked"; }],
    ["grant resumed", ({ grant }) => { grant.status = "active"; }],
  ]) {
    await context.test(name, async () => {
      const current = fixture({ domain: "lesson_reflection", snapshot: reflectionWorkspace, enabled: false,
        initialSources: ["source-old"], sources: ["source-new"], historicalSources: ["source-old"], beforeEnsure });
      const previousActivation = structuredClone(current.activation);
      const response = await current.post();
      assert.equal(response.status, 409);
      assert.equal((await response.json()).code, "proactivity_grant_denied");
      assert.equal(current.events.filter(event => event.operation === "history_read").length, 1);
      assertNoActivationWrites(current, previousActivation);
    });
  }
});

test("G4 first activation without a historical binding creates only the current bounded grant", async () => {
  const current = fixture({ domain: "lesson_reflection", snapshot: reflectionWorkspace, enabled: false,
    initialSources: ["source-new"], historyBindingOverride: null, grantMissing: true });
  assert.equal((await current.post()).status, 200);
  assert.deepEqual(current.grant.source_ids,
    control.capabilityGrantSourceIds("lesson_reflection", scope, reflectionWorkspace(["source-new"])).sort());
  assert.equal(current.events.some(event => event.operation === "history_read"), false);
  assert.deepEqual(current.events.filter(event => event.operation === "owner_control").map(event => event.payload.action), ["create"]);
});
