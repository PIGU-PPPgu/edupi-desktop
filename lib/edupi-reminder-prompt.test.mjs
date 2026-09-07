import assert from "node:assert/strict";
import test from "node:test";
import { createJiti } from "jiti";
const { reminderPrompt } = await createJiti(import.meta.url).import("./edupi-reminder-prompt.ts");
test("reminder prompt uses actual task fields and leaves an input slot", () => {
  const text = reminderPrompt({ title: "第一课备课", dueDate: "2026-09-08", sourceEventName: "数学课", topic: "几何体", student: null, deliverables: ["教案", "学案"] });
  assert.match(text, /日期：2026-09-08/);
  assert.match(text, /所需材料：教案、学案/);
  assert.match(text, /我想补充：\n$/);
  assert.doesNotMatch(text, /undefined|null|相关学生/);
});
