#!/usr/bin/env node
/**
 * Synthetic Main4 only. Import createDesktopR04Fixture({ coreRoot }) or run:
 * node scripts/r04-desktop-acceptance-fixture.mjs --core-root /absolute/core --serve
 * --serve keeps only the loopback provider alive; Next owns its own Core runtime.
 * Stop Next before writing "cleanup" to the reported stopMarker. An empty marker
 * stops the provider and retains the synthetic roots for the caller.
 */
import assert from "node:assert/strict";
import crypto from "node:crypto";
import fs from "node:fs";
import http from "node:http";
import os from "node:os";
import path from "node:path";
import { execFileSync } from "node:child_process";
import { fileURLToPath, pathToFileURL } from "node:url";
import { parseArgs } from "node:util";
import { DatabaseSync } from "node:sqlite";
import { createJiti } from "jiti";
import { SessionManager } from "@earendil-works/pi-coding-agent";

export const R04_SOURCE_TEXTS = Object.freeze(["合成班会由张老师主持。", "合成班会安排在第二场展示。"]);
export const R04_QUERY = "甲班合成班会由谁主持，排在第几场展示？";
const desktopRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const sha = value => crypto.createHash("sha256").update(value).digest("hex");
const digest = value => `sha256:${sha(typeof value === "string" ? value : JSON.stringify(value))}`;
const json = file => JSON.parse(fs.readFileSync(file, "utf8"));
export const R04_CORE_COMMIT = json(path.join(desktopRoot, "contracts/edupi-core-compat.json")).core_runtime.core_commit;
const writeJson = (file, value) => fs.writeFileSync(file, `${JSON.stringify(value, null, 2)}\n`, { mode: 0o600 });
const git = (root, ...args) => execFileSync("git", ["-C", root, ...args], { encoding: "utf8" }).trim();
const privateDir = directory => fs.mkdirSync(directory, { recursive: true, mode: 0o700 });
let fixtureCreated = false;

function fixtureDecisions(prompt) {
  const marker = "UNTRUSTED_INPUT_JSON:\n";
  assert.ok(prompt.startsWith("Select exactly one current case"));
  assert.equal(prompt.split(marker).length, 2);
  const input = JSON.parse(prompt.split(marker)[1]);
  assert.equal(input.query.trim(), R04_QUERY);
  assert.equal(input.facets.length, 2);
  assert.equal(input.cases.length, 1);
  const selected = input.cases[0];
  assert.equal(selected.sources.length, 2);
  const host = selected.sources.find(source => source.content === R04_SOURCE_TEXTS[0]);
  const ordinal = selected.sources.find(source => source.content === R04_SOURCE_TEXTS[1]);
  assert.ok(host && ordinal);
  // Core supplies shuffled opaque aliases. This is a bounded synthetic response,
  // not a semantic assessor and never an answer-generation fallback for Pi.
  return { case_id: selected.case_id, anchor: "合成班会", decisions: [
    { facet_id: "facet_0", source_id: host.source_id, verdict: "supported",
      answer: ["张老师"], evidence: [host.content], answer_kind: "person" },
    { facet_id: "facet_0", source_id: ordinal.source_id, verdict: "abstain" },
    { facet_id: "facet_1", source_id: host.source_id, verdict: "abstain" },
    { facet_id: "facet_1", source_id: ordinal.source_id, verdict: "supported",
      answer: ["第二场"], evidence: [ordinal.content], answer_kind: "ordinal" },
  ] };
}

