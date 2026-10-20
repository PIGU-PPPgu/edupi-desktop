import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import fs from "node:fs";
import { createRequire } from "node:module";
import test from "node:test";
import ts from "typescript";
import { createJiti } from "jiti";

const require = createRequire(import.meta.url), jiti = createJiti(import.meta.url, { tsconfigPaths: true });
const hash = value => `sha256:${createHash("sha256").update(value).digest("hex")}`;
const path = "word/document.xml/w:document[0]/w:body[0]/w:p[0]";
const cell = "word/document.xml/w:document[0]/w:body[0]/w:tbl[1]/w:tr[0]/w:tc[0]";
function data(materialId = "material-A") {
  const text = "前缀😀 章节：一元一次方程";
  const spans = [{ path, start: text.indexOf("一元"), end: text.length }, { path: cell, start: 1, end: 4 }];
  const content = "一元一次方程\n等式😀";
  const proposal = { status: "proposed", material_id: materialId, metadata_revision: 1, source_hash: hash("source"),
    basis_hash: hash("lesson basis is not source preview basis"), read_only: true, automatic_prepare: false, external_send: false,
    chapter_suggestion: { status: "ready", title: "一元一次方程", source_spans: spans, content_hash: hash(content),
      reason_code: null, read_only: true, requires_review: true } };
  const preview = { version: 1, format: "docx", status: "ready", material_id: materialId,
    source_hash: proposal.source_hash, record_hash: hash("record"), basis_hash: hash("fresh preview"),
    read_only: true, external_send: false, issues: [], blocks: [{ path, text },
      { path: cell.split("/w:tc")[0], text: "表格", cells: [{ path: cell, text: "（等式😀）" }] }] };
  // UTF-16 includes both code units of the emoji in the cell.
  spans[1].end = 5;
  return { proposal, preview, spans, content };
}
async function mount(initial = {}) {
  const slots = [], effects = [], calls = [], settled = [], metadataReads = [];
  let serverMaterials = null;
  let cursor = 0, dirty = false, props = { materialId: "material-A", expectedRevision: 5, metadataRevision: 1,
    available: true, chapterProposal: data().proposal, onSettled: value => settled.push(value), ...initial };
  const same = (a, b) => a?.length === b?.length && a.every((value, i) => Object.is(value, b[i]));
  const hooks = {
    useState(initial) { const i = cursor++; slots[i] ??= { value: typeof initial === "function" ? initial() : initial };
      return [slots[i].value, next => { const value = typeof next === "function" ? next(slots[i].value) : next;
        if (!Object.is(value, slots[i].value)) { slots[i].value = value; dirty = true; } }]; },
    useRef(initial) { const i = cursor++; return slots[i] ??= { current: initial }; },
    useEffect(fn, deps) { const i = cursor++; if (!slots[i] || !same(slots[i].deps, deps)) {
      const previous = slots[i]; slots[i] = { deps }; effects.push(() => { previous?.cleanup?.(); slots[i].cleanup = fn(); });
    } },
  };
  const source = fs.readFileSync(new URL("./EduPiDocxSourceSelection.tsx", import.meta.url), "utf8");
  const code = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.CommonJS,
    target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.ReactJSX } }).outputText;
  const dependencies = { react: hooks };
  if (source.includes("edupi-docx-chapter-suggestion")) dependencies["@/lib/edupi-docx-chapter-suggestion"] = await jiti.import("../lib/edupi-docx-chapter-suggestion.ts");
  const component = { exports: {} };
  new Function("require", "module", "exports", "fetch", code)(name => dependencies[name] || require(name), component, component.exports,
    (url, init) => {
      if (url === "/api/edupi/education") {
        metadataReads.push({ url, init });
        return Promise.resolve(new Response(JSON.stringify({ teacherMaterials: serverMaterials ?? [
          { material_id: props.materialId, available: true, metadata_revision: 1 },
        ] })));
      }
      return new Promise(resolve => calls.push({ url, init, resolve }));
    });
  const render = patch => {
    props = { ...props, ...patch };
    let tree, attempts = 0;
    do { cursor = 0; dirty = false; tree = component.exports.EduPiDocxSourceSelection(props); effects.splice(0).forEach(fn => fn());
      assert.ok(++attempts < 10); } while (dirty);
    return tree;
  };
  return { render, calls, settled, metadataReads, setServerMaterials: value => { serverMaterials = value; },
    respond: (i, value, status = 200) => calls[i].resolve(new Response(JSON.stringify(value), { status })),
    unmount: () => slots.forEach(slot => slot?.cleanup?.()) };
}
const nodes = tree => Array.isArray(tree) ? tree.flatMap(nodes) : tree && typeof tree === "object" ? [tree, ...nodes(tree.props?.children)] : [];
const text = tree => Array.isArray(tree) ? tree.map(text).join("") : tree && typeof tree === "object" ? text(tree.props?.children) : String(tree ?? "");
const button = (tree, label) => nodes(tree).find(node => node.type === "button" && text(node) === label);
const cannotConfirm = tree => !button(tree, "确认选中内容") || button(tree, "确认选中内容").props.disabled;

