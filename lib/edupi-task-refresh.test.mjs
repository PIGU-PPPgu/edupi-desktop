import assert from "node:assert/strict";
import test from "node:test";
import { createJiti } from "jiti";

const { hasCommittedTaskReview, hasCommittedTaskStage, hasEveryTrackedTask, mergeTaskRefreshRequirement, preservePendingTaskReviews, refreshUntilTaskVisible } = await createJiti(import.meta.url).import("./edupi-task-refresh.ts");

function reviewFixture() {
  const before = { id: "task-1", revision: 0, trigger: "calendar", sourceEventId: "event-1", evidence: { source_entry_id: "source-1" }, reviewHistory: [],
    status: "planned", title: "原任务", dueDate: "2026-11-07", deliverables: ["原产物"], reviewedAt: null, reviewer: null, reviewNote: null };
  const receipt = { receipt_id: "receipt-1", command_type: "review_task", decision: "modify", status: "modified", external_send: false,
    target: { target_id: "task-1", target_kind: "task", command_type: "review_task" }, rollback: { available: true, rollback_id: "review-1", expires_at: null },
    teacher_review: { revision: 1, state: "modified", reviewer_id: "teacher", reviewed_at: "2026-11-06T10:00:00.000Z", note: "核对" } };
  const task = { ...before, revision: 1, status: "modified", title: "更新后", dueDate: null, deliverables: ["新产物"],
    externalSend: false, requiresTeacherReview: true, scope: "teacher_internal", boardRevision: 0,
    reviewer: "teacher", reviewedAt: receipt.teacher_review.reviewed_at, reviewNote: "核对",
    reviewHistory: [] };
  task.reviewHistory = [reviewEntry(before, task, "modify", "review-1")];
  return { task, requirement: { before, receipt, decision: "modify", patch: { title: "更新后", dueDate: null, deliverables: ["新产物"] } } };
}

function reviewSnapshot(task) {
  return { status: task.status, title: task.title, due_date: task.dueDate, deliverables: [...task.deliverables],
    reviewed_at: task.reviewedAt, reviewer: task.reviewer, review_note: task.reviewNote, revision: task.revision };
}

function reviewEntry(before, after, action, reviewId) {
  const previous = reviewSnapshot(before), next = reviewSnapshot(after);
  return { review_id: reviewId, action, reviewer: after.reviewer, reviewed_at: after.reviewedAt, note: after.reviewNote,
    previous_status: previous.status, next_status: next.status, before: previous, after: next,
    changed_fields: ["status", "title", "due_date", "deliverables"].filter(field => JSON.stringify(previous[field]) !== JSON.stringify(next[field])) };
}

function laterReview(task, action = "accept", patch = {}) {
  const next = { ...structuredClone(task), ...patch, revision: task.revision + 1,
    status: { accept: "accepted", modify: "modified", reject: "rejected", hold: "hold", rollback: "planned" }[action],
    reviewer: "teacher-later", reviewedAt: "2026-11-06T11:00:00.000Z", reviewNote: "后续审核" };
  next.reviewHistory.push(reviewEntry(task, next, action, `review-${next.revision}`));
  return next;
}

function capabilityReviewFixture() {
  const { task, requirement } = reviewFixture();
  requirement.before.id = task.id = `capability_task_${"a".repeat(32)}`;
  requirement.before.trigger = task.trigger = "capability_package";
  requirement.before.evidence.material_kind = task.evidence.material_kind = "capability_package";
  task.title = requirement.before.title;
  task.dueDate = requirement.before.dueDate;
  task.deliverables = [...requirement.before.deliverables];
  requirement.patch = { title: task.title, dueDate: task.dueDate, deliverables: [...task.deliverables] };
  requirement.receipt.target.target_id = task.id;
  requirement.receipt.rollback = { available: false, rollback_id: null, expires_at: null };
  task.reviewHistory = [reviewEntry(requirement.before, task, "modify", requirement.receipt.receipt_id)];
  task.reviewHistory[0].changed_fields = ["status", "artifacts"];
  return { task, requirement };
}

