import assert from "node:assert/strict";
import fs from "node:fs";
import vm from "node:vm";
import test from "node:test";
import ts from "typescript";
import { createJiti } from "jiti";

const jiti = createJiti(import.meta.url, { tsconfigPaths: true });
const names = ["edupi-work-case", "edupi-task-board", "edupi-task-category", "edupi-workbench", "edupi-teacher-task-form", "edupi-foreground", "edupi-recognition-markers", "edupi-calendar-model", "edupi-calendar-form-time", "edupi-operation-history"];
const libraries = Object.fromEntries(await Promise.all(names.map(async name => [`@/lib/${name}`, await jiti.import(`../lib/${name}.ts`)])));
const { buildEducationContract } = await jiti.import("../lib/edupi-education-contract.ts");
const policy = { today: "2026-10-26", graceDays: 3, pinnedTaskIds: [] };
const textOf = node => node == null || typeof node === "boolean" ? "" : Array.isArray(node) ? node.map(textOf).join("") : typeof node === "object" ? textOf(node.props?.children) : String(node);
const nodes = node => Array.isArray(node) ? node.flatMap(nodes) : !node || typeof node !== "object" || !node.props ? [] : [node, ...nodes(node.props.children)];
const sources = Object.fromEntries(["EduPiWorkspaceBoard", "EduPiCalendarWorkspace"].map(name => [name, ts.transpileModule(fs.readFileSync(new URL(`./${name}.tsx`, import.meta.url), "utf8"), { compilerOptions: { module: ts.ModuleKind.CommonJS, jsx: ts.JsxEmit.ReactJSX, target: ts.ScriptTarget.ES2022 } }).outputText]));

