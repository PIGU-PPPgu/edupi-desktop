"use client";

import type { CalendarItemSelection } from "@/lib/edupi-calendar-model";
import { isPrimaryTimetableSlot } from "@/lib/edupi-calendar-model";
import { isRecognizedTimetableNote } from "@/lib/edupi-recognition-markers";

const WEEKDAYS = ["星期一", "星期二", "星期三", "星期四", "星期五"];
const WEEKDAY_SHORT = ["一", "二", "三", "四", "五", "六", "日"];
const PERIODS = Array.from({ length: 10 }, (_, index) => index + 1);

function record(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : {};
}

function text(value: unknown): string | null {
  return typeof value === "string" && value.trim() ? value.trim() : typeof value === "number" ? String(value) : null;
}

export function EduPiTimetableGrid({ slots, onSelect, compact = false }: { slots: Array<Record<string, unknown>>; onSelect?: (selection: CalendarItemSelection) => void; compact?: boolean }) {
  const normalized = slots.map(record);
  const overflowSlots = normalized.filter((slot) => !isPrimaryTimetableSlot(slot));
  const renderSlot = (slot: Record<string, unknown>, index: number, fallbackId: string) => {
    const day = Number(slot.day_of_week ?? slot.dayOfWeek);
    const period = Number(slot.period);
    const sourceId = text(slot.slot_id ?? slot.id) || fallbackId;
    const subject = text(slot.subject) || "课程";
    const className = text(slot.class_name ?? slot.className);
    const recognized = isRecognizedTimetableNote(slot.notes);
    const dayLabel = Number.isInteger(day) && day >= 1 && day <= 7 ? `周${WEEKDAY_SHORT[day - 1]}` : "星期待补";
    const periodLabel = Number.isInteger(period) ? `第 ${period} 节` : "节次待补";
    return <button type="button" key={`${sourceId}:${index}`} onClick={() => onSelect?.({ kind: "timetable", sourceId, date: null, title: subject, detail: `${dayLabel} · ${periodLabel}`, sourceLabel: recognized ? "材料识别" : "课程表", statusLabel: recognized ? "待确认" : "已确认" })}><strong>{subject}</strong>{className ? <span>{className}</span> : null}{!isPrimaryTimetableSlot(slot) ? <small>{dayLabel} · {periodLabel}</small> : null}</button>;
  };
  return <><section className={`edupi-timetable-grid${compact ? " is-compact" : ""}`} aria-label="教师课程表">
    <div className="edupi-timetable-grid__corner">节次 / 星期</div>{WEEKDAYS.map((day) => <div className="edupi-timetable-grid__weekday" key={day}>{day}</div>)}
    {PERIODS.flatMap((period) => {
      const row = [<div className={`edupi-timetable-grid__period${period === 6 ? " is-afternoon-start" : ""}`} key={`period:${period}`}>第{period}节</div>];
      for (let day = 1; day <= 5; day += 1) {
        const cellSlots = normalized.filter((slot) => Number(slot.day_of_week ?? slot.dayOfWeek) === day && Number(slot.period) === period);
        row.push(<div className={`edupi-timetable-grid__cell${period === 6 ? " is-afternoon-start" : ""}`} key={`${day}:${period}`}>{cellSlots.map((slot, index) => renderSlot(slot, index, `timetable:${day}:${period}:${index}`))}</div>);
      }
      return row;
    })}
  </section>{overflowSlots.length ? <section className="edupi-timetable-overflow" aria-label="其他课程时段"><header><strong>其他时段</strong><span>{overflowSlots.length}</span></header><div>{overflowSlots.map((slot, index) => renderSlot(slot, index, `timetable:other:${index}`))}</div></section> : null}</>;
}
