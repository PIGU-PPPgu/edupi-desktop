import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import vm from "node:vm";
import ts from "typescript";

const compile = source => ts.transpileModule(source, {
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.ReactJSX },
}).outputText;
const code = compile(readFileSync(new URL("./AppSettings.tsx", import.meta.url), "utf8"));
const permissions = {};
vm.runInNewContext(compile(readFileSync(new URL("../lib/computer-use-permissions.ts", import.meta.url), "utf8")), { exports: permissions });
const jsx = (type, props) => ({ type, props: props || {} });
const nodes = value => Array.isArray(value) ? value.flatMap(nodes) : value?.props ? [value, ...nodes(value.props.children)] : [];
const text = value => typeof value === "string" || typeof value === "number" ? String(value) : Array.isArray(value) ? value.map(text).join("") : value?.props ? text(value.props.children) : "";
const tick = () => new Promise(resolve => setImmediate(resolve));
const status = (enabled = true) => ({ enabled, accessibility: true, screenRecording: true });
const changedEvent = "edupi-computer-use-changed";

function mount() {
  const slots = [], effects = new Map(), events = new Map(), focusListeners = new Set();
  const reads = [], changes = [], nativeCalls = [], prefs = [], announcements = [], focused = [], elements = new Map(), timers = new Map();
  let cursor = 0, dirty = false, tree, mounted = true, writesAfterUnmount = 0;
  const document = {
    body: { key: "body" }, documentElement: { key: "html" }, activeElement: null, visibilityState: "visible",
    addEventListener(name, callback) { assert.equal(name, "focusin"); focusListeners.add(callback); },
    removeEventListener(name, callback) { assert.equal(name, "focusin"); focusListeners.delete(callback); },
    hasFocus() { return true; },
  };
  document.activeElement = document.body;
  const move = target => { document.activeElement = target; for (const callback of [...focusListeners]) callback({ target }); return target; };
  const root = { ownerDocument: document, isConnected: true, hidden: false,
    contains(target) { return this.isConnected && target?.isConnected && target.scope === this; },
    closest(selector) { assert.equal(selector, "[hidden]"); return this.hidden ? this : null; },
  };
  const element = key => ({ key, ownerDocument: document, scope: root, isConnected: true, disabled: false,
    focus(options) { assert.ok(this.isConnected && !this.disabled, `${key} must be available`); focused.push({ key, options }); move(this); },
    closest(selector) { return root.closest(selector); },
    getClientRects() { return root.hidden ? [] : [{}]; },
  });
  const window = {
    addEventListener(name, callback) { if (!events.has(name)) events.set(name, new Set()); events.get(name).add(callback); },
    removeEventListener(name, callback) { events.get(name)?.delete(callback); },
    dispatchEvent(event) { for (const callback of [...(events.get(event.type) || [])]) callback(event); return true; },
    setInterval(callback) { const id = timers.size + 1; timers.set(id, callback); return id; },
    clearInterval(id) { timers.delete(id); },
  };
  const same = (left, right) => left?.length === right?.length && left.every((value, index) => Object.is(value, right[index]));
  const react = {
    useState(initial) { const index = cursor++; if (!(index in slots)) slots[index] = typeof initial === "function" ? initial() : initial; return [slots[index], value => { if (!mounted) writesAfterUnmount++; const next = typeof value === "function" ? value(slots[index]) : value; if (!Object.is(next, slots[index])) { slots[index] = next; dirty = true; } }]; },
    useRef(initial) { const index = cursor++; slots[index] ??= { current: initial }; return slots[index]; },
    useMemo(create, deps) { const index = cursor++; if (!same(slots[index]?.deps, deps)) slots[index] = { deps, value: create() }; return slots[index].value; },
    useEffect(create, deps) { const index = cursor++; if (!same(slots[index]?.deps, deps)) effects.set(index, { create, deps }); },
  };
  react.useCallback = (callback, deps) => react.useMemo(() => callback, deps);
  const defer = (kind, args = []) => { nativeCalls.push({ kind, args }); return new Promise((resolve, reject) => (kind === "read" ? reads : changes).push({ kind, args, resolve, reject })); };
  const modules = {
    react, "react/jsx-runtime": { jsx, jsxs: jsx },
    "@/lib/branding": {}, "@/lib/app-updates": {},
    "@/lib/app-prefs": { APP_PREF_KEYS: { computerUseEnabled: "computerUseEnabled" }, setPrefBool: (key, value) => prefs.push({ key, value }) },
    "@/lib/desktop-computer-use": {
      getComputerUseStatusNative: () => defer("read"),
      setComputerUseEnabledNative: enabled => defer("enable", [enabled]),
      emergencyStopComputerUseNative: () => defer("stop"),
      requestComputerUsePermissionNative: () => { throw new Error("No OS permission requests allowed in this test"); },
    },
    "@/lib/desktop-updater": {}, "@/lib/desktop-native": {}, "@/hooks/useI18n": {}, "@/hooks/useTheme": {}, "@/lib/desktop-notify": {},
    "@/lib/computer-use-permissions": permissions, "./UpdateProxySettingsCard": {},
    "./EduPiComputerUseStop": { COMPUTER_USE_CHANGED_EVENT: changedEvent, announceComputerUseChanged(enabled) { announcements.push(enabled); window.dispatchEvent({ type: changedEvent, detail: enabled }); } },
    "./MobileBridgeSettingsCard": {}, "./EduPiUsageSettingsCard": {}, "@/lib/edupi-foreground-settings": {},
  };
  const exports = {};
  vm.runInNewContext(code + "\nexports.ComputerUseSettingsCard = ComputerUseSettingsCard;", {
    exports, window, document, Error, require(name) { assert.ok(modules[name], name); return modules[name]; },
    fetch() { throw new Error("No live API calls allowed in this test"); },
  });
  const bind = (ref, target) => { if (typeof ref === "function") ref(target); else if (ref) ref.current = target; };
  const buttonKey = node => node.props.className?.includes("computer-use-primary-action") ? "primary" : node.props["aria-label"] === "重新检测权限" ? "refresh" : node.props["aria-label"] === "停止控制" ? "stop" : "restart";
  const commit = () => {
    bind(tree.props.ref, root);
    const connected = new Set();
    for (const node of nodes(tree).filter(node => node.type === "button")) {
      const key = buttonKey(node); connected.add(key);
      if (!elements.has(key)) elements.set(key, element(key));
      const target = elements.get(key); target.disabled = Boolean(node.props.disabled); target.isConnected = root.isConnected;
      bind(node.props.ref, target);
    }
    for (const [key, target] of elements) {
      target.isConnected = root.isConnected && connected.has(key);
      if (document.activeElement === target && (!target.isConnected || target.disabled)) move(document.documentElement);
    }
  };
  const f = {
    reads, changes, nativeCalls, prefs, announcements, focused, elements, document, root, focusListeners,
    render() { let attempts = 0; do { assert.ok(attempts++ < 30); cursor = 0; dirty = false; tree = exports.ComputerUseSettingsCard(); commit(); const pending = [...effects]; effects.clear(); for (const [index, effect] of pending) { slots[index]?.cleanup?.(); slots[index] = { deps: effect.deps, cleanup: effect.create() }; } } while (dirty); return tree; },
    button(key) { const node = nodes(tree).find(node => node.type === "button" && buttonKey(node) === key); assert.ok(node, `button ${key}`); return node; },
    click(key, { focus = true, render = true } = {}) { const node = f.button(key), target = elements.get(key); assert.ok(!node.props.disabled, `${key} must be enabled`); if (focus) target.focus({ preventScroll: false }); focused.length = 0; node.props.onClick({ currentTarget: target }); if (render) f.render(); return node.props.onClick; },
    finishRead(value = status(), { error, index = 0 } = {}) { const pending = reads.splice(index, 1)[0]; assert.ok(pending, "read pending"); if (error) pending.reject(new Error(error)); else pending.resolve(value); },
    finishChange(value = status(false), { error, index = 0 } = {}) { const pending = changes.splice(index, 1)[0]; assert.ok(pending, "change pending"); if (error) pending.reject(new Error(error)); else pending.resolve(value); },
    async flush() { for (let i = 0; i < 6; i++) { await tick(); if (dirty && mounted) f.render(); } },
    async ready(value = status()) { f.finishRead(value); await f.flush(); focused.length = 0; },
    text() { return text(tree); },
    move(target = { key: "another setting", isConnected: true }) { return move(target); },
    windowFocus() { window.dispatchEvent({ type: "focus" }); f.render(); },
    announce(enabled) { window.dispatchEvent({ type: changedEvent, detail: enabled }); f.render(); },
    unmount() { mounted = false; root.isConnected = false; for (const target of elements.values()) target.isConnected = false; for (const slot of slots) slot?.cleanup?.(); },
    get writesAfterUnmount() { return writesAfterUnmount; },
  };
  f.render(); return f;
}

