import assert from "node:assert/strict";
import fs from "node:fs";
import vm from "node:vm";
import test from "node:test";
import ts from "typescript";
import { createJiti } from "jiti";

const jiti = createJiti(import.meta.url);
const roster = await jiti.import("../lib/edupi-student-roster-model.ts");
const pagination = await jiti.import("../lib/edupi-student-pagination.ts");
const graph = await jiti.import("../lib/edupi-student-graph.ts");
const profileEdit = await jiti.import("../lib/edupi-student-profile-edit.ts");
const compile = file => ts.transpileModule(fs.readFileSync(new URL(file, import.meta.url), "utf8"), {
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.ReactJSX },
}).outputText;
const workspaceCode = compile("./EduPiStudentWorkspace.tsx"), eventsCode = compile("./EduPiStudentEvents.tsx"), graphCode = compile("./EduPiStudentGraph.tsx");
const jsx = (type, props, key) => ({ type, props: props || {}, key });
const tick = () => new Promise(resolve => setImmediate(resolve));
const placeholder = name => ({ [name]: Object.defineProperty(() => null, "name", { value: name }) });
function descendants(node) {
  if (Array.isArray(node)) return node.flatMap(descendants);
  if (!node || typeof node !== "object" || !node.props) return [];
  return [node, ...descendants(node.props.children)];
}
const text = node => typeof node === "string" || typeof node === "number" ? String(node) : Array.isArray(node) ? node.map(text).join("") : node?.props ? text(node.props.children) : "";

function mount(code, name, props, modules, globals = {}, commit = () => {}) {
  const slots = [];
  let cursor = 0, dirty = false, effects = [], tree;
  const react = {
    useState(initial) {
      const index = cursor++;
      if (!(index in slots)) slots[index] = typeof initial === "function" ? initial() : initial;
      return [slots[index], value => { const next = typeof value === "function" ? value(slots[index]) : value; if (!Object.is(next, slots[index])) { slots[index] = next; dirty = true; } }];
    },
    useRef(initial) { const index = cursor++; if (!(index in slots)) slots[index] = { current: initial }; return slots[index]; },
    useId() { const index = cursor++; if (!(index in slots)) slots[index] = `synthetic-id-${index}`; return slots[index]; },
    useMemo(factory, deps) {
      const index = cursor++, prior = slots[index];
      if (!prior || deps.some((value, i) => !Object.is(value, prior.deps[i]))) slots[index] = { deps, value: factory() };
      return slots[index].value;
    },
    useCallback(callback) { return callback; },
    useEffect(callback, deps) {
      const index = cursor++, prior = slots[index];
      if (!prior || deps.some((value, i) => !Object.is(value, prior.deps[i]))) {
        slots[index] = { deps, cleanup: prior?.cleanup };
        effects.push(() => { prior?.cleanup?.(); slots[index].cleanup = callback(); });
      }
    },
  };
  const exports = {};
  vm.runInNewContext(code, { exports, URLSearchParams, AbortController, Date, ...globals, require(module) {
    if (module === "react") return react;
    if (module === "react/jsx-runtime") return { jsx, jsxs: jsx, Fragment: "fragment" };
    assert.ok(modules[module], `Unexpected import ${module}`);
    return modules[module];
  } });
  const render = () => {
    let passes = 0;
    do {
      assert.ok(passes++ < 20, "component state should settle");
      cursor = 0; dirty = false; effects = [];
      tree = exports[name](props);
      commit(tree);
      effects.splice(0).forEach(effect => effect());
    } while (dirty);
    return tree;
  };
  return { props, render, get tree() { return tree; }, nodes: () => descendants(tree), async settle() { for (let i = 0; i < 4; i++) { await tick(); if (dirty) render(); } }, find: predicate => descendants(tree).find(predicate) };
}

