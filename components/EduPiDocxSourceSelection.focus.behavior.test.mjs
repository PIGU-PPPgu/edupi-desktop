import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createHash } from "node:crypto";
import test from "node:test";
import vm from "node:vm";
import ts from "typescript";
import { createJiti } from "jiti";

const chapter = await createJiti(import.meta.url).import("../lib/edupi-docx-chapter-suggestion.ts");
const compile = file => ts.transpileModule(readFileSync(new URL(file, import.meta.url), "utf8"), {
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.ReactJSX },
}).outputText;
const childCode = compile("./EduPiDocxSourceSelection.tsx"), parentCode = compile("./EduPiMaterialExcerpt.tsx");
const jsx = (type, props, key) => ({ type, props: props || {}, key });
const nodes = node => Array.isArray(node) ? node.flatMap(nodes) : node?.props ? [node, ...nodes(node.props.children)] : [];
const text = node => typeof node === "string" || typeof node === "number" ? String(node) : Array.isArray(node) ? node.map(text).join("") : node?.props ? text(node.props.children) : "";
const tick = () => new Promise(resolve => setImmediate(resolve));
const original = { revision: 5, status: "confirmed", content: "[UI验收 TEST] 原合成正文", source_kind: "teacher_curated" };
const preview = (count = 58, status = "ready") => ({ version: 1, format: "docx", material_id: "synthetic-material", status,
  basis_hash: `sha256:${"a".repeat(64)}`, issues: [], blocks: Array.from({ length: count }, (_, index) => ({ path: `synthetic-block-${index}`,
    text: index === 0 ? "A😀方程核对" : `[UI验收 TEST] 合成片段${index + 1}` })) });

