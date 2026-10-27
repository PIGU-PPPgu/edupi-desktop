import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import test from "node:test";
import vm from "node:vm";

const require = createRequire(import.meta.url);
const { createJiti } = require("jiti");
const jiti = createJiti(import.meta.url, { fsCache: false });
const model = await jiti.import("../lib/edupi-context-editor-model.ts");
const source = readFileSync(new URL("./EduPiContextEditor.tsx", import.meta.url), "utf8");
const compiled = jiti.transform({ source, filename: "EduPiContextEditor.tsx", ts: true, jsx: { runtime: "automatic" } });
const jsx = (type, props, key) => ({ type, props: props || {}, key });
const tick = () => new Promise(resolve => setImmediate(resolve));
function descendants(node) {
  if (Array.isArray(node)) return node.flatMap(descendants);
  if (!node || typeof node !== "object" || !node.props) return [];
  return [node, ...descendants(node.props.children)];
}
const text = node => typeof node === "string" ? node : Array.isArray(node) ? node.map(text).join("") : node?.props ? text(node.props.children) : "";
const current = { name: "合成教师", role: "班主任", subject: "数学", grade: "七年级", class_name: "合成班级" };
const version = { versionId: "synthetic-v1", contextId: "synthetic-context", revision: 1, beforeValues: { ...current, name: "旧称呼" }, afterValues: { ...current, subject: "科学" }, changedFields: ["name", "subject"], reviewedAt: "2026-10-26T00:00:00Z", reviewerId: "teacher", note: null, receiptId: "receipt-version", externalSend: false };

function mount({ status = "pending_review", versions = [version], enabled = true, post, confirm = true } = {}) {
  const slots = [], listeners = new Set(), calls = [], reviewed = [], confirmations = [], agentRequests = [];
  let cursor = 0, dirty = false, effects = [], tree, closed = 0;
  const sameDeps = (left, right) => left && left.length === right.length && left.every((value, index) => Object.is(value, right[index]));
  const hooks = {
    useState(initial) {
      const index = cursor++;
      if (!(index in slots)) slots[index] = typeof initial === "function" ? initial() : initial;
      return [slots[index], value => { const next = typeof value === "function" ? value(slots[index]) : value; if (!Object.is(slots[index], next)) { slots[index] = next; dirty = true; } }];
    },
    useRef(initial) { const index = cursor++; slots[index] ??= { current: initial }; return slots[index]; },
    useMemo(create, deps) { const index = cursor++; if (!sameDeps(slots[index]?.deps, deps)) slots[index] = { deps, value: create() }; return slots[index].value; },
    useEffect(callback, deps) {
      const index = cursor++, prior = slots[index];
      if (!sameDeps(prior?.deps, deps)) {
        slots[index] = { deps, cleanup: prior?.cleanup };
        effects.push(() => { prior?.cleanup?.(); slots[index].cleanup = callback(); });
      }
    },
  };
  const candidate = { contextId: "synthetic-context", snapshotId: "synthetic-snapshot", stateHash: "sha256:synthetic", revision: 2, currentValues: current, proposedValues: { ...current, name: "待确认称呼" }, sourceIds: ["synthetic-source"], evidenceIds: ["synthetic-evidence"], status, teacherReview: { state: status }, externalSend: false };
  const props = { candidate, capability: { enabled }, history: Array.from({ length: 12 }, (_, index) => ({ reviewId: `review-${index}`, decision: "accept", status: "accepted", reviewedAt: "2026-10-26T00:00:00Z", teacherReview: { note: null } })), onAgentRequest(prompt) { agentRequests.push(prompt); }, onClose() { closed += 1; }, async onReviewed(result) { reviewed.push(result); return result.data; } };
  const exports = {};
  vm.runInNewContext(compiled, { exports, AbortController, Date, Error, Event, window: { addEventListener(name, callback, capture) { assert.equal(name, "keydown"); assert.equal(capture, true); listeners.add(callback); }, removeEventListener(_name, callback) { listeners.delete(callback); }, dispatchEvent() {} }, fetch: async (url, options = {}) => {
    calls.push({ url, method: options.method || "GET", body: options.body, signal: options.signal });
    return options.method === "POST" ? await post?.(url, options) || { ok: true, json: async () => ({ data: { teacherContextCandidates: [candidate] }, receipt: {} }) } : { ok: true, json: async () => ({ versions }) };
  }, require(name) {
    if (name === "react") return hooks;
    if (name === "react/jsx-runtime") return { jsx, jsxs: jsx, Fragment: "fragment" };
    if (name === "@/lib/desktop-native") return { async confirmTeacherContextFieldRestore() { confirmations.push(true); return confirm; } };
    assert.equal(name, "@/lib/edupi-context-editor-model");
    return model;
  } });
  const render = () => {
    let count = 0;
    do {
      assert.ok(count++ < 20, "context state should settle");
      cursor = 0; dirty = false; effects = [];
      tree = exports.EduPiContextEditor(props);
      effects.splice(0).forEach(callback => callback());
    } while (dirty);
    return tree;
  };
  render();
  return { props, calls, reviewed, confirmations, agentRequests, render, nodes: () => descendants(tree), find: predicate => descendants(tree).find(predicate), get tree() { return tree; }, get closed() { return closed; }, async settle() { for (let i = 0; i < 4; i++) { await tick(); if (dirty) render(); } }, async openHistory() { descendants(tree).find(node => node.type === "details" && node.props.onToggle).props.onToggle({ currentTarget: { open: true } }); render(); await this.settle(); }, escape() { const event = { key: "Escape", defaultPrevented: false, stopped: false, preventDefault() { this.defaultPrevented = true; }, stopPropagation() { this.stopped = true; } }; for (const callback of listeners) callback(event); if (!event.stopped) tree.props.onKeyDown(event); render(); return event; } };
}

