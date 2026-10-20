import assert from "node:assert/strict";
import { createHash, randomUUID } from "node:crypto";
import { isDeepStrictEqual } from "node:util";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import ts from "typescript";
import { createJiti } from "jiti";
import { SessionManager } from "@earendil-works/pi-coding-agent";

const jiti = createJiti(import.meta.url, { tsconfigPaths: true });
const intentStore = await jiti.import("../../../../../lib/edupi-prompt-intent.ts");
const outboxStore = await jiti.import("../../../../../lib/edupi-prompt-outbox.ts");
const { inspectEduPiPromptSession } = await jiti.import("../../../../../lib/edupi-prompt-reconciliation.ts");
const compiled = ts.transpileModule(fs.readFileSync(new URL("./route.ts", import.meta.url), "utf8"), {
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
}).outputText;

function fixture(t, { intentStatus = "pending", marker = true, user = true, receipt = true, outboxStage = null } = {}) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "edupi-direct-receipt-"));
  const options = { dataRoot: root, stateDir: root };
  const manager = SessionManager.create(root, path.join(root, "sessions"));
  manager.appendMessage({ role: "user", content: "合成历史", timestamp: Date.now() });
  const sessionId = manager.getSessionId(), clientRequestId = randomUUID();
  const command = { type: "prompt", message: " 完整合成消息\n不能trim ", clientRequestId };
  intentStore.prepareEduPiPromptIntent({ sessionId, clientRequestId, message: command.message,
    occurredAt: "2026-10-21T08:00:00.000Z", draftValue: command.message, cwd: root }, options);
  if (intentStatus === "resolved") intentStore.resolveEduPiPromptIntent(sessionId, clientRequestId, options);
  if (intentStatus === "discarded") intentStore.discardEduPiPromptIntent(sessionId, clientRequestId, options);
  if (outboxStage) {
    const domain = "teaching_preparation", messageRef = `owner_message:${"a".repeat(64)}`;
    outboxStore.prepareEduPiPromptOutbox({ sessionId, clientRequestId, command, messageId: "synthetic-message",
      occurredAt: "2026-10-21T08:00:00.000Z", bindings: [{ domain, ownerId: "owner-1", grantId: "grant-1",
        grantVersion: 1, captureMessageId: "synthetic-capture", carrierId: "synthetic-carrier", planId: "synthetic-plan" }] }, options);
    outboxStore.recordEduPiPromptOutboxRegistration(sessionId, clientRequestId, domain, { messageRef,
      producerEpoch: "b".repeat(64), sequence: 1, fencingGeneration: 1, instanceNonce: "synthetic-nonce" }, options);
    outboxStore.recordEduPiPromptOutboxCapture(sessionId, clientRequestId, domain, { messageRef, captured: true }, options);
    if (outboxStage === "cancelled") {
      outboxStore.markEduPiPromptOutboxCancelled(sessionId, clientRequestId, [{ domain, messageRef, status: "withdrawn" }], options);
    } else {
      outboxStore.markEduPiPromptOutboxPiDispatching(sessionId, clientRequestId, options);
      outboxStore.markEduPiPromptOutboxPiUnknown(sessionId, clientRequestId, options);
      if (outboxStage === "pi_accepted") outboxStore.markEduPiPromptOutboxPiAccepted(sessionId, clientRequestId, options);
    }
  }
  if (marker) manager.appendCustomEntry("edupi_prompt_dispatch_v1", { sessionId, clientRequestId,
    commandHash: `sha256:${createHash("sha256").update(JSON.stringify(command)).digest("hex")}` });
  if (user) {
    const userEntryId = manager.appendMessage({ role: "user", content: command.message, timestamp: Date.now() });
    if (marker && receipt) manager.appendCustomEntry("edupi_prompt_accepted_v1", { sessionId, clientRequestId,
      commandHash: `sha256:${createHash("sha256").update(JSON.stringify(command)).digest("hex")}`, userEntryId });
  }
  const events = [];
  const modules = {
    "node:crypto": { createHash }, "node:util": { isDeepStrictEqual },
    "next/server": { NextResponse: { json: (body, init) => Response.json(body, init) } },
    "@/lib/bounded-form-data": { parseJsonWithinLimit: req => req.json(), RequestBodyTooLargeError: class extends Error {} },
    "@/lib/desktop-api-auth": { isDesktopApiRequestAllowed: () => true },
    "@/lib/edupi-ambient-session-lock": { withEduPiAmbientSessionLock: (_id, fn) => fn() },
    "@/lib/edupi-core-snapshot": { resolveEduPiBridgeRoots: () => ({ dataRoot: { root } }) },
    "@/lib/edupi-prompt-intent": Object.fromEntries(Object.entries(intentStore).map(([key, value]) =>
      [key, typeof value === "function" ? (...args) => value(...args.slice(0, -1), options) : value])),
    "@/lib/edupi-prompt-outbox": Object.fromEntries(Object.entries(outboxStore).map(([key, value]) =>
      [key, typeof value === "function" ? (...args) => value(...args.slice(0, -1), options) : value])),
    "@/lib/edupi-prompt-reconciliation": { inspectEduPiPromptSession },
    "@/lib/session-reader": { resolveSessionPath: async id => id === sessionId ? manager.getSessionFile() : null },
    "@/lib/image-attachments": { validateAgentImages: () => null },
    "@/lib/rpc-manager": { getRpcSession: () => { events.push("rpc"); throw new Error("unexpected replay"); } },
    "@/lib/harness/runtime": { startHarnessSession: () => { events.push("start"); throw new Error("unexpected replay"); } },
    "@/lib/edupi-runtime-supervisor": { ensureEduPiRuntime: () => { events.push("core"); throw new Error("unexpected replay"); } },
  };
  const result = { exports: {} };
  new Function("require", "module", "exports", compiled)(name => modules[name] ?? {}, result, result.exports);
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const patch = (payload = { sessionId, clientRequestId, command }) => result.exports.PATCH(new Request("http://localhost/api/edupi/proactivity/prompt", {
    method: "PATCH", headers: { "content-type": "application/json" }, body: JSON.stringify(payload),
  }));
  return { patch, command, sessionId, clientRequestId, events,
    intent: () => intentStore.readEduPiPromptIntent(sessionId, clientRequestId, options),
    outbox: () => outboxStore.readEduPiPromptOutbox(sessionId, clientRequestId, options) };
}

