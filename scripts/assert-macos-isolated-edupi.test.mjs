import assert from "node:assert/strict";
import test from "node:test";
import { assertIsolatedProcessEvidence } from "./assert-macos-isolated-edupi.mjs";

const root = "/Users/test/edupi-route1-canary-094-20261031";
const realRoot = "/Users/test/teacher-work";
const app = "/Applications/EduPi.app/Contents/MacOS/pi-agent-desktop";
const host = "/Applications/EduPi.app/Contents/Resources/resources/Pi Agent Server.app/Contents/MacOS/node /Applications/EduPi.app/Contents/Resources/resources/server/core-runtime-host.mjs";

const appEnv = `EDUPI_DATA_ROOT=${root} EDUPI_PROJECT_ROOT=${root} EDUPI_ROUTE1_ISOLATED_CANARY=1`;
const hostEnv = `EDUPI_PROJECT_ROOT=${root} EDUPI_HOME=${root}/.edupi EDUPI_MEMORY_DIR=${root}/.edupi/memory EDUPI_OUTPUT_DIR=${root}/.edupi/output EDUPI_LOCK_DIR=${root}/.edupi/locks EDUPI_DESKTOP_ISOLATED_CANARY=1`;
const evidence = () => ({ root, realRoot, home: "/Users/test", processes: [
  { pid: 101, command: app, environment: `${app} ${appEnv}` },
  { pid: 102, command: host, environment: `${host} ${hostEnv}` },
] });

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
  const wrongRoot = evidence(); wrongRoot.root = "/Users/test/teacher-other";
  assert.throws(() => assertIsolatedProcessEvidence(wrongRoot), /isolated root is invalid/u);
  const missing = evidence(); missing.processes[0].environment = missing.processes[0].environment.replace("EDUPI_ROUTE1_ISOLATED_CANARY=1", "");
  assert.throws(() => assertIsolatedProcessEvidence(missing), /App EDUPI_ROUTE1_ISOLATED_CANARY/u);
  const changed = evidence(); changed.processes[1].environment = changed.processes[1].environment.replace(`${root}/.edupi/output`, `${realRoot}/.edupi/output`);
  assert.throws(() => assertIsolatedProcessEvidence(changed), /Core host EDUPI_OUTPUT_DIR/u);
  const duplicate = evidence(); duplicate.processes.push({ pid: 103, command: app, environment: `${app} ${appEnv}` });
  assert.throws(() => assertIsolatedProcessEvidence(duplicate), /exactly one App/u);
});
