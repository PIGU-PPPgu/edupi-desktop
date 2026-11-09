import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, realpathSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { assertCanonicalAppPath, assertIsolatedProcessEvidence, runningProcesses } from "./assert-macos-isolated-edupi.mjs";

const root = "/Users/test/edupi-route1-canary-094-20261031";
const realRoot = "/Users/test/teacher-work";
const app = "/Applications/EduPi.app/Contents/MacOS/pi-agent-desktop";
const host = "/Applications/EduPi.app/Contents/Resources/resources/Pi Agent Server.app/Contents/MacOS/node /Applications/EduPi.app/Contents/Resources/resources/server/core-runtime-host.mjs";
const web = "/Applications/EduPi.app/Contents/Resources/resources/Pi Agent Server.app/Contents/MacOS/node /Applications/EduPi.app/Contents/Resources/resources/server/desktop-server.cjs";

const appEnv = `EDUPI_DATA_ROOT=${root} EDUPI_PROJECT_ROOT=${root} EDUPI_ROUTE1_ISOLATED_CANARY=1`;
const hostEnv = `EDUPI_PROJECT_ROOT=${root} EDUPI_HOME=${root}/.edupi EDUPI_MEMORY_DIR=${root}/.edupi/memory EDUPI_OUTPUT_DIR=${root}/.edupi/output EDUPI_LOCK_DIR=${root}/.edupi/locks EDUPI_DESKTOP_ISOLATED_CANARY=1`;
const evidence = () => ({ root, realRoot, home: "/Users/test", processes: [
  { pid: 101, command: app, environment: `${app} ${appEnv}` },
  { pid: 102, command: host, environment: `${host} ${hostEnv}` },
] });

const temporaryApp = "/private/tmp/edupi-signed-acceptance/EduPi.app";
const temporaryEvidence = () => ({
  ...evidence(), appPath: temporaryApp,
  processes: evidence().processes.map(process => ({
    ...process,
    command: process.command.replaceAll("/Applications/EduPi.app", temporaryApp),
    environment: process.environment.replaceAll("/Applications/EduPi.app", temporaryApp),
  })),
});

test("an explicitly selected temporary App accepts only its isolated process pair", () => {
  assert.equal(assertIsolatedProcessEvidence(temporaryEvidence()).status, "isolated");
  const implicit = temporaryEvidence();
  delete implicit.appPath;
  assert.throws(() => assertIsolatedProcessEvidence(implicit), /unexpected EduPi process set/u);
});

test("unsafe temporary App locations and noncanonical paths fail closed", () => {
  for (const appPath of [
    "EduPi.app", "/Applications/Other.app", "/Users/test/EduPi.app",
    "/private/tmp/EduPi.app", "/tmp/test/EduPi.app",
    "/private/tmp/test/../test/EduPi.app", "/private/tmp/test//EduPi.app",
    "/private/tmp/test/EduPi.app/", "/private/tmp/test copy/EduPi.app",
    "/private/tmp/test/EduPi.app/Contents",
  ]) {
    assert.throws(() => assertIsolatedProcessEvidence({ ...evidence(), appPath }),
      /App path/u, appPath);
  }
});

test("temporary App mode rejects normal App, foreign helper, extras and duplicate identities", () => {
  const normal = { ...evidence(), appPath: temporaryApp };
  assert.throws(() => assertIsolatedProcessEvidence(normal), /unexpected EduPi process set/u);
  const mixed = temporaryEvidence();
  mixed.processes[1] = evidence().processes[1];
  assert.throws(() => assertIsolatedProcessEvidence(mixed), /unexpected EduPi process set/u);
  const extra = temporaryEvidence();
  extra.processes.push(evidence().processes[0]);
  assert.throws(() => assertIsolatedProcessEvidence(extra), /exactly one App/u);
  const duplicate = temporaryEvidence();
  duplicate.processes[1].pid = duplicate.processes[0].pid;
  assert.throws(() => assertIsolatedProcessEvidence(duplicate), /process identity/u);
  const unsafe = temporaryEvidence();
  unsafe.processes[0].environment = app;
  assert.throws(() => assertIsolatedProcessEvidence(unsafe), /App EDUPI_DATA_ROOT/u);
});

test("temporary App physical validation rejects symlinks, missing paths and files", () => {
  const fixtureRoot = realpathSync(mkdtempSync(path.join(
    process.platform === "darwin" ? "/private/tmp" : os.tmpdir(), "edupi-guard-")));
  try {
    const appPath = path.join(fixtureRoot, "EduPi.app");
    mkdirSync(appPath);
    if (fixtureRoot.startsWith("/private/tmp/")) {
      assert.equal(assertCanonicalAppPath(appPath), appPath);
    } else {
      assert.throws(() => assertCanonicalAppPath(appPath), /App path/u);
    }
    const aliasRoot = path.join(fixtureRoot, "alias");
    symlinkSync(fixtureRoot, aliasRoot, "dir");
    assert.throws(() => assertCanonicalAppPath(path.join(aliasRoot, "EduPi.app")));
    const fileRoot = path.join(fixtureRoot, "file");
    mkdirSync(fileRoot);
    writeFileSync(path.join(fileRoot, "EduPi.app"), "");
    assert.throws(() => assertCanonicalAppPath(path.join(fileRoot, "EduPi.app")));
    assert.throws(() => assertCanonicalAppPath(path.join(fixtureRoot, "missing/EduPi.app")));
  } finally {
    rmSync(fixtureRoot, { recursive: true, force: true });
  }
});

