import assert from "node:assert/strict";
import test from "node:test";
import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { createJiti } from "jiti";

const { EduPiTaskStage } = await createJiti(import.meta.url, { tsconfigPaths: true,
  jsx: { runtime: "automatic" } }).import("./EduPiTaskStage.tsx");

function renderReview(task, workCase) {
  return renderToStaticMarkup(React.createElement(EduPiTaskStage, {
    task, workCase, stage: "review", workspace: "/tmp/synthetic-edupi", contextLabel: "合成班级 · 数学",
    reviewEnabled: true, reviewBlocked: false, reviewReason: "", reviewBusy: null,
    reviewMessage: null, agentSession: null, taskSessionBusy: false, taskSessionError: null,
    onReview: async () => {}, onOpenAgent: () => {}, onOpenFile: () => {}, onStage: () => {}, canPrepare: false,
  }));
}

test("G4 review edits the adjustment note without showing inert task fields", () => {
  const task = { id: "capability_task_" + "a".repeat(32), title: "课后复盘", status: "planned",
    trigger: "capability_package", revision: 1, dueDate: null, deliverables: ["下次课调整候选"],
    reviewHistory: [], evidence: { rule: "capability:lesson_reflection_internal_draft" }, externalSend: false };
  const workCase = { id: "capability_work_" + "b".repeat(32), taskId: task.id,
    kind: "capability_package", currentState: "draft_ready", externalSend: false };
  const html = renderReview(task, workCase);
  assert.match(html, /下次课调整/);
  assert.match(html, /写下要加入的调整/);
  assert.doesNotMatch(html, /<summary>修改内容<\/summary>/);
  assert.match(html, /<button[^>]*disabled[^>]*>修改后接受<\/button>/);
});

