import assert from "node:assert/strict";
import crypto from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { execFileSync } from "node:child_process";
import { pathToFileURL } from "node:url";
import test from "node:test";
import { createJiti } from "jiti";

const jiti = createJiti(import.meta.url, { fsCache: false });
const api = await jiti.import("./edupi-teacher-template-runtime.ts");
const config = await jiti.import("./edupi-teacher-template-config.ts");
const at = "2026-11-18T00:00:00.000Z", end = "2026-12-18T00:00:00.000Z";
const rootRef = `sha256:${"a".repeat(64)}`;
const selectedId = "teacher-task-aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee";
const selection = () => ({ templateIds: [selectedId], scope: { class_id: "class-7-1", subject: "数学" }, endsAt: end });
const deferred = () => { let resolve, reject; const promise = new Promise((yes, no) => { resolve = yes; reject = no; }); return { promise, resolve, reject }; };
const frame = (operation, fields = {}) => ({ protocol: "edupi-desktop-bridge", protocol_version: 1,
  producer: "edupi-desktop", request_id: "template-test", operation, ...fields });
const command = (ownerId, value) => frame("command", { envelope: {
  external_send: false, teacher_review: { reviewer_id: ownerId }, command: value,
} });
const create = (ownerId, id = selectedId) => command(ownerId, { command_type: "create_task", task: {
  task_id: id, preparation_source: null, recurrence: { kind: "teacher_internal_materials" },
} });
function fixture(t) {
  const root = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), "edupi-teacher-template-runtime-")));
  fs.chmodSync(root, 0o700);
  const options = { dataRoot: path.join(root, "data"), stateDir: path.join(root, "state"), rootRef, now: at, expectedUpdatedAt: null };
  for (const directory of [options.dataRoot, options.stateDir]) fs.mkdirSync(directory, { mode: 0o700 });
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  return { root, options };
}
function fakeCore() {
  const state = { owner: null, grants: [], revision: 0, controlAvailable: true, calls: [], afterRead: null, afterControl: null };
  const ownerRead = () => ({ ok: true, result: { version: 1, root_ref: rootRef, owner: structuredClone(state.owner),
    revision: state.revision, control_available: state.controlAvailable, grants: structuredClone(state.grants),
    received_at: at, apply: false, live_authority: false, external_send: false } });
  const host = {
    async call(operation, payload) {
      assert.equal(operation, "owner_read"); assert.equal(payload.root_ref, rootRef);
      state.calls.push({ operation, payload: structuredClone(payload) });
      const result = ownerRead();
      if (state.afterRead) await state.afterRead(result);
      return result;
    },
    async callOwnerControl(operation, payload) {
      assert.equal(operation, "owner_control"); assert.equal(payload.root_ref, rootRef);
      state.calls.push({ operation, payload: structuredClone(payload) });
      let grant = state.grants.find(item => item.id === payload.grant_id);
      if (payload.action === "bootstrap") {
        assert.equal(state.owner, null); assert.equal(payload.expected_owner_id, null);
        state.owner = { id: "owner-test", root_ref: rootRef, kind: "local_owner", created_at: at };
      } else {
        assert.equal(payload.expected_owner_id, state.owner.id);
        assert.equal(payload.expected_version, grant?.version ?? 0);
        if (["create", "update"].includes(payload.action)) grant = {
          ...structuredClone(payload.spec), id: payload.grant_id, version: (grant?.version ?? 0) + 1,
          status: grant?.status ?? "active", updated_at: at,
        };
        else if (["resume", "pause"].includes(payload.action)) grant = {
          ...grant, status: payload.action === "resume" ? "active" : "paused", version: grant.version + 1, updated_at: at,
        };
        else assert.fail(`unexpected control ${payload.action}`);
        state.grants = [...state.grants.filter(item => item.id !== grant.id), grant];
      }
      state.revision++;
      const result = { ok: true, result: { command_id: payload.command_id, root_ref: rootRef, owner_id: state.owner.id,
        revision: state.revision, received_at: at, grant_id: grant?.id ?? null, grant_version: grant?.version ?? null,
        apply: false, live_authority: false, external_send: false } };
      state.afterControl?.(result);
      return result;
    },
  };
  return { host, state };
}

test("template task identity uses the same stable lower-case UUID as create_task", () => {
  assert.equal(api.teacherTemplateTaskId("AAAAAAAA-BBBB-4CCC-8DDD-EEEEEEEEEEEE"), selectedId);
  assert.throws(() => api.teacherTemplateTaskId("../not-a-request"), { code: "teacher_template_invalid_input" });
});

