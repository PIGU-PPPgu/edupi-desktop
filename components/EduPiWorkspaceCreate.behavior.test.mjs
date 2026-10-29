import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import vm from "node:vm";
import ts from "typescript";
import { createJiti } from "jiti";

const jiti = createJiti(import.meta.url, { tsconfigPaths: true });
const libraries = Object.fromEntries(await Promise.all(["edupi-work-case", "edupi-task-board", "edupi-task-category", "edupi-workbench", "edupi-teacher-task-form", "edupi-foreground"].map(async name => [`@/lib/${name}`, await jiti.import(`../lib/${name}.ts`)])));
const { buildEducationContract } = await jiti.import("../lib/edupi-education-contract.ts");
const source = process.env.EDUPI_WORKSPACE_CREATE_SOURCE || new URL("./EduPiWorkspaceBoard.tsx", import.meta.url);
const code = ts.transpileModule(readFileSync(source, "utf8"), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.ReactJSX } }).outputText;
const jsx = (type, props, key) => ({ type, props: props || {}, key });
const nodes = value => Array.isArray(value) ? value.flatMap(nodes) : value?.props ? [value, ...nodes(value.props.children)] : [];
const text = value => typeof value === "string" || typeof value === "number" ? String(value) : Array.isArray(value) ? value.map(text).join("") : value?.props ? text(value.props.children) : "";
const tick = () => new Promise(resolve => setImmediate(resolve));

