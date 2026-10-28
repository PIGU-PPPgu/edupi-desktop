import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import vm from "node:vm";
import ts from "typescript";

const code = ts.transpileModule(readFileSync(new URL("./EduPiDeletedEntities.tsx", import.meta.url), "utf8"), {
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.ReactJSX },
}).outputText;
const jsx = (type, props, key) => ({ type, props: props || {}, key });
const nodes = value => Array.isArray(value) ? value.flatMap(nodes) : value?.props ? [value, ...nodes(value.props.children)] : [];
const text = value => typeof value === "string" || typeof value === "number" ? String(value) : Array.isArray(value) ? value.map(text).join("") : value?.props ? text(value.props.children) : "";
const tick = () => new Promise(resolve => setImmediate(resolve));
const deletion = (id = "calendar-one") => ({ kind: "calendar", id, label: `[UI验收 TEST] ${id}`, deletedAt: "2026-10-27T08:00:00.000Z", restoreRequestId: `restore-${id}`, tombstoneRevision: 1, targetFingerprint: "sha256:" + "a".repeat(64), note: null });
const ledger = (deletions = [deletion()]) => ({ deletions, history: [] });

function mount({ initial = ledger(), activeCount = initial.deletions.length, countUnavailable = false } = {}) {
  const slots = [], listeners = new Set(), calls = [], reads = [], restores = [], requests = [];
  let cursor = 0, dirty = false, effects = [], tree, mounted = true, writesAfterUnmount = 0;
  const document = {
    body: { name: "body" }, documentElement: { name: "html" }, activeElement: null,
    addEventListener(name, callback) { assert.equal(name, "focusin"); listeners.add(callback); },
    removeEventListener(name, callback) { assert.equal(name, "focusin"); listeners.delete(callback); },
  };
  document.activeElement = document.body;
  const root = {
    name: "recycle", ownerDocument: document, isConnected: true,
    contains(target) { return this.isConnected && target?.isConnected && target.scope === this; },
    querySelectorAll(selector) { assert.equal(selector, "[data-recycle-restore]"); return [...buttons.values()].filter(button => button.isConnected && button.dataset.recycleRestore); },
  };
  const element = name => ({ name, scope: root, ownerDocument: document, isConnected: true, disabled: false, dataset: {},
    focus(options) { assert.ok(this.isConnected && !this.disabled, `${name} must be available`); document.activeElement = this; calls.push({ name, options }); for (const listener of [...listeners]) listener({ target: this }); },
  });
  const refresh = element("refresh"), previous = element("previous"), next = element("next"), buttons = new Map();
  const disconnect = target => { target.isConnected = false; if (document.activeElement === target) document.activeElement = document.body; };
  const makeLoad = scope => () => { requests.push({ action: "load", scope }); return new Promise((resolve, reject) => reads.push({ scope, resolve, reject })); };
  const makeRestore = scope => (...args) => { requests.push({ action: "restore", scope, args }); return new Promise((resolve, reject) => restores.push({ scope, resolve, reject })); };
  const props = { activeCount, historyCount: 0, countUnavailable, onLoad: makeLoad("one"), onRestore: makeRestore("one") };
  const same = (left, right) => left?.length === right?.length && left.every((value, index) => Object.is(value, right[index]));
  const react = {
    useState(initial) { const index = cursor++; if (!(index in slots)) slots[index] = typeof initial === "function" ? initial() : initial; return [slots[index], value => { if (!mounted) writesAfterUnmount++; const result = typeof value === "function" ? value(slots[index]) : value; if (!Object.is(result, slots[index])) { slots[index] = result; dirty = true; } }]; },
    useRef(initial) { const index = cursor++; slots[index] ??= { current: initial }; return slots[index]; },
    useMemo(create, deps) { const index = cursor++, prior = slots[index]; if (!same(prior?.deps, deps)) slots[index] = { deps, value: create() }; return slots[index].value; },
    useCallback(callback, deps) { return react.useMemo(() => callback, deps); },
    useEffect(create, deps) { const index = cursor++, prior = slots[index]; if (!same(prior?.deps, deps)) { slots[index] = { deps }; effects.push(() => { prior?.cleanup?.(); slots[index].cleanup = create(); }); } },
  };
  const exports = {};
  vm.runInNewContext(code, { exports, Error, require(name) { if (name === "react") return react; assert.equal(name, "react/jsx-runtime"); return { jsx, jsxs: jsx, Fragment: "fragment" }; } });
  function commit() {
    if (tree.props.ref) tree.props.ref.current = root;
    const all = nodes(tree), refreshNode = all.find(node => node.props["aria-label"] === "刷新回收站");
    refresh.disabled = Boolean(refreshNode.props.disabled); refresh.isConnected = root.isConnected;
    if (refreshNode.props.ref) refreshNode.props.ref.current = refresh;
    const seen = new Set();
    for (const node of all.filter(node => node.type === "li" && nodes(node).some(child => child.type === "button" && /恢复/.test(text(child))))) {
      const buttonNode = nodes(node).find(child => child.type === "button");
      const key = node.key; seen.add(key);
      if (!buttons.has(key)) buttons.set(key, element(`restore:${key}`));
      const button = buttons.get(key); button.disabled = Boolean(buttonNode.props.disabled); button.isConnected = root.isConnected; button.dataset.recycleRestore = buttonNode.props["data-recycle-restore"];
      if (buttonNode.props.ref) buttonNode.props.ref.current = button;
    }
    for (const [key, button] of buttons) if (!seen.has(key)) { disconnect(button); buttons.delete(key); }
    for (const [label, target] of [["上一页", previous], ["下一页", next]]) {
      const node = all.find(node => node.props["aria-label"] === label); target.isConnected = root.isConnected && Boolean(node); target.disabled = Boolean(node?.props.disabled);
    }
    for (const target of [refresh, previous, next, ...buttons.values()]) if (document.activeElement === target && (!target.isConnected || target.disabled)) document.activeElement = document.body;
  }
  const f = {
    props, root, document, refresh, previous, next, buttons, calls, listeners, reads, restores, requests,
    render() { let attempts = 0; do { assert.ok(attempts++ < 30); cursor = 0; dirty = false; effects = []; tree = exports.EduPiDeletedEntities(props); commit(); effects.splice(0).forEach(effect => effect()); } while (dirty); },
    find(predicate) { return nodes(tree).find(predicate); },
    text() { return text(tree); },
    click(label, { focus = true, render = true, id = "calendar-one" } = {}) {
      let node, target;
      if (label === "恢复") { const key = `calendar:${id}`; const row = f.find(node => node.type === "li" && node.key === key); assert.ok(row, `row ${key}`); node = nodes(row).find(node => node.type === "button"); target = buttons.get(key); }
      else { node = f.find(node => node.props["aria-label"] === label); target = label === "刷新回收站" ? refresh : label === "上一页" ? previous : next; }
      assert.ok(node, `button ${label}`); assert.ok(!node.props.disabled, `${label} must be enabled`);
      if (focus) target.focus({ preventScroll: false }); calls.length = 0;
      node.props.onClick({ currentTarget: target }); if (render) f.render();
      return target;
    },
    finishLoad(value = initial, { error, index = 0 } = {}) { const pending = reads.splice(index, 1)[0]; assert.ok(pending, "read pending"); if (error) pending.reject(new Error(error)); else pending.resolve(value); },
    finishRestore({ error, index = 0 } = {}) { const pending = restores.splice(index, 1)[0]; assert.ok(pending, "restore pending"); if (error) pending.reject(new Error(error)); else { props.activeCount--; pending.resolve(); } },
    async settle() { for (let i = 0; i < 5; i++) { await tick(); if (dirty && mounted) f.render(); } },
    async ready(value = initial) { f.finishLoad(value); await f.settle(); calls.length = 0; },
    move(target = { name: "other setting", isConnected: true }) { document.activeElement = target; for (const listener of [...listeners]) listener({ target }); return target; },
    changeScope() { props.onLoad = makeLoad("two"); props.onRestore = makeRestore("two"); f.render(); },
    unmount() { mounted = false; root.isConnected = false; for (const slot of slots) slot?.cleanup?.(); },
    get writesAfterUnmount() { return writesAfterUnmount; },
  };
  f.render(); return f;
}

