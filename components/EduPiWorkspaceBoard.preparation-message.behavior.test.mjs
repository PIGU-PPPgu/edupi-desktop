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
const code = ts.transpileModule(fs.readFileSync(process.env.EDUPI_BOARD_MESSAGE_SOURCE || new URL("./EduPiWorkspaceBoard.tsx", import.meta.url), "utf8"), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.ReactJSX } }).outputText;
const propsOf = element => element[Object.keys(element).find(key => key.startsWith("__reactProps$"))];
const tick = () => new Promise(resolve => setImmediate(resolve));
// Use the current creation route's identity expression as the contract authority.
const routeSource = ts.createSourceFile("route.ts", fs.readFileSync(new URL("../app/api/edupi/tasks/route.ts", import.meta.url), "utf8"), ts.ScriptTarget.Latest, true);
let taskIdentity;
const findIdentity = node => { if (ts.isVariableDeclaration(node) && node.name.getText(routeSource) === "taskId") taskIdentity = node.initializer; ts.forEachChild(node, findIdentity); };
findIdentity(routeSource); assert.ok(taskIdentity);
const identity = {};
vm.runInNewContext(ts.transpileModule(`exports.forInput = body => ${taskIdentity.getText(routeSource)};`, { compilerOptions: { module: ts.ModuleKind.CommonJS } }).outputText, { exports: identity });

async function mount() {
  const { window } = parseHTML("<html><body><div id='root'></div></body></html>");
  const document = window.document, globals = {};
  for (const key of ["window", "document", "HTMLElement", "IS_REACT_ACT_ENVIRONMENT"]) globals[key] = globalThis[key];
  Object.assign(globalThis, { window, document, HTMLElement: window.HTMLElement, IS_REACT_ACT_ENVIRONMENT: true });
  const focusState = { element: document.body };
  Object.defineProperty(document, "activeElement", { configurable: true, get: () => focusState.element.isConnected ? focusState.element : document.body });
  Object.defineProperty(document, "hidden", { configurable: true, value: false });
  window.getSelection = () => ({ anchorNode: null, anchorOffset: 0, focusNode: null, focusOffset: 0 });
  window.HTMLElement.prototype.focus = function () { focusState.element = this; this.dispatchEvent(new window.Event("focusin", { bubbles: true })); };
  window.HTMLElement.prototype.scrollIntoView = () => {};
  window.HTMLElement.prototype.attachEvent = () => {};
  window.HTMLElement.prototype.detachEvent = () => {};
  const runtime = { ...modules, react: React, "react/jsx-runtime": { jsx, jsxs, Fragment }, "./EduPiForeground": { useEduPiForegroundPolicy: () => ({ today: "2026-10-28", graceDays: 3, pinnedTaskIds: [] }), EduPiPagedRows: () => null },
    "./AffectSegmentedControl": { SegmentedControl: () => null } };
  const exports = {};
  vm.runInNewContext(code, { exports, Error, window, document, crypto: globalThis.crypto, requestAnimationFrame: callback => { callback(); return 1; }, cancelAnimationFrame() {}, require(name) { assert.ok(runtime[name], name); return runtime[name]; } });
  const requests = [], root = createRoot(document.getElementById("root"));
  let outcome = { preparationState: "error", preparationError: "activation_pending" };
  const props = { data: { ...buildEducationContract({ workspace: "/synthetic/preparation" }), timetable: [{ slot_id: "slot-one", day_of_week: 3, period: 1, subject: "数学", class_id: "canonical-class", class_name: "合成班" }], teacherMaterials: [{ material_id: "material-one", title: "合成材料", subject: "数学", class_id: "canonical-class", available: true }] }, query: "", selectedObjectId: null,
    onTaskDetail() {}, onMoveTask: async () => { throw new Error("较新的移动失败"); },
    onCreateTask(input) {
      requests.push(input);
      if (outcome.throw) return Promise.reject(new Error(outcome.throw));
      const id = identity.forInput(input);
      props.data = { ...props.data, tasks: [...props.data.tasks, ...buildEducationContract({ tasks: [{ id, title: input.title, status: "planned", trigger: "teaching_before_class", due_date: input.dueDate, evidence: {} }] }).tasks] };
      render(); return Promise.resolve(outcome);
    } };
  const render = () => root.render(jsx(exports.EduPiWorkspaceBoard, { ...props }));
  const f = { document, props, requests,
    get message() { return document.querySelector(".edupi-task-board-message")?.textContent || ""; },
    button(label) { const result = [...document.querySelectorAll("button")].find(button => button.textContent === label); assert.ok(result, label); return result; },
    field(label) { const parent = [...document.querySelectorAll("label")].find(item => [...item.children].some(child => child.tagName === "SPAN" && child.textContent === label)); assert.ok(parent, label); return parent.querySelector("input,select,textarea"); },
    id(index = 0) { return identity.forInput(requests[index]); },
    outcome(value) { outcome = value; },
    async click(label) { await act(async () => { f.button(label).click(); await tick(); }); },
    async change(label, value) { await act(async () => { const field = f.field(label); propsOf(field).onChange({ target: field.type === "checkbox" ? { checked: value } : { value } }); }); },
    async create(title = "合成备课") {
      await f.click("新建任务"); await f.change("任务", title); await f.change("自动准备教学产物", true); await f.change("上课日期", "2026-11-04");
      await act(async () => { propsOf(document.querySelector('input[aria-label="合成材料"]')).onChange({ target: { checked: true } }); });
      await act(async () => { document.querySelector('form[aria-label="新建任务"]').dispatchEvent(new window.Event("submit", { bubbles: true, cancelable: true })); await tick(); });
    },
    async update(callback) { await act(async () => { callback(props.data); render(); await tick(); }); },
    async state(id, currentState) { await f.update(data => { data.workCases = [...data.workCases.filter(item => item.taskId !== id), { id: `case-${id}`, taskId: id, kind: "teaching_before_class", title: "合成备课", currentState, artifactIds: [], artifacts: [], transitions: [], dueDate: "2026-11-04" }]; }); },
    async close() { await act(async () => root.unmount()); Object.assign(globalThis, globals); },
  };
  await act(async () => { render(); await tick(); }); return f;
}

