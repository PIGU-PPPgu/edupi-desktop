import assert from "node:assert/strict";
import fs from "node:fs";
import test from "node:test";
import vm from "node:vm";
import ts from "typescript";
import { createJiti } from "jiti";

const source = fs.readFileSync(new URL("./ChatInput.tsx", import.meta.url), "utf8");
const draftSource = fs.readFileSync(new URL("../lib/draft-store.ts", import.meta.url), "utf8");
const hookSource = fs.readFileSync(new URL("../hooks/useAgentSession.ts", import.meta.url), "utf8");
const compile = code => ts.transpileModule(code, { compilerOptions: { target: ts.ScriptTarget.ES2022,
  module: ts.ModuleKind.CommonJS } }).outputText;
const composer = await createJiti(import.meta.url).import("../lib/edupi-composer-context.ts");
const noop = () => {};
const plain = value => value == null ? value : JSON.parse(JSON.stringify(value));
const identity = { sessionId: "A", clientRequestId: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa" };
const pending = { ...identity, occurredAt: "2026-10-21T08:00:00.000Z", message: "完整合成消息", draftValue: "合成草稿" };
const originalContext = { title: "合成引用", reference: "synthetic original" };

function draftHarness() {
  const storage = new Map();
  const open = () => {
    const exports = {};
    vm.runInNewContext(compile(draftSource), { exports, window: {}, setTimeout: () => 1, clearTimeout: noop,
      require: name => name.endsWith("edupi-composer-context") ? composer : {
        APP_PREF_KEYS: { chatDrafts: "drafts" }, getPrefJson: key => storage.has(key) ? JSON.parse(storage.get(key)) : null,
        trySetPrefJson: (key, value) => { storage.set(key, JSON.stringify(value)); return true; },
      } });
    return exports;
  };
  return { open };
}

function editor(store, key = "A") {
  const draft = store.getDraft(key);
  const state = { value: draft?.value ?? "", context: draft?.context ?? null, images: draft?.images ?? [], error: "旧发送错误" };
  const refs = {
    draftKeyRef: { current: key }, editRevisionRef: { current: 0 },
    submittedDraftRef: { current: draft?.pendingPrompt ? { draftKey: key, clientRequestId: draft.pendingPrompt.clientRequestId,
      sessionId: draft.pendingPrompt.sessionId, revision: 0, acknowledged: false } : null },
    submittingRef: { current: false }, valueRef: { current: state.value }, contextRef: { current: state.context },
    attachedImagesRef: { current: state.images }, pendingImageCountRef: { current: 0 },
    offeredContextRef: { current: null }, pendingTeacherTextRef: { current: "" }, pendingQueueMessagesRef: { current: [] },
    queueRecoveryIdRef: { current: null }, queueRecoveryPreviousRef: { current: [] }, queueReadyToAckRef: { current: false },
    queueUncertainRef: { current: false }, pendingFailedMessagesRef: { current: [] },
    textareaRef: { current: { style: { height: "40px" } } },
  };
  const context = { ...refs, useCallback: callback => callback, useEffect: callback => callback(),
    getDraft: store.getDraft, setDraft: store.setDraft, flushDraftNow: store.flushDraftNow,
    markPendingPromptDraftEdited: store.markPendingPromptDraftEdited ?? noop,
    updateValue: next => { state.value = typeof next === "function" ? next(state.value) : next; refs.valueRef.current = state.value; },
    updateContext: next => { state.context = typeof next === "function" ? next(state.context) : next; refs.contextRef.current = state.context; },
    updateAttachedImages: next => { state.images = typeof next === "function" ? next(state.images) : next; refs.attachedImagesRef.current = state.images; },
    imageToDraftImage: image => ({ data: image.data, mimeType: image.mimeType }),
    draftImagesToAttachedImages: images => images ?? [], revokeImagePreview: noop,
    setAttachError: error => { state.error = error; },
    setResourcePickerKind: noop, setOfferedContext: noop, setPendingTeacherText: noop,
    setPendingQueueMessages: noop, setQueueRecoveryId: noop, setQueueRecoveryPrevious: noop,
    setQueueReadyToAck: noop, setQueueUncertain: noop, setPendingFailedMessages: noop,
    setAtQuery: noop, setHistoryMenuOpen: noop,
  };
  const setters = ["setValue", "setContext", "setAttachedImages"].map(name => {
    const start = source.indexOf(`  const ${name} = useCallback`);
    return source.slice(start, source.indexOf("\n", start));
  }).join("\n");
  Object.assign(context, new Function(...Object.keys(context), compile(`${setters}\nreturn { setValue, setContext, setAttachedImages };`))(...Object.values(context)));
  const method = source.slice(source.indexOf("    acknowledgeSubmittedMessage("), source.indexOf("    offerContext("));
  const ack = new Function(...Object.keys(context), compile(`return ({ ${method} }).acknowledgeSubmittedMessage;`))(...Object.values(context));
  const proofMethod = source.slice(source.indexOf("    isSubmittedDraftUnedited("), source.indexOf("    acknowledgeSubmittedMessage("));
  const proof = proofMethod ? new Function(...Object.keys(context), compile(`return ({ ${proofMethod} }).isSubmittedDraftUnedited;`))(...Object.values(context)) : () => true;
  const start = source.indexOf("  useEffect(() => {\n    const previousDraftKey = draftKeyRef.current;");
  const switching = source.slice(start, source.indexOf("\n\n  useEffect(", start + 1));
  const clearStart = source.indexOf("  const clearImages = useCallback");
  const clearing = source.slice(clearStart, source.indexOf("  useEffect(() => {\n    setDraftSaveFailed(false);", clearStart));
  const sending = source.slice(source.indexOf("  const handleSend = useCallback"), source.indexOf("  const slashQuery ="));
  const acknowledging = hookSource.slice(hookSource.indexOf("  const acknowledgeSubmittedPrompt = useCallback"),
    hookSource.indexOf("  const reconcilePendingPrompt = useCallback"));
  const send = async ({ durable = true, gate = null } = {}) => {
    const originKey = refs.draftKeyRef.current;
    let onSendCalls = 0, requestAck = null;
    const ackContext = { useCallback: callback => callback, refreshPromptRecovery: noop,
      acknowledgePendingPrompt: store.acknowledgePendingPrompt,
      chatInputRef: { current: { acknowledgeSubmittedMessage: (...args) => { requestAck = ack(...args); return requestAck; } } } };
    const hookAck = new Function(...Object.keys(ackContext), compile(`${acknowledging}\nreturn acknowledgeSubmittedPrompt;`))(...Object.values(ackContext));
    const bindings = { ...context, draftKey: originKey, value: state.value, context: state.context, attachedImages: state.images,
      pendingTeacherText: "", queueRecoveryId: null, isStreaming: false, onAudioUnlock: noop, onBuiltinCommand: null,
      abortDictation: noop, clearDraft: store.clearDraft, composeComposerMessage: composer.composeComposerMessage,
      onSend: async message => {
        onSendCalls++;
        if (gate) await gate;
        let held = store.getDraft(originKey)?.pendingPrompt;
        if (!held && durable) {
          held = { ...pending, message, clientRequestId: "eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee" };
          assert.equal(store.stagePendingPrompt(originKey, held, proof(originKey, held.draftValue)), true);
          if (originKey !== held.sessionId) { store.setDraft(held.sessionId, store.getDraft(originKey)); store.flushDraftNow(held.sessionId); }
        }
        if (held) hookAck(originKey, held);
        return true;
      },
    };
    const handleSend = new Function(...Object.keys(bindings), compile(`${clearing}\n${sending}\nreturn handleSend;`))(...Object.values(bindings));
    await handleSend();
    return { onSendCalls, requestAck };
  };
  return { state, refs, store, setValue: context.setValue, setContext: context.setContext,
    setImages: context.setAttachedImages, ack: () => ack("A", pending.draftValue, false, identity),
    proof: () => proof(refs.draftKeyRef.current, pending.draftValue), send,
    navigate: draftKey => new Function(...Object.keys(context), "draftKey", compile(switching))(...Object.values(context), draftKey) };
}

function pendingEditor() {
  const drafts = draftHarness(), store = drafts.open();
  store.setDraft("A", { value: pending.draftValue, images: [], context: originalContext });
  assert.equal(store.stagePendingPrompt("A", pending, true), true);
  store.setDraft("B", { value: "另一个草稿", images: [] });
  store.flushDraftNow("B");
  return { ...editor(store), cold: () => editor(drafts.open()), drafts };
}

test("actual A-to-B-to-A restoration cannot turn an edited pending request back into an unedited submission", () => {
  for (const edit of [f => f.setValue(pending.draftValue),
    f => f.setContext({ title: "新引用", reference: "synthetic newer context" }),
    f => { f.setImages([{ data: "AQID", mimeType: "image/png" }]); f.setImages([]); }]) {
    const f = pendingEditor();
    edit(f);
    assert.equal(f.ack(), false, "the edit is protected before navigation");
    const expected = structuredClone(f.state);
    f.navigate("B");
    f.navigate("A");
    assert.equal(f.ack(), false, "navigation must not erase the submission's dirty evidence");
    assert.equal(f.state.value, expected.value);
    assert.deepEqual(plain(f.state.context), plain(expected.context));
  }
});

test("the same-text retype and context edits remain protected after a genuinely cold draft-store reload", () => {
  for (const edit of [f => f.setValue(pending.draftValue), f => f.setContext({ title: "新引用", reference: "synthetic newer" })]) {
    const f = pendingEditor();
    edit(f);
    f.navigate("B");
    f.store.flushDraftNow("A");
    const cold = f.cold();
    assert.equal(cold.ack(), false);
    const before = cold.store.getDraft("A");
    cold.store.acknowledgePendingPrompt("A", pending.clientRequestId);
    assert.equal(cold.store.getDraft("A")?.value, before.value);
    assert.deepEqual(cold.store.getDraft("A")?.context, before.context);
  }
});

test("an explicitly unedited submission remains eligible after navigation and cold restoration", () => {
  const f = pendingEditor();
  f.navigate("B");
  f.navigate("A");
  assert.equal(f.ack(), true);
  const untouched = pendingEditor();
  untouched.store.flushDraftNow("A");
  assert.equal(untouched.cold().ack(), true);
});

test("legacy pending drafts without an editing proof cannot clear text or context on cold ACK", () => {
  const drafts = draftHarness(), store = drafts.open();
  store.setDraft("A", { value: pending.draftValue, images: [], context: originalContext, pendingPrompt: pending });
  store.flushDraftNow("A");
  const cold = editor(drafts.open());
  assert.equal(cold.ack(), false);
  cold.store.acknowledgePendingPrompt("A", pending.clientRequestId);
  assert.equal(cold.store.getDraft("A")?.value, pending.draftValue);
  assert.deepEqual(plain(cold.store.getDraft("A")?.context), originalContext);
});

test("a retry cannot export a fresh unedited proof after navigation or cold hydration of the edited request", () => {
  const f = pendingEditor();
  f.refs.submittingRef.current = true;
  assert.equal(f.proof(), true);
  f.setValue(pending.draftValue);
  f.navigate("B");
  f.navigate("A");
  assert.equal(f.proof(), false);
  f.store.flushDraftNow("A");
  const cold = f.cold();
  cold.refs.submittingRef.current = true;
  assert.equal(cold.proof(), false);
});

test("the full handleSend to hook ACK and clearInput path preserves edited and legacy same-text retries", async () => {
  for (const proof of [false, undefined]) {
    const drafts = draftHarness(), store = drafts.open();
    const request = { ...pending, message: composer.composeComposerMessage(originalContext, pending.draftValue, false),
      ...(proof === undefined ? {} : { draftUnedited: proof }) };
    store.setDraft("A", { value: pending.draftValue, images: [], context: originalContext, pendingPrompt: request });
    store.flushDraftNow("A");
    const f = editor(store);
    assert.deepEqual(await f.send(), { onSendCalls: 1, requestAck: false });
    assert.equal(f.state.value, pending.draftValue);
    assert.deepEqual(plain(f.state.context), originalContext);
    assert.equal(store.getDraft("A")?.pendingPrompt, undefined);
    const cold = drafts.open().getDraft("A");
    assert.equal(cold.value, pending.draftValue);
    assert.deepEqual(plain(cold.context), originalContext);
  }
});

test("a delayed accepted retry cannot run the outer clearDraft after the teacher navigates away", async () => {
  const f = pendingEditor();
  f.setValue(pending.draftValue);
  let release;
  const sent = f.send({ gate: new Promise(resolve => { release = resolve; }) });
  await Promise.resolve();
  f.navigate("B");
  release();
  assert.deepEqual(await sent, { onSendCalls: 1, requestAck: false });
  f.navigate("A");
  assert.equal(f.state.value, pending.draftValue);
  assert.deepEqual(plain(f.state.context), originalContext);
  assert.equal(f.cold().state.value, pending.draftValue);
});

test("the full send path still clears explicitly unedited retries, first durable sends and fresh web sends", async () => {
  const retry = pendingEditor();
  assert.deepEqual(await retry.send(), { onSendCalls: 1, requestAck: true });
  assert.equal(retry.state.value, "");
  assert.equal(retry.state.context, null);
  assert.equal(retry.store.getDraft("A"), null);
  for (const [key, durable] of [["new:/synthetic", true], ["A", false]]) {
    const store = draftHarness().open();
    store.setDraft(key, { value: pending.draftValue, images: [], context: originalContext });
    const fresh = editor(store, key);
    assert.deepEqual(await fresh.send({ durable }), { onSendCalls: 1, requestAck: durable ? true : null });
    assert.equal(fresh.state.value, "");
    assert.equal(fresh.state.context, null);
    assert.equal(store.getDraft(key), null);
    assert.equal(store.getDraft("A"), null);
  }
});