const button = (f, label) => f.find(node => node.type === "button" && text(node) === label);

test("long histories keep context review actions before field and operation history", async () => {
  const f = mount({ versions: Array.from({ length: 15 }, (_, index) => ({ ...version, versionId: `synthetic-${index}`, revision: index + 1 })) });
  assert.equal(f.calls.length, 0, "field history stays lazy");
  await f.openHistory();
  const nodes = f.nodes(), actions = f.find(node => node.props["aria-label"] === "教师资料操作");
  const histories = nodes.filter(node => node.type === "details");
  assert.ok(nodes.indexOf(actions) < nodes.indexOf(histories[0]));
  assert.ok(nodes.indexOf(actions) < nodes.indexOf(histories[1]));
  assert.deepEqual(descendants(actions).filter(node => node.type === "button").map(text), ["手动填写", "接受", "修改", "暂缓", "拒绝"]);
  assert.equal(descendants(histories[1]).filter(node => node.type === "li").length, 10);
  assert.equal(nodes.filter(node => node.type === "table" && node.props.className === "edupi-context-editor__version-fields").length, 15);
});

test("editing forms stay before expanded history, retain drafts, and block history restore", async () => {
  const f = mount(); await f.openHistory();
  button(f, "手动填写").props.onClick(); f.render();
  const firstInput = f.find(node => node.type === "input");
  firstInput.props.onChange({ target: { value: "未保存合成称呼" } }); f.render();
  const history = f.find(node => node.type === "details" && node.props.onToggle);
  history.props.onToggle({ currentTarget: { open: false } }); f.render();
  history.props.onToggle({ currentTarget: { open: true } }); f.render(); await f.settle();
  const nodes = f.nodes(), form = f.find(node => node.props["aria-label"] === "手动填写教师资料");
  assert.ok(nodes.indexOf(form) < nodes.indexOf(f.find(node => node.type === "details")));
  assert.equal(f.find(node => node.type === "input").props.value, "未保存合成称呼");
  assert.equal(f.find(node => node.props["aria-label"] === "教师资料操作"), undefined, "hidden actions must not leave an empty spacer");
  assert.ok(nodes.filter(node => node.props.className === "edupi-context-editor__restore-value").every(node => node.props.disabled));
  assert.equal(f.calls.some(call => call.method === "POST"), false);
});

