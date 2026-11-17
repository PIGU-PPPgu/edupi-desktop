import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { EventEmitter } from "node:events";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { test } from "node:test";
import {
  allocateFixture, blockSeedModelRequests, CORE_COMMIT, nativeFixturePaths, parseArguments,
  ROOT_PREFIX, seedRecurringTemplates, writeExclusiveJson,
} from "./create-native-l4-acceptance-fixture.mjs";
import { assertIsolatedProcessEvidence } from "./assert-macos-isolated-edupi.mjs";

const driver = new URL("./create-native-l4-acceptance-fixture.mjs", import.meta.url);
const temporary = () => fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), "native-l4-driver-test-")));

test("CLI requires explicit create, fixed Core input and an absolute evidence destination", () => {
  assert.deepEqual(parseArguments(["--create", "--core-root", "/core", "--evidence-dir", "/evidence/new"]), {
    create: true, coreRoot: "/core", evidenceDir: "/evidence/new",
  });
  assert.deepEqual(parseArguments(["--help"]), { help: true });
  for (const args of [
    [], ["--create"], ["--core-root", "/core", "--evidence-dir", "/evidence"],
    ["--create", "--core-root", "relative", "--evidence-dir", "/evidence"],
    ["--create", "--core-root", "/core", "--evidence-dir", "/evidence", "--create"],
    ["--create", "--root", "/existing", "--core-root", "/core", "--evidence-dir", "/evidence"],
    ["--create", "--core-root", "/core", "--evidence-dir"],
  ]) assert.throws(() => parseArguments(args));
  assert.equal(CORE_COMMIT, "fc89b3bc899a55b0fdad61b8f37e238d950f37c6");
});

test("import has no HOME, cwd, environment, output or listener side effects", () => {
  const root = temporary();
  try {
    const script = `
      import fs from "node:fs";
      import assert from "node:assert/strict";
      const before = { env: { ...process.env }, cwd: process.cwd(),
        listeners: process.eventNames().map(name => [name, process.listenerCount(name)]) };
      await import(${JSON.stringify(driver.href)});
      assert.deepEqual({ ...process.env }, before.env);
      assert.equal(process.cwd(), before.cwd);
      assert.deepEqual(process.eventNames().map(name => [name, process.listenerCount(name)]), before.listeners);
      assert.deepEqual(fs.readdirSync(process.env.HOME), []);
    `;
    const result = spawnSync(process.execPath, ["--input-type=module", "-e", script], {
      cwd: root, env: { ...process.env, HOME: root }, encoding: "utf8",
    });
    assert.equal(result.status, 0, result.stderr);
    assert.equal(result.stdout, "");
    assert.deepEqual(fs.readdirSync(root), []);
    const refusal = spawnSync(process.execPath, [driver.pathname], {
      cwd: root, env: { ...process.env, HOME: root }, encoding: "utf8",
    });
    assert.equal(refusal.status, 1);
    assert.equal(JSON.parse(refusal.stderr).code, "explicit_create_core_and_evidence_required");
    assert.deepEqual(fs.readdirSync(root), []);
  } finally { fs.rmSync(root, { recursive: true, force: true }); }
});

test("allocation creates an exclusive private HOME child and the exact native state and agent paths", () => {
  const home = temporary(), appConfigRoot = path.join(home, "appconfig");
  fs.mkdirSync(appConfigRoot, { mode: 0o700 });
  try {
    const fixture = allocateFixture({ home, appConfigRoot, evidenceDir: path.join(home, "evidence") });
    assert.equal(path.dirname(fixture.root), home);
    assert.match(path.basename(fixture.root), new RegExp(`^${ROOT_PREFIX}[a-f0-9]{24}$`, "u"));
    assert.match(path.basename(fixture.root), /^edupi-route1-canary-[a-z0-9-]{1,80}$/u);
    assert.equal(fixture.stateDir, path.join(appConfigRoot, "route1-isolated", path.basename(fixture.root)));
    assert.equal(fixture.agentDir, path.join(fixture.root, ".edupi/agent"));
    for (const directory of [fixture.root, fixture.stateDir, fixture.agentDir]) {
      assert.equal(fs.realpathSync(directory), directory);
      assert.equal(fs.lstatSync(directory).mode & 0o777, 0o700);
    }
    const before = fs.readdirSync(home);
    assert.throws(() => allocateFixture({ home, appConfigRoot, evidenceDir: fixture.evidenceDir }), { code: "EEXIST" });
    assert.deepEqual(fs.readdirSync(home), before, "refusing repeat evidence must happen before allocating another root");
    const second = allocateFixture({ home, appConfigRoot, evidenceDir: path.join(home, "second-evidence") });
    assert.notEqual(second.root, fixture.root);
    for (const root of [home, path.join(home, "nested", `${ROOT_PREFIX}test`), "/private/tmp/edupi-route1-canary-l4-116-20261117-test",
      path.join(home, "edupi-route1-canary-g4-old"), path.join(home, `${ROOT_PREFIX}7ZdKVt`),
      path.join(home, `${ROOT_PREFIX}${"a".repeat(81)}`)]) {
      assert.throws(() => nativeFixturePaths(home, root, appConfigRoot));
    }
  } finally { fs.rmSync(home, { recursive: true, force: true }); }
});

