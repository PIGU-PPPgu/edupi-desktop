import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import vm from "node:vm";
import ts from "typescript";
import { createJiti } from "jiti";

const jiti = createJiti(import.meta.url);
const [navigation, rowsModel, classOptions, metadataModel] = await Promise.all([
  jiti.import("../lib/edupi-domain-navigation.ts"), jiti.import("../lib/edupi-material-rows.ts"),
  jiti.import("../lib/edupi-material-class-options.ts"), jiti.import("../lib/edupi-material-metadata-model.ts"),
]);
const compile = file => ts.transpileModule(readFileSync(new URL(file, import.meta.url), "utf8"), {
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.ReactJSX },
}).outputText;
const workspaceCode = compile("./EduPiMaterialsWorkspace.tsx"), metadataCode = compile("./EduPiMaterialMetadataEditor.tsx");
const jsx = (type, props, key) => ({ type, props: props || {}, key });
const placeholder = name => ({ [name]: Object.defineProperty(() => null, "name", { value: name }) });
const tick = () => new Promise(resolve => setImmediate(resolve));
function descendants(node) { return Array.isArray(node) ? node.flatMap(descendants) : node?.props ? [node, ...descendants(node.props.children)] : []; }
const text = node => typeof node === "string" || typeof node === "number" ? String(node) : Array.isArray(node) ? node.map(text).join("") : node?.props ? text(node.props.children) : "";

function mount(code, name, props, modules, globals = {}, commit = () => {}) {
  const slots = [], frames = [];
  let cursor = 0, dirty = false, effects = [], tree;
  const same = (a, b) => a?.length === b?.length && a.every((value, index) => Object.is(value, b[index]));
  const react = {
    useState(initial) { const index = cursor++; if (!(index in slots)) slots[index] = typeof initial === "function" ? initial() : initial; return [slots[index], value => { const next = typeof value === "function" ? value(slots[index]) : value; if (!Object.is(next, slots[index])) { slots[index] = next; dirty = true; } }]; },
    useRef(initial) { const index = cursor++; slots[index] ??= { current: initial }; return slots[index]; },
    useMemo(create, deps) { const index = cursor++; if (!same(slots[index]?.deps, deps)) slots[index] = { deps, value: create() }; return slots[index].value; },
    useEffect(create, deps) { const index = cursor++, prior = slots[index]; if (!same(prior?.deps, deps)) { slots[index] = { deps }; effects.push(() => { prior?.cleanup?.(); slots[index].cleanup = create(); }); } },
  };
  react.useCallback = (fn, deps) => react.useMemo(() => fn, deps);
  const exports = {};
  vm.runInNewContext(code, { exports, Date, AbortController, ...globals, require(module) {
    if (module === "react") return react;
    if (module === "react/jsx-runtime") return { jsx, jsxs: jsx, Fragment: "fragment" };
    assert.ok(modules[module], `Unexpected import ${module}`); return modules[module];
  } });
  const render = () => { let attempts = 0; do { assert.ok(attempts++ < 20); cursor = 0; dirty = false; effects = []; tree = exports[name](props); frames.push(tree); commit(tree); effects.splice(0).forEach(effect => effect()); } while (dirty); };
  const f = { props, frames, render, nodes: () => descendants(tree), find: predicate => descendants(tree).find(predicate), get tree() { return tree; }, async settle() { for (let i = 0; i < 5; i++) { await tick(); if (dirty) render(); } } };
  render(); return f;
}

