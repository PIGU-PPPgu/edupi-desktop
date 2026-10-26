import assert from "node:assert/strict";
import fs from "node:fs";
import vm from "node:vm";
import test from "node:test";
import ts from "typescript";
import { createJiti } from "jiti";

const jiti = createJiti(import.meta.url, { tsconfigPaths: true });
const names = ["edupi-work-case", "edupi-task-board", "edupi-task-category", "edupi-workbench", "edupi-teacher-task-form", "edupi-foreground", "edupi-recognition-markers", "edupi-calendar-model", "edupi-operation-history"];
const libraries = Object.fromEntries(await Promise.all(names.map(async name => [`@/lib/${name}`, await jiti.import(`../lib/${name}.ts`)])));
const { buildEducationContract } = await jiti.import("../lib/edupi-education-contract.ts");
const policy = { today: "2026-10-26", graceDays: 3, pinnedTaskIds: [] };
const textOf = node => node == null || typeof node === "boolean" ? "" : Array.isArray(node) ? node.map(textOf).join("") : typeof node === "object" ? textOf(node.props?.children) : String(node);
const nodes = node => Array.isArray(node) ? node.flatMap(nodes) : !node || typeof node !== "object" || !node.props ? [] : [node, ...nodes(node.props.children)];
const sources = Object.fromEntries(["EduPiWorkspaceBoard", "EduPiCalendarWorkspace"].map(name => [name, ts.transpileModule(fs.readFileSync(new URL(`./${name}.tsx`, import.meta.url), "utf8"), { compilerOptions: { module: ts.ModuleKind.CommonJS, jsx: ts.JsxEmit.ReactJSX, target: ts.ScriptTarget.ES2022 } }).outputText]));

function mount(name, initialProps = {}, controlled = true) {
  const slots = [], effects = new Map(), listeners = new Map(), frames = new Map();
  const calls = { routes: [], opens: [], moves: [], uploads: 0 };
  let cursor = 0, dirty = false, tree, frameId = 0, dropStage = null;
  const same = (a, b) => a && b && a.length === b.length && a.every((value, index) => Object.is(value, b[index]));
  const hooks = {
    useState(initial) {
      const index = cursor++;
      if (!slots[index]) {
        const slot = { value: typeof initial === "function" ? initial() : initial };
        slot.set = value => { const next = typeof value === "function" ? value(slot.value) : value; if (!Object.is(next, slot.value)) { slot.value = next; dirty = true; } };
        slots[index] = slot;
      }
      return [slots[index].value, slots[index].set];
    },
    useRef(initial) { const index = cursor++; slots[index] ??= { current: initial }; return slots[index]; },
    useMemo(factory, deps) { const index = cursor++; if (!slots[index] || !same(slots[index].deps, deps)) slots[index] = { deps, value: factory() }; return slots[index].value; },
    useEffect(callback, deps) { const index = cursor++; if (!slots[index] || !same(slots[index].deps, deps)) effects.set(index, { callback, deps }); },
  };
  const jsx = (type, props) => ({ type, props: props || {} });
  const modules = {
    ...libraries, react: hooks, "react/jsx-runtime": { jsx, jsxs: jsx },
    "./EduPiForeground": { useEduPiForegroundPolicy: () => policy, EduPiPagedRows: "paged-rows", EduPiListPreview: "list-preview" },
    "./EduPiTimetableGrid": { EduPiTimetableGrid: "timetable-grid" },
    "@/hooks/useModalDismiss": { useModalDismiss: () => hooks.useRef(null) },
    "./EduPiOperationHistory": { EduPiOperationHistory: "operation-history" },
    "./EduPiActionIcon": { EduPiIconButton: "icon-button" },
    "./EduPiScheduleConflictReview": { EduPiScheduleConflictReview: "conflict-review" },
  };
  class Input {}
  class Textarea {}
  class Select {}
  const exports = {};
  vm.runInNewContext(sources[name] + (name === "EduPiCalendarWorkspace" ? "\nexports.MonthView = MonthView; exports.WeekView = WeekView; exports.DayView = DayView;" : ""), {
    exports, URLSearchParams,
    require: dependency => { assert.ok(modules[dependency], dependency); return modules[dependency]; },
    window: { location: { search: "" }, addEventListener: (event, listener) => listeners.set(event, listener), removeEventListener: (event, listener) => { if (listeners.get(event) === listener) listeners.delete(event); } },
    document: { elementFromPoint: () => dropStage ? { closest: () => ({ dataset: { boardStage: dropStage } }) } : null },
    HTMLInputElement: Input, HTMLTextAreaElement: Textarea, HTMLSelectElement: Select,
    requestAnimationFrame: callback => { const id = ++frameId; frames.set(id, callback); return id; }, cancelAnimationFrame: id => frames.delete(id),
  });
  const data = buildEducationContract({ tasks: [
    { id: "teaching", title: "合成备课任务", trigger: "teaching_before_class", status: "planned", due_date: "2026-10-27", evidence: {} },
    { id: "student", title: "合成学生跟进", trigger: "student_follow_up", status: "planned", due_date: "2026-10-27", evidence: {} },
  ] });
  const props = {
    data, query: "", selectedObjectId: controlled ? null : undefined, intakeBusy: false, selection: null,
    onTaskDetail: task => calls.opens.push(task.id), onCreateTask: async () => ({}), onMoveTask: async (task, stage) => calls.moves.push([task.id, stage]),
    onSelect() {}, onImportCalendar() {}, onImportTimetable() {}, onDeleteEntity() {}, onUpload: () => { calls.uploads += 1; },
    onObject: route => { calls.routes.push(route); if (controlled) props.selectedObjectId = route; },
    ...initialProps,
  };
  const render = () => {
    let attempts = 0;
    do {
      assert.ok(attempts++ < 25, "effects settle");
      cursor = 0; dirty = false; tree = exports[name](props);
      const pending = [...effects]; effects.clear();
      for (const [index, effect] of pending) { slots[index]?.cleanup?.(); slots[index] = { deps: effect.deps, cleanup: effect.callback() }; }
    } while (dirty);
    return tree;
  };
  return {
    calls, exports, props, listeners, Input, Textarea, Select, render,
    setProps(value) { Object.assign(props, value); return render(); },
    button(label) { const found = nodes(render()).find(node => node.type === "button" && (textOf(node) === label || node.props["aria-label"] === label)); assert.ok(found, `button ${label}`); return found; },
    select(label) { const found = nodes(render()).find(node => node.type === "select" && node.props["aria-label"] === label); assert.ok(found, `select ${label}`); return found; },
    card(id = "teaching") { const found = nodes(render()).find(node => typeof node.type === "function" && node.type.name === "TaskCard" && node.props.task.id === id); assert.ok(found, `card ${id}`); return found.type(found.props); },
    setDropStage(value) { dropStage = value; },
    keyboard(key, overrides = {}) { render(); let prevented = 0; const event = { key, target: {}, preventDefault() { prevented += 1; }, ...overrides }; listeners.get("keydown")?.(event); render(); return prevented; },
    unmount() { for (const slot of slots) slot?.cleanup?.(); },
  };
}

