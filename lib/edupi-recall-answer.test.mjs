import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import test from "node:test";
import { createJiti } from "jiti";
import { fauxProvider, fauxAssistantMessage, InMemoryCredentialStore, InMemoryModelsStore } from "@earendil-works/pi-ai";
import { createAgentSessionFromServices, createAgentSessionRuntime, createAgentSessionServices,
  ModelRuntime, SessionManager, SettingsManager } from "@earendil-works/pi-coding-agent";

const jiti = createJiti(import.meta.url);
const { parseCoreRecallAnswer, parseCoreRecallAnswerDetails, CORE_RECALL_ANSWER_MESSAGE } = await jiti.import("./edupi-recall-answer.ts");
const { createEduPiMemoryRecallAccess } = await jiti.import("./edupi-memory-recall-access.ts");
const { AgentSessionWrapper } = await jiti.import("./rpc-manager.ts");
const outboxStore = await jiti.import("./edupi-prompt-outbox.ts");
const { readIssuedEduPiRecall } = await jiti.import("./edupi-recall-state.ts");
const hash = text => `sha256:${createHash("sha256").update(text).digest("hex")}`;
const sources = [
  { id: "source-host", content: "合成班会由张老师主持。", source_fingerprint: hash("source-host") },
  { id: "source-order", content: "合成班会安排在第二场展示。", source_fingerprint: hash("source-order") },
];
const answer = () => ({ policy: "current-case-facets-v1", work_case_ref: "synthetic-case", anchor: "合成班会",
  receipt_ref: `recall_answer:${"f".repeat(64)}`,
  valid_until: new Date(Date.now() + 60_000).toISOString(),
  text: `${sources[0].content}\n${sources[1].content}`, question_case_verified: true, answer_verified: true,
  facets: [
    { facet_id: "facet_0", question: "由谁主持", kind: "person", source_id: sources[0].id,
      source_fingerprint: sources[0].source_fingerprint, answer: ["张老师"], evidence: [sources[0].content] },
    { facet_id: "facet_1", question: "排在第几场", kind: "ordinal", source_id: sources[1].id,
      source_fingerprint: sources[1].source_fingerprint, answer: ["第二场"], evidence: [sources[1].content] },
  ] });

test("formal answer parser preserves exact Core text and refuses missing, rebound or forged facet citations", () => {
  const value = answer();
  assert.equal(parseCoreRecallAnswer(value, sources)?.text, value.text);
  for (const change of [
    a => { a.answer_verified = false; }, a => { a.question_case_verified = false; },
    a => { a.facets[0].source_fingerprint = hash("old"); }, a => { a.facets[0].evidence = ["李老师主持"]; },
    a => { a.facets[1].facet_id = a.facets[0].facet_id; }, a => { a.facets.pop(); },
    a => { a.policy = "source-support-v1"; }, a => { a.anchor_verified = true; },
  ]) { const copy = structuredClone(value); change(copy); assert.equal(parseCoreRecallAnswer(copy, sources), null); }
  assert.equal(parseCoreRecallAnswer(value, [sources[0], sources[0], sources[1]]), null);
  assert.equal(parseCoreRecallAnswer({ status: "verified", case_status: "bound" }, sources), null,
    "old source proof is not an answer");
});

test("saved Core details are historical data and cannot carry a persisted UI current flag", () => {
  const details = { version: 1, receiptId: "01234567-0123-4123-8123-012345678901", sessionId: "session",
    userEntryId: "user", clientRequestId: "request", originalTextHash: hash("question"),
    issuedAt: "2026-11-17T00:00:00.000Z", answer: answer(), sources, reasonCode: null };
  assert.ok(parseCoreRecallAnswerDetails(details));
  assert.equal(parseCoreRecallAnswerDetails({ ...details, current: true }), null);
  assert.equal(parseCoreRecallAnswerDetails({ ...details, answer: null }), null);
  assert.ok(parseCoreRecallAnswerDetails({ ...details, answer: null, sources: [], reasonCode: "source_changed" }));
});

