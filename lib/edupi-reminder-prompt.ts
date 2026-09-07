import type { TeacherTask } from "./edupi-education-contract";

export function reminderPrompt(task: TeacherTask): string {
  return [
    `关于${task.title}：`,
    task.dueDate ? `日期：${task.dueDate}` : "",
    task.sourceEventName ? `来源事项：${task.sourceEventName}` : "",
    task.topic ? `教学重点：${task.topic}` : "",
    task.student ? `相关学生：${task.student}` : "",
    task.deliverables.length ? `所需材料：${task.deliverables.join("、")}` : "",
    "",
    "我想补充：",
    "",
  ].filter((line, index, all) => line || index >= all.length - 3).join("\n");
}