function mount({ workspace = "/ui-test/one", immediate = false } = {}) {
  const slots = [], effects = [], requests = [], elements = new Map(), listeners = new Map(), focused = [], revealed = [], interactions = [];
  let cursor = 0, dirty = false, tree, mounted = true, writesAfterUnmount = 0, uuid = 0, previousRefs = [], ancestorHidden = false;
  const document = { body: {}, documentElement: {}, activeElement: null, hidden: false,
    addEventListener(name, fn) { assert.ok(["focusin", "visibilitychange"].includes(name)); if (!listeners.has(name)) listeners.set(name, new Set()); listeners.get(name).add(fn); },
    removeEventListener(name, fn) { listeners.get(name)?.delete(fn); },
  };
  document.activeElement = document.body;
  const move = target => { document.activeElement = target; for (const fn of [...listeners.get("focusin") || []]) fn({ target }); return target; };
  const root = { isConnected: true, ownerDocument: document, contains: target => target?.isConnected && target.root === root,
    closest() { return ancestorHidden ? root : null; },
  };
  const element = key => ({ key, root, ownerDocument: document, isConnected: true, disabled: false,
    closest() { return ancestorHidden ? root : null; },
    scrollIntoView(options) { assert.ok(this.isConnected); revealed.push({ key, ...options }); interactions.push({ type: "scroll", key, ...options }); },
    focus(options = {}) { assert.ok(this.isConnected && !this.disabled, `${key} must be available`); focused.push(key); interactions.push({ type: "focus", key, ...options }); move(this); },
  });
  const same = (a, b) => a?.length === b?.length && a.every((value, i) => Object.is(value, b[i]));
  const react = {
    useState(initial) { const i = cursor++; if (!(i in slots)) slots[i] = typeof initial === "function" ? initial() : initial; return [slots[i], value => { if (!mounted) writesAfterUnmount++; const next = typeof value === "function" ? value(slots[i]) : value; if (!Object.is(next, slots[i])) { slots[i] = next; dirty = true; } }]; },
    useRef(initial) { const i = cursor++; slots[i] ??= { current: initial }; return slots[i]; },
    useMemo(fn, deps) { const i = cursor++; if (!same(slots[i]?.deps, deps)) slots[i] = { deps, value: fn() }; return slots[i].value; },
    useEffect(create, deps) { const i = cursor++, old = slots[i]; if (!same(old?.deps, deps)) { slots[i] = { deps, create }; effects.push(() => { old?.cleanup?.(); slots[i].cleanup = create(); }); } },
  };
  const modules = { ...libraries, react, "react/jsx-runtime": { jsx, jsxs: jsx }, "./EduPiForeground": { useEduPiForegroundPolicy: () => ({ today: "2026-10-28", graceDays: 3, pinnedTaskIds: [] }), EduPiPagedRows: "paged-rows" },
    "./AffectSegmentedControl": { SegmentedControl: "segmented-control" } };
  const exported = {};
  vm.runInNewContext(code, { exports: exported, document, Error, crypto: { randomUUID: () => `ui-create-${++uuid}` }, requestAnimationFrame: fn => { fn(); return 1; }, cancelAnimationFrame() {},
    require(name) { assert.ok(modules[name], name); return modules[name]; },
  });
  const props = { data: { ...buildEducationContract({ workspace }), timetable: [{ slot_id: "slot-one", day_of_week: 3, period: 1, subject: "数学", class_name: "UI一班" }], teacherMaterials: [{ material_id: "material-one", title: "TEST材料", available: true, subject: "数学", class_id: "UI一班" }] }, query: "", selectedObjectId: null, onTaskDetail() {}, onMoveTask: async () => {}, onObject(route) { props.selectedObjectId = route; },
    onCreateTask(input) { const item = { input }; requests.push(item); item.promise = immediate ? Promise.resolve({ preparationState: null, preparationError: null }) : new Promise((resolve, reject) => { item.resolve = resolve; item.reject = reject; }); return item.promise; },
  };
  const commit = () => {
    for (const ref of previousRefs) ref.current = null;
    previousRefs = [];
    const seen = new Set(), autoFocus = [];
    const walk = (node, disabled = false, label = "") => {
      if (Array.isArray(node)) { node.forEach(child => walk(child, disabled, label)); return; }
      if (!node?.props) return;
      const p = node.props;
      disabled ||= node.type === "fieldset" && Boolean(p.disabled);
      if (node.type === "label") label = text(nodes(node).find(child => child.type === "span"));
      const key = node.type === "main" && p.className === "edupi-workspace-board" ? "root" : node.type === "form" ? "form"
        : node.type === "h1" ? "heading" : ["input", "textarea", "select"].includes(node.type) ? `field:${p["aria-label"] || label}`
          : node.type === "button" ? text(node) === "新建任务" ? "create" : p.type === "submit" ? "submit" : text(node) === "取消" ? "cancel" : null : null;
      if (key) {
        seen.add(key);
        const isNew = !elements.get(key)?.isConnected;
        if (isNew) elements.set(key, key === "root" ? root : element(key));
        const target = elements.get(key); target.isConnected = root.isConnected; target.disabled = disabled || Boolean(p.disabled); target.node = node;
        if (p.ref) { p.ref.current = target; previousRefs.push(p.ref); }
        if (p.autoFocus && isNew) autoFocus.push(target);
      }
      walk(p.children, disabled, label);
    };
    walk(tree);
    for (const [key, target] of elements) if (!seen.has(key)) target.isConnected = false;
    const active = document.activeElement;
    if (active?.root === root && (!active.isConnected || active.disabled)) document.activeElement = document.body;
    autoFocus.forEach(target => target.focus());
  };
  const f = { props, document, elements, requests, focused, revealed, interactions, listeners,
    render() { let attempts = 0; do { assert.ok(attempts++ < 30, "effects settle"); cursor = 0; dirty = false; tree = exported.EduPiWorkspaceBoard(props); commit(); effects.splice(0).forEach(fn => fn()); } while (dirty); return tree; },
    form() { const node = nodes(tree).find(node => node.type === "form"); assert.ok(node, "form exists"); return node; },
    text() { return text(tree); },
    click(key, { render = true, focus = true } = {}) { const target = elements.get(key); assert.ok(target?.isConnected && !target.disabled, `${key} enabled`); if (focus) move(target); focused.length = 0; target.node.props.onClick(); if (render) f.render(); },
    open(options) { f.click("create", options); },
    field(label) { const target = elements.get(`field:${label}`); assert.ok(target?.isConnected, `field ${label}`); return target; },
    change(label, value, { force = false } = {}) { const target = f.field(label); assert.ok(force || !target.disabled, `${label} enabled`); move(target); const event = { target: target.node.props.type === "checkbox" ? { checked: value } : { value }, currentTarget: { value } }; (target.node.props.onChange || target.node.props.onInput)(event); f.render(); },
    fill() { f.open(); f.change("任务", "[UI验收 TEST] 新任务"); f.change("截止日期", "2026-10-31"); f.change("备注", "合成备注"); focused.length = 0; },
    draft() { return Object.fromEntries([...elements].filter(([key, e]) => key.startsWith("field:") && e.isConnected).map(([key, e]) => [key.slice(6), e.node.props.type === "checkbox" ? e.node.props.checked : e.node.props.value])); },
    submit({ render = true } = {}) { const form = f.form(); move(elements.get("submit")); focused.length = 0; form.props.onSubmit({ preventDefault() {} }); if (render) f.render(); },
    escape({ composing = false, render = true } = {}) { const event = { key: "Escape", nativeEvent: { isComposing: composing }, prevented: false, preventDefault() { this.prevented = true; }, stopPropagation() {} }; f.form().props.onKeyDown?.(event); if (render) f.render(); return event.prevented; },
    finish(index = 0, { error, result = { preparationState: null, preparationError: null } } = {}) { if (error) requests[index].reject(new Error(error)); else requests[index].resolve(result); },
    async settle() { for (let i = 0; i < 5; i++) { await tick(); if (dirty && mounted) f.render(); } },
    move(target = { key: "elsewhere", isConnected: true }) { return move(target); },
    hideAncestor() { ancestorHidden = true; },
    visibility(hidden) { document.hidden = hidden; for (const listener of [...listeners.get("visibilitychange") || []]) listener(); },
    reconnectEffects() { for (const slot of slots) slot?.cleanup?.(); for (const slot of slots) if (slot?.create) slot.cleanup = slot.create(); f.render(); },
    scope(value) { props.data = { ...props.data, workspace: value }; f.render(); },
    route(value) { props.selectedObjectId = value; f.render(); },
    unmount() { mounted = false; root.isConnected = false; for (const slot of slots) slot?.cleanup?.(); },
    get writesAfterUnmount() { return writesAfterUnmount; },
    get primaryCount() { return nodes(tree).filter(n => n.type === "button" && /(?:^| )is-primary(?: |$)/.test(n.props.className || "")).length; },
  };
  f.render(); return f;
}

