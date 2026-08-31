import assert from "node:assert/strict";
import test from "node:test";
import { createJiti } from "jiti";

const jiti = createJiti(import.meta.url);
const { createActivationRequestTracker } = await jiti.import("./edupi-activation-request.ts");

test("a cancelled activation cannot apply a late deferred result", async () => {
  const tracker = createActivationRequestTracker();
  const request = tracker.begin();
  let release;
  const deferred = new Promise((resolve) => { release = resolve; });
  let applied = 0;
  const applyWhenCurrent = deferred.then(() => {
    if (tracker.isCurrent(request)) applied += 1;
  });

  tracker.cancel();
  release();
  await applyWhenCurrent;

  assert.equal(request.signal.aborted, true);
  assert.equal(tracker.isCurrent(request), false);
  assert.equal(applied, 0);
});

test("a newer activation invalidates the older request", () => {
  const tracker = createActivationRequestTracker();
  const older = tracker.begin();
  const newer = tracker.begin();

  assert.equal(older.signal.aborted, true);
  assert.equal(tracker.isCurrent(older), false);
  assert.equal(tracker.isCurrent(newer), true);
});

test("view, stage, and unmount cancellation reasons block deferred activation", async () => {
  for (const reason of ["view-switch", "stage-switch", "unmount"]) {
    const tracker = createActivationRequestTracker();
    const request = tracker.begin();
    let release;
    const deferred = new Promise((resolve) => { release = resolve; });
    let applied = 0;
    const applyWhenCurrent = deferred.then(() => {
      if (tracker.isCurrent(request)) applied += 1;
    });

    tracker.cancel();
    release();
    await applyWhenCurrent;

    assert.equal(request.signal.aborted, true, `${reason} aborts the request`);
    assert.equal(applied, 0, `${reason} cannot apply a late result`);
  }
});
