import assert from "node:assert/strict";
import test from "node:test";
import { createJiti } from "jiti";

const runtime = await createJiti(import.meta.url, { tsconfigPaths: true }).import("./edupi-proactivity-runtime.ts");
const rootRef = `sha256:${"a".repeat(64)}`;
const binding = {
  grantId: "desktop_canary_1234",
  endsAt: "2026-09-30T08:00:00.000Z",
  spec: { scope: { class_id: "class-7-1", subject: "数学" }, domains: ["teaching_preparation"], actions: ["prepare", "update"],
    source_ids: [`conversation:${"b".repeat(64)}`], starts_at: "2026-09-23T07:59:00.000Z", ends_at: "2026-09-30T08:00:00.000Z",
    budget: { id: "budget-1", max_calls: 12 } },
};

test("bootstraps an owner and creates one bounded active grant", async () => {
  const calls = [];
  let owner = null;
  let grant = null;
  const host = {
    async call(operation, payload) {
      assert.equal(operation, "owner_read");
      calls.push([operation, payload]);
      return { ok: true, result: { root_ref: rootRef, owner, grants: grant ? [grant] : [] } };
    },
    async callOwnerControl(operation, payload) {
      assert.equal(operation, "owner_control");
      calls.push([operation, payload]);
      if (payload.action === "bootstrap") owner = { id: `owner_${"c".repeat(32)}` };
      if (payload.action === "create") grant = { id: binding.grantId, version: 1, status: "active", ends_at: binding.endsAt };
      return { ok: true, result: { owner_id: owner.id, grant_id: grant?.id || null, grant_version: grant?.version || null } };
    },
  };
  const result = await runtime.ensureProactivityGrant(host, rootRef, binding);
  assert.deepEqual(result, { ownerId: owner.id, grantId: binding.grantId, grantVersion: 1, status: "active", endsAt: binding.endsAt });
  assert.deepEqual(calls.map((item) => item[1].action || item[0]), ["owner_read", "bootstrap", "owner_read", "create", "owner_read"]);
  assert.equal(calls.find((item) => item[1].action === "create")[1].spec.budget.max_calls, 12);
});

test("updates and rereads a paused grant before resuming, then verifies its pause", async () => {
  const owner = { id: `owner_${"d".repeat(32)}` };
  let grant = { id: binding.grantId, version: 3, status: "paused", ends_at: "2026-09-25T00:00:00.000Z" };
  const actions = [];
  const reads = [];
  const host = {
    async call() {
      reads.push(grant.version);
      return { ok: true, result: { root_ref: rootRef, owner, grants: [{ ...grant }] } };
    },
    async callOwnerControl(_operation, payload) {
      actions.push(payload.action);
      assert.equal(payload.expected_version, grant.version);
      if (payload.action === "update") {
        assert.equal(grant.status, "paused");
        assert.equal(reads.at(-1), grant.version);
        assert.deepEqual(payload.spec, binding.spec);
        grant = { ...grant, version: 4, ends_at: binding.endsAt };
      }
      if (payload.action === "resume") {
        assert.equal(reads.at(-1), grant.version);
        assert.equal(grant.ends_at, binding.endsAt);
        grant = { ...grant, version: 5, status: "active" };
      }
      if (payload.action === "pause") grant = { ...grant, version: 6, status: "paused" };
      return { ok: true, result: { owner_id: owner.id, grant_id: grant.id, grant_version: grant.version } };
    },
  };
  const enabled = await runtime.ensureProactivityGrant(host, rootRef, binding);
  assert.deepEqual(enabled, { ownerId: owner.id, grantId: binding.grantId, grantVersion: 5, status: "active", endsAt: binding.endsAt });
  assert.deepEqual(actions, ["update", "resume"]);
  assert.deepEqual(reads, [3, 4, 5]);
  const paused = await runtime.pauseProactivityGrant(host, rootRef, binding.grantId);
  assert.deepEqual(paused, { state: "paused", grantVersion: 6 });
  assert.deepEqual(actions, ["update", "resume", "pause"]);
  assert.deepEqual(reads, [3, 4, 5, 5, 6]);
});

