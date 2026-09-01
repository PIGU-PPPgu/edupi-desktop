import { appendTeacherInputSlot } from "./edupi-teacher-input-slot";

type TeachingPriorityPromptInput = {
  subject: string | null;
  grade: string | null;
  currentTopics: string[];
};

export function buildTeachingPriorityConversationPrompt(input: TeachingPriorityPromptInput): string {
  const context = [input.subject?.trim(), input.grade?.trim()].filter(Boolean).join(" · ") || "教学上下文待补充";
  const topics = Array.from(new Set(input.currentTopics.map((topic) => topic.trim()).filter(Boolean))).slice(0, 5);
  return appendTeacherInputSlot([
    "我想通过对话补充最近的教学重点。",
    `当前教学：${context}`,
    topics.length > 0 ? `已有重点：${topics.join("、")}` : null,
    "请根据我填写的内容整理教学重点候选，包含主题、依据、关注对象、下一步；不要直接写入，等我确认后再进入导入流程。",
  ].filter(Boolean).join("\n"), "我最近要补充的教学重点（在这里输入或口述）：");
}