const material = index => ({ material_id: `synthetic-material-${index}`, title: `合成材料${String(index).padStart(2, "0")}`, kind: "worksheet", subject: "数学", class_id: "703", relative_path: `.edupi/inbox/material-${index}.pdf`, available: true, metadata_revision: 2, metadata_history_count: 0, external_send: false });
function workspace(count) {
  const deleted = [], routed = [];
  const props = { data: { workspace: "/synthetic", tasks: [], workCases: [], timetable: [], teacherMaterials: Array.from({ length: count }, (_, index) => material(index + 1)), continuity: { documents: [] }, dataSources: { materials: { present: true } }, capabilities: { materialIntake: { enabled: false }, entityDelete: { enabled: true, targetKinds: ["material"] } } }, context: null, query: "", selectedObjectId: "materials:practice", stagedMaterials: [], stagingBusy: false, stagingMessage: null,
    onObject(id) { routed.push(id); props.selectedObjectId = id; }, onTask() {}, onUpload() {}, onIntakeMaterial() {}, onRemoveStagedMaterial() {}, onOpenFile() {}, onStartAgent() {}, onEducation(data) { props.data = data; }, async onDeleteEntity(kind, id, label) { deleted.push({ kind, id, label }); props.data = { ...props.data, teacherMaterials: props.data.teacherMaterials.filter(item => item.material_id !== id) }; return true; },
  };
  const modules = { "@/lib/edupi-domain-navigation": navigation, "@/lib/edupi-material-rows": rowsModel, "@/lib/edupi-material-class-options": classOptions,
    "@/lib/desktop-updater": { isTauriDesktop: () => false }, "@/hooks/useModalDismiss": { useModalDismiss: () => ({ current: null }) },
    "@/lib/edupi-operation-history": { intakeOperationHistory: () => [] }, "@/lib/edupi-material-schedule": {}, "@/lib/edupi-docx-chapter-suggestion": {},
    "./EduPiActionIcon": { ...placeholder("EduPiIconButton"), ...placeholder("EduPiPagination") },
  };
  for (const component of ["EduPiMaterialExcerpt", "EduPiOperationHistory", "EduPiMaterialMetadataEditor", "EduPiMaterialScheduleProposal"]) modules[`./${component}`] = placeholder(component);
  const f = mount(workspaceCode, "EduPiMaterialsWorkspace", props, modules);
  return { ...f, get tree() { return f.tree; }, deleted, routed, rows: () => f.nodes().filter(node => node.props.className?.startsWith("edupi-database-button-row")), pager: () => f.find(node => node.type.name === "EduPiPagination"), next() { this.pager().props.onNext(); f.render(); }, async deleteLast() { this.rows().at(-1).props.onClick(); f.render(); f.find(node => node.props.label === "删除材料").props.onClick(); await f.settle(); } };
}

test("deleting the ninth material renders the eight remaining rows and synchronizes its clamped page", async () => {
  const f = workspace(9); f.next(); assert.equal(f.rows().length, 1);
  const start = f.frames.length;
  await f.deleteLast();
  assert.equal(f.rows().length, 8);
  assert.equal(f.pager(), undefined);
  assert.equal(f.find(node => node.props.className === "edupi-database__empty"), undefined);
  assert.ok(f.frames.slice(start).filter(tree => text(tree).includes("8 份材料")).every(tree => descendants(tree).filter(node => node.props.className?.startsWith("edupi-database-button-row")).length === 8), "the first render after data shrink must already use a valid page");
  assert.deepEqual(f.deleted, [{ kind: "material", id: "synthetic-material-9", label: "合成材料09" }]);
  assert.equal(f.props.selectedObjectId, "materials:practice");
  f.props.data = { ...f.props.data, teacherMaterials: [...f.props.data.teacherMaterials, material(10)] }; f.render();
  assert.equal(f.pager().props.page, 0, "growing the list must not resurrect an old out-of-range page");
  assert.equal(f.rows().length, 8);
});

test("deleting the seventeenth material clamps to page two and pager actions use the effective page", async () => {
  const f = workspace(17); f.next(); f.next(); await f.deleteLast();
  assert.equal(f.pager().props.page, 1);
  assert.equal(f.pager().props.pages, 2);
  assert.equal(f.rows().length, 8);
  assert.equal(f.pager().props.nextDisabled, true);
  f.pager().props.onPrevious(); f.render(); assert.equal(f.pager().props.page, 0);
  f.next(); assert.equal(f.pager().props.page, 1);
  f.props.data = { ...f.props.data, teacherMaterials: [...f.props.data.teacherMaterials, material(18)] }; f.render();
  assert.equal(f.pager().props.page, 1);
});

test("valid material pages survive ordinary refreshes while category and query still reset paging", () => {
  const f = workspace(25); f.next(); f.next();
  f.props.data = { ...f.props.data, teacherMaterials: f.props.data.teacherMaterials.map(item => ({ ...item })) }; f.render();
  assert.equal(f.pager().props.page, 2);
  f.props.query = "合成材料01"; f.render(); assert.equal(f.rows().length, 1);
  f.props.query = ""; f.render(); assert.equal(f.pager().props.page, 0);
  f.next(); f.props.selectedObjectId = "materials:all"; f.render(); assert.equal(f.pager().props.page, 0);
});

test("focused material identity still aligns its page and remains selected across a projection refresh", () => {
  const f = workspace(25); f.props.selectedObjectId = navigation.materialObjectId("practice", "synthetic-material-19"); f.render();
  assert.equal(f.pager().props.page, 2);
  assert.equal(f.find(node => node.type.name === "EduPiMaterialMetadataEditor").props.material.material_id, "synthetic-material-19");
  f.props.data = { ...f.props.data, teacherMaterials: f.props.data.teacherMaterials.map(item => ({ ...item })) }; f.render();
  assert.equal(f.pager().props.page, 2);
  assert.equal(f.props.selectedObjectId, navigation.materialObjectId("practice", "synthetic-material-19"));
});