test("review confirmation binds the unique internal task, source, history, receipt and patch", () => {
  const { task, requirement } = reviewFixture();
  assert.equal(hasCommittedTaskReview({ tasks: [task] }, requirement), true);
  const mutations = [
    tasks => tasks.splice(0),
    tasks => tasks.push(structuredClone(tasks[0])),
    tasks => { tasks[0].externalSend = true; },
    tasks => { tasks[0].scope = null; },
    tasks => { tasks[0].requiresTeacherReview = false; },
    tasks => { tasks[0].sourceEventId = "other"; },
    tasks => { tasks[0].trigger = "other"; },
    tasks => { tasks[0].evidence.source_entry_id = "other"; },
    tasks => { tasks[0].evidence.material_kind = "other"; },
    tasks => { tasks[0].revision = 2; },
    tasks => { tasks[0].revision = 0; },
    tasks => { tasks[0].status = "accepted"; },
    tasks => { tasks[0].reviewer = "other"; },
    tasks => { tasks[0].reviewedAt = "other"; },
    tasks => { tasks[0].reviewNote = "other"; },
    tasks => { tasks[0].reviewHistory = []; },
    tasks => { tasks[0].reviewHistory[0].review_id = "other"; },
    tasks => { tasks[0].reviewHistory[0].reviewer = "other"; },
    tasks => { tasks[0].reviewHistory[0].reviewed_at = "other"; },
    tasks => { tasks[0].reviewHistory[0].note = "other"; },
    tasks => { tasks[0].reviewHistory[0].action = "accept"; },
    tasks => { tasks[0].title = "other"; },
    tasks => { tasks[0].dueDate = "2026-11-08"; },
    tasks => { tasks[0].deliverables = ["other"]; },
  ];
  for (const mutate of mutations) {
    const tasks = [structuredClone(task)];
    mutate(tasks);
    assert.equal(hasCommittedTaskReview({ tasks }, requirement), false, mutate.toString());
  }
  const changedHistory = structuredClone(requirement);
  changedHistory.before.reviewHistory.push({ review_id: "old-review" });
  assert.equal(hasCommittedTaskReview({ tasks: [task] }, changedHistory), false);
});

test("capability review binds to the receipt id with rollback unavailable", () => {
  const { task, requirement } = capabilityReviewFixture();
  assert.equal(hasCommittedTaskReview({ tasks: [task] }, requirement), true);
  task.reviewHistory[0].review_id = "unrelated-receipt";
  assert.equal(hasCommittedTaskReview({ tasks: [task] }, requirement), false);
});

test("capability review requires full snapshots and its artifact change marker", () => {
  const { task, requirement } = capabilityReviewFixture();
  const mutations = [
    next => { delete next.reviewHistory[0].before; },
    next => { delete next.reviewHistory[0].after; },
    next => { next.reviewHistory[0].changed_fields = ["status"]; },
    next => { next.reviewHistory[0].changed_fields = ["status", "artifacts", "artifacts"]; },
    next => { next.title = next.reviewHistory[0].after.title = "能力任务标题不能由审核改写"; },
  ];
  for (const mutate of mutations) {
    const next = structuredClone(task);
    mutate(next);
    assert.equal(hasCommittedTaskReview({ tasks: [next] }, requirement), false, mutate.toString());
  }
});

test("a later capability modification retains complete history with Core artifact markers", () => {
  const { task, requirement } = capabilityReviewFixture();
  const next = laterReview(task, "modify");
  next.reviewHistory[1].changed_fields = ["status", "artifacts"];
  assert.equal(hasCommittedTaskReview({ tasks: [next] }, requirement), true);
  next.reviewHistory[1].before.title = "断开的能力任务快照";
  assert.equal(hasCommittedTaskReview({ tasks: [next] }, requirement), false);
});

