import assert from "node:assert/strict";
import fs from "node:fs";
import vm from "node:vm";
import test from "node:test";
import ts from "typescript";

const compiled = ts.transpileModule(fs.readFileSync(new URL("./useModalDismiss.ts", import.meta.url), "utf8"), {
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
}).outputText;

function fixture() {
  const effects = [], listeners = new Set(), exports = {};
  const document = {
    activeElement: null,
    addEventListener(_name, callback) { listeners.add(callback); },
    removeEventListener(_name, callback) { listeners.delete(callback); },
  };
  const control = name => ({ name, offsetParent: {}, focus() { document.activeElement = this; } });
  const panel = controls => ({
    contains: target => controls.includes(target),
    querySelector: () => controls[0],
    querySelectorAll: () => controls,
  });
  const react = { useRef: current => ({ current }), useEffect: effect => effects.push(effect) };
  vm.runInNewContext(compiled, { exports, document, require: () => react });
  const key = (value, shiftKey = false) => {
    const event = { key: value, shiftKey, defaultPrevented: false,
      preventDefault() { this.defaultPrevented = true; }, stopPropagation() {},
    };
    for (const callback of listeners) callback(event);
    return event;
  };
  return { useModalDismiss: exports.useModalDismiss, effects, document, control, panel, key, listeners };
}

test("a restored navigation list owns Tab and Escape above the student detail modal", () => {
  const f = fixture();
  const edit = f.control("student edit"), close = f.control("student close");
  const collapse = f.control("list collapse"), search = f.control("list search"), lastRow = f.control("last student");
  const restore = f.control("restore navigation");
  let studentDismissals = 0, listDismissals = 0;
  const studentRef = f.useModalDismiss(() => { studentDismissals += 1; });
  studentRef.current = f.panel([edit, close]);
  const closeStudent = f.effects.shift()();
  f.document.activeElement = restore;
  const listRef = { current: f.panel([collapse, search, lastRow]) };
  assert.equal(f.useModalDismiss(() => { listDismissals += 1; }, true, listRef), listRef);
  const closeList = f.effects.shift()();

  assert.equal(f.document.activeElement, collapse);
  assert.equal(f.key("Tab").defaultPrevented, false);
  assert.equal(f.document.activeElement, collapse, "the student modal must not steal focus");
  assert.equal(f.key("Tab", true).defaultPrevented, true);
  assert.equal(f.document.activeElement, lastRow);
  assert.equal(f.key("Tab").defaultPrevented, true);
  assert.equal(f.document.activeElement, collapse);
  assert.equal(f.key("Escape").defaultPrevented, true);
  assert.equal(listDismissals, 1);
  assert.equal(studentDismissals, 0);

  closeList();
  assert.equal(f.document.activeElement, restore);
  assert.equal(f.key("Tab").defaultPrevented, true);
  assert.equal(f.document.activeElement, edit);
  closeStudent();
  assert.equal(f.listeners.size, 0);
});

test("a disabled external navigation scope registers no trap or focus change", () => {
  const f = fixture(), before = f.control("current control");
  f.document.activeElement = before;
  const ref = { current: f.panel([f.control("hidden list")]) };
  assert.equal(f.useModalDismiss(() => assert.fail("must not dismiss"), false, ref), ref);
  assert.equal(f.effects.shift()(), undefined);
  assert.equal(f.listeners.size, 0);
  assert.equal(f.document.activeElement, before);
});