test("template startup proof uses only the supplied owner_read handle and a frozen config snapshot", async t => {
  const f = fixture(t), core = fakeCore();
  const first = await api.prepareEduPiTeacherTemplateGrant(core.host, selection(), f.options);
  const gate = deferred(), entered = deferred(), snapshot = structuredClone(first.config);
  const file = path.join(f.options.stateDir, config.EDUPI_TEACHER_TEMPLATE_CONFIG_FILE);
  fs.renameSync(file, `${file}.retained`);
  const count = core.state.calls.length;
  core.state.afterRead = async () => { entered.resolve(); await gate.promise; };
  const proofRead = api.readEduPiTeacherTemplateBindingProof({ call: core.host.call }, snapshot, f.options);
  await entered.promise;
  snapshot.binding.templateIds.push("later-unselected");
  snapshot.grantVersion = 99;
  gate.resolve();
  const proof = await proofRead;
  assert.deepEqual(proof.binding, first.binding);
  assert.equal(proof.grantVersion, 1);
  assert.equal(proof.updatedAt, first.config.updatedAt);
  assert.equal(proof.rootRef, rootRef);
  assert.ok(Object.isFrozen(proof) && Object.isFrozen(proof.binding));
  assert.deepEqual(core.state.calls.slice(count).map(item => item.operation), ["owner_read"]);
  assert.equal(fs.existsSync(file), false, "startup proof neither rereads nor recreates the config file");
});

test("template captured proof can be inspected after probe close but the live proof refuses newer grant state", async t => {
  const f = fixture(t), core = fakeCore();
  const first = await api.prepareEduPiTeacherTemplateGrant(core.host, selection(), f.options);
  const captured = await core.host.call("owner_read", { root_ref: rootRef });
  const before = core.state.calls.length;
  const proof = api.inspectEduPiTeacherTemplateBindingProof(first.config, captured, f.options);
  assert.deepEqual(proof.binding, first.binding);
  assert.equal(core.state.calls.length, before, "inspection makes no call through a closed probe");
  core.state.grants[0].status = "paused"; core.state.grants[0].version++;
  await assert.rejects(api.readEduPiTeacherTemplateBindingProof({ call: core.host.call }, first.config, f.options),
    { code: "teacher_template_grant_denied" });
  assert.throws(() => api.inspectEduPiTeacherTemplateBindingProof(first.config, captured,
    { ...f.options, rootRef: `sha256:${"b".repeat(64)}` }), { code: "teacher_template_response_invalid" });
  assert.throws(() => api.inspectEduPiTeacherTemplateBindingProof({ ...first.config, enabled: false }, captured, f.options),
    { code: "teacher_template_grant_denied" });
});

test("template grant preparation bootstraps real transport identity, uses a dedicated zero-model grant and rereads before private commit", async t => {
  const f = fixture(t), core = fakeCore(), input = selection();
  const result = await api.prepareEduPiTeacherTemplateGrant(core.host, input, f.options);
  assert.equal(result.binding.ownerId, core.state.owner.id);
  assert.deepEqual(Object.keys(result.binding).sort(), ["grantId", "ownerId", "scope", "templateIds"]);
  assert.deepEqual(core.state.calls.map(item => item.payload.action ?? item.operation),
    ["owner_read", "bootstrap", "owner_read", "create", "owner_read"]);
  const grant = core.state.grants[0];
  assert.deepEqual(grant.source_ids, [`teacher_template:${selectedId}`]);
  assert.deepEqual(grant.domains, ["calendar_administration"]);
  assert.deepEqual(grant.actions, ["update"]);
  assert.equal(grant.budget.max_calls, 0);
  assert.equal(result.grantVersion, 1);
  assert.deepEqual(config.readEduPiTeacherTemplateBinding(f.options), result.binding);
  input.templateIds.push("unselected"); input.scope.subject = "changed";
  assert.deepEqual(result.binding.templateIds, [selectedId]);
});

test("template preparation is idempotent across scope key order and explicitly selected ID order", async t => {
  const f = fixture(t), core = fakeCore();
  const first = await api.prepareEduPiTeacherTemplateGrant(core.host, { ...selection(), templateIds: [selectedId, "second-template"] }, f.options);
  const controls = core.state.calls.filter(item => item.operation === "owner_control").length;
  const second = await api.prepareEduPiTeacherTemplateGrant(core.host, { ...selection(),
    scope: { subject: "数学", class_id: "class-7-1" }, templateIds: ["second-template", selectedId] },
  { ...f.options, expectedUpdatedAt: first.config.updatedAt });
  assert.equal(second.binding.grantId, first.binding.grantId);
  assert.equal(core.state.calls.filter(item => item.operation === "owner_control").length, controls);
  assert.equal(core.state.grants.length, 1);
});