const students = () => Array.from({ length: 61 }, (_, index) => ({ student_id: `student-${index}`, name: `学生${String(index).padStart(2, "0")}`, class_name: index < 31 ? "703" : "704", error_patterns: [], trajectory: [], traits: [], updated_at: "2026-10-07T00:00:00Z" }));
function workspace({ selectedStudentId = null, rows = students(), query = "", globals = {}, commit } = {}) {
  const props = { mode: "homeroom", data: { students: rows, calendar: [], tasks: [], continuity: { familyContacts: [], memories: [] }, capabilities: { entityDelete: { enabled: false, targetKinds: [] } } }, context: null, query, selectedStudentId, onStudent() {}, onEducation() {}, onTask() {}, onStartAgent() {}, onDeleteEntity() {} };
  const modules = {
    "@/lib/edupi-student-roster-model": roster, "@/lib/edupi-student-pagination": pagination,
    "@/lib/edupi-student-profile-edit": profileEdit, "@/lib/edupi-student-profile-prompt": {},
    "@/lib/edupi-workbench": { isUserFacingMemory: () => true },
    "@/lib/edupi-student-semester": { studentSemesterRange: () => null },
    "@/hooks/useModalDismiss": { useModalDismiss: () => ({ current: null }) },
    "./EduPiActionIcon": { ...placeholder("EduPiPagination"), ...placeholder("EduPiIconButton") },
  };
  for (const component of ["EduPiRosterPreview", "EduPiStudentEvents", "EduPiStudentFacts", "DisclosureChevron", "EduPiFamilyRecords", "EduPiStudentMemoryActions"]) modules[`./${component}`] = placeholder(component);
  const f = mount(workspaceCode, "EduPiStudentWorkspace", props, modules, globals, commit);
  f.render();
  return { ...f, get tree() { return f.tree; }, page: () => f.find(node => node.type.name === "EduPiPagination")?.props.page ?? 0, next() { f.find(node => node.type.name === "EduPiPagination").props.onNext(); f.render(); }, chooseClass(value) { f.find(node => node.type === "select").props.onChange({ target: { value } }); f.render(); } };
}

function importingWorkspace() {
  const requests = [], applied = [];
  const f = workspace({ rows: [], globals: {
    FormData: class { append() {} }, window: { setTimeout: () => 1, clearTimeout() {} },
    fetch: (url, init) => new Promise(resolve => requests.push({ url, init, resolve })),
  } });
  f.props.onEducation = next => { applied.push(next); f.props.data = next; }; f.render();
  const preview = { sourceName: "SYNTHETIC.csv", sheets: [{ name: "合成名单", rows: [["姓名", "班级"], ["合成学生", "合成班级"]] }] };
  const response = body => ({ ok: true, json: async () => body });
  const event = () => ({ target: { files: [{ name: "SYNTHETIC.csv" }], value: "synthetic-selection" } });
  return { f, requests, applied, preview, response, event };
}

test("empty-roster preview is single-flight before React commits busy and keeps its one import action disabled", async () => {
  const { f, requests, preview, response, event } = importingWorkspace();
  const input = f.find(node => node.type === "input" && node.props.type === "file");
  const first = input.props.onChange(event()), duplicate = input.props.onChange(event());
  try {
    assert.equal(requests.length, 1, "same-tick file changes must not dispatch a second preview");
    f.render();
    const actions = f.nodes().filter(node => node.type === "button" && text(node) === "导入中…");
    assert.equal(actions.length, 1); assert.equal(actions[0].props.disabled, true);
  } finally {
    requests.forEach(request => request.resolve(response(preview)));
    await Promise.all([first, duplicate]); await f.settle();
  }
  assert.equal(f.nodes().filter(node => node.type.name === "EduPiRosterPreview").length, 1);
});

