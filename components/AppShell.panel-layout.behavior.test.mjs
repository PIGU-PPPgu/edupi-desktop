import assert from "node:assert/strict";
import fs from "node:fs";
import vm from "node:vm";
import test from "node:test";
import ts from "typescript";
import { createJiti } from "jiti";

const jiti = createJiti(import.meta.url);
const layout = await jiti.import("../lib/panel-layout.ts");
const text = fs.readFileSync(new URL("./AppShell.tsx", import.meta.url), "utf8");
const ast = ts.createSourceFile("AppShell.tsx", text, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
const shell = ast.statements.find(node => ts.isFunctionDeclaration(node) && node.name?.text === "AppShell");
const names = ["getTeacherReservedWidth", "getResponsiveSidebarMaxWidth", "getResponsiveRightPanelMaxWidth"];
const declarations = names.map(name => {
  const declaration = shell.body.statements.find(node => ts.isVariableStatement(node)
    && node.declarationList.declarations.some(item => item.name.getText(ast) === name));
  assert.ok(declaration, name);
  return declaration.getText(ast);
}).join("\n");
const code = ts.transpileModule(`${declarations}\nexports.read = () => ({
  reserved: getTeacherReservedWidth(), leftMax: getResponsiveSidebarMaxWidth(), rightMax: getResponsiveRightPanelMaxWidth(),
});`, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText;

function mount({ viewport = 1440, navigation = 208, task = 0, right = 552, rightOpen = false } = {}) {
  const state = { viewport, navigation, task, right, rightOpen, expanded: false, education: true, chat: true };
  const context = { ...layout, exports: {}, useCallback: callback => callback,
    window: { get innerWidth() { return state.viewport; } },
    document: { querySelector(selector) {
      assert.equal(selector, ".edupi-teacher-shell");
      const width = state.viewport - (state.rightOpen && !state.expanded && state.viewport >= layout.TEACHER_SPLIT_PANEL_MIN_WIDTH ? state.right : 0);
      const body = { clientWidth: width - state.navigation, querySelector: () => state.task ? { getBoundingClientRect: () => ({ width: state.task }) } : null };
      return { clientWidth: width, querySelector: () => body };
    } },
    sidebarWidthRef: { current: 260 },
    rightPanelWidthRef: { get current() { return state.right; } },
    sidebarOpen: true,
    get edupiChatActive() { return state.education && state.chat; },
    get edupiEducationModule() { return state.education ? "home" : null; },
    get rightPanelOpen() { return state.rightOpen; },
    get rightPanelExpanded() { return state.expanded; },
  };
  vm.runInNewContext(code, context);
  return { state, read: context.exports.read };
}

test("actual AppShell budgets teacher navigation and a docked task before resizing the list", () => {
  const f = mount({ task: 380 });
  const result = f.read();
  assert.equal(result.reserved, 588);
  assert.equal(result.leftMax, 432);
  assert.equal(1440 - result.reserved - result.leftMax, 420);
});

test("opening a file ignores an outgoing task track instead of shrinking the stored teacher sidebar", () => {
  const f = mount({ task: 380 });
  f.state.rightOpen = true;
  const result = f.read();
  assert.equal(result.reserved, 208);
  assert.equal(result.leftMax, 260);
  assert.equal(result.rightMax, 552);
  assert.equal(1440 - result.reserved - result.leftMax - result.rightMax, 420);
});

test("expand and restore keep the previous file width eligible while task details dock and undock", () => {
  const f = mount({ task: 380, rightOpen: true });
  f.state.expanded = true;
  assert.equal(f.read().rightMax, layout.RIGHT_PANEL_MAX_WIDTH);
  assert.equal(f.read().leftMax, 432);
  f.state.expanded = false;
  assert.equal(f.read().rightMax, 552);
  assert.equal(f.read().leftMax, 260);
  assert.equal(f.state.right, 552);
});

test("teacher narrow and overlay modes preserve desktop preferences while the legacy split math stays intact", () => {
  const f = mount({ viewport: 821, navigation: 76, rightOpen: true });
  assert.equal(f.read().leftMax, 325);
  assert.equal(f.read().rightMax, layout.RIGHT_PANEL_MAX_WIDTH);
  f.state.viewport = 820;
  assert.equal(f.read().leftMax, layout.SIDEBAR_MAX_WIDTH);
  f.state.education = false;
  f.state.viewport = 1366; f.state.right = 686;
  assert.equal(f.read().reserved, 0);
  assert.equal(f.read().leftMax, 260);
  assert.equal(f.read().rightMax, 686);
});
