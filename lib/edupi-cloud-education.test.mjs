import assert from "node:assert/strict";
import test from "node:test";
import { createJiti } from "jiti";

const { readCloudEducationWorkspaceBundle } = await createJiti(import.meta.url).import("./edupi-cloud-education.ts");
const scope = { issuer: "https://cloud.example.invalid", accountId: "account", workspaceId: "workspace", generation: 1 };
const fact = { fact_id: "fact-a", entity_id: "student-a", fact_kind: "academic", predicate: "理解", value: "测试事实",
  subject_ref: "数学", topic_ref: null, confidence: { basis: "explicit", score: 1 }, status: "accepted",
  source_ids: [], observation_ids: [], conflict_ids: [], has_predecessor: false, revision: 2, external_send: false };
const payload = {
  workspace_id: "workspace",
  students: [{ student_id: "student-a", name: "隔离学生", class_name: "隔离班", revision: 0 }],
  tasks: [{ task_id: "task-a", title: "隔离任务", stage: "review", revision: 3, due_date: null, note: null, status: "planned" }],
  calendar: [{ id: "calendar-a", name: "隔离校历", date: "2026-11-22" }],
  timetable: [{ id: "slot-a", day_of_week: 1, period: 1, subject: "数学", class_name: "隔离班" }],
};
const material = { material_id: "material-a", title: "隔离材料", kind: "worksheet", subject: "数学", class_id: "class-a",
  metadata_revision: 2, metadata_history_count: 2, metadata_updated_at: "2026-11-22T00:00:00.000Z", external_send: false };
const student = { student_id: "student-a", name: "隔离学生", class_name: "隔离班", revision: 0,
  profile_revision: 0, profile_history_count: 0, traits: [], parent_notes: [], deleted_at: null,
  updated_at: "2026-11-22T00:00:00.000Z" };
const entities = { ok: true, operation: "entities", action: "list", workspace_id: "workspace",
  states: [], deletions: [], history: [], external_send: false };

test("cloud projection preserves task stages and facts and keeps remote files unavailable locally", async () => {
  const calls = [];
  const client = {
    captureScope: async () => scope,
    dashboard: async selected => { calls.push(selected); return { payload }; },
    snapshot: async selected => {
      calls.push(selected);
      return { state_hash: `sha256:${"a".repeat(64)}`, payload: { ...payload, facts: [fact], materials: [material] } };
    },
    operation: async (operationName, request) => operationName === "students" && request.action === "list"
      ? { ok: true, operation: "students", action: "list", workspace_id: "workspace", students: [student], external_send: false }
      : operationName === "entities" && request.action === "list" ? entities : { spine: { conflicts: [] } },
  };
  const { data, context } = await readCloudEducationWorkspaceBundle(client);
  assert.equal(data.workspace, "cloud:workspace");
  assert.equal(data.tasks[0].boardStage, "review");
  assert.equal(data.tasks[0].boardRevision, 3);
  assert.equal(data.tasks[0].scope, "teacher_internal");
  assert.equal(data.factSpine.acceptedFacts[0].id, "fact-a");
  assert.equal(data.factSpine.acceptedFacts[0].value, "测试事实");
  assert.deepEqual(data.factSpine.studentViews[0].acceptedFactIds, ["fact-a"]);
  assert.equal(data.teacherMaterials[0].class_id, "class-a");
  assert.equal(data.teacherMaterials[0].available, false);
  assert.equal(data.teacherMaterials[0].relative_path, "cloud:workspace/material-a");
  assert.equal(data.capabilities.entityDelete.enabled, true);
  assert.equal(context.editable, false);
  assert.deepEqual(calls, [scope, scope]);
});

test("invalid fact safety fields reject the cloud response", async () => {
  const client = {
    captureScope: async () => scope, dashboard: async () => ({ payload }),
    snapshot: async () => ({ payload: { ...payload, facts: [{ ...fact, external_send: true }], materials: [] } }),
    operation: async (operationName, request) => operationName === "students" && request.action === "list"
      ? { ok: true, operation: "students", action: "list", workspace_id: "workspace", students: [student], external_send: false }
      : operationName === "entities" && request.action === "list" ? entities : { spine: { conflicts: [] } },
  };
  await assert.rejects(readCloudEducationWorkspaceBundle(client), { code: "invalid_response" });
});
