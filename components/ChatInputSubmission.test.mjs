import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import vm from "node:vm";
import ts from "typescript";
import { createDraftSubmissionGate } from "../lib/draft-submission.ts";
import { resolveSessionReferences } from "../lib/session-reference.ts";

const source = await readFile(new URL("./ChatInput.tsx", import.meta.url), "utf8");
function between(start, end) {
  const offset = source.indexOf(start);
  assert.ok(offset >= 0 && source.indexOf(end, offset) > offset);
  return source.slice(offset, source.indexOf(end, offset));
}
function evaluate(code, context) {
  return vm.runInContext(ts.transpileModule(code, {
    compilerOptions: { target: ts.ScriptTarget.ES2022 },
  }).outputText, context);
}
function composer() {
  let resolve;
  let fetches = 0;
  const response = new Promise((yes) => { resolve = yes; });
  const sent = [];
  const state = { draft: "#picked", clears: 0, error: false };
  const context = vm.createContext({
    value: "#picked", attachedImages: [], isStreaming: false,
    draftKey: "session:one", cwd: "/one",
    submissionIdentity: { current: { draftKey: "session:one", cwd: "/one", isStreaming: false } },
    submissionGate: createDraftSubmissionGate(),
    sessionMentionTargetsRef: { current: new Map([["picked", "target"]]) },
    resolveSessionReferences,
    fetch: async () => { fetches++; return response; },
    onAudioUnlock: undefined, onBuiltinCommand: undefined,
    onPromptWithStreamingBehavior: undefined,
    onSend: (text) => sent.push(text),
    onSteer: (text) => sent.push(text),
    onFollowUp: (text) => sent.push(text),
    clearInput: () => { state.clears++; state.draft = ""; },
    setSendPreparationError: (error) => { state.error = error; },
    setValueState: (value) => { state.draft = value; },
    useCallback: (callback) => callback,
  });
  evaluate(between("  const handleSend = useCallback(", "\n  const slashQuery =")
    + between("  const sendQueued = useCallback(", "\n  const getNextSlashIndex =")
    + between("  const setValue = useCallback", "\n  const [modelDropdownOpen")
    + "\nthis.send = handleSend; this.queue = sendQueued; this.edit = setValue;", context);
  return {
    context, sent, state, fetches: () => fetches,
    resolve: () => resolve({ ok: true, json: async () => ({ reference: "EXPANDED" }) }),
    switchSession() {
      context.draftKey = "session:two";
      state.draft = "second draft";
      evaluate(between("  if (submissionIdentity.current.draftKey", "\n  const [sendPreparationError"), context);
    },
  };
}

for (const mode of ["send", "queue"]) {
  test(`${mode}: repeated Enter during reference lookup sends exactly once`, async () => {
    const c = composer();
    const pending = c.context[mode]("steer");
    await c.context[mode]("steer");
    assert.equal(c.fetches(), 1);
    c.resolve();
    await pending;
    assert.deepEqual(c.sent, ["EXPANDED"]);
    assert.equal(c.state.clears, 1);
  });
  test(`${mode}: typing during lookup keeps the edited draft without sending`, async () => {
    const c = composer();
    const pending = c.context[mode]("steer");
    c.context.edit("edited");
    c.resolve();
    await pending;
    assert.deepEqual(c.sent, []);
    assert.equal(c.state.clears, 0);
    assert.equal(c.state.draft, "edited");
  });
  test(`${mode}: changing session during lookup preserves the new session draft`, async () => {
    const c = composer();
    const pending = c.context[mode]("steer");
    c.switchSession();
    c.resolve();
    await pending;
    assert.deepEqual(c.sent, []);
    assert.equal(c.state.clears, 0);
    assert.equal(c.state.draft, "second draft");
  });
}
