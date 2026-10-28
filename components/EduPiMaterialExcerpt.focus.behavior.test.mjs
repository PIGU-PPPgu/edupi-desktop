import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import vm from "node:vm";
import ts from "typescript";

const code = ts.transpileModule(readFileSync(new URL("./EduPiMaterialExcerpt.tsx", import.meta.url), "utf8"), {
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.ReactJSX },
}).outputText;
const jsx = (type, props, key) => ({ type, props: props || {}, key });
const nodes = node => Array.isArray(node) ? node.flatMap(nodes) : node?.props ? [node, ...nodes(node.props.children)] : [];
const text = node => typeof node === "string" || typeof node === "number" ? String(node) : Array.isArray(node) ? node.map(text).join("") : node?.props ? text(node.props.children) : "";
const original = { revision: 3, status: "confirmed", content: "[UI验收 TEST] 合成备课正文" };
const tick = () => new Promise(resolve => setImmediate(resolve));

function mount() {
  const slots = [], listeners = new Set(), requests = [], pending = [], calls = [], notifications = [];
  let cursor = 0, dirty = false, effects = [], tree;
  const document = {
    body: { name: "body" }, documentElement: { name: "html" }, activeElement: null,
    addEventListener(name, callback) { assert.equal(name, "focusin"); listeners.add(callback); },
    removeEventListener(name, callback) { assert.equal(name, "focusin"); listeners.delete(callback); },
  };
  document.activeElement = document.body;
  const root = { name: "details", open: false, isConnected: true, ownerDocument: document, contains: element => Boolean(element?.isConnected && element.scope === root) };
  const element = name => ({ name, ownerDocument: document, scope: root, isConnected: true, disabled: false,
    focus(options) { assert.ok(this.isConnected && !this.disabled, `${name} must be actionable`); document.activeElement = this; calls.push({ name, options }); for (const listener of listeners) listener({ target: this }); },
  });
  const summary = element("summary"), refresh = element("refresh"), confirm = element("confirm"), withdraw = element("withdraw"), textarea = element("textarea");
  const control = node => node.type === "summary" ? summary : node.type === "textarea" ? textarea : text(node) === "刷新版本" ? refresh : text(node) === "撤回确认" ? withdraw : confirm;
  const props = { materialId: "synthetic-material", onPreview() {}, available: true, metadataRevision: 0 };
  const same = (a, b) => a?.length === b?.length && a.every((value, index) => Object.is(value, b[index]));
  const react = {
    useState(initial) { const index = cursor++; if (!(index in slots)) slots[index] = typeof initial === "function" ? initial() : initial; return [slots[index], value => { const next = typeof value === "function" ? value(slots[index]) : value; if (!Object.is(next, slots[index])) { slots[index] = next; dirty = true; } }]; },
    useRef(initial) { const index = cursor++; slots[index] ??= { current: initial }; return slots[index]; },
    useEffect(create, deps) { const index = cursor++, prior = slots[index]; if (!same(prior?.deps, deps)) { slots[index] = { deps }; effects.push(() => { prior?.cleanup?.(); slots[index].cleanup = create(); }); } },
  };
  const exports = {};
  vm.runInNewContext(code, { exports, AbortController, TextEncoder, Event, window: { dispatchEvent(event) { notifications.push(event.type); } },
    fetch(url, options = {}) { requests.push({ url, ...options }); return new Promise(resolve => pending.push({ url, options, resolve })); },
    require(module) {
      if (module === "react") return react;
      if (module === "react/jsx-runtime") return { jsx, jsxs: jsx, Fragment: "fragment" };
      assert.equal(module, "./EduPiDocxSourceSelection"); return { EduPiDocxSourceSelection() {} };
    },
  });
  const f = {
    props, document, root, summary, refresh, confirm, withdraw, textarea, requests, pending, calls, listeners, notifications,
    find(predicate) { return nodes(tree).find(predicate); },
    render() {
      let attempts = 0;
      do {
        assert.ok(attempts++ < 20); cursor = 0; dirty = false; effects = []; tree = exports.EduPiMaterialExcerpt(props);
        if (tree.props.ref) tree.props.ref.current = root;
        const present = new Set();
        for (const node of nodes(tree).filter(node => ["summary", "textarea", "button"].includes(node.type))) {
          if (node.type === "button" && text(node) === "预览原材料") continue;
          const target = control(node); present.add(target); target.isConnected = root.isConnected; target.disabled = Boolean(node.props.disabled);
          if (node.props.ref) node.props.ref.current = target;
        }
        for (const target of [summary, textarea, refresh, confirm, withdraw]) {
          if (!present.has(target)) target.isConnected = false;
          if (document.activeElement === target && (!target.isConnected || target.disabled)) document.activeElement = document.body;
        }
        effects.splice(0).forEach(effect => effect());
      } while (dirty);
    },
    toggle(open) { root.open = open; tree.props.onToggle({ currentTarget: root }); f.render(); },
    draft(value) { f.find(node => node.type === "textarea").props.onChange({ target: { value } }); f.render(); },
    click(label, focus = true) {
      const node = f.find(node => node.type === "button" && text(node) === label); assert.ok(node, `button ${label}`); assert.ok(!node.props.disabled, `enabled ${label}`);
      const target = control(node); if (focus) target.focus({ preventScroll: false }); calls.length = 0;
      node.props.onClick({ currentTarget: target }); f.render();
    },
    finish(payload, ok = true) { assert.ok(pending.length); pending.shift().resolve({ ok, async json() { return payload; } }); },
    async settle() { for (let i = 0; i < 5; i++) { await tick(); if (dirty) f.render(); } },
    async ready(excerpt = original) { f.toggle(true); f.finish({ excerpt }); await f.settle(); calls.length = 0; },
    moveFocus(target = { name: "other control", isConnected: true }) { document.activeElement = target; for (const listener of listeners) listener({ target }); return target; },
    unmount() { root.isConnected = false; for (const slot of slots) slot?.cleanup?.(); },
  };
  f.render(); return f;
}

