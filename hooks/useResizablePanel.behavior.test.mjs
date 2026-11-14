import assert from "node:assert/strict";
import test from "node:test";
import React, { act } from "react";
import { create } from "react-test-renderer";
import { createJiti } from "jiti";

const jiti = createJiti(import.meta.url, { tsconfigPaths: true });
const { useResizablePanel } = await jiti.import("./useResizablePanel.ts");

class TrackedTarget extends EventTarget {
  listeners = new Map();
  addEventListener(type, callback, options) {
    if (!this.listeners.has(type)) this.listeners.set(type, new Set());
    this.listeners.get(type).add(callback);
    super.addEventListener(type, callback, options);
  }
  removeEventListener(type, callback, options) {
    this.listeners.get(type)?.delete(callback);
    super.removeEventListener(type, callback, options);
  }
  count() { return [...this.listeners.values()].reduce((sum, callbacks) => sum + callbacks.size, 0); }
}

async function mount(t, { growthDirection = "right", storedWidth = null } = {}) {
  const saved = Object.fromEntries(["window", "document", "ResizeObserver", "IS_REACT_ACT_ENVIRONMENT"].map(key => [key, globalThis[key]]));
  const window = new TrackedTarget(), document = new TrackedTarget();
  const writes = [], storage = new Map(storedWidth === null ? [] : [["synthetic-panel-width", String(storedWidth)]]);
  const observers = new Set();
  const hostStyle = new Map(), attributes = new Map(), captured = new Set(), releases = [];
  const widthRef = { current: 260 }, budget = { max: 480 };
  document.body = { style: { cursor: "crosshair", userSelect: "text" } };
  document.visibilityState = "visible";
  window.localStorage = {
    getItem: key => storage.get(key) ?? null,
    setItem: (key, value) => { writes.push([key, value]); storage.set(key, value); },
  };
  Object.assign(globalThis, { window, document, IS_REACT_ACT_ENVIRONMENT: true,
    ResizeObserver: class {
      constructor(callback) { this.callback = callback; this.connected = true; observers.add(this); }
      observe() {}
      disconnect() { this.connected = false; }
    },
  });
  const host = { style: { setProperty: (key, value) => hostStyle.set(key, value) } };
  let current, renderer, unmounted = false, focusCount = 0;
  const target = {
    focus() { focusCount++; },
    setAttribute: (key, value) => attributes.set(key, value),
    setPointerCapture: id => captured.add(id),
    hasPointerCapture: id => captured.has(id),
    releasePointerCapture(id) {
      releases.push(id); captured.delete(id);
      // Simulate the UA's lostpointercapture immediately after explicit release.
      current.separatorProps.onLostPointerCapture(event({ pointerId: id }));
    },
  };
  const getMaxWidth = () => budget.max;
  function Probe({ revision }) {
    void revision;
    current = useResizablePanel({
      ariaLabel: "合成侧栏", cssVariable: "--synthetic-width",
      defaultWidth: 260, getMaxWidth, growthDirection, maxWidth: 480, minWidth: 180,
      storageKey: "synthetic-panel-width", widthRef,
    });
    return React.createElement("div", { ref: current.panelRef });
  }
  function event(extra = {}) {
    return { pointerId: 7, pointerType: "mouse", isPrimary: true, button: 0, buttons: 1, clientX: 300,
      preventDefault() {}, stopPropagation() {}, currentTarget: target, ...extra };
  }
  const run = callback => act(async () => { callback(); });
  await act(async () => { renderer = create(React.createElement(Probe), { createNodeMock: () => host }); });
  const f = {
    window, document, storage, writes, captured, releases, observers, attributes, budget, widthRef,
    get current() { return current; },
    get width() { return Number.parseFloat(hostStyle.get("--synthetic-width")); },
    get focusCount() { return focusCount; },
    down: extra => run(() => current.separatorProps.onPointerDown(event(extra))),
    move: extra => run(() => current.separatorProps.onPointerMove(event(extra))),
    up: extra => run(() => current.separatorProps.onPointerUp(event(extra))),
    cancel: extra => run(() => current.separatorProps.onPointerCancel(event(extra))),
    lost: extra => run(() => current.separatorProps.onLostPointerCapture(event(extra))),
    key: (key, extra) => run(() => current.separatorProps.onKeyDown(event({ key, ...extra }))),
    dispatch: (where, name) => run(() => where.dispatchEvent(new Event(name))),
    observe: () => run(() => { for (const observer of observers) if (observer.connected) observer.callback(); }),
    rerender: () => act(async () => renderer.update(React.createElement(Probe, { revision: 1 }))),
    unmount: async () => { if (!unmounted) { unmounted = true; await act(async () => renderer.unmount()); } },
  };
  t.after(async () => {
    await f.unmount();
    for (const [key, value] of Object.entries(saved)) {
      if (value === undefined) delete globalThis[key]; else globalThis[key] = value;
    }
  });
  return f;
}

