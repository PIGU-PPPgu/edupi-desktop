import assert from "node:assert/strict";
import test from "node:test";
import {
  ENTITY_DELETE_KINDS,
  EntityDeleteError,
  buildEntityDeleteRequest,
  issueEntityDelete,
} from "./edupi-entity-delete.ts";

const workspace = {
  calendar: [{ event_id: "calendar-1", name: "开学" }],
  timetable: [{ slot_id: "slot-1", subject: "数学" }],
  students: [{ name: "李四" }],
  continuity: { memories: [{ memory_id: "memory-1", content: "偏好" }] },
  tasks: [{ task_id: "task-1", title: "准备第一课" }],
};

test("entity deletion request is bounded to the five Core-owned target kinds", () => {
  assert.deepEqual(ENTITY_DELETE_KINDS, ["calendar", "timetable", "memory", "student", "task"]);
  assert.deepEqual(buildEntityDeleteRequest({ kind: "calendar", id: "calendar-1", snapshotId: "snapshot-1", note: null }, "request-1"), {
    protocol: "edupi-desktop-bridge",
    protocol_version: 1,
    producer: "edupi-desktop",
    operation: "delete",
    request_id: "request-1",
    action: "delete",
    target_kind: "calendar",
    target_id: "calendar-1",
    snapshot_id: "snapshot-1",
    reviewer: "teacher",
    note: null,
  });
  assert.throws(() => buildEntityDeleteRequest({ kind: "unknown", id: "x", snapshotId: "snapshot-1", note: null }, "request-1"), EntityDeleteError);
});

test("entity deletion accepts only a Core response whose refreshed snapshot no longer contains the target", async () => {
  const result = await issueEntityDelete({ kind: "student", id: "李四", note: null }, {
    readSnapshot: async () => ({ envelope: { snapshot_id: "snapshot-1" }, payload: { education_workspace: workspace }, roots: { runtime: {}, dataRoot: {} } }),
    callCore: async (request) => ({
      ok: true,
      operation: "delete",
      request_id: request.request_id,
      target: { kind: "student", id: "李四" },
      external_send: false,
      snapshot: { education_workspace: { ...workspace, students: [] } },
    }),
  });
  assert.equal(result.target.kind, "student");
  assert.equal(result.data.education_workspace.students.length, 0);

  await assert.rejects(() => issueEntityDelete({ kind: "calendar", id: "calendar-1", note: null }, {
    readSnapshot: async () => ({ envelope: { snapshot_id: "snapshot-1" }, payload: { education_workspace: workspace }, roots: { runtime: {}, dataRoot: {} } }),
    callCore: async (request) => ({ ok: true, operation: "delete", request_id: request.request_id, target: { kind: "calendar", id: "calendar-1" }, external_send: false, snapshot: { education_workspace: workspace } }),
  }), (error) => error instanceof EntityDeleteError && error.code === "invalid_response");
});

test("entity deletion maps stale Core snapshots to a retryable conflict", async () => {
  await assert.rejects(() => issueEntityDelete({ kind: "task", id: "task-1", note: null }, {
    readSnapshot: async () => ({ envelope: { snapshot_id: "snapshot-1" }, payload: { education_workspace: workspace }, roots: { runtime: {}, dataRoot: {} } }),
    callCore: async () => ({ ok: false, operation: "delete", request_id: "request", code: "stale_snapshot" }),
  }), (error) => error instanceof EntityDeleteError && error.code === "stale_snapshot");
});

test("entity deletion lets Core reconcile a retry whose target is already absent", async () => {
  const withoutTask = { ...workspace, tasks: [] };
  const result = await issueEntityDelete({ kind: "task", id: "task-1", note: null }, {
    readSnapshot: async () => ({ envelope: { snapshot_id: "snapshot-after-delete" }, payload: { education_workspace: withoutTask }, roots: { runtime: {}, dataRoot: {} } }),
    callCore: async (request) => ({ ok: true, operation: "delete", request_id: request.request_id, target: { kind: "task", id: "task-1" }, external_send: false, replayed: true, snapshot: { education_workspace: withoutTask } }),
  });
  assert.equal(result.target.id, "task-1");
});