test("manual permission rechecks return to the enabled trigger on success and failure", async () => {
  for (const error of [undefined, "合成检测失败"]) {
    const f = mount(); await f.ready(); f.click("refresh");
    assert.equal(f.document.activeElement, f.document.documentElement);
    f.finishRead(status(), { error }); await f.flush();
    assert.equal(f.document.activeElement, f.elements.get("refresh")); assert.equal(f.elements.get("refresh").disabled, false);
    assert.deepEqual(f.focused.map(call => call.key), ["refresh"]); assert.equal(f.focusListeners.size, 0);
    if (error) assert.match(f.text(), /合成检测失败/);
  }
});

test("stop and enable preserve the primary button focus and persist only acknowledged state", async () => {
  const f = mount(); await f.ready();
  for (const enabled of [false, true]) {
    assert.equal(text(f.button("primary")), enabled ? "开启控制" : "停止控制");
    f.click("primary"); f.finishChange(status(enabled)); await f.flush();
    assert.equal(f.document.activeElement, f.elements.get("primary")); assert.equal(f.elements.get("primary").disabled, false);
    assert.equal(f.prefs.at(-1).value, enabled); assert.equal(f.announcements.at(-1), enabled);
    assert.deepEqual(f.focused.map(call => call.key), ["primary"]);
  }
});