test("explicit opening reveals the form before focusing title, with one primary action", () => {
  const f = mount(); f.open();
  assert.equal(f.document.activeElement, f.field("任务"));
  assert.equal(f.primaryCount, 1); assert.equal(f.elements.get("create").isConnected, false);
  assert.deepEqual(f.interactions.slice(-2), [{ type: "scroll", key: "form", block: "start", inline: "nearest", behavior: "auto" }, { type: "focus", key: "field:任务", preventScroll: true }]);
});

for (const cancel of ["button", "Escape"]) test(`${cancel} closes without writing, returns to New, and retains its draft`, () => {
  const f = mount(); f.fill(); const before = f.draft();
  if (cancel === "button") f.click("cancel"); else assert.equal(f.escape(), true);
  assert.equal(f.requests.length, 0); assert.equal(f.document.activeElement, f.elements.get("create"));
  f.open(); assert.deepEqual(f.draft(), before);
});

test("Escape composition does not discard an active draft", () => {
  const f = mount(); f.fill(); assert.equal(f.escape({ composing: true }), false); assert.ok(f.elements.get("form").isConnected);
});

for (const interrupted of ["document", "ancestor", "hidden-visible"]) test(`${interrupted} before opening commit never scrolls or focuses the hidden form`, () => {
  const f = mount(); f.open({ render: false });
  if (interrupted === "ancestor") f.hideAncestor();
  else { f.visibility(true); if (interrupted === "hidden-visible") f.visibility(false); }
  f.render(); assert.deepEqual(f.focused, []); assert.deepEqual(f.revealed, []);
});

