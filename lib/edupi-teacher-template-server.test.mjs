import assert from "node:assert/strict";
import fs from "node:fs";
import test from "node:test";
import ts from "typescript";
import { createJiti } from "jiti";

const configApi = await createJiti(import.meta.url).import("./edupi-teacher-template-config.ts");
const rootRef = `sha256:${"a".repeat(64)}`;
const clientRequestId = "11111111-1111-4111-8111-111111111111";
const templateId = `teacher-task-${clientRequestId}`;
function setup({ config = null, status = "ready", canonicalClass = "class-1", changedRoot = false, storageReady = true } = {}) {
  const calls = [], root = { dataRoot: { root: "/private/synthetic-root" }, runtime: {} };
  let saved = config;
  const host = {
    async call(operation) { calls.push(operation); return { ok: true, result: { data_root_fingerprint: rootRef } }; },
    async callOwnerControl() { throw new Error("unexpected owner mutation outside selection helper"); },
  };
  const modules = {
    "./edupi-core-snapshot": {},
    "./edupi-runtime-supervisor": {},
    "./edupi-core-root": {},
    "./edupi-teacher-template-storage": {},
    "./edupi-teacher-template-config": { ...configApi, readEduPiTeacherTemplateConfig: () => ({ status, config: saved }) },
    "./edupi-teacher-template-runtime": {
      teacherTemplateTaskId: id => `teacher-task-${id}`,
      async ownerForSelectedTemplate(_host, id, options) {
        calls.push(["proof", id, options]);
        return saved.binding.ownerId;
      },
      async prepareEduPiTeacherTemplateGrant(_host, selection, options) {
        calls.push(["prepare", selection, options]);
        saved = { enabled: true, updatedAt: "2026-11-18T00:00:00.001Z",
          binding: { ownerId: "verified-owner", grantId: "independent-grant", ...selection } };
        return saved;
      },
    },
  };
  const source = ts.transpileModule(fs.readFileSync(new URL("./edupi-teacher-template-server.ts", import.meta.url), "utf8"),
    { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText;
  const evaluated = { exports: {} };
  new Function("require", "module", "exports", source)(name => {
    if (!modules[name]) throw new Error(`unexpected import: ${name}`); return modules[name];
  }, evaluated, evaluated.exports);
  const dependencies = {
    assertStorage: async (_roots, reference) => {
      assert.equal(reference, rootRef);
      if (!storageReady) throw new configApi.EduPiTeacherTemplateError("teacher_template_runtime_upgrade_required");
    },
    roots: () => root,
    async runtime() { calls.push("runtime"); return host; },
    async restart() {
      calls.push("restart"); return changedRoot ? { ...host, async call() {
        return { ok: true, result: { data_root_fingerprint: `sha256:${"b".repeat(64)}` } };
      } } : host;
    },
    async readSnapshot() {
      calls.push("snapshot"); return { workspace: { fact_spine: { entities: [{
        entity_id: canonicalClass, entity_kind: "class", status: "active",
      }] } } };
    },
  };
  return { calls, run: input => evaluated.exports.selectTeacherTemplateForCreation(input, dependencies) };
}
const input = () => ({ clientRequestId, scope: { classId: "class-1", subject: "数学" }, untilDate: "2026-12-18" });

test("selection binds a canonical class, the private root fingerprint and a fresh owner proof after restart", async () => {
  const { calls, run } = setup({ status: "missing" });
  assert.deepEqual(await run(input()), { templateId, ownerId: "verified-owner" });
  const preparation = calls.find(call => call[0] === "prepare");
  assert.deepEqual(preparation[1], { templateIds: [templateId], scope: { class_id: "class-1", subject: "数学" },
    endsAt: "2026-12-18T23:59:59.999Z" });
  assert.deepEqual(preparation[2], { dataRoot: "/private/synthetic-root", rootRef, expectedUpdatedAt: null });
  assert.ok(calls.indexOf("snapshot") < calls.indexOf(preparation));
  assert.ok(calls.indexOf(preparation) < calls.indexOf("restart"));
  assert.ok(calls.findIndex(call => call[0] === "proof") > calls.indexOf("restart"));
});

test("adding one template retains only previously selected IDs in the same exact scope", async () => {
  const config = { enabled: true, updatedAt: "2026-11-18T00:00:00.000Z", binding: {
    ownerId: "verified-owner", grantId: "independent-grant",
    templateIds: ["previously-selected"], scope: { class_id: "class-1", subject: "数学" },
  } };
  const { calls, run } = setup({ config });
  await run(input());
  assert.deepEqual(calls.find(call => call[0] === "prepare")[1].templateIds, ["previously-selected", templateId]);
});

test("a duplicate create only rechecks the existing owner grant without changing selection or reissuing control", async () => {
  const config = { enabled: true, updatedAt: "2026-11-18T00:00:00.000Z", binding: {
    ownerId: "verified-owner", grantId: "independent-grant", templateIds: [templateId],
    scope: { class_id: "class-1", subject: "数学" },
  } };
  const { calls, run } = setup({ config });
  assert.deepEqual(await run(input()), { templateId, ownerId: "verified-owner" });
  assert.equal(calls.filter(call => call[0] === "proof").length, 1);
  assert.ok(!calls.includes("restart") && !calls.includes("snapshot") && !calls.some(call => call[0] === "prepare"));
});

test("unknown classes cannot manufacture a grant or restart", async () => {
  const { calls, run } = setup({ canonicalClass: "other-class" });
  await assert.rejects(run(input()), { code: "teacher_template_invalid_input" });
  assert.ok(!calls.includes("restart") && !calls.some(call => call[0] === "prepare"));
});

test("changing scope or reading damaged configuration fails before runtime IO", async () => {
  for (const options of [
    { config: { binding: { scope: { class_id: "foreign", subject: "数学" } } } },
    { status: "invalid" }, { status: "root_mismatch" },
  ]) {
    const { calls, run } = setup(options);
    await assert.rejects(run(input()), { code: options.config ? "teacher_template_config_conflict" : "teacher_template_configuration_unavailable" });
    assert.deepEqual(calls, []);
  }
});

test("a root change across restart cannot be reported as activated", async () => {
  const { calls, run } = setup({ changedRoot: true });
  await assert.rejects(run(input()), { code: "teacher_template_grant_denied" });
  assert.ok(calls.includes("restart"));
});
test("an unsupported legacy runtime is rejected before persisting an activation or creating a grant", async () => {
  const { calls, run } = setup({ storageReady: false });
  await assert.rejects(run(input()), { code: "teacher_template_runtime_upgrade_required" });
  assert.ok(!calls.includes("restart") && !calls.some(call => call[0] === "prepare"));
});