test("template preparation rejects absent, duplicate, broad or Core-invalid source selections before any Core mutation", async t => {
  const f = fixture(t);
  for (const input of [
    { ...selection(), templateIds: [] }, { ...selection(), templateIds: [selectedId, selectedId] },
    { ...selection(), templateIds: Array.from({ length: 41 }, (_, n) => `t-${n}`) },
    { ...selection(), allowAll: true }, { ...selection(), templateIds: ["x".repeat(112)] },
    { ...selection(), templateIds: ["folder/template"] }, { ...selection(), endsAt: at },
  ]) {
    const core = fakeCore();
    await assert.rejects(api.prepareEduPiTeacherTemplateGrant(core.host, input, f.options), { code: "teacher_template_invalid_input" });
    assert.equal(core.state.calls.length, 0);
  }
});

test("template grant control keeps CAS on renew and resume and refuses stale private config before touching Core", async t => {
  const f = fixture(t), core = fakeCore();
  const first = await api.prepareEduPiTeacherTemplateGrant(core.host, selection(), f.options);
  const grant = core.state.grants[0]; grant.status = "paused"; grant.version = 3;
  const paused = await config.writeEduPiTeacherTemplateConfig({ enabled: false, grantVersion: 3 },
    { ...f.options, expectedUpdatedAt: first.config.updatedAt });
  const renewed = await api.prepareEduPiTeacherTemplateGrant(core.host, { ...selection(), endsAt: "2027-01-18T00:00:00.000Z" },
    { ...f.options, expectedUpdatedAt: paused.updatedAt });
  const controls = core.state.calls.filter(item => item.operation === "owner_control").slice(-2);
  assert.deepEqual(controls.map(item => [item.payload.action, item.payload.expected_version]), [["update", 3], ["resume", 4]]);
  assert.equal(renewed.grantVersion, 5);
  const count = core.state.calls.length;
  await assert.rejects(api.prepareEduPiTeacherTemplateGrant(core.host, selection(), f.options), { code: "teacher_template_config_conflict" });
  assert.equal(core.state.calls.length, count);
});

test("template sequential selection keeps the first activation binding, uses one scope grant and preserves its longer expiry", async t => {
  const f = fixture(t), core = fakeCore();
  const first = await api.prepareEduPiTeacherTemplateGrant(core.host, selection(), f.options);
  const firstActivation = { root_ref: rootRef, owner_id: first.binding.ownerId, grant_id: first.binding.grantId, scope: first.binding.scope };
  const second = await api.prepareEduPiTeacherTemplateGrant(core.host, {
    ...selection(), templateIds: [selectedId, "second-template"], endsAt: "2026-12-01T00:00:00.000Z",
  }, { ...f.options, expectedUpdatedAt: first.config.updatedAt });
  assert.equal(second.binding.grantId, first.binding.grantId);
  assert.deepEqual({ root_ref: rootRef, owner_id: second.binding.ownerId, grant_id: second.binding.grantId, scope: second.binding.scope }, firstActivation);
  assert.equal(core.state.grants.length, 1);
  assert.deepEqual([...core.state.grants[0].source_ids].sort(), [`teacher_template:${selectedId}`, "teacher_template:second-template"].sort());
  assert.equal(core.state.grants[0].ends_at, end, "an earlier second template cannot truncate the first template's grant");
  assert.equal(second.grantVersion, 2);
  assert.equal(await api.ownerForSelectedTemplate(core.host, selectedId, f.options), first.binding.ownerId);
  const narrowed = await api.prepareEduPiTeacherTemplateGrant(core.host, {
    ...selection(), templateIds: ["second-template"], endsAt: "2026-12-01T00:00:00.000Z",
  }, { ...f.options, expectedUpdatedAt: second.config.updatedAt });
  assert.equal(narrowed.binding.grantId, first.binding.grantId);
  assert.equal(narrowed.grantVersion, 3);
  assert.deepEqual(core.state.grants[0].source_ids, ["teacher_template:second-template"]);
  assert.equal(core.state.grants[0].ends_at, end);
  assert.equal(await api.ownerForSelectedTemplate(core.host, selectedId, f.options), null);
});

