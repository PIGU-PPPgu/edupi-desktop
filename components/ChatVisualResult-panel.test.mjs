import assert from "node:assert/strict";
import test from "node:test";
import React, { act } from "react";
import { create } from "react-test-renderer";
import { createJiti } from "jiti";

const { ChatVisualResult } = await createJiti(import.meta.url, { jsx: { runtime: "automatic" }, tsconfigPaths: true })
  .import("./ChatVisualResult.tsx");

async function openQrInPanel(item, callbacks) {
  const previousFrame = globalThis.requestAnimationFrame;
  const previousWindow = globalThis.window;
  const previousAct = globalThis.IS_REACT_ACT_ENVIRONMENT;
  globalThis.requestAnimationFrame = callback => { callback(); return 1; };
  globalThis.window = { setInterval, clearInterval };
  globalThis.IS_REACT_ACT_ENVIRONMENT = true;
  let renderer;
  try {
    await act(async () => {
      renderer = create(React.createElement(ChatVisualResult, { items: [item], ...callbacks }), {
        createNodeMock: element => element.type === "dialog"
          ? { open: false, showModal() { this.open = true; }, close() { this.open = false; } }
          : element.type === "button" ? { focus() {} } : null,
      });
    });
    const card = renderer.root.findByProps({ "aria-label": "打开扫码窗口" });
    await act(async () => card.props.onClick({ currentTarget: { focus() {} } }));
    const panel = renderer.root.findAllByType("button").find(button => button.props.children === "在侧栏查看");
    assert.ok(panel, "the live QR dialog exposes a right-panel action");
    await act(async () => panel.props.onClick());
  } finally {
    if (renderer) await act(async () => renderer.unmount());
    if (previousFrame === undefined) delete globalThis.requestAnimationFrame;
    else globalThis.requestAnimationFrame = previousFrame;
    if (previousWindow === undefined) delete globalThis.window;
    else globalThis.window = previousWindow;
    if (previousAct === undefined) delete globalThis.IS_REACT_ACT_ENVIRONMENT;
    else globalThis.IS_REACT_ACT_ENVIRONMENT = previousAct;
  }
}

test("a QR tool image opens the right image panel", async () => {
  const src = "data:image/png;base64,AAAA";
  let opened;
  await openQrInPanel({ kind: "qr", title: "Synthetic QR", src }, { onOpenImage: value => { opened = value; } });
  assert.equal(opened, src);
});

test("a local QR path opens the allow-listed file panel", async () => {
  const filePath = "/synthetic/project/login-qr.png";
  let opened;
  await openQrInPanel({ kind: "qr", title: "Synthetic QR", filePath, src: "/api/files/synthetic/project/login-qr.png?type=read" },
    { onOpenFile: value => { opened = value; } });
  assert.equal(opened, filePath);
});