test("roster confirmation is single-flight before busy commits and applies the confirmed readback once", async () => {
  const { f, requests, applied, preview, response, event } = importingWorkspace();
  const reading = f.find(node => node.type === "input" && node.props.type === "file").props.onChange(event());
  requests[0].resolve(response(preview)); await reading; await f.settle();
  const proposal = f.find(node => node.type.name === "EduPiRosterPreview");
  const csv = '"姓名","特征","家校备注","班级"\r\n"合成学生","","","合成班级"';
  proposal.props.onImport(csv); proposal.props.onImport(csv);
  const confirmed = { ...f.props.data, students: [{ student_id: "synthetic-imported-student", name: "合成学生", class_name: "合成班级" }] };
  try {
    assert.equal(requests.filter(request => request.url === "/api/edupi/students/import").length, 1, "same-tick confirms must dispatch one mutation");
    f.render(); assert.equal(f.find(node => node.type.name === "EduPiRosterPreview").props.busy, true);
    assert.deepEqual(JSON.parse(requests[1].init.body), { sourceName: preview.sourceName, csv });
  } finally {
    requests.slice(1).forEach(request => request.resolve(response({ data: confirmed, result: { imported: 1 } })));
    await f.settle();
  }
  assert.equal(applied.length, 1); assert.equal(f.props.data, confirmed);
  assert.equal(f.find(node => node.type.name === "EduPiRosterPreview"), undefined);
  assert.equal(f.nodes().filter(node => node.type === "button" && node.props.className?.startsWith("edupi-student-directory__row")).length, 1);
});

test("a failed roster preview or confirmation unlocks only an explicit retry and preserves the current preview", async () => {
  const { f, requests, applied, preview, response, event } = importingWorkspace();
  let reading = f.find(node => node.type === "input" && node.props.type === "file").props.onChange(event());
  requests[0].resolve({ ok: false, json: async () => ({ error: "合成预览失败" }) }); await reading; await f.settle();
  assert.equal(requests.length, 1); assert.equal(f.find(node => node.type.name === "EduPiRosterPreview"), undefined);
  reading = f.find(node => node.type === "input" && node.props.type === "file").props.onChange(event());
  assert.equal(requests.length, 2); requests[1].resolve(response(preview)); await reading; await f.settle();
  f.find(node => node.type.name === "EduPiRosterPreview").props.onImport("合成CSV");
  requests[2].resolve({ ok: false, json: async () => ({ error: "合成导入失败" }) }); await f.settle();
  assert.equal(requests.length, 3); assert.equal(applied.length, 0);
  const proposal = f.find(node => node.type.name === "EduPiRosterPreview");
  assert.equal(proposal.props.preview, preview); assert.equal(proposal.props.busy, false);
  proposal.props.onImport("合成CSV"); proposal.props.onImport("合成CSV");
  assert.equal(requests.length, 4, "the explicit retry is also single-flight");
  const confirmed = { ...f.props.data, students: [{ student_id: "synthetic-imported-student", name: "合成学生", class_name: "合成班级" }] };
  requests[3].resolve(response({ data: confirmed, result: { imported: 1 } })); await f.settle();
  assert.equal(applied.length, 1); assert.equal(f.find(node => node.type.name === "EduPiRosterPreview"), undefined);
});

test("manual roster paging and class filters survive a selected student's rerenders", () => {
  const f = workspace({ selectedStudentId: "student-0" });
  f.next();
  assert.equal(f.page(), 1);
  f.props.data = { ...f.props.data, students: f.props.data.students.map(student => ({ ...student })) };
  f.render();
  assert.equal(f.page(), 1, "a refreshed projection must not snap back to the selected student");
  f.chooseClass("704");
  assert.equal(f.find(node => node.type === "select").props.value, "704");
  f.next();
  assert.equal(f.page(), 1);
  assert.equal(f.nodes().filter(node => node.type === "button" && node.props.className?.startsWith("edupi-student-directory__row")).length, 6);
});