test("refresh waits for the read and enabled DOM before returning focus", async () => {
  const f = mount(); await f.ready(); f.click("刷新回收站");
  assert.equal(f.document.activeElement, f.document.body); assert.deepEqual(f.calls, []);
  f.finishLoad(); await f.settle();
  assert.equal(f.document.activeElement, f.refresh); assert.deepEqual(f.calls.map(call => call.name), ["refresh"]); assert.equal(f.listeners.size, 0);
});

test("successful restore preserves request arguments and waits for its actual follow-up load", async () => {
  const f = mount(); await f.ready(); const trigger = f.click("恢复"); f.finishRestore(); await f.settle();
  assert.deepEqual(f.requests.find(request => request.action === "restore").args, ["calendar", "calendar-one", "restore-calendar-one", "[UI验收 TEST] calendar-one"]);
  assert.equal(f.reads.length, 1); assert.equal(trigger.isConnected, false); assert.deepEqual(f.calls, []);
  f.finishLoad(ledger([])); await f.settle();
  assert.equal(f.document.activeElement, f.refresh); assert.equal(f.refresh.disabled, false); assert.deepEqual(f.calls.map(call => call.name), ["refresh"]); assert.match(f.text(), /0 项可恢复/); assert.equal(f.listeners.size, 0);
});