test("failed enable and stop actions restore focus and release the gate for a real retry", async () => {
  for (const enabled of [true, false]) {
    const f = mount(); await f.ready(status(enabled)); f.click("primary"); f.finishChange(null, { error: "合成设置失败" }); await f.flush();
    assert.equal(f.document.activeElement, f.elements.get("primary")); assert.match(f.text(), /合成设置失败/);
    assert.equal(f.prefs.length, 0); assert.equal(f.announcements.length, 0);
    f.click("primary"); assert.equal(f.changes.length, 1); f.finishChange(status(!enabled)); await f.flush();
    assert.equal(f.prefs.at(-1).value, !enabled); assert.equal(f.document.activeElement, f.elements.get("primary"));
  }
});

test("same-tick repeated recheck and primary activations send one operation before rerender", async () => {
  for (const [key, enabled] of [["refresh", true], ["primary", true], ["primary", false]]) {
    const f = mount(); await f.ready(status(enabled));
    const repeated = f.click(key, { render: false }); repeated({ currentTarget: f.elements.get(key) });
    f.button(key === "refresh" ? "primary" : "refresh").props.onClick({ currentTarget: f.elements.get(key === "refresh" ? "primary" : "refresh") });
    assert.equal(f.reads.length + f.changes.length, 1, key); f.render();
    if (key === "refresh") f.finishRead(); else f.finishChange(status(!enabled)); await f.flush();
    assert.equal(f.document.activeElement, f.elements.get(key));
  }
});

test("window focus during an explicit action cannot duplicate or supersede that action", async () => {
  for (const key of ["refresh", "primary"]) {
    const f = mount(); await f.ready(); f.click(key, { render: false }); f.windowFocus();
    assert.equal(f.reads.length + f.changes.length, 1, key);
    if (key === "refresh") f.finishRead(); else f.finishChange(); await f.flush();
    assert.equal(f.document.activeElement, f.elements.get(key)); assert.equal(f.focusListeners.size, 0);
  }
});

test("a disappearing secondary stop trigger returns to the remaining primary action", async () => {
  const f = mount(); await f.ready({ ...status(), accessibility: false }); f.click("stop");
  f.finishChange({ ...status(false), accessibility: false }); await f.flush();
  assert.equal(f.elements.get("stop").isConnected, false); assert.equal(f.document.activeElement, f.elements.get("primary"));
  assert.equal(text(f.button("primary")), "申请权限"); assert.deepEqual(f.focused.map(call => call.key), ["primary"]);
});

test("fast native-style clicks from the page restore focus only after a DOM commit", async () => {
  for (const key of ["refresh", "primary"]) {
    const f = mount(); await f.ready(); f.click(key, { focus: false, render: false });
    if (key === "refresh") f.finishRead(); else f.finishChange(); await tick(); await tick();
    assert.deepEqual(f.focused, []); f.render();
    assert.equal(f.document.activeElement, f.elements.get(key)); assert.deepEqual(f.focused.map(call => call.key), [key]);
  }
});

test("the initial read cannot overwrite a newer explicit permission recheck", async () => {
  const f = mount(); f.click("refresh"); assert.equal(f.reads.length, 2);
  f.finishRead(status(false), { index: 1 }); await f.flush(); assert.equal(text(f.button("primary")), "开启控制");
  f.finishRead(status(true)); await f.flush(); assert.equal(text(f.button("primary")), "开启控制");
  assert.equal(f.document.activeElement, f.elements.get("refresh"));
});

test("window focus reads do not disable controls or move the user's focus", async () => {
  const f = mount(); await f.ready(); const target = f.move(); f.windowFocus();
  assert.equal(f.elements.get("primary").disabled, false); assert.equal(f.elements.get("refresh").disabled, false);
  f.finishRead(status(false)); await f.flush(); assert.equal(text(f.button("primary")), "开启控制");
  assert.equal(f.document.activeElement, target); assert.deepEqual(f.focused, []);
});