test("template source expansion requires the exact prior private selection and grant version, never a matching unknown grant", async t => {
  const f = fixture(t), core = fakeCore();
  const first = await api.prepareEduPiTeacherTemplateGrant(core.host, selection(), f.options);
  const before = structuredClone(core.state.grants[0]), expand = { ...selection(), templateIds: [selectedId, "second-template"] };
  const controls = () => core.state.calls.filter(item => item.operation === "owner_control").length;
  const count = controls();
  core.state.grants[0].source_ids.push("teacher_template:second-template");
  await assert.rejects(api.prepareEduPiTeacherTemplateGrant(core.host, expand, { ...f.options, expectedUpdatedAt: first.config.updatedAt }),
    { code: "teacher_template_grant_denied" });
  core.state.grants[0] = { ...before, version: 2 };
  await assert.rejects(api.prepareEduPiTeacherTemplateGrant(core.host, expand, { ...f.options, expectedUpdatedAt: first.config.updatedAt }),
    { code: "teacher_template_grant_denied" });
  core.state.grants[0] = before;
  fs.unlinkSync(path.join(f.options.stateDir, config.EDUPI_TEACHER_TEMPLATE_CONFIG_FILE));
  await assert.rejects(api.prepareEduPiTeacherTemplateGrant(core.host, selection(), f.options), { code: "teacher_template_grant_denied" });
  assert.equal(controls(), count);
  assert.equal(config.readEduPiTeacherTemplateConfig(f.options).status, "missing");
});

test("template scope changes conflict before remote calls instead of replacing the prior selection", async t => {
  const f = fixture(t), core = fakeCore();
  const first = await api.prepareEduPiTeacherTemplateGrant(core.host, selection(), f.options);
  const count = core.state.calls.length;
  for (const scope of [{ class_id: "another-class", subject: "数学" }, { class_id: "class-7-1", subject: "语文" }]) {
    await assert.rejects(api.prepareEduPiTeacherTemplateGrant(core.host, { ...selection(), scope },
      { ...f.options, expectedUpdatedAt: first.config.updatedAt }), { code: "teacher_template_config_conflict" });
  }
  assert.equal(core.state.calls.length, count);
  assert.deepEqual(config.readEduPiTeacherTemplateBinding(f.options), first.binding);
});

test("template re-enable after an unconfirmed remote stop advances the still-active grant authority", async t => {
  const f = fixture(t), core = fakeCore();
  const first = await api.prepareEduPiTeacherTemplateGrant(core.host, selection(), f.options);
  const read = core.host.call;
  core.host.call = async () => { throw new Error("synthetic offline"); };
  const stopped = await api.pauseEduPiTeacherTemplateGrant(core.host, { ...f.options, expectedUpdatedAt: first.config.updatedAt });
  assert.equal(stopped.coreStatus, "unknown");
  assert.equal(core.state.grants[0].status, "active");
  core.host.call = read;
  const restored = await api.prepareEduPiTeacherTemplateGrant(core.host, selection(),
    { ...f.options, expectedUpdatedAt: stopped.config.updatedAt });
  assert.equal(restored.binding.grantId, first.binding.grantId);
  assert.equal(restored.grantVersion, 2, "local stop/re-enable cannot reuse the old proposal authority");
});

test("template close and explicit resume advance Core authority versions, keep history and reject stale private CAS", async t => {
  const f = fixture(t), core = fakeCore();
  const first = await api.prepareEduPiTeacherTemplateGrant(core.host, selection(), f.options);
  const stopped = await api.pauseEduPiTeacherTemplateGrant(core.host, { ...f.options, expectedUpdatedAt: first.config.updatedAt });
  assert.equal(stopped.coreStatus, "paused");
  assert.equal(stopped.localStatus, "disabled");
  assert.equal(stopped.runtimeStatus, "unknown", "no callback means runtime closure has not been verified");
  assert.equal(stopped.grantVersion, first.grantVersion + 1);
  assert.equal(stopped.config.grantVersion, stopped.grantVersion);
  assert.equal(config.readEduPiTeacherTemplateBinding(f.options), null);
  assert.deepEqual(config.readEduPiTeacherTemplateHistoryBinding(f.options), first.binding);
  const count = core.state.calls.length;
  await assert.rejects(api.pauseEduPiTeacherTemplateGrant(core.host, { ...f.options, expectedUpdatedAt: first.config.updatedAt }),
    { code: "teacher_template_config_conflict" });
  assert.equal(core.state.calls.length, count);
  const resumed = await api.prepareEduPiTeacherTemplateGrant(core.host, selection(), { ...f.options, expectedUpdatedAt: stopped.config.updatedAt });
  assert.equal(resumed.binding.grantId, first.binding.grantId);
  assert.equal(resumed.grantVersion, first.grantVersion + 2, "Core proposal authority contains grant_version and cannot reuse the prior version");
  assert.deepEqual(core.state.calls.filter(item => item.operation === "owner_control").slice(-2)
    .map(item => [item.payload.action, item.payload.expected_version]), [["pause", 1], ["resume", 2]]);
});

