import assert from "node:assert/strict";
import test from "node:test";
import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { createJiti } from "jiti";
import { readFile } from "node:fs/promises";
import { createRequire } from "node:module";
import ts from "typescript";

const { EduPiReceivedLessonProposal } = await createJiti(import.meta.url, {
  tsconfigPaths: true, jsx: { runtime: "automatic" },
}).import("./EduPiMaterialsWorkspace.tsx");

const material = { material_id: "material-synthetic", title: "合成教案", subject: "数学", class_id: "703",
  metadata_revision: 1, available: true };
const task = { id: "lesson-task", title: "合成课次" };
const proposal = { status: "proposed", material_id: material.material_id, source_hash: `sha256:${"a".repeat(64)}`,
  metadata_revision: 1, lesson_date: "2035-10-12", lesson_date_path: "word/document.xml/w:p[0]",
  lesson: { slot_id: "lesson-slot", task_id: task.id, source_event_date: "2035-10-12",
    starts_at: "2035-10-12T01:00:00.000Z", time_zone: "Asia/Shanghai" },
  basis_hash: `sha256:${"b".repeat(64)}`, reason_code: null,
  read_only: true, automatic_prepare: false, external_send: false };
const render = (value, data) => renderToStaticMarkup(React.createElement(EduPiReceivedLessonProposal,
  { title: "合成教案.docx", proposal: value, data, onTask() { throw new Error("render must not open task"); } }));

test("DOCX lesson suggestion stays collapsed, review-only and bound to the current material revision", () => {
  const data = { teacherMaterials: [material], tasks: [task] };
  const current = render(proposal, data);
  assert.match(current, /<summary>备课建议 <span>待核对<\/span><\/summary>/);
  assert.match(current, /2035-10-12/);
  assert.match(current, /查看课次任务/);
  assert.match(current, /未启动备课/);
  assert.doesNotMatch(current, /<details[^>]*open|确认采用|自动备课|已完成/);

  const stale = render(proposal, { ...data, teacherMaterials: [{ ...material, metadata_revision: 2 }] });
  assert.match(stale, /已失效/);
  assert.doesNotMatch(stale, /查看课次任务|对应课次：/);
  const absent = render(proposal, { ...data, teacherMaterials: [] });
  assert.match(absent, /已失效/);
  assert.doesNotMatch(absent, /查看课次任务/);
});

test("held and unavailable DOCX proposals never expose a lesson or adoption control", () => {
  const data = { teacherMaterials: [material], tasks: [task] };
  for (const status of ["held", "unavailable"]) {
    const html = render({ status, material_id: material.material_id, lesson: null, reason_code: "lesson_date_required",
      read_only: true, automatic_prepare: false, external_send: false }, data);
    assert.match(html, /授课日期待核对/);
    assert.doesNotMatch(html, /查看课次任务|确认采用|自动备课/);
  }
});

test("the actual ready chapter entry only opens source review for the current material", () => {
  const chapter = { status: "ready", title: "合成章节", source_spans: [{ path: "source", start: 3, end: 6 }],
    content_hash: `sha256:${"c".repeat(64)}`, reason_code: null, read_only: true, requires_review: true };
  const opened = [];
  const value = { ...proposal, chapter_suggestion: chapter };
  const tree = EduPiReceivedLessonProposal({ title: "合成教案.docx", proposal: value,
    data: { teacherMaterials: [material], tasks: [task] }, onTask() { throw new Error("must not prepare"); }, onChapterReview: id => opened.push(id) });
  const nodes = item => Array.isArray(item) ? item.flatMap(nodes) : item && typeof item === "object" ? [item, ...nodes(item.props?.children)] : [];
  const button = nodes(tree).find(node => node.type === "button" && node.props.children === "用于备课");
  assert.ok(button); assert.deepEqual(opened, []); button.props.onClick(); assert.deepEqual(opened, [material.material_id]);
  for (const data of [{ teacherMaterials: [{ ...material, metadata_revision: 2 }], tasks: [task] },
    { teacherMaterials: [{ ...material, available: false }], tasks: [task] }]) {
    const stale = EduPiReceivedLessonProposal({ title: "合成", proposal: value, data, onTask() {}, onChapterReview() { throw new Error("stale"); } });
    assert.equal(nodes(stale).some(node => node.type === "button" && node.props.children === "用于备课"), false);
  }
});

