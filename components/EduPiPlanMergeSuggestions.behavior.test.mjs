import assert from "node:assert/strict";
import test from "node:test";
import React, { act } from "react";
import { createRoot } from "react-dom/client";
import { parseHTML } from "linkedom";
import { createJiti } from "jiti";

const jiti = createJiti(import.meta.url, { jsx: { runtime: "automatic" } });
const { EduPiPlanMergeSuggestions } = await jiti.import("./EduPiPlanMergeSuggestions.tsx");
const left = { id: "synthetic-a", name: "[UI TEST] A", date: "2026-10-30", notes: null };
const right = { ...left, id: "synthetic-b", name: "[UI TEST] B" };
const state = { version: "synthetic", needsScan: false, pairs: 1, remaining: 0,
  suggestions: [{ id: "synthetic-pair", left, right, kind: "duplicate", reason: "同一合成事项", status: "pending" }] };
const response = (body, ok = true) => ({ ok, json: async () => body });
const deferred = () => { let resolve; const promise = new Promise(yes => { resolve = yes; }); return { promise, resolve }; };

async function mount(post) {
  const previous = Object.fromEntries(["window", "document", "HTMLElement", "Event", "fetch", "IS_REACT_ACT_ENVIRONMENT"].map(key => [key, globalThis[key]]));
  const { window } = parseHTML("<html><body><div id='root'></div></body></html>");
  Object.assign(globalThis, { window, document: window.document, HTMLElement: window.HTMLElement,
    Event: window.Event, IS_REACT_ACT_ENVIRONMENT: true });
  const calls = [];
  globalThis.fetch = async (url, options = {}) => {
    calls.push({ url, method: options.method || "GET" });
    assert.equal(url, "/api/edupi/plan-overlaps");
    return options.method === "POST" ? post() : response(state);
  };
  const container = window.document.getElementById("root"), root = createRoot(container);
  const flush = () => act(async () => { await new Promise(resolve => setImmediate(resolve)); });
  const f = {
    container, calls, flush,
    async render(note = null) {
      await act(async () => root.render(React.createElement(EduPiPlanMergeSuggestions, { calendar: [{ ...left, notes: note }, right] })));
      await flush();
    },
    merge: () => [...container.querySelectorAll("button")].find(button => button.textContent === "合并"),
    async startMerge() {
      await act(async () => f.merge().dispatchEvent(new window.Event("click", { bubbles: true })));
      await flush();
    },
    async close() { await act(async () => root.unmount()); Object.assign(globalThis, previous); },
  };
  await f.render();
  return f;
}

test("keeps a failed merge visible when a refreshed calendar loads successfully", async () => {
  const error = "合并内容未能核对，请重试。";
  const f = await mount(() => response({ ...state, error }, false));
  try {
    await f.startMerge();
    assert.equal(f.container.querySelector('[role="alert"]')?.textContent, error);
    await f.render("a projection refresh after the failed write");
    assert.equal(f.container.querySelector('[role="alert"]')?.textContent, error);
    assert.equal(f.calls.filter(call => call.method === "POST").length, 1);
  } finally { await f.close(); }
});

test("a calendar reload cannot unlock controls while the merge request is still pending", async () => {
  const pending = deferred();
  const f = await mount(() => pending.promise);
  try {
    await f.startMerge();
    assert.equal(f.merge().disabled, true);
    await f.render("a concurrent projection refresh");
    assert.equal(f.merge().disabled, true);
    assert.match(f.container.textContent, /正在合并/);
    await act(async () => pending.resolve(response(state)));
    await f.flush();
    assert.equal(f.merge().disabled, false);
    assert.equal(f.calls.filter(call => call.method === "POST").length, 1);
  } finally { pending.resolve(response(state)); await f.close(); }
});
