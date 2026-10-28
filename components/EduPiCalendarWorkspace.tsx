"use client";

import { useEffect, useMemo, useRef, useState, type FormEvent, type ReactNode } from "react";
import type { EducationContract, EducationEntityDeleteKind, TeacherTask } from "@/lib/edupi-education-contract";
import { visibleTimetableNote } from "@/lib/edupi-recognition-markers";
import { taskDisplayTitle } from "@/lib/edupi-workbench";
import {
  addCalendarDays,
  createCalendarProjection,
  filterTimetableSlots,
  getCalendarViewRange,
  parseIsoDate,
  shiftCalendarAnchor,
  type CalendarEntry,
  type CalendarItemSelection,
  type CalendarPendingEntry,
  type CalendarProjection,
  type CalendarViewMode,
} from "@/lib/edupi-calendar-model";
import { EduPiTimetableGrid } from "./EduPiTimetableGrid";
import { useModalDismiss } from "@/hooks/useModalDismiss";
import { intakeOperationHistory } from "@/lib/edupi-operation-history";
import { EduPiOperationHistory } from "./EduPiOperationHistory";
import { EduPiIconButton } from "./EduPiActionIcon";
import { EduPiScheduleConflictReview, type ScheduleConflictReviewRequest } from "./EduPiScheduleConflictReview";
import type { CalendarIntakeInput, CalendarIntakeOutcome } from "@/lib/edupi-education-intake";
import type { ScheduleConflictTarget } from "@/lib/edupi-schedule-conflicts";
import { CalendarFormTimeError, calendarFormTime, calendarTimeLabel, calendarTimeZoneOptions, createCalendarTimeDraft, searchCalendarTimeZones } from "@/lib/edupi-calendar-form-time";
import { calendarReferenceDate, calendarSortDate, compareForegroundDates, isForegroundDate, shanghaiDate } from "@/lib/edupi-foreground";
import { EduPiListPreview, EduPiPagedRows, useEduPiForegroundPolicy } from "./EduPiForeground";

type Props = {
  data: EducationContract;
  query: string;
  onUpload: () => void;
  intakeBusy: boolean;
  selection: CalendarItemSelection | null;
  onSelect: (selection: CalendarItemSelection | null) => void;
  onTaskDetail: (task: TeacherTask) => void;
  onImportCalendar: (event: CalendarIntakeInput) => Promise<CalendarIntakeOutcome | void>;
  onImportTimetable: (slot: { slotId: string | null; dayOfWeek: number; period: number; subject: string; classId: string | null; className: string | null; startTime: string | null; timeZone: string | null; kind: "class" | "routine"; notes: string | null }) => Promise<void>;
  onDeleteEntity: (kind: EducationEntityDeleteKind, id: string, label: string) => Promise<boolean>;
  selectedObjectId?: string | null;
  onObject?: (id: string) => void;
};

const WEEKDAY_LABELS = ["一", "二", "三", "四", "五", "六", "日"];
const VIEW_LABELS: Array<{ mode: CalendarViewMode; label: string; shortcut: string }> = [
  { mode: "day", label: "日", shortcut: "1" },
  { mode: "week", label: "周", shortcut: "2" },
  { mode: "month", label: "月", shortcut: "3" },
];
type CalendarContentMode = "summary" | "calendar" | "timetable";
const CONTENT_LABELS: Array<{ mode: CalendarContentMode; label: string }> = [
  { mode: "summary", label: "汇总" },
  { mode: "calendar", label: "校历" },
  { mode: "timetable", label: "课程表" },
];

function filterProjection(projection: CalendarProjection, contentMode: CalendarContentMode): CalendarProjection {
  if (contentMode === "summary") return projection;
  const entries = projection.entries.filter((entry) => entry.kind === contentMode);
  const entriesByDate = Object.fromEntries(Object.entries(projection.entriesByDate).map(([date, items]) => [date, items.filter((entry) => entry.kind === contentMode)]));
  return {
    ...projection,
    entries,
    entriesByDate,
    pending: projection.pending.filter((entry) => entry.kind === contentMode),
  };
}

function localIsoDate(date = new Date()): string {
  return shanghaiDate(date)!;
}

function dateParts(value: string): { year: number; month: number; day: number } {
  const [year, month, day] = value.split("-").map(Number);
  return { year, month, day };
}

function weekdayIndex(value: string): number {
  const { year, month, day } = dateParts(value);
  const date = new Date(Date.UTC(year, month - 1, day));
  const sundayFirstDay = date.getUTCDay();
  return sundayFirstDay === 0 ? 6 : sundayFirstDay - 1;
}

function readableDate(value: string, weekday = true): string {
  const { year, month, day } = dateParts(value);
  return `${year}年${month}月${day}日${weekday ? ` 星期${WEEKDAY_LABELS[weekdayIndex(value)]}` : ""}`;
}

function periodTitle(view: CalendarViewMode, anchorDate: string): string {
  const range = getCalendarViewRange(view, anchorDate);
  if (view === "day") return readableDate(range.start);
  if (view === "month") {
    const { year, month } = dateParts(anchorDate);
    return `${year}年${month}月`;
  }
  const start = dateParts(range.start);
  const end = dateParts(range.end);
  const startLabel = `${start.year}年${start.month}月${start.day}日`;
  const endLabel = start.year === end.year && start.month === end.month
    ? `${end.day}日`
    : start.year === end.year
      ? `${end.month}月${end.day}日`
      : `${end.year}年${end.month}月${end.day}日`;
  return `${startLabel} — ${endLabel}`;
}

function entryClass(entry: CalendarEntry): string {
  return `edupi-calendar-entry edupi-calendar-entry--${entry.kind} edupi-calendar-entry--${entry.status}${entry.continuesBefore ? " is-continuation-before" : ""}${entry.continuesAfter ? " is-continuation-after" : ""}`;
}

function selectionForEntry(entry: CalendarEntry | CalendarPendingEntry): CalendarItemSelection {
  return {
    kind: entry.kind,
    sourceId: entry.sourceId,
    date: "date" in entry ? entry.date : null,
    title: entry.title,
    detail: entry.detail,
    sourceLabel: entry.sourceLabel,
    statusLabel: entry.statusLabel,
  };
}

function taskDateForCalendar(task: TeacherTask): string | null {
  return task.dueDate || task.triggerDate || task.sourceEventDate;
}

function taskForCalendarEntry(tasks: TeacherTask[], entry: CalendarEntry | CalendarPendingEntry): TeacherTask | null {
  if (entry.kind !== "task") return null;
  if (entry.sourceId) {
    const byId = tasks.find((task) => task.id === entry.sourceId || task.sourceEventId === entry.sourceId);
    if (byId) return byId;
  }
  const entryDate = "date" in entry ? entry.date : null;
  return tasks.find((task) => taskDisplayTitle(task) === entry.title
    && (entryDate === null || taskDateForCalendar(task) === entryDate)
    && (!entry.detail || task.sourceEventName === entry.detail || task.topic === entry.detail || task.student === entry.detail)) || null;
}

