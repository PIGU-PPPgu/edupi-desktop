type TeachingPriorityPromptInput = {
  subject: string | null;
  grade: string | null;
  currentTopics: string[];
};

export function buildTeachingPriorityConversationPrompt(input: TeachingPriorityPromptInput): string {
  const context = [input.subject?.trim(), input.grade?.trim()].filter(Boolean).join(" · ") || "教学上下文待补充";
  const topics = Array.from(new Set(input.currentTopics.map((topic) => topic.trim()).filter(Boolean))).slice(0, 5);
  return [
    "我想通过对话补充最近的教学重点。",
    `当前教学：${context}`,
    topics.length > 0 ? `已有重点：${topics.join("、")}` : null,
    "请先问我一个问题，让我用文字或口述说明最近值得关注的知识点、共性错误、学生情况和推进安排。",
    "根据我的回答整理教学重点候选，包含主题、依据、关注对象、下一步；不要直接写入，等我确认后再进入导入流程。",
  ].filter(Boolean).join("\n");
}