test("a preflight owner and grant version permits only the inspected paused grant to resume", async () => {
  const owner = { id: "owner-fixture" };
  const reflectionBinding = { ...binding, spec: { ...binding.spec, domains: ["lesson_reflection"],
    actions: ["update"], source_ids: ["source-current", "source-historical"] } };
  let grant = { id: binding.grantId, version: 3, status: "paused", ends_at: binding.endsAt };
  const actions = [];
  const host = {
    async call() {
      return { ok: true, result: { root_ref: rootRef, owner, grants: [{ ...grant }] } };
    },
    async callOwnerControl(_operation, payload) {
      actions.push(payload);
      assert.equal(payload.expected_owner_id, owner.id);
      assert.equal(payload.expected_version, grant.version);
      if (payload.action === "update") {
        assert.deepEqual(payload.spec.source_ids, ["source-current", "source-historical"]);
        grant = { ...grant, version: 4 };
      } else if (payload.action === "resume") {
        grant = { ...grant, version: 5, status: "active" };
      } else assert.fail(`unexpected mutation ${payload.action}`);
      return { ok: true, result: { owner_id: owner.id, grant_id: grant.id, grant_version: grant.version } };
    },
  };
  const result = await runtime.ensureProactivityGrant(host, rootRef, reflectionBinding,
    { ownerId: owner.id, grantVersion: 3 });
  assert.deepEqual(result, { ownerId: owner.id, grantId: binding.grantId, grantVersion: 5,
    status: "active", endsAt: binding.endsAt });
  assert.deepEqual(actions.map(payload => payload.action), ["update", "resume"]);
});

test("preflight owner and grant version changes reject before bootstrap, create, update or resume", async context => {
  const expectedOwner = { id: "owner-fixture" };
  const oldGrant = { id: binding.grantId, version: 3, status: "paused", ends_at: binding.endsAt };
  for (const [name, changed] of [
    ["newer grant", { grants: [{ ...oldGrant, version: 4 }] }],
    ["older grant", { grants: [{ ...oldGrant, version: 2 }] }],
    ["different owner", { owner: { id: "owner-other" } }],
    ["missing owner", { owner: null }],
    ["missing grant", { grants: [] }],
    ["different grant", { grants: [{ ...oldGrant, id: "grant-other" }] }],
    ["revoked grant", { grants: [{ ...oldGrant, status: "revoked" }] }],
  ]) {
    await context.test(name, async () => {
      let state = { owner: expectedOwner, grants: [{ ...oldGrant }], ...changed };
      const actions = [];
      const host = {
        async call() {
          return { ok: true, result: { root_ref: rootRef, ...structuredClone(state) } };
        },
        async callOwnerControl(_operation, payload) {
          actions.push(payload.action);
          if (payload.action === "bootstrap") {
            state.owner = expectedOwner;
            return { ok: true, result: { owner_id: expectedOwner.id, grant_id: null, grant_version: null } };
          }
          const previous = state.grants.find(grant => grant.id === binding.grantId);
          const next = { id: binding.grantId, version: (previous?.version || 0) + 1,
            status: payload.action === "resume" || payload.action === "create" ? "active" : previous.status,
            ends_at: binding.endsAt };
          state = { ...state, grants: [next] };
          return { ok: true, result: { owner_id: state.owner.id, grant_id: next.id, grant_version: next.version } };
        },
      };
      await assert.rejects(runtime.ensureProactivityGrant(host, rootRef, binding,
        { ownerId: expectedOwner.id, grantVersion: oldGrant.version }),
      error => ["proactivity_grant_denied", "proactivity_grant_revoked"].includes(error?.code));
      assert.deepEqual(actions, []);
    });
  }
});

