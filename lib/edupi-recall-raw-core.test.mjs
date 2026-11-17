import assert from "node:assert/strict";
import * as crypto from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { isDeepStrictEqual } from "node:util";
import test from "node:test";
import { createJiti } from "jiti";
import ts from "typescript";
import { fauxProvider, InMemoryCredentialStore, InMemoryModelsStore } from "@earendil-works/pi-ai";
import { createAgentSessionFromServices, createAgentSessionRuntime, createAgentSessionServices,
  ModelRuntime, SessionManager, SettingsManager } from "@earendil-works/pi-coding-agent";
import { createDesktopR04Fixture, R04_QUERY, R04_SOURCE_TEXTS, startDesktopR04FixtureProvider } from "../scripts/r04-desktop-acceptance-fixture.mjs";

const hash = value => `sha256:${crypto.createHash("sha256").update(value).digest("hex")}`;
const write = (file, value) => fs.writeFileSync(file, `${JSON.stringify(value, null, 2)}\n`, { mode: 0o600 });
const desktopRoot = fileURLToPath(new URL("../", import.meta.url));

// Evaluate the saved production modules with only the local HTTP/runtime and
// SDK-session lookup adapters replaced. All Core results come from the daemon.
function evaluate(relative, dependencies) {
  const source = fs.readFileSync(path.join(desktopRoot, relative), "utf8");
  const output = ts.transpileModule(source, { compilerOptions: {
    module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, esModuleInterop: true,
  } }).outputText;
  const evaluated = { exports: {} };
  new Function("require", "module", "exports", output)(name => {
    assert.ok(Object.hasOwn(dependencies, name), `unexpected dependency: ${name}`);
    return dependencies[name];
  }, evaluated, evaluated.exports);
  return evaluated.exports;
}

test("the synthetic provider accepts surrounding whitespace only for the allow-listed question", async () => {
  const counters = { facetRequests: 0, ordinaryPiRequests: 0, rejectedFacetRequests: 0, aliases: [] };
  const provider = await startDesktopR04FixtureProvider(counters);
  try {
    const call = query => fetch(`${provider.baseUrl}/chat/completions`, {
      method: "POST", headers: { "content-type": "application/json" },
      body: JSON.stringify({ messages: [{ role: "user", content: `Select exactly one current case\nUNTRUSTED_INPUT_JSON:\n${JSON.stringify({
        query, facets: [{}, {}], cases: [{ case_id: "synthetic-case", sources: R04_SOURCE_TEXTS.map((content, index) =>
          ({ source_id: `synthetic-source-${index}`, content })) }],
      })}` }] }),
    });
    for (const query of [R04_QUERY, ` \t\n${R04_QUERY}\r\n\u3000`]) {
      const result = await call(query);
      assert.equal(result.status, 200); await result.text();
    }
    const denied = await call(` ${R04_QUERY}另一个问题 `);
    assert.equal(denied.status, 422); await denied.text();
    assert.equal(counters.rejectedFacetRequests, 1);
    assert.equal(counters.ordinaryPiRequests, 0);
  } finally { await provider.stop(); }
});

