import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawn } from "node:child_process";
import test from "node:test";
import { createJiti } from "jiti";

const config = await createJiti(import.meta.url, { fsCache: false }).import("./edupi-teacher-template-config.ts");
const at = "2026-11-18T00:00:00.000Z";
const binding = () => ({ ownerId: "owner-test", grantId: "desktop_teacher_template_test",
  scope: { class_id: "class-7-1", subject: "数学" }, templateIds: ["teacher-task-selected"] });
const enabled = () => ({ enabled: true, binding: binding(), grantVersion: 1 });
function fixture(t) {
  const root = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), "edupi-teacher-template-config-")));
  fs.chmodSync(root, 0o700);
  const options = { dataRoot: path.join(root, "data"), stateDir: path.join(root, "state"), now: at, expectedUpdatedAt: null };
  for (const directory of [options.dataRoot, options.stateDir]) fs.mkdirSync(directory, { mode: 0o700 });
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  return { root, options, file: path.join(options.stateDir, config.EDUPI_TEACHER_TEMPLATE_CONFIG_FILE) };
}

test("template binding is an immutable four-field snapshot of only explicit unique selections", () => {
  const input = binding(), parsed = config.parseEduPiTeacherTemplateBinding(input);
  assert.deepEqual(Object.keys(parsed).sort(), ["grantId", "ownerId", "scope", "templateIds"]);
  input.scope.class_id = "different"; input.templateIds.push("not-selected");
  assert.equal(parsed.scope.class_id, "class-7-1");
  assert.deepEqual(parsed.templateIds, ["teacher-task-selected"]);
  assert.ok(Object.isFrozen(parsed) && Object.isFrozen(parsed.scope) && Object.isFrozen(parsed.templateIds));
  assert.equal(config.parseEduPiTeacherTemplateBinding({ ...binding(), grantVersion: 1 }), null);
  assert.equal(config.parseEduPiTeacherTemplateBinding({ ...binding(), allowAll: true }), null);
  assert.equal(config.parseEduPiTeacherTemplateBinding({ ...binding(), templateIds: [] }), null);
  assert.equal(config.parseEduPiTeacherTemplateBinding({ ...binding(), templateIds: ["same", "same"] }), null);
  assert.equal(config.parseEduPiTeacherTemplateBinding({ ...binding(), templateIds: Array.from({ length: 41 }, (_, n) => `t-${n}`) }), null);
  assert.equal(config.parseEduPiTeacherTemplateBinding({ ...binding(), scope: { ...binding().scope, subject: " 数学" } }), null);
});

test("template binding rejects getters, inherited fields, symbols and sparse or decorated ID arrays without evaluating them", () => {
  let invoked = 0;
  const getter = { ...binding() };
  Object.defineProperty(getter, "grantId", { enumerable: true, get() { invoked++; return "unsafe"; } });
  assert.equal(config.parseEduPiTeacherTemplateBinding(getter), null);
  assert.equal(config.parseEduPiTeacherTemplateBinding(Object.assign(Object.create({ grantVersion: 1 }), binding())), null);
  assert.equal(config.parseEduPiTeacherTemplateBinding({ ...binding(), [Symbol("extra")]: true }), null);
  for (const ids of [Array(1), Object.assign(["selected"], { extra: "another" })]) {
    assert.equal(config.parseEduPiTeacherTemplateBinding({ ...binding(), templateIds: ids }), null);
  }
  const ids = ["selected"];
  Object.defineProperty(ids, 0, { enumerable: true, get() { invoked++; return "unsafe"; } });
  assert.equal(config.parseEduPiTeacherTemplateBinding({ ...binding(), templateIds: ids }), null);
  assert.equal(invoked, 0);
});

test("template private config atomically writes, rereads and preserves unrelated domain files", async t => {
  const f = fixture(t);
  const sentinels = ["edupi-proactivity.json", "edupi-calendar-administration.json", "edupi-lesson-reflection.json", "edupi-parent-communication.json"];
  for (const name of sentinels) fs.writeFileSync(path.join(f.options.stateDir, name), `untouched:${name}`, { mode: 0o600 });
  const saved = await config.writeEduPiTeacherTemplateConfig(enabled(), f.options);
  assert.equal(saved.dataRootHash, config.teacherTemplateHash(f.options.dataRoot));
  assert.equal(fs.statSync(f.file).mode & 0o777, 0o600);
  assert.deepEqual(config.readEduPiTeacherTemplateConfig(f.options), { status: "ready", config: saved });
  assert.deepEqual(config.readEduPiTeacherTemplateBinding(f.options), binding());
  assert.deepEqual(JSON.parse(fs.readFileSync(f.file, "utf8")), saved);
  assert.deepEqual(fs.readdirSync(f.options.stateDir).sort(), [...sentinels, config.EDUPI_TEACHER_TEMPLATE_CONFIG_FILE].sort());
  for (const name of sentinels) assert.equal(fs.readFileSync(path.join(f.options.stateDir, name), "utf8"), `untouched:${name}`);
});

