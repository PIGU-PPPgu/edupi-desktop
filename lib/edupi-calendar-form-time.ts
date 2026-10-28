import { Temporal } from "temporal-polyfill";
import type { CalendarFact } from "./edupi-education-contract";
import type { CalendarIntakeInput } from "./edupi-education-intake";

type SavedTime = Pick<CalendarFact, "date" | "endDate" | "startsAt" | "endsAt" | "timeZone">;
export type CalendarTimeDraft = { allDay: boolean; startTime: string; endTime: string; timeZone: string };
type FormTime = CalendarTimeDraft & { date: string; endDate: string | null };

export class CalendarFormTimeError extends Error {}

function clock(value: string | null | undefined): string {
  return value?.match(/^\d{4}-\d{2}-\d{2}T(\d{2}:\d{2})/)?.[1] || "";
}

export function calendarTimeLabel(value: string | null | undefined, referenceDate: string | null | undefined): string | null {
  if (!value) return null;
  const localDate = value.match(/^(\d{4}-\d{2}-\d{2})T\d{2}:\d{2}(?:[+-]\d{2}:\d{2}|Z)$/)?.[1];
  if (!localDate) return value;
  return localDate === referenceDate ? clock(value) : `${localDate} ${clock(value)}`;
}

export function createCalendarTimeDraft(saved?: SavedTime | null, defaultTimeZone = Intl.DateTimeFormat().resolvedOptions().timeZone): CalendarTimeDraft {
  return { allDay: !saved?.startsAt && !saved?.endsAt, startTime: clock(saved?.startsAt), endTime: clock(saved?.endsAt), timeZone: saved?.timeZone || defaultTimeZone };
}

export function calendarTimeZoneOptions(current: string): string[] {
  const zones = typeof Intl.supportedValuesOf === "function" ? Intl.supportedValuesOf("timeZone") : ["Asia/Shanghai", "Asia/Tokyo", "Asia/Singapore", "Asia/Kolkata", "Europe/London", "Europe/Paris", "America/New_York", "America/Los_Angeles", "Australia/Sydney"];
  return [...new Set([current, "UTC", ...zones])].filter(Boolean);
}

function validTimeZone(value: string): boolean {
  if (!value || /^[+-]/.test(value)) return false;
  try { new Intl.DateTimeFormat("zh-CN", { timeZone: value }); return true; } catch { return false; }
}

export function searchCalendarTimeZones(zones: readonly string[], current: string, query: string): { options: string[]; matched: boolean } {
  const needle = query.trim(), normalized = needle.toLowerCase();
  const matches = zones.filter(zone => zone.toLowerCase().includes(normalized));
  if (needle && validTimeZone(needle) && !matches.some(zone => zone.toLowerCase() === normalized)) matches.unshift(needle);
  return { options: [...new Set([current, ...matches])].filter(Boolean), matched: matches.length > 0 };
}

function validDate(value: string): boolean {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  try { Temporal.PlainDate.from(value, { overflow: "reject" }); return true; } catch { return false; }
}

export function calendarFormTime(input: FormTime, saved?: SavedTime | null): Pick<CalendarIntakeInput, "startAt" | "endAt" | "timeZone"> {
  const { date, endDate, allDay, startTime, endTime, timeZone } = input;
  if (!validDate(date)) throw new CalendarFormTimeError("请选择有效的开始日期");
  if (endDate && !validDate(endDate)) throw new CalendarFormTimeError("请选择有效的结束日期");
  if (endDate && endDate < date) throw new CalendarFormTimeError("结束日期不能早于开始日期");
  if (allDay) {
    if (saved?.startsAt || saved?.endsAt) throw new CalendarFormTimeError("已有定时日程暂不支持改为全天");
    return { startAt: null, endAt: null, timeZone: null };
  }
  // Metadata edits must keep the owner's original offset, zone alias and null end date.
  if (saved?.startsAt && saved.endsAt && saved.timeZone && date === saved.date && endDate === saved.endDate
    && startTime === clock(saved.startsAt) && endTime === clock(saved.endsAt) && timeZone === saved.timeZone) {
    return { startAt: saved.startsAt, endAt: saved.endsAt, timeZone: saved.timeZone };
  }
  if (endDate && endDate !== date) throw new CalendarFormTimeError("定时日程的开始和结束需在同一天");
  if (!/^([01]\d|2[0-3]):[0-5]\d$/.test(startTime) || !/^([01]\d|2[0-3]):[0-5]\d$/.test(endTime)) throw new CalendarFormTimeError("请补全开始和结束时间");
  if (!validTimeZone(timeZone)) throw new CalendarFormTimeError("请选择有效时区");
  let start: Temporal.ZonedDateTime, end: Temporal.ZonedDateTime;
  try {
    start = Temporal.ZonedDateTime.from(`${date}T${startTime}[${timeZone}]`, { disambiguation: "reject" });
    end = Temporal.ZonedDateTime.from(`${date}T${endTime}[${timeZone}]`, { disambiguation: "reject" });
  } catch { throw new CalendarFormTimeError("所选时区的时间不存在或不唯一，请调整"); }
  if (Temporal.ZonedDateTime.compare(end, start) <= 0) throw new CalendarFormTimeError("结束时间需晚于开始时间");
  if (![start.offset, end.offset].every(offset => /^[+-]\d{2}:\d{2}$/.test(offset))) throw new CalendarFormTimeError("该日期的时区偏移暂不支持，请调整日期或时区");
  return { startAt: `${date}T${startTime}${start.offset}`, endAt: `${date}T${endTime}${end.offset}`, timeZone };
}
