import assert from "node:assert/strict";
import test from "node:test";
import { readFile } from "node:fs/promises";
import { createJiti } from "jiti";
import { renderToStaticMarkup } from "react-dom/server";
import { createElement } from "react";
import TestRenderer, { act } from "react-test-renderer";

const jiti = createJiti(import.meta.url, { jsx: { runtime: "automatic" }, tsconfigPaths: true });
const { EduPiRuntimeFlow } = await jiti.import("./EduPiRuntimeFlow.tsx");
const { EduPiTaskRunContext } = await jiti.import("./EduPiTaskRunContext.tsx");
const { buildEducationContract } = await jiti.import("../lib/edupi-education-contract.ts");
const { taskPreparedArtifacts } = await jiti.import("../lib/edupi-task-artifacts.ts");
const idle = { running: false, toolRunning: false, compacting: false };
const task = buildEducationContract({ tasks: [{ id: "task-1", title: "合成备课任务", status: "planned", content_status: "draft_ready", deliverables: ["教案", "练习", "答案"] }] }).tasks[0];
const workCase = { id: "case-1", taskId: task.id, currentState: "draft_ready", artifacts: [] };
const runInfo = overrides => ({ sessionId: "session-1", task, workCase, artifacts: [], unavailable: false, artifactsUnavailable: false, onOpen() {}, ...overrides });
const render = (props = {}, value = null) => renderToStaticMarkup(createElement(EduPiTaskRunContext.Provider, { value }, createElement(EduPiRuntimeFlow, { ...idle, ...props })));

test("runtime flow is absent when idle and reflects actual flags", () => {
  assert.equal(render(), "");
  assert.match(render({ running: true }), /处理中/);
  assert.match(render({ toolRunning: true }), />正在执行<\/span>/);
  assert.match(render({ running: true, activeTools: ["read", "write"] }), /edupi-workflow-view__quiet/);
  assert.equal(render({ activeTools: ["read"] }), "");
  assert.match(render({ compacting: true }), /整理对话/);
});

test("observed Pi tools become a collapsible graph without exposing command arguments", () => {
  const messages = [{ role: "user", content: "准备资源" },
    { role: "assistant", content: [{ type: "toolCall", toolCallId: "read-1", toolName: "read", input: { path: "/private/synthetic" } },
      { type: "toolCall", toolCallId: "write-1", toolName: "write", input: { path: "/private/synthetic" } }] },
    { role: "toolResult", toolCallId: "read-1", content: [] }];
  const html = render({ running: true, messages });
  assert.match(html, /aria-label="本轮执行阶段"/);
  assert.match(html, /1\/2 项操作/);
  assert.match(html, /读取/);
  assert.match(html, /写入文件/);
  assert.match(html, /执行中/);
  assert.doesNotMatch(html, /\/private\/synthetic/);
});

test("task cards require the current session even while a previous context remains mounted", () => {
  const info = runInfo();
  for (const sessionId of ["session-2", undefined, ""]) {
    assert.equal(render({ sessionId }, info), "");
    const live = render({ sessionId, running: true }, info);
    assert.match(live, /edupi-workflow-view__quiet/);
    assert.match(live, /处理中/);
    assert.doesNotMatch(live, /合成备课任务|edupi-task-run-card|<button/);
  }
  assert.match(render({ sessionId: info.sessionId }, info), /合成备课任务/);
});

test("bound tasks show live activity and return to their real idle state", () => {
  const info = runInfo();
  const props = { sessionId: info.sessionId };
  for (const [flags, label] of [
    [{ running: true }, "正在协作"],
    [{ toolRunning: true }, "正在执行"],
    [{ running: true, activeTools: ["read"] }, "正在执行"],
    [{ running: true, toolRunning: true, compacting: true, activeTools: ["read"] }, "整理对话"],
  ]) {
    const html = render({ ...props, ...flags }, info);
    assert.match(html, /class="edupi-task-run-card edupi-runtime-flow"/);
    assert.ok(html.includes(label));
    assert.doesNotMatch(html, /已接受|已完成|100%|progressbar|aria-valuenow|第\s*\d+\s*步|子代理/);
  }
  const settled = render(props, info);
  assert.match(settled, /class="edupi-task-run-card"/);
  assert.match(settled, /待你确认/);
  assert.doesNotMatch(settled, /edupi-runtime-flow|正在协作|已接受|已完成|%/);
  const completed = render(props, runInfo({ workCase: { ...workCase, currentState: "completed" } }));
  assert.match(completed, /执行完成/);
  assert.doesNotMatch(completed, /已接受|已确认/);
});

test("raw tool names appear only in the current activity tooltip", () => {
  const info = runInfo();
  const props = { sessionId: info.sessionId, activeTools: ["read", "teacher_core_bridge"] };
  const live = render({ ...props, running: true }, info);
  assert.match(live, /class="edupi-task-run-card__status" title="执行工具：read、teacher_core_bridge">正在执行<\/span>/);
  assert.doesNotMatch(live, />[^<]*teacher_core_bridge[^<]*</);
  for (const flags of [{}, { compacting: true }]) {
    const html = render({ ...props, ...flags }, info);
    assert.doesNotMatch(html, /执行工具|teacher_core_bridge/);
  }
});