test("new external student selection aligns once, after asynchronous data and when reopened", () => {
  const f = workspace({ rows: [], selectedStudentId: "student-60" });
  f.props.data = { ...f.props.data, students: students() };
  f.render();
  assert.equal(f.page(), 2, "selection arriving before data is aligned once its row is available");
  f.props.selectedStudentId = "student-0";
  f.render();
  f.chooseClass("703");
  f.props.selectedStudentId = "student-60";
  f.render();
  assert.equal(f.find(node => node.type === "select").props.value, "");
  assert.equal(f.page(), 2);
  f.props.selectedStudentId = null;
  f.render();
  const pageControl = f.find(node => node.type.name === "EduPiPagination");
  pageControl.props.onPrevious(); f.render();
  assert.equal(f.page(), 1);
  f.props.selectedStudentId = "student-60";
  f.render();
  assert.equal(f.page(), 2, "closing and reopening the same student is a new explicit selection");
});

test("roster searches remain authoritative and shrinking data clamps the current page", () => {
  const f = workspace({ query: "学生00" });
  f.props.selectedStudentId = "student-60";
  f.render();
  assert.equal(f.props.query, "学生00");
  f.props.query = "";
  f.render();
  assert.equal(f.page(), 0, "clearing a search does not replay an already handled selection");
  f.next(); f.next();
  assert.equal(f.page(), 2);
  f.props.data = { ...f.props.data, students: f.props.data.students.slice(0, 4) };
  f.render();
  assert.equal(f.page(), 0);
});

test("roster rows expose one name and the all-student record toggle is absent from selected detail", () => {
  const f = workspace();
  const row = f.nodes().find(node => node.props.className === "edupi-student-directory__row");
  assert.equal(row.props["aria-label"], "学生00，703");
  assert.equal(descendants(row).find(node => node.props.className === "edupi-student-directory__avatar").props["aria-hidden"], "true");
  assert.ok(f.nodes().some(node => node.props.className === "edupi-student-events-toggle"));
  assert.ok(f.nodes().some(node => node.type === "button" && text(node) === "导出全部档案"));
  f.props.selectedStudentId = "student-0";
  f.render();
  assert.equal(f.nodes().some(node => node.props.className === "edupi-student-events-toggle"), false);
  assert.ok(f.nodes().some(node => node.type.name === "EduPiStudentEvents" && node.props.student === "学生00"));
  assert.ok(f.nodes().some(node => node.type === "button" && text(node) === "导出当前档案"));
  f.props.query = "不存在的合成姓名";
  f.render();
  assert.ok(f.nodes().some(node => String(node.props.className || "").split(" ").includes("edupi-student-directory__no-results")
    && String(node.props.className || "").split(" ").includes("edupi-student-directory__filtered-empty") && text(node) === "当前筛选无学生"));
  assert.equal(f.nodes().some(node => node.props.className === "edupi-student-directory__empty"), false);
});

function events({ fail = false, total = { value: 40 } } = {}) {
  const calls = [];
  const listeners = new Map();
  const props = { student: "合成学生", studentId: "synthetic-student", onAgent() {}, query: "合成知识点", semesterRange: { from: "2026-09-01", to: "2027-01-31" }, familyRecords: jsx("section", { children: "合成家校记录" }) };
  const f = mount(eventsCode, "EduPiStudentEvents", props, { "@/lib/edupi-student-graph": { ...graph, buildStudentGraph: records => ({ records }) }, "@/lib/edupi-ui-events": { EDUPI_STUDENT_RECORDS_UPDATED_EVENT: "records-updated" }, "./EduPiStudentGraph": placeholder("EduPiStudentGraph") }, {
    window: { addEventListener(name, callback) { listeners.set(name, callback); }, removeEventListener(name) { listeners.delete(name); } },
    fetch: async (url, options) => {
      const params = new URL(`http://localhost${url}`).searchParams;
      calls.push({ params, signal: options.signal });
      const offset = Number(params.get("offset"));
      return { ok: !fail, json: async () => fail ? { error: "Core writer admission denied" } : { records: Array.from({ length: Math.max(0, Math.min(20, total.value - offset)) }, (_, i) => ({ id: `record-${offset + i}`, revision: 1, students: ["合成学生"], summary: `合成记录${offset + i}`, source: { text: "合成来源", session_id: "synthetic-session" }, history: [] })), total: total.value } };
    },
  });
  f.render();
  return { ...f, get tree() { return f.tree; }, calls, refresh: () => { listeners.get("records-updated")?.(); f.render(); }, range: value => { f.find(node => node.type === "select" && node.props["aria-label"] === "时间范围").props.onChange({ target: { value } }); f.render(); }, date: (index, value) => { f.nodes().filter(node => node.type === "input" && node.props.type === "date")[index].props.onChange({ target: { value } }); f.render(); } };
}