function processInspector(processes) {
  return (command, args) => {
    if (command === "/usr/bin/pgrep") {
      const selected = processes.filter(process => new RegExp(args[1], "u").test(process.command));
      return { status: selected.length ? 0 : 1,
        stdout: selected.map(process => `${process.pid} ${process.command}`).join("\n") };
    }
    assert.equal(command, "/bin/ps");
    const selected = processes.find(process => String(process.pid) === args[2]);
    assert.ok(selected);
    return { status: 0, stdout: selected.environment };
  };
}

test("process discovery includes normal installation, temporary copies and orphan helpers", () => {
  const isolated = temporaryEvidence();
  const discovered = runningProcesses(true, processInspector(isolated.processes));
  assert.equal(assertIsolatedProcessEvidence({ ...isolated, processes: discovered }).status, "isolated");
  for (const extra of evidence().processes) {
    const processes = runningProcesses(true, processInspector([...isolated.processes, extra]));
    assert.equal(processes.length, 3);
    assert.throws(() => assertIsolatedProcessEvidence({ ...isolated, processes }), /exactly one App/u);
  }
  const orphanWeb = { pid: 103, command: web.replaceAll("/Applications/EduPi.app", temporaryApp),
    environment: `${web} ${hostEnv}` };
  const withWeb = runningProcesses(true, processInspector([...isolated.processes, orphanWeb]));
  assert.equal(withWeb.length, 3);
  assert.throws(() => assertIsolatedProcessEvidence({ ...isolated, processes: withWeb }), /exactly one App/u);
  const secondCopy = { ...isolated.processes[1], pid: 103,
    command: isolated.processes[1].command.replaceAll("edupi-signed-acceptance", "other-copy") };
  assert.equal(runningProcesses(false, processInspector([secondCopy])).length, 1);
  const renamed = isolated.processes.map(process => ({ ...process,
    command: process.command.replaceAll("EduPi.app", "EduPi copy.app"),
    environment: process.environment.replaceAll("EduPi.app", "EduPi copy.app"),
  }));
  for (const process of renamed) {
    assert.equal(runningProcesses(false, processInspector([process])).length, 1);
    assert.throws(() => assertIsolatedProcessEvidence({ ...isolated,
      processes: runningProcesses(true, processInspector([process])),
    }), /exactly one App/u);
    assert.throws(() => assertIsolatedProcessEvidence({ ...isolated,
      processes: runningProcesses(true, processInspector([...isolated.processes, process])),
    }), /exactly one App/u);
  }
});

test("stopped discovery detects every App or helper without reading environments", () => {
  const renamedApp = { ...evidence().processes[0],
    command: app.replace("EduPi.app", "EduPi copy.app") };
  const renamedHelper = { ...evidence().processes[1],
    command: host.replaceAll("EduPi.app", "EduPi copy.app") };
  const webHelpers = [web, web.replaceAll("/Applications/EduPi.app", temporaryApp)]
    .map((command, index) => ({ pid: 104 + index, command }));
  for (const process of [...evidence().processes, ...temporaryEvidence().processes,
    renamedApp, renamedHelper, ...webHelpers]) {
    const inspect = processInspector([process]);
    const processes = runningProcesses(false, (command, args) => {
      assert.equal(command, "/usr/bin/pgrep");
      return inspect(command, args);
    });
    assert.equal(processes.length, 1);
    assert.equal(processes[0].environment, "");
  }
  assert.deepEqual(runningProcesses(false, processInspector([])), []);
});

test("process inspection errors and malformed identities fail closed", () => {
  assert.throws(() => runningProcesses(false, () => ({ status: 2 })), /pgrep/u);
  assert.throws(() => runningProcesses(false, () => ({ status: 0, stdout: "broken" })), /identity/u);
  assert.throws(() => runningProcesses(true, (command) => command === "/usr/bin/pgrep"
    ? { status: 0, stdout: `101 ${app}` } : { status: 1 }), /ps/u);
});

test("only an exact two-process synthetic launch may bind native CUA", () => {
  const result = assertIsolatedProcessEvidence(evidence());
  assert.equal(result.status, "isolated");
  assert.equal(result.appPid, 101);
  assert.equal(result.coreHostPid, 102);
  assert.match(result.rootSha256, /^[a-f0-9]{64}$/u);
});

test("real root, missing marker, changed Core home and extra App fail closed", () => {
  const real = evidence(); real.realRoot = root;
  assert.throws(() => assertIsolatedProcessEvidence(real), /real teacher root/u);
  const nested = evidence(); nested.realRoot = "/Users/test";
  assert.throws(() => assertIsolatedProcessEvidence(nested), /real teacher root/u);
  const containing = evidence(); containing.realRoot = `${root}/.edupi/output`;
  assert.throws(() => assertIsolatedProcessEvidence(containing), /real teacher root/u);
  const wrongRoot = evidence(); wrongRoot.root = "/Users/test/teacher-other";
  assert.throws(() => assertIsolatedProcessEvidence(wrongRoot), /isolated root is invalid/u);
  const missing = evidence(); missing.processes[0].environment = missing.processes[0].environment.replace("EDUPI_ROUTE1_ISOLATED_CANARY=1", "");
  assert.throws(() => assertIsolatedProcessEvidence(missing), /App EDUPI_ROUTE1_ISOLATED_CANARY/u);
  const changed = evidence(); changed.processes[1].environment = changed.processes[1].environment.replace(`${root}/.edupi/output`, `${realRoot}/.edupi/output`);
  assert.throws(() => assertIsolatedProcessEvidence(changed), /Core host EDUPI_OUTPUT_DIR/u);
  const duplicate = evidence(); duplicate.processes.push({ pid: 103, command: app, environment: `${app} ${appEnv}` });
  assert.throws(() => assertIsolatedProcessEvidence(duplicate), /exactly one App/u);
});
