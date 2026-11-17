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

const jiti = createJiti(import.meta.url, { tsconfigPaths: true, fsCache: false });
const names = ["edupi-work-case", "edupi-task-board", "edupi-task-category", "edupi-workbench", "edupi-teacher-task-form", "edupi-foreground"];
const modules = Object.fromEntries(await Promise.all(names.map(async name => [`@/lib/${name}`, await jiti.import(`../lib/${name}.ts`)])));
const { buildEducationContract } = await jiti.import("../lib/edupi-education-contract.ts");
const code = ts.transpileModule(fs.readFileSync(new URL("./EduPiWorkspaceBoard.tsx", import.meta.url), "utf8"), {
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.ReactJSX },
}).outputText;
const propsOf = node => node[Object.keys(node).find(key => key.startsWith("__reactProps$"))];
const tick = () => new Promise(resolve => setImmediate(resolve));
const plain = value => JSON.parse(JSON.stringify(value));
const deferred = () => { let resolve, reject; const promise = new Promise((yes, no) => { resolve = yes; reject = no; }); return { promise, resolve, reject }; };
const settings = (extra = {}) => ({ version: 1, status: "ready", enabled: false, scope: null, selectedCount: 0,
  updatedAt: "2026-11-18T00:00:00.000Z", ...extra });
const stopped = (extra = {}) => ({ version: 1, enabled: false, updatedAt: "2026-11-18T00:00:01.000Z",
  localStatus: "disabled", runtimeStatus: "verified", coreStatus: "paused", ...extra });
const spine = () => ({ stateHash: `sha256:${"a".repeat(64)}`, generatedAt: "2026-11-18T00:00:00.000Z",
  entities: [
    { id: "class-one", name: "同名班", kind: "class", externalRefs: [], revision: 1 },
    { id: "class-two", name: "同名班", kind: "class", externalRefs: [], revision: 1 },
    { id: "student-not-a-class", name: "合成学生", kind: "student", externalRefs: [], revision: 1 },
    { id: "english-subject", name: "英语", kind: "subject", externalRefs: [], revision: 1 },
  ], observations: [], acceptedFacts: [], factCandidates: [], hypotheses: [], conflicts: [], studentViews: [],
  teachingView: { acceptedFactIds: [], bySubject: [{ subjectRef: "english-subject", factIds: [] }] }, nextLessonFactIds: [], uses: [],
});

