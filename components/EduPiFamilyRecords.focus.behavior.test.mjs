import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import vm from "node:vm";
import ts from "typescript";
import { createJiti } from "jiti";

const jiti = createJiti(import.meta.url);
const [recordModel, graphModel] = await Promise.all([jiti.import("../lib/edupi-family-record-model.ts"), jiti.import("../lib/edupi-family-graph.ts")]);
const code = ts.transpileModule(readFileSync(new URL("./EduPiFamilyRecords.tsx", import.meta.url), "utf8"), {
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.ReactJSX },
}).outputText;
const jsx = (type, props, key) => ({ type, props: props || {}, key });
const tick = () => new Promise(resolve => setImmediate(resolve));
const nodes = node => Array.isArray(node) ? node.flatMap(nodes) : node?.props ? [node, ...nodes(node.props.children)] : [];
const text = node => typeof node === "string" ? node : Array.isArray(node) ? node.map(text).join("") : node?.props ? text(node.props.children) : "";
const studentEntityId = `entity_${"1".repeat(32)}`, parentEntityId = `entity_${"2".repeat(32)}`;
const row = { fact_id: "synthetic-family-fact", event_id: "synthetic-event", student_entity_id: studentEntityId, parent_entity_id: parentEntityId,
  record: { version: 1, student_entity_id: studentEntityId, parent_entity_id: parentEntityId, guardian_verification: "unknown", recorded_relationship: "合成称谓", teacher_explicit_quality: "unknown", observed_on: "2026-10-21", note: "合成家校记录" },
  display_quality: "unknown", status: "accepted", revision: 4, mutation_allowed: true,
  source: { source_id: "synthetic-source", source_revision: "1", raw_text: "合成来源", observed_at: "2026-10-21T00:00:00.000Z", actor_ref: "合成原记录者", status: "active" },
  history: [], review_conflicts: [], review_conflict_count: 0, review_mode: "direct", restore_mode: "direct", logged_at: "2026-10-21T00:00:00.000Z", external_send: false };

function focusDom() {
  const calls = [], document = { body: { name: "HTML body" }, documentElement: {}, activeElement: null };
  document.activeElement = document.body;
  const scopes = Object.fromEntries(["inline", "portal"].map(name => [name, { name, isConnected: true, ownerDocument: document, contains: element => element?.scope === scopes[name] && element.isConnected, querySelectorAll(selector) { assert.equal(selector, "[data-family-editor-id]"); return this.form ? [this.form] : []; } }]));
  const element = (scope, name) => ({ name, scope, ownerDocument: document, isConnected: true, disabled: false, matches(selector) { assert.equal(selector, ":disabled"); return this.disabled; }, focus(options) { assert.ok(this.isConnected && !this.disabled); document.activeElement = this; calls.push({ scope: scope.name, name, options }); } });
  const button = (scope, name) => ({ ...element(scope, name), closest(selector) {
    if (selector === ".edupi-family-panel") return scope === scopes.inline ? scope : null;
    assert.equal(selector, '[role="dialog"]'); return scope === scopes.portal ? scope : null;
  } });
  scopes.inline.add = button(scopes.inline, "add trigger");
  for (const scope of Object.values(scopes)) scope.modify = button(scope, "modify trigger");
  const sources = {};
  return { scopes, sources, document, calls, move() { const target = { name: "another control", isConnected: true }; document.activeElement = target; return target; }, commit(tree) {
    const graph = nodes(tree).find(node => typeof node.type === "function");
    sources.inline = nodes(tree); sources.portal = nodes(graph?.props.details);
    for (const scope of Object.values(scopes)) {
      const source = sources[scope.name], formNode = source.find(node => node.type === "form");
      scope.modify.disabled = Boolean(source.find(node => node.type === "button" && text(node) === "修改")?.props.disabled);
      if (scope.add) scope.add.disabled = Boolean(source.find(node => node.type === "button" && text(node) === "添加记录")?.props.disabled);
      if (formNode) {
        if (!scope.form) {
          const form = { ...element(scope, "form"), contains: target => target?.isConnected && target.form === form, getAttribute: name => form.node.props[name], querySelector(selector) { assert.equal(selector, "select, input, textarea"); return this.first; } };
          form.first = { ...element(scope, formNode.props["aria-label"] === "添加家校记录" ? "contact select" : "relationship input"), form };
          form.cancel = { ...element(scope, "cancel"), form, closest(selector) { assert.equal(selector, "form"); return form; } };
          scope.form = form;
        }
        scope.form.node = formNode;
      } else if (scope.form) {
        for (const target of [scope.form, scope.form.first, scope.form.cancel]) { target.isConnected = false; if (document.activeElement === target) document.activeElement = document.body; }
        scope.form = null;
      }
      if (document.activeElement?.scope === scope && document.activeElement.disabled) document.activeElement = document.body;
    }
  } };
}

