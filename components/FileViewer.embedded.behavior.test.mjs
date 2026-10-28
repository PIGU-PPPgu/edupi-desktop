import assert from "node:assert/strict";
import fs from "node:fs";
import test from "node:test";
import vm from "node:vm";
import ts from "typescript";
import React, { act } from "react";
import { createRoot } from "react-dom/client";
import { jsx, jsxs, Fragment } from "react/jsx-runtime";
import { parseHTML } from "linkedom";
import { createJiti } from "jiti";

const jiti = createJiti(import.meta.url);
const fileTypes = await jiti.import("../lib/file-types.ts"), paths = await jiti.import("../lib/file-paths.ts");
const source = fs.readFileSync(new URL("./FileViewer.tsx", import.meta.url), "utf8");
const code = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.ReactJSX, esModuleInterop: true } }).outputText;
const filePath = "/synthetic/.edupi/inbox/material-synthetic.docx", sessionId = "synthetic-session";
const labels = { "i18n.preview": "预览", "i18n.docxPreview": "DOCX 预览", "i18n.openWithDefaultApp": "打开", "i18n.revealFile": "定位", "i18n.downloadFile": "下载" };

async function mount(embedded, file = filePath) {
  const { window } = parseHTML("<html><body><div id='root'></div></body></html>"), old = {};
  for (const key of ["window", "document", "HTMLElement", "IS_REACT_ACT_ENVIRONMENT"]) old[key] = globalThis[key];
  Object.assign(globalThis, { window, document: window.document, HTMLElement: window.HTMLElement, IS_REACT_ACT_ENVIRONMENT: true });
  window.getSelection = () => null;
  const events = [], actions = [], requests = [];
  class EventSource {
    listeners = new Map();
    constructor(url) { this.url = url; events.push(this); }
    addEventListener(name, callback) { this.listeners.set(name, callback); }
    close() {}
    emit(name, data) { this.listeners.get(name)?.({ data: JSON.stringify(data) }); }
  }
  const modules = {
    react: React, "react/jsx-runtime": { jsx, jsxs, Fragment }, "react-syntax-highlighter": {},
    "@/lib/syntax-highlighting": { SyntaxHighlighter: () => null, vs: {}, vscDarkPlus: {} }, "react-markdown": () => null,
    "@/hooks/useTheme": { useTheme: () => ({ isDark: false }) }, "@/lib/file-types": fileTypes, "@/lib/file-paths": paths,
    "@/lib/file-links": {}, "@/lib/markdown": {}, "./MermaidBlock": {}, "@/lib/patch": {},
    "./FileIcons": { getFileIcon: () => jsx("span", {}) },
    "@/hooks/useI18n": { useI18n: () => ({ t: (key, args) => key === "i18n.previewFile" ? `预览 ${args.file}` : labels[key] || key }) },
    "./EduPiUsageObservation": { useArtifactUsageTarget: () => null, useUsageVisibility: () => ({ current: null }) },
    "@/lib/edupi-usage-observation": {},
    "@/lib/desktop-native": { isTauriDesktop: () => true, openPathNative: path => { actions.push(["open", path]); },
      revealItemInDirNative: path => { actions.push(["reveal", path]); }, saveLocalFileAs: (...args) => { actions.push(["save", ...args]); return Promise.resolve(false); } },
  };
  const exports = {};
  vm.runInNewContext(code, { exports, window, document: window.document, EventSource, URLSearchParams, console,
    fetch: async url => {
      requests.push(url);
      const query = new URL(url, "http://localhost");
      const value = query.pathname === "/api/git/diff" ? { supported: false }
        : query.searchParams.get("type") === "read" ? { content: "[UI TEST] 文字", language: "text", size: 128 } : { size: 128 };
      return { ok: true, json: async () => value };
    },
    require(name) { assert.ok(Object.hasOwn(modules, name), `unexpected component import ${name}`); return modules[name]; } });
  const container = window.document.getElementById("root"), root = createRoot(container);
  const flush = () => act(async () => { for (let i = 0; i < 5; i++) await new Promise(resolve => setImmediate(resolve)); });
  const f = { container, requests, actions, events, flush,
    async click(label) {
      const button = [...container.querySelectorAll("button")].find(button => button.getAttribute("aria-label") === label);
      assert.ok(Boolean(button), `missing ${label}`);
      await act(async () => button.dispatchEvent(new window.Event("click", { bubbles: true }))); await flush();
    },
    async close() { await act(async () => root.unmount()); Object.assign(globalThis, old); },
  };
  const props = { filePath: file, cwd: "/synthetic", sourceSessionId: sessionId, ...(embedded === undefined ? {} : { embedded }) };
  await act(async () => root.render(jsx(exports.FileViewer, props))); await flush(); return f;
}

