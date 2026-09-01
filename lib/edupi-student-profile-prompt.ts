import { appendTeacherInputSlot } from "./edupi-teacher-input-slot";

type StudentProfilePromptInput = {
  name: string;
  traits: string[];
  parentNotes: string[];
  patternCount: number;
  trajectoryCount: number;
};

export function buildStudentProfileConversationPrompt(input: StudentProfilePromptInput): string {
  return appendTeacherInputSlot([
    `请协助我审阅并修订${input.name}的学生档案。`,
    `当前特征：${input.traits.join("、") || "暂无"}`,
    `当前家校备注：${input.parentNotes.join("、") || "暂无"}`,
    `系统记录：${input.patternCount} 条学习模式 · ${input.trajectoryCount} 个成长节点。`,
    "请根据我填写的要求整理成可直接核对的特征和家校备注候选；不要直接写入，等我确认后再保存。",
  ].join("\n"), "我要新增、修改或删除的内容（在这里输入或口述）：");
}
