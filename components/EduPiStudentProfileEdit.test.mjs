import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const read = (path) => readFile(new URL(path, import.meta.url), "utf8");

test("student profiles use a full content page instead of a narrow modal drawer", async () => {
  const [student, css] = await Promise.all([read("./EduPiStudentWorkspace.tsx"), read("../app/edupi-student-dossier.css")]);
  assert.match(student, /className="edupi-student-dossier"/);
  assert.match(student, /返回班级/);
  assert.doesNotMatch(student, /role="dialog"|aria-modal="true"|has-student-drawer/);
  assert.match(css, /\.edupi-student-dossier\s*\{[^}]*width:\s*100%/s);
  assert.match(css, /\.edupi-student-dossier\s*\{[^}]*grid-template-columns:\s*minmax\(0, 1fr\)/s);
  assert.match(css, /@container \(max-width: 720px\)/);
});

test("student profiles expose real manual replacement and global AI collaboration", async () => {
  const student = await read("./EduPiStudentWorkspace.tsx");
  assert.match(student, /icon="edit" label="手动修改"/);
  assert.match(student, /onClick=\{openStudentAgent\}>AI 协作/);
  assert.match(student, /buildStudentProfileConversationPrompt/);
  assert.match(student, /onStartAgent\(prompt, "replace"\)/);
  assert.match(student, /method: "PUT"/);
  assert.match(student, /expectedUpdatedAt/);
  assert.match(student, /expectedRevision/);
  assert.match(student, /parseStudentProfileList/);
  assert.match(student, /保存修改/);
  assert.doesNotMatch(student, /补充学生档案/);
});

test("student profile history explains and performs full snapshot restore", async () => {
  const [student, css] = await Promise.all([read("./EduPiStudentWorkspace.tsx"), read("../app/edupi-workbench.css")]);
  assert.match(student, /档案历史/);
  assert.match(student, /恢复会同时替换班级、学生特征和家校备注/);
  assert.match(student, /side === "before" \? "修改前" : "修改后"/);
  assert.match(student, /`恢复\$\{sideLabel\}`/);
  assert.match(student, /profile_history_count/);
  assert.match(student, /profile_revision/);
  assert.match(student, /\/versions/);
  assert.match(student, /method: "POST"/);
  assert.match(css, /\.edupi-student-profile-history__sides/);
});
