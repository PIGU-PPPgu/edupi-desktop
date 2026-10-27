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
  const focusListeners = new Set(), calls = [], document = { body: { name: "HTML body" }, documentElement: {}, activeElement: null,
    addEventListener(name, callback) { assert.equal(name, "focusin"); focusListeners.add(callback); },
    removeEventListener(name, callback) { assert.equal(name, "focusin"); focusListeners.delete(callback); },
  };
  document.activeElement = document.body;
  const scopes = Object.fromEntries(["inline", "portal"].map(name => [name, { name, records: new Map(), isConnected: true, ownerDocument: document, contains: element => element?.scope === scopes[name] && element.isConnected,
    querySelectorAll(selector) { if (selector === "[data-family-record-id]") return [...this.records.values()]; assert.equal(selector, "[data-family-editor-id]"); return this.form ? [this.form] : []; },
    querySelector(selector) { if (selector === "[data-family-refresh]") return this.refresh.isConnected ? this.refresh : null; assert.equal(selector, "[data-family-add], [data-autofocus]"); return this.add?.isConnected ? this.add : this.close; },
  }]));
  const element = (scope, name) => ({ name, scope, ownerDocument: document, isConnected: true, disabled: false, matches(selector) { assert.equal(selector, ":disabled"); return this.disabled; }, focus(options) { assert.ok(this.isConnected && !this.disabled); document.activeElement = this; calls.push({ scope: scope.name, name, options }); for (const callback of focusListeners) callback({ target: this }); } });
  const button = (scope, name) => ({ ...element(scope, name), closest(selector) {
    if (selector === ".edupi-family-panel") return scope === scopes.inline ? scope : null;
    assert.equal(selector, '[role="dialog"]'); return scope === scopes.portal ? scope : null;
  } });
  scopes.inline.add = button(scopes.inline, "add trigger");
  for (const scope of Object.values(scopes)) {
    scope.modify = button(scope, "modify trigger");
    scope.refresh = button(scope, "refresh records");
    scope.close = button(scope, "close graph");
    scope.article = { ...element(scope, "record article"), contains: target => target?.isConnected && target.article === scope.article, querySelector(selector) { assert.equal(selector, "[data-family-delete-trigger]"); return scope.deleteMarked ? scope.delete : null; } };
    scope.delete = { ...element(scope, "delete trigger"), article: scope.article };
    scope.deleteCancel = { ...element(scope, "delete cancel"), article: scope.article, closest(selector) { assert.equal(selector, "article"); return scope.article; } };
  }
  const sources = {};
  const disconnect = target => { target.isConnected = false; if (document.activeElement === target || target.contains?.(document.activeElement)) document.activeElement = document.body; };
  return { scopes, sources, document, calls, focusListeners, move() { const target = { name: "another control", isConnected: true }; document.activeElement = target; for (const callback of focusListeners) callback({ target }); return target; }, commit(tree) {
    const graph = nodes(tree).find(node => typeof node.type === "function");
    sources.inline = [...nodes(tree), ...nodes(graph?.props.alert)]; sources.portal = nodes(graph?.props.details);
    for (const scope of Object.values(scopes)) {
      const source = sources[scope.name], formNode = source.find(node => node.type === "form");
      const cards = source.filter(node => node.type === "article"), ids = new Set(cards.map(node => node.key));
      for (const [id, article] of scope.records) if (!ids.has(id)) { disconnect(article); for (const control of article.actions.values()) disconnect(control); disconnect(article.source); scope.records.delete(id); }
      for (const card of cards) {
        let article = scope.records.get(card.key);
        if (!article) { article = { ...element(scope, `article:${card.key}`), actions: new Map(), getAttribute: name => card.props[name], contains: target => target?.isConnected && target.article === article,
          querySelector(selector) { if (selector === "[data-family-source]") return this.source; const action = selector.match(/^\[data-family-action="(.+)"\]$/)?.[1]; assert.ok(action); return this.actions.get(action) || null; } };
          article.source = { ...element(scope, `source:${card.key}`), article }; scope.records.set(card.key, article); }
        const actionNodes = nodes(card).filter(node => node.type === "button" && (node.props["data-family-action"] || ["接受", "暂缓", "拒绝", "修改", "恢复", "确认删除"].includes(text(node))));
        const seen = new Set();
        for (const node of actionNodes) { const action = node.props["data-family-action"] || ({ 接受: "accept", 暂缓: "hold", 拒绝: "reject", 修改: "modify", 恢复: "restore", 确认删除: "delete" })[text(node)]; seen.add(action);
          if (!article.actions.has(action)) article.actions.set(action, { ...button(scope, `${action}:${card.key}`), article });
          const control = article.actions.get(action); control.disabled = Boolean(node.props.disabled); if (document.activeElement === control && control.disabled) document.activeElement = document.body; }
        for (const [action, control] of article.actions) if (!seen.has(action)) { disconnect(control); article.actions.delete(action); }
      }
      scope.refresh.isConnected = scope.isConnected && source.some(node => node.type === "button" && text(node) === "刷新记录");
      if (!scope.refresh.isConnected) disconnect(scope.refresh);
      scope.modify.disabled = Boolean(source.find(node => node.type === "button" && text(node) === "修改")?.props.disabled);
      if (scope.add) scope.add.disabled = Boolean(source.find(node => node.type === "button" && text(node) === "添加记录")?.props.disabled);
      const deleteNode = source.find(node => node.type === "button" && text(node) === "删除");
      scope.article.isConnected = scope.isConnected && source.some(node => node.type === "article");
      scope.delete.isConnected = scope.article.isConnected && Boolean(deleteNode);
      scope.delete.disabled = Boolean(deleteNode?.props.disabled);
      scope.deleteMarked = Boolean(deleteNode?.props["data-family-delete-trigger"]);
      scope.deleteCancel.isConnected = scope.article.isConnected && source.some(node => node.type === "button" && text(node) === "确认删除");
      if (document.activeElement === scope.deleteCancel && !scope.deleteCancel.isConnected) document.activeElement = document.body;
      if (formNode) {
        if (!scope.form) {
          const form = { ...element(scope, "form"), contains: target => target?.isConnected && target.form === form, getAttribute: name => form.node.props[name], querySelector(selector) { if (selector === 'button[type="submit"]') return this.save; assert.equal(selector, "select, input, textarea"); return this.first; } };
          form.first = { ...element(scope, formNode.props["aria-label"] === "添加家校记录" ? "contact select" : "relationship input"), form };
          form.cancel = { ...element(scope, "cancel"), form, closest(selector) { assert.equal(selector, "form"); return form; } };
          form.save = { ...button(scope, "save form"), form };
          scope.form = form;
        }
        scope.form.node = formNode;
        scope.form.save.disabled = Boolean(nodes(formNode).find(node => node.type === "button" && node.props.type === "submit")?.props.disabled);
      } else if (scope.form) {
        for (const target of [scope.form, scope.form.first, scope.form.cancel, scope.form.save]) { target.isConnected = false; if (document.activeElement === target) document.activeElement = document.body; }
        scope.form = null;
      }
      if (document.activeElement?.scope === scope && document.activeElement.disabled) document.activeElement = document.body;
    }
  } };
}