function CalendarEntryLine({ entry, compact = false, continued = false, selected = false, onSelect, onTaskDetail }: { entry: CalendarEntry; compact?: boolean; continued?: boolean; selected?: boolean; onSelect: (selection: CalendarItemSelection) => void; onTaskDetail: (entry: CalendarEntry) => void }) {
  const title = entry.kind === "timetable" ? `第 ${entry.period ?? "-"} 节 · ${entry.title}` : entry.title;
  return (
    <button type="button" className={`${entryClass(entry)}${compact ? " is-compact" : ""}${continued ? " is-continued" : ""}${selected ? " is-selected" : ""}`} title={`${title} · ${entry.sourceLabel} · ${entry.statusLabel}`} onClick={() => entry.kind === "task" ? onTaskDetail(entry) : onSelect({ kind: entry.kind, sourceId: entry.sourceId, date: entry.date, title: entry.title, detail: entry.detail, sourceLabel: entry.sourceLabel, statusLabel: entry.statusLabel })} aria-label={compact ? `查看${title}详情 · ${entry.sourceLabel} · ${entry.statusLabel}` : `查看${title}详情`} aria-pressed={selected}>
      <span className="edupi-calendar-entry__source" aria-hidden="true">{entry.sourceIcon}</span>
      <span className="edupi-calendar-entry__body">
        <strong>{title}</strong>
        {!compact && entry.detail ? <small>{entry.detail}</small> : null}
      </span>
      <span className="edupi-calendar-entry__source-label">{entry.sourceLabel}</span>
      <em>{entry.statusLabel}</em>
    </button>
  );
}

function entrySelected(entry: CalendarEntry, selection: CalendarItemSelection | null): boolean {
  return Boolean(selection && selection.kind === entry.kind && selection.sourceId === entry.sourceId && (selection.date === null || selection.date === entry.date));
}

function MonthView({ projection, anchorDate, selection, onSelectDate, onSelect, onTaskDetail }: { projection: ReturnType<typeof createCalendarProjection>; anchorDate: string; selection: CalendarItemSelection | null; onSelectDate: (date: string) => void; onSelect: (selection: CalendarItemSelection) => void; onTaskDetail: (entry: CalendarEntry) => void }) {
  return (
    <section className="edupi-calendar-month" aria-label="月视图">
      <div className="edupi-calendar-weekdays" aria-hidden="true">{WEEKDAY_LABELS.map((label) => <span key={label}>周{label}</span>)}</div>
      <div className="edupi-calendar-month-grid" role="grid" aria-label="月日程网格">
        {projection.monthGrid.map((cell) => {
          const entries = projection.entriesByDate[cell.date] || [];
          const visibleEntries = entries.slice(0, 3);
          return (
            <div className={`edupi-calendar-month-cell${cell.isCurrentMonth ? "" : " is-outside"}${cell.date === anchorDate ? " is-selected" : ""}`} key={cell.date} role="gridcell" aria-label={`${readableDate(cell.date, false)}${cell.weekNumber === null ? "" : `，第${cell.weekNumber}周`}，${entries.length} 项日程`}>
              {weekdayIndex(cell.date) === 0 && cell.weekNumber !== null ? <span className="edupi-calendar-month-cell__week">第{cell.weekNumber}周</span> : null}
              <button type="button" className="edupi-calendar-month-cell__date" onClick={() => onSelectDate(cell.date)} aria-label={`查看 ${readableDate(cell.date)}`} aria-current={cell.date === localIsoDate() ? "date" : undefined}>{cell.day}</button>
              <div className="edupi-calendar-month-cell__entries">
                {visibleEntries.map((entry) => <CalendarEntryLine compact={entry.kind !== "task" || entry.rangeStart === entry.rangeEnd} continued={entry.continuesBefore && weekdayIndex(cell.date) !== 0} key={entry.id} entry={entry} selected={entrySelected(entry, selection)} onSelect={onSelect} onTaskDetail={onTaskDetail} />)}
                {entries.length > visibleEntries.length ? <button type="button" className="edupi-calendar-more" onClick={() => onSelectDate(cell.date)}>+{entries.length - visibleEntries.length}</button> : null}
              </div>
            </div>
          );
        })}
      </div>
    </section>
  );
}

function WeekView({ projection, selection, onSelectDate, onSelect, onTaskDetail }: { projection: ReturnType<typeof createCalendarProjection>; selection: CalendarItemSelection | null; onSelectDate: (date: string) => void; onSelect: (selection: CalendarItemSelection) => void; onTaskDetail: (entry: CalendarEntry) => void }) {
  const dates = Array.from({ length: 7 }, (_, index) => addCalendarDays(projection.range.start, index));
  return (
    <section className="edupi-calendar-week" aria-label="周视图">
      <div className="edupi-calendar-week-grid" role="grid" aria-label="周一至周日日程">
        {dates.map((date) => {
          const entries = projection.entriesByDate[date] || [];
          const allDayEntries = entries.filter((entry) => entry.allDay);
          const timetableEntries = entries.filter((entry) => !entry.allDay);
          const parts = dateParts(date);
          return (
            <div className="edupi-calendar-week-column" key={date} role="gridcell" aria-label={`${readableDate(date)}，${entries.length} 项日程`}>
              <header>
                <button type="button" onClick={() => onSelectDate(date)} aria-label={`查看 ${readableDate(date)}`} aria-current={date === localIsoDate() ? "date" : undefined}><span>周{WEEKDAY_LABELS[weekdayIndex(date)]}</span><strong>{parts.day}</strong></button>
                <small>{entries.length ? `${entries.length} 项` : "空"}</small>
              </header>
              <div className="edupi-calendar-week-column__all-day" aria-label={`${readableDate(date, false)}全天事项`}>
                <EduPiListPreview rows={allDayEntries} onShowAll={() => onSelectDate(date)} renderRow={entry => <CalendarEntryLine key={entry.id} entry={entry} selected={entrySelected(entry, selection)} onSelect={onSelect} onTaskDetail={onTaskDetail} />} />
              </div>
              <div className="edupi-calendar-week-column__lessons" aria-label={`${readableDate(date, false)}课程表`}>
                <EduPiListPreview rows={timetableEntries} onShowAll={() => onSelectDate(date)} renderRow={entry => <CalendarEntryLine key={entry.id} entry={entry} selected={entrySelected(entry, selection)} onSelect={onSelect} onTaskDetail={onTaskDetail} />} />
              </div>
              {entries.length === 0 ? <div className="edupi-calendar-empty-cell">暂无安排</div> : null}
            </div>
          );
        })}
      </div>
    </section>
  );
}

function DayView({ projection, selection, onSelect, onTaskDetail }: { projection: ReturnType<typeof createCalendarProjection>; selection: CalendarItemSelection | null; onSelect: (selection: CalendarItemSelection) => void; onTaskDetail: (entry: CalendarEntry) => void }) {
  const entries = projection.entriesByDate[projection.range.start] || [];
  const allDayEntries = entries.filter((entry) => entry.allDay);
  const timetableEntries = entries.filter((entry) => !entry.allDay);
  return (
    <section className="edupi-calendar-day" aria-label="日视图">
      <div className="edupi-calendar-day__summary"><strong>{readableDate(projection.range.start)}</strong><span>{entries.length ? `${entries.length} 项安排` : "暂无安排"}</span></div>
      <div className="edupi-calendar-day__agenda">
        <section aria-labelledby="edupi-calendar-day-all-day"><h2 id="edupi-calendar-day-all-day">全天事项</h2><EduPiPagedRows rows={allDayEntries} memoryKey={`calendar:day:all:${projection.range.start}`} renderRow={entry => <CalendarEntryLine key={entry.id} entry={entry} selected={entrySelected(entry, selection)} onSelect={onSelect} onTaskDetail={onTaskDetail} />} empty="暂无校历或任务" /></section>
        <section aria-labelledby="edupi-calendar-day-lessons"><h2 id="edupi-calendar-day-lessons">课程表</h2><EduPiPagedRows rows={timetableEntries} memoryKey={`calendar:day:lessons:${projection.range.start}`} renderRow={entry => <CalendarEntryLine key={entry.id} entry={entry} selected={entrySelected(entry, selection)} onSelect={onSelect} onTaskDetail={onTaskDetail} />} empty="暂无课程安排" /></section>
      </div>
    </section>
  );
}