test("template close persists stop before the host callback and never rolls back after an unknown Core receipt", async t => {
  const f = fixture(t), core = fakeCore();
  const first = await api.prepareEduPiTeacherTemplateGrant(core.host, selection(), f.options);
  const calls = core.state.calls.length, order = [];
  const read = core.host.call;
  core.host.call = async (...args) => { order.push("owner_read"); return read(...args); };
  core.state.afterControl = value => { value.result.grant_version++; };
  const stopped = await api.pauseEduPiTeacherTemplateGrant(core.host, { ...f.options, expectedUpdatedAt: first.config.updatedAt,
    onLocalStop: async snapshot => {
      order.push("onLocalStop");
      assert.equal(core.state.calls.length, calls, "no remote call precedes the local stop callback");
      assert.equal(snapshot.enabled, false);
      assert.equal(config.readEduPiTeacherTemplateConfig(f.options).config.enabled, false);
      assert.notEqual(snapshot.updatedAt, first.config.updatedAt);
    },
  });
  assert.deepEqual(order, ["onLocalStop", "owner_read"]);
  assert.equal(stopped.localStatus, "disabled");
  assert.equal(stopped.runtimeStatus, "verified");
  assert.equal(stopped.coreStatus, "unknown");
  assert.equal(stopped.grantVersion, null);
  assert.equal(config.readEduPiTeacherTemplateConfig(f.options).config.enabled, false);
});

test("template close remains locally disabled and closes the host before a delayed Core failure settles", async t => {
  const f = fixture(t), core = fakeCore();
  const first = await api.prepareEduPiTeacherTemplateGrant(core.host, selection(), f.options);
  const entered = deferred(), timeout = deferred();
  let closed = false;
  core.state.afterRead = async () => { entered.resolve(); await timeout.promise; };
  const stopping = api.pauseEduPiTeacherTemplateGrant(core.host, {
    ...f.options, expectedUpdatedAt: first.config.updatedAt, onLocalStop: async () => { closed = true; },
  });
  await entered.promise;
  assert.equal(closed, true, "the Core deadline cannot delay the trusted local host stop");
  assert.equal(config.readEduPiTeacherTemplateConfig(f.options).config.enabled, false);
  assert.equal(config.readEduPiTeacherTemplateBinding(f.options), null);
  timeout.reject(new Error("synthetic Core deadline"));
  const stopped = await stopping;
  assert.equal(stopped.localStatus, "disabled");
  assert.equal(stopped.runtimeStatus, "verified");
  assert.equal(stopped.coreStatus, "unknown");
  assert.equal(stopped.config.enabled, false);
});

test("template close reports host-stop failure independently of confirmed Core pause", async t => {
  const f = fixture(t), core = fakeCore();
  const first = await api.prepareEduPiTeacherTemplateGrant(core.host, selection(), f.options);
  const stopped = await api.pauseEduPiTeacherTemplateGrant(core.host, {
    ...f.options, expectedUpdatedAt: first.config.updatedAt,
    onLocalStop: async () => { throw new Error("synthetic host still active"); },
  });
  assert.equal(stopped.localStatus, "disabled");
  assert.equal(stopped.runtimeStatus, "unknown");
  assert.equal(stopped.coreStatus, "paused");
  assert.equal(stopped.config.enabled, false);
});

test("template close does not pause or overwrite a newer explicit config mutation after local stop", async t => {
  const f = fixture(t), core = fakeCore();
  const first = await api.prepareEduPiTeacherTemplateGrant(core.host, selection(), f.options);
  const calls = core.state.calls.length;
  const stopped = await api.pauseEduPiTeacherTemplateGrant(core.host, {
    ...f.options, expectedUpdatedAt: first.config.updatedAt,
    onLocalStop: async snapshot => {
      await config.writeEduPiTeacherTemplateConfig({ enabled: true, binding: first.binding, grantVersion: first.grantVersion },
        { ...f.options, expectedUpdatedAt: snapshot.updatedAt });
    },
  });
  assert.equal(stopped.localStatus, "superseded");
  assert.equal(stopped.coreStatus, "unknown");
  assert.equal(core.state.calls.length, calls);
  assert.equal(config.readEduPiTeacherTemplateConfig(f.options).config.enabled, true, "only the newer caller re-enabled it");
});

