import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const read = (path) => readFile(new URL(path, import.meta.url), "utf8");

test("revision actions replace the composer with a prompt that ends in a teacher input slot", async () => {
  const [memory, materials, students, studentProfilePrompt, panel] = await Promise.all([
    read("./EduPiMemoryDatabase.tsx"),
    read("./EduPiMaterialsWorkspace.tsx"),
    read("./EduPiStudentWorkspace.tsx"),
    read("../lib/edupi-student-profile-prompt.ts"),
    read("./EduPiEducationPanel.tsx"),
  ]);
  for (const source of [memory, materials, students]) assert.match(source, /appendTeacherInputSlot/);
  assert.match(memory, /我希望改成（在这里输入或口述）：/);
  assert.match(materials, /我要补充或修改的信息（在这里输入或口述）：/);
  assert.match(students, /我希望改成（在这里输入或口述）：/);
  assert.match(studentProfilePrompt, /我要新增、修改或删除的内容（在这里输入或口述）：/);
  assert.match(panel, /我要让 EduPi 处理的内容（在这里输入或口述）：/);
  assert.match(panel, /appendTeacherInputSlot/);
  assert.match(memory, /onStartAgent\(prompt, "replace"\)/);
  assert.match(materials, /onStartAgent\(prompt, "replace"\)/);
  assert.match(students, /onStartAgent\(prompt, "replace"\)/);
});