async function intakeWorkspaceFixture(kind) {
  const require = createRequire(import.meta.url), jiti = createJiti(import.meta.url, { tsconfigPaths: true });
  const source = await readFile(new URL("./EduPiMaterialsWorkspace.tsx", import.meta.url), "utf8");
  const compiled = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.ReactJSX } }).outputText;
  const slots = [], effects = [], calls = [], network = [], rows = [];
  let cursor = 0, dirty = false;
  const same = (a, b) => a?.length === b?.length && a.every((item, index) => Object.is(item, b[index]));
  const react = {
    useState(initial) { const index = cursor++; if (!slots[index]) slots[index] = { value: typeof initial === "function" ? initial() : initial };
      return [slots[index].value, value => { const next = typeof value === "function" ? value(slots[index].value) : value;
        if (!Object.is(next, slots[index].value)) { slots[index].value = next; dirty = true; } }]; },
    useRef(initial) { return slots[cursor++] ||= { current: initial }; },
    useMemo(fn, deps) { const index = cursor++; if (!slots[index] || !same(slots[index].deps, deps)) slots[index] = { value: fn(), deps }; return slots[index].value; },
    useCallback(fn, deps) { return this.useMemo(() => fn, deps); },
    useEffect(fn, deps) { const index = cursor++; if (!slots[index] || !same(slots[index].deps, deps)) {
      const previous = slots[index]; slots[index] = { deps }; effects.push(() => { previous?.cleanup?.(); slots[index].cleanup = fn(); });
    } },
  };
  react.useCallback = (fn, deps) => react.useMemo(() => fn, deps);
  const hash = `sha256:${"a".repeat(64)}`, materialId = "material-current";
  const read = { version: 1, root_ref: hash, owner_id: "owner-current", source: { material_id: materialId, source_hash: hash,
    metadata_revision: 0, relative_path: `material.${kind === "calendar" ? "ics" : "docx"}` },
  options: { max_occurrences: 200 }, status: "ready", events: [{ event_id: "candidate", date: "2026-10-22", name: "合成安排" }],
  issues: [], evidence: [], parse_fingerprint: hash, read_only: true, automatic_import: false, external_send: false };
  const upload = { status: "proposed", material_id: materialId, read_result: read, reason_code: null,
    read_only: true, automatic_import: false, external_send: false };
  const descriptor = { staging_id: `stg_${"1".repeat(32)}`, original_name: read.source.relative_path, staging_path: `/synthetic/${read.source.relative_path}`,
    source_hash: hash, expected_size_bytes: 100, kind, source_scope: "desktop_staging" };
  const Proposal = () => null;
  const dependencies = { react, "@/hooks/useModalDismiss": { useModalDismiss: () => ({ current: null }) },
    "@/lib/edupi-domain-navigation": { MATERIAL_CATEGORIES: [{ id: "all", label: "全部材料" }], materialCategoryRoute: () => "all", materialItemRoute: () => null, materialObjectId: () => "material" },
    "@/lib/edupi-material-rows": { buildMaterialRows: () => rows, defaultMaterialIntakeMetadata: () => ({ title: "合成材料", materialKind: "other", subject: "数学", classId: "七一班" }) },
    "@/lib/edupi-material-class-options": { materialClassOptions: () => [{ value: "七一班", label: "七一班" }], hasUnboundSameNameClass: () => false },
    "@/lib/edupi-material-schedule": await jiti.import("../lib/edupi-material-schedule.ts"),
    "@/lib/desktop-updater": { isTauriDesktop: () => true },
    "@/lib/edupi-schedule-source-selection": { resolveScheduleSourceSelection: () => ({ source: null }) },
    "./EduPiMaterialScheduleProposal": { EduPiMaterialScheduleProposal: Proposal } };
  const componentModule = { exports: {} }, fakeModule = new Proxy({}, { get: () => () => null });
  new Function("require", "module", "exports", "fetch", compiled)(name => dependencies[name]
    || (name.startsWith("@/") || name.startsWith("./") ? fakeModule : require(name)), componentModule, componentModule.exports,
  async url => { network.push(url); return { ok: true, json: async () => ({ sources: [] }) }; });
  const props = { data: { timetable: [], teacherMaterials: [], capabilities: { materialIntake: { enabled: true }, calendar: { enabled: true },
    timetable: { enabled: true }, entityDelete: { enabled: true, targetKinds: [] } }, dataSources: { materials: { present: true } } },
  context: null, query: "", selectedObjectId: null, stagedMaterials: [descriptor], stagingBusy: false,
  onObject() {}, onIntakeMaterial: async (...args) => { calls.push(args); return { materialReceivedOnly: true, materialScheduleProposal: upload }; } };
  const render = () => { let tree, attempts = 0; do { cursor = 0; dirty = false; tree = componentModule.exports.EduPiMaterialsWorkspace(props);
    effects.splice(0).forEach(run => run()); assert.ok(++attempts < 12); } while (dirty); return tree; };
  const nodes = item => Array.isArray(item) ? item.flatMap(nodes) : item && typeof item === "object" ? [item, ...nodes(item.props?.children)] : [];
  const text = item => Array.isArray(item) ? item.map(text).join("") : item && typeof item === "object" ? text(item.props?.children) : String(item ?? "");
  return { render, nodes, text, calls, network, Proposal, materialId, flush: () => new Promise(resolve => setImmediate(resolve)),
    cleanup: () => slots.forEach(slot => slot?.cleanup?.()) };
}

