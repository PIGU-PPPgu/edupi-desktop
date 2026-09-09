import assert from "node:assert/strict";
import test from "node:test";

const { createDraftSubmissionGate } = await import("./draft-submission.ts");
function deferred() {
  let resolve;
  let reject;
  const promise = new Promise((yes, no) => { resolve = yes; reject = no; });
  return { promise, resolve, reject };
}

test("double submit while a reference fetch is pending dispatches and clears only once", async () => {
  const gate = createDraftSubmissionGate();
  const fetch = deferred();
  const sent = [];
  const first = gate.run(() => fetch.promise, (value) => sent.push(value), assert.fail);
  await gate.run(() => { throw new Error("duplicate fetch"); }, assert.fail, assert.fail);
  fetch.resolve("expanded");
  await first;
  assert.deepEqual(sent, ["expanded"]);
});

for (const change of ["edit", "session switch", "unmount", "attachment change"]) {
  test(`${change} while fetching never dispatches or clears the replacement draft`, async () => {
    const gate = createDraftSubmissionGate();
    const fetch = deferred();
    let signal;
    const pending = gate.run((next) => { signal = next; return fetch.promise; }, assert.fail, assert.fail);
    gate.invalidate();
    assert.equal(signal.aborted, true);
    fetch.resolve("stale");
    await pending;
  });
}

test("a failed reference fetch retains the draft and permits retry", async () => {
  const gate = createDraftSubmissionGate();
  let errors = 0;
  await gate.run(async () => { throw new Error("offline"); }, assert.fail, () => errors++);
  let sent = false;
  await gate.run(async () => "retry", () => { sent = true; }, assert.fail);
  assert.equal(errors, 1);
  assert.equal(sent, true);
});

test("a hung reference fetch has a deadline, aborts and never sends a late result", async () => {
  const gate = createDraftSubmissionGate(10);
  const fetch = deferred();
  let signal;
  let errors = 0;
  await gate.run((next) => { signal = next; return fetch.promise; }, assert.fail, () => errors++);
  assert.equal(signal.aborted, true);
  assert.equal(errors, 1);
  fetch.resolve("late");
  await Promise.resolve();
});
