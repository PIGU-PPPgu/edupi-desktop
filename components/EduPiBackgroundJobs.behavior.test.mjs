import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import vm from "node:vm";
import ts from "typescript";

const code = ts.transpileModule(readFileSync(new URL("./EduPiBackgroundJobs.tsx", import.meta.url), "utf8"), {
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.ReactJSX },
}).outputText;
const jsx = (type, props, key) => ({ type, props: props || {}, key });
const nodes = value => Array.isArray(value) ? value.flatMap(nodes) : value?.props ? [value, ...nodes(value.props.children)] : [];
const text = value => typeof value === "string" || typeof value === "number" ? String(value) : Array.isArray(value) ? value.map(text).join("") : value?.props ? text(value.props.children) : "";
const tick = () => new Promise(resolve => setImmediate(resolve));
const job = (id = "job-one", status = "queued") => ({ job_id: id, title: `[UI验收 TEST] ${id}`, status });

function mount(initialJobs = [], { data = { workspace: "/test/one" } } = {}) {
  const slots = [], effects = [], requests = [], focused = [], listeners = new Set(), elements = new Map(), timers = new Map();
  let cursor = 0, dirty = false, tree, mounted = true, writesAfterUnmount = 0, hidden = false, timerId = 0, previousRefs = [];
  const document = { body: {}, documentElement: {}, activeElement: null, hidden: false,
    addEventListener(name, fn) { assert.equal(name, "focusin"); listeners.add(fn); },
    removeEventListener(name, fn) { assert.equal(name, "focusin"); listeners.delete(fn); },
  };
  document.activeElement = document.body;
  const move = target => { document.activeElement = target; for (const fn of [...listeners]) fn({ target }); return target; };
  const root = { ownerDocument: document, isConnected: true,
    contains: target => target?.isConnected && target.root === root,
    querySelectorAll(selector) { assert.equal(selector, "[data-background-job-action]"); return [...elements.values()].filter(item => item.isConnected && item.dataset.backgroundJobAction); },
  };
  const element = key => ({ key, root, ownerDocument: document, isConnected: true, disabled: false, dataset: {},
    closest(selector) { assert.equal(selector, "details:not([open]), [hidden], [inert]"); return hidden ? root : null; },
    focus(options) { assert.ok(this.isConnected && !this.disabled, `${key} must be available`); assert.equal(options?.preventScroll, false); focused.push(key); move(this); },
  });
  const same = (a, b) => a?.length === b?.length && a.every((value, i) => Object.is(value, b[i]));
  const react = {
    useState(initial) { const i = cursor++; if (!(i in slots)) slots[i] = typeof initial === "function" ? initial() : initial; return [slots[i], value => { if (!mounted) writesAfterUnmount++; const next = typeof value === "function" ? value(slots[i]) : value; if (!Object.is(next, slots[i])) { slots[i] = next; dirty = true; } }]; },
    useRef(initial) { const i = cursor++; slots[i] ??= { current: initial }; return slots[i]; },
    useCallback(fn, deps) { const i = cursor++; if (!same(slots[i]?.deps, deps)) slots[i] = { deps, fn }; return slots[i].fn; },
    useEffect(create, deps) { const i = cursor++, old = slots[i]; if (!same(old?.deps, deps)) { slots[i] = { deps }; effects.push(() => { old?.cleanup?.(); slots[i].cleanup = create(); }); } },
  };
  const modules = { react, "react/jsx-runtime": { jsx, jsxs: jsx },
    "@/lib/edupi-material-rows": { buildMaterialRows: () => [{ id: "material-one", title: "TEST教材", filePath: "/test/material.pdf" }] },
    "@/lib/desktop-native": { openPathNative: async () => {} }, "@/lib/desktop-updater": { isTauriDesktop: () => true },
  };
  const exported = {};
  vm.runInNewContext(code, { exports: exported, document, Error,
    window: { setInterval(fn) { timers.set(++timerId, fn); return timerId; }, clearInterval(id) { timers.delete(id); } },
    fetch(url, options = {}) {
      assert.equal(url, "/api/edupi/jobs");
      const item = { method: options.method || "GET", body: options.body ? JSON.parse(options.body) : null, done: false };
      item.promise = new Promise((resolve, reject) => { item.resolve = resolve; item.reject = reject; });
      requests.push(item); return item.promise;
    },
    require(name) { assert.ok(modules[name], name); return modules[name]; },
  });
  const props = { data, onModels() {}, onMaterials() {} };
  const commit = () => {
    for (const ref of previousRefs) ref.current = null;
    previousRefs = [];
    const seen = new Set();
    const walk = (node, disabled = false, label = "") => {
      if (Array.isArray(node)) { node.forEach(child => walk(child, disabled, label)); return; }
      if (!node?.props) return;
      const p = node.props;
      disabled ||= node.type === "fieldset" && Boolean(p.disabled);
      if (node.type === "label") label = text(node).replace(/TEST教材.*$/, "");
      const key = node.type === "section" ? "root" : node.type === "h2" ? "heading" : ["input", "textarea", "select"].includes(node.type) ? `field:${label.split(/整理文档|不指定材料/)[0]}`
        : node.type === "button" ? p["data-background-job-action"] ? `job:${p["data-background-job-action"]}` : text(node) === "新建任务" ? "create" : p.type === "submit" ? "submit" : text(node) === "取消" ? "cancel" : `button:${text(node)}` : null;
      if (key) {
        seen.add(key);
        if (!elements.get(key)?.isConnected) elements.set(key, key === "root" ? root : element(key));
        const target = elements.get(key);
        target.isConnected = root.isConnected; target.disabled = disabled || Boolean(p.disabled); target.node = node;
        target.dataset = { backgroundJobAction: p["data-background-job-action"] };
        if (p.ref) { p.ref.current = target; previousRefs.push(p.ref); }
      }
      walk(p.children, disabled, label);
    };
    walk(tree);
    for (const [key, target] of elements) if (!seen.has(key)) target.isConnected = false;
    const active = document.activeElement;
    if (active?.root === root && (!active.isConnected || active.disabled)) document.activeElement = document.body;
  };
  const f = { props, document, root, elements, requests, focused, listeners,
    render() { let attempts = 0; do { assert.ok(attempts++ < 30); cursor = 0; dirty = false; tree = exported.EduPiBackgroundJobs(props); commit(); effects.splice(0).forEach(fn => fn()); } while (dirty); },
    text() { return text(tree); },
    form() { const form = nodes(tree).find(node => node.type === "form"); assert.ok(form, "form exists"); return form; },
    click(key, { focus = true, render = true } = {}) { const target = elements.get(key); assert.ok(target?.isConnected && !target.disabled, `${key} enabled`); if (focus) move(target); focused.length = 0; target.node.props.onClick(); if (render) f.render(); },
    change(label, value) { const target = elements.get(`field:${label}`); assert.ok(target?.isConnected && !target.disabled, `${label} enabled`); move(target); target.node.props.onChange({ target: { value } }); f.render(); },
    draft() { return Object.fromEntries([...elements].filter(([key, target]) => key.startsWith("field:") && target.isConnected).map(([key, target]) => [key.slice(6), target.node.props.value])); },
    fill() { f.click("create"); f.change("任务名称", "[UI验收 TEST] 文档任务"); f.change("类型", "ppt"); f.change("材料", "/test/material.pdf"); f.change("处理要求", "只处理合成材料。"); focused.length = 0; },
    submit({ render = true } = {}) { const form = f.form(); const submit = elements.get("submit"); if (!submit.disabled) move(submit); focused.length = 0; form.props.onSubmit({ preventDefault() {} }); if (render) f.render(); },
    escape({ composing = false, render = true } = {}) { const event = { key: "Escape", nativeEvent: { isComposing: composing }, prevented: false, preventDefault() { this.prevented = true; }, stopPropagation() {} }; f.form().props.onKeyDown?.(event); if (render) f.render(); return event; },
    pending(method) { return requests.filter(item => !item.done && item.method === method); },
    finish(method, value, { error, status = 200, index = 0 } = {}) { const item = f.pending(method)[index]; assert.ok(item, `${method} pending`); item.done = true; if (error) item.reject(new Error(error)); else item.resolve({ ok: status >= 200 && status < 300, async json() { return method === "GET" ? { projection: { jobs: value || [] } } : value || {}; } }); },
    async settle() { for (let i = 0; i < 5; i++) { await tick(); if (dirty && mounted) f.render(); } },
    async ready() { f.finish("GET", initialJobs); await f.settle(); focused.length = 0; },
    poll() { [...timers.values()].forEach(fn => fn()); },
    move(target = { key: "other setting", isConnected: true }) { return move(target); },
    hide() { hidden = true; },
    scope(workspace = "/test/two") { props.data = { workspace }; f.render(); },
    unmount() { mounted = false; root.isConnected = false; for (const slot of slots) slot?.cleanup?.(); },
    get writesAfterUnmount() { return writesAfterUnmount; },
  };
  f.render(); return f;
}