test("new ICS and DOCX receipt surfaces the owner proposal without old source, pairing or import actions", async () => {
  for (const kind of ["calendar", "word"]) {
    const fixture = await intakeWorkspaceFixture(kind);
    try {
      let tree = fixture.render();
      const open = fixture.nodes(tree).find(node => node.type === "button" && fixture.text(node) === "接入 EduPi");
      open.props.onClick(); tree = fixture.render();
      const form = fixture.nodes(tree).find(node => node.type === "form");
      form.props.onSubmit({ preventDefault() {} }); await fixture.flush(); tree = fixture.render();
      assert.equal(fixture.calls.length, 1);
      assert.equal(fixture.calls[0].length, 2, "file receipt does not carry a legacy source or pairing intent");
      assert.ok(fixture.nodes(tree).some(node => node.type === fixture.Proposal && node.props.materialId === fixture.materialId), kind);
      assert.deepEqual(fixture.network, [], "Workspace does not parse a staging preview or load old update bindings");
      assert.doesNotMatch(fixture.text(tree), /确认导入|确认更新|逐项配对/);
    } finally { fixture.cleanup(); }
  }
});

test("cancelling file receipt leaves staging and does not submit or display an adopted arrangement", async () => {
  const fixture = await intakeWorkspaceFixture("calendar");
  try {
    let tree = fixture.render();
    fixture.nodes(tree).find(node => node.type === "button" && fixture.text(node) === "接入 EduPi").props.onClick();
    tree = fixture.render();
    fixture.nodes(tree).find(node => node.type === "button" && fixture.text(node) === "取消").props.onClick();
    tree = fixture.render(); await fixture.flush();
    assert.deepEqual(fixture.calls, []);
    assert.deepEqual(fixture.network, []);
    assert.equal(fixture.nodes(tree).some(node => node.type === "form" || node.type === fixture.Proposal), false);
    assert.match(fixture.text(tree), /material\.ics/);
  } finally { fixture.cleanup(); }
});