test("raw route capture, SDK answer and opaque full receipt recheck agree in the frozen real Core", {
  skip: !process.env.EDUPI_R04_RAW_CORE_ROOT, timeout: 120_000,
}, async t => {
  const evidenceDir = process.env.EDUPI_R04_RAW_EVIDENCE_DIR
    ? fs.realpathSync(process.env.EDUPI_R04_RAW_EVIDENCE_DIR)
    : fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), "edupi-r04-raw-evidence-")));
  const reportFile = path.join(evidenceDir, `raw-core-${crypto.randomUUID()}.json`);
  const report = { version: 1, status: "running", syntheticOnly: true, startedAt: new Date().toISOString(),
    environment: { node: process.version, platform: process.platform, arch: process.arch },
    calls: [], chatModelCalls: 0 };
  t.diagnostic(`real Core evidence: ${reportFile}`);
  write(reportFile, report);
  let fixture, wrapper, sdkRuntime;
  try {
    fixture = await createDesktopR04Fixture({ coreRoot: process.env.EDUPI_R04_RAW_CORE_ROOT, evidenceDir });
    Object.assign(report, { coreRoot: fixture.coreRoot, coreCommit: fixture.coreCommit,
      dataRoot: fixture.dataRoot, privateRoot: fixture.container, fixtureEvidence: fixture.evidenceFile });
    await fixture.startCore();
    report.coreEndpoint = fixture.metadata().coreEndpoint;
    await fixture.withEnvironment(async () => {
      const jiti = createJiti(import.meta.url, { tsconfigPaths: true, fsCache: false });
      const imported = {};
      for (const name of ["bounded-form-data", "edupi-ambient-message-ledger", "edupi-ambient-session-lock",
        "edupi-proactivity-config", "edupi-proactivity-runtime", "edupi-registered-prompt",
        "edupi-prompt-reconciliation", "edupi-prompt-intent", "edupi-prompt-outbox", "image-attachments",
        "safe-mode", "edupi-recall-answer", "edupi-recall-state", "edupi-proactivity-control",
        "edupi-memory-recall-access", "rpc-manager"]) {
        imported[name] = await jiti.import(`./${name}.ts`);
      }
      const host = {
        recallAnswersActive: true,
        async call(operation, payload) {
          const value = await fixture.call(operation, payload);
          report.calls.push({ operation, payload: structuredClone(payload), response: structuredClone(value) });
          write(reportFile, report);
          return value;
        },
        callOwnerControl(operation, payload) { return this.call(operation, payload); },
      };
      // Meet the existing person gate with real read/confirm operations on the
      // synthetic source. No person fact or successful answer is fabricated.
      const personRequest = { root_ref: fixture.root.dataRootFingerprint, expected_owner_id: fixture.ownerId,
        message_ref: fixture.sources[0].message_ref, person_name: "张老师" };
      const preview = await host.callOwnerControl("owner_recall_person_read", personRequest);
      assert.equal(preview.result.status, "current");
      const confirmed = await host.callOwnerControl("owner_recall_person_confirm", {
        ...personRequest, command_id: `raw-person-${crypto.randomUUID()}`,
        expected_source_fingerprint: preview.result.source_fingerprint,
        expected_person_revision: preview.result.person_revision,
      });
      assert.equal(confirmed.result.status, "confirmed");
      const adapter = imported["edupi-memory-recall-access"].createEduPiMemoryRecallAccess(fixture.dataRoot, {
        answersEnabled: () => true,
        core: async () => ({ rootRef: fixture.root.dataRootFingerprint,
          call: request => host.callOwnerControl("owner_memory_recall", request) }),
      });
      const modelRuntime = await ModelRuntime.create({ credentials: new InMemoryCredentialStore(),
        modelsStore: new InMemoryModelsStore(), modelsPath: null, allowModelNetwork: false, refreshOnCreate: false });
      const provider = fauxProvider({ provider: "r04-raw-chat-forbidden", models: [{ id: "synthetic", reasoning: false }] });
      provider.setResponses([() => { report.chatModelCalls++; throw new Error("ordinary_chat_model_forbidden"); }]);
      modelRuntime.registerNativeProvider(provider.provider);
      try {
        const factory = async ({ sessionManager, sessionStartEvent }) => {
          const settingsManager = SettingsManager.inMemory({
            compaction: { enabled: false }, retry: { enabled: false }, cacheWarming: "off",
          });
          settingsManager.setProjectTrusted(true);
          const services = await createAgentSessionServices({ cwd: fixture.dataRoot, agentDir: fixture.agentDir,
            settingsManager, modelRuntime, resourceLoaderOptions: {
              cwd: fixture.dataRoot, agentDir: fixture.agentDir, settingsManager, noExtensions: true, noSkills: true,
              noPromptTemplates: true, noThemes: true, noContextFiles: true, extensionFactories: [adapter.extension],
            } });
          const result = await createAgentSessionFromServices({ services, sessionManager, sessionStartEvent,
            model: provider.getModel(), noTools: "builtin", customTools: [adapter.tool] });
          return { ...result, services, diagnostics: services.diagnostics };
        };
        sdkRuntime = await createAgentSessionRuntime(factory, {
          cwd: fixture.dataRoot, agentDir: fixture.agentDir, sessionManager: fixture.sessionManager,
        });
        wrapper = new imported["rpc-manager"].AgentSessionWrapper(sdkRuntime.session, sdkRuntime, { disabled: false }, adapter);
        wrapper.start(); wrapper.beginExtensionBinding(); await wrapper.waitUntilReady();
        const roots = { resolveEduPiBridgeRoots: () => ({ dataRoot: { root: fixture.dataRoot } }) };
        const runtime = { ensureEduPiRuntime: async () => host };
        const lookup = { resolveSessionPath: async id => id === wrapper.sessionId ? wrapper.sessionFile : null };
        const modules = Object.fromEntries(Object.entries(imported).map(([name, value]) => [`@/lib/${name}`, value]));
        Object.assign(modules, {
          "node:crypto": crypto, "node:util": { isDeepStrictEqual },
          "next/server": { NextResponse: { json: (value, options = {}) => Response.json(value, options) } },
          "@/lib/desktop-api-auth": { isDesktopApiRequestAllowed: () => true },
          "@/lib/edupi-core-snapshot": roots, "@/lib/edupi-runtime-supervisor": runtime,
          "@/lib/rpc-manager": { getRpcSession: id => id === wrapper.sessionId ? wrapper : null },
          "@/lib/session-reader": lookup,
          "@/lib/harness/runtime": { startHarnessSession: () => assert.fail("unexpected harness fallback") },
        });
        const route = evaluate("app/api/edupi/proactivity/prompt/route.ts", modules);
        const text = ` \t\n${R04_QUERY}\r\n\u3000`;
        const clientRequestId = crypto.randomUUID(), occurredAt = new Date().toISOString();
        const command = { type: "prompt", message: text, clientRequestId };
        const outboxOptions = { stateDir: fixture.stateDir, dataRoot: fixture.dataRoot };
        imported["edupi-prompt-intent"].prepareEduPiPromptIntent({
          sessionId: wrapper.sessionId, clientRequestId, occurredAt, message: text,
          draftValue: text, cwd: fixture.dataRoot,
        }, outboxOptions);
        let unsubscribe, deadline;
        const done = new Promise((resolve, reject) => {
          deadline = setTimeout(() => reject(new Error("sdk_prompt_deadline")), 30_000);
          unsubscribe = wrapper.onEvent(event => {
            if (event.clientRequestId === clientRequestId && event.type === "prompt_done") resolve();
          });
        });
        // Install a rejection handler before awaiting the route's user-entry receipt.
        void done.catch(() => {});
        try {
          const response = await route.POST(new Request("http://localhost/api/edupi/proactivity/prompt", {
            method: "POST", headers: { "content-type": "application/json" },
            body: JSON.stringify({ sessionId: wrapper.sessionId, messageId: `raw-${crypto.randomUUID()}`, occurredAt, command }),
          }));
          report.route = { status: response.status, body: await response.json() };
          write(reportFile, report);
          assert.equal(report.route.status, 200);
          assert.equal(report.route.body.status, "accepted");
          await done;
        } finally { clearTimeout(deadline); unsubscribe(); }
        const saved = SessionManager.open(wrapper.sessionFile);
        const dto = imported["edupi-recall-answer"];
        const answerRows = saved.getBranch().filter(row => row.type === "custom_message" && row.customType === dto.CORE_RECALL_ANSWER_MESSAGE);
        assert.equal(answerRows.length, 1);
        const details = answerRows[0].details;
        report.details = details; write(reportFile, report);
        assert.ok(details.answer, details.reasonCode ?? "formal_answer_missing");
        assert.equal(details.originalTextHash, hash(text));
        assert.notEqual(details.originalTextHash, hash(text.trim()));
        assert.equal(saved.getEntry(details.userEntryId).message.content[0].text, text);
        assert.equal(answerRows[0].content, R04_SOURCE_TEXTS.join("\n"));
        const issued = imported["edupi-recall-state"].readIssuedEduPiRecall(details.receiptId);
        assert.equal(issued.request.query, text);
        assert.equal(issued.request.original_text_hash, hash(text));
        assert.ok(["limit", "memory_ids", "category", "student", "student_id", "answer_receipt_ref"]
          .every(key => !Object.hasOwn(issued.request, key)), "the formal request cannot add defaults");
        const captureCalls = report.calls.filter(call => call.operation === "owner_message_register"
          || call.operation === "owner_message" && call.payload.action === "capture");
        assert.equal(captureCalls.length, 2);
        assert.ok(captureCalls.every(call => call.payload.text === text));
        const server = evaluate("lib/edupi-recall-server.ts", {
          "node:crypto": crypto, "node:fs": fs, "node:path": path, "node:util": { isDeepStrictEqual },
          "./rpc-manager": { getRpcSession: () => null }, "./session-reader": lookup,
          "./session-manager-access": { openSessionManagerForRead: (_id, file) => SessionManager.open(file) },
          "./edupi-core-snapshot": roots, "./edupi-runtime-supervisor": runtime,
          ...Object.fromEntries(["edupi-prompt-outbox", "edupi-proactivity-control", "safe-mode",
            "edupi-recall-answer", "edupi-recall-state"].map(name => [`./${name}`, imported[name]])),
        });
        const service = server.createEduPiRecallService({ enabled: () => true });
        const input = { sessionId: wrapper.sessionId, userEntryId: details.userEntryId, receiptId: details.receiptId };
        const beforeRecheck = fs.readFileSync(wrapper.sessionFile, "utf8");
        const originalRequest = structuredClone(issued.request);
        report.rechecks = [];
        for (let index = 0; index < 2; index++) {
          const result = await service.answerState(input);
          report.rechecks.push(result); write(reportFile, report);
          assert.equal(result.status, "current");
        }
        const recalls = report.calls.filter(call => call.operation === "owner_memory_recall");
        assert.equal(recalls.length, 3);
        assert.equal(recalls[0].response.result.model_execute, true);
        for (const call of recalls.slice(1)) {
          assert.deepEqual(call.payload, { ...originalRequest, answer_receipt_ref: details.answer.receipt_ref });
          assert.equal(call.response.result.model_execute, false);
          assert.deepEqual(call.response.result.answer, details.answer);
        }
        assert.equal(fs.readFileSync(wrapper.sessionFile, "utf8"), beforeRecheck);
        const wrongHash = await host.callOwnerControl("owner_memory_recall", {
          ...originalRequest, original_text_hash: hash(text.trim()), answer_receipt_ref: details.answer.receipt_ref,
        });
        const wrongQuery = await host.callOwnerControl("owner_memory_recall", {
          ...originalRequest, query: text.trim(),
        });
        const wrongTicketQuery = await host.callOwnerControl("owner_memory_recall", {
          ...originalRequest, query: text.trim(), answer_receipt_ref: details.answer.receipt_ref,
        });
        assert.equal(wrongHash.result.status, "held");
        assert.equal(wrongHash.result.reason_code, "capture_unverified");
        assert.equal(wrongQuery.result.status, "held");
        assert.equal(wrongQuery.result.reason_code, "query_changed");
        assert.equal(wrongTicketQuery.result.status, "held");
        assert.equal(wrongTicketQuery.result.reason_code, "answer_receipt_unverified");
        assert.equal(wrongHash.result.model_execute, false);
        assert.equal(wrongQuery.result.model_execute, false);
        assert.equal(wrongTicketQuery.result.model_execute, false);
        const outbox = imported["edupi-prompt-outbox"].readEduPiPromptOutbox(wrapper.sessionId, clientRequestId, outboxOptions);
        const binding = outbox.bindings[0];
        const settled = await imported["edupi-registered-prompt"].settleRegisteredPrompt(host, {
          rootRef: fixture.root.dataRootFingerprint, grantId: binding.grantId, sessionId: wrapper.sessionId,
          messageId: binding.captureMessageId, text, occurredAt, domain: binding.domain, carrierId: binding.carrierId,
          planId: binding.planId, previousBinding: { ownerId: binding.ownerId, grantId: binding.grantId, grantVersion: binding.grantVersion },
          previousRegistration: originalRequest.registration,
        }, { onRegistered: () => assert.fail("withdrawal cannot register another question") });
        assert.equal(settled.status, "withdrawn");
        report.afterWithdrawal = await service.answerState(input);
        assert.equal(report.afterWithdrawal.status, "held");
        assert.equal(fixture.counters.facetRequests, 1, "only the initial facet assessment may execute a model");
        assert.equal(fixture.counters.ordinaryPiRequests, 0);
        assert.equal(fixture.counters.rejectedFacetRequests, 0);
        assert.equal(report.chatModelCalls, 0);
        report.modelCounters = structuredClone(fixture.counters);
        await fixture.stopCore();
        await fixture.withV4Runtime(async ({ conversationStore }) => {
          const record = conversationStore.readExact(binding.messageRef);
          assert.equal(record.original_text_hash, hash(text));
          assert.equal(record.status, "withdrawn");
          report.persistedCapture = record;
        });
      } finally { await wrapper?.shutdown(); await sdkRuntime?.dispose(); }
    });
    report.status = "passed";
  } catch (error) {
    report.status = "failed"; report.failure = error.message; throw error;
  } finally {
    if (fixture) {
      await fixture.stop();
      report.cleanup = { dataRootRemoved: !fs.existsSync(fixture.dataRoot),
        privateRootRemoved: !fs.existsSync(fixture.container) };
      for (const [name, url] of Object.entries({ provider: fixture.provider.statsUrl,
        core: report.coreEndpoint })) {
        if (!url) continue;
        let stopped = false;
        try { await fetch(url, { signal: AbortSignal.timeout(1000) }); } catch { stopped = true; }
        report.cleanup[`${name}Stopped`] = stopped;
        assert.equal(stopped, true);
      }
    }
    report.finishedAt = new Date().toISOString(); write(reportFile, report);
  }
});
