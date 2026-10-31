import assert from "node:assert/strict";
import test from "node:test";
import React from "react";
import TestRenderer, { act } from "react-test-renderer";
import { renderToStaticMarkup } from "react-dom/server";
import { createJiti } from "jiti";

const { EduPiTaskStage } = await createJiti(import.meta.url, { tsconfigPaths: true,
  jsx: { runtime: "automatic" } }).import("./EduPiTaskStage.tsx");
globalThis.IS_REACT_ACT_ENVIRONMENT = true;

function reviewProps(task, workCase) {
  return {
    task, workCase, stage: "review", workspace: "/tmp/synthetic-edupi", contextLabel: "合成班级 · 数学",
    reviewEnabled: true, reviewBlocked: false, reviewReason: "", reviewBusy: null,
    reviewMessage: null, agentSession: null, taskSessionBusy: false, taskSessionError: null,
    onReview: async () => {}, onOpenAgent: () => {}, onOpenFile: () => {}, onStage: () => {}, canPrepare: false,
  };
}

function renderReview(task, workCase) {
  return renderToStaticMarkup(React.createElement(EduPiTaskStage, reviewProps(task, workCase)));
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

test("G4 adjustment text enables and submits the current review_task modification", async () => {
  const task = { id: "capability_task_" + "c".repeat(32), title: "课后复盘", status: "planned",
    trigger: "capability_package", revision: 1, dueDate: null, deliverables: ["下次课调整候选"],
    reviewHistory: [], evidence: { rule: "capability:lesson_reflection_internal_draft" }, externalSend: false };
  const workCase = { id: "capability_work_" + "d".repeat(32), taskId: task.id,
    kind: "capability_package", currentState: "draft_ready", externalSend: false };
  const submissions = [];
  let renderer;
  try {
    await act(async () => { renderer = TestRenderer.create(React.createElement(EduPiTaskStage,
      { ...reviewProps(task, workCase), onReview: async (...args) => submissions.push(args) })); });
    const button = () => renderer.root.findAllByType("button").find(item => item.props.children === "修改后接受");
    assert.equal(button().props.disabled, true);
    const field = renderer.root.findByProps({ placeholder: "写下要加入的调整" });
    await act(async () => { field.props.onChange({ target: { value: "下节课增加分组互评" } }); });
    assert.equal(button().props.disabled, false);
    await act(async () => { button().props.onClick(); });
    assert.deepEqual(submissions, [["modify", { note: "下节课增加分组互评", title: task.title,
      dueDate: undefined, deliverables: task.deliverables }]]);
  } finally {
    if (renderer) await act(async () => renderer.unmount());
  }
});

