import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import vm from "node:vm";
import ts from "typescript";

async function compile(path) {
  const source = await readFile(new URL(path, import.meta.url), "utf8");
  return ts.transpileModule(source, { compilerOptions: {
    module: ts.ModuleKind.CommonJS, jsx: ts.JsxEmit.ReactJSX, target: ts.ScriptTarget.ES2022,
  } }).outputText;
}
const compiled = await compile("./EduPiAdminPanel.tsx");
const navigation = {};
vm.runInNewContext(await compile("../lib/edupi-settings-navigation.ts"), { exports: navigation });
const nodes = (node) => Array.isArray(node) ? node.flatMap(nodes)
  : !node || typeof node !== "object" || !node.props ? [] : [node, ...nodes(node.props.children)];
const textOf = (node) => node == null || typeof node === "boolean" ? ""
  : Array.isArray(node) ? node.map(textOf).join("") : typeof node === "object" ? textOf(node.props?.children) : String(node);

// Run the real component handlers/effects with isolated host scheduling. Chunk
// arrival is a DOM mutation; no native API, network, or teacher data is used.
function mountAdmin(initialSection = "connections") {
  const slots = [], effects = new Map(), frames = new Map(), timers = new Map(), observers = [];
  const focus = [], scroll = [], elements = new Map(), targets = new Map();
  let cursor = 0, dirty = false, unmounted = false, tree, nextId = 0, now = 0;
  const document = { activeElement: null, contains: (element) => element.isConnected };
  class Element {
    constructor(id) {
      this.id = id;
      this.isConnected = true;
      this.parentElement = null;
      this.attributes = new Map();
      const classes = new Set();
      this.classList = { add: (name) => classes.add(name), remove: (name) => classes.delete(name), contains: (name) => classes.has(name) };
    }
    getAttribute(name) { return this.attributes.get(name) ?? null; }
    setAttribute(name, value) { this.attributes.set(name, String(value)); }
    removeAttribute(name) { this.attributes.delete(name); }
    closest(selector) {
      if (selector === "[hidden]" && this.attributes.has("hidden")) return this;
      if (selector === "details" && this.id === "proxy-details") return this;
      return this.parentElement?.closest(selector) ?? null;
    }
    querySelector(selector) { return selector === "details" ? this.details ?? null : null; }
    focus(options) { document.activeElement = this; focus.push({ element: this, options }); }
    scrollIntoView(options) { scroll.push({ element: this, options }); }
  }
  const opener = new Element("opener");
  document.activeElement = opener;
  const workspace = new Element("workspace");
  workspace.scrollTo = () => {};
  workspace.querySelector = (selector) => targets.get(selector.match(/data-setting-id="([^"]+)"/)?.[1]) ?? null;
  class MutationObserver {
    constructor(callback) { this.callback = callback; this.connected = false; observers.push(this); }
    observe(element, options) { this.element = element; this.options = options; this.connected = true; }
    disconnect() { this.connected = false; }
  }
  const sameDeps = (a, b) => a && b && a.length === b.length && a.every((value, index) => Object.is(value, b[index]));
  const hooks = {
    useState(initial) {
      const index = cursor++;
      if (!slots[index]) {
        const slot = { value: typeof initial === "function" ? initial() : initial };
        slot.set = (next) => {
          if (unmounted) return;
          const value = typeof next === "function" ? next(slot.value) : next;
          if (!Object.is(value, slot.value)) { slot.value = value; dirty = true; }
        };
        slots[index] = slot;
      }
      return [slots[index].value, slots[index].set];
    },
    useRef(initial) { const index = cursor++; slots[index] ??= { current: initial }; return slots[index]; },
    useMemo(factory, deps) {
      const index = cursor++;
      if (!slots[index] || !sameDeps(slots[index].deps, deps)) slots[index] = { value: factory(), deps };
      return slots[index].value;
    },
    useCallback(callback, deps) { return hooks.useMemo(() => callback, deps); },
    useEffect(callback, deps) {
      const index = cursor++;
      if (!slots[index] || !sameDeps(slots[index].deps, deps)) effects.set(index, { callback, deps });
    },
  };
  const jsx = (type, props) => ({ type, props: props || {} });
  const modules = {
    react: hooks, "react/jsx-runtime": { jsx, jsxs: jsx },
    "@/lib/branding": { APP_VERSION_DISPLAY: "fixture" },
    "@/hooks/useDesktopHostIdentity": { useDesktopHostIdentity: () => ({ host: null, loading: false, refresh: async () => {} }) },
    "./desktop": { useDesktopChrome: () => ({ isDesktop: false }), WindowControls: "window-controls" },
    "@/lib/edupi-settings-navigation": navigation,
    "./EduPiSettingsIcon": { EduPiSettingsIcon: "settings-icon" },
    "./EduPiBackgroundJobs": { EduPiBackgroundJobs: "background-jobs" },
    "@/lib/desktop-window": {},
    "@/lib/edupi-schedule-display": { formatCoreSchedulerStatus: () => "" },
    "@/lib/edupi-runtime-health": { coreExecutionReadinessLabel: () => "" },
    "./EduPiCoreCompatibility": { EduPiCoreCompatibility: "core-compatibility" },
    "@/lib/edupi-runtime-client": {}, "@/lib/edupi-kernel-display": {},
    "./EduPiDeletedEntities": { EduPiDeletedEntities: "deleted-entities" },
    "@/lib/edupi-entity-delete-client": {},
    "./EduPiProactivityCanary": { EduPiProactivityCanary: "proactivity-canary" },
    "./EduPiPromptOutboxRecovery": { EduPiPromptOutboxRecovery: "outbox-recovery" },
    "./JevSettingsCard": { JevSettingsCard: "jev-settings" },
    "./OpenConnectorAdminPanel": { OpenConnectorAdminPanel: "connector-settings" },
  };
  const exports = {};
  vm.runInNewContext(compiled, {
    exports, require: (name) => { assert.ok(modules[name], `module ${name}`); return modules[name]; },
    AbortController, DOMException, HTMLElement: Element, MutationObserver, document,
    window: { confirm: () => true }, fetch: async () => ({ ok: false }),
    requestAnimationFrame: (callback) => { const id = ++nextId; frames.set(id, callback); return id; },
    cancelAnimationFrame: (id) => frames.delete(id),
    setTimeout: (callback, delay) => { const id = ++nextId; timers.set(id, { callback, at: now + delay }); return id; },
    clearTimeout: (id) => timers.delete(id),
  });
  const props = {
    initialSection, modelSettingsDirty: false, settingsBusy: false, modelsPanel: () => null,
    onClose() {}, onOpenContext() {}, onAskStudentUpdate() {}, onNavigate() {},
    settingsPanel: (page) => jsx("app-settings", { page }),
  };
  function render() {
    let attempts = 0;
    do {
      assert.ok(attempts++ < 25, "component effects should settle");
      cursor = 0; dirty = false; tree = exports.EduPiAdminPanel(props);
      for (const node of nodes(tree)) if (node.props.ref) {
        const id = node.props["aria-label"] || textOf(node) || node.type;
        if (!elements.has(id)) elements.set(id, new Element(id));
        node.props.ref.current = node.type === "main" ? workspace : elements.get(id);
      }
      const pending = [...effects]; effects.clear();
      for (const [index, effect] of pending) {
        slots[index]?.cleanup?.();
        slots[index] = { deps: effect.deps, cleanup: effect.callback() };
      }
    } while (dirty);
    return tree;
  }
  function mutate(type = "childList") {
    for (const observer of observers) if (observer.connected) observer.callback([{ type, target: workspace, attributeName: type === "attributes" ? "hidden" : null }], observer);
  }
  return {
    render, frames, timers, observers, focus, scroll, opener, workspace, document,
    setProps(next) { Object.assign(props, next); return render(); },
    page() { return nodes(render()).find((node) => node.type === "app-settings")?.props.page; },
    button(label) { const node = nodes(render()).find((item) => item.type === "button" && textOf(item) === label); assert.ok(node, `button ${label}`); return node; },
    search(query) {
      nodes(render()).find((node) => node.type === "input").props.onChange({ target: { value: query } });
      nodes(render()).find((node) => node.type === "input").props.onKeyDown({ key: "Enter", preventDefault() {} });
      return render();
    },
    addTarget(id, { hidden = false, tabIndex = null } = {}) {
      const element = new Element(id);
      if (hidden) element.setAttribute("hidden", "");
      if (tabIndex !== null) element.setAttribute("tabindex", tabIndex);
      if (id === "update-proxy") element.details = new Element("proxy-details");
      targets.set(id, element); mutate(); return element;
    },
    revealTarget(element) { element.removeAttribute("hidden"); mutate("attributes"); },
    flushFrames() {
      const pending = [...frames]; frames.clear();
      for (const [, callback] of pending) callback(now);
      render();
    },
    advance(ms) {
      now += ms;
      for (const [id, timer] of [...timers]) if (timer.at <= now) { timers.delete(id); timer.callback(); }
    },
    unmount() {
      if (unmounted) return;
      unmounted = true;
      for (const slot of slots) slot?.cleanup?.();
    },
  };
}

