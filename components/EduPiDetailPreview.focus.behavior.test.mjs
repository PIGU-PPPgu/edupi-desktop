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

const jiti = createJiti(import.meta.url, { jsx: { runtime: "automatic" }, tsconfigPaths: true });
const [contract, layout, workbench, artifacts, workCase, taskForm, icons] = await Promise.all([
  jiti.import("../lib/edupi-education-contract.ts"),
  jiti.import("../lib/panel-layout.ts"),
  jiti.import("../lib/edupi-workbench.ts"),
  jiti.import("../lib/edupi-task-artifacts.ts"),
  jiti.import("../lib/edupi-work-case.ts"),
  jiti.import("../lib/edupi-teacher-task-form.ts"),
  jiti.import("./EduPiActionIcon.tsx"),
]);
const compile = text => ts.transpileModule(text, { compilerOptions: {
  module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.ReactJSX,
} }).outputText;
const read = relative => fs.readFileSync(new URL(relative, import.meta.url), "utf8");
const ast = relative => ts.createSourceFile(relative, read(relative), ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
const shellAst = ast("./AppShell.tsx"), educationAst = ast("./EduPiEducationPanel.tsx");
function findJsx(source, name) {
  let found;
  function visit(node) {
    if ((ts.isJsxSelfClosingElement(node) || ts.isJsxOpeningElement(node)) && node.tagName.getText(source) === name) found = node;
    ts.forEachChild(node, visit);
  }
  visit(source);
  assert.ok(found, name);
  return found;
}
const educationCall = findJsx(shellAst, "EduPiEducationPanel");
const taskCall = findJsx(educationAst, "EduPiTaskDetailDrawer");
const fileCall = findJsx(educationAst, "FileWorkspaceDrawer");
const projectedProps = (source, call, names) => `{${call.attributes.properties
  .filter(prop => ts.isJsxAttribute(prop) && names.includes(prop.name.getText(source)))
  .map(prop => `${prop.name.getText(source)}: ${prop.initializer.expression.getText(source)}`).join(", ")}}`;
const educationBody = educationAst.statements.find(node => ts.isFunctionDeclaration(node) && node.name?.text === "EduPiEducationPanel").body;
const declaration = name => {
  const statement = educationBody.statements.find(node => ts.isVariableStatement(node)
    && node.declarationList.declarations.some(item => item.name.getText(educationAst) === name));
  assert.ok(statement, name);
  return statement.getText(educationAst);
};
// Project the production caller expressions, then render the real drawers and
// dismissal hooks with React DOM. No hooks or focus effects are reimplemented.
const callerExports = {};
vm.runInNewContext(compile(`exports.props = ({ rightPanelOpen, filePanelAvailable, chatBodyWidth, sidebarWidth = 260, widePanel = true }) => {
  const educationProps = ${projectedProps(shellAst, educationCall, ["chatPreviewForeground"])};
  const chatPreviewForeground = educationProps.chatPreviewForeground ?? false;
  const activeView = "chat", showingReminders = false;
  ${declaration("chatDetailsFit")}
  ${declaration("dockedDetails")}
  return { task: ${projectedProps(educationAst, taskCall, ["docked", "focusSuspended"])},
    file: ${projectedProps(educationAst, fileCall, ["docked", "focusSuspended"])} };
};`), { exports: callerExports, ...layout });

const tick = () => new Promise(resolve => setImmediate(resolve));
const noop = () => {};

async function mount({ kind = "task", ...initial } = {}) {
  const saved = Object.fromEntries(["window", "document", "HTMLElement", "IS_REACT_ACT_ENVIRONMENT"].map(key => [key, globalThis[key]]));
  const { window } = parseHTML("<html><body><button id='opener'>打开详情</button><div id='root'></div></body></html>");
  const document = window.document;
  const focusState = { element: document.body };
  const focusEvents = [];
  const state = { rightPanelOpen: false, expanded: false, filePanelAvailable: true, bodyWidth: null, ...initial };
  Object.assign(globalThis, { window, document, HTMLElement: window.HTMLElement, IS_REACT_ACT_ENVIRONMENT: true });
  Object.defineProperty(document, "activeElement", { configurable: true, get: () =>
    focusState.element?.isConnected && !focusState.element.closest("[hidden]") ? focusState.element : document.body });
  Object.defineProperty(window.HTMLElement.prototype, "offsetParent", { configurable: true,
    get() { return this.closest("[hidden]") ? null : document.body; } });
  window.HTMLElement.prototype.focus = function () {
    if (!this.isConnected || this.closest("[hidden]")) return;
    focusState.element = this;
    focusEvents.push(this);
    this.dispatchEvent(new window.Event("focusin", { bubbles: true }));
  };
  window.HTMLElement.prototype.attachEvent = noop;
  window.HTMLElement.prototype.detachEvent = noop;
  window.getSelection = () => ({ anchorNode: null, anchorOffset: 0, focusNode: null, focusOffset: 0 });
  const modules = {
    react: React, "react/jsx-runtime": { jsx, jsxs, Fragment },
    "@/lib/edupi-workbench": workbench, "@/lib/edupi-task-artifacts": artifacts,
    "@/lib/edupi-work-case": workCase, "@/lib/edupi-teacher-task-form": taskForm,
    "./EduPiActionIcon": icons,
  };
  const load = relative => {
    const exports = {};
    vm.runInNewContext(compile(read(relative)), { exports, document, window,
      require(name) { assert.ok(modules[name], name); return modules[name]; } });
    return exports;
  };
  const modal = load("../hooks/useModalDismiss.ts");
  modules["./useModalDismiss"] = modal;
  modules["@/hooks/usePanelDismiss"] = load("../hooks/usePanelDismiss.ts");
  // File icons are irrelevant to keyboard ownership; retain the real artifact
  // list and replace only its decorative icon dependency.
  modules["./FileIcons"] = { getFileIcon: () => null };
  modules["./EduPiTaskArtifacts"] = load("./EduPiTaskArtifacts.tsx");
  const { EduPiTaskDetailDrawer } = load("./EduPiTaskDetailDrawer.tsx");
  const { EduPiWorkspaceDrawer } = load("./EduPiWorkspaceDrawer.tsx");
  const task = contract.buildEducationContract({ tasks: [{ id: "focus-test-task", title: "合成周期任务", status: "planned",
    due_date: "2026-11-16", deliverables: ["合成材料"], board_stage: "progress",
    recurrence: { kind: "teacher_internal_materials", cadence: "weekly", until_date: "2026-12-01", lead_days: 2, deliverables: ["合成材料"] },
  }] }).tasks[0];
  const host = { composerMounts: 0, fileEditorMounts: 0, closes: 0, focusEvents };
  function Composer() {
    const [value, setValue] = React.useState("");
    React.useEffect(() => { host.composerMounts++; }, []);
    return jsx("textarea", { "aria-label": "对话草稿", value, onChange: event => setValue(event.target.value) });
  }
  function PreviewEditor() {
    const [value, setValue] = React.useState("");
    return jsx("textarea", { "aria-label": "右侧编辑", value, onChange: event => setValue(event.target.value) });
  }
  function FileEditor() {
    const [value, setValue] = React.useState("[UI TEST] 未保存材料");
    React.useEffect(() => { host.fileEditorMounts++; }, []);
    return jsx("textarea", { "aria-label": "材料编辑", value, onChange: event => setValue(event.target.value) });
  }
  function Parent() {
    const [open, setOpen] = React.useState(true);
    const props = callerExports.props({ ...state, chatBodyWidth: state.bodyWidth ??
      (1440 - 208 - (state.rightPanelOpen && !state.expanded ? 552 : 0)) });
    const onClose = () => { host.closes++; setOpen(false); };
    return jsxs(Fragment, { children: [
      jsx(Composer, {}),
      open && (kind === "task" ? jsx(EduPiTaskDetailDrawer, { task, workCase: null, workspace: "/synthetic",
        onClose, onOpenFile: noop, onOpenTask: noop, onOpenAgent: noop, onDelete: noop,
        onRecurringStage: noop, onUpdateRecurring: noop, onReactivateRecurring: noop, ...props.task,
      }) : jsx(EduPiWorkspaceDrawer, { kind: "file", task: undefined, filePath: "/synthetic/material.md",
        filePanel: jsx(FileEditor, {}), onClose, onPreparePrompt: noop, ...props.file,
      })),
      jsxs("section", { id: "preview", hidden: !state.rightPanelOpen, children: [
        jsx("button", { id: "preview-tab", children: "预览文件页签" }),
        jsx(PreviewEditor, {}),
        jsx("button", { id: "preview-expand", children: state.expanded ? "恢复侧栏" : "展开侧栏" }),
      ] }),
    ] });
  }
  const root = createRoot(document.getElementById("root"));
  const f = { host, state, document,
    drawer: () => document.querySelector("aside"),
    composer: () => document.querySelector('[aria-label="对话草稿"]'),
    previewTab: () => document.getElementById("preview-tab"),
    editor: () => kind === "task" ? document.querySelector("aside input") : document.querySelector('[aria-label="材料编辑"]'),
    button(label) {
      const button = [...document.querySelectorAll("button")].find(node => node.textContent === label || node.getAttribute("aria-label") === label);
      assert.ok(button, label); return button;
    },
    async run(callback) { await act(async () => { callback(); await tick(); }); },
    async render(next = {}) { Object.assign(state, next); await f.run(() => root.render(jsx(Parent, {}))); },
    async click(label) { await f.run(() => { const button = f.button(label); button.focus(); button.click(); }); },
    async edit(field, value) {
      // Linkedom has no native text editing. Drive the mounted React control's
      // actual change handler so its draft lives in component state.
      const propsKey = Object.keys(field).find(key => key.startsWith("__reactProps$"));
      assert.ok(propsKey && field[propsKey].onChange);
      await f.run(() => field[propsKey].onChange({ target: { value } }));
    },
    async key(key, shiftKey = false) {
      let event;
      await f.run(() => {
        event = new window.Event("keydown", { bubbles: true, cancelable: true });
        Object.defineProperties(event, { key: { value: key }, shiftKey: { value: shiftKey }, isComposing: { value: false } });
        document.activeElement.dispatchEvent(event);
      });
      return event;
    },
    async close() { await act(async () => root.unmount()); Object.assign(globalThis, saved); },
  };
  document.getElementById("opener").focus();
  await f.render();
  if (kind === "task") await f.click("修改");
  return f;
}

for (const kind of ["task", "file"]) for (const closeFocus of ["composer", "editor"]) {
  test(`${kind}: dock → preview → expand → restore → close preserves ${closeFocus} focus and editor instances`, async () => {
    const f = await mount({ kind });
    try {
      const drawer = f.drawer(), composer = f.composer(), editor = f.editor();
      const rightEditor = f.document.querySelector('[aria-label="右侧编辑"]');
      await f.edit(composer, "[UI TEST] 未发送草稿");
      await f.edit(rightEditor, "[UI TEST] 右侧编辑草稿");
      await f.edit(editor, "[UI TEST] 当前未保存编辑");
      assert.equal(drawer.getAttribute("role"), "complementary");
      await f.run(() => composer.focus());
      const beforeOpen = f.host.focusEvents.length;
      await f.render({ rightPanelOpen: true });
      assert.ok(f.document.activeElement === composer, "opening preview must not autofocus task close");
      assert.equal(f.host.focusEvents.length, beforeOpen);
      assert.equal(drawer.getAttribute("role"), "dialog", "space still controls the visual dock mode");
      assert.equal(drawer.getAttribute("aria-modal"), null, "a paused trap cannot claim modal semantics");
      await f.run(() => f.previewTab().focus());
      assert.equal((await f.key("Tab")).defaultPrevented, false, "the preview Tab must remain unclaimed");
      assert.ok(f.document.activeElement === f.previewTab());
      await f.render({ expanded: true });
      assert.equal(drawer.getAttribute("role"), "complementary");
      assert.ok(f.document.activeElement === f.previewTab(), "expansion must not run dock autofocus");
      await f.render({ expanded: false });
      assert.equal(drawer.getAttribute("role"), "dialog");
      assert.equal(drawer.getAttribute("aria-modal"), null);
      assert.ok(f.document.activeElement === f.previewTab(), "restoring the overlay must keep preview focus");
      assert.equal((await f.key("Tab", true)).defaultPrevented, false);
      await f.run(() => composer.focus());
      assert.equal((await f.key("Tab")).defaultPrevented, false, "the chat textarea must stay outside the paused trap");
      assert.ok(f.document.activeElement === composer);
      const current = closeFocus === "composer" ? composer : editor;
      await f.run(() => current.focus());
      const beforeClose = f.host.focusEvents.length;
      // ResizeObserver can report the old 680px body for a commit after close.
      await f.render({ rightPanelOpen: false, bodyWidth: 680 });
      assert.ok(f.document.activeElement === current, "resuming an overlay must respect current focus");
      await f.render({ bodyWidth: null });
      assert.ok(f.document.activeElement === current, "the subsequent dock must respect current focus");
      assert.equal(f.host.focusEvents.length, beforeClose, "neither cleanup nor autofocus may redirect focus");
      assert.equal((await f.key("Tab")).defaultPrevented, false);
      assert.ok(f.drawer() === drawer && f.composer() === composer && f.editor() === editor);
      assert.ok(f.document.querySelector('[aria-label="右侧编辑"]') === rightEditor);
      assert.equal(editor.value, "[UI TEST] 当前未保存编辑");
      assert.equal(composer.value, "[UI TEST] 未发送草稿");
      assert.equal(rightEditor.value, "[UI TEST] 右侧编辑草稿");
      assert.equal(hostMounts(f), kind === "file" ? "1/1" : "1/0");
    } finally { await f.close(); }
  });
}
function hostMounts(f) { return `${f.host.composerMounts}/${f.host.fileEditorMounts}`; }

for (const kind of ["task", "file"]) {
  test(`${kind}: preview round trip then Escape returns to the original connected opener`, async () => {
    const f = await mount({ kind });
    try {
      const opener = f.document.getElementById("opener");
      await f.render({ rightPanelOpen: true });
      await f.render({ expanded: true });
      await f.render({ expanded: false });
      await f.run(() => f.editor().focus());
      await f.render({ rightPanelOpen: false, bodyWidth: 680 });
      await f.render({ bodyWidth: null });
      assert.equal((await f.key("Escape")).defaultPrevented, true);
      assert.equal(f.drawer(), null);
      assert.ok(f.document.activeElement === opener);
    } finally { await f.close(); }
  });

  test(`${kind}: disabling an active modal for preview does not restore its old opener`, async () => {
    const f = await mount({ kind, bodyWidth: 680 });
    try {
      assert.equal(f.drawer().getAttribute("aria-modal"), "true");
      await f.render({ rightPanelOpen: true, filePanelAvailable: false });
      assert.equal(f.drawer().getAttribute("aria-modal"), "true", "an unavailable preview is not foreground");
      await f.run(() => f.previewTab().focus());
      await f.render({ filePanelAvailable: true });
      assert.ok(f.document.activeElement === f.previewTab(), "modal disable cleanup cannot return to the former opener");
      assert.equal(f.drawer().getAttribute("aria-modal"), null);
      assert.equal((await f.key("Escape")).defaultPrevented, false);
      assert.equal(f.host.closes, 0);
      await f.run(() => f.editor().focus());
      assert.equal((await f.key("Escape")).defaultPrevented, true, "Escape inside the paused detail still closes it");
      assert.equal(f.host.closes, 1);
      assert.equal(f.drawer(), null);
    } finally { await f.close(); }
  });

  for (const bodyWidth of [680, 1232]) test(`${kind}: ordinary ${bodyWidth}px details retain Escape and return focus on actual close`, async () => {
    const f = await mount({ kind, bodyWidth });
    try {
      const opener = f.document.getElementById("opener");
      await f.run(() => f.editor().focus());
      assert.equal((await f.key("Tab", true)).defaultPrevented, false);
      assert.equal((await f.key("Escape")).defaultPrevented, true);
      assert.equal(f.host.closes, 1);
      assert.equal(f.drawer(), null);
      assert.ok(f.document.activeElement === opener);
    } finally { await f.close(); }
  });
}
