import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { createJiti } from "jiti";
import ts from "typescript";

const client = await createJiti(import.meta.url, { tsconfigPaths: true }).import("./edupi-ambient-message.ts");
const source = await readFile(new URL("../hooks/useAgentSession.ts", import.meta.url), "utf8");
const clientSource = await readFile(new URL("./edupi-ambient-message.ts", import.meta.url), "utf8");

test("web mode never submits private chat text to the desktop canary route", async () => {
  assert.deepEqual(await client.captureEduPiAmbientMessage({ sessionId: "session-1", messageId: "prompt-1", text: "帮我备课", occurredAt: "2026-09-23T08:00:00.000Z" }), { status: "disabled" });
});

test("desktop text and extension slash prompts use the Core-first route; local bash remains separate", () => {
  const send = source.slice(source.indexOf("  const handleSend = useCallback"), source.indexOf("  const executeBash = useCallback"));
  assert.match(send, /await awaitPromptReceipt\(sendEduPiCapturedPrompt/);
  const capture = send.indexOf("sendEduPiCapturedPrompt(");
  assert.match(send, /messageId: `prompt-\$\{clientRequestId\}`/);
  assert.match(send, /delivery === "uncertain"/);
  assert.ok(send.indexOf("if (isBashCommand)") < capture);
  assert.match(send, /const durableSend = isTauriDesktop\(\) && !images\?\.length/);
  assert.match(send, /if \(isSlashCommandPrompt && !durableSend\)/);
  assert.ok(send.indexOf("await persistEduPiPromptIntent") < capture);
  assert.ok(capture < send.indexOf('if (delivery === "disabled") {'));
});

test("ambient capture uses a bounded keepalive request so accepted chat is not lost on navigation", () => {
  assert.match(clientSource, /keepalive:\s*true/);
  assert.match(clientSource, /JSON\.stringify\(input\)/);
  assert.ok(clientSource.indexOf('method: "GET"') < clientSource.indexOf("JSON.stringify(input)"));
});

test("desktop prompt is submitted through the authenticated Core-first endpoint", () => {
  assert.match(clientSource, /fetchDesktopApi\("\/api\/edupi\/proactivity\/prompt"/);
  assert.match(clientSource, /if \(body\?\.status === "accepted"/);
  assert.match(clientSource, /if \(body\?\.status === "uncertain"/);
});

function recoveryClient({ response = Response.json({ status: "accepted" }), stalledBody = false } = {}) {
  const requests = [], timers = new Map();
  const compiled = ts.transpileModule(clientSource, { compilerOptions: {
    module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022,
  } }).outputText;
  const result = { exports: {} };
  let timerId = 0;
  const modules = {
    "./desktop-updater": { isTauriDesktop: () => true },
    "./desktop-native": { fetchDesktopApi: async (url, init) => {
      requests.push({ url, ...init });
      return stalledBody ? { ok: true, json: () => new Promise(() => {}) } : response;
    } },
  };
  new Function("require", "module", "exports", "setTimeout", "clearTimeout", compiled)(
    name => modules[name], result, result.exports,
    (fn, ms) => { timers.set(++timerId, { fn, ms }); return timerId; }, id => timers.delete(id));
  return { client: result.exports, requests, timers };
}

test("Desktop pending recovery sends the exact command while legacy callers keep their two-field body", async () => {
  const command = { type: "prompt", message: " 完整合成消息\n ", clientRequestId: "request-1" };
  const first = recoveryClient();
  assert.equal(await first.client.reconcileEduPiCapturedPrompt("fork-session", "request-1", command), "accepted");
  assert.deepEqual(JSON.parse(first.requests[0].body), { sessionId: "fork-session", clientRequestId: "request-1", command });
  assert.equal(first.timers.size, 0);
  const legacy = recoveryClient();
  await legacy.client.reconcileEduPiCapturedPrompt("fork-session", "request-1");
  assert.deepEqual(JSON.parse(legacy.requests[0].body), { sessionId: "fork-session", clientRequestId: "request-1" });
});

test("a refused or stalled receipt never acknowledges a pending prompt or holds history loading forever", async () => {
  const refused = recoveryClient({ response: Response.json({ status: "accepted" }, { status: 503 }) });
  assert.equal(await refused.client.reconcileEduPiCapturedPrompt("session", "request"), "unavailable");
  const stalled = recoveryClient({ stalledBody: true });
  const pending = stalled.client.reconcileEduPiCapturedPrompt("session", "request");
  await Promise.resolve();
  assert.equal(stalled.timers.size, 1);
  const deadline = [...stalled.timers.values()][0];
  assert.equal(deadline.ms, 6_000);
  deadline.fn();
  assert.equal(await pending, "unavailable");
  assert.equal(stalled.requests[0].signal.aborted, true);
  assert.equal(stalled.timers.size, 0);
});