function mount({ records = [row], post, read } = {}) {
  const slots = [], listeners = new Map(), requests = [], dom = focusDom();
  let cursor = 0, dirty = false, effects = [], tree, mounted = true;
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
    if (options.method === "POST") return post ? await post(url, JSON.parse(options.body)) : { ok: false, json: async () => ({ error: "合成保存失败" }) };
    const params = new URL(url, "http://localhost").searchParams;
    const offset = Number(params.get("offset"));
    const response = { ok: true, json: async () => ({ studentId: params.get("student_id"), studentEntity: { entity_id: studentEntityId }, parents: [{ entity_id: parentEntityId, canonical_name: "合成联系人", status: "active" }], records: records.slice(offset, offset + 10), total: records.length, offset, limit: 10, nextOffset: offset + 10 < records.length ? offset + 10 : null, sourceStatus: "current", externalSend: false }) };
    return read ? read({ params, signal: options.signal, response }) : response;
  }, require(name) {
    if (name === "react") return react;
    if (name === "react/jsx-runtime") return { jsx, jsxs: jsx, Fragment: "fragment" };
    if (name === "@/lib/edupi-family-graph") return graphModel;
    if (name === "@/lib/edupi-family-record-model") return recordModel;
    if (name === "@/lib/edupi-ui-events") return { EDUPI_STUDENT_RECORDS_UPDATED_EVENT: "records-updated" };
    assert.equal(name, "./EduPiStudentGraph"); return { EduPiStudentGraph: Graph };
  } });
  const render = () => { if (!mounted) return; let attempts = 0; do { assert.ok(attempts++ < 20); cursor = 0; dirty = false; effects = []; tree = exports.EduPiFamilyRecords(props); dom.commit(tree); effects.splice(0).forEach(effect => effect()); } while (dirty); };
  const f = { props, dom, requests, render, async settle() { for (let i = 0; i < 5; i++) { await tick(); if (dirty) render(); } },
    select() { nodes(tree).find(node => node.type === Graph).props.onSelect(row.fact_id); render(); },
    list() { nodes(tree).find(node => node.type === "button" && text(node) === "记录").props.onClick(); render(); },
    next() { nodes(tree).find(node => node.type === "button" && text(node) === "下一页").props.onClick(); render(); },
    previous() { nodes(tree).find(node => node.type === "button" && text(node) === "上一页").props.onClick(); render(); },
    open(scopeName, create = false, commit = true) { const scope = dom.scopes[scopeName], label = create ? "添加记录" : "修改", trigger = create ? scope.add : scope.modify; trigger.focus({ preventScroll: false }); dom.calls.length = 0; dom.sources[scopeName].find(node => node.type === "button" && text(node) === label).props.onClick({ currentTarget: trigger }); if (commit) render(); },
    change(scopeName, label, value) { const form = dom.sources[scopeName].find(node => node.type === "form"); const field = nodes(form).find(node => node.type === "label" && text(node.props.children[0]) === label); nodes(field).find(node => ["input", "select", "textarea"].includes(node.type)).props.onChange({ target: { value } }); render(); },
    cancel(scopeName) { const scope = dom.scopes[scopeName]; scope.form.cancel.focus({ preventScroll: false }); dom.sources[scopeName].find(node => node.type === "button" && text(node) === "取消").props.onClick({ currentTarget: scope.form.cancel }); render(); },
    beginDelete(scopeName) { const scope = dom.scopes[scopeName]; scope.delete.focus({ preventScroll: false }); dom.sources[scopeName].find(node => node.type === "button" && text(node) === "删除").props.onClick(); render(); },
    cancelDelete(scopeName, commit = true) { const scope = dom.scopes[scopeName]; scope.deleteCancel.focus({ preventScroll: false }); dom.calls.length = 0; dom.sources[scopeName].find(node => node.type === "button" && text(node) === "取消").props.onClick({ currentTarget: scope.deleteCancel }); if (commit) render(); },
    refresh(commit = true) { listeners.get("records-updated")(); if (commit) render(); },
    act(action, factId = row.fact_id, scopeName = "inline", commit = true) { const scope = dom.scopes[scopeName], card = scopeName === "portal" ? dom.sources.portal.find(node => node.type === "article" && node.key === factId) : nodes(tree).find(node => node.type === "article" && node.key === factId);
      const node = nodes(card).find(node => node.type === "button" && (node.props["data-family-action"] === action || text(node) === ({ accept: "接受", hold: "暂缓", reject: "拒绝", restore: "恢复", delete: "确认删除" })[action]));
      const trigger = scope.records.get(factId).actions.get(action); trigger.focus({ preventScroll: false }); dom.calls.length = 0; node.props.onClick({ currentTarget: trigger }); if (commit) render(); },
    submit(scopeName = "inline", commit = true) { const scope = dom.scopes[scopeName]; scope.form.save.focus({ preventScroll: false }); dom.calls.length = 0; const pending = dom.sources[scopeName].find(node => node.type === "form").props.onSubmit({ preventDefault() {}, currentTarget: scope.form }); if (commit) render(); return pending; },
    unmount() { mounted = false; for (const slot of slots) slot?.cleanup?.(); for (const scope of Object.values(dom.scopes)) scope.isConnected = false; },
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
  await form.props.onSubmit({ preventDefault() {}, currentTarget: f.dom.scopes.portal.form }); f.render();
  const request = f.requests.find(request => request.method === "POST");
  assert.equal(request.url, "/api/edupi/facts/synthetic-family-fact");
  const body = JSON.parse(request.body);
  assert.equal(body.expectedRevision, 4); assert.equal(body.reviewer, "合成原记录者"); assert.equal(body.action, "modify"); assert.equal(body.note, null);
  assert.deepEqual(JSON.parse(body.replacementValue), { ...row.record, recorded_relationship: "合成新称谓", note: "合成新记录" });
  assert.ok(f.dom.sources.portal.some(node => node.type === "textarea" && node.props.value === " 合成新记录 "), "a failed mutation retains the editing draft");
});