function category(app) { return nodes(app.render()).find(node => node.type === "div" && node.props["aria-label"] === "任务类型").props.children; }
function currentCategory(app) { return nodes(category(app)).find(node => node.type === "button" && node.props["aria-pressed"])?.props.children[0]?.trim(); }
function clickCategory(app, label) { const button = nodes(category(app)).find(node => node.type === "button" && textOf(node).startsWith(label)); assert.ok(button); button.props.onClick(); app.render(); }
const cardButton = card => nodes(card).find(node => node.type === "button" && node.props.className === "edupi-task-board-card__open");
const pointer = (x, y, select = false) => ({ clientX: x, clientY: y, target: { closest: () => select ? {} : null }, currentTarget: { getBoundingClientRect: () => ({ x: 0, y: 0, width: 240 }) } });

test("board category and list callbacks round trip through the route and plain routes reset all", () => {
  const app = mount("EduPiWorkspaceBoard");
  clickCategory(app, "学生跟进");
  assert.equal(app.calls.routes.at(-1), "workspace:board:student");
  assert.equal(currentCategory(app), "学生跟进");
  app.button("历史 2").props.onClick();
  assert.equal(app.calls.routes.at(-1), "workspace:list:history:student");
  assert.equal(app.select("任务类型").props.value, "student");
  app.select("列表状态").props.onChange({ target: { value: "progress" } });
  assert.equal(app.calls.routes.at(-1), "workspace:list:progress:student");
  app.select("任务类型").props.onChange({ target: { value: "all" } });
  assert.equal(app.calls.routes.at(-1), "workspace:list:progress");
  assert.equal(app.select("任务类型").props.value, "all");
  app.setProps({ selectedObjectId: "workspace:list:history:teaching" });
  assert.equal(app.select("任务类型").props.value, "teaching");
  app.setProps({ selectedObjectId: "workspace:list:all" });
  assert.equal(app.select("任务类型").props.value, "all");
  app.setProps({ selectedObjectId: "workspace:board" });
  assert.equal(currentCategory(app), "全部");
  app.setProps({ selectedObjectId: null });
  assert.equal(currentCategory(app), "全部");
});

