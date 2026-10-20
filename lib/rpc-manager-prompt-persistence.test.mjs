import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { randomUUID } from "node:crypto";
import test from "node:test";
import { SessionManager } from "@earendil-works/pi-coding-agent";
import { createJiti } from "jiti";

const jiti = createJiti(import.meta.url, { tsconfigPaths: true });
const { AgentSessionWrapper } = await jiti.import("./rpc-manager.ts");
const { inspectEduPiPromptSession } = await jiti.import("./edupi-prompt-reconciliation.ts");

function fixture(t, { failure = null, failureOnce = false, receiptFailure = false,
  savedMessage = null, images = undefined, savedImages = null, userGate = null, modelFailure = false } = {}) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "edupi-rpc-persistence-"));
  const manager = SessionManager.create(root, path.join(root, "sessions"));
  manager.appendMessage({ role: "user", content: "合成历史", timestamp: Date.now() });
  if (receiptFailure) {
    const append = manager.appendCustomEntry.bind(manager);
    manager.appendCustomEntry = (type, data) => {
      if (type === "edupi_prompt_accepted_v1") throw new Error("synthetic receipt write failure");
      return append(type, data);
    };
  }
  const command = { type: "prompt", message: "完整 SDK 合成消息\n", clientRequestId: randomUUID(),
    ...(images === undefined ? {} : { images }) };
  let listener;
  let prompts = 0;
  const inner = { sessionManager: manager, sessionId: manager.getSessionId(),
    isBashRunning: false, isStreaming: false, isCompacting: false,
    extensionRunner: {}, dispose() {}, subscribe: callback => { listener = callback; return () => {}; },
    prompt: async (message, options) => {
      prompts++;
      if (failure && (!failureOnce || prompts === 1)) throw new Error(failure);
      if (userGate) await userGate;
      const user = { role: "user", content: [{ type: "text", text: savedMessage ?? message },
        ...(savedImages ?? options.images ?? [])], timestamp: Date.now() };
      listener({ type: "message_end", message: user });
      manager.appendMessage(user);
      if (modelFailure) { await Promise.resolve(); throw new Error("synthetic model failed after accepted user"); }
    },
  };
  const wrapper = new AgentSessionWrapper(inner);
  wrapper.start();
  t.after(() => { wrapper.destroy(); fs.rmSync(root, { recursive: true, force: true }); });
  return { command, wrapper, manager, proof: () => inspectEduPiPromptSession({ command,
    clientRequestId: command.clientRequestId, sessionId: manager.getSessionId() }, manager.getSessionFile()) };
}

test("direct durable dispatch records a session-scoped request marker and cold SDK proof before returning", async t => {
  const f = fixture(t);
  await f.wrapper.send({ ...f.command, awaitUserPersistence: true });
  assert.equal(f.proof(), "confirmed");
  const marker = SessionManager.open(f.manager.getSessionFile()).getEntries().find(entry => entry.customType === "edupi_prompt_dispatch_v1");
  assert.equal(marker.data.sessionId, f.manager.getSessionId());
  const receipt = SessionManager.open(f.manager.getSessionFile()).getEntries().find(entry => entry.customType === "edupi_prompt_accepted_v1");
  assert.equal(receipt?.data.clientRequestId, f.command.clientRequestId);
  assert.equal(typeof receipt.data.userEntryId, "string");
  await assert.rejects(f.wrapper.send({ ...f.command, awaitUserPersistence: true }), /already submitted/);
  assert.equal(SessionManager.open(f.manager.getSessionFile()).getEntries().filter(entry => entry.customType === "edupi_prompt_dispatch_v1").length, 1);
});

test("a failed request cannot borrow a later unmarked raw prompt's identical SDK user entry", async t => {
  const f = fixture(t, { failure: "synthetic preflight failure", failureOnce: true });
  await assert.rejects(f.wrapper.send({ ...f.command, awaitUserPersistence: true }), /durably recorded/);
  await f.wrapper.send({ type: "prompt", message: f.command.message });
  await new Promise(resolve => setImmediate(resolve));
  assert.equal(f.proof(), "unknown");
});

test("an accepted-receipt write failure preserves unknown even when the SDK user was already saved", async t => {
  const f = fixture(t, { receiptFailure: true });
  await assert.rejects(f.wrapper.send({ ...f.command, awaitUserPersistence: true }), /durably recorded/);
  assert.equal(f.proof(), "unknown");
  const saved = SessionManager.open(f.manager.getSessionFile()).getEntries();
  assert.ok(saved.some(entry => entry.type === "message" && entry.message.role === "user"
    && entry.message.content?.[0]?.text === f.command.message));
});

test("a late SDK user can acquire its positive receipt after the HTTP persistence deadline without replay", async t => {
  t.mock.timers.enable({ apis: ["setTimeout"] });
  let release;
  const f = fixture(t, { userGate: new Promise(resolve => { release = resolve; }) });
  const sent = f.wrapper.send({ ...f.command, awaitUserPersistence: true });
  await Promise.resolve();
  t.mock.timers.tick(20_000);
  await assert.rejects(sent, /durably recorded/);
  assert.equal(f.proof(), "marker_only");
  release();
  await new Promise(resolve => setImmediate(resolve));
  assert.equal(f.proof(), "confirmed");
});

test("a later model failure never rewrites the positively accepted SDK user as undelivered", async t => {
  const f = fixture(t, { modelFailure: true });
  await f.wrapper.send({ ...f.command, awaitUserPersistence: true });
  await new Promise(resolve => setImmediate(resolve));
  assert.equal(f.proof(), "confirmed");
});

test("preflight failure, cancellation and altered SDK user text never provide an accepted durable receipt", async t => {
  for (const config of [{ failure: "synthetic_preflight_failure" }, { failure: "synthetic_cancelled" }, { savedMessage: "被改变的内容" }]) {
    const f = fixture(t, config);
    await assert.rejects(f.wrapper.send({ ...f.command, awaitUserPersistence: true }), /durably recorded/);
    assert.notEqual(f.proof(), "confirmed");
  }
});

test("an image receipt requires the persisted SDK entry's exact text, bytes, type and MIME", async t => {
  const image = { type: "image", data: "AQID", mimeType: "image/png" };
  const exact = fixture(t, { images: [image] });
  await exact.wrapper.send({ ...exact.command, awaitUserPersistence: true });
  assert.equal(exact.proof(), "unknown", "cold attachment recovery still needs a separate exact dispatch proof");
  for (const savedImages of [[], [{ ...image, data: "BAUG" }], [{ ...image, mimeType: "image/jpeg" }], [image, image]]) {
    const altered = fixture(t, { images: [image], savedImages });
    await assert.rejects(altered.wrapper.send({ ...altered.command, awaitUserPersistence: true }), /durably recorded/);
  }
});
