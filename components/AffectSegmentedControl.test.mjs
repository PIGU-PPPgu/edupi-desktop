import assert from "node:assert/strict";
import test from "node:test";
import React from "react";
import TestRenderer, { act } from "react-test-renderer";
import { createJiti } from "jiti";

globalThis.IS_REACT_ACT_ENVIRONMENT = true;
const { SegmentedControl } = await createJiti(import.meta.url, { jsx: { runtime: "automatic" } }).import("./AffectSegmentedControl.tsx");

test("a repeated activation is distinct from a changed option or an arrow-key selection", async () => {
  const previousWindow = globalThis.window;
  globalThis.window = { setTimeout };
  const changes = [], repeats = [];
  const props = { options: [{ value: "a", label: "甲" }, { value: "b", label: "乙" }], value: "a",
    onChange: value => changes.push(value), onReselect: value => repeats.push(value) };
  let renderer;
  try {
    await act(async () => { renderer = TestRenderer.create(React.createElement(SegmentedControl, props)); });
    const buttons = () => renderer.root.findAllByType("button");
    await act(async () => { buttons()[0].props.onClick(); });
    assert.deepEqual(repeats, ["a"]);
    assert.deepEqual(changes, []);
    await act(async () => { buttons()[1].props.onClick(); });
    assert.deepEqual(changes, ["b"]);
    assert.deepEqual(repeats, ["a"]);
    await act(async () => { renderer.update(React.createElement(SegmentedControl, { ...props, value: "b" })); });
    await act(async () => { buttons()[1].props.onClick(); });
    assert.deepEqual(repeats, ["a", "b"]);
    const group = renderer.root.find(node => node.props.role === "radiogroup");
    await act(async () => { group.props.onKeyDown({ key: "ArrowLeft", preventDefault() {} }); });
    assert.deepEqual(changes, ["b", "a"]);
    assert.deepEqual(repeats, ["a", "b"]);
  } finally {
    if (renderer) await act(async () => { renderer.unmount(); });
    if (previousWindow === undefined) delete globalThis.window; else globalThis.window = previousWindow;
  }
});

test("same-length option replacement reattaches measurement to the new option", async () => {
  const old = { firstElementChild: { offsetWidth: 24 }, offsetWidth: 40, offsetLeft: 0, style: {}, getBoundingClientRect: () => ({ left: 0, right: 40, top: 0, bottom: 40 }) };
  const replaced = { ...old, offsetLeft: 44, getBoundingClientRect: () => ({ left: 44, right: 84, top: 0, bottom: 40 }) };
  let optionNodes = [old, replaced], active = old;
  const observed = [];
  const changes = [], repeats = [];
  const scrolls = [];
  const previous = Object.fromEntries(["ResizeObserver", "getComputedStyle", "requestAnimationFrame", "cancelAnimationFrame", "document", "window"].map(name => [name, globalThis[name]]));
  globalThis.ResizeObserver = class { observe(node) { observed.push(node); } disconnect() {} };
  globalThis.getComputedStyle = () => ({ paddingLeft: "8", paddingRight: "8" });
  globalThis.requestAnimationFrame = () => 1;
  globalThis.cancelAnimationFrame = () => {};
  globalThis.document = { activeElement: null };
  globalThis.window = { setTimeout };
  const root = { toggleAttribute() {}, setAttribute() {}, removeAttribute() {} };
  const scroller = { scrollWidth: 100, clientWidth: 100, scrollLeft: 0, style: { setProperty() {} }, scrollTo: value => scrolls.push(value) };
  const track = { style: { setProperty() {} }, clientWidth: 100, offsetLeft: 0, querySelectorAll: () => optionNodes, querySelector: () => active, contains: () => false };
  const pill = { style: {}, dataset: {}, offsetWidth: 40 };
  const createNodeMock = ({ props }) => props.className === "ui-segc" ? root
    : props.className === "ui-segc__scroller" ? scroller
      : props.className === "ui-segc__track" ? track
        : props.className === "ui-segc__pill" ? pill : null;
  let renderer;
  try {
    await act(async () => { renderer = TestRenderer.create(React.createElement(SegmentedControl, {
      options: [{ value: "a", label: "甲" }, { value: "b", label: "乙" }], value: "a",
    }), { createNodeMock }); });
    const fresh = { ...replaced, offsetLeft: 48 };
    optionNodes = [old, fresh]; active = old;
    await act(async () => { renderer.update(React.createElement(SegmentedControl, {
      options: [{ value: "a", label: "甲" }, { value: "c", label: "丙" }], value: "a",
      onChange: value => changes.push(value), onReselect: value => repeats.push(value),
    })); });
    assert.ok(observed.includes(fresh), "the new option must be measured even though the count stayed two");
    const group = renderer.root.find(node => node.props.role === "radiogroup");
    await act(async () => {
      group.props.onPointerDown({ button: 0, pointerId: 1, pointerType: "mouse", clientX: 60,
        currentTarget: { setPointerCapture() {} } });
      group.props.onPointerUp({ pointerId: 1, clientX: 60, clientY: 10 });
      renderer.root.findAllByType("button")[1].props.onClick();
    });
    assert.deepEqual(changes, ["c"], "pointer press and click select the new option once");
    assert.deepEqual(repeats, [], "a changed pointer choice is not a repeated activation");
    await act(async () => { renderer.update(React.createElement(SegmentedControl, {
      options: [{ value: "a", label: "甲" }, { value: "c", label: "丙" }], value: "c",
      onChange: value => changes.push(value), onReselect: value => repeats.push(value),
    })); });
    await act(async () => {
      group.props.onPointerDown({ button: 0, pointerId: 2, pointerType: "mouse", clientX: 60,
        currentTarget: { setPointerCapture() {} } });
      group.props.onPointerUp({ pointerId: 2, clientX: 60, clientY: 10 });
      renderer.root.findAllByType("button")[1].props.onClick();
    });
    assert.deepEqual(repeats, ["c"], "an already selected pointer choice activates once even if click follows capture");
    await act(async () => {
      group.props.onPointerDown({ button: 0, pointerId: 3, pointerType: "mouse", clientX: 60,
        currentTarget: { setPointerCapture() {} } });
      group.props.onPointerCancel();
      group.props.onPointerDown({ button: 0, pointerId: 4, pointerType: "mouse", clientX: 60,
        currentTarget: { setPointerCapture() {} } });
      group.props.onPointerMove({ pointerId: 4, clientX: 95 });
      group.props.onPointerUp({ pointerId: 4, clientX: 95, clientY: 10 });
      group.props.onPointerDown({ button: 0, pointerId: 5, pointerType: "mouse", clientX: 60,
        currentTarget: { setPointerCapture() {} } });
      group.props.onPointerUp({ pointerId: 5, clientX: 200, clientY: 10 });
    });
    assert.deepEqual(repeats, ["c"], "cancel, drag, and release outside must not activate the selected choice");
    const newLast = { ...fresh, offsetLeft: 140 };
    optionNodes = [{ ...old, offsetLeft: 0 }, newLast]; active = newLast; scroller.scrollWidth = 220;
    await act(async () => { renderer.update(React.createElement(SegmentedControl, {
      options: [{ value: "new", label: "新增分类" }, { value: "c", label: "丙" }], value: "c",
    })); });
    assert.ok(scrolls.some(value => value.left > 0), "a changed option set keeps the selected choice in view");
  } finally {
    if (renderer) await act(async () => { renderer.unmount(); });
    for (const [name, value] of Object.entries(previous)) {
      if (value === undefined) delete globalThis[name]; else globalThis[name] = value;
    }
  }
});