test("excerpt confirmation preserves its revision request and restores its enabled action after commit", async () => {
  const f = mount(); await f.ready(); f.draft("[UI验收 TEST] 合成修订正文"); f.click("确认正文");
  assert.equal(f.document.activeElement, f.document.body);
  assert.deepEqual(JSON.parse(f.requests[1].body), { materialId: "synthetic-material", expectedRevision: 3, content: "[UI验收 TEST] 合成修订正文", decision: "confirm" });
  f.finish({ excerpt: { ...original, revision: 4, content: "[UI验收 TEST] 合成修订正文" } }); await f.settle();
  assert.equal(f.document.activeElement, f.confirm); assert.deepEqual(f.calls.map(call => call.name), ["confirm"]);
  assert.deepEqual(f.notifications, ["edupi-preparation-updated"]); assert.equal(f.listeners.size, 0);
});

test("excerpt refresh retains the unsaved draft and returns to refresh", async () => {
  const f = mount(); await f.ready(); f.draft("[UI验收 TEST] 未保存草稿"); f.click("刷新版本");
  f.finish({ excerpt: { ...original, revision: 4 } }); await f.settle();
  assert.equal(f.find(node => node.type === "textarea").props.value, "[UI验收 TEST] 未保存草稿");
  assert.equal(f.document.activeElement, f.refresh); assert.deepEqual(f.calls.map(call => call.name), ["refresh"]);
  assert.equal(f.requests.filter(request => request.method === "POST").length, 0); assert.equal(f.listeners.size, 0);
});

test("withdrawal falls back to confirm when the withdrawn action disappears", async () => {
  const f = mount(); await f.ready(); f.click("撤回确认");
  f.finish({ excerpt: { ...original, revision: 4, status: "withdrawn" } }); await f.settle();
  assert.equal(f.withdraw.isConnected, false); assert.equal(f.document.activeElement, f.confirm);
  assert.deepEqual(f.calls.map(call => call.name), ["confirm"]);
});

