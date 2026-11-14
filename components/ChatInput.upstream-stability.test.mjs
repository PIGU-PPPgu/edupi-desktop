import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { createJiti } from "jiti";
import ts from "typescript";

const jiti = createJiti(import.meta.url, {
  jsx: { runtime: "automatic" },
  tsconfigPaths: true,
});

test("native clipboard image fallback handles an unreadable image without intercepting text", async () => {
  const { shouldUseNativeClipboardImageFallback } = await jiti.import("./ChatInput.tsx");

  assert.equal(shouldUseNativeClipboardImageFallback(1, "", true), false, "browser image item wins");
  assert.equal(shouldUseNativeClipboardImageFallback(0, "teacher text", true), false, "plain text paste is untouched");
  assert.equal(shouldUseNativeClipboardImageFallback(0, "", false), false, "web paste never invokes Tauri");
  assert.equal(shouldUseNativeClipboardImageFallback(0, "", true), true, "no readable image File uses native fallback, including metadata-only payloads");
});

test("thinking and tool popovers keep the upstream 60vh internal scroll boundary", async () => {
  const source = await readFile(new URL("./ChatInput.tsx", import.meta.url), "utf8");
  const ast = ts.createSourceFile("ChatInput.tsx", source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
  const menus = new Map();
  function visit(node) {
    if (ts.isJsxExpression(node) && node.expression && ts.isBinaryExpression(node.expression)
      && ["thinkingDropdownOpen", "toolDropdownOpen"].includes(node.expression.left.getText(ast))) {
      menus.set(node.expression.left.getText(ast), node.expression.getText(ast));
    }
    ts.forEachChild(node, visit);
  }
  visit(ast);
  assert.equal(menus.size, 2, "both real popup nodes must be present regardless of toolbar order");
  for (const menu of menus.values()) {
    assert.match(menu, /vh \* 0\.6/);
    assert.match(menu, /maxHeight: maxH/);
    assert.match(menu, /minHeight: 0, overflowY: "auto"/);
  }
});

test("native clipboard result rejoins the existing image processing path", async () => {
  const source = await readFile(new URL("./ChatInput.tsx", import.meta.url), "utf8");
  assert.match(source, /readClipboardImageFileNative/);
  assert.match(source, /if \(file\) processImageFiles\(\[file\]\)/);
});