test("pointer drag clamps live CSS and ARIA; only release persists once, including implicit capture loss", async t => {
  const f = await mount(t);
  await f.down();
  assert.ok(f.captured.has(7));
  await f.move({ clientX: 1000 });
  assert.equal(f.width, 480);
  assert.equal(f.widthRef.current, 480);
  assert.equal(f.attributes.get("aria-valuenow"), "480");
  assert.equal(f.current.motionRef.current.excess, 480);
  assert.equal(f.current.width, 260, "pointer frames do not commit React width");
  assert.equal(f.writes.length, 0);
  await f.up();
  await f.lost();
  assert.equal(f.current.width, 480);
  assert.deepEqual(f.writes, [["synthetic-panel-width", "480"]]);
  assert.equal(f.current.motionRef.current.dragging, false);
  assert.equal(f.captured.size, 0);
  assert.deepEqual(f.document.body.style, { cursor: "crosshair", userSelect: "text" });
});

for (const reason of ["cancel", "lost", "Escape", "blur", "hidden"]) test(`${reason} restores the starting width without a partial preference commit`, async t => {
  const f = await mount(t, { storedWidth: 300 });
  await f.down(); await f.move({ clientX: 550 });
  assert.equal(f.width, 480);
  if (reason === "Escape") await f.key("Escape");
  else if (reason === "blur") await f.dispatch(f.window, "blur");
  else if (reason === "hidden") { f.document.visibilityState = "hidden"; await f.dispatch(f.document, "visibilitychange"); }
  else await f[reason]();
  await f.lost();
  assert.equal(f.width, 300);
  assert.equal(f.current.width, 300);
  assert.equal(f.storage.get("synthetic-panel-width"), "300");
  assert.equal(f.writes.length, 0);
  assert.equal(f.attributes.get("aria-valuenow"), "300");
  assert.equal(f.current.isResizing, false);
  assert.equal(f.current.motionRef.current.dragging, false);
});

test("right panel uses physical pointer direction for stretch while keeping legal layout bounds", async t => {
  const f = await mount(t, { growthDirection: "left" });
  await f.down();
  await f.move({ clientX: -100 });
  assert.equal(f.width, 480);
  assert.ok(f.current.motionRef.current.excess < 0);
  await f.move({ clientX: 800 });
  assert.equal(f.width, 180);
  assert.ok(f.current.motionRef.current.excess > 0);
  await f.cancel();
  assert.equal(f.width, 260);
});

test("other pointers and secondary buttons cannot replace a captured drag", async t => {
  const f = await mount(t);
  await f.down({ button: 2 }); await f.down({ isPrimary: false });
  assert.equal(f.focusCount, 0);
  await f.down();
  await f.down({ pointerId: 9 });
  await f.move({ pointerId: 9, clientX: 1000 });
  await f.up({ pointerId: 9 });
  assert.equal(f.width, 260);
  assert.deepEqual([...f.captured], [7]);
  await f.move({ clientX: 340 });
  assert.equal(f.width, 300);
});

test("keyboard, reset and restored preferences share the responsive clamp", async t => {
  const f = await mount(t, { storedWidth: 700 });
  assert.equal(f.width, 480);
  assert.equal(f.storage.get("synthetic-panel-width"), "480");
  await f.key("Home"); assert.equal(f.width, 180);
  await f.key("ArrowRight"); assert.equal(f.width, 192);
  await f.key("ArrowRight", { shiftKey: true }); assert.equal(f.width, 224);
  await f.key("Enter"); assert.equal(f.width, 260);
  f.budget.max = 340;
  await f.key("End"); assert.equal(f.width, 340);
  f.budget.max = 220;
  await f.observe();
  assert.equal(f.width, 220);
  assert.equal(f.storage.get("synthetic-panel-width"), "220");
});

test("a layout observer and a parent rerender never persist an in-progress drag", async t => {
  const f = await mount(t);
  await f.down(); await f.move({ clientX: 380 });
  await f.rerender(); await f.observe();
  assert.equal(f.width, 340);
  assert.equal(f.current.isResizing, true);
  assert.equal(f.writes.length, 0);
  f.budget.max = 300;
  await f.observe();
  assert.equal(f.width, 260);
  assert.equal(f.current.isResizing, false);
  assert.equal(f.writes.length, 0);
});

test("unmount restores body state and start width, releases capture, disconnects observers and removes listeners", async t => {
  const f = await mount(t);
  await f.down(); await f.move({ clientX: 450 });
  assert.ok(f.window.count() > 0 && f.document.count() > 0);
  await f.unmount();
  assert.equal(f.widthRef.current, 260);
  assert.equal(f.writes.length, 0);
  assert.equal(f.captured.size, 0);
  assert.equal(f.window.count(), 0);
  assert.equal(f.document.count(), 0);
  assert.ok([...f.observers].every(observer => !observer.connected));
  assert.deepEqual(f.document.body.style, { cursor: "crosshair", userSelect: "text" });
});