test("template owner lookup rechecks current grant, exact scope, version, independent domain/action and source set on every request", async t => {
  const f = fixture(t), core = fakeCore();
  const prepared = await api.prepareEduPiTeacherTemplateGrant(core.host, selection(), f.options);
  assert.equal(await api.ownerForSelectedTemplate(core.host, "not-selected", f.options), null);
  assert.equal(await api.ownerForSelectedTemplate(core.host, selectedId, f.options), prepared.binding.ownerId);
  const good = structuredClone(core.state.grants[0]);
  for (const changed of [
    { status: "paused" }, { status: "revoked" }, { version: 2 }, { ends_at: at, starts_at: "2026-11-17T00:00:00.000Z" },
    { starts_at: "2026-11-19T00:00:00.000Z" }, { updated_at: "2026-11-19T00:00:00.000Z" },
    { scope: { ...good.scope, class_id: "another-class" } }, { domains: ["teaching_preparation"] },
    { actions: ["prepare", "update"] }, { source_ids: ["teacher_template:another-template"] },
    { source_ids: [...good.source_ids, "teacher_template:unselected"] }, { budget: { ...good.budget, max_calls: 1 } },
  ]) {
    core.state.grants[0] = { ...good, ...changed };
    await assert.rejects(api.ownerForSelectedTemplate(core.host, selectedId, f.options), { code: "teacher_template_grant_denied" });
  }
  core.state.grants[0] = good; core.state.owner.id = "owner-changed";
  await assert.rejects(api.ownerForSelectedTemplate(core.host, selectedId, f.options), { code: "teacher_template_grant_denied" });
});

test("template preparation leaves G1 and other domain grants unchanged and cannot borrow their identities", async t => {
  const f = fixture(t), core = fakeCore();
  const prepared = await api.prepareEduPiTeacherTemplateGrant(core.host, selection(), f.options);
  const borrowed = { ...structuredClone(core.state.grants[0]), id: "existing-g1-grant",
    domains: ["teaching_preparation"], actions: ["prepare", "update"], source_ids: ["conversation:existing"], budget: { id: "g1-budget", max_calls: 12 } };
  core.state.grants.push(borrowed);
  const baseline = JSON.stringify(borrowed);
  await api.prepareEduPiTeacherTemplateGrant(core.host, selection(), { ...f.options, expectedUpdatedAt: prepared.config.updatedAt });
  assert.equal(JSON.stringify(core.state.grants.find(item => item.id === borrowed.id)), baseline);
  const current = config.readEduPiTeacherTemplateConfig(f.options).config;
  await config.writeEduPiTeacherTemplateConfig({ enabled: true, binding: { ...prepared.binding, grantId: borrowed.id }, grantVersion: 1 },
    { ...f.options, expectedUpdatedAt: current.updatedAt });
  await assert.rejects(api.ownerForSelectedTemplate(core.host, selectedId, f.options), { code: "teacher_template_grant_denied" });
  assert.equal(JSON.stringify(core.state.grants.find(item => item.id === borrowed.id)), baseline);
});

test("template preparation refuses forged success metadata and wrong Core root without publishing a binding", async t => {
  const f = fixture(t);
  const core = fakeCore();
  core.state.afterControl = value => { value.result.live_authority = true; };
  await assert.rejects(api.prepareEduPiTeacherTemplateGrant(core.host, selection(), f.options), { code: "teacher_template_response_invalid" });
  assert.equal(config.readEduPiTeacherTemplateConfig(f.options).status, "missing");
  core.state.afterRead = value => { value.result.root_ref = `sha256:${"b".repeat(64)}`; };
  await assert.rejects(api.prepareEduPiTeacherTemplateGrant(core.host, selection(), f.options), { code: "teacher_template_response_invalid" });
  assert.equal(config.readEduPiTeacherTemplateBinding(f.options), null);
});