for (const forceCompaction of [false, true]) test(
  `real SDK saves canonical text without chat inference${forceCompaction ? " across pre-prompt auto compaction" : ""}; later context excludes it`,
  async () => {
  const directory = fs.mkdtempSync("/private/tmp/edupi-r04-sdk-answer-");
  const stateDir = path.join(directory, "state"), agentDir = path.join(directory, "agent");
  for (const dir of [stateDir, agentDir]) fs.mkdirSync(dir, { mode: 0o700 });
  fs.mkdirSync(path.join(directory, ".edupi", "memory"), { recursive: true, mode: 0o700 });
  const previousState = process.env.PI_DESKTOP_STATE_DIR;
  process.env.PI_DESKTOP_STATE_DIR = stateDir;
  let wrapper, runtime, settingsManager;
  const modelRuntime = await ModelRuntime.create({ credentials: new InMemoryCredentialStore(), modelsStore: new InMemoryModelsStore(),
    modelsPath: null, allowModelNetwork: false, refreshOnCreate: false });
  let enabled = true, modelCalls = 0, calls = [];
  const provider = fauxProvider({ provider: "r04-sdk-oracle", models: [{ id: "synthetic", reasoning: false }] });
  modelRuntime.registerNativeProvider(provider.provider);
  const adapter = createEduPiMemoryRecallAccess(directory, { answersEnabled: () => enabled, core: async () => ({
    rootRef: hash("synthetic-root"), call: async request => {
      calls.push(request);
      const identity = Object.fromEntries(["root_ref", "message_ref", "conversation_id", "message_id", "original_text_hash"].map(key => [key, request[key]]));
      return { ok: true, result: { version: 1, ...identity, status: "current", reason_code: null, term_ref: "term",
        entries: request.query ? sources.map(source => ({ ...source, category: "class", student: null, student_id: null, managed_method: false })) : [],
        model_execute: Boolean(request.query), external_send: false, ...(request.query ? { answer: answer() } : {}) } };
    },
  }) });
  const manager = SessionManager.create(directory, path.join(directory, "sessions"));
  try {
    const factory = async ({ sessionManager, sessionStartEvent }) => {
      settingsManager = SettingsManager.inMemory({
        compaction: { enabled: forceCompaction, reserveTokens: 1_000_000, keepRecentTokens: 1 },
        retry: { enabled: false }, cacheWarming: "off",
      });
      settingsManager.setProjectTrusted(true);
      const services = await createAgentSessionServices({ cwd: directory, agentDir, settingsManager, modelRuntime,
        resourceLoaderOptions: { cwd: directory, agentDir, settingsManager, noExtensions: true, noSkills: true,
          noPromptTemplates: true, noThemes: true, noContextFiles: true, extensionFactories: [adapter.extension] } });
      const result = await createAgentSessionFromServices({ services, sessionManager, sessionStartEvent, model: provider.getModel(),
        noTools: "builtin", customTools: [adapter.tool] });
      return { ...result, services, diagnostics: services.diagnostics };
    };
    runtime = await createAgentSessionRuntime(factory, { cwd: directory, agentDir, sessionManager: manager });
    wrapper = new AgentSessionWrapper(runtime.session, runtime, { disabled: false }, adapter);
    wrapper.start(); wrapper.beginExtensionBinding(); await wrapper.waitUntilReady();
    async function send(text, sequence) {
      const command = { type: "prompt", message: text, clientRequestId: `r04-client-${sequence}` };
      const options = { stateDir, dataRoot: directory };
      outboxStore.prepareEduPiPromptOutbox({ sessionId: wrapper.sessionId, clientRequestId: command.clientRequestId,
        messageId: `message-${sequence}`, occurredAt: new Date().toISOString(), command,
        bindings: [{ domain: "teaching_preparation", ownerId: "owner", grantId: "grant", grantVersion: 1,
          captureMessageId: `message-${sequence}`, carrierId: "edupi.desktop.g1", planId: `plan-${sequence}` }] }, options);
      const messageRef = `owner_message:${hash(`message-${sequence}`).slice(7)}`;
      outboxStore.recordEduPiPromptOutboxRegistration(wrapper.sessionId, command.clientRequestId, "teaching_preparation", {
        messageRef, producerEpoch: "a".repeat(64), sequence, fencingGeneration: 1, instanceNonce: "synthetic-instance",
      }, options);
      outboxStore.recordEduPiPromptOutboxCapture(wrapper.sessionId, command.clientRequestId, "teaching_preparation", { captured: true, messageRef }, options);
      outboxStore.markEduPiPromptOutboxPiDispatching(wrapper.sessionId, command.clientRequestId, options);
      wrapper.recordEduPiPromptDispatch(command.clientRequestId, hash(JSON.stringify(command)));
      const done = new Promise(resolve => { const off = wrapper.onEvent(event => {
        if (event.type === "prompt_done") { off(); resolve(); }
      }); });
      await wrapper.sendCoreCapturedPrompt(command); await done;
    }
    provider.setResponses([() => { modelCalls++; return fauxAssistantMessage("MUST_NOT_REWRITE_NUMBERS"); }]);
    const question = "甲班合成班会由谁主持，排在第几场展示？";
    await send(question, 1);
    assert.equal(modelCalls, 0, "formal recall must happen before the chat model");
    assert.equal(calls.length, 1);
    assert.equal(calls[0].query, question);
    assert.equal(Object.hasOwn(calls[0], "work_case_ref"), false);
    assert.equal(Object.hasOwn(calls[0], "memory_ids"), false);
    assert.equal(Object.hasOwn(calls[0], "limit"), false);
    const saved = SessionManager.open(wrapper.sessionFile);
    const custom = saved.getBranch().filter(entry => entry.type === "custom_message" && entry.customType === CORE_RECALL_ANSWER_MESSAGE);
    assert.equal(custom.length, 1);
    assert.equal(custom[0].content, answer().text);
    assert.deepEqual(custom[0].details.answer.facets, answer().facets);
    assert.equal(readIssuedEduPiRecall(custom[0].details.receiptId)?.invalidated, null);
    if (forceCompaction) {
      const events = [];
      const unsubscribe = wrapper.onEvent(event => events.push(event));
      try { await send(question, 2); } finally { unsubscribe(); }
      assert.ok(events.some(event => event.type === "compaction_start"), "the actual SDK attempted pre-prompt compaction");
      assert.ok(events.some(event => event.type === "compaction_end" && event.aborted === true), "the public hook cancelled it");
      assert.equal(modelCalls, 0, "Core-only turns cannot invoke the summary model before the user entry");
      assert.equal(calls.length, 2);
      assert.equal(SessionManager.open(wrapper.sessionFile).getBranch()
        .filter(entry => entry.type === "custom_message" && entry.customType === CORE_RECALL_ANSWER_MESSAGE).length, 2);
      settingsManager.setCompactionEnabled(false);
    }
    enabled = false;
    provider.setResponses([context => {
      modelCalls++; assert.equal(JSON.stringify(context).includes(answer().text), false);
      return fauxAssistantMessage("ordinary next turn");
    }]);
    await send("下一轮只处理新的问题", forceCompaction ? 3 : 2);
    assert.equal(modelCalls, 1);
    assert.equal(readIssuedEduPiRecall(custom[0].details.receiptId)?.invalidated, "turn_changed");
  } finally {
    await wrapper?.shutdown(); await runtime?.dispose();
    if (previousState === undefined) delete process.env.PI_DESKTOP_STATE_DIR; else process.env.PI_DESKTOP_STATE_DIR = previousState;
    fs.rmSync(directory, { recursive: true, force: false });
  }
});