function mount() {
  let rendering, dirty = false, parentTree, tree, child = null, childSerial = 0, alive = true;
  const requests = [], calls = [], listeners = new Set(), frames = [], notifications = [];
  const document = { body: { name: "body" }, documentElement: { name: "html" }, activeElement: null,
    addEventListener(name, callback) { assert.equal(name, "focusin"); listeners.add(callback); },
    removeEventListener(name, callback) { assert.equal(name, "focusin"); listeners.delete(callback); },
  };
  document.activeElement = document.body;
  const details = { name: "excerpt details", isConnected: true, open: false, ownerDocument: document,
    contains(target) { return Boolean(target?.isConnected && (target.scope === details || target.scope?.parent === details)); },
    querySelector(selector) {
      assert.equal(selector, ".edupi-docx-source button:not(:disabled)");
      return child?.dom.buttons.find(target => target.isConnected && !target.disabled) || null;
    },
  };
  const element = (name, scope) => ({ name, scope, ownerDocument: document, isConnected: true, disabled: false,
    focus(options) {
      assert.ok(this.isConnected && !this.disabled && details.open, `available focus target ${name}`);
      document.activeElement = this; calls.push({ name, options, childInstance: scope?.serial || null });
      for (const listener of [...listeners]) listener({ target: this });
    },
  });
  const summary = element("excerpt summary", details), textarea = element("excerpt textarea", details), refresh = element("excerpt refresh", details);
  const confirm = element("excerpt confirm", details), withdraw = element("excerpt withdraw", details);
  const parentDom = new Map([["summary", summary], ["textarea", textarea], ["刷新版本", refresh], ["确认正文", confirm], ["处理中…", confirm], ["撤回确认", withdraw]]);
  const instances = [];
  const instance = () => { const value = { slots: [], cursor: 0, effects: [], disposed: false }; instances.push(value); return value; };
  const parent = instance();
  const same = (a, b) => Boolean(a && b && a.length === b.length && a.every((value, index) => Object.is(value, b[index])));
  const react = {
    useState(initial) { const current = rendering, index = current.cursor++; if (!(index in current.slots)) current.slots[index] = typeof initial === "function" ? initial() : initial;
      return [current.slots[index], value => { if (current.disposed) return; const next = typeof value === "function" ? value(current.slots[index]) : value;
        if (!Object.is(next, current.slots[index])) { current.slots[index] = next; dirty = true; } }]; },
    useRef(initial) { const current = rendering, index = current.cursor++; current.slots[index] ??= { current: initial }; return current.slots[index]; },
    useEffect(create, deps) { const current = rendering, index = current.cursor++, prior = current.slots[index];
      if (!same(prior?.deps, deps)) { current.slots[index] = { deps }; current.effects.push(() => { prior?.cleanup?.(); current.slots[index].cleanup = create(); }); } },
  };
  const modules = { react, "react/jsx-runtime": { jsx, jsxs: jsx, Fragment: "fragment" }, "@/lib/edupi-docx-chapter-suggestion": chapter };
  const load = code => { const exports = {}; vm.runInNewContext(code, { exports, AbortController, TextEncoder, structuredClone, Event,
    window: { dispatchEvent(event) { notifications.push(event.type); } },
    fetch(url, init = {}) { return new Promise(resolve => requests.push({ url, init, resolve, finished: false })); },
    require(name) { assert.ok(modules[name], `unexpected import ${name}`); return modules[name]; },
  }); return exports; };
  const Child = load(childCode).EduPiDocxSourceSelection;
  modules["./EduPiDocxSourceSelection"] = { EduPiDocxSourceSelection: Child };
  const Parent = load(parentCode).EduPiMaterialExcerpt;
  const props = { materialId: "synthetic-material", canSelectDocx: true, available: true, metadataRevision: 1 };
  const disconnect = target => { target.isConnected = false; if (document.activeElement === target) document.activeElement = document.body; };
  const dispose = value => { value.disposed = true; value.slots.forEach(slot => slot?.cleanup?.()); };
  const destroyChild = () => {
    if (!child) return; for (const target of child.dom.targets.values()) disconnect(target);
    child.dom.root.isConnected = false; dispose(child); child = null;
  };
  const setRef = (node, target) => { if (typeof node.props.ref === "function") node.props.ref(target); else if (node.props.ref) node.props.ref.current = target; };
  const bindParent = () => {
    const present = new Set();
    for (const node of nodes(parentTree)) {
      if (node.type === "details") { setRef(node, details); continue; }
      const name = node.type === "summary" ? "summary" : node.type === "textarea" ? "textarea" : node.type === "button" ? text(node) : null;
      const target = parentDom.get(name); if (!target) continue;
      present.add(target); target.isConnected = alive; target.disabled = Boolean(node.props.disabled); setRef(node, target); node.dom = target;
      if (document.activeElement === target && target.disabled) document.activeElement = document.body;
    }
    for (const target of new Set(parentDom.values())) if (!present.has(target)) disconnect(target);
  };
  const bindChild = childTree => {
    const dom = child.dom, present = new Set(); dom.pieces = []; dom.buttons = [];
    for (const node of nodes(childTree)) {
      if (node === childTree) { setRef(node, dom.root); continue; }
      if (node.props.className === "edupi-docx-source__list") { setRef(node, dom.list); continue; }
      let key = null;
      if (node.type === "input") key = node.props["data-docx-source-piece"] || `piece-${dom.pieces.length}`;
      else if (node.type === "p" && node.props["data-docx-source-piece"]) key = node.props["data-docx-source-piece"];
      else if (node.type === "button") key = text(node) === "处理中…" ? "从 DOCX 原文选取" : text(node);
      if (!key) continue;
      if (!dom.targets.has(key)) dom.targets.set(key, element(key, dom.root));
      const target = dom.targets.get(key); target.isConnected = alive; target.disabled = Boolean(node.props.disabled); present.add(target); setRef(node, target); node.dom = target;
      if (node.type === "input" || node.type === "p") dom.pieces.push(target); else dom.buttons.push(target);
      if (document.activeElement === target && target.disabled) document.activeElement = document.body;
    }
    for (const target of dom.targets.values()) if (!present.has(target)) disconnect(target);
  };
  const merge = node => Array.isArray(node) ? node.map(merge) : node?.props ? node.type === Child ? child?.tree || null : { ...node, props: { ...node.props, children: merge(node.props.children) } } : node;
  const f = {
    props, requests, calls, document, details, summary, textarea, refresh, notifications, frames, listeners,
    nodes: () => nodes(tree), find: predicate => nodes(tree).find(predicate), get child() { return child; },
    render() { if (!alive) return; let attempts = 0; do {
      assert.ok(attempts++ < 25); dirty = false;
      rendering = parent; parent.cursor = 0; parent.effects = []; parentTree = Parent(props); bindParent();
      const childNode = nodes(parentTree).find(node => node.type === Child);
      if (childNode) {
        if (!child) { child = { ...instance(), serial: ++childSerial, props: childNode.props, dom: null };
          const root = { name: "DOCX source", parent: details, serial: child.serial, ownerDocument: document, isConnected: true,
            contains: target => Boolean(target?.isConnected && target.scope === root), closest: selector => selector === "details" ? details : null,
          };
          const list = { name: "DOCX pieces", ownerDocument: document, isConnected: true,
            querySelectorAll(selector) { assert.equal(selector, "[data-docx-source-piece]"); return child.dom.pieces; },
            querySelector(selector) { assert.equal(selector, "[data-docx-source-piece]"); return child.dom.pieces[0] || null; },
          };
          child.dom = { root, list, targets: new Map(), pieces: [], buttons: [] };
        }
        child.props = childNode.props; rendering = child; child.cursor = 0; child.effects = []; child.tree = Child(child.props); bindChild(child.tree);
      } else destroyChild();
      tree = merge(parentTree);
      frames.push({ childInstance: child?.serial || null, focus: document.activeElement?.name, textareaDisabled: textarea.disabled,
        content: nodes(parentTree).find(node => node.type === "textarea").props.value });
      parent.effects.splice(0).forEach(effect => effect()); child?.effects.splice(0).forEach(effect => effect());
    } while (dirty); },
    async settle() { for (let index = 0; index < 7; index++) { await tick(); if (dirty) f.render(); } },
    toggle(open) { details.open = open; parentTree.props.onToggle({ currentTarget: details }); f.render(); },
    respond(kind, payload, ok = true) {
      const request = requests.find(item => !item.finished && (kind === "excerpt" ? item.url.startsWith("/api/edupi/material-excerpt?")
        : kind === "source" ? item.url.startsWith("/api/edupi/material-excerpt/source?") : kind === "post" ? item.init.method === "POST" : item.url === "/api/edupi/education"));
      assert.ok(request, `pending ${kind} request`); request.finished = true; request.resolve({ ok, async json() { return payload; } }); return request;
    },
    async ready() { f.toggle(true); f.respond("excerpt", { excerpt: original }); await f.settle(); calls.length = 0; },
    click(label) { const node = f.find(node => node.type === "button" && text(node) === label); assert.ok(node, `button ${label}`); assert.ok(!node.props.disabled, `enabled ${label}`);
      node.dom.focus({ preventScroll: false }); calls.length = 0; const result = node.props.onClick({ currentTarget: node.dom }); f.render(); return result; },
    select(index, checked = true) { const node = f.nodes().filter(node => node.type === "input")[index]; assert.ok(node); node.dom.focus({ preventScroll: false });
      node.props.onChange({ target: { checked } }); f.render(); calls.length = 0; },
    moveFocus(target = { name: "other control", isConnected: true }) { document.activeElement = target; for (const listener of [...listeners]) listener({ target }); return target; },
    async read(sample = preview()) { f.click("从 DOCX 原文选取"); f.respond("source", { preview: sample }); await f.settle(); },
    unmount() { alive = false; details.isConnected = false; for (const target of new Set(parentDom.values())) disconnect(target); destroyChild(); dispose(parent); },
  };
  f.render(); return f;
}

