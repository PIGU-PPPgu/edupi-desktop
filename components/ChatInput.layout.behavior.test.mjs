import assert from "node:assert/strict";
import test from "node:test";
import React, { act } from "react";
import { create } from "react-test-renderer";
import { createJiti } from "jiti";

const jiti = createJiti(import.meta.url, { jsx: { runtime: "automatic" }, tsconfigPaths: true });
const { ChatInput } = await jiti.import("./ChatInput.tsx");
const { I18nProvider } = await jiti.import("../hooks/useI18n.tsx");
const { clearDraft, getDraft, setDraft } = await jiti.import("../lib/draft-store.ts");
let sequence = 0;

const content = node => typeof node === "string" ? node : node.children?.map(content).join("") ?? "";
async function mount(t, initial = {}) {
  const saved = Object.fromEntries(["window", "document", "requestAnimationFrame", "cancelAnimationFrame", "IS_REACT_ACT_ENVIRONMENT"].map(key => [key, globalThis[key]]));
  const storage = new Map();
  globalThis.window = Object.assign(new EventTarget(), { innerWidth: 1280, innerHeight: 900,
    matchMedia: () => Object.assign(new EventTarget(), { matches: false }),
    localStorage: { getItem: key => storage.get(key) ?? null, setItem: (key, value) => storage.set(key, value), removeItem: key => storage.delete(key) },
    setTimeout, clearTimeout,
  });
  globalThis.document = Object.assign(new EventTarget(), { visibilityState: "visible", activeElement: null, documentElement: {} });
  Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true, requestAnimationFrame: callback => { callback(); return 1; }, cancelAnimationFrame() {} });
  const draftKey = `synthetic-composer-layout-${++sequence}`;
  const sent = [], models = [], reasoning = [], permissions = [];
  let stops = 0, renderer;
  const props = {
    teacherMode: true, isStreaming: false, draftKey, onSend: message => { sent.push(message); return true; },
    onAbort: () => { stops++; }, onInterruptSend: async () => false,
    onModelChange: (...value) => models.push(value), model: { provider: "synthetic", modelId: "model-a" },
    modelList: [{ provider: "synthetic", id: "model-a", name: "Synthetic A" }, { provider: "synthetic", id: "model-b", name: "Synthetic B" }],
    onThinkingLevelChange: value => reasoning.push(value), thinkingLevel: "medium", availableThinkingLevels: ["low", "medium", "high"],
    onPermissionModeChange: value => permissions.push(value), ...initial,
  };
  const run = callback => act(async () => { callback(); });
  const render = async next => {
    Object.assign(props, next);
    await act(async () => {
      const element = React.createElement(I18nProvider, { initialLocale: "en" }, React.createElement(ChatInput, props));
      if (renderer) renderer.update(element);
      else renderer = create(element, { createNodeMock: element => element.type === "textarea"
        ? { style: {}, value: "", focus() {}, setSelectionRange() {}, scrollHeight: 60 }
        : { focus() {}, querySelector: () => null } });
    });
  };
  t.after(async () => {
    if (renderer) await act(async () => renderer.unmount());
    clearDraft(draftKey);
    for (const [key, value] of Object.entries(saved)) {
      if (value === undefined) delete globalThis[key]; else globalThis[key] = value;
    }
  });
  const f = {
    sent, models, reasoning, permissions, draftKey, render, run,
    get stops() { return stops; },
    root: () => renderer.root,
    field: () => renderer.root.findByType("textarea"),
    region: className => renderer.root.findByProps({ className }),
    button: label => renderer.root.findAllByType("button").find(node => node.props["aria-label"] === label || node.props.title === label || content(node) === label),
    edit: value => run(() => f.field().props.onChange({ target: { value, selectionStart: value.length } })),
    click: label => run(() => {
      const button = f.button(label);
      assert.ok(button, label);
      button.props.onClick({ currentTarget: { getBoundingClientRect: () => ({ top: 700, left: 800, width: 160 }) } });
    }),
  };
  await render({});
  return f;
}

