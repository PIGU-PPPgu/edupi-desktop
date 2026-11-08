import assert from "node:assert/strict";
import fs from "node:fs";
import test from "node:test";
import { isDeepStrictEqual } from "node:util";
import ts from "typescript";
import { createJiti } from "jiti";

const control = await createJiti(import.meta.url, { tsconfigPaths: true }).import("../../../../lib/edupi-proactivity-control.ts");
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
  isolated = true, readbackOverride = {} } = {}) {
  const events = [], domain = "parent_communication";
  const binding = control.buildCapabilityGrantBinding(domain, scope, workspace(initialSources));
  const activation = { enabled: true, source: "desktop_canary", configurationStatus: "ready", scope,
    grantId: binding.grantId, ownerId: "owner-1", updatedAt: "2026-11-05T00:00:00.000Z" };
  const grant = { id: binding.grantId, version: 3, status: "active", starts_at: "2026-11-05T00:00:00.000Z",
    ends_at: "2099-11-05T00:00:00.000Z", source_ids: [...binding.spec.source_ids].sort(),
    scope: { class_id: scope.classId, subject: scope.subject }, domains: [domain], actions: ["update"],
    budget: { id: "budget-original", max_calls: 4 } };
  const host = {
    async call() {
      return { ok: true, result: { data_root_fingerprint: rootRef, capabilities: { g3_processor: "active",
        internal_timer: "active", ambient_planning: "active", owner_authorization: "active",
        owner_conversation: "active", owner_intent: "active", attention_delivery: "active", teacher_feedback: "active" } } };
    },
    async callOwnerControl(operation, payload) {
      events.push({ operation, payload });
      if (operation === "owner_read") return { ok: true, result: { owner: { id: ownerId },
        grants: [{ ...structuredClone(grant), ...(grant.version > 3 ? readbackOverride : {}) }] } };
      assert.equal(operation, "owner_control");
      if (!updateOk) return { ok: false, error_code: "stale_source" };
      assert.equal(payload.expected_version, grant.version);
      grant.version++;
      Object.assign(grant, payload.spec, { source_ids: [...payload.spec.source_ids].sort() });
      return { ok: true, result: { grant_version: grant.version } };
    },
  };
  class RuntimeError extends Error { constructor(code) { super(code); this.code = code; } }
  const modules = {
    "node:util": { isDeepStrictEqual },
    "next/server": { NextResponse: { json: (body, options = {}) => Response.json(body, { status: options.status || 200 }) } },
    "@/lib/bounded-form-data": { parseJsonWithinLimit: request => request.json(), RequestBodyTooLargeError: class extends Error {} },
    "@/lib/desktop-api-auth": { isDesktopApiRequestAllowed: () => true },
    "@/lib/edupi-core-snapshot": { resolveEduPiBridgeRoots: () => ({ dataRoot: { root: "/isolated-parent-source" } }),
      readEduPiEducationSnapshot: async () => ({ workspace: workspace(sources) }) },
    "@/lib/edupi-generated-artifacts": { workspaceResourcesRequest: async () => ({ teacherMaterials: [] }) },
    "@/lib/edupi-proactivity-control": control,
    "@/lib/edupi-proactivity-config": { readEduPiProactivityActivation: () => activation },
    "@/lib/edupi-proactivity-runtime": { EduPiProactivityRuntimeError: RuntimeError,
      readProactivityRuntimeState: async () => ({ grant: { id: grant.id, status: grant.status }, execution: null }),
      proactivityRuntimeError: error => error?.code ? error : new RuntimeError("proactivity_runtime_unavailable") },
    "@/lib/edupi-runtime-supervisor": { ensureEduPiRuntime: async () => host },
    "@/lib/safe-mode": { canStartEduPiCapabilityDrafts: () => isolated,
      canStartEduPiProactivity: () => false, canStartEduPiStudentFollowup: () => false },
  };
  const route = { exports: {} };
  new Function("require", "module", "exports", compiled)(name => {
    assert.ok(Object.hasOwn(modules, name), `unexpected dependency ${name}`);
    return modules[name];
  }, route, route.exports);
  return { events, grant, post: () => route.exports.POST(new Request("http://localhost/api/edupi/proactivity", {
    method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ enabled: true, domain,
      classId: scope.classId, subject: scope.subject, expectedUpdatedAt: activation.updatedAt }),
  })) };
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
