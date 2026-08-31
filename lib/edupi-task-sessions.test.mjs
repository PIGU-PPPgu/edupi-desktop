import assert from "node:assert/strict";
import test from "node:test";
import { createJiti } from "jiti";

const jiti = createJiti(import.meta.url);
const { bindTaskSessionRecord, projectTaskSessionBindings } = await jiti.import("./edupi-task-sessions.ts");

test("projects persisted bindings onto live, idle, and missing runtime states", () => {
  const stored = {
    schema_version: 1,
    bindings: [
      { task_id: "task-running", session_id: "session-running", bound_at: "2026-08-24T00:00:00.000Z" },
      { task_id: "task-idle", session_id: "session-idle", bound_at: "2026-08-24T00:00:01.000Z" },
      { task_id: "task-missing", session_id: "session-missing", bound_at: "2026-08-24T00:00:02.000Z" },
      { task_id: "unknown-task", session_id: "session-unknown", bound_at: "2026-08-24T00:00:03.000Z" },
    ],
  };

  const projected = projectTaskSessionBindings(stored, {
    taskIds: new Set(["task-running", "task-idle", "task-missing"]),
    knownSessionIds: new Set(["session-running", "session-idle"]),
    runningSessionIds: new Set(["session-running"]),
  });

  assert.equal(projected["task-running"].status, "running");
  assert.equal(projected["task-idle"].status, "idle");
  assert.equal(projected["task-missing"].status, "missing");
  assert.equal(projected["unknown-task"], undefined);
});

test("binding is idempotent per task and prevents one session from owning two tasks", () => {
  const first = bindTaskSessionRecord({ schema_version: 1, bindings: [] }, {
    taskId: "task-a",
    sessionId: "session-a",
    now: "2026-08-24T00:00:00.000Z",
  });
  const repeated = bindTaskSessionRecord(first, {
    taskId: "task-a",
    sessionId: "session-a",
    now: "2026-08-24T00:01:00.000Z",
  });

  assert.equal(repeated.bindings.length, 1);
  assert.equal(repeated.bindings[0].bound_at, "2026-08-24T00:00:00.000Z");
  assert.throws(() => bindTaskSessionRecord(repeated, {
    taskId: "task-b",
    sessionId: "session-a",
    now: "2026-08-24T00:02:00.000Z",
  }), /已经绑定到其他教学任务/);
});

test("a task can replace its stale session without leaving duplicate records", () => {
  const stored = {
    schema_version: 1,
    bindings: [{ task_id: "task-a", session_id: "session-old", bound_at: "2026-08-24T00:00:00.000Z" }],
  };
  const rebound = bindTaskSessionRecord(stored, {
    taskId: "task-a",
    sessionId: "session-new",
    now: "2026-08-24T00:05:00.000Z",
  });

  assert.deepEqual(rebound.bindings, [{ task_id: "task-a", session_id: "session-new", bound_at: "2026-08-24T00:05:00.000Z" }]);
});
