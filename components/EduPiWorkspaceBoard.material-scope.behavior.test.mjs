import assert from "node:assert/strict";
import fs from "node:fs";
import test from "node:test";
import vm from "node:vm";
import ts from "typescript";
import React, { act } from "react";
import { createRoot } from "react-dom/client";
import { jsx, jsxs, Fragment } from "react/jsx-runtime";
import { parseHTML } from "linkedom";
import { createJiti } from "jiti";

const jiti = createJiti(import.meta.url, { tsconfigPaths: true });
const names = ["edupi-work-case", "edupi-task-board", "edupi-task-category", "edupi-workbench", "edupi-teacher-task-form", "edupi-foreground"];
const modules = Object.fromEntries(await Promise.all(names.map(async name => [`@/lib/${name}`, await jiti.import(`../lib/${name}.ts`)])));
const { buildEducationContract } = await jiti.import("../lib/edupi-education-contract.ts");
const source = fs.readFileSync(process.env.EDUPI_MATERIAL_CLASS_SOURCE || new URL("./EduPiWorkspaceBoard.tsx", import.meta.url), "utf8");
const code = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.ReactJSX } }).outputText;
const propsOf = element => element[Object.keys(element).find(key => key.startsWith("__reactProps$"))];
const tick = () => new Promise(resolve => setImmediate(resolve));
const slot = (id = "class-one", slotId = "slot-one") => ({ slot_id: slotId, day_of_week: 3, period: 1, subject: "数学", class_name: "同名测试班", ...(id ? { class_id: id } : {}) });
const material = (id, classId = "class-one", more = {}) => ({ material_id: id, title: `[UI TEST] ${id}`, class_id: classId, subject: "数学", available: true, ...more });

async function mount({ timetable = [slot()], materials = [material("own")] } = {}) {
  const { window } = parseHTML("<html><body><div id='root'></div></body></html>");
  const document = window.document, saved = {};
  for (const key of ["window", "document", "HTMLElement", "IS_REACT_ACT_ENVIRONMENT"]) saved[key] = globalThis[key];
  Object.assign(globalThis, { window, document, HTMLElement: window.HTMLElement, IS_REACT_ACT_ENVIRONMENT: true });
  const focusState = { element: document.body };
  Object.defineProperty(document, "activeElement", { configurable: true, get: () => focusState.element.isConnected ? focusState.element : document.body });
  Object.defineProperty(document, "hidden", { configurable: true, writable: true, value: false });
  window.getSelection = () => ({ anchorNode: null, anchorOffset: 0, focusNode: null, focusOffset: 0 });
  window.HTMLElement.prototype.focus = function () { focusState.element = this; this.dispatchEvent(new window.Event("focusin", { bubbles: true })); };
  window.HTMLElement.prototype.scrollIntoView = () => {};
  window.HTMLElement.prototype.attachEvent = () => {};
  window.HTMLElement.prototype.detachEvent = () => {};
  const runtime = { ...modules, react: React, "react/jsx-runtime": { jsx, jsxs, Fragment },
    "./EduPiForeground": { useEduPiForegroundPolicy: () => ({ today: "2026-10-28", graceDays: 3, pinnedTaskIds: [] }), EduPiPagedRows: () => null } };
  const exported = {};
  vm.runInNewContext(code, { exports: exported, window, document, crypto: globalThis.crypto,
    requestAnimationFrame: fn => { fn(); return 1; }, cancelAnimationFrame() {},
    require(name) { assert.ok(runtime[name], name); return runtime[name]; } });
  const requests = [], root = createRoot(document.getElementById("root"));
  const props = { data: { ...buildEducationContract({ workspace: "/synthetic/material-class" }), timetable, teacherMaterials: materials },
    query: "", selectedObjectId: null, onTaskDetail() {}, onMoveTask: async () => {},
    onCreateTask(input) { requests.push(input); return Promise.resolve({ preparationState: "running", preparationError: null }); } };
  const render = () => root.render(jsx(exported.EduPiWorkspaceBoard, { ...props }));
  const f = { document, window, props, requests,
    get form() { return document.querySelector('form[aria-label="新建任务"]'); },
    button(label) { const button = [...document.querySelectorAll("button")].find(button => button.textContent === label); assert.ok(button, label); return button; },
    field(label) { const parent = [...document.querySelectorAll("label")].find(item => [...item.children].some(child => child.tagName === "SPAN" && child.textContent === label)); assert.ok(parent, label); return parent.querySelector("input,select,textarea"); },
    material(id) { return document.querySelector(`input[aria-label="[UI TEST] ${id}"]`); },
    async click(label) { await act(async () => { f.button(label).click(); await tick(); }); },
    async change(label, value) { await act(async () => { const field = f.field(label); propsOf(field).onChange({ target: field.type === "checkbox" ? { checked: value } : { value } }); await tick(); }); },
    async chooseMaterial(id) { await act(async () => { const field = f.material(id); assert.ok(field && !field.disabled, `available material ${id}`); propsOf(field).onChange({ target: { checked: true } }); await tick(); }); },
    async ready() { await f.click("新建任务"); await f.change("任务", "[UI TEST] 合成备课"); await f.change("自动准备教学产物", true); await f.change("上课日期", "2026-11-04"); },
    async submit() { await act(async () => { f.form.dispatchEvent(new window.Event("submit", { bubbles: true, cancelable: true })); await tick(); }); },
    async update(fn) { await act(async () => { fn(props.data); render(); await tick(); }); },
    async close() { await act(async () => root.unmount()); Object.assign(globalThis, saved); },
  };
  await act(async () => { render(); await tick(); });
  return f;
}