test("update receipts must match the persisted owner and paused grant before resuming", async () => {
  const owner = { id: "owner-fixture" };
  const paused = { id: binding.grantId, version: 3, status: "paused", ends_at: "2026-09-25T00:00:00.000Z" };
  const updated = { ...paused, version: 4, ends_at: binding.endsAt };
  for (const current of [
    { owner, grants: [paused] },
    { owner, grants: [{ ...updated, version: 5 }] },
    { owner, grants: [{ ...updated, status: "active" }] },
    { owner, grants: [{ ...updated, status: "revoked" }] },
    { owner, grants: [{ ...updated, ends_at: paused.ends_at }] },
    { owner, grants: [] },
    { owner: { id: "another-owner" }, grants: [updated] },
  ]) {
    let applied = false;
    const actions = [];
    const host = {
      async call() {
        return { ok: true, result: { root_ref: rootRef, ...(applied ? current : { owner, grants: [paused] }) } };
      },
      async callOwnerControl(_operation, payload) {
        actions.push(payload.action);
        applied = true;
        return { ok: true, result: { owner_id: owner.id, grant_id: binding.grantId, grant_version: 4 } };
      },
    };
    await assert.rejects(runtime.ensureProactivityGrant(host, rootRef, binding),
      error => error?.code === "proactivity_response_invalid");
    assert.deepEqual(actions, ["update"]);
  }
});

test("a rejected update does not resume a paused grant", async () => {
  const actions = [];
  const grant = { id: binding.grantId, version: 3, status: "paused", ends_at: "2026-09-20T00:00:00.000Z" };
  const host = {
    async call() { return { ok: true, result: { root_ref: rootRef, owner: { id: "owner-fixture" }, grants: [grant] } }; },
    async callOwnerControl(_operation, payload) {
      actions.push(payload.action);
      throw Object.assign(new Error("authorization_expired"), { code: "authorization_expired" });
    },
  };
  await assert.rejects(runtime.ensureProactivityGrant(host, rootRef, binding), { code: "authorization_expired" });
  assert.deepEqual(actions, ["update"]);
  assert.equal(grant.version, 3);
});

test("a skipped or jumping update receipt never resumes the paused grant", async () => {
  const owner = { id: "owner-fixture" };
  const grant = { id: binding.grantId, version: 3, status: "paused", ends_at: binding.endsAt };
  for (const receiptVersion of [3, 5]) {
    const actions = [];
    const host = {
      async call() { return { ok: true, result: { root_ref: rootRef, owner, grants: [grant] } }; },
      async callOwnerControl(_operation, payload) {
        actions.push(payload.action);
        return { ok: true, result: { owner_id: owner.id, grant_id: grant.id, grant_version: receiptVersion } };
      },
    };
    await assert.rejects(runtime.ensureProactivityGrant(host, rootRef, binding),
      error => error?.code === "proactivity_response_invalid");
    assert.deepEqual(actions, ["update"]);
  }
});

test("a skipped or jumping create receipt is rejected before accepting a grant", async () => {
  const owner = { id: "owner-fixture" };
  for (const receiptVersion of [0, 2]) {
    const actions = [];
    const host = {
      async call() { return { ok: true, result: { root_ref: rootRef, owner, grants: [] } }; },
      async callOwnerControl(_operation, payload) {
        actions.push(payload.action);
        return { ok: true, result: { owner_id: owner.id, grant_id: binding.grantId, grant_version: receiptVersion } };
      },
    };
    await assert.rejects(runtime.ensureProactivityGrant(host, rootRef, binding),
      error => error?.code === "proactivity_response_invalid");
    assert.deepEqual(actions, ["create"]);
  }
});

test("a rejected resume leaves the updated grant paused", async () => {
  const owner = { id: "owner-fixture" };
  let grant = { id: binding.grantId, version: 3, status: "paused", ends_at: "2026-09-20T00:00:00.000Z" };
  const actions = [];
  const host = {
    async call() { return { ok: true, result: { root_ref: rootRef, owner, grants: [grant] } }; },
    async callOwnerControl(_operation, payload) {
      actions.push(payload.action);
      if (payload.action === "resume") throw Object.assign(new Error("stale_source"), { code: "stale_source" });
      grant = { ...grant, version: 4, ends_at: binding.endsAt };
      return { ok: true, result: { owner_id: owner.id, grant_id: grant.id, grant_version: grant.version } };
    },
  };
  await assert.rejects(runtime.ensureProactivityGrant(host, rootRef, binding), { code: "stale_source" });
  assert.deepEqual(actions, ["update", "resume"]);
  assert.deepEqual(grant, { id: binding.grantId, version: 4, status: "paused", ends_at: binding.endsAt });
});

