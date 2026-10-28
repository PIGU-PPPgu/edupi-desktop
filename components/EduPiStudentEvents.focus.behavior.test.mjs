import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import vm from "node:vm";
import ts from "typescript";

const code = ts.transpileModule(readFileSync(new URL("./EduPiStudentEvents.tsx", import.meta.url), "utf8"), {
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.ReactJSX },
}).outputText;
const jsx = (type, props, key) => ({ type, props: props || {}, key });
const tick = () => new Promise(resolve => setImmediate(resolve));
function descendants(node) {
  if (Array.isArray(node)) return node.flatMap(descendants);
  return node?.props ? [node, ...descendants(node.props.children)] : [];
}
const text = node => typeof node === "string" ? node : Array.isArray(node) ? node.map(text).join("") : node?.props ? text(node.props.children) : "";
const original = { id: "synthetic-event-1", kind: "learning", revision: 7, students: ["合成学生"], student_ids: ["synthetic-student"], class_name: "合成历史班", student_labels: ["合成学生 · 合成班"], summary: "合成原记录", topic: "合成知识点", observed_on: "2026-10-20", source: { text: "合成对话", session_id: "synthetic-session" }, history: [] };

function focusDom(mode) {
  const focusListeners = new Set(), calls = [], document = { body: { name: "HTML body" }, documentElement: { name: "HTML root" }, activeElement: null,
    addEventListener(name, callback) { assert.equal(name, "focusin"); focusListeners.add(callback); },
    removeEventListener(name, callback) { assert.equal(name, "focusin"); focusListeners.delete(callback); },
  };
  document.activeElement = document.body;
  let article = null, form = null, sourceNodes = [];
  const scope = { isConnected: true, ownerDocument: document, contains: element => Boolean(element?.isConnected && element.scope === scope), querySelectorAll(selector) {
    assert.equal(selector, "[data-student-event-id]"); return article ? [article] : [];
  } };
  const element = name => ({ name, ownerDocument: document, scope, isConnected: true, disabled: false, matches(selector) { assert.equal(selector, ":disabled"); return this.disabled; },
    focus(options) { assert.ok(this.isConnected && !this.disabled, `${name} must be available before focus`); document.activeElement = this; calls.push({ name, options }); for (const callback of focusListeners) callback({ target: this }); },
  });
  const disconnect = target => { if (target) { target.isConnected = false; if (document.activeElement === target || target.contains?.(document.activeElement)) document.activeElement = document.body; } };
  return { scope, document, calls, focusListeners, get article() { return article; }, get form() { return form; }, nodes: () => sourceNodes,
    moveFocus(target = { name: "other control", isConnected: true }) { document.activeElement = target; for (const callback of focusListeners) callback({ target }); return target; },
    commit(tree) {
      if (tree.props.ref) tree.props.ref.current = scope;
      const graph = descendants(tree).find(node => typeof node.type === "function");
      sourceNodes = mode === "portal" ? descendants(graph?.props.details) : descendants(tree);
      const record = sourceNodes.find(node => node.type === "article" && node.key === original.id);
      if (!record) {
        disconnect(form); disconnect(article); article = null; form = null; return;
      }
      sourceNodes = descendants(record);
      if (!article) article = { ...element("record article"), contains: target => Boolean(target?.isConnected && target.article === article), querySelector(selector) {
        if (selector === "textarea") return form?.textarea || null;
        if (selector === ".edupi-student-events__actions button" || selector === ".edupi-student-events__actions button:last-child") return this.modify || null;
        if (selector === 'form button[type="submit"]') return form?.save || null;
        assert.fail(`Unexpected record selector ${selector}`);
      } };
      article.getAttribute = name => record.props[name];
      const formNode = descendants(record).find(node => node.type === "form");
      if (formNode) {
        if (!form) {
          disconnect(article.modify); article.modify = null;
          form = { ...element("record form"), contains: target => target?.isConnected && target.form === form, closest(selector) {
            if (selector === "article") return article;
            assert.equal(selector, '[role="dialog"]'); return mode === "portal" ? scope : null;
          }, querySelector(selector) { assert.equal(selector, 'button[type="submit"]'); return this.save; } };
          for (const name of ["textarea", "topic", "date", "save"]) form[name] = { ...element(name), article, form };
        }
        form.save.disabled = Boolean(descendants(formNode).find(node => node.type === "button" && node.props.type === "submit")?.props.disabled);
      } else {
        if (form) { for (const name of ["textarea", "topic", "date", "save"]) disconnect(form[name]); disconnect(form); form = null; }
        if (!article.modify) article.modify = { ...element("modify"), article, closest(selector) { assert.equal(selector, "article"); return article; } };
      }
      if (document.activeElement?.disabled) document.activeElement = document.body;
    },
  };
}

