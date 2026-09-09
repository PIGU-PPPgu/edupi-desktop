import assert from "node:assert/strict";
import test from "node:test";
import { createJiti } from "jiti";
const { studentDirectoryPage } = await createJiti(import.meta.url).import("./edupi-student-pagination.ts");

test("large roster pages retain sorted original students and stable IDs", () => {
  const students = Array.from({ length: 61 }, (_, index) => ({ student_id: `student-${index}`, name: `学生${String(60 - index).padStart(2, "0")}`, class_name: index % 2 ? "703" : "704" }));
  const pages = [0, 1, 2].map(page => studentDirectoryPage(students, "", "", page));
  assert.deepEqual(pages.map(page => page.rows.length), [24, 24, 13]);
  const rows = pages.flatMap(page => page.rows);
  assert.equal(new Set(rows.map(row => row.key)).size, 61);
  assert.deepEqual(rows.map(row => row.student.name), [...students].sort((a, b) => a.name.localeCompare(b.name, "zh-CN")).map(student => student.name));
  assert.ok(rows.every(row => students.find(student => student.student_id === row.key) === row.student));
  assert.equal(studentDirectoryPage(students, "703", "", 0).filtered.length, 30);
  assert.equal(studentDirectoryPage(students, "703", "学生01", 0).rows[0].student.class_name, "703");
  const clamped = studentDirectoryPage(students.slice(0, 4), "", "", 2);
  assert.equal(clamped.page, 0);
  assert.equal(clamped.rows.length, 4);
  assert.equal(studentDirectoryPage(students, "missing", "", 2).rows.length, 0);
});

test("same names use student IDs, while fallback identity retains original index", () => {
  const students = [{ student_id: "a", name: "同名", class_name: "703" }, { student_id: "b", name: "同名", class_name: "704" }, { class_name: "704" }];
  assert.deepEqual(studentDirectoryPage(students, "704", "", 0).rows.map(row => row.key).sort(), ["b", "student-2"]);
  assert.equal(studentDirectoryPage(students, "", "同名", 0).rows.length, 2);
});
