import assert from "node:assert/strict";
import fs from "node:fs";
import vm from "node:vm";
import test from "node:test";
import ts from "typescript";
import React, { act } from "react";
import { createRoot } from "react-dom/client";
import { jsx, jsxs, Fragment } from "react/jsx-runtime";
import { parseHTML } from "linkedom";
import { createJiti } from "jiti";

const jiti = createJiti(import.meta.url, { tsconfigPaths: true });
const [conflicts, time] = await Promise.all([jiti.import("../lib/edupi-schedule-conflicts.ts"), jiti.import("../lib/edupi-calendar-form-time.ts")]);
const code = ts.transpileModule(fs.readFileSync(new URL("./EduPiScheduleConflictReview.tsx", import.meta.url), "utf8"), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.ReactJSX } }).outputText;
const tick = () => new Promise(resolve => setImmediate(resolve));
const deferred = () => { let resolve, reject; const promise = new Promise((yes, no) => { resolve = yes; reject = no; }); return { promise, resolve, reject }; };
function item() {
  return conflicts.normalizeScheduleConflict({ conflict_id: `schedule_conflict_${"a".repeat(32)}`, kind: "calendar", canonical_id: "calendar-a", expected_revision: 2,
    expected_content_hash: `sha256:${"b".repeat(64)}`, expected_conflict_hash: `sha256:${"c".repeat(64)}`,
    canonical: { event_id: "calendar-a", date: "2026-10-30", name: "合成原安排", source_occurrence_ref: "occurrence-a", source_ids: ["source-old"], evidence_ids: ["evidence-old"] },
    candidate: { source_item_id: "calendar-a", date: "2026-10-30", name: "合成新安排", source_occurrence_ref: "occurrence-a", source_ids: ["source-new"], evidence_ids: ["evidence-a"] }, external_send: false });
}

async function mount(extra = {}) {
  const saved = Object.fromEntries(["window", "document", "HTMLElement", "IS_REACT_ACT_ENVIRONMENT"].map(key => [key, globalThis[key]]));
  const { window } = parseHTML("<html><body><button id='outside'>其他入口</button><div id='root'></div></body></html>");
  const document = window.document, focused = { current: document.body }, focusCalls = [], reads = [], resolutions = [], events = [];
  Object.assign(globalThis, { window, document, HTMLElement: window.HTMLElement, IS_REACT_ACT_ENVIRONMENT: true });
  Object.defineProperty(document, "activeElement", { configurable: true, get: () => focused.current?.isConnected ? focused.current : document.body });
  window.HTMLElement.prototype.focus = function (options) { focused.current = this; focusCalls.push({ node: this, options }); this.dispatchEvent(new window.Event("focusin", { bubbles: true })); };
  const modules = { react: React, "react/jsx-runtime": { jsx, jsxs, Fragment }, "@/lib/desktop-updater": { isTauriDesktop: () => true }, "@/lib/edupi-calendar-form-time": time,
    "@/lib/edupi-schedule-conflicts": { ...conflicts,
      readScheduleConflicts: (_fetcher, _headers, after) => { const request = { ...deferred(), after }; reads.push(request); return request.promise; },
      resolveScheduleConflict: capture => { const request = { ...deferred(), capture }; resolutions.push(request); return request.promise; },
      bootstrapScheduleConflictReview: () => assert.fail("Synthetic owner is initialized"),
    },
  };
  window.addEventListener("edupi-education-refresh", event => events.push(event));
  const exports = {};
  vm.runInNewContext(code, { exports, AbortController, window, CustomEvent: window.CustomEvent,
    fetch() { assert.fail("No live API calls allowed"); }, require(name) { assert.ok(modules[name], name); return modules[name]; } });
  const root = createRoot(document.getElementById("root"));
  const props = { enabled: true, scopeKey: "synthetic-root", request: { id: 1, target: { canonicalId: "calendar-a", occurrenceRef: "occurrence-a", evidenceIds: ["evidence-a"] } }, ...extra };
  const f = { document, window, reads, resolutions, events, focusCalls, props,
    async run(callback) { await act(async () => { callback(); await tick(); }); },
    async render(next = {}) { Object.assign(props, next); await f.run(() => root.render(React.createElement(exports.EduPiScheduleConflictReview, props))); },
    radios: () => [...document.querySelectorAll('input[type="radio"]')],
    button(label) { const node = [...document.querySelectorAll("button")].find(node => node.textContent === label); assert.ok(node, label); return node; },
    async click(label) { await f.run(() => { const node = f.button(label); node.focus(); node.click(); }); },
    async choose(value) { await f.run(() => { const node = f.radios().find(node => node.value === value); assert.ok(node && !node.disabled); node.focus(); node.checked = true; node.dispatchEvent(new window.Event("click", { bubbles: true })); }); },
    async loaded(nextCursor = null) { await f.run(() => reads.at(-1).resolve({ conflicts: [item()], nextCursor })); },
    async close() { await act(async () => root.unmount()); Object.assign(globalThis, saved); },
  };
  await f.render(); return f;
}