function mount({ mode = "portal", holdReload = false, recordCount = 1 } = {}) {
  const slots = [], events = new Map(), frames = [], requests = [], dom = focusDom(mode);
  let cursor = 0, dirty = false, effects = [], tree, writes = 0, resolvePost, resolveReload;
  let persisted = { ...original };
  const props = { student: mode === "list" ? null : "合成学生", studentId: mode === "list" ? undefined : "synthetic-student", studentClass: "合成班", onAgent() {} };
  const react = {
    useState(initial) { const index = cursor++; if (!(index in slots)) slots[index] = typeof initial === "function" ? initial() : initial; return [slots[index], value => { const next = typeof value === "function" ? value(slots[index]) : value; if (!Object.is(next, slots[index])) { slots[index] = next; dirty = true; } }]; },
    useRef(initial) { const index = cursor++; slots[index] ??= { current: initial }; return slots[index]; },
    useEffect(callback, deps) { const index = cursor++, prior = slots[index]; if (!prior || deps.some((value, i) => !Object.is(value, prior.deps[i]))) { slots[index] = { deps }; effects.push(() => { prior?.cleanup?.(); slots[index].cleanup = callback(); }); } },
  };
  const Graph = () => null, exports = {};
  vm.runInNewContext(code, { exports, AbortController, URLSearchParams, Event, requestAnimationFrame: callback => frames.push(callback), window: {
    addEventListener(name, callback) { events.set(name, callback); }, removeEventListener(name) { events.delete(name); }, dispatchEvent(event) { events.get(event.type)?.(); },
  }, fetch: async (url, options = {}) => {
    requests.push({ url, ...options });
    if (options.method === "POST") { writes += 1; return new Promise(resolve => { resolvePost = success => {
      const body = JSON.parse(options.body);
      if (success) persisted = { ...persisted, summary: body.summary, topic: body.topic, observed_on: body.observed_on, revision: persisted.revision + 1 };
      resolve({ ok: success, json: async () => success ? { ok: true } : { error: "合成保存失败" } });
    }; }); }
    const response = () => ({ ok: true, json: async () => ({ records: Array.from({ length: Math.min(recordCount, 20) }, (_, index) => ({ ...persisted, id: index ? `synthetic-event-${index + 1}` : original.id, student_labels: [`${props.student || "合成学生"} · ${props.studentClass}`] })), total: recordCount }) });
    if (holdReload && writes > 0) return new Promise(resolve => { resolveReload = () => resolve(response()); });
    return response();
  }, require(name) {
    if (name === "react") return react;
    if (name === "react/jsx-runtime") return { jsx, jsxs: jsx, Fragment: "fragment" };
    if (name === "@/lib/edupi-student-graph") return { buildStudentGraph: records => ({ records }), STUDENT_GRAPH_PAGE_SIZE: 20, STUDENT_GRAPH_RECORD_LIMIT: 200 };
    if (name === "@/lib/edupi-ui-events") return { EDUPI_STUDENT_RECORDS_UPDATED_EVENT: "records-updated" };
    assert.equal(name, "./EduPiStudentGraph"); return { EduPiStudentGraph: Graph };
  } });
  const render = () => { let count = 0; do { assert.ok(count++ < 20); cursor = 0; dirty = false; effects = []; tree = exports.EduPiStudentEvents(props); dom.commit(tree); effects.splice(0).forEach(effect => effect()); } while (dirty); while (frames.length) frames.shift()(); };
  const findButton = label => dom.nodes().find(node => node.type === "button" && text(node) === label);
  const f = { props, dom, requests, render, get tree() { return tree; }, async settle() { for (let i = 0; i < 6; i++) { await tick(); if (dirty) render(); } },
    select(id) { descendants(tree).find(node => node.type === Graph).props.onSelect(id); render(); },
    edit() { findButton("修改").props.onClick({ currentTarget: dom.article.modify }); render(); },
    setFields() { const values = { summary: "合成修改内容", topic: "合成新知识点", observed_on: "2026-10-25" }; for (const [type, index, value] of [["textarea", 0, values.summary], ["input", 0, values.topic], ["input", 1, values.observed_on]]) { dom.nodes().filter(node => node.type === type)[index].props.onChange({ target: { value } }); render(); } return values; },
    submit() { const form = dom.nodes().find(node => node.type === "form"); dom.form.save.focus({ preventScroll: true }); dom.calls.length = 0; form.props.onSubmit({ preventDefault() {}, currentTarget: dom.form }); render(); },
    finishSave(success = true) { assert.ok(resolvePost); resolvePost(success); }, finishReload() { assert.ok(resolveReload); resolveReload(); },
  };
  render(); return f;
}