test("template owner routing permits only selected template commands and the three Core protected read paths", async t => {
  const f = fixture(t), core = fakeCore();
  const { binding } = await api.prepareEduPiTeacherTemplateGrant(core.host, selection(), f.options);
  const artifactRead = frame("preparation-artifacts", { action: "read", input: { artifact_id: `artifact_${"a".repeat(32)}`, revision: 1 } });
  for (const request of [frame("snapshot"), frame("generated-artifacts", { action: "list" }), artifactRead,
    create(binding.ownerId), command(binding.ownerId, { command_type: "review_task", task_id: selectedId, expected_revision: 1, decision: "accept" }),
    command(binding.ownerId, { command_type: "review_task", task_id: selectedId, expected_revision: 1, decision: "modify", patch: { title: "explicit edit" } }),
    command(binding.ownerId, { command_type: "move_task_stage", task_id: selectedId, expected_revision: 1, to_stage: "progress" }),
  ]) {
    const before = JSON.stringify(request);
    assert.equal(api.isOwnerAuthorizedTemplateBridge(request, binding), true);
    assert.equal(await api.ownerForTeacherTemplateBridge(core.host, request, f.options), binding.ownerId);
    assert.equal(JSON.stringify(request), before, "routing preserves the Core envelope, CAS and any proposal reference");
  }
  const count = core.state.calls.length;
  for (const request of [frame("health"), frame("workspace-resources"), frame("classroom", { action: "save" }),
    frame("delete", { action: "delete", target_kind: "task", target_id: selectedId }),
    frame("generated-artifacts", { action: "register" }), { ...artifactRead, action: "revise" },
    create(binding.ownerId, "not-selected"), create("not-the-owner"),
    command(binding.ownerId, { command_type: "review_work_candidate", candidate_id: "unknown-to-binding", decision: "accept" }),
    command(binding.ownerId, { command_type: "review_task", task_id: selectedId, decision: "modify", patch: {} }),
    { ...frame("snapshot"), action: "mutate" }, frame("owner_teacher_template_feedback", { action: "accept" }),
  ]) {
    assert.equal(api.isOwnerAuthorizedTemplateBridge(request, binding), false, JSON.stringify(request));
    assert.equal(await api.ownerForTeacherTemplateBridge(core.host, request, f.options), null);
  }
  assert.equal(core.state.calls.length, count, "unrelated frames never receive owner lookup or control");
});

test("template stopped/revoked history retains owner read and reducing stop but cannot resume or create", async t => {
  const f = fixture(t), core = fakeCore();
  const { config: saved, binding } = await api.prepareEduPiTeacherTemplateGrant(core.host, selection(), f.options);
  await config.writeEduPiTeacherTemplateConfig({ enabled: false }, { ...f.options, expectedUpdatedAt: saved.updatedAt });
  core.state.grants[0].status = "revoked"; core.state.grants[0].version++;
  assert.equal(await api.ownerForTeacherTemplateBridge(core.host, frame("snapshot"), f.options), binding.ownerId);
  const stop = command(binding.ownerId, { command_type: "move_task_stage", task_id: selectedId, expected_revision: 1, to_stage: "done" });
  assert.equal(await api.ownerForTeacherTemplateBridge(core.host, stop, f.options), binding.ownerId);
  assert.equal(await api.ownerForTeacherTemplateBridge(core.host, create(binding.ownerId), f.options), null);
  assert.equal(await api.ownerForTeacherTemplateBridge(core.host, command(binding.ownerId, {
    command_type: "move_task_stage", task_id: selectedId, expected_revision: 2, to_stage: "progress",
  }), f.options), null);
  core.state.owner.id = "different-owner";
  await assert.rejects(api.ownerForTeacherTemplateBridge(core.host, frame("snapshot"), f.options), { code: "teacher_template_grant_denied" });
});

test("template owner lookup fences a config stop while Core is reading and a transport that ignores cancellation", async t => {
  const f = fixture(t), core = fakeCore();
  const { config: saved } = await api.prepareEduPiTeacherTemplateGrant(core.host, selection(), f.options);
  const gate = deferred(), entered = deferred();
  core.state.afterRead = async () => { entered.resolve(); await gate.promise; };
  const pending = api.ownerForSelectedTemplate(core.host, selectedId, f.options);
  await entered.promise;
  await config.writeEduPiTeacherTemplateConfig({ enabled: false }, { ...f.options, expectedUpdatedAt: saved.updatedAt });
  gate.resolve();
  await assert.rejects(pending, { code: "teacher_template_grant_denied" });
  core.state.afterRead = null;
  const stopped = config.readEduPiTeacherTemplateConfig(f.options).config;
  await api.prepareEduPiTeacherTemplateGrant(core.host, selection(), { ...f.options, expectedUpdatedAt: stopped.updatedAt });
  const cancel = new AbortController(), waiting = deferred(), reading = deferred();
  core.state.afterRead = async () => { reading.resolve(); await waiting.promise; };
  const cancelled = api.ownerForSelectedTemplate(core.host, selectedId, { ...f.options, signal: cancel.signal });
  await reading.promise; cancel.abort(new Error("synthetic cancellation")); waiting.resolve();
  await assert.rejects(cancelled, /synthetic cancellation/);
});

