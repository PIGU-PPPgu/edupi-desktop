import assert from "node:assert/strict";
import test from "node:test";
import { createJiti } from "jiti";

const roster = await createJiti(import.meta.url).import("./edupi-student-roster-model.ts");

test("parses a teacher CSV roster with optional profile fields", () => {
  assert.deepEqual(roster.parseStudentRosterCsv("姓名,性格特征,家长备注\n李四,认真、沉稳,及时沟通\n\"欧阳锋\",活跃,\"关注作息；鼓励阅读\"\n"), [
    { name: "李四", traits: ["认真", "沉稳"], parentNotes: ["及时沟通"] },
    { name: "欧阳锋", traits: ["活跃"], parentNotes: ["关注作息", "鼓励阅读"] },
  ]);
});

test("rejects duplicate names before reaching Core", () => {
  assert.throws(() => roster.parseStudentRosterCsv("姓名\n李四\n李四\n"), (error) => error.code === "duplicate_name");
});

test("uses stable teacher-facing keys for student selection", () => {
  assert.equal(roster.studentRecordKey({ student_id: "student-1", name: "李四" }), "李四");
  assert.equal(roster.studentRecordName({ display_name: "王五" }), "王五");
});

test("rejects rosters that cannot fit in the bounded Core request", () => {
  const value = "甲".repeat(220);
  const csv = `姓名,特征,家长备注\n${Array.from({ length: 500 }, (_, index) => `学生${index},${value},${value}`).join("\n")}\n`;
  assert.throws(() => roster.parseStudentRosterCsv(csv), (error) => error.code === "too_large");
});
