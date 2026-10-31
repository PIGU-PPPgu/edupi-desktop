import { dossierDate } from "./edupi-class-dossier";

export type DossierChartRange = "8w" | "6m" | "all";
export type DossierChartEntry = { date: string | null; label?: string };
export type DossierChartPoint = {
  key: string;
  label: string;
  fullLabel: string;
  count: number;
  from: string;
  to: string;
};
export type DossierChartSeries = {
  points: DossierChartPoint[];
  total: number;
  undated: number;
  outsideRange: number;
  unit: "week" | "month" | "year";
};

const DAY = 86_400_000;
const isoDay = (date: Date) => date.toISOString().slice(0, 10);
const dayLabel = (day: string) => `${Number(day.slice(5, 7))}/${Number(day.slice(8, 10))}`;

/** Use the recorded civil date, not the host timezone or a timestamp's UTC rollover. */
export function dossierChartDay(value: unknown): string | null {
  const parsed = dossierDate(value);
  return parsed ? parsed.date.slice(0, 10) : null;
}

function monthDate(day: string): Date {
  return new Date(`${day.slice(0, 7)}-01T00:00:00Z`);
}

function addMonth(date: Date, count: number): Date {
  return new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth() + count, 1));
}

function monthLabel(date: Date): string {
  return `${date.getUTCMonth() + 1}月`;
}

export function dossierCoverage(numerator: number, denominator: number) {
  const total = Number.isSafeInteger(denominator) && denominator > 0 ? denominator : 0;
  const count = Number.isSafeInteger(numerator) ? Math.min(total, Math.max(0, numerator)) : 0;
  return { numerator: count, denominator: total, remainder: total - count, percent: total ? Math.round(count / total * 100) : null };
}

export function buildDossierChartSeries(entries: readonly DossierChartEntry[], range: DossierChartRange, now: string): DossierChartSeries {
  const dates = entries.map(entry => dossierChartDay(entry.date));
  const undated = dates.filter(date => date === null).length;
  const valid = dates.filter((date): date is string => date !== null).sort();
  const today = dossierChartDay(now);
  const empty: DossierChartSeries = { points: [], total: 0, undated, outsideRange: valid.length, unit: range === "8w" ? "week" : "month" };
  if (!today) return empty;
  const todayTime = new Date(`${today}T00:00:00Z`).getTime();
  const points: DossierChartPoint[] = [];
  let unit: DossierChartSeries["unit"] = range === "8w" ? "week" : "month";

  if (range === "8w") {
    const weekday = new Date(todayTime).getUTCDay();
    const monday = todayTime - ((weekday + 6) % 7) * DAY;
    for (let index = 0; index < 8; index += 1) {
      const from = isoDay(new Date(monday + (index - 7) * 7 * DAY));
      const to = index === 7 ? today : isoDay(new Date(monday + ((index - 7) * 7 + 6) * DAY));
      points.push({ key: from, label: dayLabel(from), fullLabel: `${from} 至 ${to}`, from, to, count: 0 });
    }
  } else {
    const end = range === "all" && valid.at(-1) && valid.at(-1)! > today ? valid.at(-1)! : today;
    const first = range === "6m" ? addMonth(monthDate(today), -5) : monthDate(valid[0] ?? today);
    const last = monthDate(end);
    const months = (last.getUTCFullYear() - first.getUTCFullYear()) * 12 + last.getUTCMonth() - first.getUTCMonth() + 1;
    if (range === "all" && months > 24) {
      unit = "year";
      for (let year = first.getUTCFullYear(); year <= last.getUTCFullYear(); year += 1) {
        const from = `${year}-01-01`;
        const to = year === last.getUTCFullYear() ? end : `${year}-12-31`;
        points.push({ key: String(year), label: String(year), fullLabel: `${year}年`, from, to, count: 0 });
      }
    } else {
      for (let index = 0; index < months; index += 1) {
        const month = addMonth(first, index);
        const from = isoDay(month);
        const to = index === months - 1 ? end : isoDay(new Date(addMonth(month, 1).getTime() - DAY));
        const year = month.getUTCFullYear();
        points.push({ key: from.slice(0, 7), label: monthLabel(month), fullLabel: `${year}年${monthLabel(month)}`, from, to, count: 0 });
      }
    }
  }

  let outsideRange = 0;
  for (const date of valid) {
    const bucket = points.find(point => date >= point.from && date <= point.to);
    if (bucket) bucket.count += 1;
    else outsideRange += 1;
  }
  return { points, total: valid.length - outsideRange, undated, outsideRange, unit };
}

export function dossierChartMax(points: readonly Pick<DossierChartPoint, "count">[]): number {
  const max = Math.max(0, ...points.map(point => point.count));
  if (max <= 1) return 1;
  const magnitude = 10 ** Math.floor(Math.log10(max));
  return Math.ceil(max / (magnitude * 2)) * magnitude * 2;
}

export function nearestDossierPoint(clientX: number, left: number, width: number, length: number): number | null {
  if (!Number.isFinite(clientX) || !Number.isFinite(left) || !Number.isFinite(width) || width <= 0 || length < 1) return null;
  if (length === 1) return 0;
  return Math.max(0, Math.min(length - 1, Math.round((clientX - left) / width * (length - 1))));
}
