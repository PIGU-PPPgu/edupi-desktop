import type { CalendarFact, EducationContract } from "./edupi-education-contract";
import { taskArtifacts, taskDisplayTitle, taskKey } from "./edupi-workbench";

export type EduPiQuickEntryKind = "chat" | "task" | "artifact" | "calendar";

export type EduPiQuickEntryItem = {
  id: string;
  kind: EduPiQuickEntryKind;
  title: string;
  subtitle: string;
  targetKey: string;
};

export function calendarQuickEntryKey(event: CalendarFact, index: number): string {
  return event.id || `${event.date || "undated"}:${event.name}:${index}`;
}

export function calendarQuickEntryStatusLabel(event: CalendarFact): "已确认" | "待确认" {
  if (event.confidence === "inferred" || event.preparationStatus === "hold") return "待确认";
  return event.preparationStatus === "read_only" || event.confidence === "confirmed" || event.confidence === "teacher_confirmed"
    ? "已确认"
    : "待确认";
}

function normalized(value: string): string {
  return value.trim().toLocaleLowerCase().replace(/\s+/g, " ");
}

function matchRank(item: EduPiQuickEntryItem, query: string): number | null {
  if (!query) return 0;
  const title = normalized(item.title);
  const subtitle = normalized(item.subtitle);
  if (title.startsWith(query)) return 0;
  if (title.includes(query)) return 1;
  if (subtitle.startsWith(query)) return 2;
  if (subtitle.includes(query)) return 3;
  return null;
}

const KIND_PRIORITY: Record<EduPiQuickEntryKind, number> = { chat: 0, task: 1, artifact: 2, calendar: 3 };

export function buildEduPiQuickEntryItems(
  education: EducationContract,
  query = "",
  limit = 12,
): EduPiQuickEntryItem[] {
  const items: EduPiQuickEntryItem[] = [{ id: "chat", kind: "chat", title: "AI 协作", subtitle: "打开 Chat", targetKey: "chat" }];
  for (const task of education.tasks) {
    const key = taskKey(task);
    items.push({ id: `task:${key}`, kind: "task", title: taskDisplayTitle(task), subtitle: task.dueDate || "日期待确认", targetKey: key });
    for (const artifact of taskArtifacts(task)) {
      items.push({ id: `artifact:${artifact.id}`, kind: "artifact", title: artifact.title, subtitle: taskDisplayTitle(task), targetKey: key });
    }
  }
  education.calendar.forEach((event, index) => {
    const key = calendarQuickEntryKey(event, index);
    items.push({ id: `calendar:${key}`, kind: "calendar", title: event.name, subtitle: event.date || "日期待确认", targetKey: key });
  });
  const normalizedQuery = normalized(query);
  return items.flatMap((item) => {
    const rank = matchRank(item, normalizedQuery);
    return rank === null ? [] : [{ item, rank }];
  }).sort((left, right) => left.rank - right.rank
    || KIND_PRIORITY[left.item.kind] - KIND_PRIORITY[right.item.kind]
    || left.item.title.localeCompare(right.item.title)
    || left.item.id.localeCompare(right.item.id))
    .slice(0, Math.max(1, Math.min(limit, 50)))
    .map(({ item }) => item);
}
