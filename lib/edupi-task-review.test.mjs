import assert from "node:assert/strict";
import test from "node:test";
import { createJiti } from "jiti";

const jiti = createJiti(import.meta.url, { tsconfigPaths: true });
const review = await jiti.import("./edupi-task-review.ts");

const supportedCommands = [
  "review_observation",
  "review_memory_candidate",
  "review_teacher_context",
  "review_work_candidate",
  "review_task",
  "import_calendar",
  "import_timetable",
  "intake_material",
  "create_task",
  "move_task_stage",
];

function task(overrides = {}) {
  return {
    task_id: "task-1",
    title: "准备开学第一周",
    status: "planned",
    due_date: "2026-09-01",
    deliverables: ["周计划"],
    source_event_id: "calendar-week-1",
    scope: "teacher_internal",
    requires_teacher_review: true,
    external_send: false,
    revision: 0,
    reviewed_at: null,
    reviewer: null,
    review_note: null,
    review_history: [],
    evidence: { source_entry_id: "calendar-entry-1" },
    ...overrides,
  };
}

function snapshot(taskValue = task(), overrides = {}) {
  return {
    snapshot_id: "snapshot-before",
    state_hash: `sha256:${"a".repeat(64)}`,
    capabilities: { supported_commands: supportedCommands, supported_projections: ["education_workspace"] },
    education_workspace: { tasks: [taskValue] },
    review_targets: [],
    ...overrides,
  };
}

function responseFor(envelope, { decision = envelope.command.decision, status = decision === "accept" ? "accepted" : decision === "modify" || decision === "rollback" ? "modified" : decision === "reject" ? "rejected" : "held", teacherReviewState = status === "held" ? "held" : status, afterSnapshotId = "snapshot-after", afterStateHash = `sha256:${"b".repeat(64)}` } = {}) {
  const revision = envelope.command.expected_revision + 1;
  const reviewId = `review-${revision}`;
  const rejectedIds = decision === "reject" ? [envelope.command.task_id] : [];
  const appliedIds = decision === "reject" ? [] : [envelope.command.task_id];
  const teacherReview = { state: teacherReviewState, reviewer_id: "teacher", reviewed_at: envelope.issued_at, note: envelope.command.note, revision };
  return {
    ok: true,
    operation: "command",
    request_id: envelope.request_id,
    supported_commands: supportedCommands,
    supported_projections: ["education_workspace"],
    receipt: {
      contract_version: "1.1",
      message_id: `receipt-${revision}`,
      request_id: envelope.request_id,
      issued_at: envelope.issued_at,
      producer: "edupi-core",
      schema_hash: envelope.schema_hash,
      snapshot_id: afterSnapshotId,
      provenance: structuredClone(envelope.provenance),
      teacher_review: teacherReview,
      external_send: false,
      payload: {
        receipt_id: `receipt-${revision}`,
        command_id: envelope.message_id,
        request_id: envelope.request_id,
        command_type: "review_task",
        target: { target_kind: "task", target_id: envelope.command.task_id, command_type: "review_task" },
        receipt_phase: "review",
        decision,
        status,
        applied_ids: appliedIds,
        rejected_ids: rejectedIds,
        reason_code: null,
        evidence_ids: envelope.command.source.evidence_ids,
        before_snapshot_id: envelope.snapshot_id,
        after_snapshot_id: afterSnapshotId,
        before_state_hash: envelope.command.source.source_hash,
        after_state_hash: afterStateHash,
        teacher_review: teacherReview,
        external_send: false,
        rollback: decision === "rollback"
          ? { available: false, rollback_id: null, expires_at: null }
          : { available: true, rollback_id: reviewId, expires_at: null },
        preview_token: null,
        action_authorization: null,
        created_at: envelope.issued_at,
      },
    },
  };
}

function refreshedTask(envelope, overrides = {}) {
  const previous = task();
  const status = envelope.command.decision === "accept" ? "accepted" : envelope.command.decision === "modify" || envelope.command.decision === "rollback" ? "modified" : envelope.command.decision === "reject" ? "rejected" : "hold";
  const reviewId = envelope.command.decision === "rollback" ? "review-rollback" : "review-1";
  return {
    ...previous,
    status,
    title: envelope.command.patch?.title ?? previous.title,
    due_date: Object.hasOwn(envelope.command.patch || {}, "due_date") ? envelope.command.patch.due_date : previous.due_date,
    deliverables: envelope.command.patch?.deliverables ?? previous.deliverables,
    revision: 1,
    reviewed_at: envelope.issued_at,
    reviewer: "teacher",
    review_note: envelope.command.note,
    review_history: [{
      review_id: reviewId,
      action: envelope.command.decision,
      previous_status: "planned",
      next_status: status,
      reviewed_at: envelope.issued_at,
      reviewer: "teacher",
      note: envelope.command.note,
      changed_fields: ["status"],
      before: { status: "planned" },
      after: { status },
      ...(envelope.command.decision === "rollback" ? { rollback_of: envelope.command.rollback_id } : {}),
    }],
    ...overrides,
  };
}