async function mount({ enabled = false, settingsReplies = [] } = {}) {
  const { window } = parseHTML("<html><body><div id='root'></div></body></html>");
  const document = window.document, saved = {};
  for (const key of ["window", "document", "HTMLElement", "IS_REACT_ACT_ENVIRONMENT"]) saved[key] = globalThis[key];
  Object.assign(globalThis, { window, document, HTMLElement: window.HTMLElement, IS_REACT_ACT_ENVIRONMENT: true });
  const focusState = { element: document.body };
  let unmounted = false;
  Object.defineProperty(document, "activeElement", { configurable: true, get: () => focusState.element.isConnected ? focusState.element : document.body });
  Object.defineProperty(document, "hidden", { configurable: true, value: false });
  window.getSelection = () => ({ anchorNode: null, anchorOffset: 0, focusNode: null, focusOffset: 0 });
  window.HTMLElement.prototype.focus = function () { focusState.element = this; this.dispatchEvent(new window.Event("focusin", { bubbles: true })); };
  window.HTMLElement.prototype.scrollIntoView = () => {};
  window.HTMLElement.prototype.attachEvent = () => {};
  window.HTMLElement.prototype.detachEvent = () => {};
  const host = { settings: settings({ enabled }), settingsReplies: [...settingsReplies], stopReplies: [], createReplies: [] };
  const requests = [], gets = [], stops = [];
  const reply = async value => {
    const result = value?.promise ? await value.promise : value;
    if (result instanceof Error) throw result;
    return result;
  };
  const runtime = { ...modules, react: React, "react/jsx-runtime": { jsx, jsxs, Fragment },
    "@/lib/edupi-teacher-template-client": {
      readTeacherTemplateSettings: async signal => { gets.push({ signal }); return await reply(host.settingsReplies.length ? host.settingsReplies.shift() : host.settings); },
      stopTeacherTemplateAutomation: async expectedUpdatedAt => { stops.push(expectedUpdatedAt); return await reply(host.stopReplies.length ? host.stopReplies.shift() : stopped()); },
    },
    "./EduPiForeground": { useEduPiForegroundPolicy: () => ({ today: "2026-11-18", graceDays: 3, pinnedTaskIds: [] }), EduPiPagedRows: () => null },
    "./AffectSegmentedControl": { SegmentedControl: () => null },
  };
  const exported = {};
  vm.runInNewContext(code, { exports: exported, window, document, Error, AbortController, crypto: globalThis.crypto,
    requestAnimationFrame: fn => { fn(); return 1; }, cancelAnimationFrame() {},
    require(name) { assert.ok(runtime[name], name); return runtime[name]; },
  });
  const props = { data: { ...buildEducationContract({ workspace: "/synthetic/template-one" }), factSpine: spine(),
    timetable: [{ slot_id: "slot-one", subject: "数学", class_id: "class-one", class_name: "同名班", day_of_week: 3, period: 1 }],
    teacherMaterials: [{ material_id: "material-one", title: "合成材料", subject: "语文", class_id: "class-one", available: true }],
  }, query: "", selectedObjectId: null, onTaskDetail() {}, onMoveTask: async () => {},
    onCreateTask: async input => { requests.push(plain(input)); return await reply(host.createReplies.length
      ? host.createReplies.shift() : { preparationState: null, preparationError: null }); },
  };
  const root = createRoot(document.getElementById("root")), render = () => root.render(jsx(exported.EduPiWorkspaceBoard, { ...props }));
  const f = { host, props, document, requests, gets, stops,
    button: label => [...document.querySelectorAll("button")].find(node => node.textContent.trim() === label),
    field(label) { const node = [...document.querySelectorAll("label")].find(item => [...item.children].some(child => child.tagName === "SPAN" && child.textContent === label));
      assert.ok(node, label); return node.querySelector("input,select,textarea"); },
    get message() { return document.querySelector(".edupi-task-board-message"); },
    async run(callback) { await act(async () => { callback(); await tick(); await tick(); }); },
    async click(label) { await f.run(() => { const button = f.button(label); assert.ok(button && !button.disabled, label); button.focus(); button.click(); }); },
    async change(label, value) { await f.run(() => {
      const field = f.field(label); assert.ok(!field.closest("fieldset")?.hasAttribute("disabled"), label);
      (propsOf(field).onChange || propsOf(field).onInput)({ target: field.type === "checkbox" ? { checked: value } : { value }, currentTarget: { value } });
    }); },
    async update(callback) { await f.run(() => { callback(props.data); render(); }); },
    async ready({ scope = true } = {}) {
      await f.click("新建任务"); await f.change("周期材料", true); await f.change("任务", "合成周期材料");
      await f.change("首期日期", "2026-11-20"); await f.change("结束日期", "2026-12-18"); await f.change("产物", "内部议程\n材料清单");
      if (scope) { await f.change("班级", "class-two"); await f.change("学科", "英语"); }
    },
    async submit(twice = false) { await f.run(() => {
      const form = document.querySelector('form[aria-label="新建任务"]'); assert.ok(form);
      const submit = () => form.dispatchEvent(new window.Event("submit", { bubbles: true, cancelable: true }));
      submit(); if (twice) submit();
    }); },
    async unmount() { if (!unmounted) { unmounted = true; await act(async () => root.unmount()); } },
    async close() { await f.unmount(); Object.assign(globalThis, saved); },
  };
  await act(async () => { render(); await tick(); await tick(); });
  return f;
}

test("periodic materials require an explicit canonical class and subject with no default or same-name fallback", async () => {
  const f = await mount();
  try {
    await f.ready({ scope: false });
    assert.equal(propsOf(f.field("班级")).value, "");
    assert.equal(propsOf(f.field("学科")).value, "");
    assert.deepEqual([...f.field("班级").querySelectorAll("option")].map(node => node.value), ["", "class-one", "class-two"]);
    assert.deepEqual(new Set([...f.field("学科").querySelectorAll("option")].map(node => node.value)), new Set(["", "数学", "语文", "英语"]));
    assert.ok(f.button("创建周期任务").disabled);
    await f.submit(); assert.equal(f.requests.length, 0);
    await f.change("班级", "class-two"); await f.submit(); assert.equal(f.requests.length, 0);
    await f.change("学科", "英语"); assert.equal(f.button("创建周期任务").disabled, false);
    await f.submit();
    assert.equal(f.requests.length, 1);
    assert.deepEqual(f.requests[0].templateScope, { classId: "class-two", subject: "英语" });
    assert.equal(f.requests[0].preparationSource, null);
    assert.equal(f.requests[0].recurrence.kind, "teacher_internal_materials");
  } finally { await f.close(); }
});

test("the internal unscoped fact bucket is never offered as a teacher subject", async () => {
  const f = await mount();
  try {
    await f.update(data => { data.factSpine = { ...spine(), teachingView: { acceptedFactIds: [],
      bySubject: [{ subjectRef: "unscoped", factIds: [] }, ...spine().teachingView.bySubject] } }; });
    await f.ready({ scope: false });
    assert.ok(![...f.field("学科").querySelectorAll("option")].some(node => node.value === "unscoped"));
    assert.equal(propsOf(f.field("学科")).value, "");
  } finally { await f.close(); }
});