test("failed restore returns to the same enabled retry without changing its request key", async () => {
  const f = mount(); await f.ready(); const target = f.click("恢复"); f.finishRestore({ error: "合成恢复失败" }); await f.settle();
  assert.equal(f.document.activeElement, target); assert.equal(target.disabled, false); assert.match(f.text(), /合成恢复失败/);
  assert.equal(f.requests.filter(request => request.action === "load").length, 1); assert.deepEqual(f.calls.map(call => call.name), ["restore:calendar:calendar-one"]); assert.equal(f.listeners.size, 0);
});

test("restore followed by an unreadable ledger returns to refresh and retains the read error", async () => {
  const f = mount(); await f.ready(); f.click("恢复"); f.finishRestore(); await f.settle();
  f.finishLoad(null, { error: "合成列表读取失败" }); await f.settle();
  assert.equal(f.buttons.size, 0); assert.equal(f.document.activeElement, f.refresh); assert.match(f.text(), /合成列表读取失败/); assert.equal(f.listeners.size, 0);
});

test("refresh failure returns to retry while an unavailable summary remains unavailable", async () => {
  const f = mount({ countUnavailable: true }); await f.ready(); f.click("刷新回收站"); f.finishLoad(null, { error: "合成离线" }); await f.settle();
  assert.equal(f.document.activeElement, f.refresh); assert.match(f.text(), /数量暂不可用/); assert.match(f.text(), /合成离线/);
  f.click("刷新回收站"); f.finishLoad(ledger([])); await f.settle(); assert.equal(f.document.activeElement, f.refresh); assert.equal(f.listeners.size, 0);
});

test("a fast read and restore still focus only after the final DOM commit", async () => {
  for (const action of ["刷新回收站", "恢复"]) {
    const f = mount(); await f.ready(); f.click(action, { render: false });
    if (action === "恢复") { f.finishRestore(); await tick(); }
    f.finishLoad(action === "恢复" ? ledger([]) : ledger()); await tick(); await tick();
    assert.deepEqual(f.calls, []); f.render();
    assert.equal(f.document.activeElement, f.refresh, action); assert.deepEqual(f.calls.map(call => call.name), ["refresh"], action); assert.equal(f.listeners.size, 0);
  }
});

test("a native restore click from body returns to refresh without assuming click-to-focus", async () => {
  const f = mount(); await f.ready(); f.document.activeElement = f.document.body; f.click("恢复", { focus: false });
  f.finishRestore(); await f.settle(); f.finishLoad(ledger([])); await f.settle();
  assert.equal(f.document.activeElement, f.refresh); assert.deepEqual(f.calls.map(call => call.name), ["refresh"]);
});

test("moving focus during a restore or refresh cancels return even after focus moves back to body", async () => {
  for (const action of ["刷新回收站", "恢复"]) {
    const f = mount(); await f.ready(); f.click(action); f.move(); f.document.activeElement = f.document.body;
    if (action === "恢复") { f.finishRestore(); await f.settle(); }
    f.finishLoad(action === "恢复" ? ledger([]) : ledger()); await f.settle();
    assert.equal(f.document.activeElement, f.document.body, action); assert.deepEqual(f.calls, [], action); assert.equal(f.listeners.size, 0);
  }
});

