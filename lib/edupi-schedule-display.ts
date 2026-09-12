const TIME_ZONE = "Asia/Shanghai";

export type EduPiSchedule = {
  id: string;
  label: string;
  type: "daily" | "weekly" | "hourly";
  weekday?: number;
  hour?: number;
  minute: number;
};

// Keep this display-only list aligned with Core scripts/scheduler_core.mjs.
export const EDUPI_SCHEDULES: readonly EduPiSchedule[] = [
  { id: "morning_brief", label: "早安简报", type: "daily", hour: 7, minute: 30 },
  { id: "rhythm", label: "校历节奏", type: "daily", hour: 7, minute: 35 },
  { id: "education_info", label: "教育资讯", type: "daily", hour: 8, minute: 0 },
  { id: "dream", label: "夜间整理", type: "daily", hour: 23, minute: 0 },
  { id: "proactive_engine", label: "主动检查", type: "hourly", minute: 0 },
  { id: "calendar_work", label: "课程准备检查", type: "hourly", minute: 5 },
  { id: "weekly_report", label: "周报", type: "weekly", weekday: 5, hour: 18, minute: 0 },
  { id: "cross_period_analysis", label: "跨期分析", type: "weekly", weekday: 0, hour: 20, minute: 0 },
];

function parts(date: Date): { weekday: number; hour: number; minute: number } {
  const values = new Intl.DateTimeFormat("en-US", {
    timeZone: TIME_ZONE,
    weekday: "short",
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23",
  }).formatToParts(date);
  const get = (type: string) => values.find(item => item.type === type)?.value || "";
  const weekdays: Record<string, number> = { Sun: 0, Mon: 1, Tue: 2, Wed: 3, Thu: 4, Fri: 5, Sat: 6 };
  return { weekday: weekdays[get("weekday")] ?? 0, hour: Number(get("hour")), minute: Number(get("minute")) };
}

function matches(schedule: EduPiSchedule, value: { weekday: number; hour: number; minute: number }): boolean {
  if (schedule.type === "hourly") return value.minute === schedule.minute;
  if (value.hour !== schedule.hour || value.minute !== schedule.minute) return false;
  return schedule.type !== "weekly" || value.weekday === schedule.weekday;
}

export function nextScheduledRun(now = new Date()): { schedule: EduPiSchedule; at: Date } {
  for (let offset = 1; offset <= 8 * 24 * 60; offset += 1) {
    const candidate = new Date(now.getTime() + offset * 60_000);
    const value = parts(candidate);
    const schedule = EDUPI_SCHEDULES.find(item => matches(item, value));
    if (schedule) return { schedule, at: candidate };
  }
  throw new Error("没有可用的 EduPi 调度计划");
}

export function formatNextScheduledRun(now = new Date()): string {
  const next = nextScheduledRun(now);
  return `下次${next.schedule.label} ${new Intl.DateTimeFormat("zh-CN", { timeZone: TIME_ZONE, month: "numeric", day: "numeric", hour: "2-digit", minute: "2-digit" }).format(next.at)}`;
}