test("new task focuses its name and exposes one primary action plus explicit cancel", async () => {
  const f = mount(); await f.ready(); f.click("create", { focus: false });
  assert.equal(f.document.activeElement, f.elements.get("field:任务名称"));
  assert.equal(f.elements.get("create").isConnected, false); assert.ok(f.elements.get("cancel").isConnected);
  assert.equal(nodes(f.form()).filter(node => node.type === "button" && node.props.className?.includes("is-primary")).length, 1);
});

test("initial delayed education loading disables creation until its workspace is known", async () => {
  const f = mount([], { data: null }); await f.ready();
  assert.equal(f.elements.get("create").disabled, true);
  assert.equal(f.elements.get("field:任务名称")?.isConnected, undefined);
  f.scope("/test/one"); assert.equal(f.elements.get("create").disabled, false);
  f.finish("GET", []); await f.settle(); f.fill(); const before = f.draft();
  f.scope("/test/one"); assert.deepEqual(f.draft(), before);
  assert.equal(f.requests.filter(item => item.method === "POST").length, 0);
});

test("the current create handler also refuses a draft while workspace is unknown", async () => {
  const f = mount([], { data: null }); await f.ready();
  f.elements.get("create").node.props.onClick(); f.render();
  assert.equal(f.elements.get("field:任务名称")?.isConnected, undefined);
  assert.deepEqual(f.focused, []); assert.equal(f.pending("POST").length, 0);
});

