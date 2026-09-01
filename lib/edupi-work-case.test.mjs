import assert from "node:assert/strict";
import test from "node:test";
import { buildEducationContract } from "./edupi-education-contract.ts";
import { activeLivingWorkCases, workCaseForTask, workCaseStateLabel, workCaseTransitionLabel } from "./edupi-work-case.ts";

function contract(workCases) {
  return buildEducationContract({
    tasks: [{ id: "task-1", title: "准备开学第一课", status: "planned", source_event_id: "event-1", due_date: "2026-08-31", scope: "teacher_internal", requires_teacher_review: true, external_send: false }],
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
