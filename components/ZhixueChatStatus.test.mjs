import assert from "node:assert/strict";
import test from "node:test";
import React, { act } from "react";
import { create } from "react-test-renderer";
import { createJiti } from "jiti";
import QRCode from "qrcode";

const { ZhixueChatStatus } = await createJiti(import.meta.url, { jsx: { runtime: "automatic" }, tsconfigPaths: true })
  .import("./ZhixueChatStatus.tsx");
const flowId = "aaaaaaaa-aaaa-4aaa-aaaa-aaaaaaaaaaaa";
const receipt = { version: 1, flowId, status: "awaiting_scan" };

test("the native dialog on an older WebView replaces its QR with the result and stops polling", async t => {
  const original = Object.fromEntries(["window", "fetch", "IS_REACT_ACT_ENVIRONMENT", "requestAnimationFrame"].map(key => [key, globalThis[key]]));
  const png = await QRCode.toDataURL("EduPi synthetic visual fixture");
  const requests = [];
  const replies = [
    { status: "awaiting_scan", qr: png.split(",")[1] },
    { status: "authenticated", needsSyncConfig: true },
  ];
  Object.assign(globalThis, {
    window: { __TAURI_INTERNALS__: { invoke: async name => {
      assert.equal(name, "get_desktop_api_token");
      return "synthetic-test-desktop-token".repeat(2);
    } } },
    fetch: async (url, options) => {
      requests.push({ url, signal: options.signal });
      assert.equal(url, `/api/edupi/zhixue/login/${flowId}`);
      assert.ok(replies.length, "terminal status must stop polling");
      return Response.json(replies.shift());
    },
    IS_REACT_ACT_ENVIRONMENT: true,
    requestAnimationFrame: callback => { callback(); return 1; },
  });
  t.mock.method(AbortSignal, "any", () => { throw new Error("Unavailable on this WebView"); });
  t.mock.method(AbortSignal, "timeout", () => { throw new Error("Unavailable on this WebView"); });
  t.mock.timers.enable({ apis: ["setTimeout"] });
  let renderer;
  try {
    await act(async () => {
      renderer = create(React.createElement(ZhixueChatStatus, { receipt, currentTurn: true, autoOpen: true }), {
        createNodeMock: element => element.type === "dialog"
          ? { open: false, showModal() { this.open = true; }, close() { this.open = false; } }
          : { focus() {} },
      });
    });
    const dialog = renderer.root.findByType("dialog");
    assert.equal(dialog.findByType("img").props.src, png);
    assert.match(dialog.findByProps({ role: "status" }).props.children, /等待扫码/);

    await act(async () => t.mock.timers.tick(2_000));
    assert.equal(dialog.findAllByType("img").length, 0);
    assert.match(dialog.findByProps({ role: "status" }).props.children, /已确认登录.*班级、学科和学段/);
    await act(async () => t.mock.timers.tick(20_000));
    assert.equal(requests.length, 2);
    await act(async () => dialog.findByProps({ "aria-label": "关闭扫码窗口" }).props.onClick());
    assert.equal(renderer.root.findAllByType("dialog").length, 0);
    assert.match(renderer.root.findByProps({ role: "status" }).props.children, /已确认登录/);
  } finally {
    if (renderer) await act(async () => renderer.unmount());
    for (const [key, value] of Object.entries(original)) {
      if (value === undefined) delete globalThis[key];
      else globalThis[key] = value;
    }
  }
});

test("a stopped background card offers to check the result instead of showing a stale wait", async () => {
  const original = Object.fromEntries(["window", "fetch", "IS_REACT_ACT_ENVIRONMENT"].map(key => [key, globalThis[key]]));
  const png = await QRCode.toDataURL("EduPi synthetic background-flow fixture");
  Object.assign(globalThis, {
    window: { __TAURI_INTERNALS__: { invoke: async () => "synthetic-test-desktop-token".repeat(2) } },
    fetch: async () => Response.json({ status: "awaiting_scan", qr: png.split(",")[1] }),
    IS_REACT_ACT_ENVIRONMENT: true,
  });
  let renderer;
  const statusCard = currentTurn => React.createElement(ZhixueChatStatus, { receipt, currentTurn, autoOpen: false });
  try {
    await act(async () => { renderer = create(statusCard(true)); });
    assert.match(renderer.root.findByProps({ role: "status" }).props.children, /等待扫码/);
    await act(async () => renderer.update(statusCard(false)));
    assert.equal(renderer.root.findAllByProps({ role: "status" }).length, 0);
    assert.equal(renderer.root.findByType("span").props.children, "查看扫码结果");
    assert.equal(renderer.root.findAllByType("img").length, 0);
  } finally {
    if (renderer) await act(async () => renderer.unmount());
    for (const [key, value] of Object.entries(original)) {
      if (value === undefined) delete globalThis[key];
      else globalThis[key] = value;
    }
  }
});

