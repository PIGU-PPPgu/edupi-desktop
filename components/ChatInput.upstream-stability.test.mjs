import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { createJiti } from "jiti";

const jiti = createJiti(import.meta.url, {
  jsx: { runtime: "automatic" },
  tsconfigPaths: true,
});

test("native clipboard image fallback is exclusive to an empty desktop paste payload", async () => {
  const { shouldUseNativeClipboardImageFallback } = await jiti.import("./ChatInput.tsx");

  assert.equal(shouldUseNativeClipboardImageFallback(1, "", true), false, "browser image item wins");
  assert.equal(shouldUseNativeClipboardImageFallback(0, "teacher text", true), false, "plain text paste is untouched");
  assert.equal(shouldUseNativeClipboardImageFallback(0, "", false), false, "web paste never invokes Tauri");
  assert.equal(shouldUseNativeClipboardImageFallback(0, "", true), true, "empty desktop payload uses native fallback");
});

test("thinking and tool popovers keep the upstream 60vh internal scroll boundary", async () => {
  const source = await readFile(new URL("./ChatInput.tsx", import.meta.url), "utf8");
  const thinking = source.slice(
    source.indexOf("{thinkingDropdownOpen && (() =>"),
    source.indexOf("{!isStreaming && onToolPresetChange"),
  );
  const tools = source.slice(
    source.indexOf("{toolDropdownOpen && (() =>"),
    source.indexOf("{!isStreaming && onCompact"),
  );

  for (const menu of [thinking, tools]) {
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