test("explicit board routes win over the local history fallback while an uncontrolled board still navigates", () => {
  const app = mount("EduPiWorkspaceBoard", {}, false);
  app.button("历史 2").props.onClick();
  assert.equal(app.select("列表状态").props.value, "history");
  app.setProps({ selectedObjectId: "workspace:board:teaching" });
  assert.equal(currentCategory(app), "教学准备");
  app.setProps({ selectedObjectId: "workspace:board" });
  assert.equal(currentCategory(app), "全部");
});

test("the same main task button opens with one mouse click or keyboard activation", () => {
  const app = mount("EduPiWorkspaceBoard");
  const button = cardButton(app.card());
  assert.doesNotMatch(button.props["aria-label"], /双击/);
  assert.equal(button.props.onDoubleClick, undefined);
  button.props.onClick({ detail: 1 });
  button.props.onClick({ detail: 0 });
  assert.deepEqual(app.calls.opens, ["teaching", "teaching"]);
});

test("the pointer threshold retains normal clicks and a completed drag suppresses its following click", async () => {
  const app = mount("EduPiWorkspaceBoard");
  app.card().props.onPointerDown(pointer(10, 10));
  app.render().props.onPointerMove(pointer(16, 10));
  cardButton(app.card()).props.onClick({ detail: 1 });
  assert.deepEqual(app.calls.opens, ["teaching"]);
  app.card().props.onPointerDown(pointer(10, 10));
  app.setDropStage("progress");
  app.render().props.onPointerMove(pointer(17, 10));
  app.render().props.onPointerUp(pointer(17, 10));
  cardButton(app.card()).props.onClick({ detail: 1 });
  assert.deepEqual(app.calls.opens, ["teaching"]);
  await new Promise(resolve => setImmediate(resolve));
  app.render();
  assert.deepEqual(app.calls.moves, [["teaching", "progress"]]);
  app.card().props.onPointerDown(pointer(10, 10));
  cardButton(app.card()).props.onClick({ detail: 1 });
  assert.deepEqual(app.calls.opens, ["teaching", "teaching"]);
});

test("task move dropdown stays independent of the main-card action", async () => {
  const app = mount("EduPiWorkspaceBoard");
  app.card().props.onPointerDown(pointer(10, 10, true));
  app.render().props.onPointerMove(pointer(30, 10));
  const select = nodes(app.card()).find(node => node.type === "select");
  select.props.onChange({ target: { value: "progress" } });
  await new Promise(resolve => setImmediate(resolve));
  assert.deepEqual(app.calls.opens, []);
  assert.deepEqual(app.calls.moves, [["teaching", "progress"]]);
});

function calendarState(app) {
  const tree = app.render();
  const view = nodes(tree).find(node => node.type === "div" && node.props["aria-label"] === "切换日程视图");
  return { view: nodes(view).find(node => node.type === "button" && node.props["aria-pressed"])?.props.children[0], period: textOf(nodes(tree).find(node => node.props.className === "edupi-calendar-period-title")) };
}

test("calendar shortcuts operate on the page and release the real listener on unmount", () => {
  const app = mount("EduPiCalendarWorkspace");
  assert.equal(app.keyboard("1"), 1); assert.equal(calendarState(app).view, "日");
  assert.equal(app.keyboard("2"), 1); assert.equal(calendarState(app).view, "周");
  assert.equal(app.keyboard("3"), 1); assert.equal(calendarState(app).view, "月");
  const today = calendarState(app).period;
  app.button("下一时段").props.onClick();
  assert.notEqual(calendarState(app).period, today);
  assert.equal(app.keyboard("T"), 1); assert.equal(calendarState(app).period, today);
  app.unmount(); assert.equal(app.listeners.has("keydown"), false);
});

test("calendar ignores consumed, composing, modified, input, and dialog keyboard events", () => {
  const app = mount("EduPiCalendarWorkspace");
  const blocked = [
    { defaultPrevented: true }, { isComposing: true }, { metaKey: true }, { ctrlKey: true }, { altKey: true },
    { target: new app.Input() }, { target: new app.Textarea() }, { target: new app.Select() },
    { target: { isContentEditable: true } }, { target: { closest: () => ({ role: "dialog" }) } },
  ];
  for (const overrides of blocked) for (const key of ["1", "2", "3", "t"]) {
    app.keyboard(key === "1" ? "2" : "1");
    app.button("下一时段").props.onClick();
    const before = calendarState(app);
    assert.equal(app.keyboard(key, overrides), 0, JSON.stringify({ key, overrides }));
    assert.deepEqual(calendarState(app), before, `blocked ${key}`);
  }
});

