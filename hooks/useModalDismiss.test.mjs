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
  const element = (tagName, parentElement = null, open = false) => {
    const node = {
      tagName, parentElement, open, children: [],
      hasAttribute(name) { return name === "open" && this.open; },
      contains(target) {
        for (let current = target; current; current = current.parentElement) if (current === this) return true;
        return false;
      },
    };
    parentElement?.children.push(node);
    return node;
  };
  const control = (name, { tagName = "BUTTON", parent = null, focusBlocked = false } = {}) => Object.assign(element(tagName, parent), {
    name, offsetParent: {},
    focus() { if (!focusBlocked) document.activeElement = this; },
  });
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
  return { useModalDismiss: exports.useModalDismiss, effects, document, element, control, panel, key, listeners };
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

test("reverse Tab skips closed history content even when it has an offset parent", () => {
  const f = fixture(), opener = f.control("expand graph"), close = f.control("close graph");
  const history = f.element("DETAILS");
  const summary = f.control("history", { tagName: "SUMMARY", parent: history });
  const restore = f.control("hidden restore", { parent: history, focusBlocked: true });
  const ref = f.useModalDismiss(() => {});
  ref.current = f.panel([close, summary, restore]);
  f.document.activeElement = opener;
  const cleanup = f.effects.shift()();

  assert.equal(f.document.activeElement, close);
  assert.notEqual(restore.offsetParent, null, "closed WebKit details can retain layout ancestry");
  assert.equal(f.key("Tab", true).defaultPrevented, true);
  assert.equal(f.document.activeElement, summary);
  assert.equal(f.key("Tab").defaultPrevented, true);
  assert.equal(f.document.activeElement, close);
  cleanup();
  assert.equal(f.document.activeElement, opener);
});

test("closed details keep the first summary and its focusable descendants in the cycle", () => {
  const f = fixture(), close = f.control("close");
  const details = f.element("DETAILS");
  const summary = f.control("summary", { tagName: "SUMMARY", parent: details });
  const summaryLink = f.control("summary help", { tagName: "A", parent: summary });
  const laterSummary = f.control("later hidden summary", { tagName: "SUMMARY", parent: details, focusBlocked: true });
  const content = f.control("hidden content", { parent: details, focusBlocked: true });
  const ref = f.useModalDismiss(() => {});
  ref.current = f.panel([close, summary, summaryLink, laterSummary, content]);
  const cleanup = f.effects.shift()();

  f.key("Tab", true);
  assert.equal(f.document.activeElement, summaryLink);
  assert.equal(f.key("Tab", true).defaultPrevented, false, "a summary descendant is not the cycle's first item");
  f.document.activeElement = summary;
  assert.equal(f.key("Tab").defaultPrevented, false, "the first summary stays in the interior of the cycle");
  f.document.activeElement = summaryLink;
  assert.equal(f.key("Tab").defaultPrevented, true);
  assert.equal(f.document.activeElement, close);
  cleanup();
});

test("opening details includes its content in forward and reverse boundary wrapping", () => {
  const f = fixture(), close = f.control("close");
  const details = f.element("DETAILS", null, true);
  const summary = f.control("history", { tagName: "SUMMARY", parent: details });
  const restore = f.control("restore", { parent: details });
  const ref = f.useModalDismiss(() => {});
  ref.current = f.panel([close, summary, restore]);
  const cleanup = f.effects.shift()();

  assert.equal(f.key("Tab", true).defaultPrevented, true);
  assert.equal(f.document.activeElement, restore);
  assert.equal(f.key("Tab").defaultPrevented, true);
  assert.equal(f.document.activeElement, close);
  cleanup();
});

test("an outer closed details hides nested summaries regardless of the inner open state", () => {
  for (const innerOpen of [false, true]) {
    const f = fixture(), close = f.control("close");
    const outer = f.element("DETAILS");
    const outerSummary = f.control("outer history", { tagName: "SUMMARY", parent: outer });
    const inner = f.element("DETAILS", outer, innerOpen);
    const innerSummary = f.control("inner history", { tagName: "SUMMARY", parent: inner, focusBlocked: true });
    const content = f.control("inner content", { parent: inner, focusBlocked: true });
    const ref = f.useModalDismiss(() => {});
    ref.current = f.panel([close, outerSummary, innerSummary, content]);
    const cleanup = f.effects.shift()();

    f.key("Tab", true);
    assert.equal(f.document.activeElement, outerSummary);
    assert.equal(f.key("Tab").defaultPrevented, true);
    assert.equal(f.document.activeElement, close);
    cleanup();
  }
});

test("an inner closed details retains its summary when every outer details is open", () => {
  const f = fixture(), close = f.control("close");
  const outer = f.element("DETAILS", null, true);
  const outerSummary = f.control("outer history", { tagName: "SUMMARY", parent: outer });
  const inner = f.element("DETAILS", outer);
  const innerSummary = f.control("inner history", { tagName: "SUMMARY", parent: inner });
  const summaryLink = f.control("inner summary help", { tagName: "A", parent: innerSummary });
  const content = f.control("hidden inner content", { parent: inner, focusBlocked: true });
  const ref = f.useModalDismiss(() => {});
  ref.current = f.panel([close, outerSummary, innerSummary, summaryLink, content]);
  const cleanup = f.effects.shift()();

  f.key("Tab", true);
  assert.equal(f.document.activeElement, summaryLink);
  f.document.activeElement = innerSummary;
  assert.equal(f.key("Tab").defaultPrevented, false);
  cleanup();
});

test("ordinary dialogs preserve deliberate inner focus and retain their boundary and Escape behavior", () => {
  const f = fixture(), first = f.control("first"), last = f.control("last"), outside = f.control("outside");
  let dismissals = 0;
  const ref = f.useModalDismiss(() => { dismissals += 1; });
  ref.current = f.panel([first, last]);
  f.document.activeElement = last;
  const cleanup = f.effects.shift()();

  assert.equal(f.document.activeElement, last, "mounting must preserve focus already inside");
  assert.equal(f.key("Tab", true).defaultPrevented, false);
  last.offsetParent = null;
  assert.equal(f.key("Tab").defaultPrevented, true);
  assert.equal(f.document.activeElement, first, "the active element exemption still defines the cycle boundary");
  last.offsetParent = {};
  f.document.activeElement = outside;
  assert.equal(f.key("Tab", true).defaultPrevented, true);
  assert.equal(f.document.activeElement, last);
  f.key("Escape");
  assert.equal(dismissals, 1);
  cleanup();
});