for (const status of ["queued", "running", "canceled", "failed"]) test(`${status} row mutation stays unavailable until education workspace arrives`, async () => {
  const item = job("job-one", status);
  const f = mount([item], { data: null }); await f.ready();
  assert.equal(f.elements.get("job:job-one").disabled, true);
  f.elements.get("job:job-one").node.props.onClick(); await f.settle();
  assert.equal(f.pending("POST").length, 0);
  f.scope("/test/one"); f.finish("GET", [item]); await f.settle();
  assert.equal(f.elements.get("job:job-one").disabled, false);
  f.click("job:job-one");
  assert.equal(f.pending("POST").length, 1);
  assert.equal(f.pending("POST")[0].body.action, status === "queued" || status === "running" ? "cancel" : "retry");
});

for (const error of ["model_error", "source_unavailable"]) test(`${error} recovery navigation stays available without an education workspace`, async () => {
  const f = mount([{ ...job("job-one", "failed"), error }], { data: null }); await f.ready();
  assert.equal(f.elements.get("job:job-one").disabled, false);
  f.click("job:job-one");
  assert.equal(f.pending("POST").length, 0);
});

test("a known directory change still discards the old directory draft and material selection", async () => {
  const f = mount(); await f.ready(); f.fill(); f.scope("/test/two");
  assert.equal(f.elements.get("field:任务名称").isConnected, false);
  f.finish("GET", []); await f.settle(); f.click("create");
  assert.deepEqual(f.draft(), { 任务名称: "", 类型: "document", 材料: "", 处理要求: "" });
  assert.equal(f.pending("POST").length, 0);
});

for (const destination of ["/test/one", "/test/two"]) test(`a transient unavailable snapshot retains draft ownership before ${destination} returns`, async () => {
  const f = mount(); await f.ready(); f.fill(); const before = f.draft();
  f.props.data = null; f.render();
  assert.equal(f.elements.get("create").disabled, true);
  f.scope(destination); f.finish("GET", [], { index: 1 }); await f.settle();
  f.finish("GET", []); await f.settle(); f.click("create");
  assert.deepEqual(f.draft(), destination === "/test/one" ? before : { 任务名称: "", 类型: "document", 材料: "", 处理要求: "" });
  assert.equal(f.pending("POST").length, 0);
});

