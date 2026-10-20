import assert from "node:assert/strict";
import fs from "node:fs";
import vm from "node:vm";
import test from "node:test";
import ts from "typescript";

function harness({ desktop = true } = {}) {
  const effects = [], observations = [], timers = new Map(), listeners = new Map(), windowListeners = new Map();
  let nextTimer = 0, observer;
  const document = { visibilityState: "visible", addEventListener: (event, fn) => listeners.set(event, fn), removeEventListener: event => listeners.delete(event) };
  const jsx = (type, props) => ({ type, props });
  const hooks = { useRef: current => ({ current }), useEffect: effect => effects.push(effect), createContext: () => ({}), useContext: () => null };
  const exports = {};
  const code = ts.transpileModule(fs.readFileSync(new URL("./EduPiUsageObservation.tsx", import.meta.url), "utf8"), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, jsx: ts.JsxEmit.ReactJSX, target: ts.ScriptTarget.ES2022 },
  }).outputText;
  vm.runInNewContext(code, { exports, document,
    window: { addEventListener: (event, fn) => windowListeners.set(event, fn), removeEventListener: event => windowListeners.delete(event) },
    setTimeout: fn => { timers.set(++nextTimer, fn); return nextTimer; }, clearTimeout: id => timers.delete(id),
    IntersectionObserver: class { constructor(callback) { this.callback = callback; observer = this; } observe(element) { this.element = element; } disconnect() { this.disconnected = true; } },
    require(name) {
      if (name === "react") return hooks;
      if (name.includes("jsx-runtime")) return { jsx, jsxs: jsx };
      if (name.includes("desktop-updater")) return { isTauriDesktop: () => desktop };
      if (name.includes("usage-observation")) return { observeTeacherUsage: async input => { observations.push(input); return "recorded"; } };
      throw Error(name);
    },
  });
  const props = { target: { kind: "work_candidate", targetId: "candidate-1", expectedRevision: 2 }, action: "opportunity_visible", surface: "today", children: "合成内容" };
  const tree = exports.EduPiUsageArticle(props);
  tree.props.ref.current = {};
  const cleanup = effects[0]();
  return { tree, document, observations, listeners, windowListeners, cleanup, get observer() { return observer; },
    intersect(visible) { observer.callback([{ target: observer.element, isIntersecting: visible, intersectionRatio: visible ? 1 : 0 }]); },
    async flush() { for (const [id, fn] of [...timers]) { timers.delete(id); fn(); } await Promise.resolve(); await Promise.resolve(); },
  };
}

test("a surface is counted only after actual visible intersection and never in the background", async () => {
  const app = harness();
  assert.equal(app.tree.type, "article");
  app.intersect(false); await app.flush(); assert.equal(app.observations.length, 0);
  app.document.visibilityState = "hidden"; app.intersect(true); await app.flush(); assert.equal(app.observations.length, 0);
  app.document.visibilityState = "visible"; app.listeners.get("visibilitychange")(); await app.flush();
  assert.equal(app.observations.length, 1);
  assert.equal(app.observations[0].target.expectedRevision, 2);
  assert.equal(app.observations[0].once, true);
  app.intersect(true); await app.flush(); assert.equal(app.observations.length, 1);
  app.cleanup(); assert.equal(app.observer.disconnected, true); assert.equal(app.listeners.size, 0);
});

test("web surfaces do not start collection and unmount cancels pending visibility", async () => {
  const web = harness({ desktop: false });
  assert.equal(web.observer, undefined); assert.equal(web.observations.length, 0);
  const app = harness(); app.intersect(true); app.cleanup(); await app.flush();
  assert.equal(app.observations.length, 0);
});