test("template config stop retains history selection but removes active binding and fences same-millisecond re-enable", async t => {
  const f = fixture(t), first = await config.writeEduPiTeacherTemplateConfig(enabled(), f.options);
  const stopped = await config.writeEduPiTeacherTemplateConfig({ enabled: false }, { ...f.options, expectedUpdatedAt: first.updatedAt });
  assert.equal(config.readEduPiTeacherTemplateBinding(f.options), null);
  assert.deepEqual(config.readEduPiTeacherTemplateHistoryBinding(f.options), binding());
  assert.equal(Date.parse(stopped.updatedAt), Date.parse(first.updatedAt) + 1);
  await assert.rejects(config.writeEduPiTeacherTemplateConfig(enabled(), { ...f.options, expectedUpdatedAt: first.updatedAt }),
    { code: "teacher_template_config_conflict" });
  const again = await config.writeEduPiTeacherTemplateConfig(enabled(), { ...f.options, expectedUpdatedAt: stopped.updatedAt });
  assert.equal(Date.parse(again.updatedAt), Date.parse(stopped.updatedAt) + 1);
});

test("template disabled config can retain the freshly confirmed pause version without enabling execution", async t => {
  const f = fixture(t), first = await config.writeEduPiTeacherTemplateConfig(enabled(), f.options);
  const stopped = await config.writeEduPiTeacherTemplateConfig({ enabled: false, grantVersion: 2 },
    { ...f.options, expectedUpdatedAt: first.updatedAt });
  assert.equal(stopped.enabled, false);
  assert.equal(stopped.grantVersion, 2);
  assert.equal(config.readEduPiTeacherTemplateBinding(f.options), null);
  assert.deepEqual(config.readEduPiTeacherTemplateHistoryBinding(f.options), binding());
  await assert.rejects(config.writeEduPiTeacherTemplateConfig({ enabled: false, grantVersion: 0 },
    { ...f.options, expectedUpdatedAt: stopped.updatedAt }), { code: "teacher_template_invalid_input" });
});

test("template config requires explicit creation CAS and snapshots input before waiting on the lock", async t => {
  const f = fixture(t);
  const missingCAS = { ...f.options }; delete missingCAS.expectedUpdatedAt;
  await assert.rejects(config.writeEduPiTeacherTemplateConfig(enabled(), missingCAS), { code: "teacher_template_invalid_input" });
  let release, entered;
  const gate = new Promise(resolve => { release = resolve; }), inside = new Promise(resolve => { entered = resolve; });
  const first = config.mutateEduPiTeacherTemplateConfig(f.options, async () => { entered(); await gate; return { enabled: false }; });
  await inside;
  const input = enabled(), second = config.writeEduPiTeacherTemplateConfig(input, { ...f.options, expectedUpdatedAt: at });
  input.binding.templateIds.push("late-unselected"); input.binding.scope.class_id = "changed";
  release(); await first;
  const saved = await second;
  assert.deepEqual(saved.binding, binding());
});

test("template config serializes independent Node processes so one stale CAS cannot overwrite another", async t => {
  const f = fixture(t), initial = await config.writeEduPiTeacherTemplateConfig(enabled(), f.options);
  const script = `
    import { createJiti } from "jiti";
    const api = await createJiti(process.cwd() + "/package.json", { fsCache: false }).import("./lib/edupi-teacher-template-config.ts");
    try { await api.writeEduPiTeacherTemplateConfig({ enabled: false }, JSON.parse(process.argv[1]));
      process.stdout.write("saved"); }
    catch (error) { if (error.code !== "teacher_template_config_conflict") throw error; process.stdout.write("conflict"); }
  `;
  const run = () => new Promise((resolve, reject) => {
    const child = spawn(process.execPath, ["--input-type=module", "-e", script, JSON.stringify({ ...f.options, expectedUpdatedAt: initial.updatedAt })],
      { cwd: path.resolve(import.meta.dirname, ".."), stdio: ["ignore", "pipe", "pipe"] });
    let out = "", err = "";
    child.stdout.on("data", bytes => { out += bytes; }); child.stderr.on("data", bytes => { err += bytes; });
    child.on("error", reject); child.on("close", code => code === 0 ? resolve(out) : reject(new Error(err)));
  });
  assert.deepEqual((await Promise.all([run(), run()])).sort(), ["conflict", "saved"]);
  assert.equal(config.readEduPiTeacherTemplateConfig(f.options).config.enabled, false);
});

