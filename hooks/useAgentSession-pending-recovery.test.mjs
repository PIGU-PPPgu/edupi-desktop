import assert from "node:assert/strict";
import fs from "node:fs";
import test from "node:test";
import vm from "node:vm";
import ts from "typescript";
import { createJiti } from "jiti";

const source = fs.readFileSync(new URL("./useAgentSession.ts", import.meta.url), "utf8");
const draftSource = fs.readFileSync(new URL("../lib/draft-store.ts", import.meta.url), "utf8");
const compile = code => ts.transpileModule(code, { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS } }).outputText;
const noop = () => {};
const composer = await createJiti(import.meta.url).import("../lib/edupi-composer-context.ts");
const pendingPrompt = { sessionId: "fork-session", clientRequestId: "11111111-1111-4111-8111-111111111111",
  occurredAt: "2026-10-21T00:00:00.000Z", message: "完整合成提交\n", draftValue: "合成提交", draftUnedited: true };

function fixture({ status = "accepted", gate = null, inFlight = false, composerClears = null, newDraft = false } = {}) {
  const storage = new Map();
  const coldStore = () => {
    const exports = {};
    vm.runInNewContext(compile(draftSource), { exports, window: {}, setTimeout: () => 1, clearTimeout: noop,
      require: name => name.endsWith("edupi-composer-context") ? composer : {
        APP_PREF_KEYS: { chatDrafts: "drafts" }, getPrefJson: key => storage.has(key) ? JSON.parse(storage.get(key)) : null,
        trySetPrefJson: (key, value) => { storage.set(key, JSON.stringify(value)); return true; },
      } });
    return exports;
  };
  const store = coldStore();
  store.setDraft("fork-session", { value: pendingPrompt.draftValue, images: [], pendingPrompt });
  store.flushDraftNow("fork-session");
  const draftKey = newDraft ? "new:/synthetic" : "fork-session";
  if (newDraft) { store.setDraft(draftKey, store.getDraft("fork-session")); store.flushDraftNow(draftKey); }
  const requests = [], updates = [];
  const effects = [];
  const context = {
    useCallback: callback => callback, useEffect: callback => effects.push(callback), isNew: newDraft, draftKey, getDraft: store.getDraft,
    activeDraftKeyRef: { current: draftKey }, setDraft: store.setDraft, flushDraftNow: store.flushDraftNow,
    refreshPromptRecovery: value => updates.push(value), agentRunningRef: { current: false },
    acknowledgePendingPrompt: store.acknowledgePendingPrompt, releasePendingPromptForNewMessage: store.releasePendingPromptForNewMessage,
    chatInputRef: { current: composerClears === null ? null : { acknowledgeSubmittedMessage: () => composerClears } },
    isTauriDesktop: () => true, promptSubmissionRunIdRef: { current: inFlight ? 5 : null },
    sessionIdRef: { current: newDraft ? null : "fork-session" }, sessionGenerationRef: { current: 0 }, promptRunIdRef: { current: 5 },
    contextLoadIdRef: { current: 0 }, messageHistoryRef: { current: { messageIds: [] } },
    reconcileEduPiCapturedPrompt: async (...args) => { requests.push(args); if (gate) await gate; return status; },
    fetchWithRetry: async () => ({ ok: true, status: 200, json: async () => ({ sessionId: "fork-session",
      leafId: "reply", context: { messages: [{ role: "user", content: pendingPrompt.message }], entryIds: ["user"] } }) }),
    setLoading: noop, setData: value => updates.push(value), setActiveLeafId: noop, dispatchMessageHistory: noop,
    setCurrentModelOverride: noop, setError: noop, setThinkingLevel: noop,
  };
  const recoveryStart = source.indexOf("  const acknowledgeSubmittedPrompt = useCallback");
  const recovery = recoveryStart < 0 ? "" : source.slice(recoveryStart, source.indexOf("  const loadSession = useCallback"));
  const loading = source.slice(source.indexOf("  const loadSession = useCallback"), source.indexOf("  /** Re-run the initial session load"));
  const load = new Function(...Object.keys(context), compile(`${recovery}\n${loading}\nreturn loadSession;`))(...Object.values(context));
  return { store, context, requests, updates, load: () => load("fork-session"),
    recoverNewDraft: async () => { effects.forEach(effect => effect()); await new Promise(resolve => setImmediate(resolve)); },
    cold: key => coldStore().getDraft(key), edit: value => { store.setDraft("fork-session", { value, images: [] }); store.flushDraftNow("fork-session"); } };
}