for (const surface of ["list", "portal"]) test(`${surface} family conflict comparisons appear only for pending review or non-direct deleted restore`, async () => {
  const cases = [
    { status: "superseded", restore_mode: "direct", show: false },
    { status: "rejected", restore_mode: "direct", show: false },
    { status: "accepted", restore_mode: "direct", show: false },
    { status: "stale", restore_mode: "direct", show: false },
    { status: "candidate", restore_mode: "direct", show: true },
    { status: "pending_review", restore_mode: "direct", show: true },
    { status: "held", restore_mode: "direct", show: true },
    { status: "deleted", restore_mode: "pending_review", show: true },
    { status: "deleted", restore_mode: "replace", show: true },
    { status: "deleted", restore_mode: "blocked", show: true },
    { status: "deleted", restore_mode: "direct", show: false },
    { status: "pending_review", restore_mode: "direct", empty: true, show: false },
    { status: "deleted", restore_mode: "replace", empty: true, show: false },
  ];
  for (const example of cases) {
    const item = { ...row, status: example.status, restore_mode: example.restore_mode, review_mode: "replace", superseded_by: "synthetic-current-A2", history: [{ action: "accept", reviewed_at: "2026-10-21T01:00:00.000Z", reviewer: "合成教师", note: "合成审核历史" }],
      review_conflicts: example.empty ? [] : [{ fact_id: "synthetic-current-A2", revision: 0, record: { ...row.record, note: "合成当前A2内容" } }] };
    const f = mount({ records: [item] }); await f.settle();
    if (surface === "list") f.list(); else f.select();
    const source = f.dom.sources[surface === "list" ? "inline" : "portal"];
    const disclosure = source.find(node => node.type === "details" && text(node.props.children[0]) === "需要核对的旧记录");
    assert.equal(Boolean(disclosure), example.show, `${example.status}/${example.restore_mode}/${example.empty ? "empty" : "conflict"}`);
    if (example.show) assert.equal(disclosure.props.open, true);
    else assert.equal(text(source).includes("合成当前A2内容"), false, "current replacement is not repeated as an old pending record");
    assert.ok(source.some(node => node.type === "details" && text(node.props.children[0]) === "来源"));
    assert.ok(source.some(node => node.type === "details" && text(node.props.children[0]) === "修订记录"));
    assert.ok(source.some(node => node.type === "p" && text(node) === row.record.note), "the historical record's own values remain visible");
    assert.equal(f.requests.some(request => request.method === "POST"), false);
  }
});