test("a newly allocated root passes the unchanged native process-evidence pure function", () => {
  const home = temporary(), appConfigRoot = path.join(home, "appconfig");
  fs.mkdirSync(appConfigRoot, { mode: 0o700 });
  try {
    const fixture = allocateFixture({ home, appConfigRoot, evidenceDir: path.join(home, "evidence") });
    // Constructed process records test the pure contract; they do not assert
    // that the installed App was launched or that real native processes exist.
    const evidenceFor = root => ({
      root, home, realRoot: path.join(home, "synthetic-teacher-root"),
      processes: [
        { pid: 10001, command: "/Applications/EduPi.app/Contents/MacOS/pi-agent-desktop",
          environment: `EDUPI_DATA_ROOT=${root} EDUPI_PROJECT_ROOT=${root} EDUPI_ROUTE1_ISOLATED_CANARY=1` },
        { pid: 10002,
          command: "/Applications/EduPi.app/Contents/Resources/resources/Pi Agent Server.app/Contents/MacOS/node /Applications/EduPi.app/Contents/Resources/resources/server/core-runtime-host.mjs",
          environment: `EDUPI_PROJECT_ROOT=${root} EDUPI_HOME=${root}/.edupi EDUPI_MEMORY_DIR=${root}/.edupi/memory EDUPI_OUTPUT_DIR=${root}/.edupi/output EDUPI_LOCK_DIR=${root}/.edupi/locks EDUPI_DESKTOP_ISOLATED_CANARY=1` },
      ],
    });
    const accepted = assertIsolatedProcessEvidence(evidenceFor(fixture.root));
    assert.equal(accepted.status, "isolated");
    assert.equal(accepted.appPid, 10001);
    assert.equal(accepted.coreHostPid, 10002);
    assert.throws(() => assertIsolatedProcessEvidence(evidenceFor(path.join(home, `${ROOT_PREFIX}7ZdKVt`))),
      /isolated root is invalid/);
  } finally { fs.rmSync(home, { recursive: true, force: true }); }
});

test("allocation rejects state symlinks before creating a root or an evidence directory", () => {
  const home = temporary(), appConfigRoot = path.join(home, "appconfig"), target = path.join(home, "existing-state");
  fs.mkdirSync(appConfigRoot); fs.mkdirSync(target);
  fs.symlinkSync(target, path.join(appConfigRoot, "route1-isolated"));
  try {
    const before = fs.readdirSync(home);
    assert.throws(() => allocateFixture({ home, appConfigRoot, evidenceDir: path.join(home, "evidence") }),
      { code: "canonical_directory_required" });
    assert.deepEqual(fs.readdirSync(home), before);
    assert.deepEqual(fs.readdirSync(target), []);
  } finally { fs.rmSync(home, { recursive: true, force: true }); }
});

test("evidence uses exclusive private files and preserves earlier failure bytes", () => {
  const root = temporary(), file = path.join(root, "proof.json");
  try {
    writeExclusiveJson(file, { status: "fixture-preparation-failed", failure: { phase: "test" } });
    const bytes = fs.readFileSync(file);
    assert.equal(fs.lstatSync(file).mode & 0o777, 0o600);
    assert.throws(() => writeExclusiveJson(file, { status: "prepared" }), { code: "EEXIST" });
    assert.deepEqual(fs.readFileSync(file), bytes);
  } finally { fs.rmSync(root, { recursive: true, force: true }); }
});

