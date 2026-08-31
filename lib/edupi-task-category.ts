export type TaskCategoryId = "teaching" | "student" | "calendar" | "material" | "activity" | "other";

export const TASK_CATEGORY_CONFIG: ReadonlyArray<{ id: TaskCategoryId; label: string }> = [
  { id: "teaching", label: "教学准备" },
  { id: "student", label: "学生跟进" },
  { id: "calendar", label: "校历节点" },
  { id: "material", label: "材料证据" },
  { id: "activity", label: "活动安排" },
  { id: "other", label: "其他" },
];

type TaskCategoryInput = {
  trigger?: string | null;
  student?: string | null;
  materialId?: string | null;
  materialKind?: string | null;
  topic?: string | null;
};

export function taskCategory(task: TaskCategoryInput): TaskCategoryId {
  if (task.trigger === "student_follow_up" || task.student) return "student";
  if (task.trigger === "teaching_adjustment_candidate" || task.topic) return "teaching";
  if (task.trigger === "calendar_event_internal") return "calendar";
  if (task.trigger === "festival") return "activity";
  if (task.materialId || task.materialKind) return "material";
  return "other";
}

export function groupTasksByCategory<T extends TaskCategoryInput>(tasks: readonly T[]): Record<TaskCategoryId, T[]> {
  const groups: Record<TaskCategoryId, T[]> = {
    teaching: [],
    student: [],
    calendar: [],
    material: [],
    activity: [],
    other: [],
  };
  for (const task of tasks) groups[taskCategory(task)].push(task);
  return groups;
}