test("periodic scope survives an explicit failed retry, changes its request identity when edited and resets after success", async () => {
  const f = await mount();
  try {
    await f.ready(); f.host.createReplies.push(new Error("synthetic first failure"));
    await f.submit();
    assert.match(f.message.textContent, /synthetic first failure/);
    assert.equal(propsOf(f.field("班级")).value, "class-two");
    f.host.createReplies.push(new Error("synthetic second failure"));
    await f.submit();
    assert.equal(f.requests[1].clientRequestId, f.requests[0].clientRequestId);
    await f.change("班级", "class-one");
    await f.submit();
    assert.notEqual(f.requests[2].clientRequestId, f.requests[1].clientRequestId);
    await f.click("新建任务"); await f.change("周期材料", true);
    assert.equal(propsOf(f.field("班级")).value, "");
    assert.equal(propsOf(f.field("学科")).value, "");
  } finally { await f.close(); }
});

test("periodic choices are revoked by refreshed canonical options and ordinary tasks send no templateScope", async () => {
  const f = await mount();
  try {
    await f.ready();
    await f.update(data => { data.factSpine = { ...spine(), entities: spine().entities.filter(entity => entity.id !== "class-two") }; });
    assert.equal(propsOf(f.field("班级")).value, "");
    await f.submit(); assert.equal(f.requests.length, 0);
    await f.update(data => { data.factSpine = spine(); });
    assert.equal(propsOf(f.field("班级")).value, "", "restoring an option cannot silently reselect it");
    await f.change("班级", "class-one");
    await f.update(data => { data.factSpine = { ...data.factSpine, teachingView: { acceptedFactIds: [], bySubject: [] } }; });
    assert.equal(propsOf(f.field("学科")).value, "");
    await f.change("周期材料", false);
    await f.submit();
    assert.equal(f.requests.length, 1);
    assert.equal(Object.hasOwn(f.requests[0], "templateScope"), false);
    assert.equal(Object.hasOwn(f.requests[0], "recurrence"), false);
  } finally { await f.close(); }
});

test("a root switch clears scope and an old submission cannot clear or unlock the new root's scope", async () => {
  const f = await mount(), first = deferred(), second = deferred();
  try {
    f.host.createReplies.push(first, second);
    await f.ready(); await f.submit(true);
    assert.equal(f.requests.length, 1);
    await f.update(data => { data.workspace = "/synthetic/template-two"; });
    await f.ready({ scope: false });
    assert.equal(propsOf(f.field("班级")).value, ""); assert.equal(propsOf(f.field("学科")).value, "");
    await f.change("班级", "class-one"); await f.change("学科", "数学"); await f.submit();
    await f.run(() => first.resolve({ preparationState: null }));
    assert.equal(f.document.querySelector("fieldset.edupi-task-board-create").hasAttribute("disabled"), true);
    assert.equal(propsOf(f.field("班级")).value, "class-one"); assert.equal(propsOf(f.field("学科")).value, "数学");
    await f.run(() => second.resolve({ preparationState: null }));
    assert.equal(f.document.querySelector("form"), null);
  } finally { await f.close(); }
});

test("the global periodic stop is shown only after settings explicitly reports enabled", async () => {
  const gate = deferred(), f = await mount({ settingsReplies: [gate] });
  try {
    assert.equal(f.button("停止周期材料"), undefined);
    await f.run(() => gate.resolve(settings({ enabled: true })));
    assert.ok(f.button("停止周期材料"));
    assert.equal(f.stops.length, 0);
  } finally { await f.close(); }
});

test("successful periodic creation refreshes enabled settings without stealing the restored New-task focus", async () => {
  const f = await mount();
  try {
    await f.ready();
    assert.equal(f.button("停止周期材料"), undefined);
    f.host.settings = settings({ enabled: true, selectedCount: 1, updatedAt: "2026-11-18T00:00:02.000Z" });
    await f.submit();
    assert.equal(f.gets.length, 2);
    assert.ok(f.button("停止周期材料"));
    assert.equal(f.document.activeElement, f.button("新建任务"));
    await f.click("新建任务"); await f.change("周期材料", true);
    assert.equal(propsOf(f.field("班级")).value, "");
    assert.equal(propsOf(f.field("学科")).value, "");
  } finally { await f.close(); }
});

test("the existing history controls expose the same global stop and preserve an unknown receipt as an alert", async () => {
  const f = await mount({ enabled: true });
  try {
    await f.update(() => { f.props.selectedObjectId = "workspace:list:history"; });
    assert.ok(f.button("停止周期材料"));
    f.host.stopReplies.push(stopped({ runtimeStatus: "unknown" }));
    await f.click("停止周期材料");
    assert.equal(f.stops.length, 1);
    assert.equal(f.message.getAttribute("role"), "alert");
    assert.match(f.message.textContent, /待核对/);
    assert.doesNotMatch(f.message.textContent, /周期材料已停止/);
  } finally { await f.close(); }
});