test("automatic old reads and errors cannot overwrite a newer stop action", async () => {
  for (const error of [undefined, "合成旧读取失败"]) {
    const f = mount(); await f.ready(); f.windowFocus();
    f.click("primary"); f.finishChange(status(false)); await f.flush();
    f.finishRead(status(true), { error }); await f.flush();
    assert.equal(text(f.button("primary")), "开启控制"); assert.doesNotMatch(f.text(), /合成旧读取失败/);
    assert.equal(f.prefs.at(-1).value, false); assert.equal(f.document.activeElement, f.elements.get("primary"));
  }
});

test("a newer external enabled event invalidates pending status reads", async () => {
  const f = mount(); await f.ready(); f.windowFocus(); f.announce(false);
  f.finishRead(status(true)); await f.flush(); assert.equal(text(f.button("primary")), "开启控制");
  assert.deepEqual(f.focused, []); assert.equal(f.prefs.length, 0);
});

test("initial broadcast rechecks complete permissions and preserves its newer enabled value", async () => {
  for (const enabled of [false, true]) {
    const f = mount(), target = f.move(); f.announce(enabled);
    assert.equal(f.reads.length, 2);
    assert.equal(f.elements.get("primary").disabled, false); assert.equal(f.elements.get("refresh").disabled, false);
    f.finishRead(status(!enabled)); await f.flush(); assert.equal(text(f.button("primary")), "检测权限");
    f.finishRead(status(!enabled)); await f.flush();
    assert.equal(text(f.button("primary")), enabled ? "停止控制" : "开启控制"); assert.match(f.text(), /已授权/);
    assert.equal(f.document.activeElement, target); assert.deepEqual(f.focused, []);
    assert.equal(f.prefs.length, 0); assert.deepEqual(f.announcements, []); assert.equal(f.reads.length, 0);
  }
});

test("initial broadcast sequences keep the newest event when full reads return out of order", async () => {
  const f = mount(); f.announce(true); f.announce(false); assert.equal(f.reads.length, 3);
  f.finishRead(status(true), { index: 2 }); await f.flush(); assert.equal(text(f.button("primary")), "开启控制");
  f.finishRead(status(true)); f.finishRead(status(true)); await f.flush();
  assert.equal(text(f.button("primary")), "开启控制"); assert.equal(f.reads.length, 0); assert.deepEqual(f.focused, []);
});

test("initial broadcast read failures expose retry without losing the user's focus", async () => {
  const f = mount(), target = f.move(); f.announce(false); assert.equal(f.reads.length, 2);
  f.finishRead(status(true)); f.finishRead(null, { error: "合成初始化读取失败" }); await f.flush();
  assert.equal(text(f.button("primary")), "检测权限"); assert.match(f.text(), /合成初始化读取失败/);
  assert.equal(f.document.activeElement, target); assert.deepEqual(f.focused, []);
  f.click("refresh"); f.finishRead(status(false)); await f.flush();
  assert.equal(text(f.button("primary")), "开启控制"); assert.doesNotMatch(f.text(), /合成初始化读取失败/);
  assert.equal(f.document.activeElement, f.elements.get("refresh"));
});

test("initial broadcast supplemental reads cannot write after the card unmounts", async () => {
  const f = mount(); f.announce(false); assert.equal(f.reads.length, 2); f.unmount();
  f.finishRead(status(true)); f.finishRead(status(true)); await f.flush();
  assert.equal(f.writesAfterUnmount, 0); assert.deepEqual(f.focused, []); assert.equal(f.prefs.length, 0);
});

test("moving focus during an explicit operation cancels return even after focus moves to the page", async () => {
  for (const key of ["refresh", "primary"]) {
    const f = mount(); await f.ready(); f.click(key); f.move(); f.move(f.document.body);
    if (key === "refresh") f.finishRead(); else f.finishChange(); await f.flush();
    assert.equal(f.document.activeElement, f.document.body); assert.deepEqual(f.focused, []); assert.equal(f.focusListeners.size, 0);
  }
});

test("a hidden settings page never receives the delayed focus return", async () => {
  const f = mount(); await f.ready(); f.click("refresh"); f.root.hidden = true;
  f.finishRead(); await f.flush(); assert.deepEqual(f.focused, []); assert.equal(f.focusListeners.size, 0);
});

test("unmount cancels late view writes and focus while an acknowledged toggle still persists", async () => {
  for (const key of ["initial", "refresh", "primary"]) {
    const f = mount(); if (key !== "initial") { await f.ready(); f.click(key); }
    f.unmount();
    if (key === "primary") f.finishChange(); else f.finishRead(); await f.flush();
    assert.equal(f.writesAfterUnmount, 0, key); assert.equal(f.focusListeners.size, 0, key); assert.deepEqual(f.focused, [], key);
    assert.deepEqual(f.announcements, key === "primary" ? [false] : [], key);
    assert.equal(f.prefs.length, key === "primary" ? 1 : 0, key);
  }
});
