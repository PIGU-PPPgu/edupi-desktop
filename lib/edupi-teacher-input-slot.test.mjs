import assert from "node:assert/strict";
import test from "node:test";
import { createJiti } from "jiti";

const jiti = createJiti(import.meta.url, { tsconfigPaths: true });
const { appendTeacherInputSlot } = await jiti.import("./edupi-teacher-input-slot.ts");

test("puts one task-specific teacher input slot at the absolute end of an AI draft", () => {
  assert.equal(
    appendTeacherInputSlot("当前内容：称呼我为吴老师\n", "我希望改成（在这里输入或口述）："),
    "当前内容：称呼我为吴老师\n如果这一栏留空，请只问我一个澄清问题。\n\n我希望改成（在这里输入或口述）：\n",
  );
});

test("rejects an empty reference or input label", () => {
  assert.throws(() => appendTeacherInputSlot("", "修改要求："));
  assert.throws(() => appendTeacherInputSlot("当前内容", ""));
});
