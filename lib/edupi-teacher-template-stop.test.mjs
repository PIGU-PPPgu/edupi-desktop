import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { createJiti } from "jiti";

const jiti = createJiti(import.meta.url, { tsconfigPaths: true });
const { stopTeacherTemplates } = await jiti.import("./edupi-teacher-template-server.ts");
const { readEduPiTeacherTemplateConfig, writeEduPiTeacherTemplateConfig } = await jiti.import("./edupi-teacher-template-config.ts");
const rootRef = `sha256:${"a".repeat(64)}`;
async function fixture(t, mode) {
  const container = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), "edupi-template-stop-server-")));
  const dataRoot = path.join(container, "data"), stateDir = path.join(container, "state");
  fs.mkdirSync(dataRoot, { mode: 0o700 }); fs.mkdirSync(stateDir, { mode: 0o700 });
  const previous = process.env.PI_DESKTOP_STATE_DIR;
  process.env.PI_DESKTOP_STATE_DIR = stateDir;
  t.after(() => {
    if (previous === undefined) delete process.env.PI_DESKTOP_STATE_DIR;
    else process.env.PI_DESKTOP_STATE_DIR = previous;
    fs.rmSync(container, { recursive: true, force: true });
  });
  const at = new Date().toISOString(), order = [];
  const binding = { ownerId: "verified-owner", grantId: "desktop_teacher_template_stop",
    scope: { class_id: "class-1", subject: "数学" }, templateIds: ["selected-template"] };
  const first = await writeEduPiTeacherTemplateConfig({ enabled: true, binding, grantVersion: 1 }, { dataRoot, expectedUpdatedAt: null });
  const grant = { id: binding.grantId, scope: binding.scope, domains: ["calendar_administration"], actions: ["update"],
    source_ids: ["teacher_template:selected-template"], starts_at: at,
    ends_at: new Date(Date.now() + 86_400_000).toISOString(), budget: { id: "zero-template-budget", max_calls: 0 },
    version: 1, status: "active", updated_at: at };
  let revision = 1;
  const host = {
    dataRootFingerprint: rootRef,
    async call(operation) {
      order.push(operation);
      if (operation === "health") return { ok: true, result: { data_root_fingerprint: rootRef } };
      if (mode === "core-down") throw new Error("synthetic Core unavailable");
      assert.equal(operation, "owner_read");
      return { ok: true, result: { version: 1, root_ref: rootRef, revision,
        owner: { id: binding.ownerId, root_ref: rootRef, created_at: at, kind: "local_owner" }, grants: [structuredClone(grant)],
        control_available: true, received_at: new Date().toISOString(), apply: false, live_authority: false, external_send: false } };
    },
    async callOwnerControl(operation, command) {
      order.push(command.action);
      assert.equal(operation, "owner_control"); assert.equal(command.action, "pause");
      assert.equal(command.expected_owner_id, binding.ownerId); assert.equal(command.grant_id, binding.grantId);
      assert.equal(command.expected_version, 1);
      grant.status = "paused"; grant.version++; revision++;
      return { ok: true, result: { command_id: command.command_id, root_ref: rootRef, owner_id: binding.ownerId,
        grant_id: binding.grantId, grant_version: grant.version, revision, received_at: new Date().toISOString(),
        apply: false, live_authority: false, external_send: false } };
    },
  };
  let admitted = { ...host, admittedUpdatedAt: first.updatedAt }, fences = 0;
  const dependencies = {
    dataRoot: () => dataRoot,
    active: () => mode === "no-core" ? null : admitted,
    async fence(root, options) {
      fences++;
      order.push("fence");
      assert.equal(root, dataRoot); assert.deepEqual(options, { requireClosed: true });
      assert.equal(readEduPiTeacherTemplateConfig({ dataRoot }).config.enabled, false,
        "the production fence is called only after a durable local stop");
      if (mode === "close-failed" || mode === "final-close-failed" && fences === 2) throw new Error("synthetic host did not close");
      admitted = null;
      if (mode === "concurrent-enable" || mode === "concurrent-final-enable" && fences === 2) {
        const current = readEduPiTeacherTemplateConfig({ dataRoot }).config;
        await writeEduPiTeacherTemplateConfig({ enabled: true, binding, grantVersion: grant.version },
          { dataRoot, expectedUpdatedAt: current.updatedAt });
      }
    },
    clearFence() { order.push("clear-fence"); },
    roots: () => {
      if (mode === "no-core") throw new Error("Core must not be resolved to save a local stop");
      return { dataRoot: { root: dataRoot }, runtime: {} };
    },
    async runtime() {
      order.push("new-template-free-host");
      const config = readEduPiTeacherTemplateConfig({ dataRoot }).config;
      assert.equal(config.enabled, false);
      if (admitted) assert.equal(admitted.admittedUpdatedAt, config.updatedAt, "a stale resident host cannot satisfy ensure");
      return admitted ??= { ...host, admittedUpdatedAt: config.updatedAt };
    },
  };
  return { dataRoot, first, grant, order, run: () => stopTeacherTemplates(first.updatedAt, dependencies),
    ensure: () => dependencies.runtime(), get admitted() { return admitted; } };
}

