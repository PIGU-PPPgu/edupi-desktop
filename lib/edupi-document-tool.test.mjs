import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import JSZip from "jszip";
import mammoth from "mammoth";
import { createJiti } from "jiti";

const jiti = createJiti(import.meta.url);
const { createEduPiDocumentTool } = await jiti.import("./edupi-document-tool.ts");
const input = { title: "隔离测试学案 📚", path: ".edupi/output/lesson.docx", sections: [{ heading: "认识图形", paragraphs: ["观察：1 < 2 & 3 > 2，\"正方形\"与'圆形'。", "第一行\n第二行"] }, { paragraphs: ["答案：四条边。"] }] };

function fixture(t) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "edupi-document-"));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const tool = createEduPiDocumentTool(root);
  return { root, run: (value = input, signal, cwd = root) => tool.execute("test", value, signal, undefined, { cwd }) };
}

test("native DOCX has standard parts and round-trips Chinese, Unicode and XML characters", async t => {
  const { root, run } = fixture(t);
  const result = await run();
  assert.equal(result.details.path, path.join(fs.realpathSync(root), input.path));
  assert.equal(result.details.paragraphCount, 3);
  const buffer = fs.readFileSync(result.details.path);
  const zip = await JSZip.loadAsync(buffer);
  for (const part of ["[Content_Types].xml", "_rels/.rels", "word/document.xml", "word/styles.xml", "word/_rels/document.xml.rels"]) assert.ok(zip.file(part), part);
  const extracted = await mammoth.extractRawText({ buffer });
  // Mammoth raw text omits line breaks; its HTML converter preserves w:br.
  for (const text of [input.title, "认识图形", ...input.sections.flatMap(section => section.paragraphs)]) assert.ok(extracted.value.includes(text.replace(/\n/g, "")), text);
  assert.match((await mammoth.convertToHtml({ buffer })).value, /第一行<br\s*\/>第二行/);
  assert.match(await zip.file("word/styles.xml").async("string"), /w:eastAsia="宋体"/);
  await run({ ...input, title: "修订标题", sections: [{ paragraphs: ["修订正文"] }] });
  const revised = await mammoth.extractRawText({ path: result.details.path });
  assert.ok(revised.value.includes("修订正文"));
  assert.ok(!revised.value.includes("答案：四条边。"));
});

test("DOCX rejects outside paths, traversal, workspace mismatch and invalid content", async t => {
  const { root, run } = fixture(t);
  for (const invalid of ["../outside.docx", ".edupi/output/../outside.docx", ".edupi/output/../../../outside.docx", path.join(root, input.path), ".edupi/output/file.pdf", ".edupi/output/..\\outside.docx"]) await assert.rejects(run({ ...input, path: invalid }), /输出目录/);
  await assert.rejects(run(input, undefined, os.tmpdir()), /输出目录/);
  await assert.rejects(run({ ...input, title: "\u0000" }), /无效/);
  await assert.rejects(run({ ...input, sections: [{ paragraphs: ["x".repeat(10001)] }] }), /无效/);
  await assert.rejects(run({ ...input, sections: Array.from({ length: 30 }, () => ({ paragraphs: ["x".repeat(10000)] })) }), /超过限制/);
});

test("DOCX rejects symlinks at each output boundary without writing outside workspace", async t => {
  for (const boundary of [".edupi", ".edupi/output", ".edupi/output/nested", ".edupi/output/lesson.docx"]) {
    const { root, run } = fixture(t);
    const outside = fs.mkdtempSync(path.join(os.tmpdir(), "edupi-document-outside-"));
    t.after(() => fs.rmSync(outside, { recursive: true, force: true }));
    const target = path.join(root, boundary);
    fs.mkdirSync(path.dirname(target), { recursive: true });
    fs.symlinkSync(outside, target);
    await assert.rejects(run({ ...input, path: boundary.endsWith("nested") ? `${boundary}/file.docx` : input.path }), /符号链接|普通文件/);
    assert.deepEqual(fs.readdirSync(outside), []);
  }
});

test("DOCX cancellation before and during generation leaves no file and preserves prior output", async t => {
  const { root, run } = fixture(t);
  const controller = new AbortController();
  controller.abort();
  await assert.rejects(run(input, controller.signal), { name: "AbortError" });
  assert.ok(!fs.existsSync(path.join(root, ".edupi")));
  const result = await run();
  const original = fs.readFileSync(result.details.path);
  const during = new AbortController();
  const pending = run({ ...input, title: "取消中的修订" }, during.signal);
  during.abort();
  await assert.rejects(pending, { name: "AbortError" });
  assert.deepEqual(fs.readFileSync(result.details.path), original);
  // Inject cancellation at the final checkpoint to exercise temporary-file cleanup.
  let checkpoints = 0;
  await assert.rejects(run(input, { throwIfAborted() { if (++checkpoints === 3) throw new Error("cancel at commit"); } }), /cancel at commit/);
  assert.deepEqual(fs.readFileSync(result.details.path), original);
  assert.deepEqual(fs.readdirSync(path.dirname(result.details.path)), ["lesson.docx"]);
});