test("normal FileViewer keeps its path, named preview and unflagged DOCX URL", async () => {
  const f = await mount();
  try {
    assert.equal(f.container.querySelector(".file-viewer-path")?.textContent, ".edupi/inbox/material-synthetic.docx");
    const iframe = f.container.querySelector("iframe"), url = new URL(iframe.src, "http://localhost");
    assert.equal(iframe.title, "预览 material-synthetic.docx"); assert.equal(url.searchParams.has("embedded"), false);
    assert.equal(url.searchParams.get("sessionId"), sessionId);
    assert.equal(iframe.getAttribute("sandbox"), "allow-same-origin");
  } finally { await f.close(); }
});

test("embedded DOCX hides duplicate identity and keeps a generic accessible preview and bust flag", async () => {
  const f = await mount(true);
  try {
    assert.ok(f.container.querySelector(".file-viewer-path") === null);
    assert.equal(f.container.querySelector("iframe")?.title, "预览");
    let url = new URL(f.container.querySelector("iframe").src, "http://localhost");
    assert.equal(url.searchParams.get("embedded"), "1"); assert.equal(url.searchParams.get("sessionId"), sessionId);
    await act(async () => f.events[0].emit("change", { size: 129 })); await f.flush();
    url = new URL(f.container.querySelector("iframe").src, "http://localhost");
    assert.equal(url.searchParams.get("v"), "1"); assert.equal(url.searchParams.get("embedded"), "1");
  } finally { await f.close(); }
});

test("embedded open, reveal and download still use the canonical path and original session", async () => {
  const f = await mount(true);
  try {
    await f.click("打开"); await f.click("定位"); await f.click("下载");
    assert.deepEqual(f.actions.slice(0, 2), [["open", filePath], ["reveal", filePath]]);
    assert.equal(f.actions[2][0], "save"); assert.equal(f.actions[2][1], filePath); assert.equal(f.actions[2][2], "material-synthetic.docx");
    const url = new URL(f.actions[2][3], "http://localhost");
    assert.equal(url.searchParams.get("type"), "download"); assert.equal(url.searchParams.get("sessionId"), sessionId); assert.equal(url.searchParams.has("embedded"), false);
  } finally { await f.close(); }
});

test("embedded PDF keeps the direct read URL and existing sandbox behavior", async () => {
  const f = await mount(true, "/synthetic/material.pdf");
  try {
    const iframe = f.container.querySelector("iframe"), url = new URL(iframe.src, "http://localhost");
    assert.ok(f.container.querySelector(".file-viewer-path") === null);
    assert.equal(iframe.title, "预览"); assert.equal(url.searchParams.get("type"), "read");
    assert.equal(url.searchParams.has("embedded"), false); assert.equal(iframe.getAttribute("sandbox"), null);
  } finally { await f.close(); }
});

for (const [extension, media] of [["png", "img"], ["wav", "audio"], ["txt", null]]) {
  test(`embedded ${extension} hides only the toolbar path and preserves canonical reads`, async () => {
    const file = `/synthetic/material.${extension}`, f = await mount(true, file);
    try {
      assert.ok(f.container.querySelector(".file-viewer-toolbar") !== null);
      assert.ok(f.container.querySelector(".file-viewer-path") === null);
      const read = media ? f.container.querySelector(media)?.getAttribute("src") : f.requests.find(url => new URL(url, "http://localhost").searchParams.get("type") === "read");
      assert.ok(Boolean(read));
      const url = new URL(read, "http://localhost");
      assert.equal(url.pathname, `/api/files/${paths.encodeFilePathForApi(file)}`);
      assert.equal(url.searchParams.get("type"), "read");
      assert.equal(url.searchParams.get("sessionId"), sessionId);
      assert.equal(url.searchParams.has("embedded"), false);
    } finally { await f.close(); }
  });
}