test("same-tick submit creates one immutable request and locks every field", () => {
  const f = mount(); f.fill(); f.submit({ render: false }); f.submit({ render: false }); f.render();
  assert.equal(f.requests.length, 1);
  assert.deepEqual(JSON.parse(JSON.stringify(f.requests[0].input)), { clientRequestId: "ui-create-1", title: "[UI验收 TEST] 新任务", dueDate: "2026-10-31", note: "合成备注", preparationSource: null });
  for (const label of ["任务", "截止日期", "备注", "自动准备教学产物"]) assert.equal(f.field(label).disabled, true, label);
  assert.equal(f.elements.get("cancel").disabled, true); assert.equal(f.elements.get("submit").disabled, true);
  assert.equal(f.escape(), false); assert.equal(f.requests.length, 1);
});

test("accepted creation waits for its enabled closing DOM before focus return", async () => {
  const f = mount(); f.fill(); f.submit(); f.finish(); await tick();
  assert.deepEqual(f.focused, []); f.render(); assert.equal(f.document.activeElement, f.elements.get("create"));
  f.open(); assert.equal(f.draft()["任务"], ""); assert.equal(f.draft()["截止日期"], ""); assert.equal(f.draft()["备注"], "");
});

test("an immediately accepted promise cannot focus a removed or disabled button", async () => {
  const f = mount({ immediate: true }); f.fill(); f.submit({ render: false }); await tick();
  assert.deepEqual(f.focused, []); f.render(); assert.equal(f.document.activeElement, f.elements.get("create"));
});

test("a same-root parent projection before completion does not drop or unlock the draft", async () => {
  const f = mount(); f.fill(); f.submit(); f.props.data = { ...f.props.data, tasks: [] }; f.render();
  assert.equal(f.field("任务").disabled, true); assert.equal(f.field("任务").node.props.value, "[UI验收 TEST] 新任务");
  f.finish(); await f.settle(); assert.equal(f.document.activeElement, f.elements.get("create"));
});

test("failed creation keeps draft and its idempotency key for an explicit retry", async () => {
  const f = mount(); f.fill(); const before = f.draft(); f.submit(); f.finish(0, { error: "合成请求失败" }); await f.settle();
  assert.deepEqual(f.draft(), before); assert.equal(f.document.activeElement, f.field("任务")); assert.match(f.text(), /合成请求失败/);
  f.submit(); assert.equal(f.requests.length, 2); assert.equal(f.requests[0].input.clientRequestId, f.requests[1].input.clientRequestId);
});

test("a failed request edited before retry receives a different idempotency key", async () => {
  const f = mount(); f.fill(); f.submit(); f.finish(0, { error: "合成失败" }); await f.settle(); f.change("备注", "新备注"); f.submit();
  assert.notEqual(f.requests[0].input.clientRequestId, f.requests[1].input.clientRequestId);
});

test("an accepted task whose preparation failed closes the form and reports that exact outcome", async () => {
  const f = mount(); f.fill(); f.submit(); f.finish(0, { result: { preparationState: "error", preparationError: "合成模型错误" } }); await f.settle();
  assert.equal(f.elements.get("form").isConnected, false); assert.match(f.text(), /任务已创建；自动准备尚未启动：合成模型错误/); assert.equal(f.document.activeElement, f.elements.get("create"));
});

for (const operation of ["open", "cancel", "submit-success", "submit-failure"]) test(`${operation} never steals a newer focus, even after it returns to body`, async () => {
  const f = mount();
  if (operation === "open") f.open({ render: false });
  else { f.fill(); if (operation === "cancel") f.click("cancel", { render: false }); else f.submit(); }
  f.move(); f.move(f.document.body);
  if (operation.startsWith("submit")) { f.finish(0, operation === "submit-failure" ? { error: "合成失败" } : {}); await f.settle(); } else f.render();
  assert.equal(f.document.activeElement, f.document.body); assert.deepEqual(f.focused, []);
});

