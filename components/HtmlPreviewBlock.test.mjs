import assert from "node:assert/strict";
import test from "node:test";
import { createJiti } from "jiti";

const { sandboxedHtml } = await createJiti(import.meta.url, { tsconfigPaths: true, jsx: { runtime: "automatic" } }).import("./HtmlPreviewBlock.tsx");

test("HTML visual output is sandboxed and cannot load scripts or remote resources", () => {
  const srcDoc = sandboxedHtml('<svg><circle cx="40" cy="40" r="30"/></svg><script>parent.leak=true</script><img src="https://example.invalid/pixel">');
  assert.match(srcDoc, /script-src 'none'/);
  assert.match(srcDoc, /connect-src 'none'/);
  assert.match(srcDoc, /img-src data:/);
  assert.match(srcDoc, /frame-src 'none'/);
  assert.match(srcDoc, /<svg>/);
});