test("existing contact capture uses its canonical name in source text while keeping ID and retry identity", async () => {
  const f = mount(); await f.settle(); f.open("inline", true);
  f.change("inline", "联系人名称", "未选用的新联系人草稿");
  f.change("inline", "联系人", parentEntityId); f.change("inline", "教师记录", "合成已有联系人记录");
  const submit = () => f.dom.sources.inline.find(node => node.type === "form").props.onSubmit({ preventDefault() {}, currentTarget: f.dom.scopes.inline.form });
  await submit(); f.render();
  const first = JSON.parse(f.requests.find(request => request.method === "POST").body);
  assert.equal(first.studentId, "synthetic-student"); assert.equal(first.parentEntityId, parentEntityId); assert.equal(first.parent, null);
  assert.equal(first.source.raw_text, "联系人：合成联系人\n记录称谓：未记录\n沟通状态：未判断\n沟通日期：未记录\n合成已有联系人记录");
  assert.equal(first.source.raw_text.includes(parentEntityId), false);
  assert.equal(first.source.source_id, "desktop-family-synthetic-family-editor"); assert.equal(first.source.source_revision, "1");
  assert.equal(first.source.actor_ref, "合成教师"); assert.ok(recordModel.parseFamilyCaptureInput(first));
  await submit(); f.render();
  assert.deepEqual(JSON.parse(f.requests.filter(request => request.method === "POST")[1].body), first, "retry keeps the original capture identity and observation time");
  assert.equal(row.source.raw_text, "合成来源", "an existing record source is never rewritten");
});

test("new contact capture retains the entered source name and existing generated bindings", async () => {
  const f = mount(); await f.settle(); f.open("inline", true); f.change("inline", "联系人名称", "合成新联系人"); f.change("inline", "教师记录", "合成新联系人记录");
  await f.dom.sources.inline.find(node => node.type === "form").props.onSubmit({ preventDefault() {}, currentTarget: f.dom.scopes.inline.form }); f.render();
  const body = JSON.parse(f.requests.find(request => request.method === "POST").body);
  assert.equal(body.parentEntityId, null); assert.deepEqual(body.parent, { external_id: "family-synthetic-family-editor", label: "合成新联系人" });
  assert.equal(body.source.raw_text.split("\n")[0], "联系人：合成新联系人");
  assert.equal(body.source.source_id, "desktop-family-synthetic-family-editor"); assert.equal(body.source.source_revision, "1");
  assert.ok(recordModel.parseFamilyCaptureInput(body));
});

const pagedRows = status => Array.from({ length: 16 }, (_, index) => ({ ...row, fact_id: `synthetic-family-${index + 1}`, status, record: { ...row.record, note: `合成分页记录${index + 1}` } }));
const lastReadOffset = f => new URL(f.requests.filter(request => !request.method).at(-1).url, "http://localhost").searchParams.get("offset");
const visibleCards = f => f.dom.sources.inline.filter(node => node.type === "article" && node.props.className === "edupi-family-record");
const pagerButton = (f, label) => f.dom.sources.inline.find(node => node.type === "button" && text(node) === label);