function profileFocusDom() {
  const document = { body: {}, activeElement: null };
  document.activeElement = document.body;
  const elements = new Map();
  let attached = new Set();
  const element = () => ({ isConnected: true, scrollTop: 180, focus(options) { this.focusOptions = options; document.activeElement = this; }, contains(other) { return other === this || other?.form === this; } });
  const trigger = element();
  return { document, trigger, elements, commit(tree) {
    const next = new Set();
    for (const node of descendants(tree)) {
      const ref = node.props.ref;
      if (!ref || typeof ref !== "object") continue;
      next.add(ref);
      if (!elements.has(ref)) elements.set(ref, element());
      ref.current = elements.get(ref);
      ref.current.isConnected = true;
    }
    for (const ref of attached) if (!next.has(ref)) {
      const prior = elements.get(ref);
      if (prior.contains(document.activeElement)) document.activeElement = document.body;
      prior.isConnected = false;
      ref.current = null;
    }
    attached = next;
  } };
}

test("profile editing opens above records and focuses only the first field of its student", () => {
  const dom = profileFocusDom();
  const f = workspace({ selectedStudentId: "student-0", globals: { document: dom.document }, commit: dom.commit });
  const before = f.find(node => node.type.name === "EduPiStudentEvents");
  dom.document.activeElement = dom.trigger;
  f.find(node => node.props.label === "手动修改").props.onClick({ currentTarget: dom.trigger });
  f.render();
  const form = f.find(node => node.type === "form");
  const scroll = f.find(node => node.props.className === "edupi-student-drawer__scroll");
  assert.equal(scroll.props.children.filter(Boolean)[0], form);
  const field = descendants(form).find(node => node.type === "input");
  assert.equal(dom.document.activeElement, field.props.ref.current);
  assert.equal(scroll.props.ref.current.scrollTop, 0);
  assert.equal(field.props.ref.current.focusOptions.preventScroll, true);
  const after = f.find(node => node.type.name === "EduPiStudentEvents");
  assert.equal(after.type, before.type);
  assert.equal(after.key, before.key);
  const notes = { form: form.props.ref.current };
  dom.document.activeElement = notes;
  field.props.onChange({ target: { value: "合成转班" } }); f.render();
  assert.equal(dom.document.activeElement, notes, "typing must not refocus the first field");
  f.props.data = { ...f.props.data, students: f.props.data.students.map(student => ({ ...student })) };
  f.render();
  assert.equal(dom.document.activeElement, notes, "a refreshed projection must not restart the focus request");
  f.find(node => node.props.label === "手动修改").props.onClick({ currentTarget: dom.trigger }); f.render();
  assert.equal(f.find(node => node.type === "input" && node.props.ref === field.props.ref).props.value, "合成转班", "opening the current editor must not replace its draft");
  dom.document.activeElement = notes;
  f.find(node => node.type === "button" && text(node) === "取消").props.onClick(); f.render();
  assert.equal(dom.document.activeElement, dom.trigger);
  assert.equal(f.find(node => node.type.name === "EduPiStudentEvents").key, before.key);
});