test("settings search waits for the dynamic page target and focuses it when hidden content becomes visible", () => {
  const panel = mountAdmin();
  try {
    panel.search("更新代理"); panel.flushFrames();
    assert.equal(panel.page(), "about");
    assert.equal(panel.observers.filter((observer) => observer.connected).length, 1);
    const observer = panel.observers.at(-1);
    assert.equal(observer.element, panel.workspace);
    assert.equal(observer.options.childList, true);
    assert.equal(observer.options.subtree, true);
    assert.ok(observer.options.attributeFilter.includes("hidden"));
    const target = panel.addTarget("update-proxy", { hidden: true, tabIndex: "0" });
    panel.flushFrames();
    assert.notEqual(panel.document.activeElement, target, "a hidden page is not a focus target");
    panel.revealTarget(target); panel.flushFrames();
    assert.equal(panel.document.activeElement, target);
    assert.equal(target.classList.contains("is-setting-target"), true);
    assert.equal(target.details.getAttribute("open"), "");
    assert.equal(panel.scroll.at(-1).element, target);
    assert.equal(panel.scroll.at(-1).options.block, "center");
    assert.equal(panel.focus.at(-1).options.preventScroll, true);
    assert.equal(panel.observers.some((item) => item.connected), false);
    assert.equal(panel.timers.size, 0);
    panel.unmount();
    assert.equal(target.classList.contains("is-setting-target"), false);
    assert.equal(target.getAttribute("tabindex"), "0");
    assert.equal(panel.document.activeElement, panel.opener);
  } finally { panel.unmount(); }
});