function PendingInbox({ projection, selection, onSelect, onTaskDetail }: { projection: ReturnType<typeof createCalendarProjection>; selection: CalendarItemSelection | null; onSelect: (selection: CalendarItemSelection) => void; onTaskDetail: (entry: CalendarPendingEntry) => void }) {
  if (projection.pending.length === 0) return null;
  return (
    <section className="edupi-calendar-pending" aria-labelledby="edupi-calendar-pending-title">
      <header><div><h2 id="edupi-calendar-pending-title">日期待确认</h2></div><small>{projection.pending.length} 项</small></header>
      <div className="edupi-calendar-pending__list"><EduPiPagedRows rows={projection.pending} memoryKey="calendar:pending" renderRow={entry => { const selected = Boolean(selection && selection.kind === entry.kind && selection.sourceId === entry.sourceId); return <button type="button" className={`edupi-calendar-pending__row${entry.status === "failed" ? " is-failed" : ""}${selected ? " is-selected" : ""}`} key={`${entry.kind}:${entry.id}`} onClick={() => entry.kind === "task" ? onTaskDetail(entry) : onSelect(selectionForEntry(entry))} aria-pressed={selected}><span className="edupi-calendar-entry__source" aria-hidden="true">{entry.sourceIcon}</span><span><strong>{entry.title}</strong>{entry.detail ? <small>{entry.detail}</small> : null}</span><span>{entry.sourceLabel}</span><em>{entry.statusLabel}</em></button>; }} /></div>
    </section>
  );
}

function rawRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : {};
}