test("ready source read focuses the first real piece after committing the loaded list", async () => {
  const f = mount();
  try { await f.ready(); await f.read(); assert.equal(f.child.dom.pieces.length, 40);
    assert.equal(f.document.activeElement, f.child.dom.pieces[0]); assert.equal(f.requests.filter(item => item.init.method === "POST").length, 0);
  } finally { f.unmount(); }
});

test("More focuses the first appended piece after its button disappears and retains checked spans", async () => {
  const f = mount();
  try { await f.ready(); await f.read(); f.select(0); f.click("查看更多");
    assert.equal(f.child.dom.pieces.length, 58); assert.equal(f.document.activeElement, f.child.dom.pieces[40]);
    assert.equal(f.nodes().filter(node => node.type === "input")[0].props.checked, true);
    assert.equal(f.find(node => node.type === "button" && text(node) === "查看更多"), undefined);
  } finally { f.unmount(); }
});

test("source confirmation waits through the parent unmount and real excerpt read before focusing refreshed content", async () => {
  const f = mount();
  try { await f.ready(); await f.read(); f.click("查看更多"); f.select(0); f.select(57); const oldChild = f.child.serial;
    f.click("确认选中内容"); const request = f.requests.find(item => item.init.method === "POST");
    assert.deepEqual(JSON.parse(request.init.body), { materialId: "synthetic-material", expectedRevision: 5, expectedBasisHash: preview().basis_hash,
      sourceSpans: [{ path: "synthetic-block-0", start: 0, end: "A😀方程核对".length }, { path: "synthetic-block-57", start: 0, end: preview().blocks[57].text.length }] });
    f.respond("post", { excerpt: { ...original, revision: 6 } }); await f.settle();
    assert.equal(f.child, null, "parent loading really unmounts the source child"); assert.equal(f.textarea.disabled, true);
    assert.deepEqual(f.calls, [], "POST success alone must not focus a soon-to-be removed child or stale textarea");
    assert.ok(f.requests.some(item => !item.finished && item.url.startsWith("/api/edupi/material-excerpt?")));
    const content = "A😀方程核对\n" + preview().blocks[57].text;
    f.respond("excerpt", { excerpt: { revision: 6, status: "confirmed", source_kind: "docx_parsed_fragment", content } }); await f.settle();
    assert.notEqual(f.child.serial, oldChild); assert.equal(f.textarea.disabled, false);
    assert.equal(f.find(node => node.type === "textarea").props.value, content); assert.equal(f.document.activeElement, f.textarea);
    assert.equal(f.child.props.expectedRevision, 6); assert.equal(f.listeners.size, 0);
  } finally { f.unmount(); }
});

