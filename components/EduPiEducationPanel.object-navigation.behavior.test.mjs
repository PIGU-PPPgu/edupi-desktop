import assert from "node:assert/strict";
import fs from "node:fs";
import test from "node:test";
import vm from "node:vm";
import ts from "typescript";

const panelText = fs.readFileSync(new URL("./EduPiEducationPanel.tsx", import.meta.url), "utf8");
const panel = ts.createSourceFile("panel.tsx", panelText, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
const body = panel.statements.find(node => ts.isFunctionDeclaration(node) && node.name?.text === "EduPiEducationPanel").body;
const declaration = name => body.statements.find(node => ts.isVariableStatement(node)
  && node.declarationList.declarations.some(item => ts.isArrayBindingPattern(item.name)
    ? item.name.elements.some(binding => binding.name?.getText(panel) === name) : item.name.getText(panel) === name));
const start = body.statements.indexOf(declaration("objectSider"));
const end = body.statements.indexOf(declaration("commitEducationSnapshot"));
assert.ok(start >= 0 && end > start);
let sider, main, restore;
function visit(node) {
  if (ts.isJsxSelfClosingElement(node) && node.tagName.getText(panel) === "EduPiObjectSider") sider = node;
  if (ts.isJsxElement(node) && node.openingElement.attributes.properties.some(prop => prop.name?.getText(panel) === "ref"
    && prop.initializer?.expression?.getText(panel) === "objectNavigationMainRef")) main = node;
  if (ts.isJsxSelfClosingElement(node) && node.tagName.getText(panel) === "EduPiObjectNavigationRestore") restore = node.parent;
  ts.forEachChild(node, visit);
}
visit(body);
assert.ok(sider && main && ts.isConditionalExpression(restore));
const compile = source => ts.transpileModule(source, { compilerOptions: {
  module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.ReactJSX,
} }).outputText;
const fixtureCode = compile(`exports.render = function NavigationFixture() {
  const [activeView, setActiveView] = useState(initialView);
  const [activeStage, setActiveStage] = useState("brief");
  const [selectedTaskKey, setSelectedTaskKey] = useState(null);
  const [selectedStudentId, setSelectedStudentId] = useState(null);
  const [selectedObjectId, setSelectedObjectId] = useState(null);
  const [calendarSelection, setCalendarSelection] = useState(null);
  const calendarSelectionRef = useRef(calendarSelection);
  const [drawer, setDrawer] = useState(null);
  ${["previewPath", "previewArtifact", "previewArtifactId", "agentTask"].map(name => declaration(name).getText(panel)).join("\n")}
  const [taskDetailTask, setTaskDetailTask] = useState(null);
  const [query, updateQuery] = useState("");
  const activeTask = selectedTaskKey ? { id: selectedTaskKey } : null;
  ${body.statements.slice(start, end).map(node => node.getText(panel)).join("\n")}
  ${["selectView", "selectCalendarItem", "selectTask", "selectStudent", "selectObject", "focusC1Review"].map(name => declaration(name).getText(panel)).join("\n")}
  ${["objectSiderAvailable", "showObjectSider"].map(name => declaration(name).getText(panel)).join("\n")}
  return { sider: ${sider.getText(panel)}, main: ${main.openingElement.getText(panel)}{${restore.getText(panel)}}</div>,
    setPreviewPath, setPreviewArtifact, setAgentTask,
    activeView, selectedObjectId, selectedTaskKey, calendarSelection, selectView, setDrawer, setTaskDetailTask };
};`);
const sourceCode = relative => compile(fs.readFileSync(new URL(relative, import.meta.url), "utf8"));
const layoutCode = sourceCode("./EduPiObjectNavigationRestore.tsx");
const modalCode = sourceCode("../hooks/useModalDismiss.ts");
const collapseCode = sourceCode("../hooks/useEduPiContentSiderCollapse.ts");
const preferencesCode = sourceCode("../lib/app-prefs.ts");
const noop = () => {};
const Sider = () => null;
const Restore = () => null;
const jsx = (type, props) => ({ type, props: props || {} });

function mount({ narrow = false, desktopCollapsed = false, initialView = "insights" } = {}) {
  const slots = [], effects = new Map(), frames = new Map(), events = new Map(), mediaListeners = new Set();
  const commits = [];
  const writes = [], focused = [], routes = [], storage = new Map([["edupi-object-sider-collapsed", String(desktopCollapsed)]]);
  let cursor = 0, dirty = false, state, frameId = 0;
  const document = { activeElement: null, getElementById: () => null,
    addEventListener(name, callback) { if (!events.has(name)) events.set(name, new Set()); events.get(name).add(callback); },
    removeEventListener(name, callback) { events.get(name)?.delete(callback); },
  };
  function element(name, parentElement = null) {
    const result = { name, parentElement, children: [], hidden: false, offsetParent: {}, isConnected: true,
      contains(target) { for (let current = target; current; current = current.parentElement) if (current === this) return true; return false; },
      hasAttribute: () => false,
      focus() { assert.ok(this.isConnected && !this.hidden, `${name} must be visible`); document.activeElement = this; focused.push(name); },
      closest(selector) { assert.equal(selector, "[data-object-navigation-toolbar]"); return this === restoreButton ? {} : null; },
    };
    parentElement?.children.push(result);
    return result;
  }
  const body = element("body"), navigation = element("list", body), content = element("main", body);
  const collapseButton = element("collapse", navigation), search = element("search", navigation), row = element("row", navigation);
  const editor = element("editor", content), restoreButton = element("restore", content), outside = element("other module", body);
  const scroll = { scrollTop: 0 };
  document.body = body; document.activeElement = body;
  navigation.querySelector = selector => selector === ".edupi-content-sider__scroll" ? scroll : collapseButton;
  navigation.querySelectorAll = () => [collapseButton, search, row];
  const media = { matches: narrow,
    addEventListener(name, callback) { assert.equal(name, "change"); mediaListeners.add(callback); },
    removeEventListener(name, callback) { assert.equal(name, "change"); mediaListeners.delete(callback); },
  };
  const window = { matchMedia(query) { assert.equal(query, "(max-width: 820px)"); return media; },
    addEventListener: document.addEventListener, removeEventListener: document.removeEventListener,
    localStorage: { getItem: key => storage.get(key) ?? null, setItem(key, value) { writes.push([key, value]); storage.set(key, value); } },
  };
  const same = (a, b) => a?.length === b?.length && a.every((value, index) => Object.is(value, b[index]));
  const hooks = {
    useState(initial) { const index = cursor++; if (!(index in slots)) slots[index] = { value: typeof initial === "function" ? initial() : initial }; const slot = slots[index]; return [slot.value, value => { const next = typeof value === "function" ? value(slot.value) : value; if (!Object.is(next, slot.value)) { slot.value = next; dirty = true; } }]; },
    useRef(current) { const index = cursor++; slots[index] ??= { current }; return slots[index]; },
    useMemo(create, deps) { const index = cursor++; if (!same(slots[index]?.deps, deps)) slots[index] = { deps, value: create() }; return slots[index].value; },
    useEffect(create, deps) { const index = cursor++; if (!same(slots[index]?.deps, deps)) effects.set(index, { create, deps }); },
  };
  hooks.useCallback = (callback, deps) => hooks.useMemo(() => callback, deps);
  const sandbox = { document, window, URLSearchParams, ...hooks, initialView,
    requestAnimationFrame(callback) { frames.set(++frameId, callback); return frameId; }, cancelAnimationFrame: id => frames.delete(id),
    education: { students: [{ id: "synthetic-student" }] }, context: null, memoryScopes: null, teachingSkills: {}, inspectorOpen: false,
    objectItemForView: (_view, id) => id ?? null, materialItemRoute: id => id?.startsWith("material:") ? id : null,
    studentRecordKey: student => student.id, taskKey: task => task.id,
    setFileReturnTaskKey: noop, setPendingTaskBinding: noop, setReviewMode: noop, setSelectedC1Target: noop,
    setReviewMessage: noop, cancelActivation: noop, openUpload: noop, loadWorkspace: () => Promise.resolve(),
    updateLocation: (...args) => routes.push(args), router: { replace: noop }, searchParams: new URLSearchParams(),
    EduPiObjectSider: Sider, EduPiObjectNavigationRestore: Restore,
    require(name) { if (name === "react") return hooks; if (name === "react/jsx-runtime") return { jsx, jsxs: jsx }; if (name === "react-dom") return {}; return {}; },
  };
  const evaluate = (code, modules = {}) => { const exports = {}; vm.runInNewContext(code, { ...sandbox, exports,
    require: name => modules[name] ?? sandbox.require(name),
  }); return exports; };
  const preferences = evaluate(preferencesCode);
  const collapse = evaluate(collapseCode, { "@/lib/app-prefs": preferences });
  Object.assign(sandbox, preferences, collapse, evaluate(layoutCode), evaluate(modalCode));
  const component = evaluate(fixtureCode);
  const commit = () => {
    state.sider.props.containerRef.current = navigation;
    state.sider.props.collapseButtonRef.current = collapseButton;
    state.main.props.ref.current = content;
    navigation.hidden = Boolean(state.sider.props.hidden);
    navigation.inert = navigation.hidden;
    for (const item of [collapseButton, search, row]) item.hidden = navigation.hidden;
    content.inert = state.main.props.inert;
    commits.push({ narrow: media.matches, hidden: navigation.hidden, foreground: state.sider.props.foreground, mainInert: content.inert });
    const recovery = state.main.props.children;
    restoreButton.hidden = !recovery;
    if (recovery) recovery.props.buttonRef.current = restoreButton;
    if ((navigation.hidden && navigation.contains(document.activeElement)) || (content.inert && content.contains(document.activeElement))) document.activeElement = body;
  };
  const render = ({ frames: runFrames = true } = {}) => {
    let attempts = 0;
    do {
      assert.ok(attempts++ < 30); cursor = 0; dirty = false;
      state = component.render(); commit();
      const pending = [...effects]; effects.clear();
      for (const [index, effect] of pending) { slots[index]?.cleanup?.(); slots[index] = { deps: effect.deps, cleanup: effect.create() }; }
    } while (dirty);
    if (runFrames) flushFrames();
  };
  const flushFrames = () => { let attempts = 0; while (frames.size) { assert.ok(attempts++ < 30); const pending = [...frames.values()]; frames.clear(); pending.forEach(callback => callback()); } };
  const fixture = { commits, document, navigation, content, collapseButton, search, row, editor, restoreButton, outside, scroll, writes, focused, routes, storage, mediaListeners,
    get state() { return state; }, render, flushFrames,
    focus(target) { document.activeElement = target; },
    resize(value, options) { media.matches = value; for (const listener of mediaListeners) listener({ matches: value }); render(options); },
    expand(options) { assert.ok(state.main.props.children, "the current heading must expose a restore action"); document.activeElement = restoreButton; state.main.props.children.props.onExpand(); render(options); },
    collapse(options) { document.activeElement = collapseButton; state.sider.props.onCollapse(); render(options); },
    act(callback, options) { callback(state); render(options); },
    key(key, shiftKey = false) { const event = { key, shiftKey, defaultPrevented: false, preventDefault() { this.defaultPrevented = true; }, stopPropagation: noop }; for (const listener of events.get("keydown") ?? []) listener(event); render(); return event; },
    unmount() { for (const slot of slots) slot?.cleanup?.(); },
  };
  render(); return fixture;
}

test("resizing a focused fact editor hides the desktop list without moving focus or changing desktop preference", () => {
  const f = mount();
  try {
    f.scroll.scrollTop = 173; f.focus(f.editor); f.focused.length = 0;
    f.resize(true);
    assert.equal(f.navigation.hidden, true);
    assert.equal(f.navigation.inert, true);
    assert.equal(f.content.inert, false);
    assert.equal(f.restoreButton.hidden, false);
    assert.equal(f.document.activeElement, f.editor);
    assert.deepEqual(f.focused, []); assert.deepEqual(f.writes, []);
    f.expand(); assert.equal(f.scroll.scrollTop, 173);
    f.collapse(); f.resize(false);
    assert.equal(f.navigation.hidden, false);
    assert.deepEqual(f.writes, []);
  } finally { f.unmount(); }
});

test("a directly opened narrow module shows its content and only explicit recovery creates a modal list", () => {
  for (const desktopCollapsed of [false, true]) {
    const f = mount({ narrow: true, desktopCollapsed });
    try {
      assert.equal(f.navigation.hidden, true); assert.equal(f.content.inert, false);
      f.expand();
      assert.equal(f.navigation.hidden, false); assert.equal(f.state.sider.props.foreground, true);
      assert.equal(f.content.inert, true); assert.equal(f.document.activeElement, f.collapseButton);
      f.focus(f.row); assert.equal(f.key("Tab").defaultPrevented, true);
      assert.equal(f.document.activeElement, f.collapseButton);
      f.key("Escape"); assert.equal(f.navigation.hidden, true);
      assert.equal(f.document.activeElement, f.restoreButton);
      assert.deepEqual(f.writes, []);
      f.resize(false); assert.equal(f.navigation.hidden, desktopCollapsed);
    } finally { f.unmount(); }
  }
});

test("the first DOM commit follows the actual window width before any passive effect", () => {
  for (const narrow of [false, true]) for (const desktopCollapsed of [false, true]) {
    const f = mount({ narrow, desktopCollapsed });
    try {
      assert.deepEqual(f.commits[0], { narrow, hidden: narrow || desktopCollapsed, foreground: false, mainInert: false });
      assert.deepEqual(f.focused, []); assert.deepEqual(f.writes, []);
    } finally { f.unmount(); }
  }
});

test("file drawer recovery follows both path and artifact identity while stable identity preserves the open list", () => {
  for (const desktopCollapsed of [false, true]) {
    const f = mount({ narrow: true, desktopCollapsed });
    try {
      f.act(state => { state.setPreviewPath("/synthetic/A.pdf"); state.setPreviewArtifact({ id: "artifact-a", title: "合成A" }); state.setDrawer("file"); });
      f.expand();
      f.act(state => state.setPreviewArtifact({ id: "artifact-a", title: "同一产物的新标题" }));
      assert.equal(f.navigation.hidden, false, "new metadata for the same file must retain an explicit reveal");
      for (const replace of [state => state.setPreviewPath("/synthetic/B.pdf"), state => state.setPreviewArtifact({ id: "artifact-b", title: "合成B" })]) {
        const before = f.commits.length;
        f.focus(f.editor); f.focused.length = 0; f.act(replace);
        assert.equal(f.commits[before].hidden, true, "the first replacement commit must invalidate the old reveal");
        assert.equal(f.navigation.hidden, true); assert.equal(f.content.inert, false);
        assert.equal(f.document.activeElement, f.editor); assert.deepEqual(f.focused, []);
        f.expand(); assert.equal(f.navigation.hidden, false);
      }
      assert.deepEqual(f.writes, []);
    } finally { f.unmount(); }
  }
});

test("agent drawer recovery follows the bound task key and preserves a same-task metadata refresh", () => {
  for (const desktopCollapsed of [false, true]) {
    const f = mount({ narrow: true, desktopCollapsed });
    try {
      f.act(state => { state.setAgentTask({ id: "synthetic-task-a", title: "合成任务A" }); state.setDrawer("agent"); });
      f.expand(); f.act(state => state.setAgentTask({ id: "synthetic-task-a", title: "同一任务的新标题" }));
      assert.equal(f.navigation.hidden, false);
      for (const task of [{ id: "synthetic-task-b", title: "合成任务B" }, null]) {
        const before = f.commits.length;
        f.focus(f.editor); f.focused.length = 0; f.act(state => state.setAgentTask(task));
        assert.equal(f.commits[before].hidden, true);
        assert.equal(f.navigation.hidden, true); assert.equal(f.content.inert, false);
        assert.equal(f.document.activeElement, f.editor); assert.deepEqual(f.focused, []);
        f.expand(); assert.equal(f.navigation.hidden, false);
      }
      assert.deepEqual(f.writes, []);
    } finally { f.unmount(); }
  }
});

test("object, calendar, student, task and review selections close narrow lists without writing the desktop preference", () => {
  const cases = [
    ["insights", props => props.onObject("insights:accepted")],
    ["calendar", props => props.onCalendarItem({ kind: "calendar", sourceId: "synthetic-calendar", title: "合成日程" })],
    ["students", props => props.onStudent({ id: "synthetic-student" })],
    ["tasks", props => props.onTask({ id: "synthetic-task", title: "合成任务" })],
    ["review", props => props.onReviewTarget({ kind: "observation", id: "synthetic-observation" })],
  ];
  for (const [initialView, select] of cases) for (const desktopCollapsed of [false, true]) {
    const f = mount({ narrow: true, desktopCollapsed, initialView });
    try {
      f.expand(); f.focus(f.row); f.act(state => select(state.sider.props));
      assert.equal(f.navigation.hidden, true, initialView);
      assert.equal(f.content.inert, false, initialView);
      assert.deepEqual(f.writes, [], initialView);
      f.resize(false); assert.equal(f.navigation.hidden, desktopCollapsed, initialView);
    } finally { f.unmount(); }
  }
});

test("entering another module and returning never revives an old narrow reveal", () => {
  const f = mount({ narrow: true });
  try {
    f.expand(); f.act(state => state.selectView("calendar"));
    assert.equal(f.navigation.hidden, true);
    f.act(state => state.selectView("insights")); assert.equal(f.navigation.hidden, true);
    f.expand(); f.collapse(); f.expand(); assert.equal(f.navigation.hidden, false);
    assert.deepEqual(f.writes, []);
  } finally { f.unmount(); }
});

test("a new main detail invalidates the previous reveal immediately while explicit detail-heading recovery still works", () => {
  const f = mount({ narrow: true });
  try {
    f.expand(); f.focus(f.editor); f.act(state => state.setDrawer("agent"));
    assert.equal(f.navigation.hidden, true); assert.equal(f.content.inert, false);
    assert.equal(f.document.activeElement, f.editor);
    f.expand(); assert.equal(f.navigation.hidden, false); assert.equal(f.content.inert, true);
    f.focus(f.editor); f.act(state => state.setDrawer(null));
    assert.equal(f.navigation.hidden, true); assert.equal(f.document.activeElement, f.editor);
    f.focused.length = 0; f.resize(false); f.resize(true);
    assert.equal(f.navigation.hidden, true); assert.deepEqual(f.focused, []);
  } finally { f.unmount(); }
});

test("resizing while keyboard focus is in the list preserves that control and its narrow Tab scope", () => {
  const f = mount();
  try {
    f.focus(f.search); f.focused.length = 0; f.resize(true);
    assert.equal(f.navigation.hidden, false); assert.equal(f.state.sider.props.foreground, true);
    assert.equal(f.document.activeElement, f.search); assert.deepEqual(f.focused, []);
    f.resize(false); assert.equal(f.document.activeElement, f.search);
    f.focus(f.editor); f.resize(true); assert.equal(f.navigation.hidden, true);
    assert.equal(f.document.activeElement, f.editor); assert.deepEqual(f.writes, []);
  } finally { f.unmount(); }
});

test("an existing main detail takes precedence over retaining desktop list focus at the narrow breakpoint", () => {
  const f = mount();
  try {
    f.act(state => state.setTaskDetailTask({ id: "synthetic-task" }));
    f.focus(f.search); f.resize(true);
    assert.equal(f.navigation.hidden, true); assert.equal(f.content.inert, false);
    assert.equal(f.document.activeElement, f.restoreButton);
    assert.equal(f.state.sider.props.foreground, false);
    f.expand(); assert.equal(f.state.sider.props.foreground, true);
    f.collapse(); assert.deepEqual(f.writes, []);
  } finally { f.unmount(); }
});

test("a different detail in the same module cannot reuse the previous detail's explicit reveal", () => {
  const f = mount({ narrow: true });
  try {
    f.act(state => state.setTaskDetailTask({ id: "synthetic-first-task" }));
    f.expand(); f.focus(f.editor); f.act(state => state.setTaskDetailTask({ id: "synthetic-next-task" }));
    assert.equal(f.navigation.hidden, true);
    assert.equal(f.content.inert, false);
    assert.equal(f.document.activeElement, f.editor);
    f.expand(); assert.equal(f.navigation.hidden, false);
  } finally { f.unmount(); }
});

test("a narrow foreground teardown and queued recovery respect a newer deliberate focus target", () => {
  for (const desktopCollapsed of [false, true]) {
    const f = mount({ narrow: true, desktopCollapsed });
    try {
      f.expand(); f.focus(f.outside); f.focused.length = 0; f.resize(false);
      assert.equal(f.document.activeElement, f.outside); assert.deepEqual(f.focused, []);
      f.resize(true); f.expand(); f.collapse({ frames: false });
      f.focus(f.outside); f.focused.length = 0; f.flushFrames();
      assert.equal(f.document.activeElement, f.outside); assert.deepEqual(f.focused, []);
      assert.deepEqual(f.writes, []);
    } finally { f.unmount(); }
  }
});

test("desktop collapse persists, narrow recovery leaves it intact, and hiding a focused list on return hands off safely", () => {
  const f = mount();
  try {
    f.collapse(); assert.equal(f.storage.get("edupi-object-sider-collapsed"), "true");
    f.resize(true); f.expand(); f.focus(f.search); f.resize(false);
    assert.equal(f.navigation.hidden, true); assert.equal(f.document.activeElement, f.restoreButton);
    assert.deepEqual(f.writes, [["edupi-object-sider-collapsed", "true"]]);
    f.expand(); assert.equal(f.navigation.hidden, false);
    assert.equal(f.storage.get("edupi-object-sider-collapsed"), "false");
  } finally { f.unmount(); }
  assert.equal(f.mediaListeners.size, 0);
});