function metadataDom() {
  const calls = [], listeners = new Set(), document = { body: { name: "HTML body" }, documentElement: {}, activeElement: null,
    addEventListener(name, callback) { assert.equal(name, "focusin"); listeners.add(callback); }, removeEventListener(name, callback) { assert.equal(name, "focusin"); listeners.delete(callback); },
  };
  document.activeElement = document.body;
  const root = { isConnected: true, ownerDocument: document, contains: element => element?.isConnected && element.root === root };
  const element = name => ({ name, root, ownerDocument: document, isConnected: true, disabled: false, focus(options) { assert.ok(this.isConnected && !this.disabled); document.activeElement = this; calls.push({ name, options }); for (const callback of listeners) callback({ target: this }); } });
  const trigger = element("edit trigger"), form = { ...element("form"), contains: element => Boolean(element?.isConnected && element.form === form) };
  const inputs = Object.fromEntries(["name", "subject", "save", "cancel"].map(name => [name, { ...element(name), form }]));
  return { root, document, calls, trigger, form, inputs, listeners, move() { const target = { name: "another control", isConnected: true }; document.activeElement = target; for (const callback of listeners) callback({ target }); return target; }, commit(tree) {
    if (tree.props.ref) tree.props.ref.current = root;
    const nodes = descendants(tree), formNode = nodes.find(node => node.type === "form"), nameNode = nodes.find(node => node.type === "input" && node.props.maxLength === 240);
    form.isConnected = Boolean(formNode);
    if (formNode?.props.ref) formNode.props.ref.current = form;
    if (nameNode?.props.ref) nameNode.props.ref.current = formNode ? inputs.name : null;
    for (const input of Object.values(inputs)) input.isConnected = Boolean(formNode);
    inputs.save.disabled = Boolean(nodes.find(node => node.type === "button" && node.props.type === "submit")?.props.disabled);
    inputs.cancel.disabled = Boolean(nodes.find(node => node.type === "button" && text(node) === "取消")?.props.disabled);
    trigger.disabled = Boolean(nodes.find(node => node.props.label === "修改材料信息")?.props.disabled);
    if (document.activeElement?.root === root && (!document.activeElement.isConnected || document.activeElement.disabled)) document.activeElement = document.body;
  } };
}

function metadata() {
  const dom = metadataDom(), requests = [], education = [];
  let finish;
  const props = { material: material(1), classes: ["703", "704"], onStartAgent() {}, onEducation(data) { education.push(data); props.material = data.teacherMaterials[0]; } };
  const f = mount(metadataCode, "EduPiMaterialMetadataEditor", props, { "@/lib/edupi-material-metadata-model": metadataModel, "./EduPiActionIcon": placeholder("EduPiIconButton") }, {
    window: { setTimeout() { return 1; }, clearTimeout() {} }, fetch: async (url, options) => { requests.push({ url, ...options }); return new Promise(resolve => { finish = success => {
      const patch = JSON.parse(options.body).patch;
      const next = { ...props.material, title: patch.title ?? props.material.title, kind: patch.kind ?? props.material.kind, subject: patch.subject ?? props.material.subject, class_id: patch.classId ?? props.material.class_id, metadata_revision: props.material.metadata_revision + 1 };
      resolve({ ok: success, json: async () => success ? { data: { teacherMaterials: [next] }, history: { materialId: next.material_id, revision: next.metadata_revision, historyCount: 1, versions: [] } } : { error: "合成保存失败" } });
    }; }); },
  }, dom.commit);
  return { ...f, get tree() { return f.tree; }, dom, requests, education,
    open(render = true) { dom.trigger.focus({ preventScroll: false }); f.find(node => node.props.label === "修改材料信息").props.onClick({ currentTarget: dom.trigger }); if (render) f.render(); },
    field(label, value) { const field = descendants(f.find(node => node.type === "form")).find(node => node.type === "label" && text(node.props.children[0]) === label); descendants(field).find(node => node.type === "input" || node.type === "select").props.onChange({ target: { value } }); f.render(); },
    values() { return descendants(f.find(node => node.type === "form")).filter(node => node.type === "input" || node.type === "select").map(node => node.props.value); },
    cancel() { f.find(node => node.type === "button" && text(node) === "取消").props.onClick(); f.render(); },
    submit() { dom.inputs.save.focus({ preventScroll: false }); dom.calls.length = 0; const pending = f.find(node => node.type === "form").props.onSubmit({ preventDefault() {}, currentTarget: dom.form }); f.render(); return pending; },
    finish(success = true) { assert.ok(finish); finish(success); },
  };
}

test("metadata reopening preserves every draft field without refocusing while typing", () => {
  const f = metadata(); f.open();
  f.field("名称", "未保存合成名称"); f.field("类型", "assessment"); f.field("学科", "科学"); f.field("班级", "704");
  f.dom.document.activeElement = f.dom.inputs.subject; f.dom.calls.length = 0;
  f.field("学科", "合成科学");
  f.props.material = { ...f.props.material }; f.render();
  assert.equal(f.dom.document.activeElement, f.dom.inputs.subject);
  assert.deepEqual(f.dom.calls, []);
  f.open();
  assert.deepEqual(f.values(), ["未保存合成名称", "assessment", "合成科学", "704"]);
  assert.equal(f.dom.document.activeElement, f.dom.inputs.name);
});

