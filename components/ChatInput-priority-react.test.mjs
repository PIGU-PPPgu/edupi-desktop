import assert from "node:assert/strict";
import test from "node:test";
import React, { act } from "react";
import { create } from "react-test-renderer";
import { createJiti } from "jiti";

const jiti = createJiti(import.meta.url, { jsx: { runtime: "automatic" }, tsconfigPaths: true });
const { ChatInput } = await jiti.import("./ChatInput.tsx");
const { I18nProvider } = await jiti.import("../hooks/useI18n.tsx");
const { clearDraft, getDraft } = await jiti.import("../lib/draft-store.ts");
let caseId = 0;

async function withComposer(t, onInterruptSend, check) {
  const keys = ["window", "document", "requestAnimationFrame", "cancelAnimationFrame", "IS_REACT_ACT_ENVIRONMENT"];
  const previous = Object.fromEntries(keys.map(key => [key, globalThis[key]]));
  const storage = new Map();
  globalThis.window = Object.assign(new EventTarget(), {
    localStorage: { getItem: key => storage.get(key) ?? null, setItem: (key, value) => storage.set(key, value), removeItem: key => storage.delete(key) },
    matchMedia: () => Object.assign(new EventTarget(), { matches: false }), setTimeout, clearTimeout,
  });
  globalThis.document = Object.assign(new EventTarget(), { visibilityState: "visible", activeElement: null, documentElement: {} });
  globalThis.requestAnimationFrame = callback => { callback(); return 1; };
  globalThis.cancelAnimationFrame = () => {};
  globalThis.IS_REACT_ACT_ENVIRONMENT = true;
  const draftKey = `synthetic-priority-${++caseId}`;
  let renderer;
  t.after(async () => {
    if (renderer) await act(async () => renderer.unmount());
    clearDraft(draftKey);
    for (const [key, value] of Object.entries(previous)) {
      if (value === undefined) delete globalThis[key]; else globalThis[key] = value;
    }
  });
  await act(async () => {
    renderer = create(React.createElement(I18nProvider, { initialLocale: "en" }, React.createElement(ChatInput, {
      onSend() { throw new Error("ordinary send must not run while streaming"); }, onAbort() {},
      onInterruptSend: message => onInterruptSend(message, draftKey), isStreaming: true, draftKey,
    })), { createNodeMock: element => element.type === "textarea"
      ? { style: {}, value: "", focus() {}, setSelectionRange() {}, scrollHeight: 24 }
      : element.type === "button" ? { focus() {} } : null });
  });
  const textarea = () => renderer.root.findByType("textarea");
  const priority = () => renderer.root.findAllByType("button").find(button => button.props["aria-label"] === "Stop and send");
  await act(async () => textarea().props.onChange({ target: { value: "新要求" }, currentTarget: { value: "新要求" } }));
  assert.ok(priority());
  await act(async () => { priority().props.onClick(); await new Promise(resolve => setImmediate(resolve)); });
  await check({ draftKey, textarea, getDraft });
}

test("priority send keeps a durable draft until a confirmed new prompt", async t => {
  let savedBeforeSend, sent;
  await withComposer(t, async (message, draftKey) => { sent = message; savedBeforeSend = getDraft(draftKey)?.value; return true; },
    ({ draftKey, textarea }) => {
      assert.equal(sent, "新要求");
      assert.equal(savedBeforeSend, "新要求");
      assert.equal(textarea().props.value, "");
      assert.equal(getDraft(draftKey)?.value ?? "", "");
    });
});

test("failed priority send preserves the teacher draft", async t => {
  let calls = 0;
  await withComposer(t, async () => { calls++; throw new Error("synthetic abort failed"); },
    ({ draftKey, textarea }) => {
      assert.equal(calls, 1);
      assert.equal(textarea().props.value, "新要求");
      assert.equal(getDraft(draftKey)?.value, "新要求");
    });
});