test("current history values are plain text and restore buttons retain exact snapshot-bound requests", async () => {
  let resolvePost;
  const pending = new Promise(resolve => { resolvePost = resolve; });
  const f = mount({ status: "accepted", post: () => pending }); await f.openHistory();
  const currentValue = f.find(node => node.props.className === "edupi-context-editor__current-value" && text(node).startsWith("合成教师"));
  assert.equal(currentValue.type, "span");
  assert.equal(currentValue.props.onClick, undefined);
  const restore = f.find(node => node.props["aria-label"] === "恢复称呼为旧称呼");
  assert.equal(restore.type, "button");
  assert.equal(restore.props.disabled, false);
  restore.props.onClick(); f.render();
  const call = f.calls.find(call => call.method === "POST");
  assert.equal(f.confirmations.length, 0, "accepted history restores do not prompt for replacement");
  assert.equal(call.url, "/api/edupi/onboarding/versions");
  assert.deepEqual(JSON.parse(call.body), { targetId: "synthetic-context", versionId: "synthetic-v1", versionSide: "before", fieldKey: "name", expectedSnapshotId: "synthetic-snapshot", expectedRevision: 2, expectedSourceId: "synthetic-source" });
  assert.ok(f.nodes().filter(node => node.props.className === "edupi-context-editor__restore-value").every(node => node.props.disabled));
  assert.ok(text(f.find(node => node.props["aria-label"] === "恢复称呼为旧称呼")).includes("恢复中…"));
  resolvePost({ ok: true, json: async () => ({ data: { teacherContextCandidates: [f.props.candidate] }, receipt: { synthetic: true } }) });
  await f.settle();
  assert.equal(f.reviewed.length, 1);
  assert.ok(f.nodes().some(node => node.props.role === "status" && text(node) === "已恢复称呼"));
});

test("Escape cancels the edit first and closes the context only on the next Escape", async () => {
  const f = mount(); await f.openHistory();
  button(f, "手动填写").props.onClick(); f.render();
  const first = f.escape();
  assert.equal(first.defaultPrevented, true);
  assert.equal(first.stopped, true);
  assert.equal(f.closed, 0);
  assert.equal(f.find(node => node.props["aria-label"] === "手动填写教师资料"), undefined);
  assert.ok(button(f, "手动填写"));
  f.escape();
  assert.equal(f.closed, 1);
});

test("modify and chat draft actions open above history without issuing a write", async () => {
  const modify = mount(); await modify.openHistory();
  button(modify, "修改").props.onClick(); modify.render();
  const modifyNodes = modify.nodes();
  assert.ok(modifyNodes.indexOf(modify.find(node => node.props["aria-label"] === "修改待确认更新")) < modifyNodes.indexOf(modify.find(node => node.type === "details")));
  assert.equal(modify.calls.some(call => call.method === "POST"), false);
  const draft = mount({ status: "accepted" }); await draft.openHistory();
  button(draft, "起草更新").props.onClick(); draft.render();
  const draftNodes = draft.nodes();
  assert.ok(draftNodes.indexOf(draft.find(node => node.props["aria-label"] === "起草教师上下文更新")) < draftNodes.indexOf(draft.find(node => node.type === "details")));
  assert.equal(draft.calls.some(call => call.method === "POST"), false);
});


test("cancelling history restoration leaves pending or held proposals untouched and sends no write", async () => {
  for (const status of ["pending_review", "held"]) {
    const f = mount({ status, confirm: false }); await f.openHistory();
    const before = JSON.stringify(f.props.candidate);
    f.find(node => node.props["aria-label"] === "恢复称呼为旧称呼").props.onClick(); f.render(); await f.settle();
    assert.equal(f.confirmations.length, 1, status);
    assert.equal(f.calls.some(call => call.method === "POST"), false, status);
    assert.equal(f.reviewed.length, 0, status);
    assert.equal(JSON.stringify(f.props.candidate), before, status);
    assert.equal(f.tree.props["aria-busy"], undefined, "cancellation releases the busy state");
    assert.ok(f.find(node => node.props["aria-label"] === "恢复称呼为旧称呼").props.disabled === false);
  }
});

test("confirming replacement preserves the original field restoration request and callback", async () => {
  const f = mount({ confirm: true }); await f.openHistory();
  f.find(node => node.props["aria-label"] === "恢复称呼为旧称呼").props.onClick(); f.render(); await f.settle();
  assert.equal(f.confirmations.length, 1);
  const writes = f.calls.filter(call => call.method === "POST");
  assert.equal(writes.length, 1);
  assert.deepEqual(JSON.parse(writes[0].body), { targetId: "synthetic-context", versionId: "synthetic-v1", versionSide: "before", fieldKey: "name", expectedSnapshotId: "synthetic-snapshot", expectedRevision: 2, expectedSourceId: "synthetic-source" });
  assert.equal(f.reviewed.length, 1);
});


function emptyForm(f) {
  for (const input of f.nodes().filter(node => node.type === "input")) input.props.onChange({ target: { value: "" } });
  f.render();
}

