import assert from "node:assert/strict";
import test from "node:test";
import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { readFile } from "node:fs/promises";
import { createJiti } from "jiti";

const jiti = createJiti(import.meta.url, {
  jsx: { runtime: "automatic" },
  tsconfigPaths: true,
});

const { EduPiTaskWorkspace } = await jiti.import("./EduPiTaskWorkspace.tsx");
const { isTaskReviewable } = await jiti.import("../lib/edupi-work-case.ts");

const [workspace, sider, taskWorkspace, taskStage, panel] = await Promise.all([
  readFile(new URL("./EduPiTeachingWorkspace.tsx", import.meta.url), "utf8"),
  readFile(new URL("./EduPiObjectSider.tsx", import.meta.url), "utf8"),
  readFile(new URL("./EduPiTaskWorkspace.tsx", import.meta.url), "utf8"),
  readFile(new URL("./EduPiTaskStage.tsx", import.meta.url), "utf8"),
  readFile(new URL("./EduPiEducationPanel.tsx", import.meta.url), "utf8"),
]);

test("teaching home is driven by Core before-class tasks and work cases", () => {
  assert.match(workspace, /task\.trigger === "teaching_before_class"/);
  assert.match(workspace, /workCase\.kind === "teaching_before_class"/);
  assert.match(workspace, /workCaseForTask\(data, task\.id\)/);
  assert.match(workspace, /本周课前准备/);
  assert.match(workspace, /task\.evidence\.source_summary/);
  assert.match(workspace, /weekPreparationIds\.has\(workCase\.taskId\)/);
  assert.match(workspace, /isTaskReviewable\(task, workCase\)/);
  assert.match(workspace, /teachingPreparationSummary\(task\)/);
  assert.match(sider, /task\.trigger === "teaching_before_class"/);
});

test("teaching task detail uses the same Core work case and distinguishes class date from deadline", () => {
  assert.match(panel, /workCase=\{workCaseForTask\(education, activeTask\.id\)\}/);
  assert.match(taskWorkspace, /workCaseStateLabel\(props\.workCase\.currentState\)/);
  assert.match(taskWorkspace, /`上课 \$\{props\.task\.sourceEventDate\}/);
  assert.match(taskWorkspace, /` · 截止 \$\{props\.task\.dueDate\}`/);
  assert.match(taskWorkspace, /isTaskReviewable\(props\.task, props\.workCase\)/);
  assert.match(taskStage, /disabled=\{!reviewable\}/);
  assert.match(taskStage, /reviewable \? "进入审核" : "等待产物"/);
});

test("next-lesson preparation opens the existing task flow and never fabricates completion", () => {
  assert.match(workspace, /nextTeachingTask \? onTask\(nextTeachingTask\)/);
  assert.match(workspace, /workCaseStateLabel/);
  assert.doesNotMatch(workspace, /setInterval|setTimeout|Math\.random|localStorage/);
});

const task = {
  id: "teaching-task-1",
  title: "第1周 · 数学 · 703 · 第2节课前准备",
  trigger: "teaching_before_class",
  status: "planned",
  contentStatus: "ready",
  sourceEventId: "timetable:slot-1:2026-09-02",
  sourceEventName: "第2节数学",
  sourceEventDate: "2026-09-02",
  dueDate: "2026-09-01",
  deliverables: ["课堂讲义"],
  audience: ["teacher"],
  requiresTeacherReview: true,
  externalSend: false,
  scope: "teacher_internal",
  student: null,
  studentEventType: null,
  materialId: null,
  materialKind: null,
  topic: "一次函数",
  revision: 0,
  reviewedAt: null,
  reviewer: null,
  reviewNote: null,
  reviewHistory: [],
  evidence: { source_summary: "课表：第2节数学" },
  boardStage: null,
  boardRevision: 0,
  boardUpdatedAt: null,
};

const workCase = (artifactIds) => ({
  id: "work_case_44444444444444444444444444444444",
  kind: "teaching_before_class",
  triggerId: task.sourceEventId,
  taskId: task.id,
  title: task.title,
  currentState: "draft_ready",
  dueDate: task.dueDate,
  executionRevision: 1,
  artifactRevision: artifactIds.length ? 1 : 0,
  transitionRevision: 0,
  sourceIds: [task.sourceEventId],
  artifactIds,
  transitions: [],
  externalSend: false,
});

function renderTaskWorkspace(boundWorkCase, stage = "review") {
  return renderToStaticMarkup(React.createElement(EduPiTaskWorkspace, {
    task,
    workCase: boundWorkCase,
    stage,
    workspace: "/workspace",
    context: null,
    reviewEnabled: true,
    reviewReason: "Core review enabled",
    reviewBusy: null,
    reviewMessage: null,
    agentSession: null,
    taskSessionBusy: false,
    taskSessionError: null,
    onStage() {},
    async onReview() {},
    onOpenAgent() {},
    onOpenFile() {},
  }));
}

test("blocks review navigation and teacher actions until Core and projected artifacts exist", () => {
  const html = renderTaskWorkspace(workCase([]));
  assert.equal(isTaskReviewable(task, workCase([])), false);
  assert.match(html, /data-stage="review"[^>]*disabled/);
  assert.match(html, /等待产物/);
  assert.doesNotMatch(html, /aria-label="教师审核动作"/);
  assert.doesNotMatch(html, />接受<\/button>/);
  assert.match(renderTaskWorkspace(workCase([]), "artifact"), /<button[^>]*disabled[^>]*>等待产物<\/button>/);
});

test("enables review navigation and teacher actions only for a fully evidenced work case", () => {
  const html = renderTaskWorkspace(workCase(["artifact-1"]));
  assert.equal(isTaskReviewable(task, workCase(["artifact-1"])), true);
  assert.doesNotMatch(html, /data-stage="review"[^>]*disabled/);
  assert.match(html, /aria-label="教师审核动作"/);
  assert.match(html, />接受<\/button>/);
});