test("resume receipts must match the persisted owner and active grant", async () => {
  const owner = { id: "owner-fixture" };
  const paused = { id: binding.grantId, version: 3, status: "paused", ends_at: binding.endsAt };
  const updated = { ...paused, version: 4 };
  const active = { ...updated, version: 5, status: "active" };
  for (const current of [
    { owner, grants: [updated] },
    { owner, grants: [{ ...active, version: 6 }] },
    { owner, grants: [{ ...active, status: "revoked" }] },
    { owner, grants: [{ ...active, ends_at: "2026-09-25T00:00:00.000Z" }] },
    { owner, grants: [] },
    { owner: { id: "another-owner" }, grants: [active] },
  ]) {
    const actions = [];
    const host = {
      async call() {
        return { ok: true, result: { root_ref: rootRef, ...(actions.includes("resume")
          ? current : { owner, grants: [actions.length ? updated : paused] }) } };
      },
      async callOwnerControl(_operation, payload) {
        actions.push(payload.action);
        return { ok: true, result: { owner_id: owner.id, grant_id: binding.grantId,
          grant_version: payload.action === "resume" ? 5 : 4 } };
      },
    };
    await assert.rejects(runtime.ensureProactivityGrant(host, rootRef, binding),
      error => error?.code === "proactivity_response_invalid");
    assert.deepEqual(actions, ["update", "resume"]);
  }
});

test("a skipped or jumping resume receipt is rejected", async () => {
  const owner = { id: "owner-fixture" };
  const paused = { id: binding.grantId, version: 3, status: "paused", ends_at: binding.endsAt };
  const updated = { ...paused, version: 4 };
  for (const receiptVersion of [4, 6]) {
    const actions = [];
    const host = {
      async call() {
        return { ok: true, result: { root_ref: rootRef, owner, grants: [actions.length ? updated : paused] } };
      },
      async callOwnerControl(_operation, payload) {
        actions.push(payload.action);
        return { ok: true, result: { owner_id: owner.id, grant_id: binding.grantId,
          grant_version: payload.action === "update" ? 4 : receiptVersion } };
      },
    };
    await assert.rejects(runtime.ensureProactivityGrant(host, rootRef, binding),
      error => error?.code === "proactivity_response_invalid");
    assert.deepEqual(actions, ["update", "resume"]);
  }
});

test("pause receipts must match the persisted owner and paused grant", async () => {
  const owner = { id: "owner-fixture" };
  const active = { id: binding.grantId, version: 3, status: "active", ends_at: binding.endsAt };
  const paused = { ...active, version: 4, status: "paused" };
  for (const current of [
    { owner, grants: [active] },
    { owner, grants: [{ ...paused, version: 5 }] },
    { owner, grants: [{ ...paused, status: "active" }] },
    { owner, grants: [{ ...paused, status: "revoked" }] },
    { owner, grants: [] },
    { owner: null, grants: [paused] },
    { owner: { id: "another-owner" }, grants: [paused] },
  ]) {
    let applied = false;
    const host = {
      async call() {
        return { ok: true, result: { root_ref: rootRef, ...(applied ? current : { owner, grants: [active] }) } };
      },
      async callOwnerControl(_operation, payload) {
        assert.equal(payload.action, "pause");
        assert.equal(payload.expected_version, active.version);
        applied = true;
        return { ok: true, result: { owner_id: owner.id, grant_id: active.id, grant_version: paused.version } };
      },
    };
    await assert.rejects(runtime.pauseProactivityGrant(host, rootRef, binding.grantId),
      error => error?.code === "proactivity_response_invalid");
  }
});

