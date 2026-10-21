import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { SessionManager } from "@earendil-works/pi-coding-agent";
import { createJiti } from "jiti";
import { createHash } from "node:crypto";

const { inspectEduPiPromptSession } = await createJiti(import.meta.url, { tsconfigPaths: true })
  .import("./edupi-prompt-reconciliation.ts");
const command = { type: "prompt", message: "合成备课", clientRequestId: "request-1" };
const entry = { command, clientRequestId: "request-1" };

test("an exact persisted Pi marker binds only its first user message to the outbox request", t => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "edupi-prompt-session-"));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const manager = SessionManager.create(root, path.join(root, "sessions"));
  const entry = { command, clientRequestId: command.clientRequestId, sessionId: manager.getSessionId() };
  const file = manager.getSessionFile();
  assert.equal(inspectEduPiPromptSession(entry, file), "unknown");
  const commandHash = `sha256:${createHash("sha256").update(JSON.stringify(command)).digest("hex")}`;
  manager.appendCustomEntry("edupi_prompt_dispatch_v1", { sessionId: entry.sessionId, clientRequestId: "request-1", commandHash });
  assert.equal(inspectEduPiPromptSession(entry, file), "unknown", "a new Pi session has no file before its first user message");
  const userEntryId = manager.appendMessage({ role: "user", content: [{ type: "text", text: "合成备课" }], timestamp: Date.now() });
  manager.appendCustomEntry("edupi_prompt_accepted_v1", { sessionId: entry.sessionId,
    clientRequestId: command.clientRequestId, commandHash, userEntryId });
  assert.equal(inspectEduPiPromptSession(entry, file), "confirmed");
  manager.appendMessage({ role: "assistant", content: [{ type: "text", text: "已收到" }], timestamp: Date.now() });
  manager.appendMessage({ role: "user", content: [{ type: "text", text: "另一条" }], timestamp: Date.now() });
  assert.equal(inspectEduPiPromptSession(entry, file), "confirmed", "later chat is not mistaken for the first marked submission");
});

test("a marker alone or a mismatched first user message never proves Pi acceptance", t => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "edupi-prompt-session-"));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const manager = SessionManager.create(root, path.join(root, "sessions"));
  const entry = { command, clientRequestId: command.clientRequestId, sessionId: manager.getSessionId() };
  manager.appendMessage({ role: "user", content: [{ type: "text", text: "先前对话" }], timestamp: Date.now() });
  const file = manager.getSessionFile();
  const commandHash = `sha256:${createHash("sha256").update(JSON.stringify(command)).digest("hex")}`;
  manager.appendCustomEntry("edupi_prompt_dispatch_v1", { sessionId: entry.sessionId, clientRequestId: "request-1", commandHash });
  assert.equal(inspectEduPiPromptSession(entry, file), "marker_only");
  manager.appendMessage({ role: "user", content: [{ type: "text", text: "不同内容" }], timestamp: Date.now() });
  assert.equal(inspectEduPiPromptSession(entry, file), "mismatch");
});

test("image prompts stay unknown until an exact image proof exists", t => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "edupi-prompt-session-"));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  assert.equal(inspectEduPiPromptSession({ ...entry, command: { ...command,
    images: [{ type: "image", data: "AQID", mimeType: "image/png" }] } }, path.join(root, "missing.jsonl")), "unknown");
});

function persistedSession(t) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "edupi-prompt-isolation-"));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const manager = SessionManager.create(root, path.join(root, "sessions"));
  manager.appendMessage({ role: "user", content: "合成历史", timestamp: Date.now() });
  const sessionId = manager.getSessionId();
  const request = (clientRequestId, message = "相同合成消息") => ({ sessionId, clientRequestId,
    command: { type: "prompt", message, clientRequestId } });
  const mark = entry => manager.appendCustomEntry("edupi_prompt_dispatch_v1", {
    sessionId: entry.sessionId, clientRequestId: entry.clientRequestId,
    commandHash: `sha256:${createHash("sha256").update(JSON.stringify(entry.command)).digest("hex")}`,
  });
  const accept = (entry, userEntryId) => manager.appendCustomEntry("edupi_prompt_accepted_v1", {
    sessionId: entry.sessionId, clientRequestId: entry.clientRequestId, userEntryId,
    commandHash: `sha256:${createHash("sha256").update(JSON.stringify(entry.command)).digest("hex")}`,
  });
  return { root, manager, request, mark, accept, file: manager.getSessionFile() };
}