test("a capability source refresh may regenerate a reviewed draft before a later review", () => {
  const { task, requirement } = capabilityReviewFixture();
  const accepted = laterReview(task, "accept");
  accepted.reviewHistory[1].changed_fields = ["status"];
  const regenerated = { ...structuredClone(accepted), revision: accepted.revision + 2, status: "planned" };
  const next = laterReview(regenerated, "accept");
  next.reviewHistory[2].changed_fields = ["status"];
  assert.equal(hasCommittedTaskReview({ tasks: [next] }, requirement), true);

  const invalid = [
    candidate => { candidate.reviewHistory[2].before.revision = accepted.revision; candidate.reviewHistory[2].after.revision = accepted.revision + 1; candidate.revision = accepted.revision + 1; },
    candidate => { candidate.reviewHistory[2].before.title = "篡改标题"; },
    candidate => { candidate.reviewHistory[2].before.reviewer = "other"; },
    candidate => { candidate.reviewHistory[2].before.status = "rejected"; candidate.reviewHistory[2].previous_status = "rejected"; },
  ];
  for (const mutate of invalid) {
    const candidate = structuredClone(next);
    mutate(candidate);
    assert.equal(hasCommittedTaskReview({ tasks: [candidate] }, requirement), false, mutate.toString());
  }
  const ordinary = reviewFixture();
  const ordinaryRegenerated = { ...structuredClone(ordinary.task), revision: ordinary.task.revision + 2, status: "planned" };
  const ordinaryNext = laterReview(ordinaryRegenerated, "accept");
  assert.equal(hasCommittedTaskReview({ tasks: [ordinaryNext] }, ordinary.requirement), false);
});

test("a reviewed capability remains confirmed through a sourced refresh and regeneration", () => {
  const { task, requirement } = capabilityReviewFixture();
  const sourceId = `sha256:${"b".repeat(64)}`;
  const transitions = [
    { sequence: 2, state: "modified", sourceKind: "teacher_review", sourceId: requirement.receipt.receipt_id, occurredAt: task.reviewedAt },
    { sequence: 3, state: "stale", sourceKind: "execution", sourceId, occurredAt: "2026-11-06T10:01:00.000Z" },
    { sequence: 4, state: "queued", sourceKind: "execution", sourceId, occurredAt: "2026-11-06T10:01:00.000Z" },
    { sequence: 5, state: "running", sourceKind: "execution", sourceId: "case-1:attempt:1", occurredAt: "2026-11-06T10:02:00.000Z" },
    { sequence: 6, state: "draft_ready", sourceKind: "execution", sourceId: "run-1", occurredAt: "2026-11-06T10:03:00.000Z" },
  ];
  const workCase = { kind: "capability_package", taskId: task.id, triggerId: task.sourceEventId,
    title: task.title, dueDate: task.dueDate, externalSend: false, currentState: "draft_ready", transitions };
  const regenerated = { ...structuredClone(task), status: "planned", contentStatus: "draft_ready", revision: task.revision + 3 };
  const data = { tasks: [regenerated], workCases: [workCase] };
  assert.equal(hasCommittedTaskReview(data, requirement), true);
  for (const [state, count] of [["queued", 3], ["running", 4], ["draft_ready", 5]]) {
    const candidate = structuredClone(data);
    candidate.tasks[0].contentStatus = candidate.workCases[0].currentState = state;
    candidate.workCases[0].transitions = transitions.slice(0, count);
    assert.equal(hasCommittedTaskReview(candidate, requirement), true, state);
  }
  assert.equal(hasCommittedTaskReview({ tasks: [regenerated] }, requirement), false);
  const corruptions = [
    candidate => { candidate.workCases[0].transitions[0].sourceId = "other"; },
    candidate => { candidate.workCases[0].transitions[1].sourceId = "other"; },
    candidate => { candidate.workCases[0].transitions[2].sourceId = `sha256:${"c".repeat(64)}`; },
    candidate => { candidate.workCases[0].transitions[1].sourceId = "b".repeat(64); candidate.workCases[0].transitions[2].sourceId = "b".repeat(64); },
    candidate => { candidate.workCases[0].transitions[1].occurredAt = "2026-11-06T09:00:00.000Z"; },
    candidate => { candidate.workCases[0].transitions[2].sequence = 9; },
    candidate => { candidate.workCases[0].triggerId = "other"; },
    candidate => { candidate.workCases[0].transitions.splice(1, 2); },
    candidate => { candidate.workCases.push(structuredClone(candidate.workCases[0])); },
    candidate => { candidate.tasks[0].contentStatus = "failed"; },
  ];
  for (const corrupt of corruptions) {
    const candidate = structuredClone(data);
    corrupt(candidate);
    assert.equal(hasCommittedTaskReview(candidate, requirement), false, corrupt.toString());
  }
});