function mount() {
  const slots = [], listeners = new Map(), requests = [], dom = focusDom();
  let cursor = 0, dirty = false, effects = [], tree;
  const props = { studentId: "synthetic-student", studentName: "合成学生", reviewer: "合成教师", onEducation() {} };
  const react = {
    useState(initial) { const index = cursor++; if (!(index in slots)) slots[index] = typeof initial === "function" ? initial() : initial; return [slots[index], value => { const next = typeof value === "function" ? value(slots[index]) : value; if (!Object.is(next, slots[index])) { slots[index] = next; dirty = true; } }]; },
    useRef(initial) { const index = cursor++; slots[index] ??= { current: initial }; return slots[index]; },
    useMemo(create, deps) { const index = cursor++, prior = slots[index]; if (!prior || deps.some((value, i) => !Object.is(value, prior.deps[i]))) slots[index] = { deps, value: create() }; return slots[index].value; },
    useEffect(create, deps) { const index = cursor++, prior = slots[index]; if (!prior || deps.some((value, i) => !Object.is(value, prior.deps[i]))) { slots[index] = { deps }; effects.push(() => { prior?.cleanup?.(); slots[index].cleanup = create(); }); } },
  };
  const Graph = () => null, exports = {};
  vm.runInNewContext(code, { exports, AbortController, URLSearchParams, Date, Event, crypto: { randomUUID: () => "synthetic-family-editor" }, window: {
    addEventListener(name, callback) { listeners.set(name, callback); }, removeEventListener(name) { listeners.delete(name); }, dispatchEvent(event) { listeners.get(event.type)?.(); },
  }, fetch: async (url, options = {}) => {
    requests.push({ url, ...options });
    if (options.method === "POST") return { ok: false, json: async () => ({ error: "合成保存失败" }) };
    const params = new URL(url, "http://localhost").searchParams;
    return { ok: true, json: async () => ({ studentId: params.get("student_id"), studentEntity: { entity_id: studentEntityId }, parents: [{ entity_id: parentEntityId, canonical_name: "合成联系人", status: "active" }], records: [row], total: 1, offset: Number(params.get("offset")), limit: 10, nextOffset: null, sourceStatus: "current", externalSend: false }) };
  }, require(name) {
    if (name === "react") return react;
    if (name === "react/jsx-runtime") return { jsx, jsxs: jsx, Fragment: "fragment" };
    if (name === "@/lib/edupi-family-graph") return graphModel;
    if (name === "@/lib/edupi-family-record-model") return recordModel;
    if (name === "@/lib/edupi-ui-events") return { EDUPI_STUDENT_RECORDS_UPDATED_EVENT: "records-updated" };
    assert.equal(name, "./EduPiStudentGraph"); return { EduPiStudentGraph: Graph };
  } });
  const render = () => { let attempts = 0; do { assert.ok(attempts++ < 20); cursor = 0; dirty = false; effects = []; tree = exports.EduPiFamilyRecords(props); dom.commit(tree); effects.splice(0).forEach(effect => effect()); } while (dirty); };
  const f = { props, dom, requests, render, async settle() { for (let i = 0; i < 5; i++) { await tick(); if (dirty) render(); } },
    select() { nodes(tree).find(node => node.type === Graph).props.onSelect(row.fact_id); render(); },
    open(scopeName, create = false, commit = true) { const scope = dom.scopes[scopeName], label = create ? "添加记录" : "修改", trigger = create ? scope.add : scope.modify; trigger.focus({ preventScroll: false }); dom.calls.length = 0; dom.sources[scopeName].find(node => node.type === "button" && text(node) === label).props.onClick({ currentTarget: trigger }); if (commit) render(); },
    change(scopeName, label, value) { const form = dom.sources[scopeName].find(node => node.type === "form"); const field = nodes(form).find(node => node.type === "label" && text(node.props.children[0]) === label); nodes(field).find(node => ["input", "select", "textarea"].includes(node.type)).props.onChange({ target: { value } }); render(); },
    cancel(scopeName) { const scope = dom.scopes[scopeName]; scope.form.cancel.focus({ preventScroll: false }); dom.sources[scopeName].find(node => node.type === "button" && text(node) === "取消").props.onClick({ currentTarget: scope.form.cancel }); render(); },
    refresh() { listeners.get("records-updated")(); render(); },
  };
  render(); return f;
}

