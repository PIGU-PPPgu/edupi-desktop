import assert from "node:assert/strict";
import test from "node:test";
import * as stapler from "./validate-macos-staple.mjs";

const ticketUrl = "https://api.apple-cloudkit.com/database/1/com.apple.gk.ticket-delivery/production/public/records/lookup";
const connectionLost = { status: 68, stderr: `Error Domain=NSURLErrorDomain Code=-1005 "The network connection was lost." NSErrorFailingURLStringKey=${ticketUrl}` };
function harness(results) {
  const calls = [], waits = [];
  return { calls, waits, options: {
    run: (...args) => { calls.push(args); return results[Math.min(calls.length - 1, results.length - 1)]; },
    wait: async delay => { waits.push(delay); }, log() {},
  } };
}

test("stapling retries the actual .75 ticket-delivery disconnect and must succeed", async () => {
  const { calls, waits, options } = harness([connectionLost, { status: 0 }]);
  await stapler.stapleMacOSArtifact("signed/EduPi.dmg", options);
  assert.deepEqual(calls.map(call => call.slice(0, 2)), Array(2).fill(["xcrun", ["stapler", "staple", "signed/EduPi.dmg"]]));
  assert.deepEqual(waits, [5_000]);
});

test("stapling fails after three persistent transport failures", async () => {
  const { calls, waits, options } = harness([connectionLost]);
  await assert.rejects(stapler.stapleMacOSArtifact("EduPi.dmg", options), /status 68/);
  assert.equal(calls.length, 3);
  assert.deepEqual(waits, [5_000, 5_000]);
});

test("stapling retries offline errors only at the exact Apple ticket endpoint", async () => {
  const { calls, options } = harness([{ ...connectionLost, stderr: `NSURLErrorDomain Code=-1009 NSErrorFailingURLStringKey=${ticketUrl}` }, { status: 0 }]);
  await stapler.stapleMacOSArtifact("EduPi.dmg", options);
  assert.equal(calls.length, 2);
});

test("stapling does not retry ticket, signature, unrelated network or process failures", async () => {
  for (const result of [
    { status: 65, stderr: "The ticket is invalid" },
    { status: 68, stderr: "Could not find a ticket" },
    { ...connectionLost, status: 65 },
    { status: 68, stderr: "NSURLErrorDomain Code=-1005 https://example.com/records/lookup" },
    { status: 68, stderr: "NSURLErrorDomain Code=-1009" },
    { status: 68, stderr: "NSURLErrorDomain Code=-1009 https://example.com/untrusted" },
    { status: 68, stderr: `${connectionLost.stderr} https://example.com/untrusted` },
    { status: 68, stderr: `NSURLErrorDomain Code=-1001 ${ticketUrl}` },
    { status: null, error: new Error("missing xcrun") },
  ]) {
    const { calls, waits, options } = harness([result]);
    await assert.rejects(stapler.stapleMacOSArtifact("EduPi.dmg", options), /Ticket stapling failed/);
    assert.equal(calls.length, 1);
    assert.equal(waits.length, 0);
  }
});
