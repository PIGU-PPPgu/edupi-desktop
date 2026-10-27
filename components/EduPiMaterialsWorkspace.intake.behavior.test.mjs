import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import vm from "node:vm";
import ts from "typescript";
import { createJiti } from "jiti";

const jiti = createJiti(import.meta.url, { tsconfigPaths: true });
const [navigation, rowsModel, classOptions, schedule, contract] = await Promise.all([
  jiti.import("../lib/edupi-domain-navigation.ts"), jiti.import("../lib/edupi-material-rows.ts"),
  jiti.import("../lib/edupi-material-class-options.ts"), jiti.import("../lib/edupi-material-schedule.ts"),
  jiti.import("../lib/edupi-education-contract.ts"),
]);
const code = ts.transpileModule(readFileSync(new URL("./EduPiMaterialsWorkspace.tsx", import.meta.url), "utf8"), {
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.ReactJSX },
}).outputText;
const jsx = (type, props, key) => ({ type, props: props || {}, key });
const nodes = node => Array.isArray(node) ? node.flatMap(nodes) : node?.props ? [node, ...nodes(node.props.children)] : [];
const text = node => typeof node === "string" || typeof node === "number" ? String(node) : Array.isArray(node) ? node.map(text).join("") : node?.props ? text(node.props.children) : "";
const tick = () => new Promise(resolve => setImmediate(resolve));
const placeholder = name => Object.defineProperty(() => null, "name", { value: name });
const Schedule = placeholder("EduPiMaterialScheduleProposal"), Icon = placeholder("EduPiIconButton");
const descriptor = (kind, extension, index = 1) => ({ staging_id: `stg_${String(index).padStart(32, "0")}`,
  original_name: `UI验收合成材料${index}.${extension}`, staging_path: `/synthetic/staging/material${index}.${extension}`,
  source_hash: `sha256:${"a".repeat(64)}`, expected_size_bytes: 100, kind, source_scope: "desktop_staging" });
const materialId = item => `material-${item.staging_id.slice(4)}`;
function proposal(item, status = "proposed") {
  const hash = item.source_hash, id = materialId(item);
  return { status, material_id: id, read_result: status === "unavailable" ? null : {
    version: 1, root_ref: hash, owner_id: "owner-synthetic", source: { material_id: id, source_hash: hash, metadata_revision: 0, relative_path: item.original_name },
    options: { max_occurrences: 200 }, status: status === "proposed" ? "ready" : "unresolved",
    events: status === "proposed" ? [{ event_id: "synthetic-event", date: "2035-10-22", name: "合成安排" }] : [],
    issues: [], evidence: [], parse_fingerprint: hash, read_only: true, automatic_import: false, external_send: false,
  }, reason_code: status === "proposed" ? null : status === "held" ? "material_schedule_unresolved" : "synthetic_unavailable",
  read_only: true, automatic_import: false, external_send: false };
}