test("seed IPC denies model execution and configuration before downstream provider listeners", () => {
  const child = new EventEmitter(), sends = [], delivered = [];
  child.connected = true;
  child.send = (message, callback) => { sends.push(message); callback(); };
  const counters = { modelRequests: 0, modelConfigurationRequests: 0 };
  blockSeedModelRequests(child, counters);
  child.on("message", message => delivered.push(message));
  child.emit("message", { type: "model-config-request", id: "config-1" });
  child.emit("message", { type: "model-run", id: "run-1", request: { prompt: "synthetic" } });
  child.emit("message", { type: "runtime-ready", host: "127.0.0.1" });
  assert.deepEqual(counters, { modelRequests: 1, modelConfigurationRequests: 1 });
  assert.deepEqual(sends, [
    { type: "model-config-error", id: "config-1", code: "model_unavailable" },
    { type: "model-error", id: "run-1", code: "model_unavailable" },
  ]);
  assert.deepEqual(delivered, [{ type: "runtime-ready", host: "127.0.0.1" }]);
});

test("official weekly and monthly POST refusal remains an explicit gap without a taskboard fallback", async () => {
  const inputs = [], bridgeFailures = [];
  const result = await seedRecurringTemplates({
    scope: { classId: "synthetic-class", subject: "数学" },
    tasks: { async POST(request) {
      inputs.push(await request.json());
      bridgeFailures.push({ sequence: bridgeFailures.length + 1, phase: "recurring-templates",
        code: "activation_pending", runtimeOperation: "bridge_call", bridgeOperation: "command", commandType: "create_task" });
      return Response.json({ code: "unavailable" }, { status: 503 });
    } },
    bridgeFailures,
    request: (url, input) => new Request(`http://localhost${url}`, { method: "POST", body: JSON.stringify(input) }),
    readActivation: async domain => {
      assert.equal(domain, "teaching_preparation");
      return { activation: { enabled: false } };
    },
  });
  assert.equal(inputs.length, 2);
  assert.deepEqual(inputs.map(item => item.recurrence.cadence), ["weekly", "monthly"]);
  assert.ok(inputs.every(item => item.preparationSource === null && item.title.startsWith("合成")));
  assert.equal(result.status, "blocked");
  assert.equal(result.activationEnabled, false);
  assert.deepEqual(result.templates, []);
  assert.deepEqual(result.attempts.map(item => [item.cadence, item.status, item.httpStatus, item.code]), [
    ["weekly", "blocked", 503, "unavailable"], ["monthly", "blocked", 503, "unavailable"],
  ]);
  assert.equal(result.firstFailure.cadence, "weekly");
  assert.equal(result.firstFailure.firstBridgeFailure, bridgeFailures[0]);
  assert.equal(result.attempts[1].firstBridgeFailure, bridgeFailures[1]);
  assert.equal(result.contract.requiresTeacherTemplateBinding, true);
  assert.equal(result.contract.requiresOwnerReviewer, true);
  assert.equal(result.contract.modelExecute, false);
});

test("both stable template IDs are explicitly selected before formal create and replay while G1 remains off", async () => {
  let selected = null;
  const seen = new Set(), inputs = [], scope = { classId: "synthetic-class", subject: "数学" };
  const result = await seedRecurringTemplates({
    scope,
    prepareSelection: async planned => {
      assert.equal(planned.length, 2); assert.equal(inputs.length, 0);
      selected = planned.map(input => `teacher-task-${input.clientRequestId}`);
    },
    tasks: { async POST(request) {
      const input = await request.json();
      inputs.push(input);
      const taskId = `teacher-task-${input.clientRequestId}`;
      assert.ok(selected.includes(taskId));
      assert.deepEqual(input.templateScope, scope);
      const replayed = seen.has(taskId); seen.add(taskId);
      return Response.json({ taskId, replayed, receipt: { status: "accepted", external_send: false }, preparation: null });
    } },
    request: (url, input) => new Request(`http://localhost${url}`, { method: "POST", body: JSON.stringify(input) }),
    readActivation: async domain => {
      assert.equal(domain, "teaching_preparation"); return { activation: { enabled: false } };
    },
  });
  assert.equal(result.status, "templates-created-g1-disabled");
  assert.equal(result.activationEnabled, false);
  assert.equal(inputs.length, 4);
  assert.deepEqual(result.templates.map(item => item.taskId), selected);
  assert.deepEqual(inputs[0], inputs[1]);
  assert.deepEqual(inputs[2], inputs[3]);
});