export async function startDesktopR04FixtureProvider(counters, port = 0) {
  const server = http.createServer(async (request, response) => {
    if (request.method === "GET" && request.url === "/r04-stats") {
      response.writeHead(200, { "content-type": "application/json" });
      response.end(JSON.stringify(counters));
      return;
    }
    if (request.method === "POST" && request.url?.startsWith("/v1/") && request.url !== "/v1/chat/completions") {
      counters.ordinaryPiRequests++;
      response.writeHead(409, { "content-type": "application/json" });
      response.end(JSON.stringify({ error: { message: "ordinary_pi_chat_forbidden_in_r04_fixture" } }));
      return;
    }
    if (request.method !== "POST" || request.url !== "/v1/chat/completions") {
      response.writeHead(404); response.end(); return;
    }
    let input;
    try {
      const chunks = [];
      let bytes = 0;
      for await (const chunk of request) {
        bytes += chunk.length;
        if (bytes > 1_000_000) throw new Error("synthetic_request_too_large");
        chunks.push(chunk);
      }
      input = JSON.parse(Buffer.concat(chunks).toString("utf8"));
      const users = input.messages?.filter(message => message.role === "user");
      const prompt = users?.length === 1 ? users[0].content : null;
      const text = typeof prompt === "string" ? prompt
        : Array.isArray(prompt) && prompt.length === 1 && prompt[0].type === "text" ? prompt[0].text : null;
      if (typeof text !== "string" || !text.startsWith("Select exactly one current case")
        || !text.includes("UNTRUSTED_INPUT_JSON:\n")) {
        counters.ordinaryPiRequests++;
        (counters.ordinaryDiagnostics ??= []).push({
          at: new Date().toISOString(), model: input.model,
          roles: input.messages?.map(message => message.role),
          maxTokens: input.max_tokens ?? input.max_completion_tokens,
          textHash: typeof text === "string" ? digest(text) : null,
          userCount: users?.length, streaming: input.stream === true,
        });
        response.writeHead(409, { "content-type": "application/json" });
        response.end(JSON.stringify({ error: { message: "ordinary_pi_chat_forbidden_in_r04_fixture", type: "invalid_request_error" } }));
        return;
      }
      counters.facetRequests++;
      const answer = fixtureDecisions(text);
      counters.aliases.push({ case_id: answer.case_id, source_ids: [...new Set(answer.decisions.map(item => item.source_id))] });
      const chunk = (delta, finishReason) => `data: ${JSON.stringify({ id: "r04-synthetic-facet",
        object: "chat.completion.chunk", created: 1, model: "r04-synthetic", choices: [{ index: 0, delta,
          finish_reason: finishReason }], ...(finishReason ? { usage: {
          prompt_tokens: 10, completion_tokens: 20, total_tokens: 30 } } : {}) })}\n\n`;
      response.writeHead(200, { "content-type": "text/event-stream", "cache-control": "no-cache" });
      response.end(chunk({ role: "assistant", content: JSON.stringify(answer) }, null)
        + chunk({}, "stop") + "data: [DONE]\n\n");
    } catch {
      counters.rejectedFacetRequests++;
      response.writeHead(422, { "content-type": "application/json" });
      response.end(JSON.stringify({ error: { message: "unsupported_synthetic_facet_input" } }));
    }
  });
  await new Promise((resolve, reject) => { server.once("error", reject); server.listen(port, "127.0.0.1", resolve); });
  const baseUrl = `http://127.0.0.1:${server.address().port}`;
  return { baseUrl: `${baseUrl}/v1`, statsUrl: `${baseUrl}/r04-stats`, server,
    async stop() { server.closeIdleConnections(); await new Promise(resolve => server.close(resolve)); } };
}

/**
 * No real root/key/config discovery. All writes except the two QA scripts are
 * beneath freshly allocated private tmp roots, or an explicit evidenceDir.
 * The default Core pin can be replaced explicitly with expectedCoreCommit when
 * main supplies a later clean candidate. This never updates a production pin.
 */