test("failed source confirmation keeps its error through parent refresh and rereads before retrying with the fresh revision", async () => {
  const f = mount();
  try { await f.ready(); await f.read(); f.select(0); f.click("确认选中内容");
    f.respond("post", { error: "合成原文版本冲突" }, false); await f.settle();
    assert.equal(f.child, null); assert.match(text(f.find(node => node.props.role === "alert")), /合成原文版本冲突/);
    f.respond("excerpt", { excerpt: { ...original, revision: 6 } }); await f.settle();
    assert.match(text(f.find(node => node.props.role === "alert")), /合成原文版本冲突/);
    assert.equal(f.document.activeElement, f.child.dom.buttons[0]); assert.equal(f.child.props.expectedRevision, 6);
    f.click("从 DOCX 原文选取"); assert.equal(f.find(node => node.props.role === "alert"), undefined);
    f.respond("source", { preview: preview() }); await f.settle(); f.select(0); f.click("确认选中内容");
    assert.equal(JSON.parse(f.requests.filter(item => item.init.method === "POST").at(-1).init.body).expectedRevision, 6);
  } finally { f.unmount(); }
});

test("held and failed reads keep an enabled non-destructive retry action focused", async () => {
  for (const mode of ["held", "failed"]) {
    const f = mount();
    try { await f.ready(); f.click("从 DOCX 原文选取");
      f.respond("source", mode === "held" ? { preview: preview(0, "held") } : { error: "合成原文读取失败" }, mode === "held"); await f.settle();
      assert.equal(f.document.activeElement, f.child.dom.buttons[0]); assert.equal(f.child.dom.pieces.length, 0);
      assert.equal(f.requests.filter(item => item.init.method === "POST").length, 0);
    } finally { f.unmount(); }
  }
});