for (const mode of ["portal", "inline", "list"]) test(`${mode} record save returns to the refreshed record's modify action after loading`, async () => {
  const f = mount({ mode, holdReload: true }); await f.settle();
  if (mode !== "list") f.select(original.id);
  f.edit();
  const values = f.setFields(); f.submit();
  assert.equal(f.dom.document.activeElement, f.dom.document.body);
  f.finishSave(); await f.settle();
  assert.equal(f.dom.article, null, "the refresh removes the old record DOM");
  assert.deepEqual(f.dom.calls, [], "focus must wait for the new read instead of briefly selecting old DOM");
  f.finishReload(); await f.settle();
  assert.equal(f.dom.document.activeElement, f.dom.article.modify);
  assert.deepEqual(f.dom.calls.map(call => call.name), ["modify"]);
  assert.equal(f.dom.scope.contains(f.dom.document.activeElement), true);
  assert.deepEqual(JSON.parse(f.requests.find(request => request.method === "POST").body), { action: "update_event", event_id: original.id, expected_revision: 7, ...values });
  assert.equal(f.dom.nodes().some(node => node.type === "p" && text(node) === values.summary), true);
  assert.equal(f.dom.focusListeners.size, 0);
});

test("a failed record save keeps all three draft fields and returns to its enabled retry button", async () => {
  const f = mount(); await f.settle(); f.select(original.id); f.edit();
  const values = f.setFields(), form = f.dom.form;
  f.submit(); f.finishSave(false); await f.settle();
  assert.equal(f.dom.form, form);
  assert.equal(f.dom.document.activeElement, form.save);
  assert.equal(form.save.disabled, false);
  assert.equal(f.dom.nodes().find(node => node.type === "textarea").props.value, values.summary);
  assert.deepEqual(f.dom.nodes().filter(node => node.type === "input").map(node => node.props.value), [values.topic, values.observed_on]);
  assert.equal(f.requests.filter(request => request.method === "POST").length, 1);
  assert.equal(f.dom.focusListeners.size, 0);
});

test("record save completion respects deliberate focus movement during either write or refresh", async () => {
  for (const phase of ["write", "refresh"]) {
    const f = mount({ holdReload: true }); await f.settle(); f.select(original.id); f.edit(); f.submit();
    let target;
    if (phase === "write") {
      f.dom.moveFocus();
      target = f.dom.document.body;
      f.dom.document.activeElement = target;
    }
    f.finishSave(); await f.settle();
    if (phase === "refresh") target = f.dom.moveFocus();
    f.finishReload(); await f.settle();
    assert.equal(f.dom.document.activeElement, target, phase);
    assert.deepEqual(f.dom.calls, []);
    assert.equal(f.dom.focusListeners.size, 0);
  }
});