test("grant reads expose expiry and distinguish safe stop outcomes", async () => {
  const owner = { id: `owner_${"f".repeat(32)}` };
  const active = { id: binding.grantId, version: 2, status: "active", ends_at: "2026-09-24T00:00:00.000Z" };
  const budget = { grant_id: active.id, budget_id: "budget-1", used_calls: 3, max_calls: 12,
    remaining_calls: 9, exhausted: false, usage_unverified: false };
  const host = { async call() { return { ok: true, result: { root_ref: rootRef, owner, grants: [active], g1_model_budget: [budget] } }; } };
  assert.deepEqual(await runtime.readProactivityGrantStatus(host, rootRef, binding.grantId, Date.parse("2026-09-24T00:00:00.000Z")),
    { status: "expired", grantVersion: 2, endsAt: active.ends_at,
      modelBudget: { usedCalls: 3, maxCalls: 12, remainingCalls: 9, usageUnverified: false } });
  assert.equal((await runtime.readProactivityOwnerContext(host, rootRef, binding.grantId, Date.parse("2026-09-25T00:00:00.000Z"))).status, "expired");
  assert.deepEqual(await runtime.pauseProactivityGrant({ ...host, callOwnerControl: async () => { throw new Error("must not call"); } }, rootRef, "missing"),
    { state: "missing", grantVersion: null });
});

test("active grant budget is required and legacy unknown usage stays exhausted", async () => {
  const owner = { id: `owner_${"f".repeat(32)}` };
  const active = { id: binding.grantId, version: 2, status: "active", ends_at: binding.endsAt };
  const response = budget => ({ ok: true, result: { root_ref: rootRef, owner, grants: [active], g1_model_budget: budget } });
  await assert.rejects(runtime.readProactivityGrantStatus({ call: async () => response(undefined) }, rootRef, active.id),
    (error) => error?.code === "proactivity_response_invalid");
  const legacy = { grant_id: active.id, budget_id: "budget-1", used_calls: 0, max_calls: 12,
    remaining_calls: 0, exhausted: true, usage_unverified: true };
  assert.deepEqual((await runtime.readProactivityGrantStatus({ call: async () => response([legacy]) }, rootRef, active.id))?.modelBudget,
    { usedCalls: 0, maxCalls: 12, remainingCalls: 0, usageUnverified: true });
});

test("G2 status never presents G1 usage as a remaining student-followup budget", async () => {
  const owner = { id: "owner-fixture" };
  const g2 = { id: "desktop-student-followup", version: 1, status: "active", ends_at: "2099-01-01T00:00:00.000Z" };
  const g1 = { ...g2, id: binding.grantId };
  const g1Budget = { grant_id: g1.id, budget_id: "g1-budget", used_calls: 2, max_calls: 12,
    remaining_calls: 10, exhausted: false, usage_unverified: false };
  const host = { call: async () => ({ ok: true, result: { root_ref: rootRef, owner, grants: [g1, g2], g1_model_budget: [g1Budget] } }) };
  const status = await runtime.readProactivityGrantStatus(host, rootRef, g2.id, Date.parse("2026-10-04T00:00:00.000Z"), "student_followup");
  assert.deepEqual(status, { status: "active", grantVersion: 1, endsAt: g2.ends_at, modelBudget: null });
  assert.equal((await runtime.readProactivityGrantStatus(host, rootRef, g1.id)).modelBudget.remainingCalls, 10);
  await assert.rejects(runtime.readProactivityGrantStatus(host, rootRef, g2.id), error => error?.code === "proactivity_response_invalid",
    "G1 still requires its authoritative budget record");
});

test("G2 ensure and pause target only the independent student-followup grant", async () => {
  const g2Binding = { ...binding, grantId: "desktop-student-followup", spec: { ...binding.spec,
    domains: ["student_followup"], actions: ["update"], budget: { id: "g2-budget", max_calls: 4 } } };
  const owner = { id: "owner-fixture" };
  const g1 = { id: binding.grantId, version: 1, status: "active", ends_at: binding.endsAt };
  let g2 = null;
  const actions = [];
  const host = {
    async call() { return { ok: true, result: { root_ref: rootRef, owner, grants: g2 ? [g1, g2] : [g1] } }; },
    async callOwnerControl(_operation, payload) {
      assert.equal(payload.grant_id, g2Binding.grantId);
      actions.push(payload.action);
      if (payload.action === "create") {
        assert.deepEqual(payload.spec, g2Binding.spec);
        g2 = { id: g2Binding.grantId, version: 1, status: "active", ends_at: g2Binding.endsAt };
      } else if (payload.action === "pause") g2 = { ...g2, status: "paused", version: 2 };
      return { ok: true, result: { owner_id: owner.id, grant_id: g2.id, grant_version: g2.version } };
    },
  };
  await runtime.ensureProactivityGrant(host, rootRef, g2Binding);
  assert.deepEqual(await runtime.pauseProactivityGrant(host, rootRef, g2Binding.grantId), { state: "paused", grantVersion: 2 });
  assert.deepEqual(actions, ["create", "pause"]);
  assert.equal(g1.status, "active");
});