for (const coreStatus of ["paused", "revoked", "missing"]) test(`verified periodic stop with Core ${coreStatus} uses config CAS once and preserves the create draft`, async () => {
  const f = await mount({ enabled: true }), gate = deferred();
  try {
    await f.ready(); f.host.stopReplies.push(gate);
    await f.run(() => { const handler = propsOf(f.button("停止周期材料")).onClick; handler(); handler(); });
    assert.deepEqual(f.stops, ["2026-11-18T00:00:00.000Z"]);
    assert.ok(f.button("停止中…").disabled);
    await f.run(() => gate.resolve(stopped({ coreStatus })));
    assert.equal(f.message.getAttribute("role"), "status");
    assert.match(f.message.textContent, /周期材料已停止/);
    assert.equal(f.button("停止周期材料"), undefined);
    assert.equal(f.field("任务").value, "合成周期材料");
    assert.equal(propsOf(f.field("班级")).value, "class-two");
    assert.equal(f.requests.length, 0);
  } finally { await f.close(); }
});

for (const result of [
  { runtimeStatus: "unknown", coreStatus: "paused" }, { runtimeStatus: "verified", coreStatus: "unknown" },
  { runtimeStatus: "unknown", coreStatus: "unknown" },
]) test(`periodic stop never reports success for runtime ${result.runtimeStatus} / Core ${result.coreStatus}`, async () => {
  const f = await mount({ enabled: true });
  try {
    f.host.stopReplies.push(stopped(result)); await f.click("停止周期材料");
    assert.equal(f.message.getAttribute("role"), "alert");
    assert.match(f.message.textContent, /待核对/); assert.doesNotMatch(f.message.textContent, /周期材料已停止/);
    assert.equal(f.button("停止周期材料"), undefined, "a confirmed local disabled config is not rendered as enabled");
  } finally { await f.close(); }
});

for (const localStatus of ["superseded", "unknown"]) test(`periodic stop with local ${localStatus} rechecks settings without an automatic stop retry`, async () => {
  const f = await mount({ enabled: true });
  try {
    f.host.settings = settings({ enabled: true, updatedAt: "2026-11-18T00:00:02.000Z" });
    f.host.stopReplies.push(stopped({ localStatus }));
    await f.click("停止周期材料");
    assert.equal(f.message.getAttribute("role"), "alert"); assert.match(f.message.textContent, /待核对/);
    assert.equal(f.stops.length, 1); assert.equal(f.gets.length, 2);
    assert.ok(f.button("停止周期材料"));
  } finally { await f.close(); }
});

test("periodic stop failure retains the draft and an explicit retry uses reread settings CAS", async () => {
  const f = await mount({ enabled: true });
  try {
    await f.ready(); f.host.stopReplies.push(new Error("synthetic stop unavailable"));
    f.host.settings = settings({ enabled: true, updatedAt: "2026-11-18T00:00:02.000Z" });
    await f.click("停止周期材料");
    assert.match(f.message.textContent, /synthetic stop unavailable/);
    assert.equal(f.field("任务").value, "合成周期材料");
    await f.click("停止周期材料");
    assert.deepEqual(f.stops, ["2026-11-18T00:00:00.000Z", "2026-11-18T00:00:02.000Z"]);
  } finally { await f.close(); }
});

test("late settings from an old root cannot expose its stop action in the new root", async () => {
  const old = deferred(), f = await mount({ settingsReplies: [old, settings()] });
  try {
    await f.update(data => { data.workspace = "/synthetic/template-two"; });
    assert.equal(f.gets[0].signal.aborted, true);
    await f.run(() => old.resolve(settings({ enabled: true })));
    assert.equal(f.button("停止周期材料"), undefined);
    assert.equal(f.stops.length, 0);
  } finally { await f.close(); }
});

test("late stop completion cannot hide the new root's action or overwrite its create scope", async () => {
  const f = await mount({ enabled: true }), old = deferred();
  try {
    f.host.stopReplies.push(old);
    await f.click("停止周期材料");
    f.host.settings = settings({ enabled: true, updatedAt: "2026-11-18T00:00:02.000Z" });
    await f.update(data => { data.workspace = "/synthetic/template-two"; });
    await f.ready();
    await f.run(() => old.resolve(stopped()));
    assert.ok(f.button("停止周期材料"));
    assert.equal(f.message, null);
    assert.equal(propsOf(f.field("班级")).value, "class-two");
    await f.click("停止周期材料");
    assert.equal(f.stops.at(-1), "2026-11-18T00:00:02.000Z");
  } finally { await f.close(); }
});