test("a restored running flow auto-opens once and stays closed after manual dismissal", async () => {
  const original = Object.fromEntries(["window", "fetch", "IS_REACT_ACT_ENVIRONMENT", "requestAnimationFrame"].map(key => [key, globalThis[key]]));
  const png = await QRCode.toDataURL("EduPi synthetic restored-flow fixture");
  Object.assign(globalThis, {
    window: { __TAURI_INTERNALS__: { invoke: async name => {
      assert.equal(name, "get_desktop_api_token");
      return "synthetic-test-desktop-token".repeat(2);
    } } },
    fetch: async (url) => {
      assert.equal(url, `/api/edupi/zhixue/login/${flowId}`);
      return Response.json({ status: "awaiting_scan", qr: png.split(",")[1] });
    },
    IS_REACT_ACT_ENVIRONMENT: true,
    requestAnimationFrame: callback => { callback(); return 1; },
  });
  let renderer;
  try {
    await act(async () => {
      renderer = create(React.createElement(ZhixueChatStatus, { receipt, currentTurn: false, autoOpen: false }), {
        createNodeMock: element => element.type === "dialog"
          ? { open: false, showModal() { this.open = true; }, close() { this.open = false; } }
          : { focus() {} },
      });
    });
    assert.equal(renderer.root.findAllByType("dialog").length, 0);

    await act(async () => {
      renderer.update(React.createElement(ZhixueChatStatus, { receipt, currentTurn: false, autoOpen: true }));
    });
    assert.equal(renderer.root.findAllByType("dialog").length, 1);

    await act(async () => renderer.root.findByProps({ "aria-label": "关闭扫码窗口" }).props.onClick());
    assert.equal(renderer.root.findAllByType("dialog").length, 0);

    await act(async () => renderer.update(React.createElement(ZhixueChatStatus, { receipt, currentTurn: false, autoOpen: false })));
    await act(async () => renderer.update(React.createElement(ZhixueChatStatus, { receipt, currentTurn: false, autoOpen: true })));
    assert.equal(renderer.root.findAllByType("dialog").length, 0);

    await act(async () => renderer.update(React.createElement(ZhixueChatStatus, { key: "manual", receipt, currentTurn: false, autoOpen: false })));
    await act(async () => renderer.root.findByType("button").props.onClick());
    assert.equal(renderer.root.findAllByType("dialog").length, 1);
    await act(async () => renderer.root.findByProps({ "aria-label": "关闭扫码窗口" }).props.onClick());
    await act(async () => renderer.update(React.createElement(ZhixueChatStatus, { key: "manual", receipt, currentTurn: false, autoOpen: true })));
    assert.equal(renderer.root.findAllByType("dialog").length, 0);
  } finally {
    if (renderer) await act(async () => renderer.unmount());
    for (const [key, value] of Object.entries(original)) {
      if (value === undefined) delete globalThis[key];
      else globalThis[key] = value;
    }
  }
});

test("a response from an unmounted flow cannot replace the current scan dialog", async () => {
  const original = Object.fromEntries(["window", "fetch", "IS_REACT_ACT_ENVIRONMENT"].map(key => [key, globalThis[key]]));
  const nextFlowId = "bbbbbbbb-bbbb-4bbb-bbbb-bbbbbbbbbbbb";
  const oldResponse = Promise.withResolvers();
  const oldRequest = Promise.withResolvers();
  Object.assign(globalThis, {
    window: { __TAURI_INTERNALS__: { invoke: async () => "synthetic-test-desktop-token".repeat(2) } },
    fetch: async (url, { signal }) => {
      if (url === `/api/edupi/zhixue/login/${flowId}`) {
        oldRequest.resolve(signal);
        return oldResponse.promise;
      }
      assert.equal(url, `/api/edupi/zhixue/login/${nextFlowId}`);
      return Response.json({ status: "expired" });
    },
    IS_REACT_ACT_ENVIRONMENT: true,
  });
  let renderer;
  try {
    const liveTurn = id => React.createElement(ZhixueChatStatus, {
      key: id, receipt: { ...receipt, flowId: id }, currentTurn: true, autoOpen: true,
    });
    await act(async () => {
      renderer = create(liveTurn(flowId), {
        createNodeMock: element => element.type === "dialog"
          ? { open: false, showModal() { this.open = true; }, close() { this.open = false; } }
          : { focus() {} },
      });
    });
    const previousSignal = await oldRequest.promise;
    await act(async () => renderer.update(liveTurn(nextFlowId)));
    assert.ok(previousSignal.aborted);
    await act(async () => oldResponse.resolve(Response.json({ status: "authenticated", needsSyncConfig: false })));

    const dialog = renderer.root.findByType("dialog");
    assert.match(dialog.findByProps({ role: "status" }).props.children, /扫码已超时/);
    assert.equal(dialog.findAllByType("img").length, 0);
  } finally {
    if (renderer) await act(async () => renderer.unmount());
    for (const [key, value] of Object.entries(original)) {
      if (value === undefined) delete globalThis[key];
      else globalThis[key] = value;
    }
  }
});
