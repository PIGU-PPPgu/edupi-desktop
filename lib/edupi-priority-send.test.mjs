import assert from "node:assert/strict";
import test from "node:test";
import { createJiti } from "jiti";

const { interruptForPrioritySend } = await createJiti(import.meta.url).import("./edupi-priority-send.ts");

test("priority message waits for abort and settlement before durable send", async () => {
  const calls = [];
  const result = await interruptForPrioritySend({
    readState: async () => { calls.push("read"); return { isStreaming: calls.length === 1 }; },
    abort: async () => { calls.push("abort"); },
    settle: async () => { calls.push("settle"); },
    stillCurrent: () => true,
    send: async () => { calls.push("send"); return true; },
  });
  assert.equal(result, true);
  assert.deepEqual(calls, ["read", "abort", "settle", "read", "send"]);
});

test("queued messages are not discarded to make room for priority send", async () => {
  let aborts = 0, sends = 0;
  await assert.rejects(interruptForPrioritySend({
    readState: async () => ({ queuedMessages: { steering: [], followUp: ["earlier"] } }),
    abort: async () => { aborts++; }, settle: async () => {}, stillCurrent: () => true,
    send: async () => { sends++; },
  }), /先召回/);
  assert.equal(aborts, 0);
  assert.equal(sends, 0);
  let reads = 0;
  await assert.rejects(interruptForPrioritySend({
    readState: async () => ++reads === 1 ? {} : { queuedMessages: { steering: ["earlier"], followUp: [] } },
    abort: async () => {}, settle: async () => {}, stillCurrent: () => true,
    send: async () => { sends++; },
  }), /先召回/);
  assert.equal(sends, 0);
});

test("session switch or a still-busy server never submits the new prompt", async () => {
  let current = true, sends = 0;
  await assert.rejects(interruptForPrioritySend({
    readState: async () => ({}), abort: async () => {}, settle: async () => { current = false; },
    stillCurrent: () => current, send: async () => { sends++; },
  }), /会话已切换/);
  await assert.rejects(interruptForPrioritySend({
    readState: async () => ({ isPromptRunning: true }), abort: async () => {}, settle: async () => {},
    stillCurrent: () => true, send: async () => { sends++; },
  }), /尚未停止/);
  let reads = 0;
  current = true;
  await assert.rejects(interruptForPrioritySend({
    readState: async () => { if (++reads === 2) current = false; return {}; },
    abort: async () => {}, settle: async () => {}, stillCurrent: () => current,
    send: async () => { sends++; },
  }), /会话已切换/);
  assert.equal(sends, 0);
});