for (const [action, label, beforeStatus, afterStatus, afterLabel] of [
  ["accept", "接受", "pending_review", "accepted", "已确认"],
  ["hold", "暂缓", "pending_review", "held", "已暂缓"],
  ["reject", "拒绝", "pending_review", "rejected", "已拒绝"],
  ["delete", "删除", "accepted", "deleted", "已删除"],
  ["restore", "恢复", "deleted", "accepted", "已确认"],
]) test(`an in-place family ${action} on page two keeps its offset and back-page trail`, async () => {
  const records = pagedRows(beforeStatus), targetId = records[14].fact_id;
  const f = mount({ records, post: async (url, body) => {
    assert.equal(url, `/api/edupi/facts/${targetId}`);
    assert.equal(body.expectedRevision, 4); assert.equal(body.reviewer, "合成原记录者");
    assert.equal(body.action, ["accept", "hold", "reject"].includes(action) ? "review" : action);
    if (body.action === "review") assert.equal(body.decision, action);
    records[14] = { ...records[14], status: afterStatus, revision: 5 };
    return { ok: true, json: async () => ({ data: {}, result: { resultFactId: targetId } }) };
  } });
  await f.settle(); f.list(); f.next(); await f.settle();
  assert.equal(lastReadOffset(f), "10"); assert.equal(visibleCards(f).length, 6);
  const card = visibleCards(f).find(node => node.key === targetId);
  if (action === "delete") { nodes(card).find(node => node.type === "button" && text(node) === label).props.onClick(); f.render(); }
  f.act(action, targetId);
  await f.settle();
  assert.equal(lastReadOffset(f), "10", "an in-place decision must reread the current page");
  assert.equal(visibleCards(f).length, 6);
  assert.ok(text(visibleCards(f).find(node => node.key === targetId)).includes(afterLabel));
  assert.equal(pagerButton(f, "上一页").props.disabled, false);
  f.previous(); await f.settle();
  assert.equal(lastReadOffset(f), "0"); assert.equal(visibleCards(f).length, 10);
  assert.equal(pagerButton(f, "上一页").props.disabled, true);
  assert.equal(pagerButton(f, "下一页").props.disabled, false);
  assert.equal(f.requests.filter(request => request.method === "POST").length, 1);
});

test("a family modification that creates a new fact still returns to page one", async () => {
  const records = pagedRows("accepted"), newId = "synthetic-family-modified-new";
  const f = mount({ records, post: async (url, body) => {
    assert.equal(url, "/api/edupi/facts/synthetic-family-11"); assert.equal(body.action, "modify"); assert.equal(body.expectedRevision, 4);
    records[10] = { ...records[10], status: "superseded" };
    records.unshift({ ...row, fact_id: newId, record: JSON.parse(body.replacementValue) });
    return { ok: true, json: async () => ({ data: {}, result: { resultFactId: newId } }) };
  } });
  await f.settle(); f.list(); f.next(); await f.settle(); f.open("inline"); f.change("inline", "教师记录", "合成新的修订记录");
  await f.dom.sources.inline.find(node => node.type === "form").props.onSubmit({ preventDefault() {}, currentTarget: f.dom.scopes.inline.form }); await f.settle();
  assert.equal(lastReadOffset(f), "0"); assert.equal(visibleCards(f)[0].key, newId);
  assert.equal(pagerButton(f, "上一页").props.disabled, true);
});

test("adding a new family record from page two still returns to page one", async () => {
  const records = pagedRows("accepted"), newId = "synthetic-family-captured-new";
  const f = mount({ records, post: async (url, body) => {
    assert.equal(url, "/api/edupi/family-records"); assert.equal(body.studentId, "synthetic-student");
    records.unshift({ ...row, fact_id: newId, status: "pending_review", record: { ...row.record, ...body.record } });
    return { ok: true, json: async () => ({ data: {}, record: { fact_id: newId } }) };
  } });
  await f.settle(); f.list(); f.next(); await f.settle(); f.open("inline", true); f.change("inline", "联系人名称", "合成追加联系人"); f.change("inline", "教师记录", "合成新增分页记录");
  await f.dom.sources.inline.find(node => node.type === "form").props.onSubmit({ preventDefault() {}, currentTarget: f.dom.scopes.inline.form }); await f.settle();
  assert.equal(lastReadOffset(f), "0"); assert.equal(visibleCards(f)[0].key, newId);
  assert.equal(pagerButton(f, "上一页").props.disabled, true);
});