test("moving focus during the post-restore load is also preserved", async () => {
  const f = mount(); await f.ready(); f.click("恢复"); f.finishRestore(); await f.settle(); const target = f.move();
  f.finishLoad(ledger([])); await f.settle(); assert.equal(f.document.activeElement, target); assert.deepEqual(f.calls, []); assert.equal(f.listeners.size, 0);
});

test("manual paging during refresh does not pull focus back into the old action", async () => {
  const values = Array.from({ length: 10 }, (_, index) => deletion(`calendar-${index}`));
  const f = mount({ initial: ledger(values) }); await f.ready(); f.click("刷新回收站"); f.click("下一页", { focus: false });
  f.finishLoad(ledger(values)); await f.settle(); assert.deepEqual(f.calls, []); assert.notEqual(f.document.activeElement, f.refresh); assert.match(f.text(), /2 \/ 2/);
});

test("restoring the final row on the last page clamps the page and focuses the connected refresh", async () => {
  const values = Array.from({ length: 9 }, (_, index) => deletion(`calendar-${index}`));
  const f = mount({ initial: ledger(values) }); await f.ready(); f.click("下一页"); f.click("恢复", { id: "calendar-8" }); f.finishRestore(); await f.settle();
  f.finishLoad(ledger(values.slice(0, 8))); await f.settle(); assert.equal(f.document.activeElement, f.refresh); assert.equal(f.next.isConnected, false); assert.equal(f.buttons.size, 8); assert.equal(f.listeners.size, 0);
});

test("an old scope read cannot overwrite a newer directory ledger or clear its loading", async () => {
  const f = mount(); f.changeScope(); assert.equal(f.reads.length, 2);
  f.finishLoad(ledger([deletion("old-directory")])); await f.settle(); assert.equal(f.refresh.disabled, true); assert.doesNotMatch(f.text(), /old-directory/);
  f.finishLoad(ledger([deletion("new-directory")])); await f.settle(); assert.match(f.text(), /new-directory/); assert.doesNotMatch(f.text(), /old-directory/); assert.equal(f.refresh.disabled, false);
});

test("an old restore completion cannot start a read or release a newer directory restore", async () => {
  const f = mount(); await f.ready(); f.click("恢复"); f.changeScope(); f.finishLoad(ledger([deletion("second-directory")])); await f.settle();
  f.click("恢复", { id: "second-directory" }); f.finishRestore({ index: 0 }); await f.settle();
  assert.equal(f.reads.length, 0); assert.equal(f.buttons.get("calendar:second-directory").disabled, true); assert.deepEqual(f.calls, []);
  f.finishRestore(); await f.settle(); f.finishLoad(ledger([])); await f.settle(); assert.equal(f.document.activeElement, f.refresh); assert.equal(f.listeners.size, 0);
});

test("unmount or a disconnected panel prevents old requests from focusing controls", async () => {
  for (const kind of ["unmount", "disconnect"]) {
    const f = mount(); await f.ready(); f.click("刷新回收站");
    if (kind === "unmount") f.unmount(); else f.root.isConnected = false;
    f.finishLoad(ledger([])); await f.settle(); assert.deepEqual(f.calls, [], kind); assert.equal(f.listeners.size, 0, kind);
    if (kind === "unmount") assert.equal(f.writesAfterUnmount, 0);
  }
});

test("an unmounted restore cannot start its follow-up read or update the removed panel", async () => {
  const f = mount(); await f.ready(); f.click("恢复"); f.unmount(); f.finishRestore(); await f.settle();
  assert.equal(f.reads.length, 0); assert.equal(f.writesAfterUnmount, 0); assert.deepEqual(f.calls, []); assert.equal(f.listeners.size, 0);
});

test("a duplicate stale restore handler cannot invoke the owner twice", async () => {
  const f = mount(); await f.ready(); const row = f.find(node => node.type === "li" && node.key === "calendar:calendar-one"); const node = nodes(row).find(node => node.type === "button");
  const target = f.buttons.get("calendar:calendar-one"); target.focus({ preventScroll: false }); f.calls.length = 0;
  node.props.onClick({ currentTarget: target }); node.props.onClick({ currentTarget: target }); f.render();
  assert.equal(f.restores.length, 1); f.finishRestore(); await f.settle(); f.finishLoad(ledger([])); await f.settle(); assert.equal(f.document.activeElement, f.refresh);
});