for (const cancel of ["button", "Escape"]) test(`${cancel} closes the draft and returns to the available create entry`, async () => {
  const f = mount(); await f.ready(); f.fill(); const before = f.draft();
  if (cancel === "button") f.click("cancel"); else assert.equal(f.escape().prevented, true);
  assert.equal(f.document.activeElement, f.elements.get("create")); assert.equal(f.elements.get("field:任务名称").isConnected, false);
  assert.equal(f.requests.filter(item => item.method === "POST").length, 0); f.click("create"); assert.deepEqual(f.draft(), before);
});

test("Escape during composition leaves the current draft open", async () => {
  const f = mount(); await f.ready(); f.fill(); assert.equal(f.escape({ composing: true }).prevented, false); assert.ok(f.elements.get("field:任务名称").isConnected);
});

test("two same-tick submits send one immutable snapshot and lock every form control", async () => {
  const f = mount(); await f.ready(); f.fill(); f.submit({ render: false }); f.submit({ render: false }); f.render();
  assert.equal(f.pending("POST").length, 1);
  assert.deepEqual(f.pending("POST")[0].body, { action: "enqueue", title: "[UI验收 TEST] 文档任务", kind: "ppt", instructions: "只处理合成材料。\n材料文件：/test/material.pdf" });
  for (const key of ["field:任务名称", "field:类型", "field:材料", "field:处理要求", "submit", "cancel"]) assert.equal(f.elements.get(key).disabled, true, key);
  assert.equal(f.escape().prevented, false); assert.equal(f.pending("POST").length, 1);
});

test("accepted enqueue waits for its actual reload and enabled DOM before returning focus", async () => {
  const f = mount(); await f.ready(); f.fill(); f.submit(); f.finish("POST"); await f.settle();
  assert.equal(f.pending("GET").length, 1); assert.equal(f.elements.get("create").disabled, true); assert.deepEqual(f.focused, []);
  f.finish("GET", [job()]); await f.settle();
  assert.match(f.text(), /\[UI验收 TEST\] job-one/); assert.equal(f.document.activeElement, f.elements.get("create")); assert.equal(f.listeners.size, 0);
  f.click("create"); assert.deepEqual(f.draft(), { 任务名称: "", 类型: "document", 材料: "", 处理要求: "" });
});

test("a fast enqueue and reload still focus only after their final DOM commit", async () => {
  const f = mount(); await f.ready(); f.fill(); f.submit({ render: false }); f.finish("POST"); await tick();
  f.finish("GET", [job()]); await tick(); await tick(); assert.deepEqual(f.focused, []); f.render();
  assert.equal(f.document.activeElement, f.elements.get("create")); assert.equal(f.listeners.size, 0);
});

for (const failure of ["HTTP", "network"]) test(`${failure} submit failure retains the full draft and returns to its name`, async () => {
  const f = mount(); await f.ready(); f.fill(); const before = f.draft(); f.submit();
  f.finish("POST", { error: "合成提交失败" }, failure === "HTTP" ? { status: 503 } : { error: "合成提交失败" }); await f.settle();
  assert.deepEqual(f.draft(), before); assert.match(f.text(), /合成提交失败/); assert.equal(f.document.activeElement, f.elements.get("field:任务名称")); assert.equal(f.elements.get("cancel").disabled, false);
});

test("a failed post-enqueue read closes the accepted draft without focusing a removed input", async () => {
  const f = mount(); await f.ready(); f.fill(); f.submit(); f.finish("POST"); await f.settle(); f.finish("GET", [], { status: 503 }); await f.settle();
  assert.equal(f.elements.get("field:任务名称").isConnected, false); assert.match(f.text(), /后台任务暂不可用/); assert.equal(f.document.activeElement, f.elements.get("create"));
});

for (const phase of ["submit", "reload"]) test(`moving to another control during ${phase} cancels any deferred focus return`, async () => {
  const f = mount(); await f.ready(); f.fill(); f.submit();
  if (phase === "reload") { f.finish("POST"); await f.settle(); }
  f.move(); f.move(f.document.body);
  if (phase === "submit") { f.finish("POST"); await f.settle(); }
  f.finish("GET", [job()]); await f.settle(); assert.equal(f.document.activeElement, f.document.body); assert.deepEqual(f.focused, []); assert.equal(f.listeners.size, 0);
});

test("opening or cancelling does not steal focus after a move before commit", async () => {
  const f = mount(); await f.ready(); f.click("create", { render: false }); const other = f.move(); f.render();
  assert.equal(f.document.activeElement, other); f.click("cancel", { render: false }); f.move(other); f.render(); assert.equal(f.document.activeElement, other);
});

