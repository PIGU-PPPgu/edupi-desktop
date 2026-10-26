import assert from "node:assert/strict";
import fs from "node:fs";
import vm from "node:vm";
import test from "node:test";
import ts from "typescript";

const text = fs.readFileSync(new URL("./EduPiEducationPanel.tsx", import.meta.url), "utf8");
const source = ts.createSourceFile("panel.tsx", text, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
const callbacks = new Map();
function visit(node) {
  if (ts.isVariableDeclaration(node) && ["selectCalendarItem", "selectView"].includes(node.name.getText(source))) callbacks.set(node.name.getText(source), node.initializer.arguments[0]);
  ts.forEachChild(node, visit);
}
visit(source);
assert.equal(callbacks.size, 2);
const compile = name => ts.transpileModule(`exports.select = ${callbacks.get(name).getText(source)};`, {
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
}).outputText;

function fixture({ narrow, collapsed = false, activeView = "calendar" }) {
  const events = [], exports = {};
  vm.runInNewContext(compile("selectCalendarItem"), {
    exports, URLSearchParams, activeView,
    inspectorOpen: false, selectedStudentId: null, selectedObjectId: null,
    window: { matchMedia: () => ({ matches: narrow }) }, objectSider: { collapsed },
    collapseObjectNavigation: () => events.push("collapse"),
    setCalendarSelection: value => events.push(value ? "select" : "clear"),
    updateLocation: () => events.push("route"), selectView: () => events.push("calendar view"),
    searchParams: new URLSearchParams("calendarKind=calendar&calendarItem=item"),
    router: { replace: () => events.push("clear route") },
  });
  return { select: exports.select, events };
}

test("selecting a narrow calendar detail closes its foreground list before displaying the item", () => {
  const f = fixture({ narrow: true });
  f.select({ kind: "calendar", sourceId: "sample", title: "测试日程" });
  assert.deepEqual(f.events, ["collapse", "select", "route"]);
});

test("wide selection and closing details preserve the list preference", () => {
  const wide = fixture({ narrow: false });
  wide.select({ kind: "timetable", sourceId: "sample", title: "测试课次" });
  assert.deepEqual(wide.events, ["select", "route"]);
  const closing = fixture({ narrow: true });
  closing.select(null);
  assert.deepEqual(closing.events, ["clear", "clear route"]);
});

test("switching modules exits the foreground list while retaining the selected student", () => {
  const events = [], exports = {}, noop = () => {};
  let route, changedStudent = false;
  vm.runInNewContext(compile("selectView"), {
    exports, activeStage: "brief", activeTask: undefined, inspectorOpen: false,
    selectedObjectId: null, selectedStudentId: "student-original", calendarSelection: { sourceId: "sample" },
    objectNavigationForeground: true, collapseObjectNavigation: () => events.push("collapse"),
    objectItemForView: (_view, id) => id, cancelActivation: noop,
    setDrawer: noop, setFileReturnTaskKey: noop, setTaskDetailTask: noop, setAgentTask: noop,
    setPendingTaskBinding: noop, setCalendarSelection: noop, setReviewMode: noop,
    setSelectedC1Target: noop, setActiveView: () => events.push("view"), setSelectedObjectId: noop,
    setSelectedStudentId: () => { changedStudent = true; }, setActiveStage: noop,
    updateLocation: (...args) => { route = args; },
  });
  exports.select("homeroom");
  assert.deepEqual(events, ["collapse", "view"]);
  assert.equal(changedStudent, false);
  assert.equal(route[4], "student-original");
});