test("production template stop persists false, closes the resident host, then pauses the independent Core grant", async t => {
  const f = await fixture(t);
  const result = await f.run();
  assert.equal(result.localStatus, "disabled"); assert.equal(result.runtimeStatus, "verified"); assert.equal(result.coreStatus, "paused");
  assert.equal(f.grant.status, "paused"); assert.equal(f.grant.version, 2);
  assert.ok(f.order.indexOf("fence") < f.order.indexOf("new-template-free-host"));
  assert.ok(f.order.indexOf("new-template-free-host") < f.order.indexOf("pause"));
  assert.equal(readEduPiTeacherTemplateConfig({ dataRoot: f.dataRoot }).config.enabled, false);
  assert.equal(f.admitted, null, "the earlier config revision's temporary host is retired");
  assert.equal(f.order.filter(item => item === "fence").length, 2);
  const fresh = await f.ensure();
  assert.equal(fresh.admittedUpdatedAt, result.updatedAt, "the next workspace/history ensure uses the final stop revision");
});
test("Core failure preserves the local stop and verified host closure while reporting remote unknown", async t => {
  const f = await fixture(t, "core-down"), result = await f.run();
  assert.equal(result.localStatus, "disabled"); assert.equal(result.runtimeStatus, "verified"); assert.equal(result.coreStatus, "unknown");
  assert.equal(f.grant.status, "active");
  assert.equal(readEduPiTeacherTemplateConfig({ dataRoot: f.dataRoot }).config.enabled, false);
});
test("failed resident-host closure cannot produce a safe-stop success or silently reopen admission", async t => {
  const f = await fixture(t, "close-failed"), result = await f.run();
  assert.equal(result.localStatus, "disabled"); assert.equal(result.runtimeStatus, "unknown"); assert.equal(result.coreStatus, "unknown");
  assert.ok(!f.order.includes("clear-fence")); assert.ok(!f.order.includes("new-template-free-host"));
});
test("a missing Core installation cannot prevent a private local stop", async t => {
  const f = await fixture(t, "no-core"), result = await f.run();
  assert.equal(result.localStatus, "disabled"); assert.equal(result.runtimeStatus, "verified"); assert.equal(result.coreStatus, "unknown");
  assert.ok(!f.order.includes("new-template-free-host"));
  assert.equal(readEduPiTeacherTemplateConfig({ dataRoot: f.dataRoot }).config.enabled, false);
});
test("a newer explicit configuration cannot receive a false disabled receipt", async t => {
  const f = await fixture(t, "concurrent-enable");
  await assert.rejects(f.run(), { code: "teacher_template_config_conflict" });
  assert.equal(readEduPiTeacherTemplateConfig({ dataRoot: f.dataRoot }).config.enabled, true);
  assert.equal(f.grant.status, "active", "the superseded stop must not pause the newer selection");
});
test("a failed final temporary-host drain cannot report the complete stop as verified", async t => {
  const f = await fixture(t, "final-close-failed"), result = await f.run();
  assert.equal(result.localStatus, "disabled"); assert.equal(result.runtimeStatus, "unknown"); assert.equal(result.coreStatus, "paused");
  assert.equal(f.order.filter(item => item === "clear-fence").length, 1, "only the earlier template-free inspection was admitted");
});
test("a newer selection during the final temporary-host drain cannot receive a disabled receipt", async t => {
  const f = await fixture(t, "concurrent-final-enable");
  await assert.rejects(f.run(), { code: "teacher_template_config_conflict" });
  assert.equal(readEduPiTeacherTemplateConfig({ dataRoot: f.dataRoot }).config.enabled, true);
  assert.equal(f.order.filter(item => item === "fence").length, 2);
});