test("a lost direct ACK is recovered from the cold SDK file without an outbox or model replay", async t => {
  for (const intentStatus of ["pending", "resolved"]) {
    const f = fixture(t, { intentStatus });
    assert.equal((await f.patch()).status, 200);
    assert.equal((await (await f.patch()).json()).status, "accepted");
    assert.equal(f.intent().status, "resolved");
    assert.deepEqual(f.events, []);
  }
});

test("resolved intent, idle, identical text and a marker alone cannot acknowledge a direct request", async t => {
  for (const config of [{ marker: false, intentStatus: "resolved" }, { user: false }, { receipt: false }, { intentStatus: "discarded" }]) {
    const f = fixture(t, config);
    const result = await f.patch();
    assert.notEqual((await result.json()).status, "accepted");
    assert.equal(f.intent().status, config.intentStatus ?? "pending");
  }
});

test("direct reconciliation needs the exact full command and keeps legacy reads unresolved", async t => {
  const f = fixture(t, { intentStatus: "resolved" });
  for (const command of [{ ...f.command, message: f.command.message.trim() },
    { ...f.command, clientRequestId: randomUUID() },
    { ...f.command, images: [{ type: "image", data: "AQID", mimeType: "image/png" }] }]) {
    const result = await f.patch({ sessionId: f.sessionId, clientRequestId: f.clientRequestId, command });
    assert.notEqual((await result.json()).status, "accepted");
  }
  assert.equal((await f.patch({ sessionId: f.sessionId, clientRequestId: f.clientRequestId })).status, 404);
});

test("Core-first unknown outbox recovery reads the same exact SDK proof and persists its accepted stage", async t => {
  const f = fixture(t, { outboxStage: "pi_unknown" });
  assert.equal(f.outbox().stage, "pi_unknown");
  assert.equal((await f.patch()).status, 200);
  assert.equal(f.outbox().stage, "pi_accepted");
  assert.equal(f.intent().status, "resolved");
  assert.deepEqual(f.events, []);
  const altered = await f.patch({ sessionId: f.sessionId, clientRequestId: f.clientRequestId,
    command: { ...f.command, message: "其他内容" } });
  assert.equal((await altered.json()).status, "conflict");
});

test("Core-first cancellation and unknown SDK evidence cannot be relabelled as Pi accepted", async t => {
  for (const config of [{ outboxStage: "pi_unknown", marker: false }, { outboxStage: "pi_unknown", user: false },
    { outboxStage: "pi_unknown", receipt: false },
    { outboxStage: "cancelled" }]) {
    const f = fixture(t, config);
    const result = await f.patch();
    assert.notEqual((await result.json()).status, "accepted");
    assert.equal(f.outbox().stage, config.outboxStage);
    assert.equal(f.intent().status, "pending");
    assert.deepEqual(f.events, []);
  }
});

test("a previously accepted Core-first outbox remains accepted without upgrading legacy SDK receipts", async t => {
  const f = fixture(t, { outboxStage: "pi_accepted", marker: false, user: false, receipt: false });
  assert.equal((await f.patch()).status, 200);
  assert.equal(f.outbox().stage, "pi_accepted");
  assert.equal(f.intent().status, "resolved");
});