function mount(staged = [], receipt = item => ({ materialScheduleProposal: proposal(item) })) {
  const slots = [], calls = [], requests = [], pendingDeletes = [], listeners = new Set(), focusCalls = [];
  let cursor = 0, dirty = false, effects = [], tree, drawerRef, detached = false;
  const document = { body: { name: "body" }, documentElement: { name: "html" }, activeElement: null,
    addEventListener(name, callback) { assert.equal(name, "focusin"); listeners.add(callback); },
    removeEventListener(name, callback) { assert.equal(name, "focusin"); listeners.delete(callback); },
  };
  document.activeElement = document.body;
  const scope = { isConnected: false, ownerDocument: document, contains: target => Boolean(target?.isConnected && target.scope === scope),
    querySelector(selector) { assert.equal(selector, "[data-material-delete-trigger]"); return deleteButton.isConnected ? deleteButton : null; },
  };
  const deleteButton = { name: "delete", scope, isConnected: false, disabled: false, ownerDocument: document,
    focus(options) { assert.ok(this.isConnected && !this.disabled); document.activeElement = this; focusCalls.push({ name: "delete", options }); for (const listener of listeners) listener({ target: this }); },
  };
  const data = contract.buildEducationContract({ workspace: "/synthetic", tasks: [] });
  data.capabilities.materialIntake = { enabled: true, reason: "" };
  data.capabilities.entityDelete = { enabled: true, reason: "", targetKinds: ["material"] };
  data.dataSources.materials = { present: true }; data.teacherMaterials = [];
  const props = { data, context: { subject: "数学", classes: ["703"] }, query: "", selectedObjectId: "materials:all",
    stagedMaterials: staged, stagingBusy: false, stagingMessage: null,
    onObject(id) { props.selectedObjectId = id; }, onTask() {}, onUpload() {}, onRemoveStagedMaterial() {}, onOpenFile() {}, onStartAgent() {}, onEducation() {},
    async onIntakeMaterial(item, metadata) {
      calls.push({ item, metadata }); props.stagedMaterials = props.stagedMaterials.filter(entry => entry.staging_id !== item.staging_id);
      props.data = { ...props.data, teacherMaterials: [...props.data.teacherMaterials, { material_id: materialId(item), title: metadata.title, kind: metadata.materialKind,
        subject: metadata.subject, class_id: metadata.classId, relative_path: `.edupi/inbox/${item.original_name}`, metadata_revision: 0, metadata_history_count: 0, available: true }] };
      return receipt(item);
    },
    onDeleteEntity(kind, id, label) { requests.push({ kind, id, label }); return new Promise((resolve, reject) => pendingDeletes.push({ resolve, reject, id })); },
  };
  const same = (a, b) => a?.length === b?.length && a.every((value, index) => Object.is(value, b[index]));
  const react = {
    useState(initial) { const index = cursor++; if (!(index in slots)) slots[index] = typeof initial === "function" ? initial() : initial; return [slots[index], value => { const next = typeof value === "function" ? value(slots[index]) : value; if (!Object.is(next, slots[index])) { slots[index] = next; dirty = true; } }]; },
    useRef(initial) { const index = cursor++; slots[index] ??= { current: initial }; return slots[index]; },
    useMemo(create, deps) { const index = cursor++; if (!same(slots[index]?.deps, deps)) slots[index] = { deps, value: create() }; return slots[index].value; },
    useEffect(create, deps) { const index = cursor++, prior = slots[index]; if (!same(prior?.deps, deps)) { slots[index] = { deps }; effects.push(() => { prior?.cleanup?.(); slots[index].cleanup = create(); }); } },
  };
  react.useCallback = (callback, deps) => react.useMemo(() => callback, deps);
  const modules = { react, "react/jsx-runtime": { jsx, jsxs: jsx, Fragment: "fragment" },
    "@/lib/edupi-domain-navigation": navigation, "@/lib/edupi-material-rows": rowsModel, "@/lib/edupi-material-class-options": classOptions,
    "@/lib/edupi-material-schedule": schedule, "@/lib/desktop-updater": { isTauriDesktop: () => false },
    "@/hooks/useModalDismiss": { useModalDismiss() { drawerRef = react.useRef(null); return drawerRef; } },
    "@/lib/edupi-operation-history": { intakeOperationHistory: () => [] }, "@/lib/edupi-docx-chapter-suggestion": { currentDocxChapter: () => false },
    "./EduPiActionIcon": { EduPiIconButton: Icon, EduPiPagination: placeholder("EduPiPagination") },
    "./EduPiMaterialScheduleProposal": { EduPiMaterialScheduleProposal: Schedule },
  };
  for (const name of ["EduPiMaterialExcerpt", "EduPiOperationHistory", "EduPiMaterialMetadataEditor"]) modules[`./${name}`] = { [name]: placeholder(name) };
  const exports = {};
  vm.runInNewContext(code, { exports, Event, window: { dispatchEvent() {} }, fetch() { assert.fail("workspace must not parse or apply arrangements while receiving a file"); },
    require(name) { assert.ok(modules[name], `Unexpected import ${name}`); return modules[name]; },
  });
  const f = { props, calls, requests, document, scope, deleteButton, focusCalls, listeners,
    nodes: () => nodes(tree), find: predicate => nodes(tree).find(predicate),
    render() { let attempts = 0; do {
      assert.ok(attempts++ < 20); cursor = 0; dirty = false; effects = []; tree = exports.EduPiMaterialsWorkspace(props);
      scope.isConnected = !detached && Boolean(f.find(node => node.type === "aside")); drawerRef.current = scope.isConnected ? scope : null;
      const action = f.find(node => node.type === Icon && node.props.icon === "delete");
      deleteButton.isConnected = Boolean(action && scope.isConnected); deleteButton.disabled = Boolean(action?.props.disabled);
      if (document.activeElement === deleteButton && (!deleteButton.isConnected || deleteButton.disabled)) document.activeElement = document.body;
      effects.splice(0).forEach(effect => effect());
    } while (dirty); },
    async settle() { for (let index = 0; index < 5; index++) { await tick(); if (dirty) f.render(); } },
    async receive(item) {
      const row = f.find(node => node.props.className === "edupi-material-inbox__item" && node.key === item.staging_id); assert.ok(row);
      nodes(row).find(node => node.type === "button" && text(node) === "接入 EduPi").props.onClick(); f.render();
      f.find(node => node.type === "form").props.onSubmit({ preventDefault() {} }); await f.settle();
    },
    proposals: () => f.nodes().filter(node => node.type === Schedule && node.props.initialProposal),
    rows: () => f.nodes().filter(node => node.props.className?.startsWith("edupi-database-button-row")),
    select(id) { f.rows().find(node => node.key === id).props.onClick(); f.render(); },
    delete() { deleteButton.focus({ preventScroll: false }); focusCalls.length = 0; f.find(node => node.type === Icon && node.props.icon === "delete").props.onClick(); f.render(); },
    finishDelete(deleted, error = false) { const pending = pendingDeletes.shift(); assert.ok(pending);
      if (error) pending.reject(new Error("synthetic delete error")); else {
        if (deleted) props.data = { ...props.data, teacherMaterials: props.data.teacherMaterials.filter(item => item.material_id !== pending.id) };
        pending.resolve(deleted);
      }
    },
    moveFocus(target = { name: "other control", isConnected: true }) { document.activeElement = target; for (const listener of listeners) listener({ target }); return target; },
    detach() { detached = true; scope.isConnected = false; },
    cleanup() { f.detach(); slots.forEach(slot => slot?.cleanup?.()); },
  };
  f.render(); return f;
}