test("canonical class material is selectable and dispatches only its exact material and slot IDs", async () => {
  const f = await mount({ materials: [material("own"), material("same-name-legacy", "同名测试班"), material("other-id", "class-two"), material("wrong-subject", "class-one", { subject: "语文" }), material("unavailable", "class-one", { available: false })] });
  try {
    await f.ready();
    assert.ok(f.material("own"));
    for (const id of ["same-name-legacy", "other-id", "wrong-subject", "unavailable"]) assert.ok(f.material(id) === null, id);
    assert.equal(f.button("创建并准备").disabled, true);
    await f.chooseMaterial("own");
    assert.equal(f.button("创建并准备").disabled, false);
    await f.submit(); assert.equal(f.requests.length, 1);
    assert.deepEqual(JSON.parse(JSON.stringify(f.requests[0].preparationSource)), { kind: "teaching_before_class", timetableSlotId: "slot-one", lessonDate: "2026-11-04", materialIds: ["own"], deliverables: ["本节教案", "学生学案", "练习与参考答案", "材料准备清单"] });
  } finally { await f.close(); }
});

test("switching between same-name canonical classes clears the previous class's selected material", async () => {
  const f = await mount({ timetable: [slot(), slot("class-two", "slot-two")], materials: [material("one"), material("two", "class-two")] });
  try {
    await f.ready(); await f.chooseMaterial("one");
    await f.change("课次", "slot-two");
    assert.ok(f.material("one") === null); assert.ok(f.material("two"));
    assert.equal(f.button("创建并准备").disabled, true); await f.submit(); assert.equal(f.requests.length, 0);
    await f.chooseMaterial("two"); await f.submit(); assert.equal(f.requests.length, 1);
    assert.equal(f.requests[0].preparationSource.timetableSlotId, "slot-two");
    assert.deepEqual(Array.from(f.requests[0].preparationSource.materialIds), ["two"]);
  } finally { await f.close(); }
});

test("a legacy slot without class ID uses only its explicit class name", async () => {
  const f = await mount({ timetable: [slot(null)], materials: [material("legacy", "同名测试班"), material("canonical", "class-one")] });
  try {
    await f.ready(); assert.ok(f.material("legacy")); assert.ok(f.material("canonical") === null);
    await f.chooseMaterial("legacy"); await f.submit(); assert.equal(f.requests.length, 1);
    assert.deepEqual(Array.from(f.requests[0].preparationSource.materialIds), ["legacy"]);
  } finally { await f.close(); }
});

test("a refreshed material that moves to another class cannot remain selected or dispatch", async () => {
  const f = await mount();
  try {
    await f.ready(); await f.chooseMaterial("own");
    await f.update(data => { data.teacherMaterials = [material("own", "class-two")]; });
    assert.ok(f.material("own") === null); assert.equal(f.button("创建并准备").disabled, true);
    await f.submit(); assert.equal(f.requests.length, 0);
  } finally { await f.close(); }
});

test("canonical matching retains the existing maximum material selection limit", async () => {
  const limit = modules["@/lib/edupi-teacher-task-form"].MAX_PREPARATION_MATERIALS;
  const f = await mount({ materials: Array.from({ length: limit + 1 }, (_, index) => material(`item-${index}`)) });
  try {
    await f.ready(); for (let index = 0; index < limit; index++) await f.chooseMaterial(`item-${index}`);
    assert.equal(f.material(`item-${limit}`).disabled, true);
    await f.submit(); assert.equal(f.requests[0].preparationSource.materialIds.length, limit);
  } finally { await f.close(); }
});

test("materials awaiting availability confirmation cannot be selected or remain in a preparation", async () => {
  const unchecked = material("unchecked");
  delete unchecked.available;
  const f = await mount({ materials: [unchecked] });
  try {
    await f.ready();
    assert.ok(f.material("unchecked") === null);
    assert.equal(f.button("创建并准备").disabled, true);
    await f.submit(); assert.equal(f.requests.length, 0);
    await f.update(data => { data.teacherMaterials = [material("confirmed")]; });
    await f.chooseMaterial("confirmed");
    await f.update(data => { data.teacherMaterials = [{ ...data.teacherMaterials[0], available: undefined }]; });
    assert.ok(f.material("confirmed") === null);
    assert.equal(f.button("创建并准备").disabled, true);
    await f.submit(); assert.equal(f.requests.length, 0);
  } finally { await f.close(); }
});