test("a parent disclosure hiding the panel prevents a deferred focus return", async () => {
  const f = mount(); await f.ready(); f.fill(); f.submit(); f.hide(); f.finish("POST"); await f.settle(); f.finish("GET", [job()]); await f.settle(); assert.deepEqual(f.focused, []);
});

test("polling pauses during the mutation and its follow-up read", async () => {
  const f = mount(); await f.ready(); f.fill(); f.submit(); f.poll(); assert.equal(f.pending("GET").length, 0);
  f.finish("POST"); await f.settle(); f.poll(); assert.equal(f.pending("GET").length, 1);
  f.finish("GET", [job()]); await f.settle(); f.poll(); assert.equal(f.pending("GET").length, 1);
});

test("a poll predating a mutation cannot overwrite its result or show an old failure", async () => {
  for (const failed of [false, true]) {
    const f = mount(); await f.ready(); f.poll(); f.fill(); f.submit();
    f.finish("GET", [job("old")], failed ? { status: 503 } : {}); await f.settle(); assert.doesNotMatch(f.text(), /\[UI验收 TEST\] old|后台任务暂不可用/);
    f.finish("POST"); await f.settle(); f.finish("GET", [job("current")]); await f.settle(); assert.match(f.text(), /\[UI验收 TEST\] current/); assert.doesNotMatch(f.text(), /\[UI验收 TEST\] old|后台任务暂不可用/);
  }
});

test("out-of-order polls keep the newest projection and ignore stale errors", async () => {
  const f = mount(); await f.ready(); f.poll(); f.poll(); f.finish("GET", [job("new")], { index: 1 }); await f.settle(); f.finish("GET", [], { status: 503 }); await f.settle();
  assert.match(f.text(), /\[UI验收 TEST\] new/); assert.doesNotMatch(f.text(), /后台任务暂不可用/);
});

test("a row mutation keeps an unrelated open creation draft and returns to the same job", async () => {
  const f = mount([job()]); await f.ready(); f.fill(); const before = f.draft(); f.click("job:job-one");
  f.finish("POST"); await f.settle(); f.finish("GET", [job("job-one", "canceled")]); await f.settle();
  assert.deepEqual(f.draft(), before); assert.equal(f.document.activeElement, f.elements.get("job:job-one")); assert.match(f.text(), /重新开始/);
});

test("row mutation failure enables the same action and retains the draft", async () => {
  const f = mount([job()]); await f.ready(); f.fill(); const before = f.draft(); f.click("job:job-one"); f.finish("POST", { error: "合成取消失败" }, { status: 503 }); await f.settle();
  assert.deepEqual(f.draft(), before); assert.equal(f.document.activeElement, f.elements.get("job:job-one")); assert.match(f.text(), /合成取消失败/);
});

test("a removed job row falls back to the connected heading after its actual read", async () => {
  const f = mount([job()]); await f.ready(); f.click("job:job-one"); f.finish("POST"); await f.settle(); f.finish("GET", []); await f.settle();
  assert.equal(f.document.activeElement, f.elements.get("heading")); assert.deepEqual(f.focused, ["heading"]);
});

test("a directory change ignores old poll and action completions", async () => {
  const f = mount(); await f.ready(); f.poll(); f.fill(); f.submit(); f.scope(); f.finish("GET", [job("old-directory")]); f.finish("POST"); await f.settle();
  assert.equal(f.pending("GET").length, 1); assert.doesNotMatch(f.text(), /old-directory/); assert.deepEqual(f.focused, []); assert.equal(f.elements.get("create").disabled, false);
  f.finish("GET", [job("new-directory")]); await f.settle(); assert.match(f.text(), /new-directory/); assert.equal(f.listeners.size, 0);
});

for (const pending of ["POST", "GET"]) test(`unmount during ${pending} suppresses updates, follow-up reads, and focus`, async () => {
  const f = mount(); await f.ready(); f.fill(); f.submit();
  if (pending === "GET") { f.finish("POST"); await f.settle(); }
  f.unmount(); f.finish(pending, pending === "GET" ? [job()] : {}); await f.settle();
  assert.equal(f.writesAfterUnmount, 0); assert.deepEqual(f.focused, []); assert.equal(f.listeners.size, 0); assert.equal(f.pending("GET").length, 0);
});