const g2Grant = { id: "g2-grant", version: 1, status: "paused", ends_at: "2099-01-01T00:00:00.000Z" };
const g2Budget = { grant_id: g2Grant.id, budget_id: "g2-budget", used_calls: 1, max_calls: 4,
  remaining_calls: 3, exhausted: false, usage_unverified: false };
const executionRecord = { execution_id: "g2_exec_1", follow_up_id: "follow-up-1", grant_id: g2Grant.id,
  status: "completed", attempt: 1, error_code: null, updated_at: "2026-10-05T00:00:00.000Z", source_status: "current" };
const g2Read = patch => ({ ok: true, result: { root_ref: rootRef, owner: { id: "owner-fixture" }, grants: [g2Grant],
  g2_model_budget: [g2Budget], g2_execution: { version: 1, available: true, revision: 2, records: [executionRecord], external_send: false }, ...patch } });

test("G2 budgets and execution records share one read and stay grant-scoped", async () => {
  const calls = [];
  const host = { call: async (operation, payload) => {
    calls.push([operation, payload]);
    return g2Read({ g2_execution: { ...g2Read().result.g2_execution, records: [executionRecord,
      { ...executionRecord, execution_id: "historical-2", grant_id: "older-grant", source_status: "historical" }] } });
  } };
  const state = await runtime.readProactivityRuntimeState(host, rootRef, g2Grant.id, "student_followup");
  assert.deepEqual(calls, [["owner_read", { root_ref: rootRef }]]);
  assert.deepEqual(state.grant.modelBudget, { usedCalls: 1, maxCalls: 4, remainingCalls: 3, usageUnverified: false });
  assert.deepEqual(state.execution.records, [{ executionId: "g2_exec_1", followUpId: "follow-up-1", grantId: g2Grant.id,
    status: "completed", attempt: 1, errorCode: null, updatedAt: executionRecord.updated_at, sourceStatus: "current" }]);
  const stopped = await runtime.readProactivityRuntimeState(host, rootRef, null, "student_followup");
  assert.equal(stopped.grant, null);
  assert.equal(stopped.execution.records.length, 2, "stopped execution records remain readable without inventing a grant binding");
});

test("unbound owner records make a selected-grant list unknown instead of falsely empty", async () => {
  for (const sourceStatus of ["unverified", "historical"]) {
    const host = { call: async () => g2Read({ g2_execution: { ...g2Read().result.g2_execution,
      records: [{ ...executionRecord, grant_id: null, source_status: sourceStatus }] } }) };
    const state = await runtime.readProactivityRuntimeState(host, rootRef, g2Grant.id, "student_followup");
    assert.deepEqual(state.execution, { version: 1, available: false, revision: null, records: [], externalSend: false });
    assert.equal((await runtime.readProactivityRuntimeState(host, rootRef, null, "student_followup")).execution.records.length, 1);
  }
});

test("G2 distinguishes absent, unavailable and empty execution projections", async () => {
  for (const projection of [undefined, { version: 1, available: false, revision: null, records: [], external_send: false },
    { version: 1, available: true, revision: 0, records: [], external_send: false }]) {
    const state = await runtime.readProactivityRuntimeState({ call: async () => g2Read({ g2_execution: projection }) }, rootRef, null, "student_followup");
    assert.equal(state.execution?.available ?? null, projection?.available ?? null);
  }
});

