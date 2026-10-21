import assert from "node:assert/strict";
import fs from "node:fs";
import { createRequire } from "node:module";
import test from "node:test";
import vm from "node:vm";
import ts from "typescript";
import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { createJiti } from "jiti";

const require = createRequire(import.meta.url);
const flush = () => new Promise(resolve => setImmediate(resolve));
const feedback = await createJiti(import.meta.url, { tsconfigPaths: true }).import("../lib/edupi-capability-feedback.ts");
const compiled = ts.transpileModule(fs.readFileSync(new URL("./EduPiCapabilityFeedback.tsx", import.meta.url), "utf8"), {
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.ReactJSX },
}).outputText;
const task = { id: "capability_task_123", trigger: "capability_package", status: "accepted", revision: 3,
  reviewedAt: "2026-10-20T00:00:00.000Z", reviewer: "teacher", sourceEventId: "case-1", externalSend: false };
const workCase = { id: "capability_work_123", taskId: task.id, kind: "capability_package", triggerId: "case-1", currentState: "accepted", externalSend: false };
const savedRow = { feedback_id: `sha256:${"a".repeat(64)}`, session_id: "desktop-capability-feedback", current: true, source_status: "unverified", decision: "accept",
  target: { kind: "capability_work", target_id: workCase.id, revision: 3, status: "accepted" } };

function fixture({ existing = [], afterWrite = savedRow, open = true } = {}) {
  const prepared = { target: { kind: "capability_work", targetId: workCase.id, expectedRevision: 3 }, decision: "accept" };
  const states = [true, open, false, null, { usefulness: "partial", used: false, wouldUseAgain: "", baselineMinutes: "", reviewMinutes: "", note: "隔离测试" }, open ? prepared : null, null, null];
  const refs = [];
  let cursor = 0, refCursor = 0, rows = existing, writes = 0, prepares = 0;
  const exports = {};
  vm.runInNewContext(compiled, { exports, require(name) {
    if (name === "react") return { useState() {
      const index = cursor++;
      return [states[index], value => { states[index] = typeof value === "function" ? value(states[index]) : value; }];
    }, useRef(value) { const index = refCursor++; return refs[index] ??= { current: value }; }, useEffect() {} };
    if (name === "react/jsx-runtime") return require(name);
    if (name === "@/lib/edupi-capability-feedback") return { ...feedback,
      readCapabilityFeedbackRecords: async () => rows,
      prepareCapabilityFeedback: async () => { prepares++; return prepared; },
    };
    if (name === "@/lib/edupi-teacher-feedback") return { recordTeacherFeedback: async () => {
      writes++; rows = [afterWrite]; return { feedbackId: savedRow.feedback_id, current: true, replayed: false };
    } };
    if (name === "@/lib/desktop-updater") return { isTauriDesktop: () => true };
    if (name === "./EduPiTodayWork") return { EduPiTeacherValueForm: function Form() { return null; } };
    if (name === "./EduPiUsageObservation") return { EduPiUsageVisibility: ({ children }) => children };
    throw new Error(`Unexpected dependency: ${name}`);
  } });
  return { render() { cursor = 0; refCursor = 0; return exports.EduPiCapabilityFeedback({ task, workCase }); }, counters: () => ({ writes, prepares }) };
}

function find(element, predicate) {
  if (!React.isValidElement(element)) return null;
  if (predicate(element)) return element;
  return React.Children.toArray(element.props.children).map(child => find(child, predicate)).find(Boolean);
}

test("a durable unverified feedback receipt shows recorded pending source proof and does not repeat the write", async () => {
  const view = fixture();
  const form = find(view.render(), element => element.type.name === "Form");
  await form.props.onSubmit();
  await flush();
  const html = renderToStaticMarkup(view.render());
  assert.ok(html.includes("已记录，来源待核对"));
  assert.ok(!html.includes("评价状态已变化"));
  assert.ok(!html.includes("评价本次草稿"));
  assert.equal(view.counters().writes, 1);
  await form.props.onSubmit();
  await flush();
  assert.equal(view.counters().writes, 1);
});

test("read-only re-entry recognizes an existing pending record without preparing or writing again", async () => {
  const view = fixture({ existing: [savedRow], open: false });
  await find(view.render(), element => element.type === "button" && element.props.children === "评价本次草稿").props.onClick();
  await flush();
  assert.ok(renderToStaticMarkup(view.render()).includes("已记录，来源待核对"));
  assert.deepEqual(view.counters(), { writes: 0, prepares: 0 });
});

test("only Core-current source proof retains the completed rating state", async () => {
  const view = fixture({ afterWrite: { ...savedRow, source_status: "current" } });
  await find(view.render(), element => element.type.name === "Form").props.onSubmit();
  await flush();
  const html = renderToStaticMarkup(view.render());
  assert.ok(html.includes("已评价"));
  assert.ok(!html.includes("来源待核对"));
});

test("historical, wrong-revision and wrong-receipt readbacks cannot become a pending success", async () => {
  for (const afterWrite of [
    { ...savedRow, source_status: "historical" },
    { ...savedRow, target: { ...savedRow.target, revision: 2 } },
    { ...savedRow, feedback_id: "different-feedback-id" },
  ]) {
    const view = fixture({ afterWrite });
    await find(view.render(), element => element.type.name === "Form").props.onSubmit();
    await flush();
    const html = renderToStaticMarkup(view.render());
    assert.ok(html.includes("评价状态已变化"));
    assert.ok(!html.includes("已记录，来源待核对"));
  }
});