test("metadata first open focuses name and cancellation returns to its entry without a write", () => {
  const f = metadata(); f.open(); assert.equal(f.dom.document.activeElement, f.dom.inputs.name);
  f.dom.inputs.cancel.focus({ preventScroll: false }); f.cancel();
  assert.equal(f.dom.document.activeElement, f.dom.trigger);
  assert.equal(f.find(node => node.type === "form"), undefined);
  assert.deepEqual(f.requests, []);
});

test("a new metadata editor does not override a focus moved before its DOM commit", () => {
  const f = metadata(); f.open(false); const target = f.dom.move(); f.render();
  assert.equal(f.dom.document.activeElement, target);
});

test("metadata cancel preserves a newer focus outside its form", () => {
  const f = metadata(); f.open(); const target = f.dom.move(); f.cancel();
  assert.equal(f.dom.document.activeElement, target);
  assert.equal(f.requests.length, 0);
});

test("metadata save keeps its revision and normalized patch then returns to the enabled entry", async () => {
  const f = metadata(); f.open(); f.field("名称", "  合成新名称  "); f.field("类型", "lesson_note"); f.field("学科", "科学"); f.field("班级", "704");
  const pending = f.submit(); f.finish(); await pending; await f.settle();
  assert.equal(f.requests.length, 1);
  assert.equal(f.requests[0].url, "/api/edupi/materials/synthetic-material-1/metadata"); assert.equal(f.requests[0].method, "PUT");
  assert.deepEqual(JSON.parse(f.requests[0].body), { expectedRevision: 2, patch: { title: "合成新名称", kind: "lesson_note", subject: "科学", classId: "704" } });
  assert.equal(f.find(node => node.type === "form"), undefined);
  assert.equal(f.dom.document.activeElement, f.dom.trigger);
  assert.equal(f.dom.trigger.disabled, false);
  assert.deepEqual(f.dom.calls.map(call => call.name), ["edit trigger"]);
  assert.equal(f.education.length, 1);
  assert.equal(f.dom.listeners.size, 0);
});

test("metadata save completion respects focus moved elsewhere during the request", async () => {
  const f = metadata(); f.open(); f.field("名称", "合成新名称");
  const pending = f.submit(); f.dom.move(); f.dom.document.activeElement = f.dom.document.body;
  f.finish(); await pending; await f.settle();
  assert.deepEqual(f.dom.calls, []);
  assert.equal(f.dom.document.activeElement, f.dom.document.body);
  assert.equal(f.dom.listeners.size, 0);
});

test("failed metadata save retains the draft and does not announce success or close editing", async () => {
  const f = metadata(); f.open(); f.field("名称", "失败保留名称"); f.field("学科", "失败保留学科"); f.field("班级", "704");
  const pending = f.submit(); f.finish(false); await pending; await f.settle();
  assert.ok(f.find(node => node.type === "form"));
  assert.deepEqual(f.values(), ["失败保留名称", "worksheet", "失败保留学科", "704"]);
  assert.equal(text(f.find(node => node.props.role === "alert")), "合成保存失败");
  assert.equal(f.education.length, 0);
  assert.equal(f.dom.listeners.size, 0);
});

test("an authoritative metadata revision change invalidates the editor without submitting or moving focus", () => {
  const f = metadata(); f.open(); f.field("名称", "旧版本草稿"); f.dom.calls.length = 0;
  f.props.material = { ...f.props.material, title: "其他入口新名称", metadata_revision: 3 }; f.render();
  assert.equal(f.find(node => node.type === "form"), undefined);
  assert.equal(text(f.find(node => node.props.role === "alert")), "材料信息已在其他入口更新，请重新打开后修改");
  assert.deepEqual(f.requests, []); assert.deepEqual(f.dom.calls, []);
  f.open(); assert.equal(f.values()[0], "其他入口新名称");
});

test("switching material identity aborts a pending metadata save and ignores its late response and focus", async () => {
  const f = metadata(); f.open(); f.field("名称", "旧材料草稿"); const pending = f.submit();
  f.props.material = material(2); f.render(); assert.equal(f.requests[0].signal.aborted, true);
  const target = f.dom.move(); f.finish(); await pending; await f.settle();
  assert.equal(f.education.length, 0); assert.equal(f.find(node => node.type === "form"), undefined);
  assert.equal(f.dom.document.activeElement, target); assert.deepEqual(f.dom.calls, []);
  assert.equal(f.dom.listeners.size, 0);
});
