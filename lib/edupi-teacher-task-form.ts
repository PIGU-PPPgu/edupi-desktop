export const MAX_PREPARATION_MATERIALS = 20;
export const MAX_PREPARATION_DELIVERABLES = 20;
export const MAX_PREPARATION_DELIVERABLE_LENGTH = 240;

export type TeacherRecurringMaterialsInput = {
  kind: "teacher_internal_materials";
  cadence: "weekly" | "monthly";
  untilDate: string;
  leadDays: number;
  deliverables: string[];
};

function validDate(value: unknown): value is string {
  if (typeof value !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const date = new Date(`${value}T00:00:00.000Z`);
  return !Number.isNaN(date.valueOf()) && date.toISOString().slice(0, 10) === value;
}

export function parseTeacherRecurringMaterials(value: unknown, dueDate: string | null, hasPreparation: boolean):
  { value: TeacherRecurringMaterialsInput | null; error: string | null } {
  if (value === undefined || value === null) return { value: null, error: null };
  if (!value || typeof value !== "object" || Array.isArray(value) || hasPreparation || !validDate(dueDate)) {
    return { value: null, error: "周期任务需要有效的首期日期，且不能同时选择课前准备。" };
  }
  const source = value as Record<string, unknown>;
  const keys = ["kind", "cadence", "untilDate", "leadDays", "deliverables"];
  const cadence = source.cadence;
  const leadDays = source.leadDays;
  const deliverables = source.deliverables;
  const latestUntil = new Date(Date.parse(`${dueDate}T00:00:00.000Z`) + 366 * 86_400_000).toISOString().slice(0, 10);
  if (Object.keys(source).length !== keys.length || Object.keys(source).some(key => !keys.includes(key))
    || source.kind !== "teacher_internal_materials" || (cadence !== "weekly" && cadence !== "monthly")
    || !validDate(source.untilDate) || source.untilDate < dueDate! || source.untilDate > latestUntil
    || cadence === "monthly" && Number(dueDate!.slice(8)) > 28
    || !Number.isInteger(leadDays) || (leadDays as number) < 0 || (leadDays as number) > (cadence === "weekly" ? 6 : 7)
    || !Array.isArray(deliverables) || deliverables.length < 1 || deliverables.length > 20
    || deliverables.some(item => typeof item !== "string" || !item.trim() || item.length > 240)
    || new Set(deliverables.map(item => item.trim())).size !== deliverables.length) {
    return { value: null, error: "周期、结束日期、提前天数或产物无效。" };
  }
  return { value: { kind: "teacher_internal_materials", cadence, untilDate: source.untilDate,
    leadDays: leadDays as number, deliverables: deliverables.map(item => item.trim()) }, error: null };
}

function rawText(value: unknown): string {
  return typeof value === "string" ? value.trim() : "";
}

export function timetableSlotId(slot: Record<string, unknown>): string {
  return rawText(slot.slot_id ?? slot.id);
}

export function timetableDayOfWeek(slot: Record<string, unknown> | null): number | null {
  const value = Number(slot?.day_of_week ?? slot?.dayOfWeek);
  return Number.isInteger(value) && value >= 1 && value <= 7 ? value : null;
}

export function dateDayOfWeek(value: string): number | null {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return null;
  const date = new Date(`${value}T12:00:00.000Z`);
  if (Number.isNaN(date.valueOf()) || date.toISOString().slice(0, 10) !== value) return null;
  return date.getUTCDay() || 7;
}

export function lessonDateMatchesSlot(value: string, slot: Record<string, unknown> | null): boolean {
  const lessonDay = dateDayOfWeek(value);
  const slotDay = timetableDayOfWeek(slot);
  return lessonDay !== null && slotDay !== null && lessonDay === slotDay;
}

export function dateBefore(value: string): string {
  const date = new Date(`${value}T12:00:00.000Z`);
  if (Number.isNaN(date.valueOf())) return "";
  date.setUTCDate(date.getUTCDate() - 1);
  return date.toISOString().slice(0, 10);
}

export function preparationDeliverables(value: string): { items: string[]; error: string | null } {
  const items = value.split("\n").map((item) => item.trim()).filter(Boolean);
  if (items.length > MAX_PREPARATION_DELIVERABLES) return { items, error: `产物最多 ${MAX_PREPARATION_DELIVERABLES} 项。` };
  if (items.some((item) => item.length > MAX_PREPARATION_DELIVERABLE_LENGTH)) return { items, error: `每项产物最多 ${MAX_PREPARATION_DELIVERABLE_LENGTH} 个字。` };
  if (new Set(items).size !== items.length) return { items, error: "产物名称不能重复。" };
  return { items, error: null };
}
