import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import http from "node:http";
import { EventEmitter } from "node:events";
import { createRequire } from "node:module";
import ts from "typescript";
import test from "node:test";
import { pathToFileURL } from "node:url";

test("supervisor shares startup, binds private requests, rejects mismatches and clears failed children", async (t) => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "edupi-supervisor-test-"));
  const hash = `sha256:${"a".repeat(64)}`;
  const manifest = { entrypoint: "scripts/core_runtime_daemon.mjs", component_manifest_version: "1", component_manifest_hash: hash, modules: [], assets: [], runtime_dependencies: [] };
  fs.mkdirSync(path.join(root, "contracts"));
  fs.writeFileSync(path.join(root, "contracts/edupi-core-runtime-component-manifest.json"), JSON.stringify(manifest));
  let requests = 0, wrongBinding = false, privateToken, ownerControlHeader, wrongReady = false, startupErrorCode = null, forks = 0, stopped = 0, ownerCredentialUnavailable = false;
  const startupOptions = [];
  const invalidatedRoots = [];
  const deadlines = [];
  const deadlineCallbacks = [];
  let holdResponse = false, responseReceived, ownerHistoryCapacity = 128, ownerHistoryStorage, capacityUnavailable = false;
  let virtualNow = null, virtualTimers = null, fetchOverride = null, shutdownCoordinator = null, readerActive = false, forcedReaderKills = 0;
  let modelCloseCompletion = null, modelCloseFinished = false;
  let deliverCloseEvent = true;
  class TestDate extends Date { static now() { return virtualNow ?? Date.now(); } }
  const spawnEnvironments = [];
  const originalAmbientPlanning = process.env.EDUPI_AMBIENT_PLANNING;
  const originalWindowsCanary = process.env.EDUPI_WINDOWS_G1_CANARY;
  const originalDesktopStateDir = process.env.PI_DESKTOP_STATE_DIR;
  const originalRecallAnswers = process.env.EDUPI_CORE_RECALL_ANSWERS;
  delete process.env.EDUPI_CORE_RECALL_ANSWERS;
  process.env.PI_DESKTOP_STATE_DIR = path.join(root, "desktop-state");
  fs.mkdirSync(process.env.PI_DESKTOP_STATE_DIR, { mode: 0o700 });
  delete process.env.EDUPI_AMBIENT_PLANNING;
  process.env.EDUPI_WINDOWS_G1_CANARY = "1";
  const children = [];
  const server = http.createServer(async (request, response) => {
    let bytes = ""; for await (const chunk of request) bytes += chunk;
    requests++;
    assert.equal(request.headers.authorization, `Bearer ${privateToken}`);
    if (request.headers["x-edupi-owner-control"]) ownerControlHeader = request.headers["x-edupi-owner-control"];
    const value = JSON.parse(bytes);
    if (holdResponse) {
      const disconnected = new Promise(resolve => response.once("close", resolve));
      responseReceived({ value, disconnected });
      return;
    }
    const activeOptions = startupOptions.at(-1);
    response.end(JSON.stringify({ ...value, request_id: wrongBinding ? "wrong" : value.request_id, ok: true,
      ...(value.operation === "health" ? { result: {
        owner_message_capacity: activeOptions?.ambientPlanning && activeOptions.ownerControlToken
          ? { record_limit: ownerHistoryCapacity, storage: ownerHistoryStorage, ...(capacityUnavailable ? { status: "unavailable" } : {}) } : null,
        capabilities: { ambient_planning: activeOptions?.ambientPlanning ? "active" : "activation_pending",
          owner_conversation: activeOptions?.ambientPlanning && activeOptions.ownerControlToken ? "active" : "activation_pending",
          g3_processor: activeOptions?.g3Bindings ? "active" : "activation_pending" },
      } } : {}) }));
  });
  await new Promise(resolve => server.listen(0, "127.0.0.1", resolve));
  const protocol = { CORE_RUNTIME_PROTOCOL: "edupi-core-runtime", CORE_RUNTIME_PROTOCOL_VERSION: 1, CORE_RUNTIME_CONTRACT_VERSION: "1.0", CORE_RUNTIME_SCHEMA_HASH: hash, CORE_RUNTIME_ENDPOINT: "/runtime/v1", CORE_RUNTIME_OUTER_REQUEST_MAX_BYTES: 10000, CORE_RUNTIME_OUTER_RESPONSE_MAX_BYTES: 10000, validateRuntimeRequest: value => ({ ok: value.operation === "health" && value.payload === null }), validateRuntimeResponse: value => ({ ok: value.ok === true && value.schema_hash === hash }) };
  protocol.classifyCoreRuntimeBridgeRequest = request => request.operation === "command" ? "call"
    : request.operation === "agent-computer" ? request.action === undefined ? "read" : "call"
    : request.operation === "connector-setup" ? request.action === "manifest" ? "read" : "call"
    : request.operation === "g1-excerpt" ? request.action === "source_preview" ? "read" : request.action === "review_source" ? "call" : null
    : request.operation === "generated-artifacts" ? request.action === "list" ? "read" : "call" : null;
  const originalValidateRequest = protocol.validateRuntimeRequest;
  protocol.validateRuntimeRequest = value => ({ ok: originalValidateRequest(value).ok
    || ["bridge_read", "bridge_call"].includes(value.operation) && typeof value.payload?.bridge_frame === "string"
    || ["material_schedule_read", "material_schedule_apply"].includes(value.operation) && value.payload?.material_id === "synthetic-material"
    || value.operation === "owner_memory_recall" && value.payload?.message_ref === "synthetic-message"
      && Object.keys(value.payload).every(key => ["message_ref", "query"].includes(key))
      && (value.payload.query === undefined || typeof value.payload.query === "string" && value.payload.query.trim().length > 0)
    || value.operation === "owner_recall_source_proof_read" && value.payload?.memory_id === "synthetic-memory" });
  const validateReadRequest = protocol.validateRuntimeRequest;
  protocol.validateRuntimeRequest = value => ({ ok: validateReadRequest(value).ok
    || ["owner_read", "owner_reflection_history_read", "owner_recall_person_read"].includes(value.operation) && value.payload?.read === true
    || ["owner_control", "owner_message", "owner_recall_person_confirm"].includes(value.operation) && value.payload?.write === true });
  const fork = (_bootstrap, _args, options) => {
    forks++;
    spawnEnvironments.push(options.env);
    const child = new EventEmitter(); child.connected = true; children.push(child);
    let reaped = false;
    child.disconnect = () => { child.connected = false; child.emit("disconnect"); };
    child.kill = signal => {
      if (signal === "SIGKILL" && readerActive) forcedReaderKills++;
      if (!reaped) { reaped = true; child.connected = false; child.emit("exit", 0); if (deliverCloseEvent) child.emit("close", 0); } return true;
    };
    child.send = (message, callback) => {
      if (message.type === "runtime-stop") {
        stopped++;
        if (shutdownCoordinator) { shutdownCoordinator.stop(); void shutdownCoordinator.waitForIdle().then(() => child.kill()); }
        else child.kill();
      }
      if (message.type === "runtime-start") {
        privateToken = message.options.token;
        startupOptions.push(message.options);
        queueMicrotask(() => child.emit("message", startupErrorCode
          ? { type: "runtime-error", code: startupErrorCode }
          : { type: "runtime-ready", endpoint: `http://127.0.0.1:${server.address().port}/runtime/v1`, host: "127.0.0.1", port: server.address().port, protocol: protocol.CORE_RUNTIME_PROTOCOL, protocolVersion: 1, contractVersion: "1.0", schemaHash: hash, supervisorSessionId: wrongReady ? "wrong" : message.options.supervisorSessionId, coreCommit: message.options.coreCommit, componentManifestHash: hash, dataRootFingerprint: hash, fencingGeneration: 1, instanceNonce: "nonce", recallAnswersActive: message.options.recallAnswers === true }));
      }
      callback?.();
    };
    return child;
  };
  const nativeRequire = createRequire(import.meta.url);
  let activationReads = 0;
  let activationOverride = null;
  let capabilityGate = false;
  let parentActivation = null;
  let reflectionActivation = null;
  let platformGate = true;
  let recallCanaryAllowed = false;
  let templateConfig = null, templateGrantCurrent = true, templateOwnerReads = 0, templateBridgeOwner = null;
  const modules = {
    "node:child_process": { fork },
    "./edupi-core-root": { validateContainedRegularFile: ({ candidate }) => fs.realpathSync(candidate) },
    "./edupi-runtime-model-host": { createRuntimeModelHost: () => ({}), attachRuntimeModelHost: () => ({
      close: async () => { await modelCloseCompletion; modelCloseFinished = true; },
    }) },
    "./edupi-owner-control-token": {
      loadRuntimeOwnerControlToken: (_stateDir, _dataRoot, { required }) => {
        if (!ownerCredentialUnavailable) return "test-persistent-owner-token";
        if (!required) return null;
        throw Object.assign(new Error("credential unavailable"), { code: "owner_control_credential_unavailable" });
      },
    },
    "./edupi-recall-state": { invalidateEduPiRecallRoot: root => invalidatedRoots.push(root) },
    "./edupi-recall-config": { readEduPiRecallActivation: () => ({
      mode: recallCanaryAllowed && process.env.EDUPI_CORE_RECALL_ANSWERS === "1" ? "canary" : "off",
      enabled: recallCanaryAllowed && process.env.EDUPI_CORE_RECALL_ANSWERS === "1", config: null,
    }) },
    "./edupi-teacher-template-config": {
      readEduPiTeacherTemplateConfig: () => ({ config: templateConfig }),
      parseEduPiTeacherTemplateBinding: value => value,
    },
    "./edupi-teacher-template-storage": { assertTeacherTemplateStorage: async () => {} },
    "./edupi-teacher-template-runtime": {
      ownerForSelectedTemplate: async (_host, templateId, options) => {
        templateOwnerReads++;
        assert.equal(templateId, templateConfig.binding.templateIds[0]);
        assert.equal(options.rootRef, hash, "use the admitted Core fingerprint, never the Desktop path hash");
        if (!templateGrantCurrent) throw new Error("grant revoked");
        return templateConfig.binding.ownerId;
      },
      ownerForTeacherTemplateBridge: async (_host, request, options) => {
        assert.equal(options.rootRef, hash);
        return request.envelope?.teacher_review?.reviewer_id === templateBridgeOwner ? templateBridgeOwner : null;
      },
    },
    "./edupi-proactivity-config": {
      EDUPI_CAPABILITY_DOMAINS: ["calendar_administration", "lesson_reflection", "parent_communication"],
      readEduPiProactivityActivation: ({ domain } = {}) => {
        activationReads++;
        if (parentActivation && domain === "parent_communication") return parentActivation;
        if (reflectionActivation && domain === "lesson_reflection") return reflectionActivation;
        if ((parentActivation || reflectionActivation) && domain) return { enabled: false, source: "default", updatedAt: null };
        if (activationOverride) return activationOverride;
        const enabled = process.env.EDUPI_AMBIENT_PLANNING === "1";
        return { enabled, source: enabled ? "environment" : "default", updatedAt: null };
      },
    },
    "./safe-mode": { canStartEduPiProactivity: () => platformGate,
      canStartEduPiStudentFollowup: () => false,
      canStartEduPiCapabilityDrafts: () => capabilityGate,
      coreRuntimeCanaryEnvironment: (_platform, environment) => platformGate
        && environment.EDUPI_WINDOWS_G1_CANARY === "1" ? { EDUPI_WINDOWS_G1_CANARY: "1" } : {} },
  };
  const source = fs.readFileSync(new URL("./edupi-runtime-supervisor.ts", import.meta.url), "utf8");
  const compiled = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, esModuleInterop: true } }).outputText;
  const supervisorModule = { exports: {} };
  new Function("require", "module", "exports", "setTimeout", "clearTimeout", "Date", "fetch", compiled)(name => {
    if (name.endsWith("/edupi_component_manifest.mjs")) return { generateComponentManifest: () => manifest };
    if (name.endsWith("/core_runtime_protocol.mjs")) return protocol;
    if (name.endsWith("/core_runtime_root.mjs")) return { verifyCoreRuntimeRoot: () => ({ ok: true, dataRootFingerprint: hash }) };
    return modules[name] || nativeRequire(name);
  }, supervisorModule, supervisorModule.exports, (callback, ms) => {
    deadlines.push(ms); deadlineCallbacks.push(callback);
    if (virtualTimers) { const timer = { fn: callback, ms, at: virtualNow + ms, active: true }; virtualTimers.push(timer); return timer; }
    return setTimeout(callback, ms);
  }, timer => { if (typeof timer?.fn === "function") timer.active = false; else clearTimeout(timer); }, TestDate,
  (...args) => fetchOverride ? fetchOverride(...args) : fetch(...args));
  const api = supervisorModule.exports;
  const scopedActivation = { enabled: true, source: "desktop_canary", configurationStatus: "ready",
    scope: { classId: "class-7-1", subject: "数学" }, grantId: "desktop_canary_math", updatedAt: "2026-09-27T00:00:00.000Z" };
  assert.equal(api.describeEduPiRuntimeStartupFailure({ code: "runtime_state_invalid" }), "Core Runtime 状态需要修复（runtime_state_invalid）");
  assert.match(api.describeEduPiRuntimeStartupFailure({ code: "owner_control_credential_unavailable" }), /授权凭据不可用/);
  assert.equal(api.describeEduPiRuntimeStartupFailure({ code: "private_path_detail" }), null);
  const runtime = { root, coreCommit: "a".repeat(40), componentManifestHash: hash };
  const dataRoot = { root, memoryDir: path.join(root, ".edupi/memory"), outputDir: path.join(root, ".edupi/output"), lockDir: path.join(root, ".edupi/locks") };
  try {
    assert.deepEqual(api.g1ScopeForActivation(scopedActivation), { ...scopedActivation.scope, grantId: scopedActivation.grantId });
    assert.equal(api.g1ScopeForActivation({ ...scopedActivation, source: "environment" }), null);
    assert.equal(api.g1ScopeForActivation({ ...scopedActivation, grantId: null }), null);
    assert.equal(api.g1ScopeForActivation({ ...scopedActivation, configurationStatus: "mismatched" }), null);
    assert.equal(api.g1ScopeForActivation({ ...scopedActivation, enabled: false }), null);
    const parentBinding = { domain: "parent_communication", grantId: "parent-grant", ownerId: "owner-1",
      scope: { class_id: "class-7-1", subject: "math" } };
    assert.equal(api.sourceParentQuestionGoalsForBindings([parentBinding]), false);
    capabilityGate = true;
    assert.equal(api.sourceParentQuestionGoalsForBindings([parentBinding]), true);
    assert.equal(api.sourceParentQuestionGoalsForBindings([{ ...parentBinding, ownerId: undefined }]), false);
    assert.equal(api.sourceParentQuestionGoalsForBindings([parentBinding, parentBinding]), false);
    const reflectionBinding = { ...parentBinding, domain: "lesson_reflection", grantId: "reflection-grant" };
    assert.equal(api.sourceReflectionGoalsForBindings([reflectionBinding]), true);
    assert.equal(api.sourceReflectionGoalsForBindings([parentBinding]), false);
    assert.equal(api.sourceReflectionGoalsForBindings([{ ...reflectionBinding, ownerId: undefined }]), false);
    assert.equal(api.sourceReflectionGoalsForBindings([reflectionBinding, reflectionBinding]), false);
    capabilityGate = false;
    assert.equal(api.sourceReflectionGoalsForBindings([reflectionBinding]), false);
    const first = api.ensureEduPiRuntime({ runtime, dataRoot });
    assert.equal(api.getPendingEduPiRuntime(root), first);
    assert.equal(api.ensureEduPiRuntime({ runtime, dataRoot }), first);
    const handle = await first;
    assert.equal(forks, 1);
    assert.equal(startupOptions[0].ambientPlanning, undefined);
    assert.equal(startupOptions[0].g1Scope, undefined);
    assert.equal(spawnEnvironments[0].EDUPI_WINDOWS_G1_CANARY, "1",
      "an admitted isolated Core root remains usable before G1 is enabled");
    assert.equal(typeof startupOptions[0].ownerControlToken, "string");
    assert.equal(api.getActiveEduPiRuntime(root), handle);
    assert.equal((await handle.call("health", null)).ok, true);
    await assert.rejects(handle.call("unknown", null), { code: "invalid_request" });
    assert.equal((await handle.callOwnerControl("health", null)).ok, true);
    assert.equal(ownerControlHeader, startupOptions[0].ownerControlToken);
    assert.equal(requests, 2);
    const list = { operation: "generated-artifacts", action: "list" };
    const registered = { operation: "generated-artifacts", action: "register" };
    const listedResponse = await handle.callBridge(list);
    assert.equal(listedResponse.operation, "bridge_read");
    assert.deepEqual(JSON.parse(listedResponse.payload.bridge_frame), list);
    assert.equal((await handle.callBridge(registered)).operation, "bridge_call");
    await assert.rejects(handle.callBridge({ operation: "unknown" }), { code: "invalid_request" });
    assert.equal(requests, 4);
    const intakeRequest = { operation: "command", envelope: { command: { command_type: "intake_material" } } };
    assert.deepEqual(api.eduPiBridgeRequestBudget(intakeRequest), { processingMs: 37000, transportMs: 38000 });
    assert.equal((await handle.callBridge(intakeRequest)).operation, "bridge_call");
    assert.equal(deadlines.at(-1), 38000);
    await handle.callBridge({ operation: "command", envelope: { command: { command_type: "import_calendar" } } });
    assert.equal(deadlines.at(-1), 15000, "the material completion extension cannot widen calendar/timetable/other mutations");
    assert.deepEqual(api.eduPiBridgeRequestBudget({ operation: "snapshot", envelope: intakeRequest.envelope }), { processingMs: 15000, transportMs: 15000 });
    holdResponse = true;
    const beforeCancellation = requests, cancellation = new AbortController();
    let received = new Promise(resolve => { responseReceived = resolve; });
    const pendingIntake = handle.callBridge(intakeRequest, cancellation.signal);
    const cancelledHttp = await received;
    assert.equal(cancelledHttp.value.operation, "bridge_call"); assert.equal(deadlines.at(-1), 38000);
    cancellation.abort();
    await assert.rejects(pendingIntake, { code: "runtime_unavailable" });
    await cancelledHttp.disconnected;
    assert.equal(requests, beforeCancellation + 1, "intake cancellation disconnects its real loopback HTTP request without retry");
    received = new Promise(resolve => { responseReceived = resolve; });
    const timedOutIntake = handle.callBridge(intakeRequest);
    const timedOutHttp = await received;
    assert.equal(deadlines.at(-1), 38000);
    deadlineCallbacks.at(-1)();
    await assert.rejects(timedOutIntake, { code: "runtime_unavailable" });
    await timedOutHttp.disconnected;
    assert.equal(requests, beforeCancellation + 2, "the exact production timer callback aborts HTTP and does not resubmit the accepted-or-unknown mutation");
    holdResponse = false;
    wrongBinding = true;
    await assert.rejects(handle.call("health", null), { code: "runtime_unavailable" });
    assert.equal(JSON.stringify(handle).includes(privateToken), false);
    wrongBinding = false;
    activationOverride = scopedActivation;
    const restartAction = api.restartEduPiRuntime({ runtime, dataRoot });
    assert.equal(api.restartEduPiRuntime({ runtime, dataRoot }), restartAction);
    const restartedFromAction = await restartAction;
    assert.notEqual(restartedFromAction, handle);
    assert.equal(forks, 2);
    assert.equal(startupOptions[1].ambientPlanning, true);
    assert.deepEqual(startupOptions[1].g1Scope, { ...scopedActivation.scope, grantId: scopedActivation.grantId });
    assert.equal(spawnEnvironments[1].EDUPI_WINDOWS_G1_CANARY, "1");
    assert.equal(typeof startupOptions[1].ownerControlToken, "string");
    assert.equal(startupOptions[1].ownerControlToken, startupOptions[0].ownerControlToken);
    assert.notEqual(startupOptions[1].ownerControlToken, startupOptions[1].token);
    assert.equal(stopped, 1);
    assert.equal((await restartedFromAction.call("health", null)).ok, true);
    assert.equal((await restartedFromAction.callOwnerControl("health", null)).ok, true);
    assert.equal(ownerControlHeader, startupOptions[1].ownerControlToken);
    await restartedFromAction.close();
    assert.equal(api.getActiveEduPiRuntime(root), null);
    assert.equal(api.getPendingEduPiRuntime(root), null);
    assert.equal(stopped, 2);
    activationOverride = { ...scopedActivation, enabled: false, configurationStatus: "stop_pending" };
    const stoppedRuntime = await api.ensureEduPiRuntime({ runtime, dataRoot });
    assert.equal(startupOptions.at(-1).g1Scope, undefined);
    assert.equal(startupOptions.at(-1).ambientPlanning, undefined);
    assert.equal(spawnEnvironments.at(-1).EDUPI_WINDOWS_G1_CANARY, "1",
      "stop intent keeps native root admission for owner grant pause and saved-draft reads");
    assert.equal((await stoppedRuntime.callOwnerControl("health", null)).ok, true);
    await stoppedRuntime.close();
    platformGate = false;
    activationOverride = scopedActivation;
    assert.equal(api.g1ScopeForActivation(scopedActivation), null);
    const normalRestart = await api.ensureEduPiRuntime({ runtime, dataRoot });
    assert.equal(startupOptions.at(-1).ambientPlanning, undefined,
      "a persisted Safe Mode grant cannot start G1 after Windows returns to normal mode");
    assert.equal(startupOptions.at(-1).g1Scope, undefined);
    assert.equal(spawnEnvironments.at(-1).EDUPI_WINDOWS_G1_CANARY, undefined);
    await normalRestart.close();
    platformGate = true;
    const forksBeforeQuarantine = forks;
    await api.quarantineEduPiRuntime(root);
    await assert.rejects(api.ensureEduPiRuntime({ runtime, dataRoot }), { code: "runtime_unavailable" });
    assert.equal(forks, forksBeforeQuarantine, "failed stop never restarts G1 on a status refresh");
    api.clearEduPiRuntimeQuarantine(root);
    wrongReady = true;
    await assert.rejects(api.ensureEduPiRuntime({ runtime, dataRoot }), { code: "runtime_unavailable" });
    assert.equal(children.at(-1).connected, false);
    wrongReady = false;
    startupErrorCode = "runtime_state_invalid";
    await assert.rejects(api.ensureEduPiRuntime({ runtime, dataRoot }), { code: "runtime_state_invalid" });
    assert.equal(children.at(-1).connected, false);
    startupErrorCode = "private_path_detail";
    await assert.rejects(api.ensureEduPiRuntime({ runtime, dataRoot }), { code: "runtime_unavailable" });
    assert.equal(children.at(-1).connected, false);
    startupErrorCode = null;
    const restarted = await api.ensureEduPiRuntime({ runtime, dataRoot });
    assert.equal((await restarted.call("health", null)).ok, true);
    assert.equal(startupOptions.at(-1).ownerControlToken, startupOptions[1].ownerControlToken);
    await api.closeAllEduPiRuntimes();
    assert.equal(children.every(child => !child.connected), true);

    parentActivation = { ...scopedActivation, scope: { classId: "class-7-1", subject: "math" },
      grantId: "parent-grant", ownerId: "owner-1" };
    capabilityGate = true; activationOverride = null;
    const beforeLegacyForks = forks;
    const legacyParentRuntime = await api.ensureEduPiRuntime({ runtime, dataRoot });
    assert.equal(forks, beforeLegacyForks + 2, "V2 also needs a bounded capacity probe before its full G3 startup");
    assert.equal(startupOptions.at(-2).g3Bindings, undefined);
    assert.equal(startupOptions.at(-2).g1Scope, undefined);
    assert.equal(startupOptions.at(-2).g2Scope, undefined);
    assert.equal(startupOptions.at(-2).ambientPlanning, true);
    assert.equal(typeof startupOptions.at(-2).ownerControlToken, "string");
    assert.equal(startupOptions.at(-2).ownerMessageRegistration, undefined);
    assert.deepEqual(startupOptions.at(-1).g3Bindings?.map(binding => binding.domain), ["parent_communication"]);
    assert.equal(startupOptions.at(-1).sourceParentQuestionGoals, undefined,
      "a legacy V2 root retains existing G3 without starting the V3-only source path");
    await legacyParentRuntime.close();
    ownerHistoryCapacity = 512;
    const beforeParentForks = forks;
    const parentRuntime = await api.ensureEduPiRuntime({ runtime, dataRoot });
    assert.equal(forks, beforeParentForks + 2, "V3 is identified by a basic health read before enabling G5");
    assert.equal(startupOptions.at(-2).sourceParentQuestionGoals, undefined);
    assert.equal(startupOptions.at(-2).g3Bindings, undefined, "the probe cannot stale reviewed G5 work");
    assert.equal(startupOptions.at(-2).ownerMessageRegistration, undefined);
    assert.equal(startupOptions.at(-2).ambientPlanning, true);
    assert.equal(typeof startupOptions.at(-2).ownerControlToken, "string");
    assert.equal(startupOptions.at(-1).sourceParentQuestionGoals, true);
    assert.equal(startupOptions.at(-1).ownerMessageRegistration, true);
    assert.deepEqual(startupOptions.at(-1).g3Bindings, [{ domain: "parent_communication", grantId: "parent-grant",
      ownerId: "owner-1", scope: { class_id: "class-7-1", subject: "math" } }]);
    await parentRuntime.close();
    parentActivation = null;
    reflectionActivation = { ...scopedActivation, scope: { classId: "class-7-1", subject: "math" },
      grantId: "reflection-grant", ownerId: "owner-1" };
    for (const capacity of [128, 512, null]) {
      await t.test(`reflection-only cold startup checks owner capacity ${capacity ?? "stream"} before enabling sources`, async () => {
        ownerHistoryCapacity = capacity;
        ownerHistoryStorage = capacity === null ? "sqlite_stream_v1" : undefined;
        for (let boot = 0; boot < 2; boot++) {
          const beforeForks = forks;
          const startup = api.ensureEduPiRuntime({ runtime, dataRoot });
          assert.equal(api.ensureEduPiRuntime({ runtime, dataRoot }), startup);
          const reflectionRuntime = await startup;
          assert.equal(forks, beforeForks + 2);
          const probe = startupOptions.at(-2), selected = startupOptions.at(-1);
          assert.equal(probe.ambientPlanning, true);
          assert.equal(typeof probe.ownerControlToken, "string");
          for (const field of ["g1Scope", "g2Scope", "g3Bindings", "ownerMessageRegistration",
            "sourceReflectionGoals", "sourceParentQuestionGoals", "sourceAdministrativeGoals"]) assert.equal(probe[field], undefined);
          assert.equal(selected.sourceReflectionGoals, capacity === 128 ? undefined : true);
          assert.equal(selected.sourceParentQuestionGoals, undefined);
          assert.equal(selected.sourceAdministrativeGoals, undefined);
          assert.equal(selected.ownerMessageRegistration, true);
          assert.deepEqual(selected.g3Bindings, [reflectionBinding]);
          assert.equal((await reflectionRuntime.call("health", null)).ok, true);
          await reflectionRuntime.close();
          assert.equal(api.getActiveEduPiRuntime(root), null);
          assert.equal(children.every(child => !child.connected), true);
        }
      });
    }
    await t.test("reflection capacity failure closes the probe without starting G3", async () => {
      capacityUnavailable = true;
      const beforeForks = forks;
      await assert.rejects(api.ensureEduPiRuntime({ runtime, dataRoot }), { code: "runtime_unavailable" });
      assert.equal(forks, beforeForks + 1);
      assert.equal(startupOptions.at(-1).g3Bindings, undefined);
      assert.equal(children.at(-1).connected, false);
      capacityUnavailable = false;
    });
    await t.test("reflection missing owner and withdrawn grants never enable source goals", async () => {
      const activeReflection = reflectionActivation;
      for (const activation of [{ ...activeReflection, ownerId: undefined }, { ...activeReflection, enabled: false },
        { ...activeReflection, configurationStatus: "stop_pending" }]) {
        reflectionActivation = activation;
        const beforeForks = forks;
        const inactive = await api.ensureEduPiRuntime({ runtime, dataRoot });
        assert.equal(forks, beforeForks + 1, "inactive source grants do not start a capacity probe");
        assert.equal(startupOptions.at(-1).sourceReflectionGoals, undefined);
        if (!activation.enabled || activation.configurationStatus !== "ready") assert.equal(startupOptions.at(-1).g3Bindings, undefined);
        await inactive.close();
      }
      reflectionActivation = activeReflection;
      const active = await api.ensureEduPiRuntime({ runtime, dataRoot });
      assert.equal(startupOptions.at(-1).sourceReflectionGoals, true);
      reflectionActivation = { ...activeReflection, enabled: false };
      await assert.rejects(api.ensureEduPiRuntime({ runtime, dataRoot }), { code: "runtime_unavailable" });
      const withdrawn = await api.restartEduPiRuntime({ runtime, dataRoot });
      assert.notEqual(withdrawn, active);
      assert.equal(startupOptions.at(-1).g3Bindings, undefined);
      assert.equal(startupOptions.at(-1).sourceReflectionGoals, undefined);
      await withdrawn.close();
    });
    reflectionActivation = null; capabilityGate = false;

    await t.test("only effective explicit recall enables its own owner planning without enabling G1", async () => {
      const query = { message_ref: "synthetic-message", query: "synthetic question" };
      for (const flag of [undefined, "0", "true", "1"]) {
        if (flag === undefined) delete process.env.EDUPI_CORE_RECALL_ANSWERS;
        else process.env.EDUPI_CORE_RECALL_ANSWERS = flag;
        activationOverride = null;
        const inactive = await api.ensureEduPiRuntime({ runtime, dataRoot });
        assert.equal(startupOptions.at(-1).recallAnswers, undefined, "a flag cannot manufacture planning or owner registration");
        assert.equal(startupOptions.at(-1).ownerMessageRegistration, undefined);
        await inactive.callOwnerControl("owner_memory_recall", query);
        assert.equal(deadlines.at(-1), 15000);
        await inactive.close();
      }
      recallCanaryAllowed = true;
      process.env.EDUPI_CORE_RECALL_ANSWERS = "1";
      activationOverride = null;
      const independent = await api.ensureEduPiRuntime({ runtime, dataRoot });
      assert.equal(startupOptions.at(-1).recallAnswers, true);
      assert.equal(startupOptions.at(-1).ownerMessageRegistration, true);
      assert.equal(startupOptions.at(-1).ambientPlanning, true);
      assert.equal(startupOptions.at(-1).g1Scope, undefined, "R04 cannot create G1 execution consent");
      await independent.close();
      activationOverride = scopedActivation;
      for (const flag of [undefined, "true", "1"]) {
        if (flag === undefined) delete process.env.EDUPI_CORE_RECALL_ANSWERS;
        else process.env.EDUPI_CORE_RECALL_ANSWERS = flag;
        const enabled = await api.ensureEduPiRuntime({ runtime, dataRoot });
        const options = startupOptions.at(-1);
        assert.equal(options.recallAnswers, flag === "1" ? true : undefined);
        assert.equal(options.ownerMessageRegistration, true);
        assert.equal(options.ambientPlanning, true);
        assert.equal(typeof options.ownerControlToken, "string");
        for (const name of ["EDUPI_CORE_RECALL_ANSWERS", "EDUPI_CORE_LIVE_MODEL_CONFIG", "EDUPI_CORE_LIVE_MODEL_API_KEY"]) {
          assert.equal(Object.hasOwn(spawnEnvironments.at(-1), name), false, "model settings must not enter public child environment");
        }
        await enabled.callOwnerControl("owner_memory_recall", { message_ref: query.message_ref });
        assert.equal(deadlines.at(-1), 15000, "a no-query source listing keeps its original budget");
        await enabled.callOwnerControl("owner_recall_source_proof_read", { memory_id: "synthetic-memory" });
        assert.equal(deadlines.at(-1), 15000, "source proofs keep their original budget");
        await enabled.call("owner_memory_recall", query);
        assert.equal(deadlines.at(-1), 15000, "an unauthenticated owner request never gets the answer window");
        await enabled.callOwnerControl("owner_memory_recall", query);
        assert.equal(deadlines.at(-1), flag === "1" ? 46000 : 15000);
        process.env.EDUPI_CORE_RECALL_ANSWERS = flag === "1" ? "0" : "1";
        await assert.rejects(api.ensureEduPiRuntime({ runtime, dataRoot }), { code: "runtime_unavailable" });
        await enabled.close();
      }
      delete process.env.EDUPI_CORE_RECALL_ANSWERS;
      activationOverride = null;
    });

    await t.test("only owner writes and actual close or restart withdraw previously issued Core assertions", async () => {
      activationOverride = scopedActivation;
      const handle = await api.ensureEduPiRuntime({ runtime, dataRoot });
      const beforeReads = invalidatedRoots.length;
      for (const [operation, payload] of [["health", null], ["owner_read", { read: true }],
        ["owner_memory_recall", { message_ref: "synthetic-message", query: "synthetic question" }],
        ["owner_recall_source_proof_read", { memory_id: "synthetic-memory" }],
        ["owner_recall_person_read", { read: true }], ["owner_reflection_history_read", { read: true }]]) {
        await handle.callOwnerControl(operation, payload);
        assert.equal(deadlines.at(-1), 15000);
        assert.equal(invalidatedRoots.length, beforeReads, `${operation} cannot revoke or validate an answer`);
      }
      await handle.callBridge({ operation: "generated-artifacts", action: "list" });
      await handle.callBridge({ operation: "g1-excerpt", action: "source_preview" });
      assert.equal(invalidatedRoots.length, beforeReads, "Bridge read classification retains source proof and prior assertion state");
      await handle.callBridge({ operation: "agent-computer", action: "claim" });
      await handle.callBridge({ operation: "connector-setup", action: "start_runtime", connector_id: "dingtalk" });
      assert.equal(invalidatedRoots.length, beforeReads, "foreground queue and connector recovery cannot withdraw a Core answer");
      wrongBinding = true;
      await assert.rejects(handle.callBridge({ operation: "connector-setup", action: "start_runtime", connector_id: "dingtalk" }),
        { code: "runtime_unavailable" });
      wrongBinding = false;
      assert.equal(invalidatedRoots.length, beforeReads, "failed connector startup does not imply a recall source write");
      for (const request of [
        { operation: "agent-computer", action: "enqueue" },
        { operation: "agent-computer", action: "complete" },
        { operation: "connector-setup", action: "configure", connector_id: "dingtalk" },
        { operation: "connector-setup", action: "start_runtime", connector_id: "unrecognized" },
      ]) {
        const beforeWrite = invalidatedRoots.length;
        await handle.callBridge(request);
        assert.equal(invalidatedRoots.length, beforeWrite + 1, "all other Bridge calls keep their conservative write fence");
      }
      const beforeBridgeCall = invalidatedRoots.length;
      await handle.callBridge({ operation: "generated-artifacts", action: "register" });
      assert.equal(invalidatedRoots.length, beforeBridgeCall + 1);
      await handle.callBridge({ operation: "g1-excerpt", action: "review_source" });
      assert.equal(invalidatedRoots.length, beforeBridgeCall + 2);
      const beforeFailedBridge = invalidatedRoots.length;
      wrongBinding = true;
      await assert.rejects(handle.callBridge({ operation: "generated-artifacts", action: "register" }), { code: "runtime_unavailable" });
      wrongBinding = false;
      assert.equal(invalidatedRoots.length, beforeFailedBridge + 1);
      for (const operation of ["owner_control", "owner_message", "owner_recall_person_confirm"]) {
        const beforeWrite = invalidatedRoots.length;
        await handle.callOwnerControl(operation, { write: true });
        assert.equal(invalidatedRoots.length, beforeWrite + 1);
        assert.equal(invalidatedRoots.at(-1), dataRoot.root);
      }
      const beforeFailure = invalidatedRoots.length;
      wrongBinding = true;
      await assert.rejects(handle.callOwnerControl("owner_control", { write: true }), { code: "runtime_unavailable" });
      wrongBinding = false;
      assert.equal(invalidatedRoots.length, beforeFailure + 1, "failed writes conservatively revoke prior assertions");
      const beforeRestart = invalidatedRoots.length;
      const restarted = await api.restartEduPiRuntime({ runtime, dataRoot });
      assert.ok(invalidatedRoots.length > beforeRestart);
      assert.notEqual(restarted, handle);
      const beforeClose = invalidatedRoots.length;
      await restarted.close();
      assert.equal(invalidatedRoots.length, beforeClose + 1);
      await restarted.close();
      assert.equal(invalidatedRoots.length, beforeClose + 1, "repeated close shares one invalidation and drain");
      activationOverride = null;
    });

    for (const interrupt of ["cancel", "deadline"]) {
      await t.test(`answer ${interrupt} preserves the real Core completion slot and waits for the broker before disconnect`, {
        skip: !process.env.EDUPI_CORE_ROOT,
      }, async () => {
        const { createCoreRuntimeBridgeCallCoordinator } = await import(pathToFileURL(path.join(process.env.EDUPI_CORE_ROOT, "scripts/core_runtime_daemon.mjs")).href);
        const queue = createCoreRuntimeBridgeCallCoordinator();
        let finishModel, releaseReader, readerStarted, shutdown;
        const started = new Promise(resolve => { readerStarted = resolve; });
        modelCloseCompletion = new Promise(resolve => { finishModel = resolve; });
        modelCloseFinished = false;
        activationOverride = scopedActivation;
        process.env.EDUPI_CORE_RECALL_ANSWERS = "1";
        virtualNow = 0; virtualTimers = []; shutdownCoordinator = queue;
        let fetchCalls = 0, disconnects = 0;
        fetchOverride = (_url, init) => {
          fetchCalls++;
          return new Promise((resolve, reject) => {
            init.signal.addEventListener("abort", () => reject(new Error("transport aborted")), { once: true });
            void queue.enqueue(() => {
              readerActive = true;
              const reader = new Promise(done => { releaseReader = () => { readerActive = false; done(); }; });
              readerStarted();
              return { response: reader.then(() => { const sent = JSON.parse(init.body); return new Response(JSON.stringify({ ...sent, ok: true })); }),
                completion: reader, serialized: Promise.resolve() };
            }).then(resolve, reject);
          });
        };
        try {
          const answerHandle = await api.ensureEduPiRuntime({ runtime, dataRoot });
          children.at(-1).once("disconnect", () => {
            assert.equal(modelCloseFinished, true, "IPC disconnect is completion evidence only after the broker drains");
            disconnects++; releaseReader();
          });
          const cancellation = new AbortController();
          const caller = answerHandle.callOwnerControl("owner_memory_recall",
            { message_ref: "synthetic-message", query: "synthetic question" }, cancellation.signal);
          await started;
          assert.equal(virtualTimers.at(-1).ms, 46000);
          if (interrupt === "cancel") cancellation.abort();
          else { virtualNow = 46000; const transport = virtualTimers.at(-1); transport.active = false; transport.fn(); }
          await assert.rejects(caller, { code: "runtime_unavailable" });
          shutdown = answerHandle.close();
          assert.equal(virtualTimers.at(-1).ms, 46000);
          virtualNow += 6000;
          for (const timer of virtualTimers) if (timer.active && timer.at <= virtualNow) { timer.active = false; timer.fn(); }
          assert.equal(children.at(-1).connected, true);
          assert.equal(readerActive, true);
          assert.equal(forcedReaderKills, 0);
          assert.equal(disconnects, 0);
          finishModel(); await shutdown;
          assert.equal(await queue.waitForIdle(), true);
          assert.equal(disconnects, 1);
          assert.equal(fetchCalls, 1);
          assert.equal(forcedReaderKills, 0);
        } finally {
          finishModel(); releaseReader?.(); await shutdown;
          modelCloseCompletion = null; shutdownCoordinator = null; fetchOverride = null; virtualTimers = null; virtualNow = null;
          delete process.env.EDUPI_CORE_RECALL_ANSWERS; activationOverride = null;
        }
      });
    }
    await t.test("unsubmitted answers and source-only reads retain the short shutdown window", async () => {
      process.env.EDUPI_CORE_RECALL_ANSWERS = "1"; activationOverride = scopedActivation;
      for (const action of ["no-query", "proof", "invalid", "pre-aborted"]) {
        virtualNow = 0; virtualTimers = [];
        let ordinary;
        try {
          ordinary = await api.ensureEduPiRuntime({ runtime, dataRoot });
          if (action === "no-query") await ordinary.callOwnerControl("owner_memory_recall", { message_ref: "synthetic-message" });
          else if (action === "proof") await ordinary.callOwnerControl("owner_recall_source_proof_read", { memory_id: "synthetic-memory" });
          else if (action === "invalid") await assert.rejects(ordinary.callOwnerControl("owner_memory_recall", {}), { code: "invalid_request" });
          else {
            const cancellation = new AbortController(); cancellation.abort();
            await assert.rejects(ordinary.callOwnerControl("owner_memory_recall",
              { message_ref: "synthetic-message", query: "synthetic question" }, cancellation.signal), { code: "runtime_unavailable" });
          }
          const closed = ordinary.close();
          assert.equal(virtualTimers.at(-1).ms, 5000);
          await closed;
        } finally { await ordinary?.close(); virtualTimers = null; virtualNow = null; }
      }
      delete process.env.EDUPI_CORE_RECALL_ANSWERS; activationOverride = null;
    });

    ownerCredentialUnavailable = true;
    activationOverride = null;
    delete process.env.EDUPI_AMBIENT_PLANNING;
    const degraded = await api.ensureEduPiRuntime({ runtime, dataRoot });
    assert.equal(startupOptions.at(-1).ownerControlToken, undefined);
    assert.equal((await degraded.call("health", null)).ok, true);
    await assert.rejects(degraded.callOwnerControl("health", null), { code: "owner_control_credential_unavailable" });
    await degraded.close();
    const forksBeforeRequiredCredential = forks;
    process.env.EDUPI_AMBIENT_PLANNING = "1";
    await assert.rejects(api.ensureEduPiRuntime({ runtime, dataRoot }), { code: "owner_control_credential_unavailable" });
    assert.equal(forks, forksBeforeRequiredCredential);
    assert.ok(activationReads >= forks, "every runtime identity is bound to the current proactivity activation");
    await t.test("a timed-out FIFO intake keeps actual Core reader completion alive through shutdown", { skip: !process.env.EDUPI_CORE_ROOT }, async () => {
      const { createCoreRuntimeBridgeCallCoordinator } = await import(pathToFileURL(path.join(process.env.EDUPI_CORE_ROOT, "scripts/core_runtime_daemon.mjs")).href);
      const queue = createCoreRuntimeBridgeCallCoordinator();
      let releaseEarlier, releaseReader, readerStarted, shutdown;
      const earlier = new Promise(resolve => { releaseEarlier = resolve; });
      const prior = queue.enqueue(() => ({ response: earlier, completion: earlier, serialized: earlier }));
      const started = new Promise(resolve => { readerStarted = resolve; });
      ownerCredentialUnavailable = false; activationOverride = null; delete process.env.EDUPI_AMBIENT_PLANNING;
      virtualNow = 0; virtualTimers = []; shutdownCoordinator = queue;
      let fetchCalls = 0;
      fetchOverride = (_url, init) => {
        fetchCalls++;
        return new Promise((resolve, reject) => {
          init.signal.addEventListener("abort", () => reject(new Error("transport aborted")), { once: true });
          void queue.enqueue(() => {
            readerActive = true;
            const reader = new Promise(done => { releaseReader = () => { readerActive = false; done(); }; });
            readerStarted();
            return { response: reader.then(() => { const sent = JSON.parse(init.body); return new Response(JSON.stringify({ ...sent, ok: true })); }),
              completion: reader, serialized: Promise.resolve() };
          }).then(resolve, reject);
        });
      };
      try {
        const fifoHandle = await api.ensureEduPiRuntime({ runtime, dataRoot });
        const caller = fifoHandle.callBridge(intakeRequest);
        assert.equal(queue.queued, 1); assert.equal(readerActive, false);
        virtualNow = 24000; releaseEarlier(); await prior; await started;
        virtualNow = 38000;
        const transport = virtualTimers.find(timer => timer.active && timer.ms === 38000); transport.active = false; transport.fn();
        await assert.rejects(caller, { code: "runtime_unavailable" });
        shutdown = fifoHandle.close();
        const force = virtualTimers.at(-1);
        assert.equal(force.ms, 38000, "shutdown must budget from close, not from the expired caller clock");
        virtualNow = 42000;
        for (const timer of virtualTimers) if (timer.active && timer.at <= virtualNow) { timer.active = false; timer.fn(); }
        assert.equal(children.at(-1).connected, true, "the accepted reader remains owned after the caller's transport deadline");
        assert.equal(readerActive, true); assert.equal(forcedReaderKills, 0);
        virtualNow = 44000; releaseReader(); await shutdown;
        assert.equal(await queue.waitForIdle(), true); assert.equal(forcedReaderKills, 0);
        assert.equal(children.at(-1).connected, false); assert.equal(fetchCalls, 1);
      } finally {
        releaseEarlier(); releaseReader?.(); await shutdown;
        shutdownCoordinator = null; fetchOverride = null; virtualTimers = null; virtualNow = null;
      }
    });
    for (const action of ["material_schedule_read", "material_schedule_apply", "source_preview", "review_source"]) {
      await t.test(`${action} cancellation retains Core completion ownership during shutdown`, { skip: !process.env.EDUPI_CORE_ROOT }, async () => {
        const { createCoreRuntimeBridgeCallCoordinator } = await import(pathToFileURL(path.join(process.env.EDUPI_CORE_ROOT, "scripts/core_runtime_daemon.mjs")).href);
        const queue = createCoreRuntimeBridgeCallCoordinator();
        let releaseReader, startedReader, shutdown;
        const started = new Promise(resolve => { startedReader = resolve; });
        ownerCredentialUnavailable = false; activationOverride = null; delete process.env.EDUPI_AMBIENT_PLANNING;
        virtualNow = 0; virtualTimers = []; shutdownCoordinator = queue;
        let fetchCalls = 0;
        fetchOverride = (_url, init) => {
          fetchCalls++;
          return new Promise((resolve, reject) => {
            init.signal.addEventListener("abort", () => reject(new Error("transport aborted")), { once: true });
            void queue.enqueue(() => {
              readerActive = true;
              const reader = new Promise(done => { releaseReader = () => { readerActive = false; done(); }; });
              startedReader();
              return { response: reader.then(() => { const sent = JSON.parse(init.body); return new Response(JSON.stringify({ ...sent, ok: true })); }),
                completion: reader, serialized: Promise.resolve() };
            }).then(resolve, reject);
          });
        };
        try {
          const sourceHandle = await api.ensureEduPiRuntime({ runtime, dataRoot });
          const cancellation = new AbortController();
          const caller = action.startsWith("material_")
            ? sourceHandle.callOwnerControl(action, { material_id: "synthetic-material" }, cancellation.signal)
            : sourceHandle.callBridge({ operation: "g1-excerpt", action, input: { materialId: "synthetic-material" } }, cancellation.signal);
          await started;
          assert.equal(virtualTimers.at(-1).ms, 15000, "visible-source request deadlines stay unchanged");
          cancellation.abort();
          await assert.rejects(caller, { code: "runtime_unavailable" });
          shutdown = sourceHandle.close();
          assert.equal(virtualTimers.at(-1).ms, 38000, "reopened material readers need the same bounded completion window as upload readers");
          virtualNow = 6000;
          for (const timer of virtualTimers) if (timer.active && timer.at <= virtualNow) { timer.active = false; timer.fn(); }
          assert.equal(children.at(-1).connected, true); assert.equal(readerActive, true); assert.equal(forcedReaderKills, 0);
          releaseReader(); await shutdown;
          assert.equal(await queue.waitForIdle(), true); assert.equal(fetchCalls, 1); assert.equal(forcedReaderKills, 0);
        } finally {
          releaseReader?.(); await shutdown;
          shutdownCoordinator = null; fetchOverride = null; virtualTimers = null; virtualNow = null;
        }
      });
    }
    await t.test("ordinary health and unsubmitted material requests keep the short shutdown window", async () => {
      for (const action of ["health", "pre-aborted", "invalid"]) {
        ownerCredentialUnavailable = false; activationOverride = null; delete process.env.EDUPI_AMBIENT_PLANNING;
        virtualNow = 0; virtualTimers = [];
        let ordinary;
        try {
          ordinary = await api.ensureEduPiRuntime({ runtime, dataRoot });
          if (action === "health") await ordinary.call("health", null);
          else if (action === "invalid") await assert.rejects(ordinary.callOwnerControl("material_schedule_read", {}), { code: "invalid_request" });
          else {
            const cancellation = new AbortController(); cancellation.abort();
            await assert.rejects(ordinary.callOwnerControl("material_schedule_read", { material_id: "synthetic-material" }, cancellation.signal), { code: "runtime_unavailable" });
          }
          const closed = ordinary.close();
          assert.equal(virtualTimers.at(-1).ms, 5000);
          await closed;
        } finally { await ordinary?.close(); virtualTimers = null; virtualNow = null; }
      }
    });
    await t.test("an IPC-disconnected writer exit can finish shutdown without a stdio close event only after the model drain", async () => {
      ownerCredentialUnavailable = false; activationOverride = null; delete process.env.EDUPI_AMBIENT_PLANNING;
      let releaseModel;
      modelCloseCompletion = new Promise(resolve => { releaseModel = resolve; });
      modelCloseFinished = false; deliverCloseEvent = false;
      virtualNow = 0; virtualTimers = [];
      try {
        const handle = await api.ensureEduPiRuntime({ runtime, dataRoot });
        let closed = false;
        const closing = handle.close().then(() => { closed = true; });
        await new Promise(resolve => setImmediate(resolve));
        assert.equal(closed, false); assert.equal(modelCloseFinished, false);
        assert.equal(api.getActiveEduPiRuntime(root), handle, "retain admission until both process and parent work are reaped");
        releaseModel(); await closing;
        assert.equal(closed, true); assert.equal(modelCloseFinished, true);
        assert.equal(api.getActiveEduPiRuntime(root), null);
      } finally {
        releaseModel(); modelCloseCompletion = null; deliverCloseEvent = true; virtualTimers = null; virtualNow = null;
      }
    });
    await t.test("strict template quarantine returns unknown after its deadline while retaining an unfinished model drain", async () => {
      ownerCredentialUnavailable = false; activationOverride = null; delete process.env.EDUPI_AMBIENT_PLANNING;
      let releaseModel;
      modelCloseFinished = false;
      modelCloseCompletion = new Promise(resolve => { releaseModel = resolve; });
      virtualNow = 0; virtualTimers = [];
      try {
        await api.ensureEduPiRuntime({ runtime, dataRoot });
        const stopped = api.quarantineEduPiRuntime(root, { requireClosed: true });
        await new Promise(resolve => setImmediate(resolve));
        const deadline = virtualTimers.find(timer => timer.active && timer.ms === 48000);
        assert.ok(deadline, "strict shutdown has its own bounded completion deadline");
        deadline.active = false; deadline.fn();
        await assert.rejects(stopped, { code: "runtime_unavailable" });
        assert.equal(modelCloseFinished, false);
        assert.throws(() => api.clearEduPiRuntimeQuarantine(root), { code: "runtime_unavailable" },
          "another domain cannot reopen admission while the old parent model completion is unknown");
        await assert.rejects(api.ensureEduPiRuntime({ runtime, dataRoot }), { code: "runtime_unavailable" });
        const retried = api.quarantineEduPiRuntime(root, { requireClosed: true });
        await new Promise(resolve => setImmediate(resolve));
        assert.equal(modelCloseFinished, false, "a reaped child cannot erase its still-running parent model completion");
        releaseModel(); await retried;
        assert.equal(modelCloseFinished, true);
        api.clearEduPiRuntimeQuarantine(root);
      } finally {
        releaseModel(); modelCloseCompletion = null; virtualTimers = null; virtualNow = null;
      }
    });
    await t.test("template startup rechecks a private exact selection without borrowing G1 or broad G3 bindings", async () => {
      ownerCredentialUnavailable = false; activationOverride = null; delete process.env.EDUPI_AMBIENT_PLANNING;
      capabilityGate = false;
      templateConfig = { enabled: true, updatedAt: "2026-11-18T00:00:00.000Z", grantVersion: 1,
        binding: { ownerId: "template-owner", grantId: "template-grant",
          scope: { class_id: "template-class", subject: "数学" }, templateIds: ["selected-template"] } };
      const before = startupOptions.length, handle = await api.ensureEduPiRuntime({ runtime, dataRoot });
      assert.equal(startupOptions.length, before + 2, "probe and verified startup are distinct managed hosts");
      assert.equal(startupOptions[before].teacherTemplates, undefined);
      assert.equal(startupOptions[before].g3Bindings, undefined);
      assert.deepEqual(startupOptions.at(-1).teacherTemplates, templateConfig.binding);
      assert.equal(startupOptions.at(-1).g1Scope, undefined);
      assert.equal(startupOptions.at(-1).g3Bindings, undefined);
      assert.equal(templateOwnerReads, 1);
      templateBridgeOwner = "template-owner";
      ownerControlHeader = null;
      await handle.callBridge({ operation: "command", envelope: { teacher_review: { reviewer_id: "template-owner" } } });
      assert.equal(ownerControlHeader, startupOptions.at(-1).ownerControlToken);
      ownerControlHeader = null;
      await handle.callBridge({ operation: "command", envelope: { teacher_review: { reviewer_id: "teacher" } } });
      assert.equal(ownerControlHeader, null, "ordinary Bridge requests remain outside the owner channel");
      templateConfig = { ...templateConfig, updatedAt: "2026-11-18T00:00:00.001Z" };
      await assert.rejects(api.ensureEduPiRuntime({ runtime, dataRoot }), { code: "runtime_unavailable" });
      await handle.close();
      templateGrantCurrent = false;
      const historical = await api.ensureEduPiRuntime({ runtime, dataRoot });
      assert.equal(startupOptions.at(-1).teacherTemplates, undefined, "a revoked grant cannot start template automation");
      await historical.close();
      templateConfig = null; templateBridgeOwner = null;
    });
    await t.test("a failed strict drain cannot be cleared by another domain", async () => {
      const failedRoot = { ...dataRoot, root: path.join(root, "failed-close-root") };
      fs.mkdirSync(failedRoot.root);
      let rejectModel;
      modelCloseCompletion = new Promise((_resolve, reject) => { rejectModel = reject; });
      try {
        await api.ensureEduPiRuntime({ runtime, dataRoot: failedRoot });
        const closing = api.quarantineEduPiRuntime(failedRoot.root, { requireClosed: true });
        await new Promise(resolve => setImmediate(resolve));
        rejectModel(new Error("synthetic model completion failure"));
        await assert.rejects(closing, { code: "runtime_unavailable" });
        assert.throws(() => api.clearEduPiRuntimeQuarantine(failedRoot.root), { code: "runtime_unavailable" });
        await assert.rejects(api.ensureEduPiRuntime({ runtime, dataRoot: failedRoot }), { code: "runtime_unavailable" });
      } finally { modelCloseCompletion = null; }
    });
  } finally {
    if (originalAmbientPlanning === undefined) delete process.env.EDUPI_AMBIENT_PLANNING;
    else process.env.EDUPI_AMBIENT_PLANNING = originalAmbientPlanning;
    if (originalWindowsCanary === undefined) delete process.env.EDUPI_WINDOWS_G1_CANARY;
    else process.env.EDUPI_WINDOWS_G1_CANARY = originalWindowsCanary;
    if (originalDesktopStateDir === undefined) delete process.env.PI_DESKTOP_STATE_DIR;
    else process.env.PI_DESKTOP_STATE_DIR = originalDesktopStateDir;
    if (originalRecallAnswers === undefined) delete process.env.EDUPI_CORE_RECALL_ANSWERS;
    else process.env.EDUPI_CORE_RECALL_ANSWERS = originalRecallAnswers;
    await api.closeAllEduPiRuntimes(); server.closeAllConnections(); await new Promise(resolve => server.close(resolve)); fs.rmSync(root, { recursive: true, force: true });
  }
});
