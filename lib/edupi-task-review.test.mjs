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
  "update_memory",
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

function reviewState(taskValue) {
  return { status: taskValue.status, title: taskValue.title, due_date: taskValue.due_date,
    deliverables: [...taskValue.deliverables], reviewed_at: taskValue.reviewed_at,
    reviewer: taskValue.reviewer, review_note: taskValue.review_note, revision: taskValue.revision };
}

function reviewEntry(before, after, action, reviewId, note, rollbackOf) {
  const previous = reviewState(before), next = reviewState(after);
  return { review_id: reviewId, action, previous_status: previous.status, next_status: next.status,
    reviewed_at: after.reviewed_at, reviewer: after.reviewer, note,
    changed_fields: ["status", "title", "due_date", "deliverables"].filter(field => JSON.stringify(previous[field]) !== JSON.stringify(next[field])),
    before: previous, after: next, ...(rollbackOf ? { rollback_of: rollbackOf } : {}) };
}

function refreshedTask(envelope, overrides = {}) {
  const previous = task();
  const status = envelope.command.decision === "accept" ? "accepted" : envelope.command.decision === "modify" || envelope.command.decision === "rollback" ? "modified" : envelope.command.decision === "reject" ? "rejected" : "hold";
  const reviewId = envelope.command.decision === "rollback" ? "review-rollback" : "review-1";
  const next = {
    ...previous,
    status,
    title: envelope.command.patch?.title ?? previous.title,
    due_date: Object.hasOwn(envelope.command.patch || {}, "due_date") ? envelope.command.patch.due_date : previous.due_date,
    deliverables: envelope.command.patch?.deliverables ?? previous.deliverables,
    revision: 1,
    reviewed_at: envelope.issued_at,
    reviewer: "teacher",
    review_note: envelope.command.note,
    review_history: [],
    ...overrides,
  };
  next.review_history = [reviewEntry(previous, next, envelope.command.decision, reviewId, envelope.command.note, envelope.command.rollback_id)];
  return next;
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

test("a valid task review receipt remains accepted when Core advances its projection", async () => {
  const result = await review.issueTaskReview({ taskId: "task-1", decision: "modify", expectedRevision: 0,
    patch: { title: "更新后的内部材料" }, reviewerId: "teacher", issuedAt: "2026-11-05T10:00:00.000Z" }, {
    supportedCommands,
    readSnapshot: async () => ({ payload: snapshot(), roots: { runtime: {}, dataRoot: {} } }),
    dispatch: async envelope => responseFor(envelope),
    refreshSnapshot: async () => ({ snapshot_id: "snapshot-newer", state_hash: "sha256:newer", education_workspace: { tasks: [] } }),
  });
  assert.equal(result.receipt.status, "modified");
  assert.equal(result.refreshPending, true);
  assert.equal(result.data, null);
});

test("an advanced global snapshot confirms only the exact reviewed task", async () => {
  let command, dispatches = 0;
  const result = await review.issueTaskReview({ taskId: "task-1", decision: "modify",
    patch: { title: "新标题", dueDate: null, deliverables: ["新产物"] }, note: "核对", issuedAt: "2026-11-06T10:00:00.000Z" }, {
    supportedCommands,
    readSnapshot: async () => ({ payload: snapshot(), roots: { runtime: {}, dataRoot: {} } }),
    dispatch: async envelope => { command = envelope; dispatches++; return responseFor(envelope); },
    refreshSnapshot: async () => snapshot(refreshedTask(command), { snapshot_id: "unrelated-later-snapshot", state_hash: "sha256:later" }),
  });
  assert.equal(dispatches, 1);
  assert.equal(result.refreshPending, false);
  assert.equal(result.task.title, "新标题");
  assert.equal(result.data.snapshot_id, "unrelated-later-snapshot");
});

test("a later valid review in the refreshed projection confirms the committed review", async () => {
  let command;
  const result = await review.issueTaskReview({ taskId: "task-1", decision: "modify", note: "核对",
    patch: { title: "新标题" }, issuedAt: "2026-11-06T10:00:00.000Z" }, {
    supportedCommands,
    readSnapshot: async () => ({ payload: snapshot(), roots: { runtime: {}, dataRoot: {} } }),
    dispatch: async envelope => { command = envelope; return responseFor(envelope); },
    refreshSnapshot: async () => {
      const first = refreshedTask(command);
      const later = { ...first, status: "accepted", revision: 2, reviewer: "teacher-later",
        reviewed_at: "2026-11-06T11:00:00.000Z", review_note: "再次审核" };
      later.review_history = [...first.review_history, reviewEntry(first, later, "accept", "review-2", "再次审核")];
      return snapshot(later, { snapshot_id: "snapshot-later", state_hash: "sha256:later" });
    },
  });
  assert.equal(result.refreshPending, false);
  assert.equal(result.task.revision, 2);
  assert.equal(result.task.status, "accepted");
});

for (const [name, mutate] of Object.entries({
  missingOriginal: taskValue => taskValue.review_history.shift(),
  disconnectedState: taskValue => { taskValue.review_history[1].before.title = "伪造的旧状态"; },
  skippedRevision: taskValue => { taskValue.review_history[1].before.revision = 0; },
})) {
  test(`a later projection rejects ${name} review history`, async () => {
    let command;
    await assert.rejects(review.issueTaskReview({ taskId: "task-1", decision: "modify", note: "核对",
      patch: { title: "新标题" }, issuedAt: "2026-11-06T10:00:00.000Z" }, {
      supportedCommands,
      readSnapshot: async () => ({ payload: snapshot(), roots: { runtime: {}, dataRoot: {} } }),
      dispatch: async envelope => { command = envelope; return responseFor(envelope); },
      refreshSnapshot: async () => {
        const first = refreshedTask(command);
        const later = { ...first, status: "accepted", revision: 2, reviewer: "teacher-later",
          reviewed_at: "2026-11-06T11:00:00.000Z", review_note: "再次审核" };
        later.review_history = [...first.review_history, reviewEntry(first, later, "accept", "review-2", "再次审核")];
        mutate(later);
        return snapshot(later, { snapshot_id: "snapshot-later", state_hash: "sha256:later" });
      },
    }), { code: "invalid_envelope" });
  });
}

for (const newer of [false, true]) {
  for (const missing of [false, true]) {
    test(`accepted review waits for ${missing ? "missing" : "old"} task in ${newer ? "advanced" : "receipt"} snapshot without redispatch`, async () => {
      let dispatches = 0;
      const result = await review.issueTaskReview({ taskId: "task-1", decision: "accept" }, {
        supportedCommands,
        readSnapshot: async () => ({ payload: snapshot(), roots: { runtime: {}, dataRoot: {} } }),
        dispatch: async envelope => { dispatches++; return responseFor(envelope); },
        refreshSnapshot: async () => ({ snapshot_id: newer ? "newer" : "snapshot-after", state_hash: newer ? "sha256:newer" : `sha256:${"b".repeat(64)}`,
          education_workspace: { tasks: missing ? [] : [task()] } }),
      });
      assert.equal(dispatches, 1);
      assert.equal(result.refreshPending, true);
      assert.equal(result.receipt.status, "accepted");
      assert.equal(result.data, null);
      assert.equal(result.task, null);
    });
  }
}

const forgedTasks = {
  duplicate: tasks => tasks.push(structuredClone(tasks[0])),
  external: tasks => { tasks[0].external_send = true; },
  scope: tasks => { tasks[0].scope = "external"; },
  reviewBoundary: tasks => { tasks[0].requires_teacher_review = false; },
  source: tasks => { tasks[0].source_event_id = "different"; },
  evidence: tasks => { tasks[0].evidence.source_entry_id = "different"; },
  reviewId: tasks => { tasks[0].review_history[0].review_id = "different"; },
  history: tasks => { tasks[0].review_history = []; },
  decision: tasks => { tasks[0].review_history[0].action = "hold"; },
  status: tasks => { tasks[0].status = "hold"; },
  revision: tasks => { tasks[0].revision = 2; },
  reviewer: tasks => { tasks[0].reviewer = "different"; },
  reviewedAt: tasks => { tasks[0].reviewed_at = "2026-11-06T11:00:00.000Z"; },
  note: tasks => { tasks[0].review_note = "different"; },
  historyReviewer: tasks => { tasks[0].review_history[0].reviewer = "different"; },
  historyTime: tasks => { tasks[0].review_history[0].reviewed_at = "different"; },
  historyNote: tasks => { tasks[0].review_history[0].note = "different"; },
  title: tasks => { tasks[0].title = "旧标题"; },
  dueDate: tasks => { tasks[0].due_date = "2026-11-09"; },
  deliverables: tasks => { tasks[0].deliverables = ["旧产物"]; },
};

for (const [name, mutate] of Object.entries(forgedTasks)) {
  test(`advanced snapshot cannot confirm a mismatched task ${name}`, async () => {
    let command, dispatches = 0;
    await assert.rejects(review.issueTaskReview({ taskId: "task-1", decision: "modify", note: "核对",
      patch: { title: "新标题", dueDate: null, deliverables: ["新产物"] }, issuedAt: "2026-11-06T10:00:00.000Z" }, {
      supportedCommands,
      readSnapshot: async () => ({ payload: snapshot(), roots: { runtime: {}, dataRoot: {} } }),
      dispatch: async envelope => { command = envelope; dispatches++; return responseFor(envelope); },
      refreshSnapshot: async () => {
        const tasks = [refreshedTask(command)];
        mutate(tasks);
        return { snapshot_id: "advanced", state_hash: "sha256:advanced", education_workspace: { tasks } };
      },
    }), { code: "invalid_envelope" });
    assert.equal(dispatches, 1);
  });
}

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

function staleResponse(envelope) {
  const response = responseFor(envelope);
  response.receipt.snapshot_id = envelope.snapshot_id;
  response.receipt.teacher_review = structuredClone(envelope.teacher_review);
  Object.assign(response.receipt.payload, {
    status: "stale_snapshot", reason_code: "stale_snapshot", applied_ids: [], rejected_ids: [],
    after_snapshot_id: null, after_state_hash: null,
    before_state_hash: `sha256:${"f".repeat(64)}`,
    rollback: { available: false, rollback_id: null, expires_at: null },
    teacher_review: structuredClone(envelope.teacher_review),
  });
  return response;
}

test("Core's current-state hash in a stale snapshot receipt requests refresh without redispatch", async () => {
  let dispatches = 0, refreshes = 0;
  await assert.rejects(review.issueTaskReview({ taskId: "task-1", decision: "accept", reviewerId: "teacher" }, {
    supportedCommands,
    readSnapshot: async () => ({ payload: snapshot(), roots: { runtime: {}, dataRoot: {} } }),
    dispatch: async envelope => { dispatches++; return staleResponse(envelope); },
    refreshSnapshot: async () => { refreshes++; throw new Error("must not refresh"); },
  }), { code: "stale_snapshot" });
  assert.equal(dispatches, 1);
  assert.equal(refreshes, 0);
});

for (const [name, mutate] of Object.entries({
  applied: response => { response.receipt.payload.applied_ids = ["task-1"]; },
  afterHash: response => { response.receipt.payload.after_state_hash = `sha256:${"b".repeat(64)}`; },
  beforeSnapshot: response => { response.receipt.payload.before_snapshot_id = "other"; },
  target: response => { response.receipt.payload.target.target_id = "other"; },
})) {
  test(`forged stale snapshot receipt rejects ${name}`, async () => {
    await assert.rejects(review.issueTaskReview({ taskId: "task-1", decision: "accept", reviewerId: "teacher" }, {
      supportedCommands,
      readSnapshot: async () => ({ payload: snapshot(), roots: { runtime: {}, dataRoot: {} } }),
      dispatch: async envelope => { const response = staleResponse(envelope); mutate(response); return response; },
      refreshSnapshot: async () => { throw new Error("must not refresh"); },
    }), { code: "invalid_envelope" });
  });
}

test("rejects a task revision newer than the one shown to the teacher before dispatch", () => {
  assert.throws(
    () => review.buildTaskReviewCommandEnvelope({ payload: snapshot(), taskId: "task-1", expectedRevision: 1, decision: "accept" }),
    (error) => error?.code === "stale_revision",
  );
});

test("ordinary task reviews still reject an unavailable rollback binding", async () => {
  await assert.rejects(review.issueTaskReview({ taskId: "task-1", decision: "accept", issuedAt: "2026-08-31T10:00:00.000Z" }, {
    supportedCommands,
    readSnapshot: async () => ({ payload: snapshot(), roots: { runtime: {}, dataRoot: {} } }),
    dispatch: async envelope => {
      const response = responseFor(envelope);
      response.receipt.payload.rollback = { available: false, rollback_id: null, expires_at: null };
      return response;
    },
    refreshSnapshot: async () => { throw new Error("must reject before refresh"); },
  }), { code: "invalid_envelope" });
});

test("accepts rollback receipts whose review state reflects the restored task rather than the modified receipt status", async () => {
  const original = task();
  const accepted = task({ status: "accepted", revision: 1, reviewed_at: "2026-08-31T09:00:00.000Z", reviewer: "teacher" });
  const previousHistory = [reviewEntry(original, accepted, "accept", "review-old", null)];
  const current = { ...accepted, review_history: previousHistory };
  let command;
  const result = await review.issueTaskReview({ taskId: "task-1", decision: "rollback", note: "恢复", reviewerId: "teacher", issuedAt: "2026-08-31T10:00:00.000Z" }, {
    supportedCommands,
    readSnapshot: async () => ({ payload: snapshot(current), roots: { runtime: {}, dataRoot: {} } }),
    dispatch: async (envelope) => { command = envelope; return responseFor(envelope, { teacherReviewState: "pending_review" }); },
    refreshSnapshot: async () => ({
      snapshot_id: "snapshot-after",
      state_hash: `sha256:${"b".repeat(64)}`,
      education_workspace: { tasks: [{
        ...current,
        status: "planned",
        revision: 2,
        reviewed_at: command.issued_at,
        reviewer: "teacher",
        review_note: "恢复",
        review_history: [...previousHistory, reviewEntry(current, {
          ...current, status: "planned", revision: 2, reviewed_at: command.issued_at, reviewer: "teacher", review_note: "恢复",
        }, "rollback", "review-rollback", "恢复", "review-old")],
      }] },
    }),
  });
  assert.equal(result.receipt.status, "modified");
  assert.equal(result.receipt.teacher_review.state, "pending_review");
  assert.equal(result.task.status, "planned");
});