export async function createDesktopR04Fixture({
  coreRoot, expectedCoreCommit = R04_CORE_COMMIT, evidenceDir,
} = {}) {
  assert.ok(coreRoot && path.isAbsolute(coreRoot), "absolute_core_root_required");
  coreRoot = fs.realpathSync(coreRoot);
  assert.equal(git(coreRoot, "rev-parse", "HEAD"), expectedCoreCommit);
  assert.equal(git(coreRoot, "status", "--porcelain", "--untracked-files=no"), "", "Core source must be clean");
  // The reused Core test modules capture some EDUPI paths at module import.
  // Use one fixture per process; counterexamples launch separate Node workers.
  assert.ok(!fixtureCreated, "createDesktopR04Fixture requires a fresh Node process for each root");
  fixtureCreated = true;
  const container = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), "edupi-r04-desktop-private-")));
  fs.chmodSync(container, 0o700);
  const agentDir = path.join(container, "agent"), stateDir = path.join(container, "state");
  for (const directory of [agentDir, stateDir]) privateDir(directory);
  evidenceDir = evidenceDir ? fs.realpathSync(evidenceDir)
    : fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), "edupi-r04-evidence-")));
  const evidenceFile = path.join(evidenceDir, `fixture-${path.basename(container)}.json`);
  const stopMarker = path.join(container, "STOP");
  const counters = { facetRequests: 0, ordinaryPiRequests: 0, rejectedFacetRequests: 0, aliases: [] };
  const phases = [];
  const ownerControlToken = crypto.createHash("sha256").update("r03-v3-persist-isolated-token").digest("base64url");
  const bearer = crypto.randomBytes(32).toString("base64url");
  let dataRoot, root, environment, provider, modelRunner, daemon, lease, runtime;
  let sources = [], sessionManager, scope, termId, ownerId, grantId;
  let stopped = false;
  const imports = {};
  const fromCore = async name => imports[name] ??= await import(pathToFileURL(path.join(coreRoot, "scripts", name)).href);
  // Disable jiti's disk cache: the fixture must not write generated code into
  // the QA tree, dependency tree, or the read-only Core helper checkout.
  const jiti = createJiti(import.meta.url, { tsconfigPaths: true, fsCache: false });
  const fromDesktop = name => jiti.import(path.join(desktopRoot, "lib", name));
  const withEnvironment = async work => {
    const previous = new Map(Object.keys(environment ?? {}).map(key => [key, process.env[key]]));
    Object.assign(process.env, environment ?? {});
    try { return await work(); }
    finally {
      for (const [key, value] of previous) {
        if (value === undefined) delete process.env[key];
        else process.env[key] = value;
      }
    }
  };
  const metadata = () => ({
    version: 1, syntheticOnly: true, status: stopped ? "stopped" : "ready",
    coreRoot, coreCommit: expectedCoreCommit, desktopRoot, desktopCommit: git(desktopRoot, "rev-parse", "HEAD"),
    runtimeSchemaHash: imports["core_runtime_protocol.mjs"]?.CORE_RUNTIME_SCHEMA_HASH,
    componentManifestHash: json(path.join(coreRoot, "contracts/edupi-core-runtime-component-manifest.json")).component_manifest_hash,
    installationPin: null, container, dataRoot, stateDir, agentDir, evidenceDir, evidenceFile, stopMarker,
    ownerId, grantId, scope, termId, conversationId: sources[0]?.conversation_id,
    sessionId: sessionManager?.getSessionId(), sessionFile: sessionManager?.getSessionFile(),
    sources, query: R04_QUERY, personPreconfirmed: false, querySeeded: false,
    environment, provider: provider ? { baseUrl: provider.baseUrl, statsUrl: provider.statsUrl, pid: process.pid } : null,
    server: provider ? { baseUrl: provider.baseUrl, statsUrl: provider.statsUrl, pid: process.pid, stopMarker } : null,
    coreEndpoint: daemon?.endpoint ?? null, counters, phases,
    cleanup: { rootsExist: [container, dataRoot].filter(Boolean).filter(file => fs.existsSync(file)),
      condition: "Stop the caller's Next/Core before writing cleanup to stopMarker or stop({cleanup:true})." },
  });
  const save = () => writeJson(evidenceFile, metadata());
  const phase = name => { phases.push({ name, at: new Date().toISOString() }); };
  const releaseRuntime = async () => {
    try { if (runtime) { runtime.release(); runtime.close(); } }
    finally { runtime = null; if (lease) { await lease.release(); lease = null; } }
  };
  const stopCore = async () => { if (daemon) { await daemon.close(); daemon = null; } };
  const stop = async ({ cleanup = true } = {}) => {
    await withEnvironment(async () => { await stopCore(); await releaseRuntime(); });
    if (modelRunner) await modelRunner.waitForIdle();
    if (provider && !stopped) await provider.stop();
    stopped = true;
    if (cleanup) {
      for (const target of [dataRoot, container].filter(Boolean)) {
        assert.ok([fs.realpathSync(os.tmpdir()), fs.realpathSync("/tmp")].includes(path.dirname(target)));
        assert.ok(/^edupi-(r03-v3-persist-main4-daemon-|r04-desktop-private-)/u.test(path.basename(target)));
        fs.rmSync(target, { recursive: true, force: true });
      }
    }
    phase(cleanup ? "stopped_and_cleaned" : "stopped_roots_retained");
    save();
  };
  try {
    phase("create_core_candidate_root");
    const childEnv = { PATH: process.env.PATH, LANG: process.env.LANG || "en_US.UTF-8", TZ: "Asia/Shanghai",
      TMPDIR: fs.realpathSync(os.tmpdir()) };
    const created = JSON.parse(execFileSync(process.execPath, ["--disable-warning=ExperimentalWarning",
      path.join(coreRoot, "scripts/test_core_owner_history_v3_persist_plan.mjs"),
      "--create-candidate-publish-root", "main4-daemon", "2", "none"],
    { cwd: coreRoot, env: childEnv, encoding: "utf8", timeout: 60000, stdio: ["ignore", "pipe", "pipe"] }));
    dataRoot = fs.realpathSync(created.dataRoot); ownerId = created.ownerId;
    assert.equal(path.dirname(dataRoot), fs.realpathSync(os.tmpdir()));
    assert.match(path.basename(dataRoot), /^edupi-r03-v3-persist-main4-daemon-/u);
    fs.chmodSync(dataRoot, 0o700);
    const home = path.join(dataRoot, ".edupi");
    environment = {
      EDUPI_PROJECT_ROOT: dataRoot, EDUPI_DATA_ROOT: dataRoot, EDUPI_DATA_ALLOWED_ROOT: dataRoot,
      EDUPI_CORE_ROOT: coreRoot, EDUPI_CORE_ALLOWED_ROOT: path.dirname(coreRoot), EDUPI_CORE_VALIDATION_MODE: "external",
      EDUPI_CORE_COMMIT: expectedCoreCommit, EDUPI_HOME: home,
      EDUPI_MEMORY_DIR: path.join(home, "memory"), EDUPI_OUTPUT_DIR: path.join(home, "output"),
      EDUPI_LOCK_DIR: path.join(home, "locks"), PI_DESKTOP_STATE_DIR: stateDir, PI_CODING_AGENT_DIR: agentDir,
      PI_OFFLINE: "1", EDUPI_DESKTOP_ISOLATED_CANARY: "1", EDUPI_SAFE_MODE: "0",
      EDUPI_AMBIENT_PLANNING: "1", EDUPI_CORE_RECALL_ANSWERS: "1", TZ: "Asia/Shanghai",
    };
    const keyDirectory = path.join(stateDir, "edupi-owner-control"); privateDir(keyDirectory);
    const keyFile = path.join(keyDirectory, `${sha(dataRoot).slice(0, 32)}.key`);
    fs.writeFileSync(keyFile, ownerControlToken, { mode: 0o600, flag: "wx" });
    assert.equal(fs.statSync(keyFile).size, 43); assert.equal(fs.statSync(keyFile).mode & 0o777, 0o600);
    const { loadOwnerControlToken } = await fromDesktop("edupi-owner-control-token.ts");
    assert.equal(loadOwnerControlToken(stateDir, dataRoot), ownerControlToken);
    provider = await startDesktopR04FixtureProvider(counters);
    const model = { id: "r04-synthetic", provider: "r04-synthetic", name: "R04 synthetic loopback",
      type: "chat", api: "openai-completions", baseUrl: provider.baseUrl, reasoning: false, input: ["text"],
      cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 }, contextWindow: 32000, maxTokens: 4096 };
    writeJson(path.join(agentDir, "settings.json"), { defaultProvider: model.provider, defaultModel: model.id,
      enabledModels: [`${model.provider}/${model.id}`], packages: [], extensions: [], skills: [], prompts: [], themes: [] });
    writeJson(path.join(agentDir, "models.json"), { providers: { [model.provider]: { baseUrl: provider.baseUrl,
      api: model.api, apiKey: "r04-synthetic-not-a-real-key", models: [model] } } });
    writeJson(path.join(agentDir, "auth.json"), { [model.provider]: { type: "api_key", key: "r04-synthetic-not-a-real-key" } });
    const { createIsolatedG1ModelRunner } = await fromCore("core_runtime_isolated_model.mjs");
    modelRunner = createIsolatedG1ModelRunner({ model, apiKey: "r04-synthetic-not-a-real-key",
      maxTokens: 4096, timeoutMs: 12000, maxCalls: 64, allowLoopback: true, temperature: 0 });
    await withEnvironment(async () => {
      const { prepareCoreRuntimeRoot } = await fromCore("core_runtime_root.mjs");
      const admissions = await fromCore("core_runtime_writer_admission.mjs");
      const stores = await fromCore("core_runtime_store.mjs");
      const history = await fromCore("core_owner_history_v3_store.mjs");
      const { createCoreRuntimeMigrationQuiescenceProof } = await fromCore("core_runtime_migration_quiescence.mjs");
      const { createAmbientAuthorizationStore } = await fromCore("ambient_authorization_store.mjs");
      const { createAmbientPlanningStore } = await fromCore("ambient_planning_store.mjs");
      const { applyPlanningGoalCommand, applyPlanningEventBatch } = await fromCore("ambient_planning_engine.mjs");
      const { calendarWorkCaseId } = await fromCore("calendar_work_case_identity.mjs");
      const facts = await fromCore("education_fact_store.mjs"), review = await fromCore("teacher_review_store.mjs");
      await fromCore("core_runtime_protocol.mjs");
      const outbox = await fromDesktop("edupi-prompt-outbox.ts");
      const ledger = await fromDesktop("edupi-ambient-message-ledger.ts");
      const { registerAndCapturePrompt } = await fromDesktop("edupi-registered-prompt.ts");
      const { proactivityConversationId } = await fromDesktop("edupi-proactivity-control.ts");
      const { inspectEduPiPromptSession } = await fromDesktop("edupi-prompt-reconciliation.ts");
      const { writeEduPiProactivityConfig } = await fromDesktop("edupi-proactivity-config.ts");
      const bridgeSchema = json(path.join(coreRoot, "contracts/edupi-bridge-v1.1-hash.json")).schema_hash;
      root = prepareCoreRuntimeRoot(dataRoot);
      const identity = { root_ref: root.dataRootFingerprint, expected_owner_id: ownerId };
      phase("admission_v2_owner_history_v3");
      lease = await admissions.acquireCoreRuntimeWriterAdmissionV2Migration({ root });
      await stores.publishCoreOwnerHistoryV3SQLiteCandidate({ root, admissionLease: lease, ownerControlToken });
      await history.activateCoreOwnerHistoryV3({ root, admissionLease: lease, ownerControlToken });
      await lease.release(); lease = null;
      lease = await admissions.acquireCoreRuntimeWriterAdmissionV3Runtime({ root, kind: "daemon", ownerControlToken });
      const setupNonce = crypto.randomUUID();
      runtime = await stores.createCoreRuntimeV3Store({ dataRoot, admissionLease: lease, ownerControlToken,
        supervisorSessionId: "r04-desktop-seed", instanceNonce: setupNonce, processStartEvidence: `pid:${process.pid}` });
      runtime.setLifecycle("ready");
      const authorizationStore = createAmbientAuthorizationStore({ root, verifyControl: value => value === ownerControlToken,
        macKey: crypto.createHmac("sha256", Buffer.from(ownerControlToken, "base64url"))
          .update(`edupi.owner.authorization.mac-key.v1\0${root.dataRootFingerprint}`).digest() });
      const conversationStore = await history.createCoreOwnerHistoryV3RuntimeStore({
        root, admissionLease: lease, ownerControlToken, runtimeStore: runtime });
      privateDir(environment.EDUPI_MEMORY_DIR);
      const namespace = "r04-desktop-synthetic";
      const classroom = facts.registerEducationEntity({ memoryDir: environment.EDUPI_MEMORY_DIR, entity: {
        entity_kind: "class", namespace, external_id: "class", canonical_name: "甲班", aliases: [] } }).entity;
      termId = facts.registerEducationEntity({ memoryDir: environment.EDUPI_MEMORY_DIR, entity: {
        entity_kind: "term", namespace, external_id: "term", canonical_name: "合成学期", aliases: [] } }).entity.entity_id;
      scope = { class_id: classroom.entity_id, subject: "数学" };
      const occurredAt = new Date(Date.now() - 60000).toISOString();
      const endsAt = new Date(Date.now() + 7 * 86400000).toISOString();
      grantId = "r04-desktop-answer-grant";
      const conversationId = proactivityConversationId("teaching_preparation");
      authorizationStore.control({ ...identity, command_id: "r04-create-answer-grant", action: "create",
        grant_id: grantId, expected_version: 0, spec: { scope, domains: ["teaching_preparation"],
          actions: ["prepare", "update"], source_ids: [`conversation:${sha(conversationId)}`],
          starts_at: occurredAt, ends_at: new Date(Date.now() + 30 * 86400000).toISOString(),
          budget: { id: "r04-desktop-answer-budget", max_calls: 64 } } }, authorizationStore.authorizeControl(ownerControlToken));
      writeEduPiProactivityConfig({ enabled: true, scope: { classId: scope.class_id, subject: scope.subject }, grantId },
        { stateDir, dataRoot });
      const planningStore = createAmbientPlanningStore({ root });
      sessionManager = SessionManager.create(dataRoot, path.join(agentDir, "sessions",
        `--${dataRoot.split(path.sep).filter(Boolean).join("-")}--`));
      sessionManager.appendModelChange(model.provider, model.id);
      sessionManager.appendSessionInfo("R04 合成班会");
      const outboxOptions = { stateDir, dataRoot };
      const actor = conversationStore.authorizeControl(ownerControlToken);
      // Only a transport adapter: the returned registrations and capture receipts
      // below are produced by the real admitted Core store, never constructed here.
      const seedHost = { async callOwnerControl(operation, payload) {
        if (operation === "owner_message_register") return { ok: true, result: {
          ...conversationStore.register(payload, actor), fencing_generation: runtime.fencingGeneration,
          instance_nonce: setupNonce } };
        if (operation === "owner_message") return { ok: true, result: conversationStore.message(payload, actor) };
        throw new Error(`unsupported_seed_operation:${operation}`);
      } };
      let reviewSequence = 0;
      const snapshot = state => {
        const stateHash = digest(review.canonicalTeacherReviewIdentityState(state));
        return { snapshot_id: `snapshot-${stateHash.slice(-24)}`, state_hash: stateHash };
      };
      const accept = async (observation, memory) => {
        const state = review.loadTeacherReviewState(), row = state.observations.find(item => item.observation_id === observation.observation_id);
        const target = memory ? state.memory_candidates.find(item => item.candidate_id === observation.candidate_id) : row;
        const provenance = row.provenance[0], key = `r04-source-review-${++reviewSequence}`;
        const response = await review.applyTeacherReviewCommand({ buildSnapshotForState: snapshot, commandEnvelope: {
          contract_version: "1.1", producer: "edupi-desktop", message_id: key, request_id: key,
          issued_at: new Date().toISOString(), schema_hash: bridgeSchema, snapshot_id: snapshot(state).snapshot_id,
          idempotency_key: key, provenance: [provenance], teacher_review: { state: "pending_review", reviewer_id: ownerId,
            reviewed_at: null, note: null, revision: target.teacher_review.revision }, external_send: false,
          command: { command_type: memory ? "review_memory_candidate" : "review_observation",
            [memory ? "candidate_id" : "observation_id"]: memory ? observation.candidate_id : observation.observation_id,
            expected_revision: target.teacher_review.revision, decision: "accept", patch: null, source: {
              source_kind: memory ? "memory_candidate" : "teacher_message",
              source_id: memory ? observation.candidate_id : provenance.source_id,
              source_hash: provenance.source_hash, evidence_ids: target.evidence_ids }, note: null } } });
        assert.equal(response.ok, true, JSON.stringify(response));
      };
      phase("register_capture_two_c1_sources_and_sdk_session");
      for (const [index, text] of R04_SOURCE_TEXTS.entries()) {
        const id = index === 0 ? "host" : "ordinal", clientRequestId = `r04-source-${id}`;
        const messageId = `r04-source-message-${id}`, command = { type: "prompt", message: text, clientRequestId };
        const binding = { domain: "teaching_preparation", ownerId, grantId, grantVersion: 1,
          captureMessageId: messageId, carrierId: "edupi.desktop.g1", planId: `r04-source-plan-${id}` };
        const sessionId = sessionManager.getSessionId();
        outbox.prepareEduPiPromptOutbox({ sessionId, clientRequestId, messageId, occurredAt, command, bindings: [binding] }, outboxOptions);
        const proof = await registerAndCapturePrompt(seedHost, { rootRef: identity.root_ref, grantId, sessionId,
          messageId, text, occurredAt, domain: binding.domain, carrierId: binding.carrierId, planId: binding.planId,
          previousBinding: { ownerId, grantId, grantVersion: 1 } }, {
          onBound() { throw new Error("unexpected_rebinding"); },
          onRegistered(value) { outbox.recordEduPiPromptOutboxRegistration(sessionId, clientRequestId, binding.domain, {
            messageRef: value.messageRef, producerEpoch: value.registration.producer_epoch, sequence: value.registration.sequence,
            fencingGeneration: value.fencingGeneration, instanceNonce: value.instanceNonce }, outboxOptions);
            ledger.prepareEduPiAmbientMessageBinding({ sessionId, messageId, messageRef: value.messageRef,
              ownerId, grantId, captureGrantVersion: 1, occurredAt }, outboxOptions); },
          onCaptured(value) { outbox.recordEduPiPromptOutboxCapture(sessionId, clientRequestId, binding.domain, {
            captured: true, messageRef: value.messageRef }, outboxOptions);
            ledger.confirmEduPiAmbientMessageBinding(sessionId, messageId, value.messageRef, outboxOptions); },
        });
        outbox.markEduPiPromptOutboxPiDispatching(sessionId, clientRequestId, outboxOptions);
        const commandHash = digest(command);
        sessionManager.appendCustomEntry("edupi_prompt_dispatch_v1", { sessionId, clientRequestId, commandHash });
        const userEntryId = sessionManager.appendMessage({ role: "user", content: [{ type: "text", text }], timestamp: Date.parse(occurredAt) });
        sessionManager.appendCustomEntry("edupi_prompt_accepted_v1", { sessionId, clientRequestId, commandHash, userEntryId });
        const persisted = outbox.readEduPiPromptOutbox(sessionId, clientRequestId, outboxOptions);
        assert.equal(inspectEduPiPromptSession(persisted, sessionManager.getSessionFile()), "confirmed");
        outbox.markEduPiPromptOutboxPiAccepted(sessionId, clientRequestId, outboxOptions);
        const exact = conversationStore.readRegisteredExact(proof.messageRef);
        assert.equal(exact.record.text, text);
        const observation = review.captureTeacherObservation({ source_message_id: proof.messageRef, source_hash: exact.record.text_hash,
          text: exact.record.text, observed_at: new Date().toISOString(), class_id: scope.class_id, subject: scope.subject,
          student_ids: [], category: "class", tags: [`term_ref:${termId}`] });
        await accept(observation, false); await accept(observation, true);
        const goal = { id: `r04-goal-${id}`, text: "合成事项", scope, starts_at: occurredAt, ends_at: endsAt,
          success_condition: "只读证明", allowed_actions: ["prepare", "update"], budget: { max_calls: 2 }, prepare_hours: 24, escalate_hours: 2 };
        const taskId = "r04-synthetic-class-meeting";
        const guard = { id: `r04-guard-${id}`, source_id: `canonical_guard:${goal.id}:r04-lesson-${id}`, revision: 1,
          occurred_at: occurredAt, received_at: occurredAt, kind: "canonical_guard", scope, payload: {
            lesson_id: `r04-lesson-${id}`, goal_id: goal.id, status: "valid", reason: null, task_id: taskId,
            work_case_id: calendarWorkCaseId(taskId, "teaching_before_class"), evidence_ids: [proof.messageRef],
            confidence: "structured", privacy_scope: "teacher_internal", source_revision: `r04-source-${id}` } };
        planningStore.transact(state => applyPlanningEventBatch(applyPlanningGoalCommand(state, {
          action: "create", goal_id: goal.id, expected_version: 0, at: occurredAt, goal }), [guard]));
        sources.push({ ...identity, message_ref: proof.messageRef, conversation_id: conversationId, message_id: messageId,
          original_text_hash: exact.record.original_text_hash, registration: exact.registration, text,
          clientRequestId, userEntryId, goal, guard, observation, goalVersion: 1 });
      }
      assert.equal(sources.length, 2);
      runtime.release(); runtime.close(); runtime = null;
      const authority = () => {
        const db = new DatabaseSync(root.databasePath, { readOnly: true });
        try {
          const value = { ...db.prepare("SELECT * FROM authority WHERE singleton=1").get() };
          return { root_ref: root.dataRootFingerprint, fencing_generation: value.fencing_generation, authority: value };
        } finally { db.close(); }
      };
      const prior = authority();
      const proof = createCoreRuntimeMigrationQuiescenceProof({ rootRef: identity.root_ref,
        generation: prior.fencing_generation, authority: prior.authority, admissionLease: lease, checkCurrent: authority });
      admissions.prepareCoreRuntimeWriterAdmissionV3Transition(lease, proof).commit();
      lease = await admissions.acquireCoreRuntimeWriterAdmissionV3Migration({ root });
      phase("migrate_real_main4");
      assert.equal((await stores.migrateCoreRuntimePlanningV4({ root, admissionLease: lease, ownerControlToken })).status, "active");
      await lease.release(); lease = null;
    });
    const call = (operation, payload, { ownerControl = true } = {}) => withEnvironment(async () => {
      assert.ok(daemon, "startCore() is required for HTTP operations");
      const protocol = await fromCore("core_runtime_protocol.mjs");
      const frame = { protocol: protocol.CORE_RUNTIME_PROTOCOL, protocol_version: protocol.CORE_RUNTIME_PROTOCOL_VERSION,
        schema_hash: protocol.CORE_RUNTIME_SCHEMA_HASH, request_id: crypto.randomUUID(), operation, payload };
      assert.equal(protocol.validateRuntimeRequest(frame).ok, true, "invalid Runtime request");
      const response = await fetch(daemon.endpoint, { method: "POST", headers: { "content-type": "application/json",
        authorization: `Bearer ${bearer}`, ...(ownerControl ? { "x-edupi-owner-control": ownerControlToken } : {}) },
      body: JSON.stringify(frame), signal: AbortSignal.timeout(30000) });
      assert.equal(response.status, 200);
      const result = await response.json();
      assert.equal(protocol.validateRuntimeResponse(result).ok, true);
      return result;
    });
    const startCore = () => withEnvironment(async () => {
      assert.ok(!daemon && !runtime && !lease, "one runtime per synthetic root");
      const { createCoreRuntimeDaemon } = await fromCore("core_runtime_daemon.mjs");
      const { createRecallFacetAnswerAssessor } = await fromCore("recall_facet_answer_assessor.mjs");
      daemon = await createCoreRuntimeDaemon({ dataRoot, token: bearer, ownerControlToken,
        ambientPlanning: true, ownerMessageRegistration: true,
        recallAnswers: createRecallFacetAnswerAssessor({ runModel: modelRunner }), supervisorSessionId: "r04-desktop-http",
        coreCommit: expectedCoreCommit, componentManifestHash: metadata().componentManifestHash, port: 0 });
      phase("http_core_started"); save();
      return { endpoint: daemon.endpoint, call, stop: stopCore };
    });
    const withV4Runtime = work => withEnvironment(async () => {
      assert.ok(!daemon && !runtime && !lease, "stopCore() before opening a direct admitted runtime");
      const admissions = await fromCore("core_runtime_writer_admission.mjs");
      const stores = await fromCore("core_runtime_store.mjs");
      const history = await fromCore("core_owner_history_v3_store.mjs");
      lease = await admissions.acquireCoreRuntimeWriterAdmissionV4Runtime({ root, kind: "daemon", ownerControlToken });
      runtime = await stores.createCoreRuntimeV4Store({ dataRoot, admissionLease: lease, ownerControlToken,
        supervisorSessionId: "r04-desktop-read-probe", instanceNonce: crypto.randomUUID(), processStartEvidence: `pid:${process.pid}` });
      runtime.setLifecycle("ready");
      try {
        const conversationStore = await history.createCoreOwnerHistoryV3RuntimeStore({
          root, admissionLease: lease, ownerControlToken, runtimeStore: runtime });
        return await work({ runtime, planningPort: runtime.planningPort, conversationStore, root });
      } finally { await releaseRuntime(); }
    });
    const captureQuery = async (text = R04_QUERY) => {
      const { registerAndCapturePrompt } = await fromDesktop("edupi-registered-prompt.ts");
      const occurredAt = new Date().toISOString(), messageId = `r04-query-${crypto.randomUUID()}`;
      const host = { call: (operation, payload) => call(operation, payload),
        callOwnerControl: (operation, payload) => call(operation, payload) };
      const proof = await registerAndCapturePrompt(host, { rootRef: root.dataRootFingerprint, grantId,
        sessionId: sessionManager.getSessionId(), messageId, text, occurredAt, domain: "teaching_preparation",
        carrierId: "edupi.desktop.g1", planId: `r04-query-plan-${crypto.randomUUID()}`,
        previousBinding: { ownerId, grantId, grantVersion: 1 } }, {
        onBound() { throw new Error("unexpected_query_rebinding"); }, onRegistered() {}, onCaptured() {},
      });
      return { root_ref: root.dataRootFingerprint, expected_owner_id: ownerId, message_ref: proof.messageRef,
        conversation_id: sources[0].conversation_id, message_id: messageId, original_text_hash: digest(text),
        registration: proof.registration, query: text };
    };
    phase("ready_person_unconfirmed_query_not_seeded"); save();
    return { coreRoot, coreCommit: expectedCoreCommit, container, dataRoot, stateDir, agentDir, evidenceDir, evidenceFile,
      root, ownerId, grantId, scope, termId, sources, environment, counters, sessionManager, stopMarker,
      provider: { baseUrl: provider.baseUrl, statsUrl: provider.statsUrl },
      server: { pid: process.pid, baseUrl: provider.baseUrl, statsUrl: provider.statsUrl, stopMarker },
      metadata, save, withEnvironment, withV4Runtime,
      startCore, stopCore, call, captureQuery, stop };
  } catch (error) {
    phase("failed");
    try { await stop(); } catch { /* Preserve the original setup failure. */ }
    error.fixtureEvidence = evidenceFile;
    throw error;
  }
}