test("a revoked capability ends review refresh while retaining the newer planned stale projection", async () => {
  const { task, requirement } = capabilityReviewFixture();
  const revoked = { ...structuredClone(task), revision: task.revision + 1, status: "planned", contentStatus: "stale" };
  assert.equal(hasCommittedTaskReview({ tasks: [revoked] }, requirement), true);
  const next = { tasks: [revoked] };
  assert.equal(preservePendingTaskReviews({ tasks: [requirement.before] }, next,
    new Map([[task.id, { boardRevision: 0, taskRevision: task.revision, review: requirement }]])), next);
  let reads = 0;
  const controller = new AbortController();
  assert.equal(await refreshUntilTaskVisible({
    taskId: task.id, minTaskRevision: task.revision, review: requirement, signal: controller.signal, delays: [0],
    read: async () => {
      if (++reads > 1) controller.abort();
      return next;
    },
  }), true);
  assert.equal(reads, 1);
});

test("a revoked capability still requires the exact receipt, complete history and unchanged reviewed fields", () => {
  const { task, requirement } = capabilityReviewFixture();
  const revoked = { ...structuredClone(task), revision: task.revision + 1, status: "planned", contentStatus: "stale" };
  const mutations = [
    next => { next.revision = task.revision; },
    next => { next.revision = task.revision - 1; },
    next => { next.revision = task.revision + 0.5; },
    next => { next.contentStatus = "draft_ready"; },
    next => { next.contentStatus = "queued"; },
    next => { next.status = "accepted"; },
    next => { next.reviewHistory[0].review_id = "unrelated-receipt"; },
    next => { next.reviewHistory[0].before.title = "篡改"; },
    next => { next.reviewHistory[0].after.status = "planned"; },
    next => { next.reviewHistory = []; },
    next => { next.sourceEventId = "other"; },
    next => { next.title = "other"; },
    next => { next.dueDate = null; },
    next => { next.deliverables = []; },
    next => { next.reviewer = null; },
    next => { next.reviewedAt = null; },
    next => { next.reviewNote = null; },
    next => { next.externalSend = true; },
  ];
  for (const mutate of mutations) {
    const next = structuredClone(revoked);
    mutate(next);
    assert.equal(hasCommittedTaskReview({ tasks: [next] }, requirement), false, mutate.toString());
  }
  const ordinary = reviewFixture();
  assert.equal(hasCommittedTaskReview({ tasks: [{ ...ordinary.task, revision: ordinary.task.revision + 1,
    status: "planned", contentStatus: "stale" }] }, ordinary.requirement), false);
  const later = laterReview(task, "modify");
  later.reviewHistory[1].changed_fields = ["status", "artifacts"];
  const laterRevoked = { ...later, revision: later.revision + 1, status: "planned", contentStatus: "stale" };
  assert.equal(hasCommittedTaskReview({ tasks: [laterRevoked] }, requirement), true);
  laterRevoked.reviewHistory[1].before.title = "断开的快照";
  assert.equal(hasCommittedTaskReview({ tasks: [laterRevoked] }, requirement), false);
});

test("an accepted review keeps reading through newer unrelated revision and wrong patch", async () => {
  const { task, requirement } = reviewFixture();
  const reads = [[], [{ ...task, revision: 0 }], [{ ...task, revision: 2 }], [{ ...task, title: "旧标题" }], [task]];
  let count = 0;
  assert.equal(await refreshUntilTaskVisible({
    taskId: task.id, minTaskRevision: 1, review: requirement, signal: new AbortController().signal, delays: [0],
    read: async () => ({ tasks: reads[count++] }),
  }), true);
  assert.equal(count, 5);
});

test("another pending operation retains the full review binding", () => {
  const { requirement } = reviewFixture();
  const merged = mergeTaskRefreshRequirement({ boardRevision: 0, taskRevision: 1, review: requirement }, 2, 0);
  assert.equal(merged.review, requirement);
  assert.equal(merged.boardRevision, 2);
  assert.equal(merged.taskRevision, 1);
});