test("receiving seven PDFs keeps the material list clear while retaining each detail review entry", async () => {
  const items = Array.from({ length: 7 }, (_, index) => descriptor("pdf", "pdf", index + 1)); const f = mount(items);
  try {
    for (const item of items) await f.receive(item);
    assert.equal(f.calls.length, 7); assert.equal(f.rows().length, 7); assert.equal(f.proposals().length, 0);
    assert.equal(f.props.stagedMaterials.length, 0); assert.equal(f.props.data.teacherMaterials.length, 7);
    assert.ok(f.rows().every(row => !text(row).includes("已接入材料") && text(row).includes("其他")));
    f.select(materialId(items[0]));
    const detail = f.find(node => node.type === Schedule); assert.ok(detail); assert.equal(detail.props.materialId, materialId(items[0]));
    assert.equal(detail.props.initialProposal, undefined, "the on-demand detail review remains available");
  } finally { f.cleanup(); }
});

test("images and legacy DOC receipts ignore unsupported upload proposals without false errors", async () => {
  for (const [kind, extension] of [["image", "png"], ["image", "jpeg"], ["word", "doc"]]) {
    const item = descriptor(kind, extension), f = mount([item], () => ({ materialScheduleProposal: { malformed: true } }));
    try {
      await f.receive(item); assert.equal(f.calls.length, 1); assert.equal(f.rows().length, 1); assert.equal(f.proposals().length, 0);
      assert.equal(f.find(node => node.props.role === "alert"), undefined, extension);
    } finally { f.cleanup(); }
  }
});

test("ICS and DOCX retain proposed, held and unavailable upload review surfaces", async () => {
  for (const [kind, extension] of [["calendar", "ics"], ["word", "docx"], ["word", "DOCX"]]) {
    for (const status of ["proposed", "held", "unavailable"]) {
      const item = descriptor(kind, extension), expected = proposal(item, status), f = mount([item], () => ({ materialScheduleProposal: expected }));
      try {
        await f.receive(item); assert.equal(f.calls.length, 1); assert.equal(f.proposals().length, 1, `${extension}:${status}`);
        assert.equal(f.proposals()[0].props.materialId, materialId(item)); assert.equal(f.proposals()[0].props.initialProposal, expected);
      } finally { f.cleanup(); }
    }
  }
});