test("G2 budget validation preserves shared-journal overuse and fails closed on false counts", async () => {
  const readBudget = async budget => (await runtime.readProactivityGrantStatus({ call: async () => g2Read({ g2_model_budget: budget }) },
    rootRef, g2Grant.id, Date.now(), "student_followup"))?.modelBudget;
  assert.deepEqual(await readBudget([{ ...g2Budget, used_calls: 8, remaining_calls: 0, exhausted: true }]),
    { usedCalls: 8, maxCalls: 4, remainingCalls: 0, usageUnverified: false });
  assert.equal((await readBudget([{ ...g2Budget, used_calls: 0, usage_unverified: true, remaining_calls: 0, exhausted: true }])).usageUnverified, true);
  for (const budget of [[], [g2Budget, g2Budget], [{ ...g2Budget, max_calls: 12, remaining_calls: 11 }],
    [{ ...g2Budget, grant_id: "another-grant" }], [{ ...g2Budget, remaining_calls: 4 }]]) {
    await assert.rejects(readBudget(budget), error => error?.code === "proactivity_response_invalid");
  }
});

test("G2 execution rejects contradictory, duplicate or private records", async () => {
  const valid = g2Read().result.g2_execution;
  const changes = [{ available: false }, { revision: null }, { external_send: true }, { records: [executionRecord, executionRecord] },
    ...[{ draft: { text: "private" } }, { error_code: "/private/path" }, { updated_at: "yesterday" },
      { source_status: "unknown" }, { source_status: ["current"] }, { grant_id: null }, { attempt: 4 }, { status: "running" }, { status: ["queued"] }]
      .map(patch => ({ records: [{ ...executionRecord, ...patch }] }))];
  for (const patch of changes) await assert.rejects(runtime.readProactivityRuntimeState({ call: async () =>
    g2Read({ g2_execution: { ...valid, ...patch } }) }, rootRef, null, "student_followup"), error => error?.code === "proactivity_response_invalid");
});

test("activation catch-up cannot report success for denied or wholly blocked work", () => {
  const scan = (tasks, failures) => ({ ok: true, result: { tasks, failures } });
  assert.deepEqual(runtime.inspectProactivityCatchUp(scan([], [])), { queued: 0, needsAttention: false });
  assert.deepEqual(runtime.inspectProactivityCatchUp(scan([{ task_id: "task-1" }], [{ code: "excerpt_unconfirmed" }])),
    { queued: 1, needsAttention: true });
  assert.deepEqual(runtime.inspectProactivityCatchUp(scan([], [{ code: "completed_source_changed" }])),
    { queued: 0, needsAttention: true }, "Core verified the current source and retained an older completed draft for review");
  assert.throws(() => runtime.inspectProactivityCatchUp(scan([], [{ code: "excerpt_unconfirmed" }])),
    (error) => error?.code === "proactivity_preparation_blocked");
  assert.throws(() => runtime.inspectProactivityCatchUp(scan([], [{ code: "stale_source" }])),
    (error) => error?.code === "proactivity_preparation_blocked");
  assert.throws(() => runtime.inspectProactivityCatchUp(scan([], [{ code: "completed_source_changed" }, { code: "source_unavailable" }])),
    (error) => error?.code === "proactivity_preparation_blocked");
  assert.throws(() => runtime.inspectProactivityCatchUp(scan([{ task_id: "task-1" }], [{ code: "permission_denied" }])),
    (error) => error?.code === "proactivity_grant_denied");
  assert.throws(() => runtime.inspectProactivityCatchUp(scan([], [{ code: "budget_exhausted" }])),
    (error) => error?.code === "proactivity_budget_exhausted");
  assert.throws(() => runtime.inspectProactivityCatchUp({ ok: true, result: { tasks: [], failures: "hidden" } }),
    (error) => error?.code === "proactivity_response_invalid");
});

test("invalid, revoked, or mismatched owner responses fail closed", async () => {
  const bad = { call: async () => ({ ok: true, result: { root_ref: rootRef, owner: { id: "bad owner" }, grants: [] } }), callOwnerControl: async () => ({ ok: true }) };
  await assert.rejects(runtime.ensureProactivityGrant(bad, rootRef, binding), (error) => error?.code === "proactivity_response_invalid");
  const revoked = { call: async () => ({ ok: true, result: { root_ref: rootRef, owner: { id: `owner_${"e".repeat(32)}` }, grants: [{ id: binding.grantId, version: 2, status: "revoked", ends_at: binding.endsAt }] } }), callOwnerControl: async () => ({ ok: true }) };
  await assert.rejects(runtime.ensureProactivityGrant(revoked, rootRef, binding), (error) => error?.code === "proactivity_grant_revoked");
});
