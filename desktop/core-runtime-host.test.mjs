import assert from "node:assert/strict";
import { EventEmitter } from "node:events";
import test from "node:test";
import { createParentModelExecutor } from "./core-runtime-host.mjs";

test("private model IPC correlates results, forwards cancellation and rejects on disconnect", async () => {
  const channel = new EventEmitter(); channel.connected = true;
  const sent = []; channel.send = (value, callback) => { sent.push(value); callback?.(); };
  const host = createParentModelExecutor(channel);
  const controller = new AbortController();
  const request = { deadline_at: new Date(Date.now() + 20000).toISOString(), input: { title: "Synthetic" } };
  const running = host.run(request, { signal: controller.signal });
  const id = sent[0].id;
  assert.deepEqual(sent[0], { type: "model-run", id, request });
  controller.abort();
  assert.deepEqual(sent[1], { type: "model-cancel", id });
  channel.emit("message", { type: "unrelated", id, result: "ignored" });
  channel.emit("message", { type: "model-result", id: "wrong", result: "ignored" });
  channel.emit("message", { type: "model-result", id, result: { ok: false, error_code: "cancelled" } });
  assert.deepEqual(await running, { ok: false, error_code: "cancelled" });
  const disconnected = host.run(request, { signal: new AbortController().signal });
  channel.connected = false; channel.emit("disconnect");
  await assert.rejects(disconnected, { code: "model_unavailable" });
  host.close();
});