test("a refresh failure returns to retry without losing a draft", async () => {
  const f = mount(); await f.ready(); f.draft("[UI验收 TEST] 失败后草稿"); f.click("刷新版本");
  f.finish({ error: "合成读取失败" }, false); await f.settle();
  assert.equal(f.document.activeElement, f.refresh); assert.equal(f.confirm.disabled, true);
  assert.equal(f.find(node => node.type === "textarea").props.value, "[UI验收 TEST] 失败后草稿");
  assert.equal(text(f.find(node => node.props.role === "alert")), "合成读取失败");
  f.click("刷新版本"); f.finish({ excerpt: original }); await f.settle();
  assert.equal(f.document.activeElement, f.refresh); assert.equal(f.listeners.size, 0);
});

test("a conflicting confirmation keeps the draft and focuses the version refresh action", async () => {
  const f = mount(); await f.ready(); f.draft("[UI验收 TEST] 合成冲突草稿"); f.click("确认正文");
  f.finish({ error: "合成版本冲突", conflict: true }, false); await f.settle();
  assert.equal(f.confirm.disabled, true); assert.equal(f.document.activeElement, f.refresh);
  assert.equal(f.find(node => node.type === "textarea").props.value, "[UI验收 TEST] 合成冲突草稿");
});

test("a failed withdrawal returns to the same available action", async () => {
  const f = mount(); await f.ready(); f.click("撤回确认");
  f.finish({ error: "合成保存失败" }, false); await f.settle();
  assert.equal(f.withdraw.isConnected, true); assert.equal(f.document.activeElement, f.withdraw);
});

test("completion does not steal focus moved during refresh, confirm or withdrawal", async () => {
  for (const label of ["刷新版本", "确认正文", "撤回确认"]) {
    const f = mount(); await f.ready(); f.click(label); f.moveFocus(); f.document.activeElement = f.document.body;
    f.finish({ excerpt: { ...original, revision: 4, status: label === "撤回确认" ? "withdrawn" : "confirmed" } }); await f.settle();
    assert.equal(f.document.activeElement, f.document.body, label); assert.deepEqual(f.calls, [], label); assert.equal(f.listeners.size, 0);
  }
});

test("a collapsed excerpt returns to its summary after saving without focusing hidden controls", async () => {
  const f = mount(); await f.ready(); f.click("确认正文"); f.toggle(false);
  f.finish({ excerpt: { ...original, revision: 4 } }); await f.settle();
  assert.equal(f.document.activeElement, f.summary); assert.deepEqual(f.calls.map(call => call.name), ["summary"]);
});

test("material changes and disconnected details cancel the old focus request", async () => {
  for (const mode of ["material", "disconnect"]) {
    const f = mount(); await f.ready(); f.click("确认正文");
    if (mode === "material") { f.props.materialId = "synthetic-material-other"; f.render(); }
    else f.root.isConnected = false;
    f.finish({ excerpt: { ...original, revision: 4 } }); await f.settle();
    assert.deepEqual(f.calls, [], mode); assert.equal(f.listeners.size, 0);
  }
});

test("unmount removes a pending action's focus listener", async () => {
  const f = mount(); await f.ready(); f.click("确认正文");
  assert.equal(f.listeners.size, 1); f.unmount(); assert.equal(f.listeners.size, 0);
  f.finish({ excerpt: { ...original, revision: 4 } }); await f.settle(); assert.deepEqual(f.calls, []);
});

test("programmatic completion does not take focus from a control outside the excerpt", async () => {
  const f = mount(); await f.ready(); const target = f.moveFocus(); f.click("确认正文", false);
  f.finish({ excerpt: { ...original, revision: 4 } }); await f.settle();
  assert.equal(f.document.activeElement, target); assert.deepEqual(f.calls, []);
});

test("background metadata refresh keeps focus and the UTF8 size guard remains unchanged", async () => {
  const f = mount(); await f.ready(); const target = f.moveFocus(); f.props.metadataRevision++; f.render();
  f.finish({ excerpt: original }); await f.settle(); assert.equal(f.document.activeElement, target); assert.deepEqual(f.calls, []);
  f.draft("验".repeat(5462)); assert.equal(f.confirm.disabled, true);
  assert.equal(text(f.find(node => node.props.role === "alert")), "正文不能超过16 KB");
  assert.equal(f.requests.filter(request => request.method === "POST").length, 0);
});