test("profile save keeps its request identity and restores focus only after confirmed success", async () => {
  for (const outcome of ["success", "failure", "focus_moved"]) {
    const dom = profileFocusDom(), requests = [];
    let resolveResponse;
    const response = new Promise(resolve => { resolveResponse = resolve; });
    const f = workspace({ selectedStudentId: "student-0", globals: {
      document: dom.document, window: { setTimeout() { return 1; }, clearTimeout() {} },
      fetch: async (url, options) => { requests.push({ url, ...options }); return response; },
    }, commit: dom.commit });
    f.props.onEducation = data => { f.props.data = data; };
    dom.document.activeElement = dom.trigger;
    f.find(node => node.props.label === "手动修改").props.onClick({ currentTarget: dom.trigger }); f.render();
    const form = f.find(node => node.type === "form");
    const fields = descendants(form).filter(node => node.type === "input" || node.type === "textarea");
    for (const [i, value] of ["合成转班", "合成特征甲\n合成特征乙", "合成备注甲\n合成备注乙"].entries()) {
      f.find(node => node.type === fields[i].type && node.props.maxLength === fields[i].props.maxLength && (i !== 2 || node.props.rows === 5) && (i !== 1 || node.props.rows === 4)).props.onChange({ target: { value } });
      f.render();
    }
    const focusedNotes = { form: form.props.ref.current };
    dom.document.activeElement = focusedNotes;
    const saving = f.find(node => node.type === "form").props.onSubmit({ preventDefault() {} });
    f.render();
    const nextFocus = {};
    if (outcome === "focus_moved") dom.document.activeElement = nextFocus;
    const data = { ...f.props.data, students: f.props.data.students.map(student => student.student_id === "student-0" ? { ...student, class_name: "合成转班" } : student) };
    resolveResponse({ ok: outcome !== "failure", json: async () => outcome === "failure" ? { error: "合成保存失败" } : { data } });
    await saving; f.render();
    const body = JSON.parse(requests[0].body);
    assert.equal(requests[0].method, "PUT");
    assert.deepEqual(body, { studentId: "student-0", className: "合成转班", traits: ["合成特征甲", "合成特征乙"], parentNotes: ["合成备注甲", "合成备注乙"], expectedUpdatedAt: "2026-10-07T00:00:00Z", expectedRevision: 0 });
    assert.equal(Boolean(f.find(node => node.type === "form")), outcome === "failure");
    assert.equal(dom.document.activeElement, outcome === "failure" ? focusedNotes : outcome === "focus_moved" ? nextFocus : dom.trigger);
    if (outcome === "failure") assert.equal(f.find(node => node.type === "input" && node.props.maxLength === 120).props.value, "合成转班");
  }
});

test("an editor focus request does not steal a newer focus or follow another student", () => {
  for (const changeStudent of [false, true]) {
    const dom = profileFocusDom();
    const f = workspace({ selectedStudentId: "student-0", globals: { document: dom.document }, commit: dom.commit });
    dom.document.activeElement = dom.trigger;
    f.find(node => node.props.label === "手动修改").props.onClick({ currentTarget: dom.trigger });
    const nextFocus = {};
    dom.document.activeElement = nextFocus;
    if (changeStudent) f.props.selectedStudentId = "student-1";
    f.render();
    assert.equal(dom.document.activeElement, nextFocus);
  }
});

test("record lists omit pagination for zero or one page and clamp after deleting the last page", async () => {
  for (const count of [0, 1, 20]) {
    const f = events({ total: { value: count } }); await f.settle();
    f.find(node => node.type === "button" && text(node) === "列表").props.onClick(); f.render(); await f.settle();
    assert.equal(f.nodes().some(node => node.type === "footer"), false, `${count} records need no pager`);
  }
  const total = { value: 21 }, f = events({ total }); await f.settle();
  f.find(node => node.type === "button" && text(node) === "列表").props.onClick(); f.render(); await f.settle();
  f.find(node => node.type === "button" && text(node) === "下一页").props.onClick(); f.render(); await f.settle();
  assert.equal(f.calls.at(-1).params.get("offset"), "20");
  assert.equal(f.find(node => node.type === "button" && text(node) === "下一页").props.disabled, true);
  total.value = 20; f.refresh(); await f.settle();
  assert.equal(f.calls.at(-1).params.get("offset"), "0");
  assert.equal(f.nodes().some(node => node.type === "footer"), false);
});