test("teacher hold and rejection survive stale execution and board snapshots", () => {
  for (const [status, label] of [["hold", "已暂缓"], ["rejected", "已拒绝"]]) {
    const html = render({ sessionId: "session-1" }, runInfo({ task: { ...task, status, boardStage: "done" } }));
    assert.ok(html.includes(label));
    assert.doesNotMatch(html, /待你确认|已准备|已完成/);
  }
  const unrelatedCase = render({ sessionId: "session-1" }, runInfo({ workCase: { ...workCase, taskId: "task-2", currentState: "failed" } }));
  assert.match(unrelatedCase, /待你确认/);
  assert.doesNotMatch(unrelatedCase, /准备失败/);
});

test("unavailable task and file state stays visible and never becomes an empty file count", () => {
  for (const artifacts of [[], [{ id: "file-1", title: "已知文件", path: "/workspace/lesson.md", available: true, readOnly: false }]]) {
    const filesFailed = render({ sessionId: "session-1" }, runInfo({ artifacts, artifactsUnavailable: true }));
    assert.match(filesFailed, /文件列表暂不可用/);
    assert.doesNotMatch(filesFailed, /\d+ 份文件/);
    for (const running of [false, true]) {
      const stateFailed = render({ sessionId: "session-1", running }, runInfo({ artifacts, unavailable: true }));
      assert.match(stateFailed, /任务状态暂不可用/);
      assert.match(stateFailed, /文件列表暂不可用/);
      assert.doesNotMatch(stateFailed, /待你确认|\d+ 份文件/);
      if (running) assert.match(stateFailed, /正在协作/);
    }
  }
});

test("newer teacher board moves supersede historical review and execution state", () => {
  const moved = { ...task, boardRevision: 1, boardUpdatedAt: "2026-10-06T10:00:00Z", reviewedAt: "2026-10-06T09:00:00Z" };
  const reopened = render({ sessionId: "session-1" }, runInfo({ task: { ...moved, status: "accepted", boardStage: "progress" } }));
  assert.match(reopened, /进行中/);
  assert.doesNotMatch(reopened, /已接受|待你确认/);
  const completed = render({ sessionId: "session-1" }, runInfo({ task: { ...moved, boardStage: "done" } }));
  assert.match(completed, /已完成/);
  assert.doesNotMatch(completed, /待你确认/);
  const heldLater = render({ sessionId: "session-1" }, runInfo({ task: { ...moved, status: "hold", boardStage: "done", reviewedAt: "2026-10-06T11:00:00Z" } }));
  assert.match(heldLater, /已暂缓/);
  assert.doesNotMatch(heldLater, /已完成/);
});

test("the count uses deduplicated real file projection rather than expected deliverables", () => {
  const file = { artifact_id: "file-1", task_id: task.id, title: "教案", relative_path: ".edupi/lesson.md", available: true };
  const artifacts = taskPreparedArtifacts(task, workCase, [file, { ...file, artifact_id: "alias" }, { ...file, artifact_id: "file-2", relative_path: ".edupi/answers.md" }, { ...file, task_id: "task-2", relative_path: ".edupi/other.md" }], "/workspace");
  const html = render({ sessionId: "session-1" }, runInfo({ artifacts }));
  assert.match(html, /2 份文件/);
  assert.doesNotMatch(html, /3 份文件/);
  assert.match(render({ sessionId: "session-1" }, runInfo()), /0 份文件/);
});

test("the task card remains one native button and opens details once per activation", async () => {
  let opens = 0;
  const info = runInfo({ onOpen: () => opens++ });
  let renderer;
  await act(async () => { renderer = TestRenderer.create(createElement(EduPiTaskRunContext.Provider, { value: info },
    createElement(EduPiRuntimeFlow, { ...idle, sessionId: info.sessionId }))); });
  const buttons = renderer.root.findAllByType("button");
  assert.equal(buttons.length, 1);
  assert.equal(buttons[0].props.type, "button");
  assert.equal(buttons[0].props["aria-haspopup"], undefined);
  assert.equal(buttons[0].props.onKeyDown, undefined);
  await act(async () => { buttons[0].props.onClick({ detail: 1 }); buttons[0].props.onClick({ detail: 0 }); });
  assert.equal(opens, 2);
  assert.equal((render({ sessionId: info.sessionId }, info).match(/<button/g) || []).length, 1);
  await act(async () => renderer.unmount());
});

test("the workflow graph can be hidden and reopened with a keyboard-native toggle", async () => {
  const messages = [{ role: "user", content: "准备资源" }, { role: "assistant", content: [
    { type: "toolCall", toolCallId: "read-1", toolName: "read", input: {} },
  ] }];
  let renderer;
  await act(async () => { renderer = TestRenderer.create(createElement(EduPiRuntimeFlow,
    { ...idle, sessionId: "session-1", running: true, messages })); });
  const toggle = renderer.root.findByType("button");
  assert.equal(toggle.props["aria-expanded"], true);
  await act(async () => toggle.props.onClick());
  assert.equal(renderer.root.findByType("button").props["aria-expanded"], false);
  assert.equal(renderer.root.findAllByType("ol").length, 0);
  await act(async () => renderer.root.findByType("button").props.onClick());
  assert.equal(renderer.root.findAllByType("ol").length, 1);
  await act(async () => renderer.unmount());
});

test("graph motion is finite and reduced-motion is respected", async () => {
  const css = await readFile(new URL("../app/edupi-motion.css", import.meta.url), "utf8");
  assert.match(css, /ease-out 1/);
  assert.match(css, /prefers-reduced-motion: reduce/);
  assert.match(css, /\.edupi-task-run-card:focus-visible\s*\{[^}]*outline: 2px/);
  assert.match(css, /\.edupi-task-run-card\s*\{ transition: none; \}/);
  assert.match(css, /\.edupi-workflow-view__toggle:focus-visible/);
});