test("review history must preserve its prefix and append a fresh receipt id", () => {
  const initial = reviewFixture();
  const task = laterReview(initial.task, "modify", { title: "第二次修改" });
  const requirement = { ...initial.requirement, before: initial.task, patch: { title: task.title },
    receipt: { ...initial.requirement.receipt, rollback: { available: true, rollback_id: "review-2", expires_at: null },
      teacher_review: { revision: 2, state: "modified", reviewer_id: task.reviewer, reviewed_at: task.reviewedAt, note: task.reviewNote } } };
  const previous = structuredClone(initial.task.reviewHistory[0]);
  assert.equal(hasCommittedTaskReview({ tasks: [task] }, requirement), true);
  task.reviewHistory[0].note = "篡改的旧记录";
  assert.equal(hasCommittedTaskReview({ tasks: [task] }, requirement), false);
  task.reviewHistory[0] = structuredClone(previous);
  requirement.receipt.rollback.rollback_id = task.reviewHistory[1].review_id = previous.review_id;
  assert.equal(hasCommittedTaskReview({ tasks: [task] }, requirement), false);
});

test("rollback binds the prior review and restored state with a fresh history entry", () => {
  const initial = reviewFixture();
  const { requirement } = initial;
  const task = laterReview(initial.task, "rollback", {
    title: requirement.before.title, dueDate: requirement.before.dueDate, deliverables: requirement.before.deliverables,
  });
  requirement.before = initial.task;
  requirement.decision = requirement.receipt.decision = "rollback";
  requirement.patch = null;
  requirement.receipt.receipt_id = "receipt-rollback";
  requirement.receipt.rollback = { available: false, rollback_id: null, expires_at: null };
  requirement.receipt.teacher_review = { revision: 2, state: "pending_review", reviewer_id: task.reviewer, reviewed_at: task.reviewedAt, note: task.reviewNote };
  task.reviewHistory[1].rollback_of = initial.task.reviewHistory[0].review_id;
  assert.notEqual(task.reviewHistory[1].review_id, task.reviewHistory[1].rollback_of);
  assert.equal(hasCommittedTaskReview({ tasks: [task] }, requirement), true);
  task.reviewHistory[1].rollback_of = "wrong-review";
  assert.equal(hasCommittedTaskReview({ tasks: [task] }, requirement), false);
  task.reviewHistory[1].rollback_of = null;
  assert.equal(hasCommittedTaskReview({ tasks: [task] }, requirement), false);
  task.reviewHistory[1].rollback_of = initial.task.reviewHistory[0].review_id;
  task.reviewHistory[1].review_id = initial.task.reviewHistory[0].review_id;
  assert.equal(hasCommittedTaskReview({ tasks: [task] }, requirement), false);
});

test("a later legitimate review proves the original commit without restoring its old fields", () => {
  const { task, requirement } = reviewFixture();
  for (const action of ["accept", "hold", "reject", "modify"]) {
    const later = laterReview(task, action, action === "modify" ? { title: "后续标题", dueDate: "2026-11-09", deliverables: ["后续产物"] } : {});
    assert.equal(hasCommittedTaskReview({ tasks: [later] }, requirement), true, action);
  }
  const rolledBack = laterReview(task, "rollback", {
    title: requirement.before.title, dueDate: requirement.before.dueDate, deliverables: requirement.before.deliverables,
  });
  rolledBack.reviewHistory.at(-1).rollback_of = task.reviewHistory[0].review_id;
  assert.equal(hasCommittedTaskReview({ tasks: [rolledBack] }, requirement), true);
  const reviewedAgain = laterReview(rolledBack, "accept");
  assert.equal(hasCommittedTaskReview({ tasks: [reviewedAgain] }, requirement), true);
});

test("Core's explicit null rollback marker is valid for ordinary reviews", () => {
  const { task, requirement } = reviewFixture();
  task.reviewHistory[0].rollback_of = null;
  assert.equal(hasCommittedTaskReview({ tasks: [task] }, requirement), true);
  const later = laterReview(task, "accept");
  later.reviewHistory[1].rollback_of = null;
  assert.equal(hasCommittedTaskReview({ tasks: [later] }, requirement), true);
  later.reviewHistory[1].rollback_of = "review-1";
  assert.equal(hasCommittedTaskReview({ tasks: [later] }, requirement), false);
});