test("adding a family record focuses its contact select once and cancel returns to the add entry", async () => {
  const f = mount(); await f.settle(); f.open("inline", true);
  assert.equal(f.dom.document.activeElement, f.dom.scopes.inline.form.first);
  assert.deepEqual(f.dom.calls.map(call => call.name), ["contact select"]);
  f.change("inline", "联系人名称", "未保存合成联系人"); f.change("inline", "教师记录", "未保存合成记录");
  f.dom.calls.length = 0; f.refresh(); await f.settle();
  assert.deepEqual(f.dom.calls, [], "draft edits and a background read must not repeat autofocus");
  assert.ok(f.dom.sources.inline.some(node => node.type === "input" && node.props.value === "未保存合成联系人"));
  assert.ok(f.dom.sources.inline.some(node => node.type === "textarea" && node.props.value === "未保存合成记录"));
  f.cancel("inline");
  assert.equal(f.dom.document.activeElement, f.dom.scopes.inline.add);
  assert.equal(f.dom.scopes.inline.form, null);
  assert.equal(f.requests.some(request => request.method === "POST"), false);
});

for (const source of ["inline", "portal"]) test(`modifying in ${source} focuses only that copy and cancel returns to its own trigger`, async () => {
  const f = mount(); await f.settle(); f.select(); f.open(source);
  assert.ok(f.dom.scopes.inline.form && f.dom.scopes.portal.form, "expanded details and the background render the same editor state");
  assert.equal(f.dom.document.activeElement, f.dom.scopes[source].form.first);
  assert.deepEqual(f.dom.calls.map(call => [call.scope, call.name]), [[source, "relationship input"]]);
  f.change(source, "记录称谓", "合成修改称谓"); f.change(source, "教师记录", "合成修改草稿");
  assert.ok(f.dom.sources[source].some(node => node.type === "input" && node.props.value === "合成修改称谓"));
  f.cancel(source);
  assert.equal(f.dom.document.activeElement, f.dom.scopes[source].modify);
  assert.equal(f.dom.scopes.inline.form, null); assert.equal(f.dom.scopes.portal.form, null);
  assert.equal(f.requests.some(request => request.method === "POST"), false);
});

test("cancelling an existing family editor returns to its originating edit button", async () => {
  for (const source of ["inline", "portal"]) {
    const f = mount(); await f.settle(); f.select(); f.open(source); f.cancel(source);
    assert.equal(f.dom.document.activeElement, f.dom.scopes[source].modify, source);
  }
});

test("a queued family form open does not steal a newer focus before commit", async () => {
  const f = mount(); await f.settle(); f.open("inline", true, false); const target = f.dom.move(); f.render();
  assert.equal(f.dom.document.activeElement, target); assert.deepEqual(f.dom.calls, []);
});

test("a family form focus request cannot follow another student or a disconnected graph dialog", async () => {
  for (const change of ["student", "dialog"]) {
    const f = mount(); await f.settle(); f.select(); f.open("portal", false, false);
    if (change === "student") f.props.studentId = "another-student";
    else f.dom.scopes.portal.isConnected = false;
    f.render(); await f.settle();
    assert.deepEqual(f.dom.calls, [], change);
  }
});

test("family modification keeps its original fact revision, actor and normalized replacement request", async () => {
  const f = mount(); await f.settle(); f.select(); f.open("portal"); f.change("portal", "记录称谓", " 合成新称谓 "); f.change("portal", "教师记录", " 合成新记录 ");
  const form = f.dom.sources.portal.find(node => node.type === "form");
  await form.props.onSubmit({ preventDefault() {} }); f.render();
  const request = f.requests.find(request => request.method === "POST");
  assert.equal(request.url, "/api/edupi/facts/synthetic-family-fact");
  const body = JSON.parse(request.body);
  assert.equal(body.expectedRevision, 4); assert.equal(body.reviewer, "合成原记录者"); assert.equal(body.action, "modify"); assert.equal(body.note, null);
  assert.deepEqual(JSON.parse(body.replacementValue), { ...row.record, recorded_relationship: "合成新称谓", note: "合成新记录" });
  assert.ok(f.dom.sources.portal.some(node => node.type === "textarea" && node.props.value === " 合成新记录 "), "a failed mutation retains the editing draft");
});
