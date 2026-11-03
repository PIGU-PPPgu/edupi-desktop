import assert from "node:assert/strict";
import test from "node:test";
import { createJiti } from "jiti";

const { collectTurnVisualItems } = await createJiti(import.meta.url, { tsconfigPaths: true, jsx: { runtime: "automatic" } }).import("./ChatWindow.tsx");

test("a completed turn retains its QR result independent of the collapsed process messages", () => {
  const url = "/api/sessions/session-1/entries/tr1/image?blockIndex=1";
  const messages = [
    { role: "user", content: "扫码" },
    { role: "assistant", provider: "test", model: "test", content: [{ type: "toolCall", toolCallId: "qr-1", toolName: "edupi_show_qr", input: {} }] },
    { role: "toolResult", toolCallId: "qr-1", content: [{ type: "image", source: { type: "url", url } }], details: { visual: { kind: "qr", title: "扫码" } } },
    { role: "assistant", provider: "test", model: "test", content: [{ type: "text", text: "请扫码。" }] },
  ];
  assert.deepEqual(collectTurnVisualItems(messages, 1, 4, "/tmp/workspace", "session-1"), [{ src: url, title: "扫码", kind: "qr" }]);
  assert.deepEqual(collectTurnVisualItems(messages, 4, 4, "/tmp/workspace", "session-1"), []);
});