function mount(name, initialProps = {}, controlled = true, componentName = name, environment = {}) {
  const slots = [], effects = new Map(), listeners = new Map(), frames = new Map();
  const calls = { routes: [], opens: [], moves: [], uploads: 0 };
  let cursor = 0, dirty = false, tree, frameId = 0, dropStage = null, uuid = 0;
  const same = (a, b) => a && b && a.length === b.length && a.every((value, index) => Object.is(value, b[index]));
  const hooks = {
    useState(initial) {
      const index = cursor++;
      if (!slots[index]) {
        const slot = { value: typeof initial === "function" ? initial() : initial };
        slot.set = value => { const next = typeof value === "function" ? value(slot.value) : value; if (!Object.is(next, slot.value)) { slot.value = next; dirty = true; environment.onStateChange?.(next); } };
        slots[index] = slot;
      }
      return [slots[index].value, slots[index].set];
    },
    useRef(initial) { const index = cursor++; slots[index] ??= { current: initial }; return slots[index]; },
    useMemo(factory, deps) { const index = cursor++; if (!slots[index] || !same(slots[index].deps, deps)) slots[index] = { deps, value: factory() }; return slots[index].value; },
    useEffect(callback, deps) { const index = cursor++; if (!slots[index] || !same(slots[index].deps, deps)) effects.set(index, { callback, deps }); },
  };
  const jsx = (type, props, key) => ({ type, props: props || {}, key });
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
  vm.runInNewContext(sources[name] + (name === "EduPiCalendarWorkspace" ? "\nexports.MonthView = MonthView; exports.WeekView = WeekView; exports.DayView = DayView; exports.IntakeComposer = IntakeComposer; exports.CalendarDetailDrawer = CalendarDetailDrawer;" : ""), {
    exports, URLSearchParams,
    crypto: { randomUUID: () => `synthetic-occurrence-${++uuid}` },
    FormData: environment.FormData || class { constructor(form) { this.values = { ...form.values }; } get(key) { return this.values[key] ?? null; } },
    require: dependency => { assert.ok(modules[dependency], dependency); return modules[dependency]; },
    window: { location: { search: "" }, addEventListener: (event, listener) => listeners.set(event, listener), removeEventListener: (event, listener) => { if (listeners.get(event) === listener) listeners.delete(event); } },
    document: environment.document || { elementFromPoint: () => dropStage ? { closest: () => ({ dataset: { boardStage: dropStage } }) } : null },
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
      cursor = 0; dirty = false; tree = exports[componentName](props);
      environment.commit?.(tree);
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
  app.button("历史 1").props.onClick();
  assert.equal(app.calls.routes.at(-1), "workspace:list:history:student");
  assert.equal(app.select("任务类型").props.value, "student");
  app.button("← 工作区").props.onClick();
  assert.equal(app.calls.routes.at(-1), "workspace:board:student");
  assert.equal(currentCategory(app), "学生跟进");
  app.button("历史 1").props.onClick();
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

test("history count matches the category and search results that its action opens", () => {
  const app = mount("EduPiWorkspaceBoard", { query: "备课" });
  app.button("历史 1").props.onClick();
  const list = nodes(app.render()).find(node => node.type === "paged-rows");
  assert.deepEqual(Array.from(list.props.rows, task => task.id), ["teaching"]);
  app.button("← 工作区").props.onClick();
  clickCategory(app, "学生跟进");
  app.button("历史 0").props.onClick();
  assert.equal(nodes(app.render()).find(node => node.type === "paged-rows").props.rows.length, 0);
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

function intake(initialProps = {}, environment = {}) {
  const calls = { calendar: [], timetable: [], closes: 0 };
  const draft = {};
  const app = mount("EduPiCalendarWorkspace", {
    mode: "calendar", anchorDate: "2026-10-27", busy: false,
    onClose: () => { calls.closes += 1; },
    onImportCalendar: async value => { calls.calendar.push(JSON.parse(JSON.stringify(value))); },
    onImportTimetable: async value => { calls.timetable.push(JSON.parse(JSON.stringify(value))); },
    ...initialProps,
  }, true, "IntakeComposer", environment);
  const field = name => nodes(app.render()).find(node => ["input", "select", "textarea"].includes(node.type) && (node.props.name === name || node.props["aria-label"] === name));
  const fieldset = () => nodes(app.render()).find(node => node.type === "fieldset");
  const values = () => Object.fromEntries(nodes(app.render()).filter(node => ["input", "select", "textarea"].includes(node.type) && node.props.name).map(node => {
    const name = node.props.name;
    if (node.props.value !== undefined) draft[name] = node.props.value;
    else if (!(name in draft)) draft[name] = node.props.defaultValue ?? "";
    return [name, draft[name]];
  }));
  return {
    ...app, calls, field, fieldset, values,
    change(name, value) { const item = field(name); assert.ok(item, `field ${name}`); assert.ok(!fieldset()?.props.disabled, `disabled field ${name}`); item.props.onChange({ target: item.props.type === "checkbox" ? { checked: value } : { value } }); app.render(); },
    async submit(overrides = {}) {
      const snapshot = values();
      if (!fieldset()?.props.disabled) Object.assign(draft, overrides);
      nodes(app.render()).find(node => node.type === "form").props.onSubmit({ preventDefault() {}, currentTarget: { values: { ...snapshot, ...draft } } });
      await new Promise(resolve => setImmediate(resolve));
      app.render();
    },
    error: () => textOf(nodes(app.render()).find(node => node.props.role === "alert")),
  };
}

const savedCalendar = overrides => ({ id: "synthetic-event", name: "合成教研", date: "2026-10-27", endDate: null, type: "meeting", notes: "合成备注", occurrenceRef: "synthetic-stable-occurrence", startsAt: "2026-10-27T09:00-04:00", endsAt: "2026-10-27T10:00-04:00", timeZone: "US/Eastern", location: "合成会议室", ...overrides });

test("calendar intake starts all-day and saves inclusive dates without an interval", async () => {
  const app = intake();
  assert.equal(app.field("allDay").props.checked, true);
  assert.equal(app.field("startTime"), undefined);
  assert.equal(app.field("timeZone"), undefined);
  await app.submit({ name: "合成多日活动", endDate: "2026-10-30", notes: "仅供验收", location: "合成教室" });
  assert.deepEqual(app.calls.calendar, [{ eventId: null, date: "2026-10-27", endDate: "2026-10-30", name: "合成多日活动", type: "custom", notes: "仅供验收", sourceOccurrenceRef: "manual-synthetic-occurrence-1", startAt: null, endAt: null, timeZone: null, location: "合成教室" }]);
  assert.equal(app.calls.closes, 1);
});

test("calendar clock and timezone drafts survive disclosure and all-day toggles", async () => {
  const app = intake();
  app.change("allDay", false);
  for (const name of ["startTime", "endTime"]) {
    assert.equal(app.field(name).props.type, "time");
    assert.equal(app.field(name).props.step, 60);
  }
  app.change("startTime", "09:15"); app.change("endTime", "10:45");
  app.button("时区").props.onClick(); app.render();
  app.change("timeZone", "Asia/Kathmandu");
  app.button("时区").props.onClick(); app.render();
  assert.equal(app.field("timeZone"), undefined);
  app.change("allDay", true);
  assert.equal(app.field("startTime"), undefined);
  app.change("allDay", false);
  assert.equal(app.field("startTime").props.value, "09:15");
  assert.equal(app.field("endTime").props.value, "10:45");
  app.button("时区").props.onClick(); app.render();
  assert.equal(app.field("timeZone").props.value, "Asia/Kathmandu");
  await app.submit({ name: "合成定时日程", date: "2026-10-29" });
  assert.equal(app.calls.calendar[0].startAt, "2026-10-29T09:15+05:45");
  assert.equal(app.calls.calendar[0].endAt, "2026-10-29T10:45+05:45");
  assert.equal(app.calls.calendar[0].timeZone, "Asia/Kathmandu");
});

test("editing a timed event preserves its original identity, offset, zone alias and null end date", async () => {
  const event = savedCalendar();
  const app = intake({ calendarEvent: event });
  assert.equal(app.field("allDay"), undefined, "the current owner cannot clear an existing interval");
  assert.equal(app.field("startTime").props.value, "09:00");
  app.button("时区").props.onClick(); app.render();
  assert.equal(app.field("timeZone").props.value, "US/Eastern");
  assert.ok(nodes(app.field("timeZone")).some(node => node.type === "option" && node.props.value === "US/Eastern"));
  app.button("时区").props.onClick(); app.render();
  await app.submit({ name: "合成更名", notes: "合成新备注" });
  assert.deepEqual(app.calls.calendar[0], { eventId: event.id, date: event.date, endDate: null, name: "合成更名", type: "meeting", notes: "合成新备注", sourceOccurrenceRef: event.occurrenceRef, startAt: event.startsAt, endAt: event.endsAt, timeZone: event.timeZone, location: event.location });
});

test("legacy and date-only occurrence edits retain their original identity and date semantics", async () => {
  const legacy = intake({ calendarEvent: savedCalendar({ occurrenceRef: null, startsAt: null, endsAt: null, timeZone: null, endDate: "2026-10-29" }) });
  assert.equal(legacy.field("allDay"), undefined);
  assert.equal(legacy.field("startTime"), undefined);
  await legacy.submit({ name: "合成旧记录修改" });
  assert.equal(legacy.calls.calendar[0].eventId, "synthetic-event");
  assert.equal(legacy.calls.calendar[0].sourceOccurrenceRef, null);
  assert.equal(legacy.calls.calendar[0].endDate, "2026-10-29");
  assert.equal(legacy.calls.calendar[0].startAt, null);
  const occurrence = intake({ calendarEvent: savedCalendar({ startsAt: null, endsAt: null, timeZone: null }) });
  assert.equal(occurrence.field("allDay").props.checked, true);
  await occurrence.submit();
  assert.equal(occurrence.calls.calendar[0].sourceOccurrenceRef, "synthetic-stable-occurrence");
  assert.equal(occurrence.calls.calendar[0].endDate, null);
});

test("calendar invalid intervals keep the draft and do not submit or close", async () => {
  const app = intake(); app.change("allDay", false);
  app.change("startTime", "09:15"); app.change("endTime", "10:45");
  await app.submit({ endDate: "2026-10-28" });
  assert.match(app.error(), /同一天/);
  assert.equal(app.field("startTime").props.value, "09:15");
  assert.equal(app.calls.calendar.length, 0);
  app.button("时区").props.onClick(); app.render(); app.change("timeZone", "America/New_York");
  app.change("startTime", "01:30"); app.change("endTime", "02:30");
  await app.submit({ date: "2026-11-01", endDate: "" });
  assert.match(app.error(), /不存在或不唯一/);
  assert.equal(app.field("startTime").props.value, "01:30");
  assert.equal(app.calls.calendar.length, 0);
  assert.equal(app.calls.closes, 0);
});

test("calendar save retry retains its occurrence identity and time draft after an async error", async () => {
  let attempts = 0;
  const submitted = [];
  const app = intake({ onImportCalendar: async value => { submitted.push(JSON.parse(JSON.stringify(value))); if (++attempts === 1) throw new Error("synthetic offline"); } });
  app.change("allDay", false); app.change("startTime", "09:00"); app.change("endTime", "10:00");
  app.button("时区").props.onClick(); app.render(); app.change("timeZone", "UTC");
  await app.submit({ name: "合成重试日程" });
  assert.match(app.error(), /接入失败/);
  assert.equal(app.calls.closes, 0);
  assert.equal(app.field("startTime").props.value, "09:00");
  app.setProps({ busy: true }); await app.submit(); assert.equal(attempts, 1);
  app.setProps({ busy: false }); await app.submit({ name: "合成重试日程" });
  assert.equal(attempts, 2);
  assert.deepEqual(submitted[0], submitted[1]);
  assert.equal(app.calls.closes, 1);
  assert.equal(app.error(), "");
});

test("calendar cancel never submits and timetable intake retains its existing contract", async () => {
  const calendar = intake(); calendar.change("allDay", false); calendar.change("startTime", "08:00");
  calendar.button("取消").props.onClick();
  assert.equal(calendar.calls.closes, 1);
  assert.equal(calendar.calls.calendar.length, 0);
  const timetable = intake({ mode: "timetable", timetableSlot: { slot_id: "synthetic-slot", day_of_week: 4, period: 2, subject: "数学", class_id: "ui-a", class_name: "UI验收A班", start_time: "09:15", time_zone: "UTC", kind: "class", notes: "合成课表" } });
  assert.equal(timetable.field("allDay"), undefined);
  assert.equal(timetable.field("startTime").props.type, "time");
  await timetable.submit();
  assert.deepEqual(timetable.calls.timetable, [{ slotId: "synthetic-slot", dayOfWeek: 4, period: 2, subject: "数学", classId: "ui-a", className: "UI验收A班", startTime: "09:15", timeZone: "UTC", kind: "class", notes: "合成课表" }]);
  assert.equal(timetable.calls.closes, 1);
});

test("timezone search does not change the current value or display a different first option", async () => {
  const app = intake(); app.change("allDay", false); app.change("startTime", "09:00"); app.change("endTime", "10:00");
  app.button("时区").props.onClick(); app.render(); app.change("timeZone", "UTC");
  assert.equal(app.field("timeZone").props.size, 6);
  app.change("搜索时区", "tokyo");
  assert.equal(app.field("timeZone").props.value, "UTC");
  assert.deepEqual(Array.from(nodes(app.field("timeZone")).filter(node => node.type === "option"), node => node.props.value), ["UTC", "Asia/Tokyo"]);
  app.change("搜索时区", "not-an-iana-zone");
  assert.equal(textOf(nodes(app.render()).find(node => node.props.role === "status")), "无匹配时区");
  assert.deepEqual(Array.from(nodes(app.field("timeZone")).filter(node => node.type === "option"), node => node.props.value), ["UTC"]);
  assert.equal(app.field("timeZone").props.value, "UTC");
  app.button("时区").props.onClick(); app.render(); assert.equal(app.field("搜索时区"), undefined);
  app.change("allDay", true); app.change("allDay", false); app.button("时区").props.onClick(); app.render();
  assert.equal(app.field("搜索时区").props.value, "not-an-iana-zone");
  assert.equal(app.field("timeZone").props.value, "UTC");
  app.change("搜索时区", "");
  assert.ok(nodes(app.field("timeZone")).filter(node => node.type === "option").length > 100);
  await app.submit();
  assert.equal(app.calls.calendar[0].timeZone, "UTC");
});

test("timezone search offers valid aliases outside the catalog and keeps the selected alias across drafts", async () => {
  const app = intake(); app.change("allDay", false); app.change("startTime", "09:00"); app.change("endTime", "10:00");
  app.button("时区").props.onClick(); app.render();
  app.change("搜索时区", " US/Pacific ");
  assert.ok(nodes(app.field("timeZone")).some(node => node.type === "option" && node.props.value === "US/Pacific"));
  app.change("timeZone", "US/Pacific"); app.change("搜索时区", "Europe");
  assert.equal(app.field("timeZone").props.value, "US/Pacific");
  assert.equal(nodes(app.field("timeZone")).filter(node => node.type === "option")[0].props.value, "US/Pacific");
  app.change("allDay", true); app.change("allDay", false);
  assert.equal(app.field("timeZone").props.value, "US/Pacific");
  assert.equal(app.field("搜索时区").props.value, "Europe");
  await app.submit();
  assert.equal(app.calls.calendar[0].timeZone, "US/Pacific");
  assert.equal(app.calls.calendar[0].startAt, "2026-10-27T09:00-07:00");
});

test("calendar detail uses saved wall clocks without repeating same-day dates or offsets", () => {
  const event = savedCalendar({ startsAt: "2026-10-27T09:15+00:00", endsAt: "2026-10-27T10:30+00:00", timeZone: "UTC" });
  const app = mount("EduPiCalendarWorkspace");
  const detail = app.exports.CalendarDetailDrawer({ data: { ...app.props.data, calendar: [event] }, selection: { kind: "calendar", sourceId: event.id, date: event.date, title: event.name, sourceLabel: "教师", statusLabel: "已确认" }, onClose() {} });
  const rows = nodes(detail).filter(node => node.type === "div" && node.props.children?.[0]?.type === "dt");
  const values = Object.fromEntries(rows.map(node => [textOf(node.props.children[0]), textOf(node.props.children[1])]));
  assert.equal(values["日期"], "2026-10-27"); assert.equal(values["开始时间"], "09:15"); assert.equal(values["结束时间"], "10:30"); assert.equal(values["时区"], "UTC");
  assert.equal(event.startsAt, "2026-10-27T09:15+00:00"); assert.equal(event.endsAt, "2026-10-27T10:30+00:00");
});

function focusDom() {
  const focused = [], focusListeners = new Set(), otherListeners = new Map();
  const document = { body: { name: "body" }, documentElement: { name: "html" }, activeElement: null,
    addEventListener(name, callback) { if (name === "focusin") focusListeners.add(callback); else { if (!otherListeners.has(name)) otherListeners.set(name, new Set()); otherListeners.get(name).add(callback); } },
    removeEventListener(name, callback) { if (name === "focusin") focusListeners.delete(callback); else otherListeners.get(name)?.delete(callback); },
  };
  const move = target => { document.activeElement = target; for (const callback of focusListeners) callback({ target }); return target; };
  document.activeElement = document.body;
  const element = (name, group = "form") => ({ name, group, ownerDocument: document, isConnected: true, disabled: false, focus() { if (!this.isConnected || this.disabled) return; focused.push(name); move(this); } });
  const inputs = Object.fromEntries(["name", "subject", "save", "cancel"].map(name => [name, element(name)]));
  const triggers = { calendar: element("new calendar", "trigger"), timetable: element("new timetable", "trigger"), edit: element("edit", "trigger"), delete: element("delete", "trigger") };
  const root = { ownerDocument: document, isConnected: true, contains: target => Boolean(target?.ownerDocument === document && target?.isConnected && target?.group !== "outside"), querySelector(selector) {
    if (selector === "[data-calendar-edit-trigger]") return triggers.edit.isConnected ? triggers.edit : null;
    if (selector === "[data-calendar-delete-trigger]") return triggers.delete.isConnected ? triggers.delete : null;
    if (selector === '[data-calendar-create="calendar"]') return triggers.calendar;
    if (selector === '[data-calendar-create="timetable"]') return triggers.timetable;
    if (selector.includes('input[name="name"]')) return inputs.name;
    if (selector.includes('input[name="subject"]')) return inputs.subject;
    throw new Error(`unexpected selector ${selector}`);
  } };
  const section = { ownerDocument: document, isConnected: true, contains: target => target?.ownerDocument === document && target?.group === "form" && target?.isConnected };
  return { document, root, section, focused, focusListeners, inputs, triggers, move, outside: () => move({ name: "another control", isConnected: true }), fire(name, event) { for (const listener of otherListeners.get(name) || []) listener(event); }, get otherListenerCount() { return [...otherListeners.values()].reduce((sum, listeners) => sum + listeners.size, 0); },
    commit(tree) {
      if (tree.props.ref) tree.props.ref.current = tree.type === "main" ? root : section;
      if (tree.type !== "main") {
        const locked = nodes(tree).find(node => node.type === "fieldset")?.props.disabled;
        inputs.name.disabled = Boolean(locked); inputs.subject.disabled = Boolean(locked);
        inputs.save.disabled = Boolean(nodes(tree).find(node => node.type === "button" && node.props.type === "submit")?.props.disabled);
        if (document.activeElement?.ownerDocument === document && document.activeElement.disabled) move(document.body);
        return;
      }
      const drawer = nodes(tree).find(node => node.type?.name === "CalendarDetailDrawer");
      const editor = nodes(tree).find(node => node.type?.name === "IntakeComposer") || drawer?.props.editor;
      for (const input of Object.values(inputs)) input.isConnected = Boolean(editor);
      const editVisible = Boolean(drawer && !drawer.props.editor && drawer.props.onEdit);
      if (editVisible && !triggers.edit.isConnected) triggers.edit = element("returned edit", "trigger");
      triggers.edit.isConnected = editVisible;
      triggers.delete.isConnected = Boolean(drawer?.props.onDelete && !drawer.props.editor);
      triggers.delete.disabled = Boolean(drawer?.props.deleteBusy);
      if (document.activeElement?.ownerDocument === document && (!document.activeElement.isConnected || document.activeElement.disabled)) move(document.body);
    },
  };
}

function actualModal(dom, panel) {
  const hooks = [], exports = {};
  const code = ts.transpileModule(fs.readFileSync(new URL("../hooks/useModalDismiss.ts", import.meta.url), "utf8"), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText;
  vm.runInNewContext(code, { exports, document: dom.document, require: () => ({ useRef: value => ({ current: value }), useEffect: create => hooks.push(create) }) });
  exports.useModalDismiss(() => {}, true, { current: panel });
  const cleanup = hooks.map(create => create());
  return () => cleanup.forEach(stop => stop?.());
}

function calendarWithFocus(kind = "calendar") {
  const dom = focusDom();
  const data = buildEducationContract({ calendar: [{ id: "calendar-a", name: "合成日程A", date: "2026-10-27" }, { id: "calendar-b", name: "合成日程B", date: "2026-10-28" }], timetable: [{ slot_id: "slot-a", subject: "数学", day_of_week: 2, period: 1 }] });
  data.capabilities.calendar.enabled = true; data.capabilities.timetable.enabled = true;
  const selection = { kind, sourceId: kind === "calendar" ? "calendar-a" : "slot-a", date: "2026-10-27", title: "合成事项", sourceLabel: "教师", statusLabel: "已确认" };
  const app = mount("EduPiCalendarWorkspace", { data, selection }, true, "EduPiCalendarWorkspace", dom);
  const drawer = () => nodes(app.render()).find(node => node.type?.name === "CalendarDetailDrawer");
  const editor = () => nodes(app.render()).find(node => node.type?.name === "IntakeComposer") || drawer()?.props.editor;
  app.render();
  return { app, dom, drawer, editor,
    openNew(mode = "calendar") { dom.triggers[mode].focus(); app.button(mode === "calendar" ? "新建日程" : "添加课表").props.onClick(); app.render(); return editor(); },
    openEdit() { dom.triggers.edit.focus(); drawer().props.onEdit(); app.render(); return editor(); },
    close() { dom.inputs.cancel.focus(); editor().props.onClose({ from: dom.inputs.cancel, document: dom.document }); app.render(); },
  };
}

test("cancelled calendar and timetable detail editors return to the newly committed edit button", () => {
  for (const kind of ["calendar", "timetable"]) {
    const f = calendarWithFocus(kind), oldTrigger = f.dom.triggers.edit;
    f.openEdit(); assert.ok(f.editor());
    f.close();
    assert.equal(f.editor(), null);
    assert.notEqual(f.dom.triggers.edit, oldTrigger);
    assert.equal(f.dom.document.activeElement, f.dom.triggers.edit);
    assert.equal(f.app.button("新建日程").props.className, "is-primary");
  }
});

test("inline close returns to its own entry and the header is secondary while a draft is present", () => {
  for (const mode of ["calendar", "timetable"]) {
    const f = calendarWithFocus(); f.app.setProps({ selection: null });
    const first = f.openNew(mode);
    assert.ok(first); assert.notEqual(f.app.button("新建日程").props.className, "is-primary");
    f.app.button(mode === "calendar" ? "新建日程" : "添加课表").props.onClick(); f.app.render();
    assert.equal(f.editor().key, first.key, "repeat opening keeps the mounted draft identity");
    assert.equal(f.dom.document.activeElement, f.dom.inputs[mode === "calendar" ? "name" : "subject"]);
    f.close();
    assert.equal(f.dom.document.activeElement, f.dom.triggers[mode]);
    assert.equal(f.app.button("新建日程").props.className, "is-primary");
  }
});

test("calendar return focus waits for a pending parent refresh and respects later focus or object changes", () => {
  const pending = calendarWithFocus(); pending.openEdit(); pending.app.setProps({ intakeBusy: true }); pending.close();
  assert.equal(pending.dom.document.activeElement, pending.dom.document.body);
  assert.equal(pending.dom.focusListeners.size, 1);
  pending.app.setProps({ data: { ...pending.app.props.data } });
  assert.equal(pending.dom.focusListeners.size, 1);
  pending.app.setProps({ intakeBusy: false });
  assert.equal(pending.dom.document.activeElement, pending.dom.triggers.edit);
  assert.equal(pending.dom.focusListeners.size, 0);

  const moved = calendarWithFocus(); moved.openNew(); moved.app.setProps({ intakeBusy: true }); moved.close();
  moved.dom.outside(); moved.dom.move(moved.dom.document.body); moved.dom.focused.length = 0;
  moved.app.setProps({ intakeBusy: false });
  assert.deepEqual(moved.dom.focused, []);
  assert.equal(moved.dom.focusListeners.size, 0);

  const switched = calendarWithFocus(); switched.openEdit(); switched.app.setProps({ intakeBusy: true }); switched.close(); switched.dom.focused.length = 0;
  switched.app.setProps({ selection: { ...switched.app.props.selection, sourceId: "calendar-b", title: "合成日程B" }, intakeBusy: false });
  assert.deepEqual(switched.dom.focused, []);
  assert.equal(switched.dom.focusListeners.size, 0);
});

test("old calendar editor callbacks and newer focus cannot close or refocus a different object", () => {
  const f = calendarWithFocus(); const oldEditor = f.openEdit();
  f.app.setProps({ selection: { ...f.app.props.selection, sourceId: "calendar-b", title: "合成日程B" } });
  assert.equal(f.editor(), null);
  f.openEdit(); const secondEditor = f.editor();
  const outside = f.dom.outside(); f.dom.focused.length = 0;
  oldEditor.props.onClose({ from: f.dom.inputs.save, document: f.dom.document }); f.app.render();
  assert.equal(f.editor().key, secondEditor.key);
  assert.equal(f.dom.document.activeElement, outside);
  assert.deepEqual(f.dom.focused, []);
  f.editor().props.onClose(null); f.app.render();
  assert.equal(f.dom.document.activeElement, outside);
});

test("an unchanged inline editor can finish after list navigation without pulling focus back", () => {
  const f = calendarWithFocus(); f.app.setProps({ selection: null });
  const editor = f.openNew();
  f.app.setProps({ selectedObjectId: "calendar:list" });
  const outside = f.dom.outside(); f.dom.focused.length = 0;
  editor.props.onClose({ from: f.dom.inputs.save, document: f.dom.document }); f.app.render();
  assert.equal(f.editor(), undefined);
  assert.equal(f.dom.document.activeElement, outside);
  assert.deepEqual(f.dom.focused, []);
});

test("intake async completion only returns eligible focus and ignores unmounted or failed saves", async () => {
  for (const scenario of ["success", "moved", "unmounted", "failed"]) {
    const dom = focusDom(), closes = [];
    let finish, submissions = 0;
    const app = intake({ onClose: focus => closes.push(focus), onImportCalendar: () => new Promise((resolve, reject) => { submissions += 1; finish = scenario === "failed" ? () => reject(new Error("synthetic offline")) : resolve; }) }, dom);
    app.render(); dom.inputs.save.focus();
    await app.submit({ name: "合成异步验收" });
    await app.submit({ name: "合成重复点击" }); assert.equal(submissions, 1);
    assert.equal(dom.focusListeners.size, 1);
    if (scenario === "moved") { dom.outside(); dom.move(dom.document.body); }
    if (scenario === "unmounted") { app.unmount(); assert.equal(dom.focusListeners.size, 0); }
    finish(); await new Promise(resolve => setImmediate(resolve)); app.render();
    assert.equal(dom.focusListeners.size, 0);
    if (scenario === "success") { assert.equal(closes.length, 1); assert.equal(closes[0].from, dom.inputs.save); }
    else if (scenario === "moved") assert.deepEqual(closes, [null]);
    else assert.equal(closes.length, 0);
    if (scenario === "failed") assert.match(app.error(), /接入失败/);
  }
});

test("calendar intake forwards only an explicit held receipt with the submitted stable identity", async () => {
  for (const status of ["held", "accepted", undefined]) {
    const closes = [], app = intake({ calendarEvent: savedCalendar(), onImportCalendar: async () => status ? { status, evidenceIds: ["calendar-evidence-current"] } : undefined, onClose: (focus, target) => closes.push({ focus, target }) });
    await app.submit();
    assert.equal(closes.length, 1);
    if (status === "held") assert.deepEqual(JSON.parse(JSON.stringify(closes[0].target)), { canonicalId: "synthetic-event", occurrenceRef: "synthetic-stable-occurrence", evidenceIds: ["calendar-evidence-current"] });
    else assert.equal(closes[0].target, undefined);
  }
});

test("held calendar edits close their detail and request the existing review panel in the same scope", () => {
  const f = calendarWithFocus(); f.app.setProps({ onSelect: selection => { f.app.props.selection = selection; } });
  const editor = f.openEdit(); f.dom.inputs.save.focus();
  const target = { canonicalId: "calendar-a", occurrenceRef: "occurrence-a", evidenceIds: ["candidate-a"] };
  f.dom.focused.length = 0;
  editor.props.onClose({ from: f.dom.inputs.save, document: f.dom.document }, target); f.app.render();
  assert.equal(f.app.props.selection, null);
  assert.equal(f.editor(), undefined);
  const review = nodes(f.app.render()).find(node => node.type === "conflict-review");
  assert.equal(review.props.request.target, target);
  assert.equal(review.props.request.id, 1);
  assert.deepEqual(f.dom.focused, [], "the old edit button must not compete with the review panel");
  f.openNew();
  assert.equal(nodes(f.app.render()).find(node => node.type === "conflict-review").props.request, null);
});

test("held calendar responses do not redirect after route or object changes", () => {
  const target = { canonicalId: "calendar-a", occurrenceRef: "occurrence-a" };
  for (const change of ["route", "object"]) {
    const f = calendarWithFocus(); f.app.setProps({ onSelect: selection => { f.app.props.selection = selection; } });
    const editor = f.openEdit(); f.dom.inputs.save.focus();
    if (change === "route") f.app.setProps({ selectedObjectId: "calendar:list" });
    if (change === "object") f.app.setProps({ selection: { ...f.app.props.selection, sourceId: "calendar-b" } });
    editor.props.onClose({ from: f.dom.inputs.save, document: f.dom.document }, target); f.app.render();
    assert.equal(nodes(f.app.render()).find(node => node.type === "conflict-review").props.request, null, change);
  }
});

test("the same calendar held result can display review without taking a newer focus", () => {
  const f = calendarWithFocus(); f.app.setProps({ onSelect: selection => { f.app.props.selection = selection; } });
  const editor = f.openEdit(), outside = f.dom.outside(); f.dom.focused.length = 0;
  editor.props.onClose(null, { canonicalId: "calendar-a", occurrenceRef: "occurrence-a" }); f.app.render();
  const request = nodes(f.app.render()).find(node => node.type === "conflict-review").props.request;
  assert.ok(request); assert.equal(request.focus, false);
  assert.equal(f.dom.document.activeElement, outside); assert.deepEqual(f.dom.focused, []);
});

test("pending timetable saves lock every business field and a failed save restores the unchanged draft", async () => {
  const submitted = []; let finish, fail;
  const app = intake({ mode: "timetable", onImportTimetable: input => { submitted.push(JSON.parse(JSON.stringify(input))); return new Promise((resolve, reject) => { finish = resolve; fail = reject; }); } });
  assert.equal(app.field("period").props.min, 0); assert.equal(app.field("period").props.max, 64);
  await app.submit({ dayOfWeek: "3", period: "0", subject: "数学", className: "UI验收一班", classId: "ui-class-one", startTime: "09:00", timeZone: "Asia/Shanghai", notes: "合成完整草稿" });
  assert.equal(submitted[0].period, 0, "period zero remains a valid submitted value");
  assert.equal(app.fieldset().props.disabled, true, "the local request locks fields before parent busy changes");
  const tree = app.render(), fields = nodes(nodes(tree).find(node => node.type === "fieldset"));
  for (const field of nodes(tree).filter(node => ["input", "select", "textarea"].includes(node.type))) assert.ok(fields.includes(field), field.props.name);
  assert.equal(app.button("保存中…").props.disabled, true);
  assert.equal(fields.includes(nodes(tree).find(node => node.type === "button" && textOf(node) === "取消")), false); assert.notEqual(app.button("取消").props.disabled, true);
  app.setProps({ busy: true }); app.setProps({ busy: false });
  assert.equal(app.fieldset().props.disabled, true);
  await app.submit({ period: "1", subject: "不会被输入的草稿" });
  assert.equal(submitted.length, 1); assert.equal(app.values().period, "0");
  fail(new Error("synthetic offline")); await new Promise(resolve => setImmediate(resolve)); app.render();
  assert.equal(app.fieldset().props.disabled, false); assert.match(app.error(), /接入失败/);
  assert.deepEqual(app.values(), { dayOfWeek: "3", period: "0", subject: "数学", className: "UI验收一班", classId: "ui-class-one", startTime: "09:00", timeZone: "Asia/Shanghai", kind: "class", notes: "合成完整草稿" });
  await app.submit({ period: "1" }); assert.equal(submitted.length, 2); assert.equal(submitted[1].period, 1);
  finish(); await new Promise(resolve => setImmediate(resolve)); app.render(); assert.equal(app.calls.closes, 1);
});

test("fast held saves snapshot before locking and stay locked across delayed parent close commits", async () => {
  const order = [], submitted = [], closes = [];
  const app = intake({ onImportCalendar: async input => { order.push("owner"); submitted.push(input); return { status: "held", evidenceIds: ["held-evidence"] }; }, onClose: (focus, reviewTarget) => { order.push("close"); closes.push({ focus, reviewTarget }); } }, {
    onStateChange(value) { if (value === true) order.push("lock"); },
    FormData: class { constructor(form) { order.push("snapshot"); this.values = { ...form.values }; } get(name) { return this.values[name] ?? null; } },
  });
  app.change("allDay", false); app.change("startTime", "09:15"); app.change("endTime", "10:30");
  app.button("时区").props.onClick(); app.render(); app.change("timeZone", "UTC"); order.length = 0;
  await app.submit({ name: "合成快速提交", date: "2026-10-30", type: "meeting", location: "合成会议室", notes: "合成备注" });
  assert.deepEqual(order, ["snapshot", "lock", "owner", "close"]);
  assert.equal(submitted[0].name, "合成快速提交"); assert.equal(submitted[0].startAt, "2026-10-30T09:15+00:00");
  assert.equal(app.fieldset().props.disabled, true);
  assert.equal(app.field("name").props.autoFocus, true);
  const tree = app.render(), fields = nodes(nodes(tree).find(node => node.type === "fieldset"));
  for (const field of nodes(tree).filter(node => ["input", "select", "textarea"].includes(node.type))) assert.ok(fields.includes(field), field.props.name || field.props["aria-label"]);
  assert.throws(() => app.change("startTime", "11:15"), /disabled field/);
  app.setProps({ busy: true }); app.setProps({ busy: false });
  assert.equal(app.fieldset().props.disabled, true, "a resolved request must not unlock an editor still waiting to unmount");
  await app.submit({ name: "不会覆盖已提交内容" });
  assert.equal(submitted.length, 1); assert.equal(app.values().name, "合成快速提交");
  assert.equal(closes.length, 1); assert.equal(closes[0].reviewTarget.evidenceIds[0], "held-evidence");
});

test("parent busy locks calendar and timetable fields without blocking cancellation or later editing", async () => {
  for (const mode of ["calendar", "timetable"]) {
    const app = intake({ mode, busy: true });
    assert.equal(app.fieldset().props.disabled, true);
    await app.submit(); assert.equal(app.calls.calendar.length + app.calls.timetable.length, 0);
    assert.notEqual(app.button("取消").props.disabled, true);
    app.setProps({ busy: false }); assert.equal(app.fieldset().props.disabled, false);
    if (mode === "calendar") { app.change("allDay", false); app.change("startTime", "09:15"); assert.equal(app.field("startTime").props.value, "09:15"); }
    app.button("取消").props.onClick(); assert.equal(app.calls.closes, 1);
    assert.equal(app.calls.calendar.length + app.calls.timetable.length, 0);
  }
});

test("held navigation survives programmatic modal focus while the real child fields are locked", async () => {
  const f = calendarWithFocus(); f.app.setProps({ onSelect: selection => { f.app.props.selection = selection; } });
  f.app.setProps({ data: { ...f.app.props.data, calendar: f.app.props.data.calendar.map(event => event.id === "calendar-a" ? { ...event, occurrenceRef: "occurrence-a", startsAt: "2026-10-27T09:15-07:00", endsAt: "2026-10-27T10:30-07:00", timeZone: "US/Pacific" } : event) } });
  const editor = f.openEdit(); let finish;
  const child = intake({ ...editor.props, onImportCalendar: () => new Promise(resolve => { finish = resolve; }) }, f.dom);
  child.render(); f.dom.inputs.save.focus(); await child.submit({ notes: "[UI TEST] held handoff" });
  assert.equal(child.fieldset().props.disabled, true);
  f.app.setProps({ intakeBusy: true, data: { ...f.app.props.data, calendar: f.app.props.data.calendar.map(event => ({ ...event, preparationStatus: "hold" })) } });
  child.setProps({ ...f.editor().props, busy: true });

  // Exercise the actual modal hook's programmatic focus recovery, without a user key or pointer event.
  const document = f.dom.document, hooks = [], modalEvents = new Map(), exports = {};
  const add = document.addEventListener, remove = document.removeEventListener;
  document.addEventListener = (name, fn) => name === "focusin" ? add(name, fn) : modalEvents.set(name, fn);
  document.removeEventListener = (name, fn) => name === "focusin" ? remove(name, fn) : modalEvents.delete(name);
  const close = { ownerDocument: document, isConnected: true, name: "modal close", focus() { f.dom.move(this); } };
  const panel = { contains: element => element === close || f.dom.section.contains(element), querySelector: () => close };
  const modalCode = ts.transpileModule(fs.readFileSync(new URL("../hooks/useModalDismiss.ts", import.meta.url), "utf8"), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText;
  vm.runInNewContext(modalCode, { exports, document, require: () => ({ useRef: value => ({ current: value }), useEffect: create => hooks.push(create) }) });
  f.dom.move(document.body);
  exports.useModalDismiss(() => {}, true, { current: panel });
  const cleanups = hooks.map(create => create());
  assert.equal(document.activeElement, close);

  f.app.setProps({ intakeBusy: false }); child.setProps({ ...f.editor().props, busy: false });
  finish({ status: "held", evidenceIds: ["evidence-a"] }); await new Promise(resolve => setImmediate(resolve)); child.render(); f.app.render();
  cleanups.forEach(cleanup => cleanup?.()); document.addEventListener = add; document.removeEventListener = remove;
  close.isConnected = false; if (document.activeElement === close) f.dom.move(document.body);
  const review = nodes(f.app.render()).find(node => node.type === "conflict-review");
  assert.ok(review.props.request, "review navigation is independent of focus restoration eligibility");
  assert.equal(review.props.request.target.canonicalId, "calendar-a");
  assert.equal(review.props.request.focus, false);
  assert.equal(f.app.props.selection, null);
});

test("held review preserves an outside input through the real modal unmount restoration", () => {
  const f = calendarWithFocus(); f.app.setProps({ onSelect: selection => { f.app.props.selection = selection; } });
  const editor = f.openEdit(), document = f.dom.document;
  const close = { ownerDocument: document, isConnected: true, focus() { f.dom.move(this); } };
  f.dom.triggers.calendar.focus();
  const cleanup = actualModal(f.dom, { contains: element => element === close || f.dom.section.contains(element), querySelector: () => close });
  const outside = { ownerDocument: document, group: "outside", isConnected: true, focus() { f.dom.focused.push("outside input"); f.dom.move(this); } };
  outside.focus(); f.dom.focused.length = 0;
  editor.props.onClose(null, { canonicalId: "calendar-a", occurrenceRef: "occurrence-a" });
  cleanup(); f.app.render();
  assert.equal(document.activeElement, outside, "modal cleanup must not undo the user's newer outside focus");
  assert.equal(nodes(f.app.render()).find(node => node.type === "conflict-review").props.request.focus, false);
  assert.equal(f.dom.otherListenerCount, 0);
});

test("outside-focus preservation yields to newer input, another object, a new modal or a removed target", () => {
  for (const scenario of ["pointerdown", "keydown", "object", "new modal", "removed"]) {
    const f = calendarWithFocus(); f.app.setProps({ onSelect: selection => { f.app.props.selection = selection; } });
    const editor = f.openEdit(), document = f.dom.document;
    const close = { ownerDocument: document, isConnected: true, focus() { f.dom.move(this); } };
    f.dom.triggers.calendar.focus();
    const cleanup = actualModal(f.dom, { contains: element => element === close || f.dom.section.contains(element), querySelector: () => close });
    const outside = { ownerDocument: document, group: "outside", isConnected: true, focus() { f.dom.focused.push("old outside"); f.dom.move(this); } };
    outside.focus(); editor.props.onClose(null, { canonicalId: "calendar-a", occurrenceRef: "occurrence-a" });
    if (scenario === "pointerdown" || scenario === "keydown") f.dom.fire(scenario, { key: "ArrowRight", target: document.body });
    if (scenario === "object") f.app.props.selection = { kind: "calendar", sourceId: "calendar-b", date: "2026-10-28", title: "合成日程B" };
    if (scenario === "removed") outside.isConnected = false;
    cleanup();
    const newModalTarget = { closest: () => ({}), isConnected: true };
    if (scenario === "new modal") f.dom.move(newModalTarget);
    f.dom.focused.length = 0; f.app.render();
    assert.equal(f.dom.focused.includes("old outside"), false, scenario);
    if (scenario === "new modal") assert.equal(document.activeElement, newModalTarget);
    assert.equal(f.dom.otherListenerCount, 0, scenario);
  }
});

function calendarDeletion(reply) {
  const f = calendarWithFocus();
  f.app.setProps({ data: { ...f.app.props.data, capabilities: { ...f.app.props.data.capabilities, entityDelete: { enabled: true, targetKinds: ["calendar"], reason: "synthetic test" } } }, onSelect: selection => { f.app.props.selection = selection; }, onDeleteEntity: reply });
  return f;
}

test("calendar delete cancellation returns to its enabled trigger after nested modal focus", async () => {
  let finish;
  const f = calendarDeletion(() => new Promise(resolve => { finish = resolve; }));
  f.dom.triggers.delete.focus(); f.drawer().props.onDelete(); f.app.render();
  assert.equal(f.dom.triggers.delete.disabled, true);
  f.dom.move({ name: "confirmation cancel", isConnected: true, closest: selector => selector === ".edupi-delete-confirmation" ? {} : null });
  // The modal's attempt to restore its now-disabled opener cannot focus it.
  f.dom.triggers.delete.focus(); f.dom.move(f.dom.document.body);
  finish(false); await new Promise(resolve => setImmediate(resolve)); f.app.render();
  assert.equal(f.dom.document.activeElement, f.dom.triggers.delete);
  assert.equal(f.dom.triggers.delete.disabled, false);
  assert.equal(f.app.props.selection.sourceId, "calendar-a");
});

test("calendar delete cancellation respects a newer object or focus and success closes the selected detail", async () => {
  for (const scenario of ["object", "focus", "success"]) {
    let finish;
    const f = calendarDeletion(() => new Promise(resolve => { finish = resolve; }));
    f.dom.triggers.delete.focus(); f.drawer().props.onDelete(); f.app.render();
    if (scenario === "object") f.app.setProps({ selection: { ...f.app.props.selection, sourceId: "calendar-b" } });
    if (scenario === "focus") { f.dom.outside(); f.dom.move(f.dom.document.body); }
    f.dom.focused.length = 0; finish(scenario === "success"); await new Promise(resolve => setImmediate(resolve)); f.app.render();
    assert.deepEqual(f.dom.focused, [], scenario);
    assert.equal(f.app.props.selection?.sourceId || null, scenario === "object" ? "calendar-b" : scenario === "success" ? null : "calendar-a");
  }
});

test("a fast calendar delete cancellation still recovers focus after a single batched commit", async () => {
  const f = calendarDeletion(async () => false);
  f.dom.triggers.delete.focus(); f.drawer().props.onDelete(); f.dom.move(f.dom.document.body);
  await new Promise(resolve => setImmediate(resolve)); f.app.render();
  assert.equal(f.dom.document.activeElement, f.dom.triggers.delete);
});

test("a failed calendar delete keeps the current detail and restores its retry entry", async () => {
  const f = calendarDeletion(async () => { throw new Error("synthetic delete failure"); });
  f.dom.triggers.delete.focus(); f.drawer().props.onDelete(); f.app.render();
  await new Promise(resolve => setImmediate(resolve)); f.app.render();
  assert.equal(f.app.props.selection.sourceId, "calendar-a");
  assert.equal(f.dom.document.activeElement, f.dom.triggers.delete);
  assert.equal(f.dom.triggers.delete.disabled, false);
});
