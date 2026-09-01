import assert from "node:assert/strict";
import test from "node:test";
import { buildEducationContract } from "./edupi-education-contract.ts";
import { activeLivingWorkCases, isTaskReviewable, taskRequiresWorkCase, workCaseForTask, workCaseStateLabel, workCaseTransitionLabel } from "./edupi-work-case.ts";

function contract(workCases, taskOverrides = {}) {
  return buildEducationContract({
    tasks: [{ id: "task-1", title: "准备开学第一课", status: "planned", source_event_id: "event-1", due_date: "2026-08-31", scope: "teacher_internal", requires_teacher_review: true, external_send: false, ...taskOverrides }],
    snapshotPayload: { work_cases: workCases },
  });
}

const coreCase = {
  work_case_id: "work_case_11111111111111111111111111111111",
  case_kind: "calendar_preparation",
  trigger_id: "event-1",
  task_id: "task-1",
  title: "准备开学第一课",
  current_state: "running",
  due_date: "2026-08-31",
  execution_revision: 2,
  artifact_revision: 1,
  transition_revision: 2,
  source_ids: ["event-1"],
  artifact_ids: [],
  transitions: [
    { transition_id: "transition-1", sequence: 1, state: "queued", occurred_at: "2026-08-30T08:00:00.000Z", source_kind: "execution", source_id: "execution-1", artifact_ids: [], external_send: false },
    { transition_id: "transition-2", sequence: 2, state: "running", occurred_at: "2026-08-30T08:01:00.000Z", source_kind: "execution", source_id: "execution-1", artifact_ids: [], external_send: false },
  ],
  external_send: false,
};

test("projects one strict Core work case onto the matching calendar task", () => {
  const data = contract([coreCase]);
  assert.equal(data.workCases.length, 1);
  assert.deepEqual(data.workCases[0], {
    id: coreCase.work_case_id,
    kind: "calendar_preparation",
    triggerId: "event-1",
    taskId: "task-1",
    title: "准备开学第一课",
    currentState: "running",
    dueDate: "2026-08-31",
    executionRevision: 2,
    artifactRevision: 1,
    transitionRevision: 2,
    sourceIds: ["event-1"],
    artifactIds: [],
    transitions: [
      { id: "transition-1", sequence: 1, state: "queued", occurredAt: "2026-08-30T08:00:00.000Z", sourceKind: "execution", sourceId: "execution-1", artifactIds: [], externalSend: false },
      { id: "transition-2", sequence: 2, state: "running", occurredAt: "2026-08-30T08:01:00.000Z", sourceKind: "execution", sourceId: "execution-1", artifactIds: [], externalSend: false },
    ],
    externalSend: false,
  });
  assert.equal(workCaseForTask(data, "task-1")?.id, coreCase.work_case_id);
  assert.equal(workCaseStateLabel(data.workCases[0].currentState), "正在准备");
  assert.equal(workCaseTransitionLabel(data.workCases[0].transitions[1]), "开始准备");
});

test("fails the complete work-case projection closed on ghosts, duplicates, or broken transition order", () => {
  assert.deepEqual(contract([{ ...coreCase, task_id: "missing-task" }]).workCases, []);
  assert.deepEqual(contract([coreCase, coreCase]).workCases, []);
  assert.deepEqual(contract([{ ...coreCase, transitions: [...coreCase.transitions].reverse() }]).workCases, []);
  assert.deepEqual(contract(undefined).workCases, []);
});

test("orders only live Core flow states for the Today strip", () => {
  const data = contract([
    coreCase,
    { ...coreCase, work_case_id: "work_case_22222222222222222222222222222222", current_state: "draft_ready", task_id: "task-1" },
  ]);
  assert.deepEqual(data.workCases, [], "duplicate task identities fail closed before UI ordering");
  assert.deepEqual(activeLivingWorkCases([{ ...contract([coreCase]).workCases[0], currentState: "planned" }, contract([coreCase]).workCases[0]]).map((item) => item.currentState), ["running"]);
});

test("accepts a teaching-before-class case only when it binds the matching timetable task", () => {
  const teaching = buildEducationContract({
    tasks: [{ id: "teaching-task-1", title: "第1周 · 数学 · 703 · 第2节课前准备", trigger: "teaching_before_class", status: "planned", source_event_id: "timetable:slot-1:2026-08-31", due_date: "2026-08-30", source_event_date: "2026-08-31", scope: "teacher_internal", requires_teacher_review: true, external_send: false }],
    snapshotPayload: { work_cases: [{ ...coreCase, work_case_id: "work_case_33333333333333333333333333333333", case_kind: "teaching_before_class", trigger_id: "timetable:slot-1:2026-08-31", task_id: "teaching-task-1", title: "第1周 · 数学 · 703 · 第2节课前准备", current_state: "planned", due_date: "2026-08-30", execution_revision: 0, artifact_revision: 0, transition_revision: 0, source_ids: ["timetable:slot-1:2026-08-31"], artifact_ids: [], transitions: [] }] },
  });
  assert.equal(teaching.workCases.length, 1);
  assert.equal(teaching.workCases[0].kind, "teaching_before_class");
});

test("fails the complete work-case projection closed when case kind and task trigger are semantically swapped", () => {
  assert.deepEqual(contract([{ ...coreCase, case_kind: "teaching_before_class" }]).workCases, []);
  assert.deepEqual(contract([coreCase], { trigger: "teaching_before_class" }).workCases, []);
});

test("requires Core work cases for producer-eligible tasks but preserves genuine legacy fallback", () => {
  const expectedCoreTask = contract([], { content_status: "ready", deliverables: ["讲义"] }).tasks[0];
  assert.equal(taskRequiresWorkCase(expectedCoreTask), true);
  assert.equal(isTaskReviewable(expectedCoreTask, null), false);

  const legacyTask = buildEducationContract({
    tasks: [{ title: "历史兼容任务", status: "planned", content_status: "ready", deliverables: ["讲义"], audience: ["teacher"], requires_teacher_review: true, external_send: false, scope: "teacher_internal", evidence: { source_summary: "历史来源" } }],
    snapshotPayload: { work_cases: [] },
  }).tasks[0];
  assert.equal(taskRequiresWorkCase(legacyTask), false);
  assert.equal(isTaskReviewable(legacyTask, null), true);
});