for (const surface of ["inline", "portal"]) test(`keyboard delete cancellation in ${surface} returns only to that record's delete trigger`, async () => {
  const f = mount(); await f.settle(); f.select(); f.beginDelete(surface);
  assert.ok(f.dom.scopes.inline.deleteCancel.isConnected && f.dom.scopes.portal.deleteCancel.isConnected);
  f.cancelDelete(surface);
  assert.equal(f.dom.document.activeElement, f.dom.scopes[surface].delete);
  assert.deepEqual(f.dom.calls.map(call => [call.scope, call.name]), [[surface, "delete trigger"]]);
  assert.equal(f.dom.scopes.inline.deleteCancel.isConnected, false); assert.equal(f.dom.scopes.portal.deleteCancel.isConnected, false);
  assert.equal(f.requests.some(request => request.method === "POST"), false);
  assert.equal(row.status, "accepted"); assert.equal(row.revision, 4);
});

test("delete cancellation does not return focus after moving focus, disconnecting its dialog, or changing student", async () => {
  for (const change of ["focus", "dialog", "student"]) {
    const f = mount(); await f.settle(); f.select(); f.beginDelete("portal"); f.cancelDelete("portal", false);
    let expected = f.dom.document.body;
    if (change === "focus") expected = f.dom.move();
    else if (change === "dialog") f.dom.scopes.portal.isConnected = false;
    else f.props.studentId = "another-student";
    f.render(); await f.settle();
    assert.equal(f.dom.document.activeElement, expected, change);
    assert.deepEqual(f.dom.calls, [], change);
    assert.equal(f.requests.some(request => request.method === "POST"), false);
  }
});

const deferred = () => { let resolve; const promise = new Promise(done => { resolve = done; }); return { promise, resolve }; };
const success = resultFactId => ({ ok: true, json: async () => ({ data: {}, result: { resultFactId } }) });

for (const [action, beforeStatus, afterStatus, focusAction] of [
  ["hold", "pending_review", "held", "hold"], ["accept", "pending_review", "accepted", "modify"],
  ["reject", "pending_review", "rejected", "source"], ["delete", "accepted", "deleted", "restore"], ["restore", "deleted", "accepted", "modify"],
]) test(`family ${action} waits for the real page reload before focusing its safe action on page two`, async () => {
  const records = pagedRows(beforeStatus), targetId = records[14].fact_id, write = deferred(), read = deferred(); let reads = 0;
  const f = mount({ records, post: async () => { await write.promise; records[14] = { ...records[14], status: afterStatus, revision: 5 }; return success(targetId); },
    read: ({ response }) => ++reads > 2 ? read.promise.then(() => response) : response });
  await f.settle(); f.list(); f.next(); await f.settle();
  if (action === "delete") { nodes(visibleCards(f).find(node => node.key === targetId)).find(node => node.type === "button" && text(node) === "删除").props.onClick(); f.render(); }
  f.act(action, targetId); assert.equal(f.dom.document.activeElement, f.dom.document.body); assert.equal(f.dom.focusListeners.size, 1);
  write.resolve(); await f.settle(); assert.equal(reads, 3); assert.equal(visibleCards(f).length, 0); assert.deepEqual(f.dom.calls, [], "the old row must never receive focus before its loading replacement");
  read.resolve(); await f.settle();
  assert.equal(f.dom.document.activeElement.name, `${focusAction}:${targetId}`); assert.equal(lastReadOffset(f), "10");
  assert.equal(f.dom.calls.length, 1); assert.equal(f.dom.focusListeners.size, 0);
});

test("fast family mutation and read completions still restore focus after the final DOM commit", async () => {
  const records = [{ ...row, status: "pending_review" }];
  const f = mount({ records, post: async () => { records[0] = { ...records[0], status: "accepted", revision: 5 }; return success(row.fact_id); } });
  await f.settle(); f.list(); f.act("accept", row.fact_id, "inline", false); f.dom.document.activeElement = f.dom.document.body;
  await f.settle(); assert.equal(f.dom.document.activeElement.name, `modify:${row.fact_id}`); assert.equal(f.dom.calls.length, 1); assert.equal(f.dom.focusListeners.size, 0);
});

test("a family button activation that leaves the prior Mac focus in place still follows the invoked action", async () => {
  const records = [{ ...row, status: "pending_review" }];
  const f = mount({ records, post: async () => { records[0] = { ...records[0], status: "accepted" }; return success(row.fact_id); } });
  await f.settle(); f.list(); f.dom.move(); f.dom.calls.length = 0;
  nodes(visibleCards(f)[0]).find(node => node.type === "button" && text(node) === "接受").props.onClick({ currentTarget: f.dom.scopes.inline.records.get(row.fact_id).actions.get("accept") });
  f.render(); await f.settle();
  assert.equal(f.dom.document.activeElement.name, `modify:${row.fact_id}`); assert.equal(f.dom.calls.length, 1);
});

