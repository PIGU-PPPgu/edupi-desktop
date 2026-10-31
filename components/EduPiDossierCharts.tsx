"use client";

import { useId, useMemo, useState, type KeyboardEvent, type PointerEvent } from "react";
import {
  buildDossierChartSeries,
  dossierChartMax,
  dossierCoverage,
  nearestDossierPoint,
  type DossierChartEntry,
  type DossierChartRange,
} from "@/lib/edupi-dossier-charts";

const RANGE_LABELS: Record<DossierChartRange, string> = { "8w": "近8周", "6m": "近6月", all: "全部" };
const WIDTH = 320;
const HEIGHT = 124;
const LEFT = 8;
const RIGHT = 312;
const TOP = 14;
const BOTTOM = 108;
const pointX = (index: number, length: number) => length === 1 ? WIDTH / 2 : LEFT + index / (length - 1) * (RIGHT - LEFT);
const pointY = (count: number, maximum: number) => BOTTOM - count / maximum * (BOTTOM - TOP);

function currentLocalDay() {
  const now = new Date();
  return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}-${String(now.getDate()).padStart(2, "0")}`;
}

export function DossierCoverageCard({ title, numerator, denominator, numeratorLabel, remainderLabel }: {
  title: string;
  numerator: number;
  denominator: number;
  numeratorLabel: string;
  remainderLabel: string;
}) {
  const titleId = useId();
  const coverage = dossierCoverage(numerator, denominator);
  const ratio = coverage.denominator ? coverage.numerator / coverage.denominator : 0;
  return <section className="edupi-dossier-chart-card edupi-dossier-chart-coverage" aria-labelledby={titleId}>
    <header><h2 id={titleId}>{title}</h2></header>
    <strong className="edupi-dossier-chart-coverage__value">{coverage.percent === null ? "—" : <>{coverage.percent}<span>%</span></>}</strong>
    {coverage.denominator ? <>
      <div className="edupi-dossier-chart-coverage__labels"><span>{numeratorLabel}</span><span>{remainderLabel}</span></div>
      <svg className="edupi-dossier-chart-coverage__ruler" viewBox="0 0 320 40" preserveAspectRatio="none" role="img" aria-label={`${numeratorLabel} ${coverage.numerator}，${remainderLabel} ${coverage.remainder}，合计 ${coverage.denominator}`}>
        <title>{`${coverage.percent}% · ${coverage.numerator} / ${coverage.denominator}`}</title>
        {Array.from({ length: 81 }, (_, index) => <line key={index} x1={index * 4} x2={index * 4} y1={index % 5 === 0 ? 4 : 10} y2={36} className="edupi-dossier-chart-coverage__tick" />)}
        <rect key={`${coverage.numerator}:${coverage.denominator}`} x="0" y="0" width={320 * ratio} height="40" rx="3" className="edupi-dossier-chart-coverage__fill" />
      </svg>
      <div className="edupi-dossier-chart-coverage__counts"><span>{coverage.numerator}</span><span>{coverage.remainder}</span></div>
    </> : <p className="edupi-dossier-chart-empty">暂无可统计记录</p>}
  </section>;
}

export function DossierTrendCard({ title, entries, now }: { title: string; entries: DossierChartEntry[]; now?: string }) {
  const titleId = useId();
  const effectiveDay = now ?? currentLocalDay();
  const [range, setRange] = useState<DossierChartRange>("8w");
  const series = useMemo(() => buildDossierChartSeries(entries, range, effectiveDay), [entries, effectiveDay, range]);
  const seriesKey = `${range}:${series.points.map(point => `${point.key}:${point.count}`).join(";")}`;
  const [selected, setSelected] = useState<{ key: string; index: number | null }>({ key: "", index: null });
  const activeIndex = selected.key === seriesKey && selected.index !== null && selected.index < series.points.length ? selected.index : null;
  const active = activeIndex === null ? null : series.points[activeIndex];
  const maximum = dossierChartMax(series.points);
  const line = series.points.map((point, index) => `${index ? "L" : "M"}${pointX(index, series.points.length).toFixed(2)},${pointY(point.count, maximum).toFixed(2)}`).join(" ");
  const lastIndex = series.points.length - 1;
  const axisIndices = series.points.length <= 6 ? series.points.map((_, index) => index) : [...new Set([0, Math.round(lastIndex / 3), Math.round(lastIndex * 2 / 3), lastIndex])];
  const choose = (index: number | null) => setSelected({ key: seriesKey, index });
  const onPointerMove = (event: PointerEvent<SVGSVGElement>) => {
    const rect = event.currentTarget.getBoundingClientRect();
    const index = nearestDossierPoint(event.clientX, rect.left + LEFT / WIDTH * rect.width, (RIGHT - LEFT) / WIDTH * rect.width, series.points.length);
    choose(index);
  };
  const onKeyDown = (event: KeyboardEvent<SVGSVGElement>) => {
    if (!["ArrowLeft", "ArrowRight", "Home", "End", "Escape"].includes(event.key)) return;
    event.preventDefault();
    if (event.key === "Escape") choose(null);
    else if (event.key === "Home") choose(0);
    else if (event.key === "End") choose(lastIndex);
    else if (event.key === "ArrowLeft") choose(activeIndex === null ? lastIndex : Math.max(0, activeIndex - 1));
    else choose(activeIndex === null ? 0 : Math.min(lastIndex, activeIndex + 1));
  };

  return <section className="edupi-dossier-chart-card edupi-dossier-chart-trend" aria-labelledby={titleId}>
    <header><h2 id={titleId}>{title}</h2><label><span className="edupi-dossier-chart-sr-only">{title}时间范围</span><select aria-label={`${title}时间范围`} value={range} onChange={event => setRange(event.target.value as DossierChartRange)}>{Object.entries(RANGE_LABELS).map(([value, label]) => <option key={value} value={value}>{label}</option>)}</select></label></header>
    {series.total ? <>
      <figure className="edupi-dossier-chart-trend__figure">
        <div className="edupi-dossier-chart-trend__plot">
          <div className="edupi-dossier-chart-trend__y" aria-hidden="true"><span>{maximum}</span><span>{maximum > 1 ? Math.ceil(maximum / 2) : ""}</span><span>0</span></div>
          <svg viewBox={`0 0 ${WIDTH} ${HEIGHT}`} preserveAspectRatio="none" tabIndex={0} role="img" aria-label={`${title}，${RANGE_LABELS[range]}共 ${series.total} 条记录，使用左右方向键查看各时段`} onPointerMove={onPointerMove} onPointerLeave={event => { if (event.currentTarget.ownerDocument.activeElement !== event.currentTarget) choose(null); }} onFocus={() => choose(lastIndex)} onBlur={() => choose(null)} onKeyDown={onKeyDown}>
            <title>{`${title} · ${RANGE_LABELS[range]} · ${series.total} 条记录`}</title>
            {[TOP, (TOP + BOTTOM) / 2, BOTTOM].map(y => <line key={y} x1={LEFT} x2={RIGHT} y1={y} y2={y} className="edupi-dossier-chart-trend__grid" />)}
            {series.points.map((point, index) => <line key={point.key} x1={pointX(index, series.points.length)} x2={pointX(index, series.points.length)} y1={TOP} y2={BOTTOM} className="edupi-dossier-chart-trend__grid" />)}
            <path key={seriesKey} d={line} pathLength="1" className="edupi-dossier-chart-trend__line" fill="none" vectorEffect="non-scaling-stroke" />
            {series.points.length === 1 ? <circle cx={WIDTH / 2} cy={pointY(series.points[0].count, maximum)} r="3" className="edupi-dossier-chart-trend__single" /> : null}
            {active && activeIndex !== null ? <g className="edupi-dossier-chart-trend__active"><line x1={pointX(activeIndex, series.points.length)} x2={pointX(activeIndex, series.points.length)} y1={TOP} y2={BOTTOM} /><circle cx={pointX(activeIndex, series.points.length)} cy={pointY(active.count, maximum)} r="6" className="edupi-dossier-chart-trend__halo" /><circle cx={pointX(activeIndex, series.points.length)} cy={pointY(active.count, maximum)} r="3" /></g> : null}
          </svg>
          {active && activeIndex !== null ? <figcaption className="edupi-dossier-chart-trend__tooltip" style={{ left: `clamp(80px, ${pointX(activeIndex, series.points.length) / WIDTH * 100}%, calc(100% - 80px))` }}><span>{active.fullLabel}</span><strong>{active.count} 条记录</strong></figcaption> : null}
        </div>
        <div className="edupi-dossier-chart-trend__x" aria-hidden="true">{axisIndices.map(index => <span key={series.points[index].key} className={index === 0 && lastIndex > 0 ? "is-first" : index === lastIndex && lastIndex > 0 ? "is-last" : ""} style={{ left: `${pointX(index, series.points.length) / WIDTH * 100}%` }}>{series.points[index].label}</span>)}</div>
      </figure>
      <output className="edupi-dossier-chart-sr-only" aria-live="polite">{active ? `${active.fullLabel}，${active.count} 条记录` : ""}</output>
      <table className="edupi-dossier-chart-sr-only"><caption>{title} · {RANGE_LABELS[range]}</caption><thead><tr><th scope="col">时段</th><th scope="col">记录数</th></tr></thead><tbody>{series.points.map(point => <tr key={point.key}><th scope="row">{point.fullLabel}</th><td>{point.count}</td></tr>)}</tbody></table>
    </> : <p className="edupi-dossier-chart-empty">此时段暂无记录</p>}
    {series.undated > 0 ? <p className="edupi-dossier-chart-note">另有 {series.undated} 条日期待核</p> : null}
  </section>;
}

export function DossierMiniActivity({ entries, now }: { entries: Array<{ date: string | null }>; now?: string }) {
  const titleId = useId();
  const effectiveDay = now ?? currentLocalDay();
  const series = useMemo(() => buildDossierChartSeries(entries, "8w", effectiveDay), [entries, effectiveDay]);
  const maximum = dossierChartMax(series.points);
  const [active, setActive] = useState<string | null>(null);
  const selected = series.points.find(point => point.key === active);
  return <section className="edupi-dossier-chart-mini" aria-labelledby={titleId}>
    <header><div><h3 id={titleId}>近期记录</h3><span>近8周</span></div>{series.total ? <strong>{series.total}<span> 条</span></strong> : null}</header>
    {series.total ? <>
      <div className="edupi-dossier-chart-mini__bars" role="group" aria-label="每周档案记录数">{series.points.map(point => <button type="button" key={point.key} aria-label={`${point.fullLabel}，${point.count} 条记录`} onPointerEnter={() => setActive(point.key)} onPointerLeave={event => { if (event.currentTarget.ownerDocument.activeElement !== event.currentTarget) setActive(null); }} onFocus={() => setActive(point.key)} onBlur={() => setActive(null)}>
        <span className="edupi-dossier-chart-mini__track"><span key={`${point.key}:${point.count}`} className={point.count ? "edupi-dossier-chart-mini__bar" : "edupi-dossier-chart-mini__zero"} style={{ height: `${point.count / maximum * 100}%` }} /></span>
      </button>)}</div>
      <div className="edupi-dossier-chart-mini__dates" aria-hidden="true"><span>{series.points[0]?.label}</span><span>{series.points.at(-1)?.label}</span></div>
      <output className="edupi-dossier-chart-mini__readout" aria-live="polite">{selected ? `${selected.label} · ${selected.count} 条` : ""}</output>
    </> : <p className="edupi-dossier-chart-empty">暂无有日期记录</p>}
  </section>;
}