for (const kind of ["state symlink", "ancestor symlink", "data symlink", "config symlink", "hardlink", "public config", "public state", "public data"]) {
  test(`template config rejects ${kind} without changing its target`, async t => {
    const f = fixture(t), options = { ...f.options };
    const outside = path.join(f.root, "outside.json");
    fs.writeFileSync(outside, '{"private":"unchanged"}', { mode: 0o600 });
    if (kind === "state symlink") { options.stateDir = path.join(f.root, "alias"); fs.symlinkSync(f.options.stateDir, options.stateDir); }
    if (kind === "ancestor symlink") {
      const alias = path.join(f.root, "alias"); fs.symlinkSync(f.root, alias); options.stateDir = path.join(alias, "state");
    }
    if (kind === "data symlink") { options.dataRoot = path.join(f.root, "alias"); fs.symlinkSync(f.options.dataRoot, options.dataRoot); }
    if (kind === "config symlink") fs.symlinkSync(outside, f.file);
    if (kind === "hardlink") fs.linkSync(outside, f.file);
    if (kind === "public config") fs.writeFileSync(f.file, "{}", { mode: 0o644 });
    if (kind === "public state") fs.chmodSync(f.options.stateDir, 0o755);
    if (kind === "public data") fs.chmodSync(f.options.dataRoot, 0o755);
    await assert.rejects(config.writeEduPiTeacherTemplateConfig(enabled(), options), { code: "teacher_template_configuration_unavailable" });
    assert.equal(config.readEduPiTeacherTemplateConfig(options).status, "invalid");
    assert.equal(fs.readFileSync(outside, "utf8"), '{"private":"unchanged"}');
  });
}

test("template config rejects a copied root hash and preserves corrupt or oversized files rather than replacing them", async t => {
  const f = fixture(t);
  await config.writeEduPiTeacherTemplateConfig(enabled(), f.options);
  const other = path.join(f.root, "other-data"); fs.mkdirSync(other, { mode: 0o700 });
  assert.equal(config.readEduPiTeacherTemplateConfig({ ...f.options, dataRoot: other }).status, "root_mismatch");
  for (const bytes of [Buffer.from("null"), Buffer.from("{"), Buffer.alloc(16_385, 32), Buffer.from([0xff, 0xff])]) {
    fs.writeFileSync(f.file, bytes, { mode: 0o600 });
    assert.equal(config.readEduPiTeacherTemplateConfig(f.options).status, "invalid");
    await assert.rejects(config.writeEduPiTeacherTemplateConfig(enabled(), f.options), { code: "teacher_template_configuration_unavailable" });
    assert.deepEqual(fs.readFileSync(f.file), bytes);
  }
});

test("template config uses the explicit PI_DESKTOP_STATE_DIR without creating default config locations", async t => {
  const f = fixture(t), previous = process.env.PI_DESKTOP_STATE_DIR;
  process.env.PI_DESKTOP_STATE_DIR = f.options.stateDir;
  try {
    const options = { dataRoot: f.options.dataRoot, expectedUpdatedAt: null, now: at };
    const saved = await config.writeEduPiTeacherTemplateConfig(enabled(), options);
    assert.deepEqual(config.readEduPiTeacherTemplateConfig(options).config, saved);
  } finally {
    if (previous === undefined) delete process.env.PI_DESKTOP_STATE_DIR;
    else process.env.PI_DESKTOP_STATE_DIR = previous;
  }
});

test("template config detects a root replacement during asynchronous grant preparation before writing", async t => {
  const f = fixture(t);
  await assert.rejects(config.mutateEduPiTeacherTemplateConfig(f.options, async () => {
    fs.renameSync(f.options.dataRoot, path.join(f.root, "previous-data"));
    fs.mkdirSync(f.options.dataRoot, { mode: 0o700 });
    return enabled();
  }), { code: "teacher_template_configuration_unavailable" });
  assert.equal(fs.existsSync(f.file), false);
});