test("the created task's actual workCase progress clears its obsolete not-started message", async () => {
  for (const state of ["running", "draft_ready", "accepted", "modified", "completed"]) {
    const f = await mount(); try {
      await f.create(); assert.match(f.message, /activation_pending/);
      await f.state(f.id(), state); assert.equal(f.message, "", state);
    } finally { await f.close(); }
  }
});

test("only the exact created task's content progress clears the notice; generic acceptance and failures do not", async () => {
  const f = await mount(); try {
    await f.create(); await f.state("different-task", "draft_ready"); assert.match(f.message, /尚未启动/);
    await f.state(f.id(), "failed"); assert.match(f.message, /尚未启动/);
    await f.state(f.id(), "queued"); assert.match(f.message, /尚未启动/);
    await f.update(data => { data.tasks = data.tasks.map(task => ({ ...task, status: "accepted" })); }); assert.match(f.message, /尚未启动/);
    await f.update(data => { data.tasks = data.tasks.map(task => ({ ...task, contentStatus: "draft_ready" })); }); assert.equal(f.message, "");
  } finally { await f.close(); }
});

test("late progress from an earlier task cannot erase a newer task's preparation error", async () => {
  const f = await mount(); try {
    await f.create("先创建的备课"); f.outcome({ preparationState: "error", preparationError: "较新备课未启动" });
    await f.create("后创建的备课"); assert.match(f.message, /较新备课未启动/);
    await f.state(f.id(0), "draft_ready"); assert.match(f.message, /较新备课未启动/);
    await f.state(f.id(1), "running"); assert.equal(f.message, "");
  } finally { await f.close(); }
});

test("preparation progress preserves a newer generic failure and an unrelated create draft", async () => {
  const f = await mount(); try {
    await f.create(); f.outcome({ throw: "较新的创建失败" }); await f.create("失败的第二项");
    assert.match(f.message, /较新的创建失败/);
    await f.state(f.id(0), "draft_ready"); assert.match(f.message, /较新的创建失败/);
    assert.equal(f.field("任务").value, "失败的第二项");
    await f.change("备注", "保留新的草稿备注"); await f.state(f.id(0), "accepted");
    assert.equal(f.field("任务").value, "失败的第二项"); assert.equal(f.field("备注").value, "保留新的草稿备注");
  } finally { await f.close(); }
});
