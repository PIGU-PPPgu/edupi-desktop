import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { createJiti } from "jiti";

assert.ok(process.env.EDUPI_CORE_ROOT, "EDUPI_CORE_ROOT must point to the paired Core");
const root = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), "edupi-classroom-e2-")));
const memory = path.join(root, ".edupi", "memory");
fs.mkdirSync(path.join(root, "desktop-state"), { mode: 0o700 });
for (const name of ["memory", "output", "locks"]) fs.mkdirSync(path.join(root, ".edupi", name), { recursive: true });
Object.assign(process.env, { EDUPI_DATA_ROOT: root, EDUPI_DATA_ALLOWED_ROOT: path.dirname(root), EDUPI_PROJECT_ROOT: root,
  EDUPI_CORE_ALLOWED_ROOT: path.dirname(process.env.EDUPI_CORE_ROOT), PI_DESKTOP_STATE_DIR: path.join(root, "desktop-state") });
const students = Object.fromEntries(["甲", "乙", "丙", "丁", "戊", "己"].map((name, index) => [`test-${index}`, {
  student_id: `test-${index}`, name: `验收${name}`, class_name: "隔离验收班", traits: [index % 2 ? "女生" : "男生"],
  error_patterns: [], trajectory: [], parent_notes: [], created_at: "2026-11-13T00:00:00Z", updated_at: "2026-11-13T00:00:00Z",
}]));
fs.writeFileSync(path.join(memory, "student_profiles.json"), JSON.stringify({ students }));
const jiti = createJiti(import.meta.url, { tsconfigPaths: true });
const { classroomService } = await jiti.import("../lib/edupi-classroom-server.ts");
const { createEduPiClassroomTool } = await jiti.import("../lib/edupi-classroom-tool.ts");
const { closeAllEduPiRuntimes } = await jiti.import("../lib/edupi-runtime-supervisor.ts");
const evidence = { data_root: root, core_root: process.env.EDUPI_CORE_ROOT, model_calls: 0, external_send: false, checks: [] };
const check = name => evidence.checks.push(name);
try {
  const roster = await classroomService({ domain: "grades", action: "roster" });
  assert.equal(roster.students.length, 6);
  const grade = { title: "隔离期中", class_name: "隔离验收班", date: "2026-11-13", subjects: [{ name: "数学", max_score: 100 }],
    rows: Object.values(students).map((s, index) => ({ row_id: `r${index}`, name: s.name, scores: { 数学: 45 + index * 10 } })) };
  const first = await classroomService({ domain: "grades", action: "save", id: "classroom-e2-grade", expected_revision: 0, input: grade });
  assert.equal(first.record.result.subjects[0].mean, 70);
  const tool = createEduPiClassroomTool({ projectRoot: root });
  const read = await tool.execute("call-read", { domain: "grades", action: "read", id: first.record.id }, undefined, undefined, { cwd: root });
  assert.equal(read.details.result.record.id, first.record.id);
  assert.equal(read.details.result.record.result.subjects[0].mean, 70);
  check("UI service writes are read by the actual AI tool through Core");
  const second = await classroomService({ domain: "grades", action: "save", id: "classroom-e2-grade2", expected_revision: 0,
    input: { ...grade, title: "隔离期末", baseline_id: first.record.id, rows: grade.rows.map(row => ({ ...row, scores: { 数学: row.scores.数学 + 5 } })) } });
  assert.equal(second.record.result.comparison.students.length, 6);
  assert.equal(second.record.result.comparison.students[0].delta, 5);
  const revised = await classroomService({ domain: "grades", action: "save", id: first.record.id, expected_revision: 1, input: { ...grade, title: "隔离期中修订" } });
  assert.equal(revised.record.revision, 2);
  const restored = await classroomService({ domain: "grades", action: "restore", id: first.record.id, expected_revision: 2, revision: 1 });
  assert.equal(restored.record.revision, 3);
  assert.equal(restored.record.input.title, grade.title);
  await assert.rejects(classroomService({ domain: "grades", action: "save", id: first.record.id, expected_revision: 1, input: grade }), /修改/u);
  check("grades: calculate, compare, revise, restore and stale-write rejection");
  const concurrent = await Promise.allSettled(["并发甲", "并发乙"].map(title => classroomService({
    domain: "grades", action: "save", id: first.record.id, expected_revision: 3, input: { ...grade, title },
  })));
  assert.equal(concurrent.filter(result => result.status === "fulfilled").length, 1);
  assert.equal((await classroomService({ domain: "grades", action: "read", id: first.record.id })).record.revision, 4);
  check("competing process writers cannot overwrite the same revision");
  const seating = { title: "隔离排座", class_name: grade.class_name, mode: "seating", rows: 2, columns: 3, group_size: 3,
    student_ids: Object.keys(students), features: {}, constraints: { gender_strategy: "mixed", avoid_pairs: [], fixed_seats: [] }, exam_id: first.record.id };
  const seat1 = await classroomService({ domain: "seating", action: "save", id: "classroom-e2-seat", expected_revision: 0, input: seating });
  const assignments = seat1.record.result.assignments;
  const [a, b] = assignments;
  const changed = assignments.map(row => row === a ? { ...row, row: b.row, column: b.column, group: b.group } : row === b ? { ...row, row: a.row, column: a.column, group: a.group } : row);
  const seat2 = await classroomService({ domain: "seating", action: "save", id: seat1.record.id, expected_revision: 1, input: { ...seating, assignments: changed } });
  assert.equal(seat2.record.revision, 2);
  assert.deepEqual(seat2.record.result.assignments.map(row => row.student_id).sort(), Object.keys(students).sort());
  const groups = await classroomService({ domain: "seating", action: "save", id: "classroom-e2-groups", expected_revision: 0, input: { ...seating, mode: "groups" } });
  assert.equal(groups.record.result.groups.length, 2);
  check("seating and groups: complete roster, swap, save and independent process readback");
  const duty = { title: "隔离值日", class_name: grade.class_name, start_date: "2026-11-16", days: 5, weekdays: [1, 2, 3, 4, 5],
    student_ids: Object.keys(students), exempt_ids: ["test-5"], posts: [{ id: "floor", name: "扫地", count: 1, weight: 2, gender: "any" }],
    max_per_day: 1, max_days_per_week: 5 };
  const duty1 = await classroomService({ domain: "duty", action: "save", id: "classroom-e2-duty", expected_revision: 0, input: duty });
  assert.equal(duty1.record.result.assignments.some(row => row.student_ids.includes("test-5")), false);
  const prior = duty1.record.result.assignments[0];
  const substitute = Object.keys(students).find(id => id !== prior.student_ids[0] && id !== "test-5");
  const duty2 = await classroomService({ domain: "duty", action: "save", id: duty1.record.id, expected_revision: 1,
    input: { ...duty, substitutions: [{ date: prior.date, post_id: prior.post_id, from_id: prior.student_ids[0], to_id: substitute }] } });
  assert.equal(duty2.record.result.assignments[0].student_ids[0], substitute);
  const { resolveEduPiBridgeRoots } = await jiti.import("../lib/edupi-core-snapshot.ts");
  const { runCoreProcess } = await jiti.import("../lib/edupi-core-process-client.ts");
  const reservation = await runCoreProcess({ ...resolveEduPiBridgeRoots(), timeoutMs: 15000, request: {
    protocol: "edupi-desktop-bridge", protocol_version: 1, producer: "edupi-desktop", request_id: "interrupted-publish",
    operation: "classroom", domain: "duty", action: "begin_publish", id: duty1.record.id, expected_revision: 2,
  } });
  assert.equal(reservation.record.publication.state, "pending");
  const published = await classroomService({ domain: "duty", action: "publish", id: duty1.record.id, expected_revision: 2 });
  assert.equal(published.record.task_id, `duty-${duty1.record.id}`);
  const again = await classroomService({ domain: "duty", action: "publish", id: duty1.record.id, expected_revision: published.record.revision });
  assert.equal(again.record.task_id, published.record.task_id);
  const duty3 = await classroomService({ domain: "duty", action: "save", id: duty1.record.id, expected_revision: published.record.revision, input: duty });
  assert.equal(duty3.record.task_id, published.record.task_id);
  const dutyRestored = await classroomService({ domain: "duty", action: "restore", id: duty1.record.id,
    expected_revision: duty3.record.revision, revision: duty2.record.revision });
  assert.equal(dutyRestored.record.task_id, published.record.task_id);
  assert.equal(dutyRestored.record.result.assignments[0].student_ids[0], substitute);
  const { readEduPiEducationSnapshot } = await jiti.import("../lib/edupi-core-snapshot.ts");
  const tasks = (await readEduPiEducationSnapshot()).payload.education_workspace.tasks.filter(task => task.task_id === published.record.task_id);
  assert.equal(tasks.length, 1);
  check("duty: exemption, substitution, revised workload, single task, retry, linked adjustment and history restore");
  check("interrupted publication resumes from a persisted Core reservation");
  evidence.ok = true;
} catch (error) {
  evidence.ok = false; evidence.error = error.stack; evidence.code = error.code ?? null; process.exitCode = 1;
} finally {
  await closeAllEduPiRuntimes();
  const output = process.env.EDUPI_CLASSROOM_EVIDENCE;
  if (output) fs.writeFileSync(output, JSON.stringify(evidence, null, 2) + "\n");
  console.log(JSON.stringify(evidence, null, 2));
  fs.rmSync(root, { recursive: true, force: true });
}