test("builds a source-bound task review from the current snapshot without inventing a hash", async () => {
  let command;
  const initial = snapshot();
  const result = await review.issueTaskReview({ taskId: "task-1", decision: "accept", note: "可执行", reviewerId: "teacher", issuedAt: "2026-08-31T10:00:00.000Z" }, {
    supportedCommands,
    readSnapshot: async () => ({ payload: initial, roots: { runtime: {}, dataRoot: {} } }),
    dispatch: async (envelope) => { command = envelope; return responseFor(envelope); },
    refreshSnapshot: async () => ({ snapshot_id: "snapshot-after", state_hash: `sha256:${"b".repeat(64)}`, education_workspace: { tasks: [refreshedTask(command)] } }),
  });
  assert.equal(command.command.source.source_hash, initial.state_hash);
  assert.deepEqual(command.command.source.evidence_ids, ["calendar-entry-1", "calendar-week-1"]);
  assert.equal(command.command.expected_revision, 0);
  assert.equal(command.command.rollback_id, null);
  assert.deepEqual(command.provenance, [{
    source_kind: "core_task",
    source_id: "task-1",
    source_path: null,
    source_hash: initial.state_hash,
    observed_at: "2026-08-31T10:00:00.000Z",
    actor: "core",
    evidence_ids: ["calendar-entry-1", "calendar-week-1"],
    parent_ids: [],
  }]);
  assert.equal(result.task.status, "accepted");
  assert.equal(result.task.revision, 1);
  assert.equal(result.task.review_history.at(-1).action, "accept");
});

test("maps camelCase modify fields to the exact wire patch and binds rollback to latest history", () => {
  const initial = snapshot(task({ review_history: [{ review_id: "review-old", action: "accept" }], revision: 1 }));
  const modify = review.buildTaskReviewCommandEnvelope({
    payload: initial,
    taskId: "task-1",
    decision: "modify",
    patch: { title: "调整后的标题", dueDate: "2026-09-02", deliverables: ["周计划", "家长提醒草稿"] },
    note: null,
    reviewerId: "teacher",
    issuedAt: "2026-08-31T10:01:00.000Z",
  });
  assert.deepEqual(modify.command.patch, { title: "调整后的标题", due_date: "2026-09-02", deliverables: ["周计划", "家长提醒草稿"] });
  assert.equal(modify.command.rollback_id, null);

  const rollback = review.buildTaskReviewCommandEnvelope({ payload: initial, taskId: "task-1", decision: "rollback", note: "恢复", reviewerId: "teacher", issuedAt: "2026-08-31T10:02:00.000Z" });
  assert.equal(rollback.command.rollback_id, "review-old");
  assert.equal(rollback.command.patch, null);
});

test("fails closed for missing evidence, missing review capability, and forged receipt bindings", async () => {
  assert.throws(() => review.buildTaskReviewCommandEnvelope({ payload: snapshot(task({ source_event_id: null, evidence: {} })), taskId: "task-1", decision: "accept" }), (error) => error?.code === "unavailable");
  await assert.rejects(review.issueTaskReview({ taskId: "task-1", decision: "accept" }, {
    supportedCommands: supportedCommands.filter((command) => command !== "review_task"),
    readSnapshot: async () => ({ payload: snapshot(), roots: { runtime: {}, dataRoot: {} } }),
    dispatch: async () => { throw new Error("must not dispatch"); },
  }), (error) => error?.code === "unsupported_command");

  await assert.rejects(review.issueTaskReview({ taskId: "task-1", decision: "accept", reviewerId: "teacher", issuedAt: "2026-08-31T10:00:00.000Z" }, {
    supportedCommands,
    readSnapshot: async () => ({ payload: snapshot(), roots: { runtime: {}, dataRoot: {} } }),
    dispatch: async (envelope) => {
      const response = responseFor(envelope);
      response.receipt.payload.before_state_hash = `sha256:${"f".repeat(64)}`;
      return response;
    },
    refreshSnapshot: async () => { throw new Error("must not refresh"); },
  }), (error) => error?.code === "invalid_envelope");
});

test("accepts rollback receipts whose review state reflects the restored task rather than the modified receipt status", async () => {
  const previousHistory = [{
    review_id: "review-old",
    action: "modify",
    previous_status: "accepted",
    next_status: "modified",
    reviewed_at: "2026-08-31T09:00:00.000Z",
    reviewer: "teacher",
    note: null,
    changed_fields: ["status"],
    before: { status: "accepted" },
    after: { status: "modified" },
  }];
  const current = task({ status: "modified", revision: 1, reviewed_at: "2026-08-31T09:00:00.000Z", reviewer: "teacher", review_history: previousHistory });
  let command;
  const result = await review.issueTaskReview({ taskId: "task-1", decision: "rollback", note: "恢复", reviewerId: "teacher", issuedAt: "2026-08-31T10:00:00.000Z" }, {
    supportedCommands,
    readSnapshot: async () => ({ payload: snapshot(current), roots: { runtime: {}, dataRoot: {} } }),
    dispatch: async (envelope) => { command = envelope; return responseFor(envelope, { teacherReviewState: "accepted" }); },
    refreshSnapshot: async () => ({
      snapshot_id: "snapshot-after",
      state_hash: `sha256:${"b".repeat(64)}`,
      education_workspace: { tasks: [{
        ...current,
        status: "accepted",
        revision: 2,
        reviewed_at: command.issued_at,
        reviewer: "teacher",
        review_note: "恢复",
        review_history: [...previousHistory, {
          review_id: "review-rollback",
          action: "rollback",
          rollback_of: "review-old",
          previous_status: "modified",
          next_status: "accepted",
          reviewed_at: command.issued_at,
          reviewer: "teacher",
          note: "恢复",
          changed_fields: ["status"],
          before: { status: "modified" },
          after: { status: "accepted" },
        }],
      }] },
    }),
  });
  assert.equal(result.receipt.status, "modified");
  assert.equal(result.receipt.teacher_review.state, "accepted");
  assert.equal(result.task.status, "accepted");
});