test("actual chapter callbacks fetch a fresh preview and preserve nonzero UTF-16/cell spans until a second explicit action", async () => {
  const f = await mount(), sample = data();
  try {
    let tree = f.render(); assert.equal(f.calls.length, 0);
    assert.ok(button(tree, "查看建议"), "ready chapter must have a review-only entry");
    const read = button(tree, "查看建议").props.onClick();
    await button(tree, "查看建议").props.onClick();
    assert.equal(f.calls.length, 1); assert.equal(f.calls[0].init?.method, undefined);
    f.respond(0, { preview: sample.preview }); await read; tree = f.render();
    assert.equal(cannotConfirm(tree), false);
    assert.equal(f.metadataReads.length, 1, "the displayed metadata revision must be rechecked against a current server projection");
    assert.equal(f.calls.length, 1, "reading a suggestion must not confirm, create tasks or prepare");
    assert.match(text(tree), /一元一次方程/); assert.doesNotMatch(text(tree), /前缀😀 章节/);
    const confirm = button(tree, "确认选中内容").props.onClick();
    await button(tree, "确认选中内容").props.onClick();
    assert.equal(f.calls.length, 2);
    assert.deepEqual(JSON.parse(f.calls[1].init.body), { materialId: "material-A", expectedRevision: 5,
      expectedBasisHash: sample.preview.basis_hash, sourceSpans: sample.spans });
    f.respond(1, { excerpt: { revision: 6, status: "confirmed" } }); await confirm;
    assert.deepEqual(f.settled, [true]);
  } finally { f.unmount(); }
});

test("old-Core manual selection still reads and confirms only the teacher's checked block", async () => {
  const f = await mount({ chapterProposal: undefined });
  try {
    const read = button(f.render(), "从 DOCX 原文选取").props.onClick();
    f.respond(0, { preview: data().preview }); await read;
    const input = nodes(f.render()).find(node => node.type === "input");
    input.props.onChange({ target: { checked: true } });
    const confirm = button(f.render(), "确认选中内容").props.onClick();
    assert.deepEqual(JSON.parse(f.calls[1].init.body).sourceSpans, [{ path, start: 0, end: data().preview.blocks[0].text.length }]);
    assert.equal(f.metadataReads.length, 0);
    f.respond(1, { error: "stale source" }, 409); await confirm;
    assert.deepEqual(f.settled, [false]); assert.ok(cannotConfirm(f.render()));
  } finally { f.unmount(); }
});

test("a current server metadata edit or deletion cannot be hidden by an unchanged parent UI snapshot", async () => {
  for (const materials of [[], [{ material_id: "material-A", available: false, metadata_revision: 1 }],
    [{ material_id: "material-A", available: true, metadata_revision: 2 }]]) {
    const f = await mount();
    try {
      f.setServerMaterials(materials);
      const read = button(f.render(), "查看建议").props.onClick();
      f.respond(0, { preview: data().preview }); await read;
      assert.ok(cannotConfirm(f.render())); assert.equal(f.calls.length, 1); assert.deepEqual(f.settled, []);
    } finally { f.unmount(); }
  }
});

test("actual review callbacks reject foreign or changed preview, content hash and invalid UTF-16 selectors without POST", async () => {
  for (const change of [
    ({ preview }) => { preview.source_hash = hash("changed source"); },
    ({ preview }) => { preview.material_id = "material-B"; },
    ({ preview }) => { preview.status = "held"; preview.issues = [{ code: "unresolved" }]; },
    ({ proposal }) => { proposal.chapter_suggestion.content_hash = hash("different text"); },
    ({ proposal }) => { proposal.chapter_suggestion.source_spans[0].path = "missing"; },
    ({ proposal }) => { proposal.chapter_suggestion.source_spans[0].start = 3; },
    ({ proposal }) => { proposal.chapter_suggestion.source_spans.reverse(); },
  ]) {
    const sample = data(); change(sample);
    const f = await mount({ chapterProposal: sample.proposal });
    try {
      let tree = f.render(); assert.ok(button(tree, "查看建议")); const read = button(tree, "查看建议").props.onClick();
      f.respond(0, { preview: sample.preview }); await read; tree = f.render();
      assert.ok(cannotConfirm(tree)); assert.equal(f.calls.length, 1);
      assert.equal(nodes(tree).some(node => node.props?.role === "alert"), true);
    } finally { f.unmount(); }
  }
});