test("the single composer surface contains native editing above working permission, model and reasoning controls", async t => {
  const f = await mount(t);
  const editor = f.region("chat-composer-editor");
  assert.equal(editor.findAllByType("textarea").length, 1);
  assert.equal(editor.findAllByType("button").length, 0);
  const primary = f.region("chat-composer-primary-tools"), modelTools = f.region("chat-composer-model-tools");
  assert.ok(primary.findByProps({ "aria-label": "选择访问权限" }));
  assert.ok(modelTools.findByProps({ "aria-label": "Change reasoning level" }));
  assert.ok(modelTools.findByProps({ "aria-label": "Send" }));
  await f.edit("[UI TEST] 保留草稿");
  await f.click("Change model"); await f.click("Synthetic B");
  assert.deepEqual(f.models, [["synthetic", "model-b"]]);
  await f.click("Change reasoning level");
  const high = f.root().findAllByType("button").find(node => node.children.some(child => typeof child !== "string" && content(child).startsWith("high")));
  assert.ok(high);
  await f.run(() => high.props.onClick());
  assert.deepEqual(f.reasoning, ["high"]);
  await f.click("选择访问权限"); await f.click("完全访问访问工作区和 Core 写入能力");
  assert.deepEqual(f.permissions, ["full"]);
  assert.equal(f.field().props.value, "[UI TEST] 保留草稿");
  assert.equal(f.sent.length, 0);
});

test("streaming keeps priority send and stop directly in the visible model toolbar", async t => {
  const f = await mount(t, { isStreaming: true });
  await f.edit("[UI TEST] 流式补充");
  const tools = f.region("chat-composer-model-tools");
  assert.ok(tools.findByProps({ "aria-label": "Stop and send" }));
  const stop = tools.findByProps({ "aria-label": "Stop agent" });
  await f.run(() => stop.props.onClick());
  assert.equal(f.stops, 1);
  assert.equal(f.field().props.value, "[UI TEST] 流式补充");
});

test("IME composition and its trailing Enter cannot submit the moved native editor", async t => {
  const f = await mount(t);
  await f.edit("[UI TEST] 合成输入");
  const enter = { key: "Enter", nativeEvent: { isComposing: false }, preventDefault() {}, stopPropagation() {} };
  await f.run(() => {
    f.field().props.onCompositionStart();
    f.field().props.onKeyDown(enter);
    f.field().props.onCompositionEnd({ currentTarget: { value: "[UI TEST] 合成输入", selectionStart: 18 } });
    f.field().props.onKeyDown(enter);
  });
  assert.equal(f.sent.length, 0);
  assert.equal(getDraft(f.draftKey)?.value, "[UI TEST] 合成输入");
  await new Promise(resolve => setTimeout(resolve, 110));
  await f.run(() => f.field().props.onKeyDown(enter));
  assert.deepEqual(f.sent, ["[UI TEST] 合成输入"]);
  assert.equal(f.field().props.value, "");
});

test("real stored attachments and references stay inside the same surface and remain removable", async t => {
  const f = await mount(t);
  const restoredKey = `${f.draftKey}-restored`;
  t.after(() => clearDraft(restoredKey));
  setDraft(restoredKey, { value: "", images: [{ mimeType: "image/png", data: "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+a9eUAAAAASUVORK5CYII=" }],
    context: { title: "合成参考", reference: "[UI TEST] 参考内容" } });
  await f.render({ draftKey: restoredKey });
  const surface = f.region("chat-composer");
  assert.ok(surface.findByProps({ className: "chat-composer-context" }));
  assert.ok(surface.findByProps({ "aria-label": "移除图片 1" }));
  assert.equal(surface.findAllByType("textarea").length, 1);
  await f.click("移除合成参考参考");
  assert.equal(f.root().findAllByProps({ className: "chat-composer-context" }).length, 0);
  await f.click("移除图片 1");
  assert.equal(f.root().findAllByType("img").length, 0);
});