test("a controlled settings shortcut cannot leave an updating about page or replay when updating ends", () => {
  const panel = mountAdmin("about");
  try {
    panel.render();
    panel.setProps({ settingsBusy: true });
    panel.setProps({ initialSection: "settings" });
    assert.equal(panel.page(), "about");
    assert.equal(panel.button("关于与更新").props["aria-current"], "page");
    panel.setProps({ settingsBusy: false });
    assert.equal(panel.page(), "about", "an ignored shortcut must not replay after the upgrade");
    panel.button("常规").props.onClick();
    assert.equal(panel.page(), "general", "normal navigation resumes after the upgrade");
  } finally { panel.unmount(); }
});

test("unmounting a pending search releases its observer, animation frame, and deadline", () => {
  const panel = mountAdmin();
  panel.search("外观");
  assert.equal(panel.observers.some((item) => item.connected), true);
  assert.ok(panel.frames.size > 0);
  assert.ok(panel.timers.size > 0);
  panel.unmount();
  assert.equal(panel.observers.some((item) => item.connected), false);
  assert.equal(panel.frames.size, 0);
  assert.equal(panel.timers.size, 0);
  const focusCount = panel.focus.length;
  panel.addTarget("appearance");
  panel.advance(10_000);
  assert.equal(panel.focus.length, focusCount, "late chunk arrival cannot focus an unmounted panel");
});

test("an unavailable search target stops being observed after ten seconds", () => {
  const panel = mountAdmin();
  try {
    panel.search("外观"); panel.flushFrames();
    panel.advance(9_999);
    assert.equal(panel.observers.some((item) => item.connected), true);
    panel.advance(1);
    assert.equal(panel.observers.some((item) => item.connected), false);
    assert.equal(panel.timers.size, 0);
    const target = panel.addTarget("appearance"); panel.flushFrames();
    assert.notEqual(panel.document.activeElement, target);
  } finally { panel.unmount(); }
});