test("failed family writes keep the current page and focus the existing refresh retry", async () => {
  const f = mount({ records: [{ ...row, status: "pending_review" }] }); await f.settle(); f.list(); f.act("accept"); await f.settle();
  assert.equal(f.dom.document.activeElement, f.dom.scopes.inline.refresh); assert.equal(f.requests.filter(request => !request.method).length, 1);
  assert.ok(text(f.dom.sources.inline).includes("合成保存失败")); assert.equal(f.dom.focusListeners.size, 0);
});

test("a successful family write followed by a failed reload focuses read retry instead of the stale row", async () => {
  let reads = 0;
  const f = mount({ records: [{ ...row, status: "pending_review" }], post: async () => success(row.fact_id),
    read: ({ response }) => ++reads === 1 ? response : { ok: false, json: async () => ({ error: "合成重读失败" }) } });
  await f.settle(); f.list(); f.act("accept"); await f.settle();
  assert.equal(f.dom.document.activeElement, f.dom.scopes.inline.refresh); assert.equal(f.dom.scopes.inline.records.size, 0); assert.equal(f.dom.focusListeners.size, 0);
});

for (const phase of ["write", "read"]) test(`moving focus during family ${phase} cancels return even after focus reaches body again`, async () => {
  const records = [{ ...row, status: "pending_review" }], write = deferred(), read = deferred(); let reads = 0;
  const f = mount({ records, post: async () => { await write.promise; records[0] = { ...records[0], status: "accepted" }; return success(row.fact_id); }, read: ({ response }) => ++reads === 1 ? response : read.promise.then(() => response) });
  await f.settle(); f.list(); f.act("accept");
  if (phase === "read") { write.resolve(); await f.settle(); }
  f.dom.move(); f.dom.document.activeElement = f.dom.document.body;
  write.resolve(); read.resolve(); await f.settle();
  assert.equal(f.dom.document.activeElement, f.dom.document.body); assert.deepEqual(f.dom.calls, []); assert.equal(f.dom.focusListeners.size, 0);
});

for (const change of ["page", "student"]) test(`a late family page response cannot return focus after changing ${change}`, async () => {
  const records = pagedRows("pending_review"), targetId = records[14].fact_id, read = deferred(); let reads = 0;
  const f = mount({ records, post: async () => { records[14] = { ...records[14], status: "held" }; return success(targetId); },
    read: ({ params, response }) => {
      if (params.get("student_id") === "another-student") return { ok: true, json: async () => ({ ...await response.json(), records: [{ ...row, fact_id: "synthetic-other-student-fact" }], total: 11, nextOffset: null }) };
      return ++reads === 3 ? read.promise.then(() => response) : response;
    } });
  await f.settle(); f.list(); f.next(); await f.settle(); f.act("hold", targetId); await f.settle(); assert.equal(reads, 3);
  if (change === "page") f.previous(); else { f.props.studentId = "another-student"; f.render(); }
  await f.settle(); const currentRead = f.requests.filter(request => !request.method).at(-1).url;
  read.resolve(); await f.settle();
  assert.equal(f.requests.filter(request => !request.method).at(-1).url, currentRead); assert.deepEqual(f.dom.calls, []); assert.equal(f.dom.focusListeners.size, 0);
  if (change === "page") { assert.equal(lastReadOffset(f), "0"); assert.equal(visibleCards(f).length, 10); }
  else { assert.equal(new URL(currentRead, "http://localhost").searchParams.get("student_id"), "another-student"); assert.deepEqual(visibleCards(f).map(card => card.key), ["synthetic-other-student-fact"]); }
});

test("family mutation focus remains inside the originating expanded graph copy", async () => {
  const records = [{ ...row, status: "pending_review" }];
  const f = mount({ records, post: async () => { records[0] = { ...records[0], status: "accepted" }; return success(row.fact_id); } });
  await f.settle(); f.select(); f.act("accept", row.fact_id, "portal"); await f.settle();
  assert.equal(f.dom.document.activeElement, f.dom.scopes.portal.records.get(row.fact_id).actions.get("modify"));
  assert.deepEqual(f.dom.calls.map(call => call.scope), ["portal"]);
});

test("family focus listeners are released on disconnect and unmount", async () => {
  for (const change of ["disconnect", "unmount"]) {
    const write = deferred(), f = mount({ records: [{ ...row, status: "pending_review" }], post: async () => { await write.promise; return success(row.fact_id); } });
    await f.settle(); f.list(); f.act("accept"); assert.equal(f.dom.focusListeners.size, 1);
    if (change === "unmount") f.unmount(); else { f.dom.scopes.inline.isConnected = false; f.render(); }
    write.resolve(); await f.settle(); assert.deepEqual(f.dom.calls, []); assert.equal(f.dom.focusListeners.size, 0);
  }
});