function rawText(value: unknown): string | null {
  if (Array.isArray(value)) return value.map((item) => String(item)).filter(Boolean).join("、") || null;
  if (typeof value === "number") return String(value);
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

const calendarTypeLabels: Record<string, string> = { exam: "考试", activity: "活动", meeting: "会议", holiday: "假期", festival: "节日", teaching: "教学节点", custom: "日程" };
type NonTaskCalendarSelection = Omit<CalendarItemSelection, "kind"> & { kind: "calendar" | "timetable" };
type IntakeFocusReturn = { from: Element | null; document: Document } | null;

function isNonTaskSelection(selection: CalendarItemSelection): selection is NonTaskCalendarSelection {
  return selection.kind === "calendar" || selection.kind === "timetable";
}

function CalendarDetailDrawer({ data, selection, onClose, onEdit, onDelete, deleteBusy = false, editor, openerRef }: { data: EducationContract; selection: NonTaskCalendarSelection; onClose: () => void; onEdit?: () => void; onDelete?: () => void; deleteBusy?: boolean; editor?: ReactNode; openerRef?: { current: Element | null } }) {
  useEffect(() => { if (openerRef) openerRef.current = document.activeElement; }, [openerRef]);
  const drawerRef = useModalDismiss<HTMLElement>(onClose);
  const rows: Array<{ label: string; value: string }> = [];
  let title = selection.title;
  const history = selection.sourceId ? intakeOperationHistory(data, selection.kind === "calendar" ? "import_calendar" : "import_timetable", selection.sourceId) : [];
  if (selection.kind === "calendar") {
    const item = data.calendar.find((event) => event.id === selection.sourceId || (!event.id && event.name === selection.title && event.date === selection.date));
    title = item?.name || title;
    for (const [label, value] of [
      ["日期", item?.date || selection.date],
      ["结束", item?.endDate],
      ["开始时间", calendarTimeLabel(item?.startsAt, item?.date || selection.date)],
      ["结束时间", calendarTimeLabel(item?.endsAt, item?.date || selection.date)],
      ["时区", item?.timeZone],
      ["地点", item?.location],
      ["类型", item?.type ? calendarTypeLabels[item.type] || item.type : null],
      ["来源", selection.sourceLabel],
      ["状态", selection.statusLabel],
      ["备注", item?.notes || selection.detail],
    ] as Array<[string, unknown]>) { const text = rawText(value); if (text) rows.push({ label, value: text }); }
  } else if (selection.kind === "timetable") {
    const item = data.timetable.map(rawRecord).find((slot) => rawText(slot.slot_id ?? slot.id) === selection.sourceId) || {};
    title = rawText(item.subject) || title;
    const day = rawText(item.day_of_week ?? item.dayOfWeek);
    for (const [label, value] of [
      ["星期", day ? `周${WEEKDAY_LABELS[Math.max(0, Number(day) - 1)] || day}` : null],
      ["节次", rawText(item.period)],
      ["科目 / 事务", rawText(item.subject) || selection.title],
      ["班级", rawText(item.class_name ?? item.className)],
      ["上课时间", rawText(item.start_time)],
      ["时区", rawText(item.time_zone)],
      ["类型", item.kind === "routine" ? "固定事务" : "课程"],
      ["备注", visibleTimetableNote(item.notes) || selection.detail],
    ] as Array<[string, unknown]>) { const text = rawText(value); if (text) rows.push({ label, value: text }); }
  }
  return <aside ref={drawerRef} className="edupi-calendar-detail" role="dialog" aria-modal="true" aria-label={`${title}详情`}><header><div><h2>{title}</h2></div><div className="edupi-calendar-detail__actions">{onEdit && !editor ? <EduPiIconButton type="button" icon="edit" label="编辑" className="is-edit" data-calendar-edit-trigger onClick={onEdit}/> : null}{onDelete && !editor ? <EduPiIconButton type="button" icon="delete" label={deleteBusy ? "正在删除" : "删除"} className="is-delete" data-calendar-delete-trigger busy={deleteBusy} disabled={deleteBusy} onClick={onDelete}/> : null}<EduPiIconButton type="button" icon="close" label="关闭详情" data-autofocus onClick={onClose}/></div></header>{editor ? <div className="edupi-calendar-detail__editor">{editor}</div> : <><dl>{rows.map((row) => <div key={row.label}><dt>{row.label}</dt><dd>{row.value}</dd></div>)}</dl><EduPiOperationHistory rows={history} /></>}</aside>;
}

function IntakeComposer({ mode, anchorDate, calendarEvent, timetableSlot, busy, embedded = false, onClose, onImportCalendar, onImportTimetable }: {
  mode: "calendar" | "timetable";
  anchorDate: string;
  calendarEvent?: EducationContract["calendar"][number] | null;
  timetableSlot?: Record<string, unknown> | null;
  busy: boolean;
  embedded?: boolean;
  onClose: (focus: IntakeFocusReturn, reviewTarget?: ScheduleConflictTarget) => void;
  onImportCalendar: Props["onImportCalendar"];
  onImportTimetable: Props["onImportTimetable"];
}) {
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [newOccurrenceRef] = useState(() => `manual-${globalThis.crypto.randomUUID()}`);
  const [timeDraft, setTimeDraft] = useState(() => createCalendarTimeDraft(calendarEvent));
  const [showTimeZone, setShowTimeZone] = useState(false);
  const [timeZoneQuery, setTimeZoneQuery] = useState("");
  const timeZones = useMemo(() => calendarTimeZoneOptions(timeDraft.timeZone), [timeDraft.timeZone]);
  const timeZoneSearch = useMemo(() => searchCalendarTimeZones(timeZones, timeDraft.timeZone, timeZoneQuery), [timeZones, timeDraft.timeZone, timeZoneQuery]);
  const composerRootRef = useRef<HTMLElement>(null);
  const mounted = useRef(true);
  const submitting = useRef(false);
  const stopFocusTracking = useRef<(() => void) | null>(null);
  useEffect(() => {
    mounted.current = true;
    return () => { mounted.current = false; stopFocusTracking.current?.(); };
  }, []);
  const returnFocus = (): IntakeFocusReturn => {
    const root = composerRootRef.current;
    if (!root?.isConnected) return null;
    const document = root.ownerDocument, from = document.activeElement;
    return root.contains(from) || from === document.body || from === document.documentElement ? { from, document } : null;
  };
  const close = () => onClose(returnFocus());
  const occurrenceFields = mode === "calendar" && Boolean(!calendarEvent || calendarEvent.occurrenceRef);
  const existingTimed = Boolean(calendarEvent?.startsAt || calendarEvent?.endsAt);
  const submit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (busy || submitting.current) return;
    const form = new FormData(event.currentTarget);
    submitting.current = true;
    setSaving(true); setError(null);
    let focus = returnFocus();
    const focusDocument = focus?.document;
    const preserveMovedFocus = (event: FocusEvent) => {
      if (focus && event.target !== focus.from && event.target !== focus.document.body && event.target !== focus.document.documentElement) focus = null;
    };
    focusDocument?.addEventListener("focusin", preserveMovedFocus);
    const stop = () => focusDocument?.removeEventListener("focusin", preserveMovedFocus);
    stopFocusTracking.current = stop;
    let reviewTarget: ScheduleConflictTarget | undefined;
    let saved = false;
    try {
      if (mode === "calendar") {
        const sourceOccurrenceRef = calendarEvent ? calendarEvent.occurrenceRef : newOccurrenceRef;
        const date = String(form.get("date") || "");
        const endDate = String(form.get("endDate") || "") || null;
        const interval = calendarFormTime({ ...timeDraft, allDay: !occurrenceFields || timeDraft.allDay, date, endDate }, calendarEvent);
        const outcome = await onImportCalendar({
          eventId: calendarEvent?.id || null,
          date,
          endDate,
          name: String(form.get("name") || ""),
          type: String(form.get("type") || "custom"),
          notes: String(form.get("notes") || "") || null,
          sourceOccurrenceRef,
          ...interval,
          location: String(form.get("location") || "") || null,
        });
        if (outcome?.status === "held") reviewTarget = { canonicalId: calendarEvent?.id || null, occurrenceRef: sourceOccurrenceRef, evidenceIds: outcome.evidenceIds };
      } else {
        const startTime = String(form.get("startTime") || "") || null;
        await onImportTimetable({
          slotId: rawText(timetableSlot?.slot_id ?? timetableSlot?.id),
          dayOfWeek: Number(form.get("dayOfWeek")),
          period: Number(form.get("period")),
          subject: String(form.get("subject") || ""),
          classId: String(form.get("classId") || "") || null,
          className: String(form.get("className") || "") || null,
          startTime,
          timeZone: startTime ? String(form.get("timeZone") || "") || null : null,
          kind: form.get("kind") === "routine" ? "routine" : "class",
          notes: String(form.get("notes") || "") || null,
        });
      }
      saved = true;
      if (mounted.current) onClose(focus, reviewTarget);
    } catch (cause) {
      if (mounted.current) setError(cause instanceof CalendarFormTimeError ? cause.message : "接入失败，请检查后重试");
    } finally {
      if (!saved) { submitting.current = false; if (mounted.current) setSaving(false); }
      stop();
      if (stopFocusTracking.current === stop) stopFocusTracking.current = null;
    }
  };
  const editingCalendar = mode === "calendar" && Boolean(calendarEvent?.id);
  const editingTimetable = mode === "timetable" && Boolean(rawText(timetableSlot?.slot_id ?? timetableSlot?.id));
  const title = mode === "calendar" ? editingCalendar ? "编辑日程" : "新建日程" : editingTimetable ? "编辑课表" : "添加课表";
  const locked = busy || saving;
  return <section ref={composerRootRef} className={`edupi-calendar-intake${mode === "calendar" ? " is-calendar" : ""}${embedded ? " is-embedded" : ""}`} aria-label={title}>{!embedded ? <header><strong>{title}</strong><button type="button" onClick={close} aria-label="关闭">×</button></header> : null}<form onSubmit={(event) => void submit(event)}><fieldset className="edupi-calendar-intake__fields" disabled={locked}>{mode === "calendar" ? <>
    <label className="is-wide"><span>名称</span><input name="name" required maxLength={240} autoFocus placeholder="如：期中考试" defaultValue={calendarEvent?.name || ""} /></label>
    <label><span>开始</span><input name="date" type="date" required defaultValue={calendarEvent?.date || anchorDate} /></label>
    <label><span>结束</span><input name="endDate" type="date" defaultValue={calendarEvent?.endDate || ""} /></label>
    {occurrenceFields ? <>
      {!existingTimed ? <label className="edupi-calendar-intake__all-day"><input name="allDay" type="checkbox" checked={timeDraft.allDay} onChange={(event) => setTimeDraft((draft) => ({ ...draft, allDay: event.target.checked }))} /><span>全天</span></label> : null}
      {!timeDraft.allDay ? <>
        <label><span>开始时间</span><input name="startTime" type="time" step={60} required value={timeDraft.startTime} onChange={(event) => setTimeDraft((draft) => ({ ...draft, startTime: event.target.value }))} /></label>
        <label><span>结束时间</span><input name="endTime" type="time" step={60} required value={timeDraft.endTime} onChange={(event) => setTimeDraft((draft) => ({ ...draft, endTime: event.target.value }))} /></label>
        <div className="edupi-calendar-intake__time-zone"><button type="button" aria-expanded={showTimeZone} aria-controls={`${newOccurrenceRef}-time-zone`} onClick={() => setShowTimeZone((open) => !open)}>时区</button>{showTimeZone ? <div id={`${newOccurrenceRef}-time-zone`} className="edupi-calendar-intake__time-zone-picker"><input type="search" aria-label="搜索时区" placeholder="搜索时区" autoComplete="off" value={timeZoneQuery} onChange={(event) => setTimeZoneQuery(event.target.value)} /><select name="timeZone" aria-label="时区" className="edupi-calendar-intake__time-zone-list" size={6} value={timeDraft.timeZone} onChange={(event) => setTimeDraft((draft) => ({ ...draft, timeZone: event.target.value }))}>{timeZoneSearch.options.map((zone) => <option key={zone} value={zone}>{zone}</option>)}</select>{!timeZoneSearch.matched ? <span role="status">无匹配时区</span> : null}</div> : null}</div>
      </> : null}
      <label><span>地点</span><input name="location" maxLength={240} placeholder="可不填" defaultValue={calendarEvent?.location || ""} /></label>
    </> : null}
    <label><span>类型</span><select name="type" defaultValue={calendarEvent?.type || "custom"}><option value="custom">日程</option><option value="teaching">教学节点</option><option value="exam">考试</option><option value="meeting">会议</option><option value="activity">活动</option><option value="holiday">假期</option><option value="festival">节日</option></select></label>
  </> : <>
    <label><span>星期</span><select name="dayOfWeek" defaultValue={rawText(timetableSlot?.day_of_week ?? timetableSlot?.dayOfWeek) || weekdayIndex(anchorDate) + 1}>{WEEKDAY_LABELS.map((label, index) => <option key={label} value={index + 1}>周{label}</option>)}</select></label>
    <label><span>节次</span><input name="period" type="number" min={0} max={64} required defaultValue={rawText(timetableSlot?.period) || 1} /></label>
    <label><span>科目 / 事务</span><input name="subject" required maxLength={120} placeholder="如：数学" defaultValue={rawText(timetableSlot?.subject) || ""} /></label>
    <label><span>班级</span><input name="className" maxLength={120} placeholder="可不填" defaultValue={rawText(timetableSlot?.class_name ?? timetableSlot?.className) || ""} /></label>
    <label><span>班级编号</span><input name="classId" maxLength={128} placeholder="如 7-1" defaultValue={rawText(timetableSlot?.class_id) || ""} /></label>
    <label><span>上课时间</span><input name="startTime" type="time" defaultValue={rawText(timetableSlot?.start_time) || ""} /></label>
    <label><span>时区</span><input name="timeZone" maxLength={100} defaultValue={rawText(timetableSlot?.time_zone) || Intl.DateTimeFormat().resolvedOptions().timeZone} /></label>
    <label><span>类型</span><select name="kind" defaultValue={timetableSlot?.kind === "routine" ? "routine" : "class"}><option value="class">课程</option><option value="routine">固定事务</option></select></label>
  </>}<label className="is-wide"><span>备注</span><textarea name="notes" rows={3} maxLength={1000} placeholder="可不填" defaultValue={mode === "calendar" ? calendarEvent?.notes || "" : visibleTimetableNote(timetableSlot?.notes) || ""} /></label></fieldset><footer>{error ? <span role="alert">{error}</span> : <span /> }<button type="button" onClick={close}>取消</button><button type="submit" className="is-primary" disabled={locked}>{locked ? "保存中…" : editingCalendar || editingTimetable ? "保存更改" : "写入 EduPi"}</button></footer></form></section>;
}