test("a failed dispatch cannot borrow a later request's identical user message", t => {
  const f = persistedSession(t);
  const failed = f.request("failed-request"), accepted = f.request("next-request");
  f.mark(failed);
  f.mark(accepted);
  f.accept(accepted, f.manager.appendMessage({ role: "user", content: accepted.command.message, timestamp: Date.now() }));
  assert.equal(inspectEduPiPromptSession(failed, f.file), "marker_only");
  assert.equal(inspectEduPiPromptSession(accepted, f.file), "confirmed");
});

test("a reused nonce with different commands never provides a unique dispatch proof", t => {
  const f = persistedSession(t);
  const first = f.request("reused-request"), second = f.request("reused-request", "另一内容");
  f.mark(first);
  f.accept(first, f.manager.appendMessage({ role: "user", content: first.command.message, timestamp: Date.now() }));
  f.mark(second);
  f.accept(second, f.manager.appendMessage({ role: "user", content: second.command.message, timestamp: Date.now() }));
  assert.equal(inspectEduPiPromptSession(first, f.file), "unknown");
  assert.equal(inspectEduPiPromptSession(second, f.file), "unknown");
});

test("SDK fork history cannot prove that the inherited request was submitted to the fork", t => {
  const f = persistedSession(t);
  const original = f.request("original-request");
  f.mark(original);
  f.accept(original, f.manager.appendMessage({ role: "user", content: original.command.message, timestamp: Date.now() }));
  const fork = SessionManager.forkFrom(f.file, f.root, path.join(f.root, "forks"));
  assert.equal(inspectEduPiPromptSession(original, f.file), "confirmed");
  assert.equal(inspectEduPiPromptSession({ ...original, sessionId: fork.getSessionId() }, fork.getSessionFile()), "unknown");
  const forkRequest = { sessionId: fork.getSessionId(), clientRequestId: "fork-request",
    command: { type: "prompt", message: original.command.message, clientRequestId: "fork-request" } };
  fork.appendCustomEntry("edupi_prompt_dispatch_v1", { sessionId: forkRequest.sessionId,
    clientRequestId: forkRequest.clientRequestId,
    commandHash: `sha256:${createHash("sha256").update(JSON.stringify(forkRequest.command)).digest("hex")}` });
  const userEntryId = fork.appendMessage({ role: "user", content: forkRequest.command.message, timestamp: Date.now() });
  fork.appendCustomEntry("edupi_prompt_accepted_v1", { sessionId: forkRequest.sessionId,
    clientRequestId: forkRequest.clientRequestId, userEntryId,
    commandHash: `sha256:${createHash("sha256").update(JSON.stringify(forkRequest.command)).digest("hex")}` });
  assert.equal(inspectEduPiPromptSession(forkRequest, fork.getSessionFile()), "confirmed");
  assert.equal(inspectEduPiPromptSession(forkRequest, f.file), "unknown");
});

test("an unscoped legacy marker and matching text stay unknown", t => {
  const f = persistedSession(t);
  const pending = f.request("legacy-request");
  f.manager.appendCustomEntry("edupi_prompt_dispatch_v1", { clientRequestId: pending.clientRequestId,
    commandHash: `sha256:${createHash("sha256").update(JSON.stringify(pending.command)).digest("hex")}` });
  f.manager.appendMessage({ role: "user", content: pending.command.message, timestamp: Date.now() });
  assert.equal(inspectEduPiPromptSession(pending, f.file), "unknown");
});

test("a dispatch marker and exact SDK user without a positive host acceptance mapping stay unknown", t => {
  const f = persistedSession(t);
  const pending = f.request("missing-acceptance");
  f.mark(pending);
  f.manager.appendMessage({ role: "user", content: pending.command.message, timestamp: Date.now() });
  assert.equal(inspectEduPiPromptSession(pending, f.file), "unknown");
});

test("acceptance receipts bind the exact session, nonce, command hash and SDK user entry", t => {
  for (const changed of [{ sessionId: "other-session" }, { clientRequestId: "other-request" },
    { commandHash: `sha256:${"0".repeat(64)}` }, { userEntryId: "other-user" }]) {
    const f = persistedSession(t), pending = f.request("exact-receipt");
    f.mark(pending);
    const userEntryId = f.manager.appendMessage({ role: "user", content: pending.command.message, timestamp: Date.now() });
    f.manager.appendCustomEntry("edupi_prompt_accepted_v1", { sessionId: pending.sessionId,
      clientRequestId: pending.clientRequestId, userEntryId,
      commandHash: `sha256:${createHash("sha256").update(JSON.stringify(pending.command)).digest("hex")}`, ...changed });
    assert.equal(inspectEduPiPromptSession(pending, f.file), "unknown");
  }
});
