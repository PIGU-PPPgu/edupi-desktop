import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { createJiti } from "jiti";

const { buildEducationContract } = await import("../lib/edupi-education-contract.ts");
const { POST } = await createJiti(import.meta.url, { tsconfigPaths: true }).import("../app/api/edupi/education/route.ts");

const explicitTask = {
  id: "task-1",
  title: "开学准备任务（教师内部）",
  status: "planned",
  revision: 0,
  content_status: "not_generated",
  delivery_status: "not_approved",
  source_event_id: "event-confirmed",
  source_event_name: "开学",
  source_event_date: "2026-09-01",
  trigger_date: "2026-08-25",
  due_date: "2026-09-01",
  deliverables: ["教师内部核对清单"],
  audience: ["teacher"],
  requires_teacher_review: true,
  external_send: false,
  scope: "teacher_internal",
  evidence: { rule: "calendar_event_internal" },
};

const sample = buildEducationContract({
  workspace: "/tmp/edupi",
  calendar: [
    { id: "event-confirmed", date: "2026-09-01", end_date: "2026-09-02", name: "开学", type: "teaching", source: "official_school_calendar", confidence: "confirmed", notes: "学校校历明确标注" },
    { id: "event-inferred", date: "2026-09-10", name: "可能的活动", type: "activity", source: "inferred", confidence: "inferred" },
  ],
  tasks: [explicitTask],
  // These legacy-shaped inputs must not create Desktop tasks.
  studentEvents: [{ id: "student-event-1", student: "脱敏学生甲", content: "学生事件" }],
  teachingMaterials: [{ id: "material-1", content: "材料证据", meta: { source: "teacher_material" } }],
  materialCandidates: [{ id: "candidate-1", content: "候选材料", meta: { workflow_status: "candidate", inference_status: "candidate_only" } }],
  taskSessions: {
    "task-1": { taskId: "task-1", sessionId: "session-1", boundAt: "2026-08-24T00:00:00.000Z", status: "running" },
  },
});

test("normalizes Core-provided calendar facts without inventing dates or confidence", () => {
  assert.equal(sample.calendar[0].date, "2026-09-01");
  assert.equal(sample.calendar[0].endDate, "2026-09-02");
  assert.equal(sample.calendar[0].dateStatus, "explicit");
  assert.equal(sample.calendar[0].confidence, "confirmed");
  assert.equal(sample.calendar[1].preparationStatus, "hold");
});

test("preserves Core invalid date status as a held no-date fact", () => {
  const contract = buildEducationContract({
    calendar: [
      { id: "invalid-missing-end", date: "2026-09-10", end_date: null, date_status: "invalid", preparation_status: "hold", name: "日期待核对" },
      { id: "invalid-reversed-end", date: "2026-09-10", end_date: "2026-09-09", date_status: "invalid", preparation_status: "hold", name: "结束日期倒序" },
    ],
  });

  assert.deepEqual(contract.calendar.map(({ date, endDate, dateStatus, preparationStatus }) => ({ date, endDate, dateStatus, preparationStatus })), [
    { date: null, endDate: null, dateStatus: "invalid", preparationStatus: "hold" },
    { date: null, endDate: null, dateStatus: "invalid", preparationStatus: "hold" },
  ]);
});

test("strengthens Core pending and held states without discarding explicit dates", () => {
  const contract = buildEducationContract({
    calendar: [
      { id: "pending-review", date: "2026-09-10", end_date: null, date_status: "explicit", preparation_status: "read_only", state: "pending_review", name: "待审节点" },
      { id: "held", date: "2026-09-11", end_date: null, date_status: "explicit", preparation_status: "read_only", state: "held", name: "保留节点" },
    ],
  });

  assert.deepEqual(contract.calendar.map(({ date, preparationStatus }) => ({ date, preparationStatus })), [
    { date: "2026-09-10", preparationStatus: "hold" },
    { date: "2026-09-11", preparationStatus: "hold" },
  ]);
});

test("maps only explicit input.tasks and never synthesizes student/material tasks", () => {
  assert.equal(sample.tasks.length, 1);
  assert.deepEqual(sample.tasks.map((task) => task.id), ["task-1"]);
  assert.equal(sample.tasks.some((task) => task.trigger === "student_follow_up"), false);
  assert.equal(sample.tasks.some((task) => task.trigger === "teaching_adjustment_candidate"), false);
  const task = sample.tasks[0];
  assert.equal(task.status, "planned");
  assert.equal(task.contentStatus, "not_generated");
  assert.equal(task.requiresTeacherReview, true);
  assert.equal(task.externalSend, false);
  assert.deepEqual(task.evidence, { rule: "calendar_event_internal" });
});

test("preserves the Desktop-owned task-session overlay without changing task facts", () => {
  assert.deepEqual(sample.taskSessions["task-1"], {
    taskId: "task-1",
    sessionId: "session-1",
    boundAt: "2026-08-24T00:00:00.000Z",
    status: "running",
  });
  assert.equal(sample.tasks[0].scope, "teacher_internal");
});

test("keeps Core-v1.1 writes and intake visibly disabled", () => {
  assert.equal(sample.capabilities.taskReview.enabled, false);
  assert.equal(sample.capabilities.taskReview.mode, "read_only");
  assert.deepEqual(sample.capabilities.taskReview.actions, ["accept", "modify", "reject", "hold", "rollback"]);
  assert.equal(sample.capabilities.calendar.enabled, false);
  assert.equal(sample.capabilities.timetable.enabled, false);
  assert.equal(sample.capabilities.materialIntake.enabled, false);
});

test("education route POST is visibly unavailable", async () => {
  const response = await POST();
  const body = await response.json();
  assert.equal(response.status, 503);
  assert.match(body.error, /不可用/);
});

test("production education route/server have no direct Core writers or JSON fallback", async () => {
  const server = await readFile(new URL("../lib/edupi-education-server.ts", import.meta.url), "utf8");
  assert.match(server, /readEduPiEducationSnapshot/);
  assert.doesNotMatch(server, /teacher_task_review\.mjs|reviewTeacherTask|importCalendar|importTimetable|readFile|loadJson|memoryDir/);
  const route = await readFile(new URL("../app/api/edupi/education/route.ts", import.meta.url), "utf8");
  assert.match(route, /readEducationContract/);
  assert.match(route, /export async function POST/);
  assert.match(route, /status:\s*503/);
  assert.doesNotMatch(route, /importCalendar|importTimetable|reviewEducationTask|readFile|loadJson/);
});

test("task-session binding boundary remains enforced", async () => {
  const server = await readFile(new URL("../lib/edupi-education-server.ts", import.meta.url), "utf8");
  assert.match(server, /task\.externalSend/);
  assert.match(server, /task\.scope !== "teacher_internal"/);
  assert.match(server, /ensureSessionPersisted/);
  assert.match(server, /parentSessionId/);
  assert.match(server, /bindTaskSessionFile/);
});

test("review route does not expose a generic extension executor", async () => {
  const route = await readFile(new URL("../app/api/edupi/education/route.ts", import.meta.url), "utf8");
  assert.doesNotMatch(route, /executeExtension|shell|child_process|toolName/);
});

console.log(JSON.stringify({ status: "passed", contract: "core-v1.1-education-workspace", reviewActions: sample.capabilities.taskReview.actions, calendarFacts: sample.calendar.length, teacherTasks: sample.tasks.length }, null, 2));