async function cli() {
  const { values } = parseArgs({ options: { "core-root": { type: "string" }, "core-commit": { type: "string" },
    "evidence-dir": { type: "string" }, serve: { type: "boolean", default: false } } });
  const fixture = await createDesktopR04Fixture({ coreRoot: values["core-root"], expectedCoreCommit: values["core-commit"] ?? R04_CORE_COMMIT,
    evidenceDir: values["evidence-dir"] });
  if (!values.serve) {
    await fixture.stop();
    console.log(JSON.stringify({ status: "created_and_cleaned", evidenceFile: fixture.evidenceFile, counters: fixture.counters }));
    return;
  }
  console.log(JSON.stringify(fixture.metadata()));
  let stopping = false;
  const interval = setInterval(() => {
    if (!fs.existsSync(fixture.stopMarker) || stopping) return;
    const cleanup = fs.readFileSync(fixture.stopMarker, "utf8").trim() === "cleanup";
    void shutdown(cleanup);
  }, 250);
  const shutdown = async cleanup => {
    if (stopping) return;
    stopping = true; clearInterval(interval);
    await fixture.stop({ cleanup });
    console.log(JSON.stringify({ status: "stopped", evidenceFile: fixture.evidenceFile, cleanup }));
  };
  process.once("SIGINT", () => { void shutdown(false); });
  process.once("SIGTERM", () => { void shutdown(false); });
}

if (process.argv[1] && pathToFileURL(path.resolve(process.argv[1])).href === import.meta.url) {
  cli().catch(error => { console.error(JSON.stringify({ status: "failed",
    code: typeof error.code === "string" && /^[A-Za-z0-9_:-]{1,100}$/u.test(error.code) ? error.code : error.name,
    evidenceFile: error.fixtureEvidence })); process.exitCode = 1; });
}
