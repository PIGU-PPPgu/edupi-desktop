import assert from "node:assert/strict";
import test from "node:test";
import { createJiti } from "jiti";
import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { parseHTML } from "linkedom";

const jiti = createJiti(import.meta.url, { jsx: { runtime: "automatic" }, tsconfigPaths: true });
const { buildDossierChartSeries, dossierChartDay, dossierCoverage, dossierChartMax, nearestDossierPoint } = await jiti.import("./edupi-dossier-charts.ts");
const rows = dates => dates.map(date => ({ date }));

test("calendar dates do not shift when timestamp offsets cross a UTC day", () => {
  assert.equal(dossierChartDay("2026-01-01T23:30:00-08:00"), "2026-01-01");
  assert.equal(dossierChartDay("2026-01-01T00:30:00+08:00"), "2026-01-01");
  for (const bad of [null, "", "2026-02-30", "2026-13-01", "2026-01-01Tinvalid", "January 1"]) assert.equal(dossierChartDay(bad), null);
});

test("eight calendar weeks include the current partial week and exclude earlier and future dates", () => {
  const result = buildDossierChartSeries(rows(["2026-09-07", "2026-10-31", "2026-11-01", "2026-09-06", "2026-11-02"]), "8w", "2026-11-01");
  assert.equal(result.points.length, 8);
  assert.deepEqual([result.points[0].from, result.points.at(-1).from, result.points.at(-1).to], ["2026-09-07", "2026-10-26", "2026-11-01"]);
  assert.equal(result.points.at(-1).count, 2);
  assert.equal(result.total, 3);
  assert.equal(result.outsideRange, 2);
});

test("six calendar months cross years without rolling short months into another month", () => {
  const result = buildDossierChartSeries(rows(["2025-10-31", "2026-02-28", "2026-03-31", "2025-09-30", "2026-04-01"]), "6m", "2026-03-31");
  assert.deepEqual(result.points.map(point => point.key), ["2025-10", "2025-11", "2025-12", "2026-01", "2026-02", "2026-03"]);
  assert.equal(result.points[4].to, "2026-02-28");
  assert.equal(result.total, 3);
  assert.equal(result.outsideRange, 2);
});

test("same-day records accumulate, undated records stay outside the curve, and sparse windows are honest", () => {
  const result = buildDossierChartSeries(rows(["2026-11-01", "2026-11-01T12:00:00+08:00", null, "not a date"]), "8w", "2026-11-01");
  assert.equal(result.total, 2);
  assert.equal(result.undated, 2);
  assert.equal(result.points.at(-1).count, 2);
  const empty = buildDossierChartSeries([], "8w", "2026-11-01");
  assert.equal(empty.total, 0);
  assert.ok(empty.points.every(point => point.count === 0));
  assert.equal(buildDossierChartSeries(rows(["2026-11-01"]), "all", "invalid").points.length, 0);
});

test("all-time windows preserve a single month and use annual buckets for long histories", () => {
  const single = buildDossierChartSeries(rows(["2026-11-01"]), "all", "2026-11-01");
  assert.equal(single.points.length, 1);
  assert.equal(single.points[0].count, 1);
  const result = buildDossierChartSeries(rows(["2022-12-20", "2026-11-01", "2027-02-03"]), "all", "2026-11-01");
  assert.equal(result.unit, "year");
  assert.deepEqual(result.points.map(point => point.label), ["2022", "2023", "2024", "2025", "2026", "2027"]);
  assert.equal(result.total, 3);
});

test("coverage distinguishes an absent denominator from zero recorded members", () => {
  assert.deepEqual(dossierCoverage(0, 0), { numerator: 0, denominator: 0, remainder: 0, percent: null });
  assert.equal(dossierCoverage(0, 20).percent, 0);
  assert.deepEqual(dossierCoverage(40, 20), { numerator: 20, denominator: 20, remainder: 0, percent: 100 });
  assert.equal(dossierCoverage(4.5, 10).numerator, 0);
  assert.equal(dossierCoverage(4, NaN).percent, null);
});

test("pointer positions are relative to actual plot width and remain bounded", () => {
  assert.equal(nearestDossierPoint(350, 200, 300, 7), 3);
  assert.equal(nearestDossierPoint(-100, 200, 300, 7), 0);
  assert.equal(nearestDossierPoint(900, 200, 300, 7), 6);
  assert.equal(nearestDossierPoint(250, 200, 300, 1), 0);
  assert.equal(nearestDossierPoint(250, 200, 0, 8), null);
  assert.equal(nearestDossierPoint(250, 200, 300, 0), null);
  assert.equal(dossierChartMax([{ count: 11 }]), 20);
  assert.equal(dossierChartMax([]), 1);
});

test("rendered chart summaries expose real counts and no-data states without React warnings", async () => {
  const { DossierCoverageCard, DossierTrendCard } = await jiti.import("../components/EduPiDossierCharts.tsx");
  const errors=[];const prior=console.error;console.error=(...args)=>errors.push(args);
  try {
    const coverage=renderToStaticMarkup(React.createElement(DossierCoverageCard,{title:"档案积累",numerator:2,denominator:4,numeratorLabel:"已有内容",remainderLabel:"仅名单"}));
    const coverageDoc=parseHTML(coverage).document;
    assert.equal(coverageDoc.querySelector("svg title").textContent,"50% · 2 / 4");
    const absent=renderToStaticMarkup(React.createElement(DossierCoverageCard,{title:"档案积累",numerator:0,denominator:0,numeratorLabel:"已有内容",remainderLabel:"仅名单"}));
    assert.match(absent,/暂无可统计记录/);
    assert.doesNotMatch(absent,/0%/);
    const curve=renderToStaticMarkup(React.createElement(DossierTrendCard,{title:"成长记录",entries:rows(["2026-11-01","2026-11-01",null]),now:"2026-11-01"}));
    const curveDoc=parseHTML(curve).document;
    assert.equal([...curveDoc.querySelectorAll("tbody td")].reduce((sum,node)=>sum+Number(node.textContent),0),2);
    assert.match(curveDoc.querySelector("svg").getAttribute("aria-label"),/左右方向键/);
    assert.match(curve,/另有.*1.*条日期待核/);
    const empty=renderToStaticMarkup(React.createElement(DossierTrendCard,{title:"成长记录",entries:rows([null]),now:"2026-11-01"}));
    assert.match(empty,/此时段暂无记录/);
    assert.equal(parseHTML(empty).document.querySelector("svg"),null);
    assert.equal(errors.length,0);
  } finally { console.error=prior; }
});
