import assert from "node:assert/strict";
import test from "node:test";
import { createJiti } from "jiti";

const { isPreviewableImageSource } = await createJiti(import.meta.url).import("./chat-image-source.ts");

test("chat preview accepts deferred session images but not arbitrary local endpoints", () => {
  assert.equal(isPreviewableImageSource("/api/sessions/11111111-1111-4111-8111-111111111111/entries/abc12345/image?blockIndex=2"), true);
  assert.equal(isPreviewableImageSource("data:image/png;base64,AAAA"), true);
  assert.equal(isPreviewableImageSource("/api/files/private/teacher/secret.png?type=read"), false);
  assert.equal(isPreviewableImageSource("/api/sessions/x/entries/y/image?blockIndex=2&other=1"), false);
  assert.equal(isPreviewableImageSource("data:image/svg+xml;base64,AAAA"), false);
  assert.equal(isPreviewableImageSource("javascript:alert(1)"), false);
});