test("later projections reject forged history, discontinuous revisions and unrecorded changes", async context => {
  const { task, requirement } = reviewFixture();
  const later = laterReview(task);
  const mutations = [
    next => { next.reviewHistory.splice(0, 1); },
    next => { next.reviewHistory[0].review_id = "unrelated-review"; },
    next => { next.reviewHistory[0].after.title = "未提交的标题"; },
    next => { next.reviewHistory[1].review_id = next.reviewHistory[0].review_id; },
    next => { next.reviewHistory[1].before.title = "断开的快照"; },
    next => { next.reviewHistory[1].before.revision = 0; },
    next => { next.revision = next.reviewHistory[1].after.revision = 4; },
    next => { next.reviewHistory[1].previous_status = "planned"; },
    next => { next.reviewHistory[1].next_status = "rejected"; },
    next => { next.reviewHistory[1].action = "reject"; },
    next => { next.reviewHistory[1].reviewer = "forged"; },
    next => { next.reviewHistory[1].reviewed_at = "forged"; },
    next => { next.reviewHistory[1].note = "forged"; },
    next => { next.reviewHistory[1].changed_fields = []; },
    next => { next.reviewHistory[1].changed_fields.push("title"); },
    next => { next.reviewHistory[1].changed_fields.push("status"); },
    next => { next.title = "未记录修改"; },
    next => { next.reviewNote = "未记录审核意见"; },
    next => { next.reviewHistory[1].before = null; },
    next => { delete next.reviewHistory[1].after; },
    next => {
      next.title = next.reviewHistory[1].after.title = "accept 不得修改标题";
      next.reviewHistory[1].changed_fields.push("title");
    },
  ];
  for (const mutate of mutations) {
    await context.test(mutate.toString(), () => {
      const next = structuredClone(later);
      mutate(next);
      assert.equal(hasCommittedTaskReview({ tasks: [next] }, requirement), false);
    });
  }
});

test("the committed review must continue the already trusted history snapshot", () => {
  const initial = reviewFixture();
  const task = laterReview(initial.task, "modify", { title: "第二次修改" });
  const requirement = { ...initial.requirement, before: initial.task, patch: { title: task.title },
    receipt: { ...initial.requirement.receipt, rollback: { available: true, rollback_id: "review-2", expires_at: null },
      teacher_review: { revision: 2, state: "modified", reviewer_id: task.reviewer, reviewed_at: task.reviewedAt, note: task.reviewNote } } };
  assert.equal(hasCommittedTaskReview({ tasks: [task] }, requirement), true);
  task.reviewHistory[1].before.title = "与已有历史不符";
  assert.equal(hasCommittedTaskReview({ tasks: [task] }, requirement), false);
});

test("later rollback must restore the referenced review snapshot", () => {
  const { task, requirement } = reviewFixture();
  const next = laterReview(task, "rollback", {
    title: requirement.before.title, dueDate: requirement.before.dueDate, deliverables: requirement.before.deliverables,
  });
  next.reviewHistory.at(-1).rollback_of = task.reviewHistory[0].review_id;
  assert.equal(hasCommittedTaskReview({ tasks: [next] }, requirement), true);
  next.reviewHistory.at(-1).rollback_of = "unrelated-review";
  assert.equal(hasCommittedTaskReview({ tasks: [next] }, requirement), false);
  next.reviewHistory.at(-1).rollback_of = task.reviewHistory[0].review_id;
  next.title = next.reviewHistory.at(-1).after.title = "伪造恢复标题";
  assert.equal(hasCommittedTaskReview({ tasks: [next] }, requirement), false);
});

test("later pending operations retain both revision requirements", () => {
  const first = mergeTaskRefreshRequirement(null, 0, 2);
  assert.deepEqual(mergeTaskRefreshRequirement(first, 3, 0), { boardRevision: 3, taskRevision: 2 });
  assert.deepEqual(mergeTaskRefreshRequirement({ boardRevision: 3, taskRevision: 2 }, 1, 1), { boardRevision: 3, taskRevision: 2 });
});

test("a separate stage reread must show the target revision and stage", () => {
  const task = { id: "task-1", boardRevision: 2, boardStage: "progress" };
  assert.equal(hasCommittedTaskStage({ tasks: [task] }, "task-1", 3, "progress"), false);
  assert.equal(hasCommittedTaskStage({ tasks: [task] }, "task-1", 2, "done"), false);
  assert.equal(hasCommittedTaskStage({ tasks: [task] }, "task-1", 2, "progress"), true);
});

