import assert from "node:assert/strict";
import test from "node:test";

import { stagedReadinessDiagnostic, waitForStagedRuntime } from "./staged-runtime-readiness.mjs";

const response = (status, core, projection, reason = null) => ({
  ok: status === 200, status,
  json: async () => ({ core: { status: core, reason }, projection: { status: projection },
    compatibility: { reason: null } }),
});

function clock() {
  let elapsed = 0;
  return { now: () => elapsed, pause: async ms => { elapsed += ms; }, elapsed: () => elapsed };
}

test("waits past an unavailable response and returns only the ready status", async () => {
  const time = clock();
  const statuses = [response(200, "unavailable", "ready", "startup_pending"), response(200, "ready", "ready")];
  const result = await waitForStagedRuntime({ deadline: 1000, ...time, identityOnly: false,
    headlessBoot: false, runtimeDatabaseExists: () => false,
    readIdentity: async () => ({ status: 204 }), readStatus: async () => statuses.shift(), serverExited: () => {} });
  assert.equal(result.attempts, 2);
  assert.equal(result.status.core.status, "ready");
  assert.equal(time.elapsed(), 200);
});

test("persistent unavailable expires with the last HTTP and Core status", async () => {
  const time = clock();
  const timeouts = [];
  const result = await waitForStagedRuntime({ deadline: 450, ...time, identityOnly: false,
    headlessBoot: false, runtimeDatabaseExists: () => false,
    readIdentity: async () => ({ status: 204 }),
    readStatus: async timeout => { timeouts.push(timeout); return response(503, "unavailable", "unavailable", "runtime_unavailable"); },
    serverExited: () => {} });
  assert.equal(result.status, null);
  assert.equal(result.attempts, 3);
  assert.deepEqual(timeouts, [450, 250, 50]);
  assert.equal(time.elapsed(), 450);
  assert.match(stagedReadinessDiagnostic(result), /"httpStatus":503.*"core":"unavailable"/);
});

test("a failed status request can recover, while a ready wrong hash is left for strict assertions", async () => {
  const time = clock();
  let calls = 0;
  const wrongPin = { core: { status: "ready", runtimeComponentManifestHash: "wrong" }, projection: { status: "ready" } };
  const result = await waitForStagedRuntime({ deadline: 1000, ...time, identityOnly: false,
    headlessBoot: false, runtimeDatabaseExists: () => false,
    readIdentity: async () => ({ status: 204 }), readStatus: async () => {
      if (++calls === 1) throw new Error("socket reset");
      return { ok: true, status: 200, json: async () => wrongPin };
    }, serverExited: () => {} });
  assert.equal(result.attempts, 2);
  assert.equal(result.status, wrongPin);
  assert.notEqual(result.status.core.runtimeComponentManifestHash, "expected");
});

test("identity-only and headless boot never request status before the permitted boundary", async () => {
  const time = clock();
  let statusCalls = 0;
  const shared = { deadline: 450, ...time, readIdentity: async () => ({ status: 204 }),
    readStatus: async () => { statusCalls++; return response(200, "ready", "ready"); }, serverExited: () => {} };
  const identity = await waitForStagedRuntime({ ...shared, identityOnly: true,
    headlessBoot: false, runtimeDatabaseExists: () => false });
  assert.equal(identity.identityReady, true);
  assert.equal(statusCalls, 0);
  const headless = await waitForStagedRuntime({ ...shared, identityOnly: false,
    headlessBoot: true, runtimeDatabaseExists: () => false });
  assert.equal(headless.runtimeStoreSeenBeforeStatus, false);
  assert.equal(statusCalls, 0);
});

test("one long status request preserves its result without starting overlapping polls", async () => {
  const time = clock();
  const timeouts = [];
  const result = await waitForStagedRuntime({ deadline: 60_000, ...time, identityOnly: false,
    headlessBoot: false, runtimeDatabaseExists: () => false, statusRequestTimeoutMs: 45_000,
    maxStatusAttempts: 1, readIdentity: async () => ({ status: 204 }),
    readStatus: async timeout => { timeouts.push(timeout); return response(200, "unavailable", "ready", "startup_pending"); },
    serverExited: () => {} });
  assert.deepEqual(timeouts, [45_000]);
  assert.equal(result.attempts, 1);
  assert.equal(result.status, null);
  assert.match(stagedReadinessDiagnostic(result), /"core":"unavailable"/);
});

test("diagnostic shows a fixed stage and never prints raw request errors", async () => {
  const diagnostic = stagedReadinessDiagnostic({ attempts: 1, lastHttpStatus: 200,
    lastStatus: { core: { status: "unavailable", failureStage: "runtime_health", reason: "private path /teacher/token" },
      projection: { reason: "private projection" }, compatibility: { reason: "private compatibility" } }, lastError: null });
  assert.match(diagnostic, /"coreFailureStage":"runtime_health"/);
  assert.doesNotMatch(diagnostic, /private/);
  const time = clock();
  const result = await waitForStagedRuntime({ deadline: 1, ...time, identityOnly: false,
    headlessBoot: false, runtimeDatabaseExists: () => false, readIdentity: async () => { throw new Error("private path /teacher/token"); },
    readStatus: async () => { throw new Error("unexpected status request"); }, serverExited: () => {} });
  assert.equal(result.lastError, "request_failed");
  assert.doesNotMatch(stagedReadinessDiagnostic(result), /private path|teacher|token/);
});