export function EduPiCalendarWorkspace({ data, query, onUpload, intakeBusy, selection, onSelect: onSelectItem, onTaskDetail, onImportCalendar, onImportTimetable, onDeleteEntity, selectedObjectId, onObject }: Props) {
  const policy = useEduPiForegroundPolicy();
  const [localList, setLocalList] = useState(false);
  const sourceHistory = Boolean(selectedObjectId?.startsWith("calendar:history"));
  const sourceUpcoming = selectedObjectId === "calendar:list:upcoming";
  const sourceEvents = selectedObjectId === "calendar:list:events" || sourceUpcoming || sourceHistory;
  const sourceCourses = selectedObjectId === "calendar:list:courses";
  const listOpen = selectedObjectId === undefined ? localList : Boolean(selectedObjectId?.startsWith("calendar:list") || sourceHistory);
  const completeTransactions = listOpen && !sourceEvents && !sourceCourses;
  const openList = () => { setLocalList(true); onObject?.("calendar:list"); };
  const closeList = () => { setLocalList(false); onObject?.("calendar:calendar"); };
  const [view, setView] = useState<CalendarViewMode>(sourceCourses ? "week" : "month");
  const [contentMode, setContentMode] = useState<CalendarContentMode>("summary");
  const [anchorDate, setAnchorDate] = useState(localIsoDate);
  const [composer, setComposer] = useState<"calendar" | "timetable" | null>(null);
  const [editingCalendarId, setEditingCalendarId] = useState<string | null>(null);
  const [editingTimetableId, setEditingTimetableId] = useState<string | null>(null);
  const [reviewRequest, setReviewRequest] = useState<(ScheduleConflictReviewRequest & { originSelectionKey: string | null; objectId: string | null | undefined }) | null>(null);
  const reviewSequence = useRef(0);
  const onSelect = (next: CalendarItemSelection | null) => { clearDeleteReturn(); setReviewRequest(null); onSelectItem(next); };
  const [deleteBusy, setDeleteBusy] = useState(false);
  const [deleteFocusTick, setDeleteFocusTick] = useState(0);
  const workspaceRef = useRef<HTMLElement>(null);
  const detailOpener = useRef<Element | null>(null);
  const selectionKey = selection ? `${selection.kind}:${selection.sourceId || `${selection.date}:${selection.title}`}` : null;
  const editorKey = composer ? `new:${composer}` : editingCalendarId && selection?.kind === "calendar" && selection.sourceId === editingCalendarId ? `calendar:${editingCalendarId}` : editingTimetableId && selection?.kind === "timetable" && selection.sourceId === editingTimetableId ? `timetable:${editingTimetableId}` : null;
  const closeContext = useRef({ editorKey, selectionKey, selectedObjectId });
  closeContext.current = { editorKey, selectionKey, selectedObjectId };
  const closeFocus = useRef<(NonNullable<IntakeFocusReturn> & { editorKey: string; selectionKey: string | null; selectedObjectId: string | null | undefined; target: "calendar" | "timetable" | "edit" | "delete" }) | null>(null);
  const deleteReturn = useRef<(NonNullable<IntakeFocusReturn> & { selectionKey: string | null; selectedObjectId: string | null | undefined; kind: "calendar" | "timetable"; opener: Element | null; completed: boolean; moved: boolean; outside: HTMLElement | null; stop: () => void }) | null>(null);
  const clearDeleteReturn = () => { deleteReturn.current?.stop(); deleteReturn.current = null; };
  const heldFocusToKeep = useRef<{ target: HTMLElement; document: Document; stop: () => void } | null>(null);
  useEffect(() => {
    if (reviewRequest && (reviewRequest.objectId !== selectedObjectId || selectionKey && selectionKey !== reviewRequest.originSelectionKey)) setReviewRequest(null);
  }, [reviewRequest, selectedObjectId, selectionKey]);
  useEffect(() => () => { closeFocus.current = null; deleteReturn.current?.stop(); deleteReturn.current = null; heldFocusToKeep.current?.stop(); heldFocusToKeep.current = null; }, []);
  useEffect(() => {
    const request = deleteReturn.current, root = workspaceRef.current;
    if (!request) return;
    if (!root?.isConnected || root.ownerDocument !== request.document || request.selectedObjectId !== selectedObjectId || editorKey
      || selectionKey && selectionKey !== request.selectionKey) { clearDeleteReturn(); return; }
    // The parent may commit its snapshot and close the detail before resolving deletion.
    if (!request.completed || deleteBusy || selectionKey) return;
    clearDeleteReturn();
    const { document } = request, active = document.activeElement;
    if (active?.closest?.("[role='dialog'], [aria-modal='true']")) return;
    if (request.outside?.isConnected && (active === request.opener || active === document.body || active === document.documentElement || root.contains(active))) {
      if (active !== request.outside) request.outside.focus({ preventScroll: true });
      return;
    }
    if (request.moved || active !== request.from && active !== document.body && active !== document.documentElement) return;
    const create = root.querySelector<HTMLButtonElement>(`[data-calendar-create="${request.kind}"]`);
    const target = create?.isConnected && !create.disabled ? create : root.querySelector<HTMLElement>("[data-calendar-heading]");
    if (target?.isConnected && root.contains(target)) target.focus({ preventScroll: false });
  }, [deleteBusy, deleteFocusTick, selectionKey, selectedObjectId, editorKey]);
  useEffect(() => {
    const keep = heldFocusToKeep.current;
    if (!keep) return;
    if (reviewRequest && reviewRequest.objectId === selectedObjectId && (selectionKey || editorKey)) return;
    heldFocusToKeep.current = null; keep.stop();
    if (!reviewRequest || reviewRequest.objectId !== selectedObjectId || !workspaceRef.current?.isConnected || !keep.target.isConnected) return;
    const active = keep.document.activeElement;
    if (active !== keep.target && !active?.closest?.("[role='dialog'], [aria-modal='true']")) keep.target.focus({ preventScroll: true });
  }, [reviewRequest, selectionKey, editorKey, selectedObjectId]);
  useEffect(() => {
    const request = closeFocus.current;
    if (!request) return;
    const root = workspaceRef.current;
    if (request.selectionKey !== selectionKey || request.selectedObjectId !== selectedObjectId || !root?.isConnected || root.ownerDocument !== request.document
      || editorKey && editorKey !== request.editorKey) { closeFocus.current = null; return; }
    const document = request.document;
    if (editorKey || intakeBusy || deleteBusy) {
      const preserveMovedFocus = (event: FocusEvent) => {
        if (request.target === "delete" && (event.target as Element | null)?.closest?.(".edupi-delete-confirmation")) return;
        if (event.target !== request.from && event.target !== document.body && event.target !== document.documentElement) closeFocus.current = null;
      };
      document.addEventListener("focusin", preserveMovedFocus);
      return () => document.removeEventListener("focusin", preserveMovedFocus);
    }
    closeFocus.current = null;
    const active = document.activeElement;
    if (active !== request.from && active !== document.body && active !== document.documentElement) return;
    const target = root.querySelector<HTMLButtonElement>(request.target === "edit" ? "[data-calendar-edit-trigger]" : request.target === "delete" ? "[data-calendar-delete-trigger]" : `[data-calendar-create="${request.target}"]`);
    if (target?.isConnected && !target.disabled && root.contains(target)) target.focus({ preventScroll: false });
  }, [editorKey, intakeBusy, deleteBusy, deleteFocusTick, selectionKey, selectedObjectId, data]);
  useEffect(() => {
    if (editingCalendarId && (selection?.kind !== "calendar" || selection.sourceId !== editingCalendarId)) setEditingCalendarId(null);
    if (editingTimetableId && (selection?.kind !== "timetable" || selection.sourceId !== editingTimetableId)) setEditingTimetableId(null);
  }, [editingCalendarId, editingTimetableId, selection?.kind, selection?.sourceId]);
  useEffect(() => {
    const requestedDate = parseIsoDate(new URLSearchParams(window.location.search).get("date"));
    if (requestedDate) setAnchorDate(requestedDate);
  }, []);
  useEffect(() => {
    if (selection?.date && !listOpen) setAnchorDate(selection.date);
  }, [selection?.date, listOpen]);
  useEffect(() => {
    if (sourceCourses) { setView("week"); setAnchorDate(policy.today); }
  }, [sourceCourses, policy.today]);
  useEffect(() => {
    if (sourceEvents) setContentMode("calendar");
    else if (sourceCourses) setContentMode("summary");
  }, [sourceEvents, sourceCourses]);
  const currentWeek = sourceUpcoming ? data.calendar.find(event => Boolean(event.date && event.date <= policy.today && (event.endDate || event.date) >= policy.today && /第\d+周/.test(event.name))) : undefined;
  const sourceFacts = data.calendar.filter(event => event !== currentWeek && (sourceHistory || isForegroundDate(calendarReferenceDate(event), policy))
    && (!query.trim() || `${event.name} ${event.date || ""} ${event.endDate || ""}`.toLowerCase().includes(query.trim().toLowerCase())))
    .sort((left, right) => compareForegroundDates(calendarSortDate(left, policy.today), calendarSortDate(right, policy.today), policy.today) || left.name.localeCompare(right.name));
  const projection = useMemo(() => filterProjection(createCalendarProjection(data, { view, anchorDate, query, foregroundPolicy: listOpen && !sourceHistory ? { ...policy, ...data } : undefined, completeTransactions }), contentMode), [anchorDate, contentMode, data, query, view, policy, listOpen, sourceHistory, completeTransactions]);
  const listRows = [...new Map(projection.entries.filter(entry => !sourceCourses || entry.kind === "timetable").map(entry => [entry.kind === "calendar" ? entry.id.replace(/:\d{4}-\d{2}-\d{2}$/, "") : entry.id, entry])).values()]
    .sort((left, right) => {
      const effectiveDate = (entry: CalendarEntry) => entry.rangeStart <= policy.today && entry.rangeEnd >= policy.today ? policy.today : entry.rangeEnd < policy.today ? entry.rangeEnd : entry.rangeStart;
      return compareForegroundDates(effectiveDate(left), effectiveDate(right), policy.today) || left.title.localeCompare(right.title);
    });
  const filteredTimetable = useMemo(() => filterTimetableSlots(data.timetable, query), [data.timetable, query]);
  const editingCalendarEvent = editingCalendarId
    ? data.calendar.find((event) => event.id === editingCalendarId) || null
    : null;
  const editingTimetableSlot = editingTimetableId
    ? data.timetable.map(rawRecord).find((slot) => rawText(slot.slot_id ?? slot.id) === editingTimetableId) || null
    : null;
  const openTaskDetail = (entry: CalendarEntry | CalendarPendingEntry) => {
    const task = taskForCalendarEntry(data.tasks, entry);
    if (task) onTaskDetail(task);
    else onSelect(selectionForEntry(entry));
  };

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.defaultPrevented || event.isComposing || event.metaKey || event.ctrlKey || event.altKey) return;
      const target = event.target as HTMLElement | null;
      if (target?.isContentEditable || target instanceof HTMLInputElement || target instanceof HTMLTextAreaElement || target instanceof HTMLSelectElement
        || target?.closest?.("[role='dialog'], [aria-modal='true']")) return;
      if (event.key.toLocaleLowerCase() === "t") {
        event.preventDefault();
        setAnchorDate(localIsoDate());
      } else if (event.key === "1" || event.key === "2" || event.key === "3") {
        event.preventDefault();
        setView(event.key === "1" ? "day" : event.key === "2" ? "week" : "month");
      }
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, []);

  const changePeriod = (direction: -1 | 1) => setAnchorDate(shiftCalendarAnchor(view, anchorDate, direction));
  const selectDate = (date: string) => {
    setAnchorDate(date);
    setView("day");
  };
  const itemCount = sourceEvents ? sourceFacts.length : listOpen ? listRows.length + projection.pending.length : projection.entries.length + projection.pending.length;
  const queueCloseFocus = (key: string, target: "calendar" | "timetable" | "edit", focus: IntakeFocusReturn) => {
    const current = closeContext.current;
    if (current.editorKey !== key) return false;
    closeFocus.current = focus && current.selectionKey === selectionKey && current.selectedObjectId === selectedObjectId
      ? { ...focus, ...current, editorKey: key, target } : null;
    return true;
  };
  const followHeldReview = (key: string, target: ScheduleConflictTarget | undefined, focus: IntakeFocusReturn) => {
    const current = closeContext.current;
    if (!target || current.editorKey !== key || current.selectionKey !== selectionKey || current.selectedObjectId !== selectedObjectId) return;
    const active = focus?.document.activeElement;
    const mayFocus = Boolean(focus && (active === focus.from || active === focus.document.body || active === focus.document.documentElement));
    closeFocus.current = null;
    heldFocusToKeep.current?.stop(); heldFocusToKeep.current = null;
    const root = workspaceRef.current, document = root?.ownerDocument, keep = document?.activeElement as HTMLElement | null;
    if (!mayFocus && root && document && keep && keep !== document.body && keep !== document.documentElement && !root.contains(keep) && typeof keep.focus === "function") {
      const cancel = () => { heldFocusToKeep.current?.stop(); heldFocusToKeep.current = null; };
      const stop = () => { document.removeEventListener("pointerdown", cancel); document.removeEventListener("keydown", cancel); };
      heldFocusToKeep.current = { target: keep, document, stop };
      document.addEventListener("pointerdown", cancel); document.addEventListener("keydown", cancel);
    }
    setReviewRequest({ id: ++reviewSequence.current, target, focus: mayFocus, originSelectionKey: selectionKey, objectId: selectedObjectId });
    onSelectItem(null);
  };
  const closeComposer = (focus: IntakeFocusReturn, reviewTarget?: ScheduleConflictTarget) => {
    if (!composer || !queueCloseFocus(`new:${composer}`, composer, focus)) return;
    followHeldReview(`new:${composer}`, reviewTarget, focus);
    setComposer(null);
    setEditingCalendarId(null);
    setEditingTimetableId(null);
  };
  const openComposer = (mode: "calendar" | "timetable") => {
    clearDeleteReturn();
    setReviewRequest(null);
    closeFocus.current = null;
    if (composer === mode && !editingCalendarId && !editingTimetableId) {
      workspaceRef.current?.querySelector<HTMLInputElement>(`.edupi-calendar-intake:not(.is-embedded) input[name="${mode === "calendar" ? "name" : "subject"}"]`)?.focus({ preventScroll: false });
      return;
    }
    setEditingCalendarId(null); setEditingTimetableId(null); setComposer(mode);
  };
  const closeEditor = (mode: "calendar" | "timetable", focus: IntakeFocusReturn, reviewTarget?: ScheduleConflictTarget) => {
    const id = mode === "calendar" ? editingCalendarId : editingTimetableId;
    if (!id || !queueCloseFocus(`${mode}:${id}`, "edit", focus)) return;
    followHeldReview(`${mode}:${id}`, reviewTarget, focus);
    if (mode === "calendar") setEditingCalendarId(null);
    else setEditingTimetableId(null);
  };
  const editSelectedCalendar = () => {
    if (!selection || selection.kind !== "calendar" || !selection.sourceId) return;
    const event = data.calendar.find((item) => item.id === selection.sourceId);
    if (!event) return;
    setReviewRequest(null);
    setEditingCalendarId(event.id || null);
    setEditingTimetableId(null);
    if (event.date) setAnchorDate(event.date);
    setComposer(null);
  };
  const editSelectedTimetable = () => {
    if (!selection || selection.kind !== "timetable" || !selection.sourceId) return;
    const slot = data.timetable.map(rawRecord).find((item) => rawText(item.slot_id ?? item.id) === selection.sourceId);
    if (!slot) return;
    setReviewRequest(null);
    setEditingTimetableId(selection.sourceId);
    setEditingCalendarId(null);
    setComposer(null);
  };
  const closeDetail = () => {
    clearDeleteReturn();
    setEditingCalendarId(null);
    setEditingTimetableId(null);
    onSelect(null);
  };
  const deleteSelected = async () => {
    if (!selection || !isNonTaskSelection(selection) || !selection.sourceId || deleteBusy) return;
    const root = workspaceRef.current, trigger = root?.querySelector<HTMLButtonElement>("[data-calendar-delete-trigger]");
    const document = root?.ownerDocument, from = document?.activeElement || null;
    closeFocus.current = root && trigger && document && (root.contains(from) || from === document.body || from === document.documentElement)
      ? { from, document, editorKey: "", selectionKey, selectedObjectId, target: "delete" } : null;
    clearDeleteReturn();
    const returnFocus = closeFocus.current && root && document ? {
      from, document, selectionKey, selectedObjectId, kind: selection.kind, opener: detailOpener.current, completed: false, moved: false, outside: null as HTMLElement | null, stop: () => {},
    } : null;
    if (returnFocus && root && document) {
      const preserveMovedFocus = (event: FocusEvent) => {
        const target = event.target as HTMLElement | null;
        if (target === from || target === returnFocus.opener || target === document.body || target === document.documentElement || target?.closest?.(".edupi-delete-confirmation")) return;
        returnFocus.moved = true;
        returnFocus.outside = target && !root.contains(target) && !target.closest?.("[role='dialog'], [aria-modal='true']") && typeof target.focus === "function" ? target : null;
      };
      const preserveInput = (event: Event) => {
        const target = event.target as HTMLElement | null;
        if (target?.closest?.(".edupi-delete-confirmation")) return;
        returnFocus.moved = true;
        returnFocus.outside = target && !root.contains(target) && typeof target.focus === "function" ? target : null;
      };
      returnFocus.stop = () => { document.removeEventListener("focusin", preserveMovedFocus); document.removeEventListener("pointerdown", preserveInput); document.removeEventListener("keydown", preserveInput); };
      deleteReturn.current = returnFocus;
      document.addEventListener("focusin", preserveMovedFocus); document.addEventListener("pointerdown", preserveInput); document.addEventListener("keydown", preserveInput);
    }
    setDeleteBusy(true);
    try {
      const deleted = await onDeleteEntity(selection.kind, selection.sourceId, selection.title);
      if (deleted) {
        closeFocus.current = null;
        if (returnFocus && deleteReturn.current === returnFocus) returnFocus.completed = true;
        if (root?.isConnected && closeContext.current.selectionKey === selectionKey && closeContext.current.selectedObjectId === selectedObjectId) {
          setEditingCalendarId(null); setEditingTimetableId(null); onSelectItem(null);
        }
      }
    } catch {
      // The parent workspace owns the visible error message.
    } finally {
      if (returnFocus && !returnFocus.completed && deleteReturn.current === returnFocus) clearDeleteReturn();
      if (root?.isConnected) { setDeleteBusy(false); setDeleteFocusTick(value => value + 1); }
    }
  };
  const canDeleteSelection = Boolean(selection && isNonTaskSelection(selection) && selection.sourceId
    && data.capabilities.entityDelete.enabled && data.capabilities.entityDelete.targetKinds.includes(selection.kind));
  const calendarWriteReady = data.capabilities.calendar.enabled;
  const timetableWriteReady = data.capabilities.timetable.enabled;
  const appliedEditorRequest = useRef<CalendarItemSelection | null>(null);
  useEffect(() => {
    if (selection?.editRequested && appliedEditorRequest.current !== selection && selection.kind === "calendar" && selection.sourceId && calendarWriteReady
      && data.calendar.some(event => event.id === selection.sourceId)) {
      appliedEditorRequest.current = selection;
      setComposer(null);
      setEditingTimetableId(null);
      setEditingCalendarId(selection.sourceId);
    }
  }, [selection, calendarWriteReady, data.calendar]);
  const writeReason = !calendarWriteReady || !timetableWriteReady
    ? [!calendarWriteReady ? data.capabilities.calendar.reason : null, !timetableWriteReady ? data.capabilities.timetable.reason : null].filter(Boolean).join("；")
    : null;
  const drawerEditor = editingCalendarId && selection?.kind === "calendar" && selection.sourceId === editingCalendarId && editingCalendarEvent && calendarWriteReady
    ? <IntakeComposer key={`calendar:${editingCalendarId}`} embedded mode="calendar" anchorDate={anchorDate} calendarEvent={editingCalendarEvent} busy={intakeBusy} onClose={(focus, target) => closeEditor("calendar", focus, target)} onImportCalendar={onImportCalendar} onImportTimetable={onImportTimetable} />
    : editingTimetableId && selection?.kind === "timetable" && selection.sourceId === editingTimetableId && editingTimetableSlot && timetableWriteReady
      ? <IntakeComposer key={`timetable:${editingTimetableId}`} embedded mode="timetable" anchorDate={anchorDate} timetableSlot={editingTimetableSlot} busy={intakeBusy} onClose={(focus) => closeEditor("timetable", focus)} onImportCalendar={onImportCalendar} onImportTimetable={onImportTimetable} />
      : null;

  return (
    <main ref={workspaceRef} className="edupi-module-workspace edupi-calendar-workspace">
      <header className="edupi-calendar-heading">
        <div><h1 tabIndex={-1} data-calendar-heading>日程</h1><p>{itemCount} 项</p></div>
        <div className="edupi-calendar-heading__actions"><button type="button" data-calendar-create="calendar" className={composer || drawerEditor ? undefined : "is-primary"} disabled={!calendarWriteReady} title={!calendarWriteReady ? data.capabilities.calendar.reason : undefined} onClick={() => openComposer("calendar")}>新建日程</button><button type="button" data-calendar-create="timetable" disabled={!timetableWriteReady} title={!timetableWriteReady ? data.capabilities.timetable.reason : undefined} onClick={() => openComposer("timetable")}>添加课表</button><button type="button" onClick={onUpload}>上传文件</button></div>
      </header>
      {writeReason ? <p className="edupi-calendar-capability-note" role="status">{writeReason}</p> : null}
      <EduPiScheduleConflictReview enabled={data.capabilities.calendar.enabled || data.capabilities.timetable.enabled} request={!selection && !editorKey ? reviewRequest : null} scopeKey={`${selectedObjectId || ""}|${selectionKey || ""}|${editorKey || ""}`} />
      {composer ? <IntakeComposer key={`${composer}:${editingCalendarId || editingTimetableId || "new"}`} mode={composer} anchorDate={anchorDate} calendarEvent={composer === "calendar" ? editingCalendarEvent : null} timetableSlot={composer === "timetable" ? editingTimetableSlot : null} busy={intakeBusy} onClose={closeComposer} onImportCalendar={onImportCalendar} onImportTimetable={onImportTimetable} /> : null}
      <div className="edupi-calendar-content-segment edupi-segmented-control" role="group" aria-label="切换日程内容">{CONTENT_LABELS.map((item) => <button type="button" key={item.mode} className={contentMode === item.mode ? "is-active" : ""} onClick={() => { setContentMode(item.mode); setEditingCalendarId(null); setEditingTimetableId(null); onSelect(null); if (sourceEvents || sourceCourses) onObject?.("calendar:calendar"); }} aria-pressed={contentMode === item.mode}>{item.label}</button>)}</div>
      {contentMode === "timetable" && !sourceEvents && !sourceCourses ? <EduPiTimetableGrid slots={filteredTimetable} onSelect={onSelect} /> : <>
      <div className="edupi-calendar-toolbar" role="toolbar" aria-label="日程工具栏">
        <button type="button" aria-pressed={listOpen} onClick={listOpen ? closeList : openList}>{listOpen ? "日历" : "列表"}</button>
        <button type="button" className="edupi-calendar-today" onClick={() => setAnchorDate(localIsoDate())}>今天</button>
        {!sourceEvents && !completeTransactions ? <><div className="edupi-calendar-period-nav"><button type="button" onClick={() => changePeriod(-1)} aria-label="上一时段">‹</button><button type="button" onClick={() => changePeriod(1)} aria-label="下一时段">›</button></div>
          <strong className="edupi-calendar-period-title" aria-live="polite">{periodTitle(view, anchorDate)}</strong>
          <div className="edupi-calendar-view-segment edupi-segmented-control" role="group" aria-label="切换日程视图">{VIEW_LABELS.map((item) => <button type="button" key={item.mode} className={view === item.mode ? "is-active" : ""} onClick={() => setView(item.mode)} aria-pressed={view === item.mode}>{item.label}<kbd>{item.shortcut}</kbd></button>)}</div></> : <strong>{sourceHistory ? "校历历史" : sourceUpcoming ? "接下来" : completeTransactions ? "日程列表" : "校历节点"}</strong>}
      </div>
      {sourceEvents ? <EduPiPagedRows rows={sourceFacts} memoryKey={`calendar:events:${sourceHistory}:${sourceUpcoming}:${query}`} renderRow={event => <div className="edupi-task-history-row" key={event.id || event.name}><button type="button" onClick={() => onSelect({ kind: "calendar", sourceId: event.id, date: event.date, title: event.name, detail: event.notes, sourceLabel: event.source === "teacher" ? "教师" : "校历", statusLabel: event.preparationStatus === "read_only" ? "已确认" : "待确认" })}><strong>{event.name}</strong><time>{event.date ? `${event.date}${event.endDate ? ` 至 ${event.endDate}` : ""}` : "日期待确认"}</time></button></div>} /> : listOpen ? <EduPiPagedRows rows={listRows} memoryKey={`calendar:list:${sourceCourses ? `courses:${view}:${projection.range.start}:${projection.range.end}` : contentMode}:${query}`} renderRow={entry => <div key={entry.id}><time>{entry.rangeStart === entry.rangeEnd ? entry.date : `${entry.rangeStart} 至 ${entry.rangeEnd}`}</time><CalendarEntryLine entry={entry} selected={entrySelected(entry, selection)} onSelect={onSelect} onTaskDetail={openTaskDetail} /></div>} /> : <>
        {view === "month" ? <MonthView projection={projection} anchorDate={anchorDate} selection={selection} onSelectDate={selectDate} onSelect={onSelect} onTaskDetail={openTaskDetail} /> : null}
        {view === "week" ? <WeekView projection={projection} selection={selection} onSelectDate={selectDate} onSelect={onSelect} onTaskDetail={openTaskDetail} /> : null}
        {view === "day" ? <DayView projection={projection} selection={selection} onSelect={onSelect} onTaskDetail={openTaskDetail} /> : null}
      </>}
      {!sourceEvents ? <PendingInbox projection={projection} selection={selection} onSelect={onSelect} onTaskDetail={openTaskDetail} /> : null}
      </>}
      {query ? <p className="edupi-calendar-query-note" role="status">正在筛选：{query}{itemCount === 0 ? " · 没有匹配项" : ""}</p> : null}
      {selection && isNonTaskSelection(selection) ? <CalendarDetailDrawer data={data} selection={selection} onClose={closeDetail} editor={drawerEditor} openerRef={detailOpener} onEdit={selection.kind === "calendar" && calendarWriteReady && data.calendar.some((event) => event.id === selection.sourceId) ? editSelectedCalendar : selection.kind === "timetable" && timetableWriteReady && data.timetable.map(rawRecord).some((slot) => rawText(slot.slot_id ?? slot.id) === selection.sourceId) ? editSelectedTimetable : undefined} onDelete={canDeleteSelection ? () => void deleteSelected() : undefined} deleteBusy={deleteBusy} /> : null}
    </main>
  );
}