for (const form of [
  { label: "修改", status: "pending_review", submit: "提交修改", name: "修改待确认更新", error: "请至少修改一项。" },
  { label: "起草更新", status: "accepted", submit: "放入对话", name: "起草教师上下文更新", error: "请至少填写一项。" },
  { label: "手动填写", status: "accepted", submit: "保存", name: "手动填写教师资料", error: "请至少填写一项。" },
]) test(`cancelling ${form.name} clears its validation error without changing teacher data`, () => {
  const f = mount({ status: form.status });
  const before = JSON.stringify(f.props.candidate);
  button(f, form.label).props.onClick(); f.render();
  emptyForm(f);
  button(f, form.submit).props.onClick(); f.render();
  assert.equal(text(f.find(node => node.props.className === "edupi-context-editor__error")), form.error);
  button(f, "取消").props.onClick(); f.render();
  assert.equal(f.find(node => node.props["aria-label"] === form.name), undefined);
  assert.equal(f.find(node => node.props.className === "edupi-context-editor__error"), undefined);
  assert.equal(JSON.stringify(f.props.candidate), before);
  assert.equal(f.calls.some(call => call.method === "POST"), false);
  assert.equal(f.agentRequests.length, 0);
  assert.equal(f.reviewed.length, 0);
  assert.equal(f.closed, 0);
});

test("cancelling a form preserves earlier confirmed feedback and sends no extra write", async () => {
  const f = mount({ status: "accepted" }); await f.openHistory();
  f.find(node => node.props["aria-label"] === "恢复称呼为旧称呼").props.onClick(); f.render(); await f.settle();
  const success = text(f.find(node => node.props.className === "edupi-context-editor__feedback"));
  assert.equal(success, "已恢复称呼");
  const writes = f.calls.filter(call => call.method === "POST").length;
  button(f, "手动填写").props.onClick(); f.render(); emptyForm(f);
  button(f, "保存").props.onClick(); f.render();
  button(f, "取消").props.onClick(); f.render();
  assert.equal(f.find(node => node.props.className === "edupi-context-editor__error"), undefined);
  assert.equal(text(f.find(node => node.props.className === "edupi-context-editor__feedback")), success);
  assert.equal(f.calls.filter(call => call.method === "POST").length, writes);
  assert.equal(f.reviewed.length, 1);
});

test("the existing modal trap reaches both history summaries before cycling to close", async () => {
  const modalSource = readFileSync(new URL("../hooks/useModalDismiss.ts", import.meta.url), "utf8");
  const modalCode = jiti.transform({ source: modalSource, filename: "useModalDismiss.ts", ts: true });
  for (const expanded of [false, true]) {
    const f = mount();
    if (expanded) await f.openHistory();
    const listeners = new Set(), effects = [], exports = {}, document = { activeElement: null, addEventListener(_event, callback) { listeners.add(callback); }, removeEventListener(_event, callback) { listeners.delete(callback); } };
    vm.runInNewContext(modalCode, { exports, document, require(name) {
      assert.equal(name, "react");
      return { useRef: current => ({ current }), useEffect: callback => effects.push(callback) };
    } });
    const closeNode = jsx("button", { children: "关闭教育上下文", "data-autofocus": true });
    const controls = [closeNode, ...f.nodes()].map(node => ({ node, offsetParent: {}, focus() { document.activeElement = this; } }));
    const matching = selector => controls.filter(control => selector.split(",").some(part => {
      const token = part.trim(), { type, props } = control.node;
      if (token.startsWith("[tabindex]")) return props.tabIndex !== undefined && props.tabIndex !== -1;
      return token.startsWith(`${type}:`) || token.startsWith(`${type}[`) ? !props.disabled : false;
    }));
    const panel = {
      contains: element => controls.includes(element),
      querySelector: selector => selector === "[data-autofocus]" ? controls[0] : matching(selector)[0],
      querySelectorAll: selector => {
        assert.match(selector, /\[tabindex\]/, "the production trap already supports explicit tabindex");
        return matching(selector);
      },
    };
    const ref = exports.useModalDismiss(() => assert.fail("Tab must not close the context"));
    ref.current = panel;
    const cleanup = effects.shift()();
    const focusables = panel.querySelectorAll('button:not([disabled]), [tabindex]:not([tabindex="-1"])');
    const summaries = focusables.filter(control => control.node.type === "summary");
    assert.equal(summaries.length, 2, "both native history titles must join the modal's focus order");
    assert.ok(text(focusables.at(-1).node).startsWith("操作历史"));
    const pressTab = (shiftKey = false) => {
      const event = { key: "Tab", shiftKey, defaultPrevented: false, preventDefault() { this.defaultPrevented = true; }, stopPropagation() {} };
      for (const callback of listeners) callback(event);
      if (!event.defaultPrevented) {
        const nextIndex = focusables.indexOf(document.activeElement) + (shiftKey ? -1 : 1);
        focusables[nextIndex]?.focus();
      }
      return event;
    };
    const lastAction = focusables.find(control => control.node.type === "button" && text(control.node) === "拒绝");
    lastAction.focus();
    assert.equal(pressTab().defaultPrevented, false, "the final action must not prematurely cycle to close");
    assert.equal(document.activeElement, summaries[0]);
    if (expanded) {
      const operationIndex = focusables.indexOf(summaries[1]);
      for (let steps = 0; focusables.indexOf(document.activeElement) < operationIndex && steps < focusables.length; steps++) pressTab();
    } else pressTab();
    assert.equal(document.activeElement, summaries[1]);
    assert.equal(pressTab().defaultPrevented, true);
    assert.equal(document.activeElement, controls[0]);
    assert.equal(pressTab(true).defaultPrevented, true);
    assert.equal(document.activeElement, summaries[1]);
    cleanup();
    assert.equal(listeners.size, 0);
  }
});

