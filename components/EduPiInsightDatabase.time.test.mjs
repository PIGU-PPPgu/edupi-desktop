import assert from "node:assert/strict";
import test from "node:test";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { createJiti } from "jiti";

const { EduPiInsightDatabase } = await createJiti(import.meta.url, {
  tsconfigPaths: true, jsx: { runtime: "automatic" },
}).import("./EduPiInsightDatabase.tsx");

const observation = (id, observedAt) => ({
  id, sourceId: `source-${id}`, sourceKind: "teacher_utterance", sourceRevision: "1",
  text: `[UI TEST] source ${id}`, contentHash: "test-hash", observedAt,
  actorRef: "test-teacher", entityIds: ["test-student"], status: "active", revision: 0,
});
const fact = (id, observationIds) => ({
  id, entityId: "test-student", kind: "error_pattern", predicate: id,
  value: `[UI TEST] fact ${id}`, subjectRef: null, topicRef: null,
  confidence: { basis: "explicit", score: 1 }, status: "accepted",
  sourceIds: [], observationIds, conflictIds: [], hasPredecessor: false, revision: 0,
});
const data = (generatedAt, facts, observations) => ({
  observations: [], continuity: { insights: [], signals: [] },
  dataSources: { insights: { present: true } },
  factSpine: {
    stateHash: "test-state", generatedAt, entities: [], observations,
    acceptedFacts: facts, factCandidates: [], hypotheses: [], conflicts: [], studentViews: [],
    teachingView: { acceptedFactIds: [], bySubject: [] }, nextLessonFactIds: [], uses: [],
  },
});
const render = value => renderToStaticMarkup(createElement(EduPiInsightDatabase, {
  data: value, query: "", selectedObjectId: "insights:learning:all",
  onEducation() {}, reviewer: "test-teacher",
}));
const dates = html => [...html.matchAll(/<time(?: [^>]*)?>([^<]*)<\/time>/g)].map(match => match[1]);

test("a snapshot refresh does not change the time of an unchanged fact", () => {
  const sources = [observation("older", "2026-10-26T12:00:00.000Z"), observation("newer", "2026-10-27T12:00:00.000Z")];
  const facts = [fact("older-fact", ["older"]), fact("newer-fact", ["newer"])];
  const before = render(data("2026-10-27T13:00:00.000Z", facts, sources));
  const after = render(data("2026-10-28T13:00:00.000Z", facts, sources));
  assert.equal(after, before);
  assert.deepEqual(dates(after), ["2026/10/27", "2026/10/26"]);
  assert.ok(after.indexOf("fact newer-fact") < after.indexOf("fact older-fact"));
});

test("fact time uses its latest linked observation and ignores unrelated newer sources", () => {
  const sources = [
    observation("older", "2026-10-26T12:00:00.000Z"),
    observation("unrelated", "2026-10-30T12:00:00.000Z"),
    observation("newer", "2026-10-27T12:00:00.000Z"),
  ];
  const html = render(data("2026-11-01T13:00:00.000Z", [fact("linked", ["newer", "older"])], sources));
  assert.deepEqual(dates(html), ["2026/10/27"]);
});

test("missing source time remains unknown instead of using the snapshot generation time", () => {
  const html = render(data("2026-11-01T13:00:00.000Z", [fact("unknown", ["not-present"])], []));
  assert.deepEqual(dates(html), ["—"]);
});

test("linked observation recency compares instants across offsets", () => {
  const sources = [
    observation("lexically-later", "2026-10-28T00:30:00+14:00"),
    observation("actually-later", "2026-10-27T22:00:00.000Z"),
  ];
  const html = render(data("2026-11-01T13:00:00.000Z", [fact("offsets", sources.map(value => value.id))], sources));
  assert.match(html, /datetime="2026-10-27T22:00:00\.000Z"/i);
  assert.match(html, /title="来源观察时间"/);
});

test("different facts sort by their actual instants and unknown times stay last", () => {
  const sources = [
    observation("older", "2026-10-28T00:30:00+14:00"),
    observation("newer", "2026-10-27T22:00:00.000Z"),
  ];
  const html = render(data("2026-11-01T13:00:00.000Z", [
    fact("unknown", []), fact("older", ["older"]), fact("newer", ["newer"]),
  ], sources));
  assert.ok(html.indexOf("fact newer") < html.indexOf("fact older"));
  assert.ok(html.indexOf("fact older") < html.indexOf("fact unknown"));
});

test("facts and insights share chronological ordering across offsets", () => {
  const input = data("2026-11-01T13:00:00.000Z", [fact("older", ["older"])], [
    observation("older", "2026-10-28T00:30:00+14:00"),
  ]);
  input.continuity.insights.push({ id: "insight-newer", content: "[UI TEST] 学情洞察 newer", status: "surfaced", confidence: 1,
    evidenceIds: [], surfacedAt: "2026-10-27T22:00:00.000Z", createdAt: "2026-10-27T22:00:00.000Z" });
  const html = render(input);
  assert.ok(html.indexOf("学情洞察 newer") < html.indexOf("fact older"));
});
