import assert from "node:assert/strict";
import fs from "node:fs";
import test from "node:test";

function readSource(relativePath) {
  const url = new URL(relativePath, import.meta.url);
  return fs.existsSync(url) ? fs.readFileSync(url, "utf8") : "";
}

const contractSource = readSource("../lib/edupi-education-contract.ts");
const panelSource = readSource("./EduPiEducationPanel.tsx");
const workspaceViewsSource = readSource("./EduPiWorkspaceViews.tsx");
const reviewCardSource = readSource("./EduPiReviewTaskCard.tsx");
const inspectorSource = readSource("./EduPiInspector.tsx");
const railSource = readSource("./EduPiNavigationRail.tsx");
const dedicatedReviewSource = readSource("./EduPiC1Review.tsx");
const reviewSurfaceSource = dedicatedReviewSource || reviewCardSource || panelSource;
const uiSource = [panelSource, workspaceViewsSource, reviewCardSource, inspectorSource, railSource, dedicatedReviewSource].join("\n");

test("the education contract projects C1 observations, memory candidates, and bounded receipt history", () => {
  assert.match(contractSource, /observations/);
  assert.match(contractSource, /memoryCandidates/);
  assert.match(contractSource, /receipts/);
  assert.match(contractSource, /reviewHistory/);
  assert.match(contractSource, /capabilities/);
  assert.match(contractSource, /review_observation/);
  assert.match(contractSource, /review_memory_candidate/);
  assert.match(contractSource, /externalSend|external_send/);
});

test("待我确认 renders a content-first C1 queue with provenance, uncertainty, four decisions, and feedback", () => {
  assert.match(uiSource, /待我确认/);
  assert.match(uiSource, /来源|source/);
  assert.match(uiSource, /证据|evidence/);
  assert.match(uiSource, /不确定|uncertainty|候选|candidate_only/);
  for (const decision of ["accept", "modify", "reject", "hold"]) assert.match(uiSource, new RegExp(decision));
  for (const label of ["接受", "修改", "拒绝", "暂缓"]) assert.match(uiSource, new RegExp(label));
  assert.match(uiSource, /busy|pending|处理中/);
  assert.match(uiSource, /error|失败|错误/);
  assert.match(uiSource, /receipt|回执/);
  assert.match(uiSource, /review_observation/);
  assert.match(uiSource, /review_memory_candidate/);
});

test("C1 review controls are capability-gated, non-optimistic, and refresh only after a receipt", () => {
  assert.match(uiSource, /disabled\s*=\s*\{[^}]*review|disabled\s*=\s*\{[^}]*capab/i);
  assert.match(uiSource, /\/api\/edupi\/reviews/);
  assert.match(uiSource, /method\s*:\s*["']POST["']/);
  assert.match(uiSource, /response\.ok/);
  assert.match(uiSource, /await\s+[^;]*(?:json|receipt)/i);
  assert.match(uiSource, /loadWorkspace|refresh(?:Snapshot|Workspace|Data)|refreshKey/);
  assert.match(uiSource, /receipt/);
  assert.match(uiSource, /externalSend\s*[:=]\s*false|external_send/);
});

test("C1 does not require review_task, context, or import capabilities, and rejected candidates stay out of active memory", () => {
  assert.match(reviewSurfaceSource, /memoryCandidates|memory_candidates/);
  assert.match(reviewSurfaceSource, /rejected|candidate_only/);
  assert.match(reviewSurfaceSource, /memories|active/);
  assert.doesNotMatch(reviewSurfaceSource, /review_task|review_teacher_context|import_calendar|import_timetable|intake_material/);
});