for (const interrupted of ["document", "ancestor", "route", "root", "unmount"]) test(`${interrupted} prevents a late submission focus return`, async () => {
  const f = mount(); f.fill(); f.submit();
  if (interrupted === "document") { f.visibility(true); f.visibility(false); }
  else if (interrupted === "ancestor") f.hideAncestor();
  else if (interrupted === "route") f.route("workspace:list:history");
  else if (interrupted === "root") f.scope("/ui-test/two");
  else f.unmount();
  f.finish(); await f.settle(); assert.deepEqual(f.focused, []); assert.equal(f.writesAfterUnmount, 0);
});

test("a new root cannot be unlocked or cleared by the old pending completion", async () => {
  const f = mount(); f.fill(); f.submit(); f.scope("/ui-test/two"); f.fill(); f.submit();
  f.finish(0); await f.settle(); assert.equal(f.field("任务").disabled, true); assert.equal(f.requests.length, 2);
  assert.notEqual(f.requests[0].input.clientRequestId, f.requests[1].input.clientRequestId);
  f.finish(1); await f.settle(); assert.equal(f.document.activeElement, f.elements.get("create"));
});

test("an earlier effect lifetime cannot clear a newer submission after reconnection", async () => {
  const f = mount(); f.fill(); f.submit(); f.reconnectEffects(); f.open(); f.change("任务", "[UI验收 TEST] 新生命周期"); f.submit();
  f.finish(0); await f.settle(); assert.equal(f.field("任务").disabled, true); assert.equal(f.field("任务").node.props.value, "[UI验收 TEST] 新生命周期");
  f.finish(1); await f.settle(); assert.equal(f.document.activeElement, f.elements.get("create"));
});

test("temporary root unavailability never writes, and the same root retains its cancelled draft", () => {
  const f = mount(); f.fill(); const before = f.draft(); f.scope("");
  assert.equal(f.elements.get("create").disabled, true); f.elements.get("create").node.props.onClick(); f.render();
  assert.equal(f.requests.length, 0); f.scope("/ui-test/one"); f.open(); assert.deepEqual(f.draft(), before);
});

test("manual empty due date stays null and managed invalid input never dispatches", () => {
  const f = mount(); f.open(); f.change("任务", "[UI验收 TEST] 无日期"); f.submit();
  assert.equal(f.requests[0].input.dueDate, null);
  const invalid = mount(); invalid.open(); invalid.change("任务", "[UI验收 TEST] 不合法自动准备"); invalid.change("自动准备教学产物", true); invalid.submit();
  assert.equal(invalid.requests.length, 0);
});

test("managed preparation keeps timetable, date, material and deliverable wire fields", () => {
  const f = mount(); f.open(); f.change("任务", "[UI验收 TEST] 课前准备"); f.change("自动准备教学产物", true);
  f.change("上课日期", "2026-11-04"); f.change("TEST材料", true); f.change("产物", "教案\n练习");
  assert.equal(f.draft()["截止日期"], "2026-11-03"); f.submit();
  assert.deepEqual(JSON.parse(JSON.stringify(f.requests[0].input.preparationSource)), { kind: "teaching_before_class", timetableSlotId: "slot-one", lessonDate: "2026-11-04", materialIds: ["material-one"], deliverables: ["教案", "练习"] });
});

test("editing due date manually still opts out of managed automatic due-date updates", () => {
  const f = mount(); f.open(); f.change("任务", "[UI验收 TEST] 手动截止"); f.change("自动准备教学产物", true); f.change("截止日期", "2026-11-10"); f.change("上课日期", "2026-11-04");
  assert.equal(f.draft()["截止日期"], "2026-11-10");
});
