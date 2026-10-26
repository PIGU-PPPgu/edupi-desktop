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
const compile = file => ts.transpileModule(fs.readFileSync(new URL(file, import.meta.url), "utf8"), {
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.ReactJSX },
}).outputText;
const workspaceCode = compile("./EduPiStudentWorkspace.tsx"), eventsCode = compile("./EduPiStudentEvents.tsx");
const jsx = (type, props, key) => ({ type, props: props || {}, key });
const tick = () => new Promise(resolve => setImmediate(resolve));
const placeholder = name => ({ [name]: Object.defineProperty(() => null, "name", { value: name }) });
function descendants(node) {
  if (Array.isArray(node)) return node.flatMap(descendants);
  if (!node || typeof node !== "object" || !node.props) return [];
  return [node, ...descendants(node.props.children)];
}
const text = node => typeof node === "string" ? node : Array.isArray(node) ? node.map(text).join("") : node?.props ? text(node.props.children) : "";

function mount(code, name, props, modules, globals = {}) {
  const slots = [];
  let cursor = 0, dirty = false, effects = [], tree;
  const react = {
    useState(initial) {
      const index = cursor++;
      if (!(index in slots)) slots[index] = typeof initial === "function" ? initial() : initial;
      return [slots[index], value => { const next = typeof value === "function" ? value(slots[index]) : value; if (!Object.is(next, slots[index])) { slots[index] = next; dirty = true; } }];
    },
    useRef(initial) { const index = cursor++; if (!(index in slots)) slots[index] = { current: initial }; return slots[index]; },
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
      effects.splice(0).forEach(effect => effect());
    } while (dirty);
    return tree;
  };
  return { props, render, get tree() { return tree; }, nodes: () => descendants(tree), async settle() { for (let i = 0; i < 4; i++) { await tick(); if (dirty) render(); } }, find: predicate => descendants(tree).find(predicate) };
}

const students = () => Array.from({ length: 61 }, (_, index) => ({ student_id: `student-${index}`, name: `学生${String(index).padStart(2, "0")}`, class_name: index < 31 ? "703" : "704", error_patterns: [], trajectory: [], traits: [], updated_at: "2026-10-07T00:00:00Z" }));
function workspace({ selectedStudentId = null, rows = students(), query = "" } = {}) {
  const props = { mode: "homeroom", data: { students: rows, calendar: [], tasks: [], continuity: { familyContacts: [], memories: [] }, capabilities: { entityDelete: { enabled: false, targetKinds: [] } } }, context: null, query, selectedStudentId, onStudent() {}, onEducation() {}, onTask() {}, onStartAgent() {}, onDeleteEntity() {} };
  const modules = {
    "@/lib/edupi-student-roster-model": roster, "@/lib/edupi-student-pagination": pagination,
    "@/lib/edupi-student-profile-edit": {}, "@/lib/edupi-student-profile-prompt": {},
    "@/lib/edupi-workbench": { isUserFacingMemory: () => true },
    "@/lib/edupi-student-semester": { studentSemesterRange: () => null },
    "@/hooks/useModalDismiss": { useModalDismiss: () => ({ current: null }) },
    "./EduPiActionIcon": { ...placeholder("EduPiPagination"), ...placeholder("EduPiIconButton") },
  };
  for (const component of ["EduPiRosterPreview", "EduPiStudentEvents", "EduPiStudentFacts", "DisclosureChevron", "EduPiFamilyRecords", "EduPiStudentMemoryActions"]) modules[`./${component}`] = placeholder(component);
  const f = mount(workspaceCode, "EduPiStudentWorkspace", props, modules);
  f.render();
  return { ...f, get tree() { return f.tree; }, page: () => f.find(node => node.type.name === "EduPiPagination")?.props.page ?? 0, next() { f.find(node => node.type.name === "EduPiPagination").props.onNext(); f.render(); }, chooseClass(value) { f.find(node => node.type === "select").props.onChange({ target: { value } }); f.render(); } };
}

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
  assert.ok(f.nodes().some(node => node.props.className === "edupi-student-directory__no-results" && text(node) === "未找到匹配学生"));
  assert.equal(f.nodes().some(node => node.props.className === "edupi-student-directory__empty"), false);
});

function events({ fail = false } = {}) {
  const calls = [];
  const props = { student: "合成学生", studentId: "synthetic-student", onAgent() {}, query: "合成知识点", semesterRange: { from: "2026-09-01", to: "2027-01-31" }, familyRecords: jsx("section", { children: "合成家校记录" }) };
  const f = mount(eventsCode, "EduPiStudentEvents", props, { "@/lib/edupi-student-graph": { ...graph, buildStudentGraph: records => ({ records }) }, "@/lib/edupi-ui-events": { EDUPI_STUDENT_RECORDS_UPDATED_EVENT: "records-updated" }, "./EduPiStudentGraph": placeholder("EduPiStudentGraph") }, {
    window: { addEventListener() {}, removeEventListener() {} },
    fetch: async (url, options) => {
      const params = new URL(`http://localhost${url}`).searchParams;
      calls.push({ params, signal: options.signal });
      const offset = Number(params.get("offset"));
      return { ok: !fail, json: async () => fail ? { error: "Core writer admission denied" } : { records: Array.from({ length: 20 }, (_, i) => ({ id: `record-${offset + i}` })), total: 40 } };
    },
  });
  f.render();
  return { ...f, get tree() { return f.tree; }, calls, range: value => { f.find(node => node.type === "select" && node.props["aria-label"] === "时间范围").props.onChange({ target: { value } }); f.render(); }, date: (index, value) => { f.nodes().filter(node => node.type === "input" && node.props.type === "date")[index].props.onChange({ target: { value } }); f.render(); } };
}

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