test("record view and custom date drafts survive same-student class updates", async () => {
  const f = events(); await f.settle();
  f.range("custom"); f.date(0, "2026-10-02"); f.date(1, "2026-10-19"); await f.settle();
  f.find(node => node.type === "button" && text(node) === "列表").props.onClick(); f.render(); await f.settle();
  f.props.studentClass = "合成转班"; f.render(); await f.settle();
  assert.equal(f.find(node => node.type === "button" && text(node) === "列表").props["aria-pressed"], true);
  f.find(node => node.type === "button" && text(node) === "网络图").props.onClick(); f.render(); await f.settle();
  assert.equal(f.find(node => node.type.name === "EduPiStudentGraph").props.scope, "2026-10-02 至 2026-10-19");
  assert.equal(f.calls.at(-1).params.get("from"), "2026-10-02");
  assert.equal(f.calls.at(-1).params.get("to"), "2026-10-19");
});

test("graph zoom, pan, selection and an expanded empty dialog survive empty-state transitions", () => {
  const records = [{ id: "synthetic-event", kind: "learning", students: ["合成学生"], student_ids: ["synthetic-student"], student_labels: ["合成学生 · 合成班"], summary: "合成方程练习", topic: "合成方程", observed_on: "2026-10-02" }];
  const selected = [], viewport = {
    clientWidth: 700, clientHeight: 400, scrollLeft: 0, scrollTop: 0,
    scrollTo({ left = this.scrollLeft, top = this.scrollTop }) { this.scrollLeft = left; this.scrollTop = top; },
    scrollBy({ left, top }) { this.scrollLeft += left; this.scrollTop += top; },
    focus() {}, setPointerCapture() {}, closest() { return {}; },
  };
  const f = mount(graphCode, "EduPiStudentGraph", { records, total: 1, kind: "learning", selectedId: null, onSelect: value => selected.push(value) }, {
    "@/lib/edupi-student-graph": graph,
    "@/hooks/useModalDismiss": { useModalDismiss: () => ({ current: null }) },
    "react-dom": { createPortal: children => jsx("portal", { children }) },
  }, { document: { body: {} }, requestAnimationFrame: callback => { callback(); return 1; }, ResizeObserver: class { observe() {} disconnect() {} } }, tree => {
    const node = descendants(tree).find(node => node.props.className?.startsWith("edupi-student-graph__viewport"));
    if (node) node.props.ref.current = viewport;
  });
  f.render();
  f.find(node => node.props["aria-label"] === "放大图谱").props.onClick(); f.render();
  assert.equal(text(f.find(node => node.type === "output")), "125%");
  const canvas = f.find(node => node.props["aria-label"] === "图谱画布");
  const beforePan = { left: viewport.scrollLeft, top: viewport.scrollTop };
  canvas.props.onPointerDown({ button: 0, target: { closest: () => null }, currentTarget: viewport, pointerId: 1, clientX: 100, clientY: 100 }); f.render();
  canvas.props.onPointerMove({ currentTarget: viewport, pointerId: 1, clientX: 70, clientY: 80 });
  assert.equal(viewport.scrollLeft, beforePan.left + 30);
  assert.equal(viewport.scrollTop, beforePan.top + 20);
  canvas.props.onPointerUp(); f.render();
  f.find(node => node.type === "button" && node.props["aria-label"]?.startsWith("学习记录：")).props.onClick();
  assert.equal(selected.at(-1), "synthetic-event");
  f.props.records = []; f.props.total = 0; f.render();
  assert.equal(f.find(node => node.props["aria-label"] === "图谱画布").props.tabIndex, -1);
  f.props.records = records; f.props.total = 1; f.render();
  assert.equal(text(f.find(node => node.type === "output")), "125%", "empty presentation must not remount the graph");
  f.find(node => node.type === "button" && text(node) === "展开图谱").props.onClick(); f.render();
  f.props.records = []; f.props.total = 0; f.render();
  assert.ok(f.find(node => node.type === "portal"));
  assert.equal(f.find(node => node.props["aria-label"] === "图谱画布").props.tabIndex, 0);
  f.find(node => node.props["aria-label"] === "关闭图谱").props.onClick(); f.render();
  assert.equal(f.find(node => node.type === "portal"), undefined);
  assert.equal(f.find(node => node.props["aria-label"] === "图谱画布").props.tabIndex, -1);
});

