import assert from "node:assert/strict";
import fs from "node:fs";
import test from "node:test";
import ts from "typescript";

const source = fs.readFileSync(new URL("./ChatInput.tsx", import.meta.url), "utf8");
const compile = code => ts.transpileModule(code, { compilerOptions: { target: ts.ScriptTarget.ES2022 } }).outputText;
const identity = { sessionId: "fork-session", clientRequestId: "request-1" };
const pending = { ...identity, occurredAt: "2026-10-21T08:00:00.000Z", message: "完整合成提交", draftValue: "合成提交", draftUnedited: true };
const noop = () => {};

function fixture({ key = "fork-session", submitting = false, revision = 0, value = pending.draftValue,
  images = [], pendingImages = 0, boundRequest = identity.clientRequestId } = {}) {
  const state = { value, context: { title: "合成引用", reference: "synthetic" }, error: "消息尚未确认，草稿已保留" };
  const drafts = new Map([[key, { value, images, pendingPrompt: pending }], [identity.sessionId, { value, images, pendingPrompt: pending }]]);
  const context = {
    draftKeyRef: { current: key }, submittingRef: { current: submitting }, valueRef: { current: value },
    attachedImagesRef: { current: images }, pendingImageCountRef: { current: pendingImages },
    contextRef: { current: state.context }, textareaRef: { current: { style: { height: "40px" } } },
    editRevisionRef: { current: revision }, submittedDraftRef: { current: { draftKey: key, clientRequestId: boundRequest,
      sessionId: identity.sessionId, revision: 0, acknowledged: false } },
    getDraft: key => drafts.get(key) ?? null,
    setValue: value => { state.value = value; }, setContext: value => { state.context = value; },
    updateValue: value => { state.value = value; }, updateContext: value => { state.context = value; },
    setAttachError: value => { state.error = value; },
  };
  const method = source.slice(source.indexOf("    acknowledgeSubmittedMessage("), source.indexOf("    offerContext("));
  const acknowledge = new Function(...Object.keys(context), compile(`return ({ ${method} }).acknowledgeSubmittedMessage;`))(...Object.values(context));
  return { state, context, drafts, acknowledge };
}

test("exact request recovery clears the cold composer text and its stale error through either draft alias", () => {
  for (const key of ["fork-session", "new:/synthetic"]) {
    const f = fixture({ key });
    assert.equal(f.acknowledge(identity.sessionId, pending.draftValue, false, identity), true);
    assert.equal(f.state.value, "");
    assert.equal(f.state.context, null);
    assert.equal(f.state.error, null);
  }
});

test("request-aware ACK preserves a new edit, an identical retype and a newer request", () => {
  for (const setup of [{ value: "新的草稿" }, { revision: 1 }, { boundRequest: "new-request" }]) {
    const f = fixture({ submitting: true, ...setup });
    const before = structuredClone(f.state);
    assert.equal(f.acknowledge("fork-session", pending.draftValue, false, identity), false);
    assert.deepEqual(f.state, before);
  }
  const f = fixture({ submitting: true });
  assert.equal(f.acknowledge("fork-session", pending.draftValue, false, { ...identity, sessionId: "other-session" }), false);
  assert.equal(f.acknowledge("fork-session", pending.draftValue, false, { ...identity, clientRequestId: "old-request" }), false);
});

test("new or still-loading attachments and another draft key prevent request recovery from clearing the composer", () => {
  for (const setup of [{ images: [{ data: "AQID", mimeType: "image/png" }] }, { pendingImages: 1 }]) {
    const f = fixture({ submitting: true, ...setup });
    const before = structuredClone(f.state);
    assert.equal(f.acknowledge("fork-session", pending.draftValue, false, identity), false);
    assert.deepEqual(f.state, before);
  }
  const switched = fixture({ submitting: true });
  switched.context.draftKeyRef.current = "other-draft";
  assert.equal(switched.acknowledge("fork-session", pending.draftValue, false, identity), false);
});

test("the existing three-argument in-flight ACK stays compatible", () => {
  const f = fixture({ submitting: true });
  assert.equal(f.acknowledge("fork-session", pending.draftValue, true), true);
  assert.equal(f.state.value, "");
  assert.ok(f.state.context);
});

test("a request acknowledged during onSend is not relabelled as a failed submission by its late false result", async () => {
  const f = fixture();
  const context = { ...f.context, useCallback: callback => callback,
    value: pending.draftValue, context: null, pendingTeacherText: "", queueRecoveryId: null,
    attachedImages: [], isStreaming: false, onAudioUnlock: noop, onBuiltinCommand: null,
    composeComposerMessage: (_context, text) => text, imageToDraftImage: image => image,
    setDraft: (key, draft) => f.drafts.set(key, draft), flushDraftNow: () => true,
    clearInput: noop, clearDraft: noop,
    onSend: async () => { f.acknowledge("fork-session", pending.draftValue, false, identity); return false; },
  };
  const sending = source.slice(source.indexOf("  const handleSend = useCallback"), source.indexOf("  const slashQuery ="));
  const send = new Function(...Object.keys(context), compile(`${sending}\nreturn handleSend;`))(...Object.values(context));
  await send();
  assert.equal(f.state.value, "");
  assert.equal(f.state.error, null);
});