const contextTable = f => f.find(node => node.type === "table" && node.props.className === "edupi-context-editor__table");
const tableHeadings = table => descendants(table).filter(node => node.type === "th" && node.props.scope === "col").map(text);
const tableRows = table => descendants(table).filter(node => node.type === "tr" && descendants(node).some(child => child.type === "th" && child.props.scope === "row"));
const rowCells = row => descendants(row).filter(node => node.type === "th" || node.type === "td");

test("accepted, modified and unconfigured context tables show only effective values", () => {
  for (const status of ["accepted", "modified"]) {
    const f = mount({ status });
    const before = JSON.stringify(f.props.candidate);
    const table = contextTable(f);
    assert.deepEqual(tableHeadings(table), ["字段", "当前生效"], status);
    assert.equal(text(descendants(table).find(node => node.type === "caption")), "教师上下文当前生效值", status);
    assert.equal(tableRows(table).length, 5);
    assert.ok(tableRows(table).every(row => rowCells(row).length === 2));
    assert.equal(JSON.stringify(f.props.candidate), before);
    assert.equal(text(table).includes("待确认称呼"), false, "frozen accepted proposal values are not pending changes");
  }
  const empty = mount();
  empty.props.candidate = null; empty.render();
  const table = contextTable(empty);
  assert.deepEqual(tableHeadings(table), ["字段", "当前生效"]);
  assert.equal(text(descendants(table).find(node => node.type === "caption")), "教师上下文当前生效值");
  assert.ok(tableRows(table).every(row => rowCells(row).length === 2));
});

test("pending and held context tables preserve the current and pending comparison", () => {
  for (const status of ["pending_review", "held"]) {
    const f = mount({ status }), table = contextTable(f);
    assert.deepEqual(tableHeadings(table), ["字段", "当前生效", "待确认更新"], status);
    assert.equal(text(descendants(table).find(node => node.type === "caption")), "教师上下文当前生效值与待确认更新", status);
    assert.ok(tableRows(table).every(row => rowCells(row).length === 3));
    assert.ok(text(table).includes("合成教师"));
    assert.ok(text(table).includes("待确认称呼"));
  }
});

test("rejected context proposals remain readable under an explicit rejected heading", () => {
  const f = mount({ status: "rejected" });
  const before = JSON.stringify(f.props.candidate);
  let table = contextTable(f);
  assert.deepEqual(tableHeadings(table), ["字段", "当前生效", "已拒绝更新"]);
  assert.equal(text(descendants(table).find(node => node.type === "caption")), "教师上下文当前生效值与已拒绝更新");
  assert.ok(tableRows(table).every(row => rowCells(row).length === 3));
  assert.ok(text(table).includes("待确认称呼"), "rejected proposal values remain available to inspect");
  assert.equal(JSON.stringify(f.props.candidate), before);
  f.props.candidate = { ...f.props.candidate, proposedValues: {} }; f.render();
  table = contextTable(f);
  assert.deepEqual(tableHeadings(table), ["字段", "当前生效"]);
  assert.equal(text(descendants(table).find(node => node.type === "caption")), "教师上下文当前生效值");
});