test("rejects a stale workspace that omits an already accepted task", () => {
  const tracked = new Set(["task-new"]);
  assert.equal(hasEveryTrackedTask({ tasks: [{ id: "task-old" }] }, tracked), false);
  assert.equal(hasEveryTrackedTask({ tasks: [{ id: "task-old" }, { id: "task-new" }] }, tracked), true);
  tracked.delete("task-new");
  assert.equal(hasEveryTrackedTask({ tasks: [{ id: "task-old" }] }, tracked), true);
});

test("retries a committed task refresh with bounded backoff until the task is visible", async () => {
  const delays = [], controller = new AbortController();
  let reads = 0;
  const visible = await refreshUntilTaskVisible({
    taskId: "task-1",
    signal: controller.signal,
    delays: [0, 10, 20, 40],
    wait: async (delay) => { delays.push(delay); },
    read: async () => {
      reads += 1;
      if (reads === 1) throw new Error("Core still warming");
      return { tasks: reads < 3 ? [] : [{ id: "task-1" }] };
    },
  });
  assert.equal(visible, true);
  assert.equal(reads, 3);
  assert.deepEqual(delays, [10, 20]);
});

test("stops refresh retries after cancellation", async () => {
  const controller = new AbortController();
  let reads = 0;
  const visible = await refreshUntilTaskVisible({
    taskId: "task-1",
    signal: controller.signal,
    delays: [0, 10],
    wait: async () => controller.abort(),
    read: async () => { reads += 1; return { tasks: [] }; },
  });
  assert.equal(visible, false);
  assert.equal(reads, 1);
});

test("an accepted stage move waits for the committed board revision", async () => {
  let reads = 0;
  const visible = await refreshUntilTaskVisible({
    taskId: "task-1", minBoardRevision: 2, signal: new AbortController().signal,
    delays: [0], wait: async () => {},
    read: async () => ({ tasks: [{ id: "task-1", boardRevision: ++reads }] }),
  });
  assert.equal(visible, true);
  assert.equal(reads, 2);
});

test("an accepted review waits for the committed task revision", async () => {
  let reads = 0;
  const visible = await refreshUntilTaskVisible({
    taskId: "task-1", minTaskRevision: 2, signal: new AbortController().signal,
    delays: [0], wait: async () => {},
    read: async () => ({ tasks: [{ id: "task-1", revision: ++reads }] }),
  });
  assert.equal(visible, true);
  assert.equal(reads, 2);
});

test("an in-flight refresh observes upgraded board, task and review requirements", async () => {
  const { task, requirement } = reviewFixture();
  let current = { boardRevision: 0, taskRevision: 0 };
  let reads = 0;
  const later = laterReview(task);
  const visible = await refreshUntilTaskVisible({
    taskId: task.id, requirement: () => current, signal: new AbortController().signal, delays: [0],
    read: async () => {
      reads += 1;
      current = mergeTaskRefreshRequirement(current, 3, 2, requirement);
      return { tasks: [reads === 1 ? { ...task, boardRevision: 3 } : { ...later, boardRevision: reads }] };
    },
  });
  assert.equal(visible, true);
  assert.equal(reads, 3);
});

test("cancellation during a read cannot confirm its otherwise matching projection", async () => {
  const controller = new AbortController();
  const visible = await refreshUntilTaskVisible({
    taskId: "task-1", signal: controller.signal, delays: [0],
    read: async () => {
      controller.abort();
      return { tasks: [{ id: "task-1" }] };
    },
  });
  assert.equal(visible, false);
});

test("keeps retrying at the capped delay instead of silently abandoning a durable task", async () => {
  const delays = [], controller = new AbortController();
  let reads = 0;
  const visible = await refreshUntilTaskVisible({
    taskId: "task-1",
    signal: controller.signal,
    delays: [0, 10, 20],
    wait: async (delay) => { delays.push(delay); },
    read: async () => ({ tasks: ++reads < 6 ? [] : [{ id: "task-1" }] }),
  });
  assert.equal(visible, true);
  assert.equal(reads, 6);
  assert.deepEqual(delays, [10, 20, 20, 20, 20]);
});