test("calendar list navigation obeys explicit return routes and content filters keep their chosen mode", () => {
  const app = mount("EduPiCalendarWorkspace");
  app.button("列表").props.onClick();
  assert.equal(app.calls.routes.at(-1), "calendar:list");
  assert.equal(app.button("日历").props["aria-pressed"], true);
  app.setProps({ selectedObjectId: "calendar:calendar" });
  assert.equal(app.button("列表").props["aria-pressed"], false);
  app.setProps({ selectedObjectId: "calendar:list:events" });
  assert.equal(app.button("校历").props["aria-pressed"], true);
  app.button("汇总").props.onClick();
  assert.equal(app.calls.routes.at(-1), "calendar:calendar");
  assert.equal(app.button("汇总").props["aria-pressed"], true);
  assert.equal(app.button("列表").props["aria-pressed"], false);
  app.button("列表").props.onClick();
  app.button("日历").props.onClick();
  assert.equal(app.calls.routes.at(-1), "calendar:calendar");
  app.setProps({ selectedObjectId: "calendar:list:courses" });
  app.button("校历").props.onClick();
  assert.equal(app.calls.routes.at(-1), "calendar:calendar");
  assert.equal(app.button("校历").props["aria-pressed"], true);
  assert.equal(app.button("列表").props["aria-pressed"], false);
});

test("an uncontrolled calendar list cannot cover a later explicit calendar route", () => {
  const app = mount("EduPiCalendarWorkspace", {}, false);
  app.button("列表").props.onClick();
  assert.equal(app.button("日历").props["aria-pressed"], true);
  app.setProps({ selectedObjectId: "calendar:calendar" });
  assert.equal(app.button("列表").props["aria-pressed"], false);
});

test("month single-day task entries use compact rows with complete accessible source and status", () => {
  const app = mount("EduPiCalendarWorkspace");
  const entry = { id: "day-task", kind: "task", sourceId: "sample", title: "合成完整任务标题", date: "2026-10-26", rangeStart: "2026-10-26", rangeEnd: "2026-10-26", sourceLabel: "教师任务", statusLabel: "待处理", sourceIcon: "任", status: "planned", allDay: true, continuesBefore: false, continuesAfter: false };
  const cross = { ...entry, id: "span-calendar", kind: "calendar", date: "2026-10-27", rangeStart: "2026-10-26", rangeEnd: "2026-10-28", continuesBefore: true, continuesAfter: true };
  const crossTask = { ...cross, id: "span-task", kind: "task" };
  const projection = { monthGrid: [{ date: entry.date, day: 26, isCurrentMonth: true, weekNumber: 1 }, { date: cross.date, day: 27, isCurrentMonth: true, weekNumber: 1 }], entriesByDate: { [entry.date]: [entry], [cross.date]: [cross, crossTask] }, range: { start: entry.date, end: "2026-11-01" } };
  const month = app.exports.MonthView({ projection, anchorDate: entry.date, selection: null, onSelectDate() {}, onSelect() {}, onTaskDetail() {} });
  const lines = nodes(month).filter(node => typeof node.type === "function" && node.type.name === "CalendarEntryLine");
  const singleLine = lines.find(node => node.props.entry.id === entry.id);
  assert.equal(singleLine.props.compact, true);
  const singleButton = singleLine.type(singleLine.props);
  assert.match(singleButton.props.className, /is-compact/);
  assert.match(singleButton.props["aria-label"], /合成完整任务标题.*教师任务.*待处理/);
  assert.equal(lines.find(node => node.props.entry.id === cross.id).props.continued, true);
  assert.equal(lines.find(node => node.props.entry.id === crossTask.id).props.compact, false);
  for (const name of ["WeekView", "DayView"]) {
    const view = app.exports[name]({ projection, anchorDate: entry.date, selection: null, onSelectDate() {}, onSelect() {}, onTaskDetail() {} });
    const list = nodes(view).find(node => node.type === "list-preview" || node.type === "paged-rows");
    assert.equal(list.props.renderRow(entry).props.compact, undefined, name);
  }
});

test("page primary actions and segmented controls are explicit", () => {
  const board = mount("EduPiWorkspaceBoard"), calendar = mount("EduPiCalendarWorkspace");
  assert.equal(board.button("新建任务").props.className, "is-primary");
  assert.equal(calendar.button("新建日程").props.className, "is-primary");
  assert.notEqual(calendar.button("上传文件").props.className, "is-primary");
  assert.notEqual(calendar.button("添加课表").props.className, "is-primary");
  for (const app of [board, calendar]) assert.ok(nodes(app.render()).some(node => String(node.props.className || "").includes("edupi-segmented-control")));
});
