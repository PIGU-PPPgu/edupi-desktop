export const RECOGNIZED_TIMETABLE_NOTE_PREFIX = "材料识别待确认：";
const MAX_TIMETABLE_NOTE_CHARS = 1000;

export function markRecognizedTimetableNote(value: unknown): string {
  const note = typeof value === "string" ? value.trim() : "";
  return `${RECOGNIZED_TIMETABLE_NOTE_PREFIX}${note}`.slice(0, MAX_TIMETABLE_NOTE_CHARS);
}

export function isRecognizedTimetableNote(value: unknown): boolean {
  return typeof value === "string" && value.startsWith(RECOGNIZED_TIMETABLE_NOTE_PREFIX);
}

export function visibleTimetableNote(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const visible = isRecognizedTimetableNote(value) ? value.slice(RECOGNIZED_TIMETABLE_NOTE_PREFIX.length) : value;
  return visible.trim() || null;
}
