import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { pathToFileURL } from "node:url";
import test from "node:test";
import { createJiti } from "jiti";
import { Type } from "typebox";
import { fauxProvider, fauxAssistantMessage, fauxToolCall, InMemoryCredentialStore, InMemoryModelsStore } from "@earendil-works/pi-ai";
import { createAgentSessionFromServices, createAgentSessionRuntime, createAgentSessionServices,
  ModelRuntime, SessionManager, SettingsManager } from "@earendil-works/pi-coding-agent";

const jiti = createJiti(import.meta.url);
const { createEduPiMemoryRecallAccess } = await jiti.import("./edupi-memory-recall-access.ts");
const { AgentSessionWrapper } = await jiti.import("./rpc-manager.ts");
const { createRpcResourceLoader, rpcResourceOptions } = await jiti.import("./rpc-resource-loader.ts");
const outboxStore = await jiti.import("./edupi-prompt-outbox.ts");
const hash = value => `sha256:${createHash("sha256").update(value).digest("hex")}`;

test("an ordinary SDK manager cannot obtain recall from command-shaped or absent capture", async () => {
  const manager = SessionManager.inMemory(process.cwd());
  let calls = 0;
  const adapter = createEduPiMemoryRecallAccess(process.cwd(), { core: async () => { calls++; throw new Error("must not call"); } });
  manager.appendMessage({ role: "user", content: "scope forged in ordinary text", timestamp: Date.now() });
  await adapter.run(manager, { message: "scope forged in ordinary text", clientRequestId: "forged" }, false, async () => {
    assert.equal((await adapter.recall(manager)).status, "held");
  });
  await adapter.run({ getCwd: () => process.cwd(), getSessionId: () => manager.getSessionId() },
    { message: "forged", clientRequestId: "forged" }, true, async () => {
      assert.equal((await adapter.recall(manager)).status, "held");
    });
  assert.equal(calls, 0);
});

