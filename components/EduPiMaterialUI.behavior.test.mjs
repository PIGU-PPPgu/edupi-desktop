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
  return { root, document, calls, trigger, form, inputs, listeners, element, move() { const target = { name: "another control", isConnected: true }; document.activeElement = target; for (const callback of listeners) callback({ target }); return target; }, commit(tree) {
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
  const f = mount(metadataCode, "EduPiMaterialMetadataEditor", props, { "@/lib/edupi-material-metadata-model": metadataModel, "@/lib/edupi-material-class-options": classOptions, "./EduPiActionIcon": placeholder("EduPiIconButton") }, {
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

test("metadata class labels remain separate from canonical values and the existing CAS payload", async () => {
  const f = metadata();
  f.props.material = { ...f.props.material, class_id: "class-one" };
  f.props.classes = ["class-one", "class-two", "class-unknown"];
  f.props.classLabels = classOptions.materialClassOptions([
    { class_id: "class-one", class_name: "测试一班" }, { class_id: "class-two", class_name: "测试二班" },
  ], []);
  f.render(); f.open();
  const field = descendants(f.find(node => node.type === "form")).find(node => node.type === "label" && text(node.props.children[0]) === "班级");
  const options = descendants(field).filter(node => node.type === "option").map(node => ({ value: node.props.value, label: text(node) }));
  assert.deepEqual(options, [{ value: "", label: "未设置" }, { value: "class-one", label: "测试一班" }, { value: "class-two", label: "测试二班" }, { value: "class-unknown", label: "class-unknown" }]);
  f.field("班级", "class-two"); const pending = f.submit();
  assert.deepEqual(JSON.parse(f.requests[0].body), { expectedRevision: 2, patch: { classId: "class-two" } });
  f.finish(); await pending; await f.settle();
  assert.equal(f.props.material.class_id, "class-two");
});

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

function metadataRestore({ deferProjection = false } = {}) {
  const dom = metadataDom(), requests = [], education = [], buttons = new Map();
  const historyRoot = dom.element("history"), summary = dom.element("history summary");
  const version = { versionId: "synthetic-v2:with'quote\"", materialId: material(1).material_id, revision: 2,
    beforeValues: { title: "旧合成材料", kind: "other", subject: "科学", classId: null },
    afterValues: metadataModel.materialMetadataValues(material(1)), changedFields: ["title", "kind", "subject", "class_id"], changedAt: "2026-10-27T00:00:00.000Z", sourceKind: "teacher_edit" };
  let history = { materialId: version.materialId, revision: 2, historyCount: 1, versions: [version] }, finish, pendingProjection;
  let currentMaterial = { ...material(1), metadata_history_count: 1 };
  const props = { material: currentMaterial, classes: ["703"], onStartAgent() {}, onEducation(data) { education.push(data); if (deferProjection) pendingProjection = data.teacherMaterials[0]; else props.material = data.teacherMaterials[0]; } };
  const f = mount(metadataCode, "EduPiMaterialMetadataEditor", props, { "@/lib/edupi-material-metadata-model": metadataModel, "@/lib/edupi-material-class-options": classOptions, "./EduPiActionIcon": placeholder("EduPiIconButton") }, {
    window: { setTimeout() { return 1; }, clearTimeout() {} }, fetch: async (url, options) => {
      requests.push({ url, ...options });
      if (!options.method) return { ok: true, json: async () => ({ data: { teacherMaterials: [currentMaterial] }, history }) };
      return new Promise(resolve => { finish = (success = true, omitOriginalVersion = false) => {
        const body = JSON.parse(options.body), desired = body.versionSide === "before" ? version.beforeValues : version.afterValues;
        const next = { ...currentMaterial, title: desired.title, kind: desired.kind, subject: desired.subject, class_id: desired.classId, metadata_revision: currentMaterial.metadata_revision + 1, metadata_history_count: history.historyCount + 1 };
        const restored = { ...version, versionId: "synthetic-restore", revision: next.metadata_revision, beforeValues: metadataModel.materialMetadataValues(currentMaterial), afterValues: desired, sourceKind: "restore" };
        if (success) { currentMaterial = next; history = { ...history, revision: next.metadata_revision, historyCount: next.metadata_history_count, versions: [...(omitOriginalVersion ? [] : history.versions), restored] }; }
        resolve({ ok: success, json: async () => success ? { data: { teacherMaterials: [next] }, history } : { error: "合成恢复失败" } });
      }; });
    },
  }, tree => {
    dom.commit(tree);
    const historyNode = descendants(tree).find(node => node.type.name === "History");
    const rendered = historyNode.type(historyNode.props), nodes = descendants(rendered);
    rendered.props.ref.current = historyRoot;
    nodes.find(node => node.type === "summary").props.ref.current = summary;
    for (const button of buttons.values()) button.isConnected = false;
    const entries = nodes.filter(node => node.type === "li" && node.props["data-material-metadata-version"]).map(node => {
      const versionId = node.props["data-material-metadata-version"], entry = dom.element("version row");
      entry.dataset = { materialMetadataVersion: versionId };
      const actions = descendants(node).filter(node => node.type === "button" && node.props["data-material-metadata-side"]).map(node => {
        const side = node.props["data-material-metadata-side"], key = `${versionId}:${side}`;
        if (!buttons.has(key)) buttons.set(key, dom.element(`${versionId} ${side}`));
        const button = buttons.get(key); button.isConnected = true; button.disabled = Boolean(node.props.disabled); return button;
      });
      entry.querySelectorAll = selector => { assert.equal(selector, "[data-material-metadata-side]"); return actions; };
      return entry;
    });
    historyRoot.querySelectorAll = selector => { assert.equal(selector, "[data-material-metadata-version]"); return entries; };
    if (dom.document.activeElement?.root === dom.root && (!dom.document.activeElement.isConnected || dom.document.activeElement.disabled)) dom.document.activeElement = dom.document.body;
  });
  const historyNode = () => f.find(node => node.type.name === "History");
  return { ...f, dom, requests, education, summary, version, buttons,
    button(side) { return buttons.get(`${version.versionId}:${side}`); },
    async openHistory() { historyNode().props.onToggle(true); f.render(); await f.settle(); education.length = 0; },
    restore(side, { focus = true, render = true } = {}) { const trigger = this.button(side); assert.ok(trigger?.isConnected && !trigger.disabled); if (focus) trigger.focus({ preventScroll: false }); dom.calls.length = 0; historyNode().props.onRestore(version, side, trigger); if (render) f.render(); },
    closeHistory() { historyNode().props.onToggle(false); f.render(); },
    historyOpen() { return historyNode().props.open; },
    commitProjection() { assert.ok(pendingProjection); props.material = pendingProjection; pendingProjection = null; f.render(); },
    finish(success = true, omitOriginalVersion = false) { assert.ok(finish); finish(success, omitOriginalVersion); },
  };
}

test("material restoration replaces the current side and focuses the other side of that exact version", async () => {
  const f = metadataRestore(); await f.openHistory(); f.restore("before");
  assert.equal(f.dom.document.activeElement, f.dom.document.body, "disabling the pressed button reproduces native focus loss");
  const request = f.requests.find(request => request.method === "POST");
  assert.equal(request.url, "/api/edupi/materials/synthetic-material-1/metadata/versions");
  assert.deepEqual(JSON.parse(request.body), { versionId: f.version.versionId, versionSide: "before", expectedRevision: 2 });
  f.finish(); await f.settle();
  assert.equal(f.button("before").isConnected, false);
  assert.equal(f.dom.document.activeElement, f.button("after"));
  assert.deepEqual(f.dom.calls.map(call => call.name), [`${f.version.versionId} after`]);
  assert.equal(f.education.length, 1);
  assert.equal(f.props.material.class_id, null);
  assert.equal(f.props.material.metadata_revision, 3);
  assert.equal(f.dom.listeners.size, 0);
});

test("metadata history displays known class labels while keeping both restore identities intact", async () => {
  const f = metadataRestore();
  f.props.classLabels = [{ value: "class-one", label: "测试一班" }, { value: "class-two", label: "测试二班" }];
  f.version.beforeValues.classId = "class-one"; f.version.afterValues.classId = "class-two";
  await f.openHistory();
  const history = f.find(node => node.type.name === "History");
  const labels = descendants(history.type(history.props)).filter(node => node.type === "dd").map(text);
  assert.ok(labels.includes("测试一班")); assert.ok(labels.includes("测试二班"));
  assert.equal(labels.includes("class-one") || labels.includes("class-two"), false);
  assert.equal(f.version.beforeValues.classId, "class-one"); assert.equal(f.version.afterValues.classId, "class-two");
  assert.ok(f.requests.every(request => !request.method), "displaying names does not perform a restore");
});

test("failed material restoration keeps the version list and returns to the enabled retry button", async () => {
  const f = metadataRestore(); await f.openHistory(); const before = { ...f.props.material }; f.restore("before");
  f.finish(false); await f.settle();
  assert.equal(f.dom.document.activeElement, f.button("before"));
  assert.equal(f.button("before").disabled, false);
  assert.equal(f.historyOpen(), true);
  assert.deepEqual(f.props.material, before);
  assert.equal(text(f.find(node => node.props.role === "alert")), "合成恢复失败");
  assert.equal(f.education.length, 0);
  assert.equal(f.dom.listeners.size, 0);
});

test("a restore click which leaves focus on history still returns to the same version", async () => {
  const f = metadataRestore(); await f.openHistory(); f.summary.focus({ preventScroll: false });
  f.restore("before", { focus: false }); assert.equal(f.dom.document.activeElement, f.summary);
  f.finish(); await f.settle();
  assert.equal(f.dom.document.activeElement, f.button("after"));
  assert.equal(f.dom.listeners.size, 0);
});

test("restoration focus also commits when a fast response batches away the busy render", async () => {
  const f = metadataRestore(); await f.openHistory(); f.restore("before", { render: false });
  f.finish(); await f.settle();
  assert.equal(f.dom.document.activeElement, f.button("after"));
  assert.equal(f.props.material.metadata_revision, 3);
  assert.equal(f.dom.listeners.size, 0);
});

test("material restoration waits through the parent's stale selected projection before returning to its version", async () => {
  const f = metadataRestore({ deferProjection: true }); await f.openHistory(); f.restore("before"); f.finish(); await f.settle();
  assert.equal(f.props.material.metadata_revision, 2, "the first parent commit still supplies the old selected material");
  assert.equal(Boolean(f.button("after")?.isConnected), false, "new history and old material intentionally hide version actions");
  assert.deepEqual(f.dom.calls, [], "the intermediate empty history is not a missing-version fallback");
  assert.equal(f.dom.listeners.size, 1, "focus changes remain observed while waiting for the parent effect");
  f.commitProjection(); await f.settle();
  assert.equal(f.props.material.metadata_revision, 3);
  assert.equal(f.button("after").isConnected, true);
  assert.equal(f.dom.document.activeElement, f.button("after"));
  assert.deepEqual(f.dom.calls.map(call => call.name), [`${f.version.versionId} after`]);
  assert.equal(f.dom.listeners.size, 0);
});

test("a truly missing version falls back to history only after the delayed parent projection commits", async () => {
  const f = metadataRestore({ deferProjection: true }); await f.openHistory(); f.restore("before"); f.finish(true, true); await f.settle();
  assert.equal(f.props.material.metadata_revision, 2);
  assert.deepEqual(f.dom.calls, []);
  f.commitProjection(); await f.settle();
  assert.equal(f.props.material.metadata_revision, 3);
  assert.equal(f.dom.document.activeElement, f.summary);
  assert.deepEqual(f.dom.calls.map(call => call.name), ["history summary"]);
  assert.equal(f.dom.listeners.size, 0);
});

test("focus moved during the delayed material projection is not recaptured after that projection commits", async () => {
  const f = metadataRestore({ deferProjection: true }); await f.openHistory(); f.restore("before"); f.finish(); await f.settle();
  f.dom.move(); f.dom.document.activeElement = f.dom.document.body; f.dom.calls.length = 0;
  f.commitProjection(); await f.settle();
  assert.equal(f.props.material.metadata_revision, 3);
  assert.equal(f.button("after").isConnected, true);
  assert.equal(f.dom.document.activeElement, f.dom.document.body);
  assert.deepEqual(f.dom.calls, []);
  assert.equal(f.dom.listeners.size, 0);
});

test("closing history while the parent projection catches up cancels the outstanding focus return", async () => {
  const f = metadataRestore({ deferProjection: true }); await f.openHistory(); f.restore("before"); f.finish(); await f.settle();
  f.closeHistory(); f.dom.calls.length = 0;
  f.commitProjection(); await f.settle();
  assert.equal(f.historyOpen(), false);
  assert.equal(f.dom.document.activeElement, f.dom.document.body);
  assert.deepEqual(f.dom.calls, []);
  assert.equal(f.dom.listeners.size, 0);
});

test("material restoration uses history summary when the refreshed version window omits the original row", async () => {
  const f = metadataRestore(); await f.openHistory(); f.restore("before"); f.finish(true, true); await f.settle();
  assert.equal(f.button("before").isConnected, false);
  assert.equal(f.dom.document.activeElement, f.summary);
  assert.deepEqual(f.dom.calls.map(call => call.name), ["history summary"]);
});

test("closing material history during restoration keeps it closed without moving the user's focus", async () => {
  const f = metadataRestore(); await f.openHistory(); f.restore("before"); f.closeHistory();
  const target = f.dom.document.activeElement; f.finish(); await f.settle();
  assert.equal(f.historyOpen(), false);
  assert.equal(f.dom.document.activeElement, target);
  assert.deepEqual(f.dom.calls, []);
  assert.equal(f.dom.listeners.size, 0);
});

test("material restoration does not recapture focus moved elsewhere even if it later returns to HTML", async () => {
  for (const success of [true, false]) {
    const f = metadataRestore(); await f.openHistory(); f.restore("before"); f.dom.move(); f.dom.document.activeElement = f.dom.document.body;
    f.finish(success); await f.settle();
    assert.equal(f.dom.document.activeElement, f.dom.document.body);
    assert.deepEqual(f.dom.calls, []);
    assert.equal(f.dom.listeners.size, 0);
  }
});

test("changing material identity aborts restoration and ignores the response and focus request", async () => {
  const f = metadataRestore(); await f.openHistory(); f.restore("before");
  const request = f.requests.find(request => request.method === "POST");
  f.props.material = material(2); f.render(); assert.equal(request.signal.aborted, true);
  const target = f.dom.move(); f.finish(); await f.settle();
  assert.equal(f.education.length, 0);
  assert.equal(f.props.material.material_id, "synthetic-material-2");
  assert.equal(f.dom.document.activeElement, target);
  assert.deepEqual(f.dom.calls, []);
  assert.equal(f.dom.listeners.size, 0);
});

test("a disconnected material editor never restores focus into its detached history", async () => {
  const f = metadataRestore(); await f.openHistory(); f.restore("before"); f.dom.root.isConnected = false;
  f.finish(); await f.settle();
  assert.deepEqual(f.dom.calls, []);
  assert.equal(f.dom.listeners.size, 0);
});