test("date modes retain custom dates while all-time and semester use their exact request scopes", async () => {
  const f = events(); await f.settle();
  assert.equal(f.nodes().some(node => node.type === "input" && node.props.type === "date"), false);
  assert.equal(f.calls.at(-1).params.has("from"), false);
  f.range("custom");
  f.date(0, "2026-10-02"); f.date(1, "2026-10-19"); await f.settle();
  assert.equal(f.calls.at(-1).params.get("from"), "2026-10-02");
  assert.equal(f.calls.at(-1).params.get("to"), "2026-10-19");
  f.range("semester"); await f.settle();
  assert.equal(f.calls.at(-1).params.get("from"), "2026-09-01");
  assert.equal(f.calls.at(-1).params.get("to"), "2027-01-31");
  assert.equal(f.nodes().some(node => node.type === "input" && node.props.type === "date"), false);
  f.range("all"); await f.settle();
  assert.equal(f.calls.at(-1).params.has("from"), false);
  assert.equal(f.calls.at(-1).params.has("to"), false);
  f.range("custom"); await f.settle();
  assert.deepEqual(f.nodes().filter(node => node.type === "input" && node.props.type === "date").map(node => node.props.value), ["2026-10-02", "2026-10-19"]);
  assert.equal(f.calls.at(-1).params.get("query"), "合成知识点");
  assert.equal(f.calls.at(-1).params.get("student_id"), "synthetic-student");
  const graphNode = f.find(node => node.type.name === "EduPiStudentGraph");
  descendants(graphNode.props.footer).find(node => node.type === "button").props.onClick(); await f.settle();
  assert.equal(f.calls.at(-1).params.get("offset"), "20");
  assert.equal(f.calls.at(-1).params.get("from"), "2026-10-02");
  assert.equal(f.calls.at(-1).params.get("to"), "2026-10-19");
});

test("family records skip event queries and retain date scope when returning to learning", async () => {
  const f = events(); await f.settle();
  f.range("custom"); f.date(0, "2026-10-02"); await f.settle();
  const before = f.calls.length;
  f.find(node => node.type === "button" && text(node) === "家校人物").props.onClick(); f.render(); await f.settle();
  assert.equal(f.calls.length, before);
  assert.equal(f.nodes().some(node => node.props["aria-label"] === "时间范围"), false);
  assert.ok(text(f.tree).includes("合成家校记录"));
  f.find(node => node.type === "button" && text(node) === "学习记录").props.onClick(); f.render(); await f.settle();
  assert.equal(f.calls.at(-1).params.get("from"), "2026-10-02");
});

test("technical read failures show a short Chinese state with closed technical details", async () => {
  const f = events({ fail: true }); await f.settle();
  const graphNode = f.find(node => node.type.name === "EduPiStudentGraph");
  const alert = graphNode.props.alert;
  assert.equal(alert.props.role, "alert");
  assert.ok(text(alert).includes("学生记录暂时无法读取"));
  const details = descendants(alert).find(node => node.type === "details");
  assert.equal(details.props.open, undefined);
  assert.ok(text(details).includes("Core writer admission denied"));
});