test("a lost ACK is automatically reconciled on a cold session read using the exact request command", async () => {
  const f = fixture();
  await f.load();
  assert.equal(f.cold("fork-session")?.pendingPrompt, undefined);
  assert.deepEqual(f.requests, [[pendingPrompt.sessionId, pendingPrompt.clientRequestId,
    { type: "prompt", message: pendingPrompt.message, clientRequestId: pendingPrompt.clientRequestId }]]);
});

test("automatic accepted recovery preserves a newer edited draft across another cold read", async () => {
  let finish;
  const f = fixture({ gate: new Promise(resolve => { finish = resolve; }) });
  const loading = f.load();
  await new Promise(resolve => setImmediate(resolve));
  f.edit("新草稿不能被旧回执删除");
  finish();
  await loading;
  assert.equal(f.cold("fork-session")?.pendingPrompt, undefined);
  assert.equal(f.cold("fork-session")?.value, "新草稿不能被旧回执删除");
});

test("unknown, cancelled and unavailable outcomes never clear a pending request", async () => {
  for (const status of ["uncertain", "cancelled", "unavailable", "not_found", "resolved"]) {
    const f = fixture({ status });
    await f.load();
    assert.equal(f.cold("fork-session")?.pendingPrompt?.clientRequestId, pendingPrompt.clientRequestId);
  }
});

test("a late recovery response cannot clear a newer run, session generation or request", async () => {
  for (const supersededBy of ["run", "session", "request"]) {
    let finish;
    const f = fixture({ gate: new Promise(resolve => { finish = resolve; }) });
    const loading = f.load();
    await new Promise(resolve => setImmediate(resolve));
    if (supersededBy === "run") f.context.promptRunIdRef.current++;
    if (supersededBy === "session") f.context.sessionGenerationRef.current += 2;
    if (supersededBy === "request") {
      f.store.releasePendingPromptForNewMessage("fork-session", pendingPrompt.clientRequestId);
      f.store.stagePendingPrompt("fork-session", { ...pendingPrompt, clientRequestId: "22222222-2222-4222-8222-222222222222" });
    }
    finish();
    await loading;
    assert.ok(f.cold("fork-session")?.pendingPrompt);
  }
});

test("session reload leaves an in-flight REST acknowledgement to its original sender", async () => {
  const f = fixture({ inFlight: true });
  await f.load();
  assert.deepEqual(f.requests, []);
  assert.ok(f.cold("fork-session")?.pendingPrompt);
});

test("an identical retyped draft remains durable when the composer rejects its older edit revision", async () => {
  const f = fixture({ composerClears: false });
  f.store.markPendingPromptDraftEdited("fork-session");
  await f.load();
  assert.equal(f.cold("fork-session")?.pendingPrompt, undefined);
  assert.equal(f.cold("fork-session")?.value, pendingPrompt.draftValue);
});

test("protecting a newly edited composer never leaves the original submitted text in another draft alias", async () => {
  const f = fixture({ composerClears: false });
  const alias = "new:/synthetic";
  f.store.setDraft(alias, { value: pendingPrompt.draftValue, images: [], pendingPrompt });
  f.store.flushDraftNow(alias);
  f.context.activeDraftKeyRef.current = alias;
  f.store.markPendingPromptDraftEdited(alias);
  await f.load();
  assert.equal(f.cold(alias)?.value, pendingPrompt.draftValue, "the identical retype belongs to the newer editor revision");
  assert.equal(f.cold(alias)?.pendingPrompt, undefined);
  assert.equal(f.cold("fork-session"), null, "the unedited submitted alias must not reappear on cold navigation");
});

test("the cold new-conversation entry reconciles its old pending draft without adopting or resending the old session", async () => {
  const f = fixture({ newDraft: true, composerClears: true });
  await f.recoverNewDraft();
  assert.equal(f.cold("new:/synthetic"), null);
  assert.equal(f.cold("fork-session"), null);
  assert.equal(f.context.sessionIdRef.current, null);
  assert.equal(f.requests.length, 1);
});