test("a failed save also preserves a newer focus outside the record form", async () => {
  const f = mount(); await f.settle(); f.select(original.id); f.edit(); f.submit();
  const target = f.dom.moveFocus();
  f.finishSave(false); await f.settle();
  assert.equal(f.dom.document.activeElement, target);
  assert.deepEqual(f.dom.calls, []);
  assert.ok(f.dom.form);
  assert.equal(f.dom.focusListeners.size, 0);
});

test("an old save cannot focus the same record ID after changing student, kind, or selected record", async () => {
  for (const change of ["student", "kind", "record"]) {
    const f = mount(); await f.settle(); f.select(original.id); f.edit(); f.submit();
    if (change === "student") { f.props.studentId = "another-student"; f.props.student = "另一个合成学生"; f.render(); }
    if (change === "kind") { descendants(f.tree).find(node => node.type === "button" && text(node) === "同伴互动").props.onClick(); f.render(); }
    if (change === "record") f.select("another-record");
    await f.settle(); f.finishSave(); await f.settle();
    assert.deepEqual(f.dom.calls, [], change);
    assert.equal(f.dom.focusListeners.size, 0);
  }
});

test("closing the expanded record scope during save prevents background focus", async () => {
  const f = mount(); await f.settle(); f.select(original.id); f.edit(); f.submit();
  f.dom.scope.isConnected = false;
  f.finishSave(); await f.settle();
  assert.deepEqual(f.dom.calls, []);
  assert.equal(f.dom.focusListeners.size, 0);
});

for (const view of ["graph", "list"]) test(`same-student class rerenders refetch ${view} labels without changing date, type, or historical class`, async () => {
  const f = mount({ mode: "inline", recordCount: 21 }); await f.settle();
  const control = label => descendants(f.tree).find(node => node.type === "button" && text(node) === label);
  if (view === "list") { control("同伴互动").props.onClick(); f.render(); await f.settle(); }
  descendants(f.tree).find(node => node.type === "select").props.onChange({ target: { value: "custom" } }); f.render();
  for (const [index, value] of ["2026-10-02", "2026-10-26"].entries()) {
    descendants(f.tree).filter(node => node.type === "input" && node.props.type === "date")[index].props.onChange({ target: { value } }); f.render();
  }
  await f.settle();
  if (view === "list") { control("列表").props.onClick(); f.render(); await f.settle(); }
  else f.select(original.id);
  const readsBefore = f.requests.length, oldSignal = f.requests.at(-1).signal;
  f.props.studentClass = "合成新班"; f.render(); await f.settle();
  assert.equal(f.requests.length, readsBefore + 1, "a changed class must fetch the current server projection");
  assert.equal(oldSignal.aborted, true);
  const params = new URL(f.requests.at(-1).url, "http://localhost").searchParams;
  assert.equal(params.get("student_id"), "synthetic-student");
  assert.equal(params.has("student"), false, "same-name students remain isolated by stable ID");
  assert.equal(params.get("kind"), view === "list" ? "interaction" : "learning");
  assert.equal(params.get("from"), "2026-10-02"); assert.equal(params.get("to"), "2026-10-26");
  assert.equal(control(view === "list" ? "列表" : "网络图").props["aria-pressed"], true);
  assert.equal(control(view === "list" ? "同伴互动" : "学习记录").props["aria-pressed"], true);
  assert.deepEqual(descendants(f.tree).filter(node => node.type === "input" && node.props.type === "date").map(node => node.props.value), ["2026-10-02", "2026-10-26"]);
  const header = f.dom.nodes().find(node => node.type === "header");
  assert.equal(text(descendants(header).find(node => node.type === "strong")), "合成学生 · 合成新班");
  assert.equal(text(descendants(header).find(node => node.type === "span")), "合成历史班");
  if (view === "graph") {
    const graph = descendants(f.tree).find(node => typeof node.type === "function");
    assert.equal(graph.props.total, 21);
    assert.equal(graph.props.records.length, 20);
    assert.equal(graph.props.selectedId, original.id);
    assert.ok(graph.props.records.every(record => record.student_labels[0] === "合成学生 · 合成新班" && record.class_name === "合成历史班"));
  }
  assert.equal(f.requests.some(request => request.method === "POST"), false, "class refresh never rewrites historical records");
});
