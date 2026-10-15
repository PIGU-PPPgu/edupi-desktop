import assert from "node:assert/strict";
import test from "node:test";
import { notarizeMacOSDmg } from "./notarize-macos-dmg.mjs";

const submissionId = "bae90110-2958-470d-86f9-5319261caca9";
const credentials = { appleId: "test@example.invalid", password: "test-only", teamId: "TESTTEAM" };
const submitted = { status: 0, stdout: JSON.stringify({ id: submissionId }) };
const status = (value) => ({ status: 0, stdout: JSON.stringify({ id: submissionId, status: value }) });
const disconnected = {
  status: 1,
  stderr: `Error Domain=NSURLErrorDomain Code=-1009 NSErrorFailingURLStringKey=https://appstoreconnect.apple.com/notary/v2/submissions/${submissionId}`,
};

function harness(results) {
  const calls = [], waits = [];
  return {
    calls, waits,
    options: {
      credentials,
      maxPolls: 3,
      run: (command, args) => { calls.push([command, args]); return results.shift(); },
      wait: async (milliseconds) => { waits.push(milliseconds); },
      log() {},
    },
  };
}

test("rechecks one uploaded submission after a transient Apple status outage", async () => {
  const { calls, waits, options } = harness([submitted, disconnected, status("In Progress"), status("Accepted")]);
  assert.equal(await notarizeMacOSDmg("EduPi.dmg", options), submissionId);
  assert.equal(calls.filter(([, args]) => args[1] === "submit").length, 1);
  assert.equal(calls.filter(([, args]) => args[1] === "info").length, 3);
  assert.ok(calls[0][1].includes("--no-wait"));
  assert.ok(calls[0][1].includes("json"));
  assert.deepEqual(waits, [15_000, 15_000]);
});

test("an invalid notarization result fails without another submission or status poll", async () => {
  const { calls, waits, options } = harness([submitted, status("Invalid")]);
  await assert.rejects(notarizeMacOSDmg("EduPi.dmg", options), /Invalid/);
  assert.equal(calls.length, 2);
  assert.deepEqual(waits, []);
});

test("persistent Apple transport failure remains a hard failure at the poll limit", async () => {
  const { calls, waits, options } = harness([submitted, disconnected, disconnected, disconnected]);
  await assert.rejects(notarizeMacOSDmg("EduPi.dmg", options), /status unavailable.*network=-1009/);
  assert.equal(calls.filter(([, args]) => args[1] === "submit").length, 1);
  assert.equal(calls.length, 4);
  assert.deepEqual(waits, [15_000, 15_000]);
});

test("a timed-out status request retries the same submission", async () => {
  const { calls, waits, options } = harness([
    submitted,
    { status: null, error: Object.assign(new Error("timed out"), { code: "ETIMEDOUT" }) },
    status("Accepted"),
  ]);
  assert.equal(await notarizeMacOSDmg("EduPi.dmg", options), submissionId);
  assert.equal(calls.filter(([, args]) => args[1] === "submit").length, 1);
  assert.deepEqual(waits, [15_000]);
});

test("a submission still in progress at the bound is not accepted", async () => {
  const { calls, waits, options } = harness([
    submitted, status("In Progress"), status("In Progress"), status("In Progress"),
  ]);
  await assert.rejects(notarizeMacOSDmg("EduPi.dmg", options), /status pending after 3 polls/);
  assert.equal(calls.filter(([, args]) => args[1] === "submit").length, 1);
  assert.deepEqual(waits, [15_000, 15_000]);
});

test("other endpoint failures and mismatched submission identities are not retried", async () => {
  for (const result of [
    { status: 1, stderr: "NSURLErrorDomain Code=-1009 https://example.invalid/notary" },
    { status: 0, stdout: JSON.stringify({ id: "00000000-0000-4000-8000-000000000000", status: "Accepted" }) },
  ]) {
    const { calls, waits, options } = harness([submitted, result]);
    await assert.rejects(notarizeMacOSDmg("EduPi.dmg", options));
    assert.equal(calls.length, 2);
    assert.deepEqual(waits, []);
  }
});

test("submission without a confirmed identifier is never retried", async () => {
  const { calls, options } = harness([{
    status: 1,
    stderr: "NSURLErrorDomain Code=-1009 NSErrorFailingURLStringKey=https://appstoreconnect.apple.com/notary/v2/submissions password test-only",
  }]);
  await assert.rejects(notarizeMacOSDmg("EduPi.dmg", options), (error) => {
    assert.match(error.message, /submission failed.*network=-1009.*host=appstoreconnect\.apple\.com.*diagnostic_sha256=[a-f0-9]{12}/);
    assert.doesNotMatch(error.message, /test-only|test@example\.invalid/);
    return true;
  });
  assert.equal(calls.length, 1);
});

test("non-retryable status errors retain safe HTTP diagnostics", async () => {
  const { options } = harness([submitted, {
    status: 1,
    stderr: "HTTPError(statusCode: 401) Authentication failed for test@example.invalid password test-only",
  }]);
  await assert.rejects(notarizeMacOSDmg("EduPi.dmg", options), (error) => {
    assert.match(error.message, /status failed.*http=401.*diagnostic_sha256=[a-f0-9]{12}/);
    assert.doesNotMatch(error.message, /test-only|test@example\.invalid/);
    return true;
  });
});