test("mixed receipts retain only supported upload proposals and still validate their payloads", async () => {
  const items = [descriptor("pdf", "pdf", 1), descriptor("calendar", "ics", 2), descriptor("word", "docx", 3)];
  const f = mount(items);
  try {
    for (const item of items) await f.receive(item);
    assert.deepEqual(f.proposals().map(node => node.props.materialId), items.slice(1).map(materialId)); assert.equal(f.rows().length, 3);
  } finally { f.cleanup(); }
  const invalid = descriptor("calendar", "ics"), rejected = mount([invalid], () => ({ materialScheduleProposal: { malformed: true } }));
  try {
    await rejected.receive(invalid); assert.equal(rejected.proposals().length, 0);
    assert.equal(text(rejected.find(node => node.props.role === "alert")), "安排提案未确认，请重新读取");
    assert.equal(rejected.rows().length, 1, "invalid review data does not undo the received file");
  } finally { rejected.cleanup(); }
});

async function deletable() {
  const item = descriptor("pdf", "pdf"), f = mount([item]); await f.receive(item); f.select(materialId(item)); return { f, item };
}

test("cancelled material deletion returns to its enabled trigger after the confirmation closes", async () => {
  const { f, item } = await deletable();
  try {
    const before = structuredClone(f.props.data.teacherMaterials); f.delete();
    f.moveFocus({ name: "confirmation cancel", isConnected: true, closest: selector => selector === ".edupi-delete-confirmation" ? {} : null });
    f.document.activeElement = f.document.body; f.finishDelete(false); await f.settle();
    assert.equal(f.document.activeElement, f.deleteButton); assert.equal(f.deleteButton.disabled, false); assert.equal(f.scope.isConnected, true);
    assert.deepEqual(f.props.data.teacherMaterials, before); assert.deepEqual(f.requests, [{ kind: "material", id: materialId(item), label: item.original_name }]);
    assert.deepEqual(f.focusCalls.map(call => call.name), ["delete"]); assert.equal(f.listeners.size, 0);
  } finally { f.cleanup(); }
});

test("failed material deletion retains the selected row and returns focus to retry", async () => {
  const { f } = await deletable();
  try {
    f.delete(); f.finishDelete(false, true); await f.settle();
    assert.equal(f.rows().length, 1); assert.equal(f.document.activeElement, f.deleteButton);
    assert.equal(text(f.find(node => node.props.role === "alert")), "材料操作失败，请重试");
  } finally { f.cleanup(); }
});

test("successful material deletion closes the detail without returning to a removed trigger", async () => {
  const { f } = await deletable();
  try {
    f.delete(); f.finishDelete(true); await f.settle();
    assert.equal(f.rows().length, 0); assert.equal(f.scope.isConnected, false); assert.deepEqual(f.focusCalls, []);
    assert.equal(f.props.selectedObjectId, "materials:all"); assert.equal(f.listeners.size, 0);
  } finally { f.cleanup(); }
});

test("a user focus move cancels deletion's return even if focus later falls back to the body", async () => {
  const { f } = await deletable();
  try {
    f.delete(); f.moveFocus(); f.document.activeElement = f.document.body; f.finishDelete(false); await f.settle();
    assert.equal(f.document.activeElement, f.document.body); assert.deepEqual(f.focusCalls, []); assert.equal(f.listeners.size, 0);
  } finally { f.cleanup(); }
});

test("a still-mounted confirmation keeps focus until its normal dismissal cleanup", async () => {
  const { f } = await deletable();
  try {
    f.delete(); const cancel = f.moveFocus({ name: "confirmation cancel", isConnected: true, closest: () => ({}) });
    f.finishDelete(false); await f.settle(); assert.equal(f.document.activeElement, cancel); assert.deepEqual(f.focusCalls, []);
    assert.equal(f.deleteButton.disabled, false, "later confirmation cleanup can return to the enabled trigger");
  } finally { f.cleanup(); }
});

test("changing material identity or disconnecting the drawer cancels a pending deletion return", async () => {
  for (const mode of ["identity", "disconnect"]) {
    const { f } = await deletable();
    try {
      f.delete();
      if (mode === "identity") { f.props.selectedObjectId = "materials:all"; f.render(); }
      else f.detach();
      f.finishDelete(false); await f.settle(); assert.deepEqual(f.focusCalls, [], mode); assert.equal(f.listeners.size, 0);
    } finally { f.cleanup(); }
  }
});

test("unmount removes the pending material deletion's focus listener", async () => {
  const { f } = await deletable();
  f.delete(); assert.equal(f.listeners.size, 1); f.cleanup(); assert.equal(f.listeners.size, 0);
});
