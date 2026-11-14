import assert from "node:assert/strict";
import fs from "node:fs";
import vm from "node:vm";
import test from "node:test";
import ts from "typescript";

const source = ts.transpileModule(fs.readFileSync(new URL("./ElasticPanelHandle.tsx", import.meta.url), "utf8"), {
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.ReactJSX },
}).outputText;

function mount({ reduced = false } = {}) {
  let now = 0, sequence = 0;
  const frames = new Map(), timers = new Map(), listeners = new Map(), styles = new Map();
  const paths = [{ setAttribute(_key, value) { this.d = value; } }, { setAttribute(_key, value) { this.d = value; } }];
  const motion = { current: { dragging: false, excess: 0, speed: 0, time: 0 } };
  const listen = prefix => ({
    addEventListener(type, callback) { listeners.set(`${prefix}:${type}`, callback); },
    removeEventListener(type, callback) { if (listeners.get(`${prefix}:${type}`) === callback) listeners.delete(`${prefix}:${type}`); },
  });
  const media = { ...listen("media"), matches: reduced };
  const document = { ...listen("document"), hidden: false };
  const host = { querySelectorAll: () => paths, style: { setProperty: (key, value) => styles.set(key, Number(value)) }, dataset: {} };
  const exports = {};
  vm.runInNewContext(source, { exports, document, window: { matchMedia: () => media }, performance: { now: () => now },
    requestAnimationFrame(callback) { frames.set(++sequence, callback); return sequence; },
    cancelAnimationFrame(id) { frames.delete(id); },
    setTimeout(callback, delay) { timers.set(++sequence, { callback, due: now + delay }); return sequence; },
    clearTimeout(id) { timers.delete(id); },
    require() { return {}; },
  });
  const controller = exports.createElasticPanelMotion(host, motion);
  return {
    controller, exports, host, frames, timers, listeners, styles, paths, motion, media, document,
    advance(ms = 16) {
      now += ms;
      for (const [id, timer] of [...timers]) if (timer.due <= now) { timers.delete(id); timer.callback(); }
      const callbacks = [...frames.values()]; frames.clear(); callbacks.forEach(callback => callback(now));
    },
    move(excess, speed) { motion.current = { dragging: true, excess, speed, time: now }; controller.wake(); },
    release() { motion.current = { dragging: false, excess: 0, speed: 0, time: now }; controller.wake(); },
    settle() {
      for (let i = 0; i < 240 && frames.size; i++) this.advance();
      assert.equal(frames.size, 0, "animation must stop after convergence");
    },
  };
}

test("resisted stretch is signed, monotonic and bounded below 15px even at extreme excess", () => {
  const f = mount();
  try {
    const stretch = f.exports.resistedPanelStretch;
    assert.equal(stretch(0), 0);
    assert.ok(stretch(5) > 0 && stretch(35) > stretch(5));
    assert.ok(stretch(300) < 15 && stretch(300) > 14);
    assert.equal(stretch(-35), -stretch(35));
    assert.ok(stretch(1e6) <= 15);
  } finally { f.controller.destroy(); }
});

test("idle has no RAF; hover reveals, velocity bends, legal-boundary excess stretches and release springs back", () => {
  const f = mount();
  try {
    const rest = f.paths[0].d;
    assert.equal(f.frames.size, 0);
    assert.equal(f.styles.get("--elastic-reveal"), 0);
    f.controller.hover(true); f.settle();
    assert.equal(f.styles.get("--elastic-reveal"), 1);
    f.move(0, 1600); f.advance();
    assert.notEqual(f.paths[0].d, rest);
    f.move(180, 0); f.settle();
    const stretched = f.paths[0].d;
    assert.notEqual(stretched, rest);
    assert.equal(f.host.dataset.elasticState, "dragging");
    f.release(); f.advance();
    assert.notEqual(f.paths[0].d, rest, "release must retain the first spring frame");
    f.settle();
    assert.equal(f.paths[0].d, rest);
    assert.equal(f.host.dataset.elasticState, "idle");
    f.controller.hover(false); f.advance(350); f.settle();
    assert.equal(f.styles.get("--elastic-reveal"), 0);
    assert.equal(f.frames.size, 0);
  } finally { f.controller.destroy(); }
});

test("reduced motion shows a straight static grip and reacts immediately to preference changes", () => {
  const f = mount({ reduced: true });
  try {
    const rest = f.paths[0].d;
    f.controller.focus(true); f.move(-300, -1800);
    assert.equal(f.paths[0].d, rest);
    assert.equal(f.styles.get("--elastic-reveal"), 1);
    assert.equal(f.frames.size, 0);
    f.media.matches = false; f.listeners.get("media:change")(); f.advance();
    assert.notEqual(f.paths[0].d, rest);
    f.media.matches = true; f.listeners.get("media:change")();
    assert.equal(f.paths[0].d, rest);
    assert.equal(f.frames.size, 0);
  } finally { f.controller.destroy(); }
});

test("hide and destroy cancel pending frames, timers and media/visibility listeners", () => {
  const f = mount();
  f.controller.hover(true); f.move(100, 1000); f.advance();
  assert.ok(f.frames.size);
  f.document.hidden = true; f.listeners.get("document:visibilitychange")();
  assert.equal(f.frames.size, 0);
  f.controller.hover(false); f.release();
  assert.ok(f.timers.size);
  f.controller.destroy();
  assert.equal(f.frames.size, 0);
  assert.equal(f.timers.size, 0);
  assert.equal(f.listeners.size, 0);
  f.controller.wake(); f.advance(1000);
  assert.equal(f.frames.size, 0);
});
