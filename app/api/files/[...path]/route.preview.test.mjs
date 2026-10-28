import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import vm from "node:vm";
import ts from "typescript";
import { parseHTML } from "linkedom";
import { createJiti } from "jiti";

const jiti = createJiti(import.meta.url);
const types = await jiti.import("../../../../lib/file-types.ts");
const security = await jiti.import("../../../../lib/path-security.ts");
const source = fs.readFileSync(new URL("./route.ts", import.meta.url), "utf8");
const code = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, esModuleInterop: true } }).outputText;
const body = "<h1>[UI TEST] 文档自己的标题</h1><p>2x+3=11，x=4</p>";

function fixture(t) {
  const root = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), "edupi-preview-embedded-")));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const allowed = path.join(root, "allowed"), outside = path.join(root, "outside");
  fs.mkdirSync(allowed); fs.mkdirSync(outside);
  const file = path.join(allowed, "material-synthetic.docx");
  fs.writeFileSync(file, "[UI TEST] synthetic document input");
  const conversions = [];
  const mocks = {
    "next/server": { NextResponse: { json: (data, options) => new Response(JSON.stringify(data), { ...options, headers: { "content-type": "application/json" } }) } },
    fs, path,
    "@/lib/file-access": { getAllowedFileRoots: async () => new Set([allowed]),
      isFilePathAllowed: security.isPathWithinRoots, isExistingFilePathAllowed: security.isExistingPathWithinRoots,
      isWindowsAbsolutePath: value => /^[a-zA-Z]:[\\/]/.test(value) || value.startsWith("//"), normalizeSlashes: value => value.replace(/\\/g, "/") },
    "@/lib/file-types": types,
    "@/lib/file-dirent": {}, "@/lib/session-file-references": { isFilePathReferencedBySession: async () => false },
    "@/lib/request-security": {}, "@/lib/file-upload": {}, "@/lib/bounded-form-data": {},
    "@/lib/desktop-api-auth": {}, "@/lib/edupi-managed-path": {},
    mammoth: { images: { dataUri: "synthetic-converter" }, convertToHtml: async (input, options) => { conversions.push({ input, options }); return { value: body }; } },
  };
  const exports = {};
  vm.runInNewContext(code + "\nexports.previewTemplateProbe = wrapDocxPreviewHtml;", { exports, process, Buffer, Uint8Array,
    ReadableStream, TextEncoder, Response, console, setTimeout, clearTimeout,
    require(name) { assert.ok(Object.hasOwn(mocks, name), `unexpected route import ${name}`); return mocks[name]; } });
  return { root, allowed, outside, file, conversions,
    template: exports.previewTemplateProbe,
    async get(filePath = file, flag = null, type = "preview") {
      const url = new URL("http://localhost/api/files/synthetic"); url.searchParams.set("type", type);
      if (flag !== null) url.searchParams.set("embedded", flag);
      return exports.GET({ nextUrl: url, headers: new Headers() }, { params: Promise.resolve({ path: filePath.replace(/\\/g, "/").split("/").filter(Boolean) }) });
    },
  };
}

test("default DOCX wrapper escapes the filename and preserves the document's own title", t => {
  const f = fixture(t), name = '<img src=x onerror="bad()"> & \' TEST.docx';
  const html = f.template(body, name);
  const { document } = parseHTML(html);
  assert.equal(document.querySelector(".file-title")?.textContent, name);
  assert.equal(document.querySelectorAll("img").length, 0);
  assert.equal(document.querySelector("h1")?.textContent, "[UI TEST] 文档自己的标题");
});

test("embedded DOCX GET omits only the wrapper filename and keeps converted content and security headers", async t => {
  const f = fixture(t), response = await f.get(f.file, "1"), html = await response.text();
  assert.equal(response.status, 200);
  const { document } = parseHTML(html);
  assert.ok(document.querySelector(".file-title") === null);
  assert.equal(document.querySelector("h1")?.textContent, "[UI TEST] 文档自己的标题");
  assert.equal(document.querySelector("p")?.textContent, "2x+3=11，x=4");
  assert.equal(document.body.textContent.includes("material-synthetic.docx"), false);
  assert.equal(f.conversions.length, 1);
  assert.equal(f.conversions[0].input.path, f.file);
  assert.equal(f.conversions[0].options.externalFileAccess, false);
  assert.equal(response.headers.get("Content-Security-Policy"), "default-src 'none'; img-src data:; style-src 'unsafe-inline'; base-uri 'none'; form-action 'none'; frame-ancestors 'self'");
  assert.equal(response.headers.get("Referrer-Policy"), "no-referrer");
  assert.equal(response.headers.get("X-Content-Type-Options"), "nosniff");
});

test("only exact embedded=1 changes the wrapper; other values never become markup", async t => {
  const f = fixture(t);
  for (const flag of [null, "0", "true", "01", '1\"><script>bad()</script>']) {
    const response = await f.get(f.file, flag), html = await response.text();
    assert.equal(response.status, 200);
    const { document } = parseHTML(html);
    assert.equal(document.querySelector(".file-title")?.textContent, "material-synthetic.docx");
    assert.equal(document.querySelectorAll("script").length, 0);
    if (flag?.includes("script")) assert.equal(html.includes(flag), false);
  }
});

test("embedded never expands allowed roots or symlink authority", async t => {
  const f = fixture(t), outside = path.join(f.outside, "private.docx"); fs.writeFileSync(outside, "[UI TEST] outside");
  for (const flag of [null, "1"]) assert.equal((await f.get(outside, flag)).status, 403);
  const link = path.join(f.allowed, "link");
  try { fs.symlinkSync(f.outside, link, process.platform === "win32" ? "junction" : "dir"); }
  catch (error) { if (process.platform === "win32" && ["EPERM", "EACCES"].includes(error.code)) { t.skip("symlink creation requires host permission"); return; } throw error; }
  for (const flag of [null, "1"]) assert.equal((await f.get(path.join(link, "private.docx"), flag)).status, 403);
  assert.equal(f.conversions.length, 0);
});

test("embedded retains the DOCX size limit and rejects other preview types", async t => {
  const f = fixture(t), large = path.join(f.allowed, "large.docx"), text = path.join(f.allowed, "plain.txt");
  fs.writeFileSync(large, Buffer.alloc(types.DOCX_PREVIEW_MAX_BYTES + 1)); fs.writeFileSync(text, "[UI TEST]");
  assert.equal((await f.get(large, "1")).status, 413);
  assert.equal((await f.get(text, "1")).status, 400);
  assert.equal(f.conversions.length, 0);
});

test("embedded does not change file bytes returned by read and download", async t => {
  const f = fixture(t), expected = fs.readFileSync(f.file).toString();
  for (const type of ["read", "download"]) {
    const response = await f.get(f.file, "1", type);
    assert.equal(response.status, 200); assert.equal(await response.text(), expected);
    if (type === "download") assert.match(response.headers.get("Content-Disposition"), /material-synthetic\.docx/);
  }
  assert.equal(f.conversions.length, 0);
});