test("held, unavailable, missing old-Core chapter, deleted and metadata-stale material never create suggested selections", async () => {
  const original = data().proposal;
  for (const patch of [{ chapterProposal: { ...original, chapter_suggestion: undefined } },
    ...["held", "unavailable"].map(status => ({ chapterProposal: { ...original, chapter_suggestion: { status } } })),
    { metadataRevision: 2 }, { available: false }]) {
    const f = await mount(patch);
    try { const tree = f.render(); assert.equal(button(tree, "查看建议"), undefined); assert.ok(cannotConfirm(tree)); assert.equal(f.calls.length, 0); }
    finally { f.unmount(); }
  }
});

test("a late preview cannot seed a revised or different material, and an unmounted callback cannot confirm", async () => {
  const f = await mount();
  try {
    const readA = button(f.render(), "查看建议").props.onClick();
    const b = data("material-B"); f.render({ materialId: "material-B", chapterProposal: b.proposal });
    const readB = button(f.render(), "查看建议").props.onClick();
    f.respond(1, { preview: b.preview }); await readB; let tree = f.render(); assert.equal(cannotConfirm(tree), false);
    f.respond(0, { preview: data().preview }); await readA; tree = f.render(); assert.equal(cannotConfirm(tree), false);
    const captured = button(tree, "确认选中内容"); f.unmount(); await captured.props.onClick();
    assert.equal(f.calls.length, 2, "no write may start after its material view was disposed");
    assert.deepEqual(f.settled, []);
  } finally { f.unmount(); }
});

test("metadata refresh invalidates a pending preview and a late confirmation cannot settle the next material", async () => {
  const f = await mount();
  try {
    const readA = button(f.render(), "查看建议").props.onClick();
    f.render({ metadataRevision: 2 }); f.respond(0, { preview: data().preview }); await readA; assert.ok(cannotConfirm(f.render()));
    const b = data("material-B"); f.render({ materialId: "material-B", metadataRevision: 1, chapterProposal: b.proposal });
    const readB = button(f.render(), "查看建议").props.onClick(); f.respond(1, { preview: b.preview }); await readB;
    const confirm = button(f.render(), "确认选中内容").props.onClick();
    f.render({ materialId: "material-C", chapterProposal: data("material-C").proposal });
    f.respond(2, { excerpt: { status: "confirmed", revision: 6 } }); await confirm;
    assert.deepEqual(f.settled, []);
  } finally { f.unmount(); }
});

test("captured confirm callbacks cannot borrow authority after navigating away and back or rereading the same material", async () => {
  for (const navigate of [true, false]) {
    const f = await mount();
    try {
      const read = button(f.render(), "查看建议").props.onClick(); f.respond(0, { preview: data().preview }); await read;
      const captured = button(f.render(), "确认选中内容");
      if (navigate) {
        f.render({ materialId: "material-B", chapterProposal: data("material-B").proposal });
        f.render({ materialId: "material-A", chapterProposal: data().proposal });
      } else {
        const reread = button(f.render(), "查看建议").props.onClick();
        f.respond(1, { preview: { ...data().preview, basis_hash: hash("new parse basis") } }); await reread; f.render();
      }
      const before = f.calls.length; await captured.props.onClick();
      assert.equal(f.calls.length, before, "a stale callback must never submit its old preview basis");
    } finally { f.unmount(); }
  }
});

test("a digest finishing after metadata or material navigation cannot seed a stale selection", async () => {
  const subtle = globalThis.crypto.subtle;
  const descriptor = Object.getOwnPropertyDescriptor(subtle, "digest");
  const digest = subtle.digest.bind(subtle);
  for (const patch of [{ metadataRevision: 2 }, { materialId: "material-B", chapterProposal: data("material-B").proposal }]) {
    const f = await mount();
    let release, started;
    const barrier = new Promise(resolve => { release = resolve; });
    const digestStarted = new Promise(resolve => { started = resolve; });
    Object.defineProperty(subtle, "digest", { configurable: true, value: async (...args) => {
      started(); await barrier; return digest(...args);
    } });
    let read;
    try {
      read = button(f.render(), "查看建议").props.onClick();
      f.respond(0, { preview: data().preview }); await digestStarted;
      assert.ok(cannotConfirm(f.render())); assert.equal(f.metadataReads.length, 0);
      f.render(patch); release(); await read;
      assert.ok(cannotConfirm(f.render()), "late hashing cannot authorize a replaced or revised material");
      assert.equal(f.metadataReads.length, 0, "an aborted read must not fetch a new metadata projection");
      assert.equal(f.calls.length, 1); assert.deepEqual(f.settled, []);
    } finally {
      release(); await read; f.unmount();
      if (descriptor) Object.defineProperty(subtle, "digest", descriptor);
      else delete subtle.digest;
    }
  }
});
