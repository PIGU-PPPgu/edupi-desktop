import assert from "node:assert/strict";
import test from "node:test";
import { createJiti } from "jiti";

const monitor = await createJiti(import.meta.url, { tsconfigPaths: true }).import("./edupi-completion-monitor.ts");

function task(id, contentStatus, evidence = {}) {
  return { id, title: `任务 ${id || "missing"}`, contentStatus, evidence };
}

test("completion snapshots are silent baselines and emit each real transition once", () => {
  const baseline = monitor.completionSnapshot([task("one", "not_generated")], "/workspace");
  const ready = monitor.completionSnapshot([task("one", "draft_ready", { file_path: ".edupi/output/one.md", file_sha256: `sha256:${"a".repeat(64)}` })], "/workspace");
  assert.equal(monitor.diffTaskCompletionTransitions(baseline, ready).length, 1);
  assert.equal(monitor.diffTaskCompletionTransitions(ready, ready).length, 0);

  const running = monitor.completionSnapshot([task("one", "running")], "/workspace");
  assert.equal(monitor.diffTaskCompletionTransitions(ready, running).length, 0);
  assert.equal(monitor.diffTaskCompletionTransitions(running, ready).length, 1);
});

test("changed artifacts, new ready tasks, and failures produce deterministic events", () => {
  const before = monitor.completionSnapshot([task("a", "draft_ready", { file_path: "a.md", file_sha256: `sha256:${"a".repeat(64)}` })], "/workspace");
  const after = monitor.completionSnapshot([
    task("b", "generation_failed"),
    task("a", "draft_ready", { file_path: "a.md", file_sha256: `sha256:${"b".repeat(64)}` }),
  ], "/workspace");
  assert.deepEqual(monitor.diffTaskCompletionTransitions(before, after).map((item) => [item.taskId, item.completion]), [
    ["a", "ready"],
    ["b", "failed"],
  ]);
});

test("snapshot signatures are stable, include active statuses, and skip null task ids", () => {
  const left = monitor.completionSnapshot([task("b", "running"), task(null, "draft_ready"), task("a", "queued")], "/workspace");
  const right = monitor.completionSnapshot([task("a", "queued"), task("b", "running")], "/workspace");
  assert.equal(monitor.completionSnapshotSignature(left), monitor.completionSnapshotSignature(right));
  assert.deepEqual(Object.keys(left), ["a", "b"]);
  assert.notEqual(monitor.completionSnapshotSignature(left), monitor.completionSnapshotSignature(monitor.completionSnapshot([task("b", "draft_ready"), task("a", "queued")], "/workspace")));
});

test("completion inbox exposes only teacher-facing ready and failed rows", () => {
  const items = monitor.completionInboxItems([
    task("ready", "draft_ready", { file_path: "/private/artifact.md", file_sha256: `sha256:${"a".repeat(64)}` }),
    task("failed", "generation_failed"),
    task("running", "running"),
  ]);
  assert.deepEqual(items.map((item) => [item.taskId, item.kind, item.title]), [
    ["failed", "failed", "任务 failed"],
    ["ready", "ready", "任务 ready"],
  ]);
  assert.equal(JSON.stringify(items).includes("/private/artifact.md"), false);
  assert.equal(JSON.stringify(items).includes("sha256:"), false);
});

test("only the exact C9 generation_failed state is a failed completion", () => {
  assert.equal(monitor.completionState(task("exact", "generation_failed")), "failed");
  assert.equal(monitor.completionState(task("legacy-failed", "failed")), null);
  assert.equal(monitor.completionState(task("legacy-error", "error")), null);
  assert.equal(monitor.completionState(task("hyphen", "generation-failed")), null);
  assert.equal(monitor.completionState(task("spaced", "generation failed")), null);
  assert.equal(monitor.completionState(task("upper", "GENERATION_FAILED")), null);
  assert.equal(monitor.completionState(task("padded", " generation_failed ")), null);
  assert.deepEqual(monitor.completionInboxItems([
    task("legacy-failed", "failed"),
    task("legacy-error", "error"),
    task("hyphen", "generation-failed"),
    task("spaced", "generation failed"),
    task("upper", "GENERATION_FAILED"),
    task("padded", " generation_failed "),
  ]), []);
});

test("only the exact C9 draft_ready state is a ready completion", () => {
  assert.equal(monitor.completionState(task("exact", "draft_ready")), "ready");
  for (const value of ["draft-ready", "draft ready", "DRAFT_READY", " draft_ready "]) {
    assert.equal(monitor.completionState(task(value, value)), null);
  }
});
