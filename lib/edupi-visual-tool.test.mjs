import assert from "node:assert/strict";
import test from "node:test";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { createJiti } from "jiti";

const { createEduPiQrTool, createEduPiShowImageTool } = await createJiti(import.meta.url, { tsconfigPaths: true }).import("./edupi-visual-tool.ts");

test("QR tool returns a scannable PNG block without repeating its payload in visible text", async () => {
  const tool = createEduPiQrTool();
  const result = await tool.execute("qr-1", { text: "https://example.invalid/teacher", title: "扫码" }, new AbortController().signal);
  const image = result.content.find(block => block.type === "image");
  assert.equal(image?.mimeType, "image/png");
  assert.deepEqual(Buffer.from(image.data, "base64").subarray(0, 8), Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]));
  assert.equal(result.details.visual.kind, "qr");
  assert.doesNotMatch(result.content.find(block => block.type === "text").text, /example\.invalid/);
});

test("image display tool accepts an output image and rejects a symlink out of the workspace", async t => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "edupi-chat-visual-"));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const output = path.join(root, ".edupi/output");
  fs.mkdirSync(output, { recursive: true });
  const image = path.join(output, "diagram.png");
  fs.writeFileSync(image, Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO8B9l0AAAAASUVORK5CYII=", "base64"));
  const tool = createEduPiShowImageTool(root);
  const context = { cwd: root };
  const result = await tool.execute("image-1", { path: ".edupi/output/diagram.png" }, new AbortController().signal, () => {}, context);
  assert.equal(result.details.visual.path, fs.realpathSync(image));
  assert.equal(result.content.some(block => block.type === "image"), false, "the file bytes stay out of the model context");
  const outside = path.join(os.tmpdir(), `edupi-outside-${path.basename(root)}.png`);
  fs.writeFileSync(outside, fs.readFileSync(image));
  t.after(() => fs.rmSync(outside, { force: true }));
  fs.symlinkSync(outside, path.join(output, "outside.png"));
  await assert.rejects(() => tool.execute("image-2", { path: ".edupi/output/outside.png" }, new AbortController().signal, () => {}, context), /输出目录/);
});
