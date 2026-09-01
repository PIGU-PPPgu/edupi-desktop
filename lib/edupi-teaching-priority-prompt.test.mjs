import assert from "node:assert/strict";
import test from "node:test";
import { createJiti } from "jiti";

const jiti = createJiti(import.meta.url, { tsconfigPaths: true });
const { buildTeachingPriorityConversationPrompt } = await jiti.import("./edupi-teaching-priority-prompt.ts");

test("builds a confirmation-first teaching-priority conversation from current context", () => {
  const prompt = buildTeachingPriorityConversationPrompt({
    subject: "数学",
    grade: "七年级",
    currentTopics: ["有理数", "整式", "有理数", "一元一次方程"],
  });

  assert.match(prompt, /数学 · 七年级/);
  assert.match(prompt, /已有重点：有理数、整式、一元一次方程/);
  assert.match(prompt, /如果这一栏留空，请只问我一个澄清问题/);
  assert.match(prompt, /输入或口述/);
  assert.match(prompt, /主题、依据、关注对象、下一步/);
  assert.match(prompt, /不要直接写入/);
  assert.ok(prompt.endsWith("我最近要补充的教学重点（在这里输入或口述）：\n"));
});

test("keeps the dialogue useful before teaching context exists", () => {
  const prompt = buildTeachingPriorityConversationPrompt({ subject: null, grade: null, currentTopics: [] });
  assert.match(prompt, /教学上下文待补充/);
  assert.doesNotMatch(prompt, /已有重点：/);
  assert.ok(prompt.endsWith("我最近要补充的教学重点（在这里输入或口述）：\n"));
});