test("the actual review renders a labeled unselected native radio group at the exact held candidate", async () => {
  const f = await mount();
  try {
    await f.loaded();
    assert.equal(f.document.querySelector("select"), null);
    assert.equal(f.document.querySelector("fieldset legend").textContent, "处理方式");
    assert.deepEqual(f.radios().map(node => node.value), ["keep_existing", "replace_with_candidate"]);
    assert.ok(f.radios().every(node => !node.checked));
    assert.equal(f.radios()[0].name, f.radios()[1].name);
    assert.equal(f.button("确认处理").disabled, true); assert.equal(f.resolutions.length, 0);
    assert.ok(f.document.activeElement === f.radios()[0]);
    assert.equal(f.focusCalls.at(-1).options.preventScroll, false);
  } finally { await f.close(); }
});

test("radio changes require explicit confirm and preserve the exact CAS and uncertain retry capture", async () => {
  const f = await mount();
  try {
    await f.loaded(); await f.choose("keep_existing"); await f.choose("replace_with_candidate");
    assert.equal(f.resolutions.length, 0); assert.equal(f.button("确认处理").disabled, false);
    assert.deepEqual(f.radios().map(node => Boolean(node.checked)), [false, true]);
    await f.click("确认处理");
    assert.equal(f.resolutions.length, 1); assert.equal(f.radios().length, 0); assert.equal(f.button("重试原决定").disabled, true);
    const capture = f.resolutions[0].capture;
    assert.match(capture.commandId, /^desktop-schedule-/);
    assert.deepEqual(JSON.parse(JSON.stringify(capture)), JSON.parse(JSON.stringify(conflicts.captureScheduleDecision(item(), "replace_with_candidate", capture.commandId))));
    await f.run(() => f.resolutions[0].reject(new Error("Synthetic lost response")));
    assert.equal(f.radios().length, 0); assert.equal(f.events.length, 0);
    await f.click("重试原决定"); assert.equal(f.resolutions.length, 2); assert.ok(f.resolutions[1].capture === capture);
  } finally { await f.close(); }
});

test("collapsing or leaving a selected comparison never submits and reopening requires a fresh choice", async () => {
  const f = await mount();
  try {
    await f.loaded(); await f.choose("replace_with_candidate"); await f.click("收起");
    assert.equal(f.radios().length, 0); assert.equal(f.resolutions.length, 0);
    await f.click("核对安排"); await f.loaded();
    const row = f.document.querySelector("[data-schedule-conflict]"); await f.run(() => row.click());
    assert.ok(f.radios().every(node => !node.checked)); assert.equal(f.button("确认处理").disabled, true);
    await f.choose("keep_existing"); await f.render({ enabled: false });
    assert.equal(f.radios().length, 0); assert.equal(f.resolutions.length, 0);
  } finally { await f.close(); }
});

test("refreshing another page locks every visible radio and confirmation until the read settles", async () => {
  const f = await mount();
  try {
    await f.loaded(`schedule_conflict_${"d".repeat(32)}`); await f.choose("keep_existing"); await f.click("更多");
    assert.ok(f.radios().every(node => node.disabled)); assert.equal(f.document.querySelector("fieldset").hasAttribute("disabled"), true);
    assert.equal(f.button("确认处理").disabled, true); assert.equal(f.resolutions.length, 0);
    await f.run(() => f.reads.at(-1).resolve({ conflicts: [], nextCursor: null }));
    assert.ok(f.radios().every(node => !node.disabled)); assert.equal(f.button("确认处理").disabled, false);
  } finally { await f.close(); }
});