test("template helpers use the exact fc89 Core binding validator and authenticated authorization store without models or a server", {
  skip: !process.env.EDUPI_TEACHER_TEMPLATE_CORE_ROOT, timeout: 30_000,
}, async t => {
  const coreRoot = fs.realpathSync(process.env.EDUPI_TEACHER_TEMPLATE_CORE_ROOT);
  const git = (...args) => execFileSync("git", ["-C", coreRoot, ...args], { encoding: "utf8" }).trim();
  const tree = git("rev-parse", "fc89b3bc899a55b0fdad61b8f37e238d950f37c6^{tree}");
  assert.equal(git("rev-parse", "HEAD^{tree}"), tree);
  assert.equal(git("status", "--porcelain", "--untracked-files=no"), "");
  const coreModule = name => import(pathToFileURL(path.join(coreRoot, "scripts", name)).href);
  const [{ prepareCoreRuntimeRoot }, { acquireCoreRuntimeWriterAdmission }, { createAmbientAuthorizationStore },
    { validateCoreRuntimeG3BindingOptions }] = await Promise.all([
    coreModule("core_runtime_root.mjs"), coreModule("core_runtime_writer_admission.mjs"),
    coreModule("ambient_authorization_store.mjs"), coreModule("core_runtime_g3_binding.mjs"),
  ]);
  const f = fixture(t), prepared = prepareCoreRuntimeRoot(f.options.dataRoot);
  assert.equal(prepared.ok, true);
  let admission;
  const calls = [];
  try {
    admission = await acquireCoreRuntimeWriterAdmission({ root: prepared, kind: "legacy_ambient_authorization_test" });
    const store = createAmbientAuthorizationStore({ root: prepared, macKey: crypto.randomBytes(32),
      verifyControl: token => token === "synthetic-template-owner", clock: () => at });
    const actor = store.authorizeControl("synthetic-template-owner");
    const host = {
      async call(operation, payload) { assert.equal(operation, "owner_read"); calls.push(operation); return { ok: true, result: store.read(payload) }; },
      async callOwnerControl(operation, payload) { assert.equal(operation, "owner_control"); calls.push(operation); return { ok: true, result: store.control(payload, actor) }; },
    };
    const options = { ...f.options, rootRef: prepared.dataRootFingerprint };
    const result = await api.prepareEduPiTeacherTemplateGrant(host, selection(), options);
    assert.notEqual(result.config.dataRootHash, prepared.dataRootFingerprint, "Desktop path hash is not Core filesystem identity");
    const validated = validateCoreRuntimeG3BindingOptions({ allowedBindings: [], teacherTemplates: result.binding });
    assert.deepEqual(validated.teacherTemplates, result.binding);
    assert.throws(() => validateCoreRuntimeG3BindingOptions({ allowedBindings: [], teacherTemplates: { ...result.binding, grantVersion: 1 } }),
      { code: "invalid_g3_live_options" });
    assert.equal(await api.ownerForSelectedTemplate(host, selectedId, options), result.binding.ownerId);
    assert.equal((await api.readEduPiTeacherTemplateBindingProof({ call: host.call }, result.config, options)).grantVersion, 1);
    const captured = await host.call("owner_read", { root_ref: options.rootRef });
    assert.deepEqual(api.inspectEduPiTeacherTemplateBindingProof(result.config, captured, options).binding, result.binding);
    const second = await api.prepareEduPiTeacherTemplateGrant(host, { ...selection(),
      templateIds: [selectedId, "second-template"], endsAt: "2026-12-01T00:00:00.000Z" },
    { ...options, expectedUpdatedAt: result.config.updatedAt });
    assert.equal(second.binding.grantId, result.binding.grantId);
    assert.deepEqual(store.read().grants[0].source_ids, [`teacher_template:${selectedId}`, "teacher_template:second-template"].sort());
    assert.equal(store.read().grants[0].ends_at, end);
    const current = store.read().grants[0];
    assert.equal(current.budget.max_calls, 0);
    const paused = await api.pauseEduPiTeacherTemplateGrant(host, { ...options, expectedUpdatedAt: second.config.updatedAt });
    assert.equal(paused.coreStatus, "paused"); assert.equal(paused.grantVersion, 3);
    assert.equal(await api.ownerForSelectedTemplate(host, selectedId, options), null);
    assert.equal(await api.ownerForTeacherTemplateBridge(host, frame("snapshot"), options), result.binding.ownerId);
    const resumed = await api.prepareEduPiTeacherTemplateGrant(host, { ...selection(), templateIds: [selectedId, "second-template"] },
      { ...options, expectedUpdatedAt: paused.config.updatedAt });
    assert.equal(resumed.grantVersion, 4);
    assert.equal(store.read().grants[0].version, 4);
    assert.ok(calls.every(operation => ["owner_read", "owner_control"].includes(operation)));
    t.diagnostic(`Core tree ${tree}; authenticated grant and binding checked; model calls 0; no server started`);
  } finally {
    if (admission) await admission.release();
    fs.rmSync(f.root, { recursive: true, force: true });
    assert.equal(fs.existsSync(f.root), false, "owned Core/config temporary roots are removed");
  }
});
