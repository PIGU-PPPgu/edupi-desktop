import assert from "node:assert/strict";
import test from "node:test";
import { createJiti } from "jiti";

const jiti = createJiti(import.meta.url);
const { buildClassDossier, dossierDate, dossierDateLabel, UNASSIGNED_CLASS_FILTER } = await jiti.import("./edupi-class-dossier.ts");

const roster = () => [
  { student_id: "synthetic-a", name: "合成同名", class_name: "703", traits: ["愿意协作", "愿意协作"], trajectory: [{ event: "合成进步甲", date: "2026-10-05", source_name: "合成课堂记录" }], error_patterns: [{ description: "合成关注甲", status: "observing", last_seen: "2026-10-06" }] },
  { student_id: "synthetic-b", name: "合成同名", class_name: "704", traits: ["愿意协作"], trajectory: [{ event: "合成进步乙", date: "2026-10-08" }], error_patterns: [{ description: "合成已解决", status: "resolved" }] },
  { student_id: "synthetic-c", name: "合成未分班", traits: [], trajectory: [], error_patterns: [] },
];

test("class scope uses explicit membership and never assigns unknown students from teacher context", () => {
  const students = roster();
  const result = buildClassDossier(students, "703", ["703", "705"]);
  assert.deepEqual(result.classes, ["703", "704", "705"]);
  assert.deepEqual(result.students, [students[0]]);
  assert.equal(result.unassignedCount, 1);
  assert.equal(result.recordedStudents, 1);
  assert.equal(result.growth.length, 1);
  assert.equal(result.concerns.length, 1);
  assert.equal(result.growth[0].source, "合成课堂记录");
  assert.deepEqual(buildClassDossier(students, UNASSIGNED_CLASS_FILTER).students, [students[2]]);
  assert.equal(buildClassDossier(students, "705", ["705"]).students.length, 0);
});

test("namesakes keep their own record identity and resolved concerns are excluded", () => {
  const students = roster();
  const result = buildClassDossier(students, "");
  assert.equal(result.growth[0].student, students[1]);
  assert.equal(result.growth[1].student, students[0]);
  assert.notEqual(result.growth[0].key, result.growth[1].key);
  assert.equal(result.concerns.length, 1);
  assert.equal(result.concerns[0].student, students[0]);
  assert.deepEqual(result.traits, [{ text: "愿意协作", count: 2 }]);
});

test("invalid calendar dates remain undated and do not outrank valid growth dates", () => {
  const students = [{ student_id: "synthetic-a", name: "合成学生", trajectory: [{ event: "无效日期", date: "2026-02-30" }, { event: "最新", date: "2026-10-09" }, { event: "未填日期" }, { event: "较早", date: "2026-09-01" }], updated_at: "not-a-date" }];
  const result = buildClassDossier(students, "");
  assert.deepEqual(result.growth.map((row) => row.title), ["最新", "较早", "无效日期", "未填日期"]);
  assert.equal(result.growth[2].date, null);
  assert.equal(result.updatedAt, null);
  assert.equal(dossierDate("2026-02-30"), null);
  assert.equal(dossierDate("2026-01-01Tbad"), null);
  assert.equal(dossierDateLabel("2026-10-09T12:00:00+08:00"), "2026.10.09");
  assert.equal(dossierDateLabel(undefined), "日期未记录");
});

test("sparse projections preserve roster counts without fabricating profile content", () => {
  const students = [{ name: "合成空档案", traits: [null, 8], trajectory: [null, {}, 3], error_patterns: [null, {}] }, { name: "合成备注", parent_notes: ["合成教师备注"], updated_at: "2026-10-11" }];
  const result = buildClassDossier(students, "");
  assert.equal(result.students.length, 2);
  assert.equal(result.unassignedCount, 2);
  assert.equal(result.recordedStudents, 1);
  assert.deepEqual(result.growth, []);
  assert.deepEqual(result.concerns, []);
  assert.deepEqual(result.traits, []);
  assert.equal(result.updatedAt, "2026-10-11");
  assert.equal(buildClassDossier([], "").recordedStudents, 0);
});