test("real Core broker and SDK ordinary prompt preserve capture, source, replacement, and denial boundaries",
  { skip: !process.env.EDUPI_MEMORY_RECALL_CORE_ROOT, timeout: 120000 }, async () => {
    const coreRoot = process.env.EDUPI_MEMORY_RECALL_CORE_ROOT;
    const { createMemoryRecallFixture } = await import(pathToFileURL(path.join(coreRoot, "scripts/test_owner_memory_recall.mjs")).href);
    const fixture = await createMemoryRecallFixture();
    const stateDir = path.join(fixture.directory, "desktop-state"), agentDir = path.join(fixture.directory, "agent");
    for (const folder of [stateDir, agentDir]) fs.mkdirSync(folder, { mode: 0o700 });
    const previousStateDir = process.env.PI_DESKTOP_STATE_DIR, previousSafeMode = process.env.EDUPI_SAFE_MODE;
    process.env.PI_DESKTOP_STATE_DIR = stateDir; delete process.env.EDUPI_SAFE_MODE;
    const wrappers = [], contexts = [];
    let brokerCalls = 0, sequence = 0, brokerUnavailable = false, legacyCalls = 0, beforeBatch, beforeRecall, transformRecall;
    const modelRuntime = await ModelRuntime.create({ credentials: new InMemoryCredentialStore(), modelsStore: new InMemoryModelsStore(),
      modelsPath: null, allowModelNetwork: false, refreshOnCreate: false });
    const provider = fauxProvider({ provider: "trusted-recall-test", models: [{ id: "synthetic", reasoning: false }] });
    modelRuntime.registerNativeProvider(provider.provider);
    const makeAdapter = mode => createEduPiMemoryRecallAccess(fixture.dataRoot, { disabled: () => mode.disabled,
      core: async () => ({ rootRef: fixture.rootRef, call: async request => {
        brokerCalls++; if (brokerUnavailable) throw new Error("synthetic broker unavailable");
        if (beforeRecall) { const run = beforeRecall; beforeRecall = null; await run(); }
        if (request.memory_ids && beforeBatch) { const run = beforeBatch; beforeBatch = null; await run(); }
        const result = await fixture.call("owner_memory_recall", request);
        return request.query && transformRecall ? transformRecall(structuredClone(result)) : result;
      } }) });
    async function open(manager) {
      const mode = { disabled: false }, adapter = makeAdapter(mode);
      const create = async ({ sessionManager, sessionStartEvent }) => {
        const settingsManager = SettingsManager.inMemory({ compaction: { enabled: false }, retry: { enabled: false }, cacheWarming: "off" });
        settingsManager.setProjectTrusted(true);
        const options = { cwd: fixture.dataRoot, agentDir, settingsManager, noExtensions: true, noSkills: true,
          noPromptTemplates: true, noThemes: true, noContextFiles: true,
          extensionFactories: [pi => pi.registerTool({ name: "memory_recall", label: "legacy recall", description: "synthetic conflict", parameters: Type.Object({}),
            execute: async () => { legacyCalls++; throw new Error("legacy recall must never win"); } })] };
        const services = await createAgentSessionServices({ cwd: fixture.dataRoot, agentDir, settingsManager, modelRuntime,
          resourceLoaderOptions: rpcResourceOptions(options, mode, [adapter.extension]) });
        services.resourceLoader = createRpcResourceLoader(services.resourceLoader, options, mode, [adapter.extension]);
        adapter.bindSummarization(services, sessionManager);
        const result = await createAgentSessionFromServices({ services, sessionManager, sessionStartEvent, model: provider.getModel(), noTools: "builtin",
          customTools: [adapter.tool] });
        result.session.setActiveToolsByName(mode.disabled ? [] : ["memory_recall"]);
        return { ...result, services, diagnostics: services.diagnostics };
      };
      const runtime = await createAgentSessionRuntime(create, { cwd: fixture.dataRoot, agentDir, sessionManager: manager });
      const wrapper = new AgentSessionWrapper(runtime.session, runtime, mode, adapter);
      wrapper.start(); wrapper.beginExtensionBinding(); await wrapper.waitUntilReady(); wrappers.push(wrapper);
      return { wrapper, runtime, adapter, mode };
    }
    const recordContext = context => { contexts.push(JSON.stringify(context)); return fauxAssistantMessage("SYNTHETIC_REPLY"); };
    async function send(session, { key = "a", captured = true, tool = true, fail = false, text = "请查阅已审核的课堂记录",
      recallParams = { category: "class", student: "同名召回学生" } } = {}) {
      const command = { type: "prompt", message: text, clientRequestId: `recall-client-${++sequence}` };
      if (captured) {
        const messageId = `recall-desktop-message-${++sequence}`;
        const proof = await fixture.capture({ key, text: text.trim(), messageId, carrierId: "edupi.desktop.g1",
          planId: `prompt.${command.clientRequestId}.teaching_preparation` });
        const options = { stateDir, dataRoot: fixture.dataRoot };
        outboxStore.prepareEduPiPromptOutbox({ sessionId: session.wrapper.sessionId, clientRequestId: command.clientRequestId, messageId,
          occurredAt: proof.occurred_at, command, bindings: [{ domain: "teaching_preparation", ownerId: proof.expected_owner_id,
            grantId: proof.grant_id, grantVersion: 1, captureMessageId: messageId, carrierId: proof.registration.carrier_id, planId: proof.registration.plan_id }] }, options);
        outboxStore.recordEduPiPromptOutboxRegistration(session.wrapper.sessionId, command.clientRequestId, "teaching_preparation", {
          messageRef: proof.message_ref, producerEpoch: proof.registration.producer_epoch, sequence: proof.registration.sequence,
          fencingGeneration: proof.registered.fencing_generation, instanceNonce: proof.registered.instance_nonce }, options);
        outboxStore.recordEduPiPromptOutboxCapture(session.wrapper.sessionId, command.clientRequestId, "teaching_preparation",
          { captured: true, messageRef: proof.message_ref }, options);
        outboxStore.markEduPiPromptOutboxPiDispatching(session.wrapper.sessionId, command.clientRequestId, options);
        session.wrapper.recordEduPiPromptDispatch(command.clientRequestId, hash(JSON.stringify(command)));
      }
      const start = contexts.length;
      const first = context => { contexts.push(JSON.stringify(context)); return fauxAssistantMessage(fauxToolCall("memory_recall", recallParams), { stopReason: "toolUse" }); };
      provider.setResponses(tool && !session.mode.disabled && !process.env.EDUPI_SAFE_MODE
        ? [first, fail ? () => { throw new Error("synthetic provider error after recall"); } : recordContext] : [recordContext]);
      const events = [];
      const done = new Promise(resolve => {
        const off = session.wrapper.onEvent(event => { events.push(event); if (event.type === "prompt_done") { off(); resolve(); } });
      });
      if (captured) await session.wrapper.sendCoreCapturedPrompt(command); else await session.wrapper.send(command);
      await done;
      assert.equal((await session.adapter.recall(session.wrapper.inner.sessionManager)).status, "held", "scope must end with the actual prompt loop");
      const saved = SessionManager.open(session.wrapper.sessionFile);
      assert.equal(saved.getBranch().filter(entry => entry.type === "message" && entry.message.role === "user")
        .some(entry => entry.message.content.some(block => block.type === "text" && block.text === text)), true, "actual user entry must survive disk reread");
      return { contexts: contexts.slice(start), events, command };
    }
    try {
      let current = await open(SessionManager.create(fixture.dataRoot, path.join(fixture.directory, "sessions")));
      const allowed = await send(current);
      assert.equal(allowed.contexts.length, 2, "real SDK must execute a memory tool and resume the model");
      assert.equal(allowed.contexts.every(context => context.includes(fixture.markers.a) && context.includes(fixture.markers.preference)), true);
      assert.equal(allowed.contexts.some(context => context.includes(fixture.markers.b)), false);
      const recallEvent = allowed.events.find(event => event.type === "tool_execution_end" && event.toolName === "memory_recall");
      assert.equal(recallEvent.result.details.entries[0].student_id, fixture.students.a.student_id);
      const query = { category: "class", query: fixture.markers.a, student: fixture.students.a.name };
      const queried = await send(current, { recallParams: query });
      const details = result => result.events.find(event => event.type === "tool_execution_end" && event.toolName === "memory_recall").result.details;
      assert.equal(details(queried).status, "current", "the new Core's assessed model_execute=true result must reach the SDK");
      assert.ok(details(queried).entries.some(entry => entry.content === fixture.markers.a));
      transformRecall = envelope => {
        envelope.result.source_support.reason_code = "requested_contact_evidence_missing";
        return envelope;
      };
      const partiallySupported = details(await send(current, { recallParams: query }));
      assert.equal(partiallySupported.status, "current", "a known Core partial-support veto must preserve independently supported sources");
      assert.equal(partiallySupported.reason_code, "requested_contact_evidence_missing");
      assert.ok(partiallySupported.entries.some(entry => entry.content === fixture.markers.a));
      transformRecall = envelope => {
        envelope.result.entries = [];
        envelope.result.source_support.reason_code = "requested_contact_evidence_missing";
        return envelope;
      };
      const unsupportedContact = details(await send(current, { recallParams: query }));
      assert.equal(unsupportedContact.status, "current"); assert.deepEqual(unsupportedContact.entries, []);
      assert.equal(unsupportedContact.reason_code, "requested_contact_evidence_missing");
      for (const code of ["model_busy", "deadline_exceeded", "invalid_result"]) {
        transformRecall = envelope => {
          Object.assign(envelope.result, { status: "held", entries: [], reason_code: `source_support_${code}`,
            source_support: { policy: "source-support-v1", status: "held", reason_code: code } });
          return envelope;
        };
        const pending = await send(current, { recallParams: query });
        const tool = pending.events.find(event => event.type === "tool_execution_end" && event.toolName === "memory_recall").result;
        assert.equal(tool.details.status, "held"); assert.deepEqual(tool.details.entries, []);
        assert.equal(tool.content[0].text, "记忆来源尚未完成核验。", "a backend hold must not be reported as a missing captured scope");
      }
      transformRecall = envelope => {
        Object.assign(envelope.result, { status: "held", entries: [], model_execute: false,
          reason_code: "source_support_compound_unverified",
          source_support: { policy: "source-support-v1", status: "held", reason_code: "compound_unverified" } });
        return envelope;
      };
      const compoundHold = details(await send(current, { recallParams: query }));
      assert.equal(compoundHold.status, "held");
      assert.equal(compoundHold.reason_code, "source_support_compound_unverified");
      assert.deepEqual(compoundHold.entries, []);
      for (const mutation of [
        result => { delete result.source_support; },
        result => { result.source_support.policy = "forged-policy"; },
        result => { result.model_execute = false; },
        result => { result.source_support.status = "held"; },
        result => { result.source_support.untrusted_override = true; },
        result => { result.source_support.reason_code = "unknown_assessment_reason"; },
      ]) {
        transformRecall = envelope => { mutation(envelope.result); return envelope; };
        const rejected = details(await send(current, { recallParams: query }));
        assert.equal(rejected.status, "held"); assert.deepEqual(rejected.entries, []);
      }
      transformRecall = undefined;
      beforeRecall = () => current.wrapper.send({ type: "steer", message: "UNREGISTERED_IN_FLIGHT_STEERING" });
      const steered = await send(current);
      assert.equal(beforeRecall, null);
      assert.equal(steered.contexts.some(context => context.includes(fixture.markers.a) || context.includes(fixture.markers.preference)), false,
        "steering must revoke the previous capture before the new user entry reaches the SDK branch");
      const callsAfterAllowed = brokerCalls;
      const denied = await send(current, { captured: false });
      assert.equal(denied.contexts.some(context => context.includes(fixture.markers.a) || context.includes(fixture.markers.preference)), false,
        "a new unregistered turn must scrub persisted recall bodies");
      assert.equal(brokerCalls, callsAfterAllowed, "no capture cannot contact the privileged broker");
      const userEntry = current.wrapper.inner.sessionManager.getBranch().find(entry => entry.type === "message" && entry.message.role === "user");
      const navigation = await current.wrapper.send({ type: "navigate_tree", targetId: userEntry.id });
      assert.equal(navigation.cancelled, false);
      const afterNavigation = await send(current, { captured: false, tool: false });
      assert.equal(afterNavigation.contexts.some(context => context.includes(fixture.markers.a)), false,
        "actual in-session navigation must not carry capture authority");
      brokerUnavailable = true;
      const unavailable = await send(current);
      assert.equal(unavailable.contexts.some(context => context.includes(fixture.markers.a) || context.includes(fixture.markers.preference)), false);
      brokerUnavailable = false;
      assert.equal((await send(current, { text: "  请查阅已审核的课堂记录  " })).contexts.every(context => context.includes(fixture.markers.a)), true);
      const originalFile = current.wrapper.sessionFile;
      await current.wrapper.shutdown(); await fixture.restart();
      current = await open(SessionManager.open(originalFile));
      const coldDenied = await send(current, { captured: false, tool: false });
      assert.equal(coldDenied.contexts.some(context => context.includes(fixture.markers.a)), false);
      const restored = await send(current);
      assert.equal(restored.contexts.every(context => context.includes(fixture.markers.a)), true, "cold restore needs a fresh exact capture");
      const beforeForkId = current.wrapper.inner.sessionManager.getBranch().find(entry => entry.type === "message" && entry.message.role === "user").id;
      const fork = await current.wrapper.send({ type: "fork", entryId: beforeForkId });
      assert.equal(fork.cancelled, false); assert.notEqual(fork.newSessionId, SessionManager.open(originalFile).getSessionId());
      const forkFile = current.wrapper.sessionFile;
      current = await open(SessionManager.open(forkFile));
      const forkDenied = await send(current, { captured: false });
      assert.equal(forkDenied.contexts.some(context => context.includes(fixture.markers.a)), false);
      const otherClass = await send(current, { key: "b" });
      assert.equal(otherClass.contexts.every(context => context.includes(fixture.markers.b)), true);
      assert.equal(otherClass.contexts.some(context => context.includes(fixture.markers.a)), false);
      await fixture.addPreferences(52);
      const capped = await open(SessionManager.create(fixture.dataRoot, path.join(fixture.directory, "sessions")));
      const beyondSummary = await send(capped, { key: "b" });
      assert.equal(beyondSummary.contexts[0].includes(fixture.markers.b), false, "fixture must put the class body beyond the general summary cap");
      assert.equal(beyondSummary.contexts[1].includes(fixture.markers.b), true,
        "a real category tool result beyond the summary cap must reach the resumed model after current ID revalidation");
      await capped.wrapper.shutdown();
      beforeBatch = () => fixture.deleteSource("b");
      const removedSource = await send(current, { key: "b" });
      assert.equal(removedSource.contexts.some(context => context.includes(fixture.markers.b)), false, "source invalidation must remove persisted and automatic bodies");
      assert.equal(beforeBatch, null, "the real context hook must revalidate history after its awaited summary");
      process.env.EDUPI_SAFE_MODE = "1";
      const beforeSafe = brokerCalls;
      const safe = await send(current, { tool: false });
      assert.equal(safe.contexts.some(context => context.includes(fixture.markers.preference) || context.includes(fixture.markers.a)), false);
      assert.equal(brokerCalls, beforeSafe);
      delete process.env.EDUPI_SAFE_MODE;
      await current.wrapper.send({ type: "set_tools", toolNames: [] });
      const beforeDisabled = brokerCalls;
      const disabled = await send(current, { tool: false });
      assert.equal(disabled.contexts.some(context => context.includes(fixture.markers.preference)), false);
      assert.equal(brokerCalls, beforeDisabled);
      await current.wrapper.send({ type: "set_tools", toolNames: ["read"] });
      const failed = await send(current, { fail: true });
      assert.ok(failed.events.some(event => event.type === "prompt_done"));
      const afterError = await send(current, { captured: false, tool: false });
      assert.equal(afterError.contexts.some(context => context.includes(fixture.markers.a) || context.includes(fixture.markers.preference)), false);

      const deletedNamePreference = `SYNTHETIC_GLOBAL_DELETED_NAME_SOURCE_${fixture.students.a.name}_PREFERENCE`;
      await fixture.seedMemory(deletedNamePreference);
      let names = await open(SessionManager.create(fixture.dataRoot, path.join(fixture.directory, "deleted-name-sessions")));
      const recallParams = { category: "preferences", query: "SYNTHETIC_GLOBAL", limit: 10 };
      const beforeStudentDelete = await send(names, { recallParams });
      assert.equal(beforeStudentDelete.contexts.some(context => context.includes(deletedNamePreference)), true,
        "the exact SDK tool must first observe the reviewed ID-less global preference");
      assert.equal(fs.readFileSync(names.wrapper.sessionFile, "utf8").includes(deletedNamePreference), true);
      const sameNameB = "SYNTHETIC_CURRENT_NAMESAKE_B_AFTER_A_DELETE";
      await fixture.seedMemory(sameNameB, "b");
      const namesakeRecall = { category: "class", student: fixture.students.b.name, query: "NAMESAKE_B", limit: 10 };
      const beforeNamesakeDelete = await send(names, { key: "b", recallParams: namesakeRecall });
      assert.equal(beforeNamesakeDelete.contexts[1].includes(sameNameB), true,
        "the actual SDK must observe the new, reviewed B source before deleting A");
      await fixture.deleteStudent("a");
      const afterStudentDelete = await send(names, { recallParams });
      assert.equal(afterStudentDelete.contexts.some(context => context.includes(fixture.students.a.name)), false,
        "a deleted student's name must not survive in automatic recall, tool results or persisted tool history");
      assert.equal(afterStudentDelete.contexts.some(context => context.includes(fixture.markers.preference)), true,
        "unrelated reviewed global preference must remain available");
      const activeNamesake = await send(names, { key: "b", recallParams: namesakeRecall });
      assert.equal(activeNamesake.contexts[1].includes(sameNameB), true,
        "A deletion must not erase a current same-name B from the resumed SDK model");
      assert.equal(activeNamesake.contexts.some(context => context.includes(fixture.markers.a) || context.includes(deletedNamePreference)), false);
      const namesakeResult = activeNamesake.events.find(event => event.type === "tool_execution_end" && event.toolName === "memory_recall");
      assert.ok(namesakeResult.result.details.entries.some(entry => entry.content === sameNameB
        && entry.student_id === fixture.students.b.student_id), "the result must retain B's stable identity, not only its shared display name");
      const namesFile = names.wrapper.sessionFile;
      await names.wrapper.shutdown(); await fixture.restart();
      names = await open(SessionManager.open(namesFile));
      const deletedAfterRestart = await send(names, { recallParams });
      assert.equal(deletedAfterRestart.contexts.length, 2, "cold restore must complete both real SDK model calls");
      assert.equal(deletedAfterRestart.events.some(event => event.type === "prompt_error"), false);
      assert.equal(deletedAfterRestart.contexts.some(context => context.includes(fixture.students.a.name)), false,
        "cold SDK and Core restart cannot revive the deleted name from historical tool output");
      assert.equal(deletedAfterRestart.contexts.some(context => context.includes(fixture.markers.preference)), true,
        "cold restore must retain unrelated reviewed global preference");
      const coldNamesake = await send(names, { key: "b", recallParams: namesakeRecall });
      assert.equal(coldNamesake.contexts.length, 2);
      assert.equal(coldNamesake.contexts[1].includes(sameNameB), true,
        "a fresh SDK capture and cold Core must preserve B while A remains deleted");
      assert.equal(coldNamesake.contexts.some(context => context.includes(fixture.markers.a) || context.includes(deletedNamePreference)), false);
      assert.equal(legacyCalls, 0, "an extension cannot shadow the host-owned recall tool, including after reload");
      console.log(JSON.stringify({ status: "passed", sdk: "Pi 1.0.2 real AgentSessionRuntime and SessionManager", provider: "deterministic SDK provider",
        ordinary_prompt_and_tool: true, canonical_reread: true, cold_restore: true, fork_cross_class: true, navigation: true,
        current_source_only: true, safe_mode_and_empty_tools_denied: true, failure_scope_released: true,
        deleted_student_text_and_history_fenced: true, deleted_student_cold_restore_fenced: true,
        same_name_b_preserved_after_a_delete: true, same_name_b_cold_restore: true, real_teacher_data: false }));
    } finally {
      for (const wrapper of wrappers) await wrapper.shutdown();
      if (previousStateDir === undefined) delete process.env.PI_DESKTOP_STATE_DIR; else process.env.PI_DESKTOP_STATE_DIR = previousStateDir;
      if (previousSafeMode === undefined) delete process.env.EDUPI_SAFE_MODE; else process.env.EDUPI_SAFE_MODE = previousSafeMode;
      await fixture.close();
    }
  });