test("a parent reload failure focuses version retry, without focusing disabled content or the unmounted child", async () => {
  const f = mount();
  try { await f.ready(); await f.read(); f.select(0); f.click("确认选中内容");
    f.respond("post", { excerpt: { ...original, revision: 6 } }); await f.settle();
    f.respond("excerpt", { error: "合成正文读取失败" }, false); await f.settle();
    assert.equal(f.child, null); assert.equal(f.textarea.disabled, true); assert.equal(f.document.activeElement, f.refresh);
    assert.match(text(f.find(node => node.props.role === "alert")), /合成正文读取失败/);
  } finally { f.unmount(); }
});

test("moving focus during either source POST or parent GET permanently cancels the return", async () => {
  for (const phase of ["post", "parent-read"]) {
    const f = mount();
    try { await f.ready(); await f.read(); f.select(0); f.click("确认选中内容");
      if (phase === "post") { f.moveFocus(); f.document.activeElement = f.document.body; }
      f.respond("post", { excerpt: { ...original, revision: 6 } }); await f.settle();
      if (phase === "parent-read") { f.moveFocus(); f.document.activeElement = f.document.body; }
      f.respond("excerpt", { excerpt: { ...original, revision: 6 } }); await f.settle();
      assert.equal(f.document.activeElement, f.document.body, phase); assert.deepEqual(f.calls, [], phase); assert.equal(f.listeners.size, 0);
    } finally { f.unmount(); }
  }
});

test("collapsing and reopening during a pending source read or confirmation does not recapture focus", async () => {
  for (const phase of ["source-read", "confirm"]) {
    const f = mount();
    try { await f.ready();
      if (phase === "confirm") { await f.read(); f.select(0); f.click("确认选中内容"); } else f.click("从 DOCX 原文选取");
      f.toggle(false); f.toggle(true);
      f.respond("excerpt", { excerpt: original }); await f.settle();
      if (phase === "source-read") f.respond("source", { preview: preview() }); else f.respond("post", { excerpt: { ...original, revision: 6 } });
      await f.settle(); assert.deepEqual(f.calls, [], phase); assert.equal(f.document.activeElement, f.document.body);
    } finally { f.unmount(); }
  }
});

test("changing material or unmounting invalidates pending source focus and late completions", async () => {
  for (const phase of ["source-read", "confirm"]) {
    for (const change of ["material", "unmount"]) {
      const f = mount();
      try { await f.ready();
        if (phase === "confirm") { await f.read(); f.select(0); f.click("确认选中内容"); } else f.click("从 DOCX 原文选取");
        if (change === "material") { f.props.materialId = "synthetic-other"; f.render(); } else f.unmount();
        f.respond(phase === "confirm" ? "post" : "source", phase === "confirm" ? { excerpt: { ...original, revision: 6 } } : { preview: preview() }); await f.settle();
        assert.deepEqual(f.calls, [], `${phase}:${change}`); assert.equal(f.listeners.size, 0);
      } finally { f.unmount(); }
    }
  }
});

test("selection count and UTF8 byte limits still prevent a source POST", async () => {
  for (const mode of ["count", "bytes"]) {
    const f = mount();
    try { await f.ready(); const sample = preview(); if (mode === "bytes") sample.blocks[0].text = "验".repeat(5462);
      await f.read(sample); for (let index = 0; index < (mode === "count" ? 21 : 1); index++) f.select(index);
      assert.equal(f.find(node => node.type === "button" && text(node) === "确认选中内容").props.disabled, true);
      assert.match(text(f.find(node => node.props.role === "alert")), /最多选20处，合计不超过16 KB/);
      assert.equal(f.requests.filter(item => item.init.method === "POST").length, 0);
    } finally { f.unmount(); }
  }
});