test("a family revision focuses the replacement fact after its page-one read", async () => {
  const records = [row], id = "synthetic-family-replacement";
  const f = mount({ records, post: async () => { records.unshift({ ...row, fact_id: id }); return success(id); } });
  await f.settle(); f.select(); f.open("portal"); const pending = f.submit("portal"); await pending; await f.settle();
  assert.equal(f.dom.document.activeElement, f.dom.scopes.portal.records.get(id).actions.get("modify")); assert.equal(lastReadOffset(f), "0"); assert.equal(f.dom.calls.length, 1);
});

for (const view of ["list", "graph"]) test(`new family capture returns to a safe ${view} entry without rewriting graph selection`, async () => {
  const records = [row], id = "synthetic-family-new-capture";
  const f = mount({ records, post: async () => { records.unshift({ ...row, fact_id: id, status: "pending_review" }); return { ok: true, json: async () => ({ record: { fact_id: id } }) }; } });
  await f.settle(); if (view === "list") f.list(); f.open("inline", true); f.change("inline", "教师记录", "合成新增内容");
  await f.submit(); await f.settle();
  assert.equal(f.dom.document.activeElement, view === "list" ? f.dom.scopes.inline.records.get(id).source : f.dom.scopes.inline.add);
  assert.equal(lastReadOffset(f), "0"); assert.equal(f.dom.calls.length, 1);
});

for (const outcome of ["success", "failure"]) test(`a failed write batched with records-updated waits for the ${outcome} read commit`, async () => {
  const read = deferred(); let reads = 0;
  const f = mount({ records: [{ ...row, status: "pending_review" }],
    post: async () => ({ ok: false, json: async () => { f.refresh(false); return { error: "合成写入失败" }; } }),
    read: ({ response }) => ++reads === 1 ? response : read.promise.then(() => outcome === "success" ? response : { ok: false, json: async () => ({ error: "合成刷新失败" }) }) });
  await f.settle(); f.list(); f.act("accept"); await f.settle();
  assert.equal(reads, 2); assert.equal(f.dom.scopes.inline.refresh.isConnected, false); assert.equal(f.dom.document.activeElement, f.dom.document.body);
  assert.deepEqual(f.dom.calls, [], "the retry from the stale render must not consume failure focus before reload");
  assert.equal(f.dom.focusListeners.size, 1);
  read.resolve(); await f.settle();
  const target = outcome === "failure" ? f.dom.scopes.inline.refresh : f.dom.scopes.inline.records.get(row.fact_id).source;
  assert.equal(target.isConnected, true); assert.equal(f.dom.document.activeElement, target); assert.equal(f.dom.calls.length, 1); assert.equal(f.dom.focusListeners.size, 0);
});

test("moving focus during the read batched with a failed write cancels its final retry focus", async () => {
  const read = deferred(); let reads = 0;
  const f = mount({ records: [{ ...row, status: "pending_review" }],
    post: async () => ({ ok: false, json: async () => { f.refresh(false); return { error: "合成写入失败" }; } }),
    read: ({ response }) => ++reads === 1 ? response : read.promise.then(() => ({ ok: false, json: async () => ({ error: "合成刷新失败" }) })) });
  await f.settle(); f.list(); f.act("accept"); await f.settle(); f.dom.calls.length = 0;
  f.dom.move(); f.dom.document.activeElement = f.dom.document.body; read.resolve(); await f.settle();
  assert.equal(f.dom.scopes.inline.refresh.isConnected, true); assert.equal(f.dom.document.activeElement, f.dom.document.body); assert.deepEqual(f.dom.calls, []); assert.equal(f.dom.focusListeners.size, 0);
});

test("an old aborted read finishing during a newer family mutation does not clear its focus request", async () => {
  const records = [{ ...row, status: "pending_review" }], oldRead = deferred(), nextWrite = deferred(); let reads = 0, writes = 0;
  const f = mount({ records,
    post: async () => { if (++writes > 1) await nextWrite.promise; records[0] = { ...records[0], status: "held", revision: 4 + writes }; return success(row.fact_id); },
    read: ({ response }) => ++reads === 2 ? oldRead.promise.then(() => response) : response });
  await f.settle(); f.list(); f.act("hold"); await f.settle(); f.refresh(); await f.settle();
  assert.equal(reads, 3); f.act("hold"); assert.equal(f.dom.focusListeners.size, 1);
  oldRead.resolve(); await f.settle(); assert.deepEqual(f.dom.calls, []); assert.equal(f.dom.focusListeners.size, 1);
  nextWrite.resolve(); await f.settle();
  assert.equal(f.dom.document.activeElement.name, `hold:${row.fact_id}`); assert.equal(f.dom.calls.length, 1); assert.equal(f.dom.focusListeners.size, 0);
});
