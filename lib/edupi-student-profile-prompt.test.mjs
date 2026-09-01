import assert from "node:assert/strict";
import test from "node:test";
import { createJiti } from "jiti";

const jiti = createJiti(import.meta.url, { tsconfigPaths: true });
const { buildStudentProfileConversationPrompt } = await jiti.import("./edupi-student-profile-prompt.ts");

test("builds a confirmation-first student-profile collaboration prompt", () => {
  const prompt = buildStudentProfileConversationPrompt({ name: "李四", traits: ["耐心"], parentNotes: ["本周已沟通"], patternCount: 2, trajectoryCount: 1 });
  assert.match(prompt, /李四/);
  assert.match(prompt, /耐心/);
  assert.match(prompt, /本周已沟通/);
  assert.match(prompt, /2 条学习模式 · 1 个成长节点/);
  assert.match(prompt, /先问我一个问题/);
  assert.match(prompt, /不要直接写入/);
});