test("a suggested chapter focuses its first reviewed paragraph only after fresh metadata validation", async () => {
  const f = mount(), path = "word/document.xml/w:document[0]/w:body[0]/w:p[0]", content = "合成方程😀";
  const sourceHash = `sha256:${"b".repeat(64)}`;
  f.props.chapterProposal = { status: "proposed", material_id: "synthetic-material", metadata_revision: 1, source_hash: sourceHash,
    read_only: true, automatic_prepare: false, external_send: false, chapter_suggestion: { status: "ready", title: "合成章节",
      source_spans: [{ path, start: 0, end: content.length }], content_hash: `sha256:${createHash("sha256").update(content).digest("hex")}`,
      reason_code: null, read_only: true, requires_review: true } };
  try {
    await f.ready(); const reading = f.click("查看建议");
    f.respond("source", { preview: { ...preview(1), blocks: [{ path, text: content }], source_hash: sourceHash,
      record_hash: `sha256:${"c".repeat(64)}`, read_only: true, external_send: false } });
    for (let index = 0; index < 1000 && !f.requests.some(item => item.url === "/api/edupi/education"); index++) await tick();
    assert.deepEqual(f.calls, [], "preview parsing must not focus or confirm before current metadata is checked");
    f.respond("education", { teacherMaterials: [{ material_id: "synthetic-material", metadata_revision: 1, available: true }] });
    await reading; await f.settle();
    assert.equal(f.child.dom.pieces.length, 1); assert.equal(f.document.activeElement, f.child.dom.pieces[0]);
    const part = f.find(node => node.type === "p" && node.props["data-docx-source-piece"] === path);
    assert.equal(part.props.tabIndex, -1); assert.equal(text(part), content);
    assert.equal(f.requests.filter(item => item.init.method === "POST").length, 0);
  } finally { f.unmount(); }
});

test("moving focus during source reading cancels its first-piece return", async () => {
  const f = mount();
  try {
    await f.ready(); f.click("从 DOCX 原文选取"); const target = f.moveFocus();
    f.respond("source", { preview: preview() }); await f.settle();
    assert.equal(f.document.activeElement, target); assert.deepEqual(f.calls, []); assert.equal(f.listeners.size, 0);
  } finally { f.unmount(); }
});

test("a confirmation that finishes while collapsed refreshes on reopen without restoring the old focus", async () => {
  const f = mount();
  try {
    await f.ready(); await f.read(); f.select(0); f.click("确认选中内容"); f.toggle(false);
    f.respond("post", { excerpt: { ...original, revision: 6 } }); await f.settle();
    assert.equal(f.requests.some(item => !item.finished && item.url.startsWith("/api/edupi/material-excerpt?")), false);
    assert.deepEqual(f.calls, []); f.toggle(true);
    f.respond("excerpt", { excerpt: { ...original, revision: 6 } }); await f.settle();
    assert.equal(f.child.props.expectedRevision, 6); assert.deepEqual(f.calls, []); assert.equal(f.document.activeElement, f.document.body);
  } finally { f.unmount(); }
});

test("a metadata revision change cancels source confirmation's old focus and late settle", async () => {
  const f = mount();
  try {
    await f.ready(); await f.read(); f.select(0); f.click("确认选中内容");
    const post = f.requests.find(item => item.init.method === "POST"); f.props.metadataRevision = 2; f.render();
    assert.equal(post.init.signal.aborted, true);
    f.respond("excerpt", { excerpt: original }); await f.settle();
    f.respond("post", { excerpt: { ...original, revision: 6 } }); await f.settle();
    assert.deepEqual(f.calls, []); assert.equal(f.child.props.expectedRevision, 5); assert.equal(f.listeners.size, 0);
  } finally { f.unmount(); }
});
