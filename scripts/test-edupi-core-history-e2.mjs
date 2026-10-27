#!/usr/bin/env node
/**
 * Source pairing proof through Desktop's unchanged supervisor and real host.
 * Data roots are newly created here and retained; --recover-report only reads
 * a previously retained fixture. Main3 activation uses
 * Core's explicitly test-only fixture helper, never an installer migration.
 * No model scopes, real app, external provider, or external send is enabled.
 */
import assert from "node:assert/strict";
import childProcess, { execFileSync } from "node:child_process";
import crypto from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { syncBuiltinESMExports } from "node:module";
import { fileURLToPath, pathToFileURL } from "node:url";
import { parseArgs } from "node:util";
import { createJiti } from "jiti";

const { values } = parseArgs({ options: { "evidence-dir": { type: "string" },
  "recover-report": { type: "string" }, "pagination-only": { type: "boolean", default: false },
  "stress-history": { type: "boolean", default: false } } });
assert.ok(values["evidence-dir"] && path.isAbsolute(values["evidence-dir"]), "an absolute --evidence-dir is required");
assert.ok(!values["recover-report"] || path.isAbsolute(values["recover-report"]), "--recover-report must be absolute");
assert.ok(!values["recover-report"] || !values["stress-history"], "recovery and stress are separate checks");
assert.ok(!values["pagination-only"] || values["recover-report"], "pagination-only requires a retained recovery report");
assert.ok(process.env.EDUPI_CORE_ROOT && path.isAbsolute(process.env.EDUPI_CORE_ROOT), "an absolute EDUPI_CORE_ROOT is required");
const desktopRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const coreRoot = fs.realpathSync(process.env.EDUPI_CORE_ROOT);
const hash = bytes => `sha256:${crypto.createHash("sha256").update(bytes).digest("hex")}`;
const read = file => JSON.parse(fs.readFileSync(file, "utf8"));
const git = (root, ...args) => execFileSync("git", ["-C", root, ...args], { encoding: "utf8", timeout: 15000 }).trim();
const coreCommit = git(coreRoot, "rev-parse", "HEAD");
const compat = read(path.join(desktopRoot, "contracts/edupi-core-compat.json"));
assert.equal(coreCommit, compat.core_runtime.core_commit, "the source Core must match Desktop's actual pin");
assert.equal(git(coreRoot, "status", "--porcelain"), "", "the paired Core source must be clean");
process.chdir(desktopRoot);
const evidenceDirectory = fs.realpathSync(values["evidence-dir"]);
const recovery = Boolean(values["recover-report"]), paginationOnly = values["pagination-only"], stress = values["stress-history"], streamCaptureCount = stress ? 513 : 16;
const runId = `${new Date().toISOString().replace(/[:.]/gu, "-")}-${crypto.randomUUID().slice(0, 8)}`;
const reportPrefix = paginationOnly ? "desktop-core-history-pagination" : recovery ? "desktop-core-history-recovery" : "desktop-core-history";
const reportFile = path.join(evidenceDirectory, `${reportPrefix}-${runId}.json`);
const progressFile = path.join(evidenceDirectory, `${reportPrefix}-${runId}.jsonl`);
const write = () => fs.writeFileSync(reportFile, JSON.stringify(report, null, 2) + "\n", { mode: 0o600 });
const report = {
  test: paginationOnly ? "desktop-core-history-pagination-e2-v1" : recovery ? "desktop-core-history-recovery-e2-v1" : "desktop-core-history-e2-v1",
  mode: paginationOnly ? "retained_fixture_pagination" : recovery ? "retained_fixture_recovery" : stress ? "stress_history" : "functional_representative",
  plannedStreamCaptures: recovery ? 0 : streamCaptureCount, status: "running", startedAt: new Date().toISOString(),
  identity: { desktopRoot, desktopCommit: git(desktopRoot, "rev-parse", "HEAD"), coreRoot, coreCommit,
    compatHash: hash(fs.readFileSync(path.join(desktopRoot, "contracts/edupi-core-compat.json"))),
    runtimeSchemaHash: compat.core_runtime.runtime_schema_hash,
    sourceHashes: Object.fromEntries(["scripts/test-edupi-core-history-e2.mjs", "desktop/core-runtime-host.mjs", "lib/edupi-runtime-supervisor.ts"]
      .map(relative => [relative, hash(fs.readFileSync(path.join(desktopRoot, relative)))])) },
  // The actual 457-capture source proof took eight minutes: two authenticated
  // operations per capture have growing history cost. Stress gets twenty
  // minutes for 513 plus reads/restart; individual requests remain 15 seconds.
  environment: { platform: process.platform, arch: process.arch, node: process.version, clock: "real", requestBudgetMs: 15000,
    runBudgetMs: stress ? 1200000 : 120000 },
  boundaries: { syntheticOnly: true, freshRootsOnly: !recovery, recoveryOnly: recovery, retainAllRoots: true, externalSend: false,
    newMessages: !recovery, requestedStress513: !recovery && stress, capture513Verified: false,
    modelScopes: false, testFixtureMigrationOnly: true, realApp: false, packaging: false, installation: false,
    pagination: "Core branded normal-v3 runtime port after host close; Runtime has no public pagination operation" },
  roots: {}, processes: [], operations: {}, checkpoints: [], modelRequests: 0, runtimeClosed: false,
};
fs.writeFileSync(reportFile, JSON.stringify(report, null, 2) + "\n", { flag: "wx", mode: 0o600 });
fs.writeFileSync(progressFile, "", { flag: "wx", mode: 0o600 });
let stage = "setup", supervisor, lastFailure;
const signal = new AbortController(), children = new Set();
const checkpoint = (name, metadata = {}) => {
  const entry = { name, at: new Date().toISOString(), ...metadata };
  report.checkpoints.push(entry); fs.appendFileSync(progressFile, JSON.stringify(entry) + "\n"); write();
  console.log(JSON.stringify(entry));
};
const originalFork = childProcess.fork;
childProcess.fork = (file, args, options) => {
  assert.equal(path.resolve(file), path.join(desktopRoot, "desktop/core-runtime-host.mjs"), "only the unchanged real Desktop host may be forked");
  const child = originalFork(file, args, options), entry = { pid: child.pid, dataRoot: options.env.EDUPI_PROJECT_ROOT,
    bootstrap: file, ready: null, closed: false, exitCode: null, signal: null };
  children.add(child); report.processes.push(entry);
  child.on("message", message => {
    if (message?.type === "runtime-ready") entry.ready = { dataRootFingerprint: message.dataRootFingerprint,
      fencingGeneration: message.fencingGeneration, instanceNonce: message.instanceNonce,
      supervisorSessionId: message.supervisorSessionId, coreCommit: message.coreCommit, schemaHash: message.schemaHash };
    if (["model-config-request", "model-run"].includes(message?.type)) report.modelRequests += 1;
    if (message?.type === "runtime-error") entry.startupError = message.code;
  });
  child.once("close", (code, stoppedBy) => { entry.closed = true; entry.exitCode = code; entry.signal = stoppedBy; children.delete(child); });
  return child;
};
syncBuiltinESMExports();
const originalFetch = globalThis.fetch;
globalThis.fetch = (url, init) => {
  const target = new URL(typeof url === "string" || url instanceof URL ? url : url.url);
  assert.ok(target.protocol === "http:" && target.hostname === "127.0.0.1", "only the loopback Runtime transport is allowed");
  return originalFetch(url, init);
};
const stop = async () => { signal.abort(); await supervisor?.closeAllEduPiRuntimes(); };
const watchdog = setTimeout(() => {
  stage = "whole-run-deadline"; lastFailure = { name: "DeadlineError", code: "history_run_deadline" };
  void stop();
}, report.environment.runBudgetMs);
const hardStop = setTimeout(() => {
  for (const child of children) child.kill("SIGKILL");
  report.status = "failed"; report.failure = lastFailure || { name: "DeadlineError", code: "history_run_deadline" };
  report.stage = stage; report.runtimeClosed = false; write(); process.exit(1);
}, report.environment.runBudgetMs + 10000);
const interrupted = () => { lastFailure = { name: "InterruptedError", code: "history_interrupted" }; void stop(); };
process.once("SIGTERM", interrupted); process.once("SIGINT", interrupted);

const tmp = fs.realpathSync(os.tmpdir());
function fresh(prefix) {
  const root = fs.realpathSync(fs.mkdtempSync(path.join(tmp, prefix)));
  assert.equal(path.dirname(root), tmp); assert.match(path.basename(root), /^edupi-[A-Za-z0-9-]+$/u);
  return root;
}
function existingDirectory(directory) {
  const stat = fs.lstatSync(directory);
  assert.ok(stat.isDirectory() && !stat.isSymbolicLink()); assert.equal(fs.realpathSync(directory), directory);
  assert.equal(stat.mode & 0o077, 0, "fixture directories must remain private");
  if (typeof process.getuid === "function") assert.equal(stat.uid, process.getuid());
}
function configureRoot(root, stateDir, agentDir, { existing = false } = {}) {
  for (const relative of [".edupi/memory", ".edupi/output", ".edupi/locks"]) {
    if (existing) existingDirectory(path.join(root, relative));
    else fs.mkdirSync(path.join(root, relative), { recursive: true, mode: 0o700 });
  }
  Object.assign(process.env, { PI_CODING_AGENT_DIR: agentDir, PI_DESKTOP_STATE_DIR: stateDir, PI_OFFLINE: "1",
    EDUPI_SAFE_MODE: "0", EDUPI_DESKTOP_ISOLATED_CANARY: "1", EDUPI_AMBIENT_PLANNING: "1",
    EDUPI_CORE_ROOT: coreRoot, EDUPI_CORE_ALLOWED_ROOT: path.dirname(coreRoot), EDUPI_CORE_VALIDATION_MODE: "external",
    EDUPI_DATA_ROOT: root, EDUPI_DATA_ALLOWED_ROOT: tmp, EDUPI_PROJECT_ROOT: root, EDUPI_HOME: path.join(root, ".edupi"),
    EDUPI_MEMORY_DIR: path.join(root, ".edupi/memory"), EDUPI_OUTPUT_DIR: path.join(root, ".edupi/output"),
    EDUPI_LOCK_DIR: path.join(root, ".edupi/locks"), EDUPI_DATA_DIR: path.join(root, "data"),
    EDUPI_CONFIG_DIR: path.join(root, "config"), EDUPI_SKILLS_DIR: path.join(root, "skills") });
}
async function call(host, operation, payload, expectedError = null) {
  stage = operation; signal.signal.throwIfAborted();
  if (recovery) assert.ok(["health", "owner_read", "owner_intent_read"].includes(operation), "recovery must not issue a write operation");
  const started = performance.now();
  const response = await (operation === "health" ? host.call(operation, payload, signal.signal) : host.callOwnerControl(operation, payload, signal.signal));
  const stats = report.operations[operation] ||= { count: 0, maxMs: 0, errors: {} };
  stats.count += 1; stats.maxMs = Math.max(stats.maxMs, Math.round(performance.now() - started));
  if (!response.ok) stats.errors[response.error_code] = (stats.errors[response.error_code] || 0) + 1;
  if (expectedError) { assert.equal(response.error_code, expectedError, `${operation} must reject the expected binding`); return response; }
  assert.equal(response.ok, true, `${operation} failed: ${response.error_code || "unknown"}`);
  return response.result;
}
const credential = value => ({ carrier_id: value.carrier_id, plan_id: value.plan_id, producer_epoch: value.producer_epoch, sequence: value.sequence });
const capture = (target, id) => ({ root_ref: target.rootRef, expected_owner_id: target.ownerId,
  grant_id: target.grantId, expected_grant_version: 1, conversation_id: target.conversationId,
  message_id: id, occurred_at: target.occurredAt, text: `合成历史验证 ${id}` });
const register = (host, target, id) => call(host, "owner_message_register", { ...capture(target, id), carrier_id: "desktop-history-e2", plan_id: `plan-${id}` });
const captured = (host, target, id, registration) => call(host, "owner_message", { action: "capture", ...capture(target, id),
  ...(registration ? { registration: credential(registration) } : {}) });
const intent = (host, target, messageRef) => call(host, "owner_intent_read", { root_ref: target.rootRef, expected_owner_id: target.ownerId, message_ref: messageRef });
const settleInput = (target, id, registration, health) => {
  const { text: _text, ...input } = capture(target, id);
  return { ...input, expected_message_ref: registration.message_ref, registration: credential(registration),
    expected_fencing_generation: health.fencing_generation, expected_instance_nonce: health.instance_nonce };
};
async function startTarget(target, snapshots) {
  configureRoot(target.dataRoot, target.stateDir, target.agentDir, { existing: target.retained === true }); stage = `start-${target.label}`;
  const roots = snapshots.resolveEduPiBridgeRoots();
  const host = await supervisor.ensureEduPiRuntime(roots), health = await call(host, "health", null);
  assert.equal(health.core_commit, coreCommit);
  assert.equal(health.component_manifest_hash, compat.core_runtime.runtime_component_manifest_hash);
  assert.equal(report.processes.findLast(child => child.dataRoot === target.dataRoot)?.ready?.schemaHash, compat.core_runtime.runtime_schema_hash);
  assert.equal(report.modelRequests, 0, "the history proof must not request model configuration or execution");
  return { host, health };
}
async function seed(target, snapshots, { registered = true } = {}) {
  const { host, health } = await startTarget(target, snapshots);
  const owner = await call(host, "owner_read", {}); target.rootRef = owner.root_ref;
  assert.equal(owner.owner, null, "each newly created fixture must start without an owner");
  await call(host, "owner_control", { command_id: "history-bootstrap", root_ref: target.rootRef, expected_owner_id: null, action: "bootstrap" });
  target.ownerId = (await call(host, "owner_read", {})).owner.id;
  await call(host, "owner_control", { command_id: "history-grant", root_ref: target.rootRef, expected_owner_id: target.ownerId,
    action: "create", grant_id: target.grantId, expected_version: 0, spec: { scope: { class_id: "synthetic-history-class", subject: "数学" },
      domains: ["teaching_preparation"], actions: ["prepare", "update"],
      source_ids: [`conversation:${crypto.createHash("sha256").update(target.conversationId).digest("hex")}`],
      starts_at: new Date(Date.now() - 60000).toISOString(), ends_at: new Date(Date.now() + 3600000).toISOString(),
      budget: { id: "synthetic-history-budget", max_calls: 0 } } });
  const registration = registered ? await register(host, target, "old-captured") : null;
  const receipt = await captured(host, target, "old-captured", registration);
  assert.equal(receipt.replayed, false); target.old = { registration, receipt };
  if (registered) {
    target.late = await register(host, target, "old-uncaptured"); target.sealed = await register(host, target, "old-sealed");
  }
  assert.equal((await call(host, "health", null)).owner_message_capacity.record_limit, 128);
  checkpoint(`${target.label}-main1-seeded`, { dataRoot: target.dataRoot, ownerId: target.ownerId, rootRef: target.rootRef,
    capacity: (await call(host, "health", null)).owner_message_capacity, generation: health.fencing_generation });
  return { host, health };
}
async function verifyOwner(host, target) {
  const owner = await call(host, "owner_read", {});
  assert.equal(owner.owner.id, target.ownerId); assert.equal(owner.root_ref, target.rootRef);
  assert.equal(owner.grants.find(grant => grant.id === target.grantId)?.version, 1);
}
async function exerciseLateAndSeal(host, target, health) {
  const late = await captured(host, target, "old-uncaptured", target.late); assert.equal(late.replayed, false);
  const sealedInput = settleInput(target, "old-sealed", target.sealed, health);
  const sealed = await call(host, "owner_message_settle", sealedInput);
  assert.equal(sealed.status, "sealed_absent"); assert.equal(sealed.replayed, false);
  assert.equal((await call(host, "owner_message_settle", sealedInput)).replayed, true);
  await call(host, "owner_message", { action: "capture", ...capture(target, "old-sealed"), registration: credential(target.sealed) }, "owner_version_conflict");
  const withdrawal = { action: "withdraw", root_ref: target.rootRef, expected_owner_id: target.ownerId,
    message_ref: target.old.receipt.receipt.message_ref, expected_revision: 1 };
  assert.equal((await call(host, "owner_message", withdrawal)).replayed, false);
  assert.equal((await call(host, "owner_message", withdrawal)).replayed, true);
  assert.equal((await captured(host, target, "old-captured", target.old.registration)).replayed, true);
  assert.equal((await intent(host, target, withdrawal.message_ref)).status, "withdrawn");
  target.sealedInput = sealedInput; target.withdrawal = withdrawal;
  return late;
}

async function withAuthenticatedHistoryReader(dataRoot, ownerControlToken, consume) {
  const load = relative => import(pathToFileURL(path.join(coreRoot, "scripts", relative)).href);
  const { prepareCoreRuntimeRoot } = await load("core_runtime_root.mjs");
  const { acquireCoreRuntimeWriterAdmissionV3Runtime } = await load("core_runtime_writer_admission.mjs");
  const { createCoreRuntimeV3Store } = await load("core_runtime_store.mjs");
  const { createCoreOwnerHistoryV3RuntimeStore } = await load("core_owner_history_v3_store.mjs");
  const root = prepareCoreRuntimeRoot(dataRoot);
  const lease = await acquireCoreRuntimeWriterAdmissionV3Runtime({ root, kind: "daemon", ownerControlToken });
  let runtime;
  try {
    const identity = `desktop-history-reader-${crypto.randomUUID()}`;
    runtime = await createCoreRuntimeV3Store({ dataRoot, supervisorSessionId: identity, instanceNonce: identity,
      processStartEvidence: identity, admissionLease: lease, ownerControlToken });
    runtime.setLifecycle("ready");
    const port = await createCoreOwnerHistoryV3RuntimeStore({ root, admissionLease: lease, ownerControlToken, runtimeStore: runtime });
    return await consume(port, runtime.fencingGeneration);
  } finally {
    try { runtime?.release(); }
    finally { try { runtime?.close(); } finally { await lease.release(); } }
  }
}

async function recoverRetainedFixture() {
  stage = "validate-recovery-fixture";
  const sourceFile = path.resolve(values["recover-report"]);
  assert.equal(fs.realpathSync(sourceFile), sourceFile); assert.equal(path.dirname(sourceFile), evidenceDirectory);
  assert.match(path.basename(sourceFile), /^desktop-core-history-\d{4}-[A-Za-z0-9-]+\.json$/u);
  const sourceBytes = fs.readFileSync(sourceFile), source = JSON.parse(sourceBytes), sourceHash = hash(sourceBytes);
  assert.equal(source.test, "desktop-core-history-e2-v1"); assert.equal(source.status, "failed");
  assert.equal(source.stage, "whole-run-deadline"); assert.equal(source.failure?.code, "history_run_deadline");
  assert.equal(source.runtimeClosed, true); assert.equal(source.modelRequests, 0);
  assert.equal(source.boundaries.syntheticOnly, true); assert.equal(source.boundaries.freshRootsOnly, true);
  assert.equal(source.boundaries.externalSend, false); assert.equal(source.boundaries.modelScopes, false);
  assert.equal(source.identity.coreCommit, coreCommit); assert.equal(source.identity.coreRoot, coreRoot);
  assert.equal(source.identity.desktopRoot, desktopRoot);
  assert.equal(source.identity.compatHash, report.identity.compatHash);
  for (const file of ["desktop/core-runtime-host.mjs", "lib/edupi-runtime-supervisor.ts"])
    assert.equal(source.identity.sourceHashes[file], report.identity.sourceHashes[file], "the production host source must match the retained proof");
  const dataRoot = source.roots.main3, stateRoot = source.roots.state;
  for (const [root, prefix] of [[dataRoot, "main3"], [stateRoot, "state"]]) {
    assert.equal(path.dirname(root), tmp);
    assert.match(path.basename(root), new RegExp(`^edupi-desktop-history-${prefix}-[A-Za-z0-9]{6}$`, "u"));
    existingDirectory(root);
  }
  const stateDir = path.join(stateRoot, "main3-state"), agentDir = path.join(stateRoot, "main3-agent");
  existingDirectory(stateDir); existingDirectory(agentDir);
  assert.deepEqual(fs.readdirSync(stateDir).sort(), ["edupi-owner-control"], "recovery accepts only this model-free fixture state");
  const selected = source.checkpoints.find(item => item.name === "main3-normal-host-selected");
  const seeded = source.checkpoints.find(item => item.name === "main3-main1-seeded");
  const activated = source.checkpoints.find(item => item.name === "main3-test-fixture-activated");
  assert.equal(activated?.dataRoot, dataRoot); assert.equal(activated?.testFixture, true);
  assert.match(selected?.ownerId || "", /^owner_[a-f0-9]{32}$/u);
  assert.match(selected?.rootRef || "", /^sha256:[a-f0-9]{64}$/u);
  assert.equal(seeded?.ownerId, selected.ownerId); assert.equal(seeded?.rootRef, selected.rootRef);
  const prior = source.processes.findLast(child => child.dataRoot === dataRoot);
  assert.ok(source.processes.every(child => child.closed && child.exitCode === 0 && child.signal === null));
  assert.equal(prior.ready.dataRootFingerprint, selected.rootRef);
  const metadataFile = path.join(evidenceDirectory, "desktop-core-history-third-post-stop-metadata.json"), metadata = read(metadataFile);
  assert.equal(metadata.test, "desktop-core-history-e2-post-stop-metadata-v1"); assert.equal(metadata.report, sourceFile);
  assert.equal(metadata.database, path.join(dataRoot, ".edupi/runtime/core-runtime-v1.sqlite"));
  assert.equal(metadata.mainSchema, 3); assert.equal(metadata.noAdditionalRun, true);
  const streamCount = metadata.acknowledgedStreamCaptures;
  assert.ok(Number.isSafeInteger(streamCount) && streamCount > 0 && streamCount < 513);
  assert.equal(metadata.streamCapturesPresent, streamCount); assert.equal(metadata.sourceRecords, streamCount + 2);
  const counts = Object.fromEntries(metadata.recordsByStatus.map(item => [item.status, item.count]));
  assert.deepEqual(counts, { captured: streamCount + 1, registered: 1, sealed_absent: 1, withdrawn: 1 });
  const expectedCapacity = { storage: "sqlite_stream_v1", record_limit: null, records_used: streamCount + 2,
    status: "available", gate_entry_limit: null, gate_entries_used: streamCount + 4, intake_pending: false, limiting_factor: null };
  const tokenDirectory = path.join(stateDir, "edupi-owner-control"); existingDirectory(tokenDirectory);
  const tokenFile = path.join(tokenDirectory, `${crypto.createHash("sha256").update(dataRoot).digest("hex").slice(0, 32)}.key`);
  const tokenStat = fs.lstatSync(tokenFile);
  assert.ok(tokenStat.isFile() && !tokenStat.isSymbolicLink()); assert.equal(tokenStat.size, 43);
  assert.equal(tokenStat.mode & 0o077, 0); assert.equal(fs.realpathSync(tokenFile), tokenFile);
  const tokenHash = hash(fs.readFileSync(tokenFile)); // Compare in memory only; never publish a credential hash.
  const target = { label: "main3", dataRoot, stateDir, agentDir, retained: true,
    ownerId: selected.ownerId, rootRef: selected.rootRef, grantId: "history-main3-grant", conversationId: "synthetic-desktop-history-main3" };
  configureRoot(dataRoot, stateDir, agentDir, { existing: true });
  const loadCore = relative => import(pathToFileURL(path.join(coreRoot, "scripts", relative)).href);
  const { verifyCoreRuntimeRoot } = await loadCore("core_runtime_root.mjs");
  const verifiedRoot = verifyCoreRuntimeRoot(dataRoot);
  assert.equal(verifiedRoot.ok, true); assert.equal(verifiedRoot.dataRootFingerprint, target.rootRef);
  const { ownerMessageValueContract: valueContract } = await loadCore("ambient_conversation_store.mjs");
  const conversationHash = valueContract.hash(target.conversationId), sourceRef = `conversation:${conversationHash.slice(7)}`;
  const reference = id => valueContract.messageReference(target.rootRef, target.ownerId, sourceRef, conversationHash, valueContract.hash(id));
  const claimFile = `${sourceFile}.recovery-claim.json`;
  let priorRecoveryFile, priorRecoveryHash;
  if (paginationOnly) {
    // Explicit continuation of a completed cold-start check. This branch
    // never starts a host and cannot re-register or capture a message.
    const claim = read(claimFile);
    assert.equal(claim.test, "desktop-core-history-recovery-e2-v1"); assert.equal(claim.sourceHash, sourceHash);
    assert.equal(claim.sourceFile, sourceFile); assert.equal(claim.dataRoot, dataRoot); assert.equal(claim.ownerId, target.ownerId);
    priorRecoveryFile = claim.recoveryReport;
    assert.equal(path.dirname(priorRecoveryFile), evidenceDirectory);
    assert.equal(fs.realpathSync(priorRecoveryFile), priorRecoveryFile);
    const priorRecoveryBytes = fs.readFileSync(priorRecoveryFile), priorRecovery = JSON.parse(priorRecoveryBytes);
    priorRecoveryHash = hash(priorRecoveryBytes);
    assert.equal(priorRecovery.test, "desktop-core-history-recovery-e2-v1"); assert.equal(priorRecovery.status, "failed");
    assert.equal(priorRecovery.stage, "retained-main3-authenticated-pagination");
    assert.equal(priorRecovery.runtimeClosed, true); assert.equal(priorRecovery.modelRequests, 0);
    assert.equal(priorRecovery.identity.coreCommit, coreCommit); assert.equal(priorRecovery.recovery.sourceHash, sourceHash);
    assert.equal(priorRecovery.processes.length, 1);
    assert.ok(priorRecovery.processes.every(child => child.closed && child.exitCode === 0 && child.signal === null));
    const cold = priorRecovery.checkpoints.find(item => item.name === "retained-main3-real-host-cold-restart");
    assert.equal(cold.ownerId, target.ownerId); assert.equal(cold.rootRef, target.rootRef);
    assert.deepEqual(cold.capacity, expectedCapacity); assert.ok(cold.generation > prior.ready.fencingGeneration);
    fs.writeFileSync(`${sourceFile}.pagination-claim.json`, JSON.stringify({ test: report.test, sourceFile, sourceHash,
      priorRecoveryFile, priorRecoveryHash, paginationReport: reportFile, claimedAt: new Date().toISOString(), hostStarts: 0, newMessages: 0 }) + "\n",
    { flag: "wx", mode: 0o600 });
  } else {
    fs.writeFileSync(claimFile, JSON.stringify({ test: report.test, sourceFile, sourceHash, recoveryReport: reportFile,
      dataRoot, ownerId: target.ownerId, claimedAt: new Date().toISOString(), newMessages: false }) + "\n", { flag: "wx", mode: 0o600 });
  }
  report.roots = { state: stateRoot, main3: dataRoot };
  report.recovery = { sourceFile, sourceHash, claimFile, priorStatus: source.status, priorFailure: source.failure.code,
    priorStreamCaptures: streamCount, expectedOwnerId: target.ownerId, expectedRootRef: target.rootRef, originalReportUnchanged: false,
    ...(paginationOnly ? { priorRecoveryFile, priorRecoveryHash, priorRecoveryUnchanged: false, newHostStarts: 0 } : {}) };
  checkpoint("retained-fixture-validated", { dataRoot, ownerId: target.ownerId, expectedSourceRecords: expectedCapacity.records_used,
    priorStreamCaptures: streamCount, stressCapture513Verified: false });
  const jiti = createJiti(import.meta.url, { tsconfigPaths: true });
  supervisor = await jiti.import(path.join(desktopRoot, "lib/edupi-runtime-supervisor.ts"));
  const snapshots = await jiti.import(path.join(desktopRoot, "lib/edupi-core-snapshot.ts"));
  const ownerTokens = await jiti.import(path.join(desktopRoot, "lib/edupi-owner-control-token.ts"));
  if (!paginationOnly) {
  const session = await startTarget(target, snapshots); await verifyOwner(session.host, target);
  assert.deepEqual(session.health.owner_message_capacity, expectedCapacity);
  assert.equal(session.health.data_root_fingerprint, target.rootRef);
  assert.ok(session.health.fencing_generation > prior.ready.fencingGeneration);
  assert.notEqual(session.health.instance_nonce, prior.ready.instanceNonce); assert.equal(session.health.queue.total, 0);
  assert.equal((await intent(session.host, target, reference("old-captured"))).status, "withdrawn");
  assert.equal((await intent(session.host, target, reference(`stream-${streamCount}`))).status, "current");
  checkpoint("retained-main3-real-host-cold-restart", { ownerId: target.ownerId, rootRef: target.rootRef,
    capacity: session.health.owner_message_capacity, priorGeneration: prior.ready.fencingGeneration,
    generation: session.health.fencing_generation, nonceChanged: true, existingHistoryOnly: true, newMessages: 0 });
  await session.host.close();
  }
  assert.equal(hash(fs.readFileSync(tokenFile)), tokenHash, "the retained credential must not be replaced");
  stage = "retained-main3-authenticated-pagination";
  const ownerControlToken = ownerTokens.loadOwnerControlToken(stateDir, dataRoot);
  await withAuthenticatedHistoryReader(dataRoot, ownerControlToken, async (port, readerGeneration) => {
    assert.equal(await port.verify(), true); assert.deepEqual(await port.capacitySnapshot(), expectedCapacity);
    const ids = ["old-captured", "old-uncaptured", ...Array.from({ length: streamCount }, (_, index) => `stream-${index + 1}`)];
    const expected = new Map(ids.map(id => [reference(id), id])), seen = new Set(), pageSizes = [];
    let cursor = null;
    do {
      signal.signal.throwIfAborted();
      const page = await port.readRecordPage({ cursor, limit: 31 }); pageSizes.push(page.records.length);
      for (const record of page.records) {
        const id = expected.get(record.message_ref); assert.ok(id, "pagination must contain only this fixture's known messages");
        assert.equal(seen.has(record.message_ref), false); seen.add(record.message_ref);
        assert.equal(record.owner_id, target.ownerId); assert.equal(record.root_ref, target.rootRef);
        assert.equal(record.message_id_hash, valueContract.hash(id)); assert.equal(record.conversation_id_hash, conversationHash);
        assert.equal(record.status, id === "old-captured" ? "withdrawn" : "captured");
        assert.equal(record.text, id === "old-captured" ? null : `合成历史验证 ${id}`, "authenticated fixture text must match");
      }
      cursor = page.cursor;
    } while (cursor);
    assert.equal(seen.size, expectedCapacity.records_used); assert.deepEqual(seen, new Set(expected.keys()));
    for (const id of ["old-captured", "old-uncaptured", "stream-1", `stream-${streamCount}`]) {
      const record = await port.readExact(reference(id));
      assert.equal(record?.text, id === "old-captured" ? null : `合成历史验证 ${id}`, "exact read must match the paged fixture");
      assert.equal(record?.message_ref, reference(id));
    }
    const late = await port.readRegisteredExact(reference("old-uncaptured"));
    const last = await port.readRegisteredExact(reference(`stream-${streamCount}`));
    assert.equal(late.registration.sequence, 1); assert.equal(last.registration.sequence, streamCount + 2);
    assert.equal(late.registration.producer_epoch, last.registration.producer_epoch);
    assert.equal(last.registration.carrier_id, "desktop-history-e2"); assert.equal(last.registration.plan_id, `plan-stream-${streamCount}`);
    assert.equal(await port.readExact(reference("old-sealed")), null);
    assert.equal(await port.readExact(reference(`stream-${streamCount + 1}`)), null);
    assert.deepEqual(await port.capacitySnapshot(), expectedCapacity);
    checkpoint("retained-main3-authenticated-history-read", { authenticated: true, pageLimit: 31, pageSizes,
      exactRecords: seen.size, everyRecordTextChecked: true, selectedExactReads: 4, registeredIdentityReads: 2,
      oldWithdrawnTextNull: true, sealedAndUncapturedAbsent: true, capacityUnchanged: true, newMessages: 0,
      readerGeneration, stressCapture513Verified: false,
      reader: "Core branded normal-v3 runtime port after Desktop host close; no Runtime pagination endpoint" });
  });
  assert.equal(hash(fs.readFileSync(sourceFile)), sourceHash, "the original pressure failure must remain unchanged");
  report.recovery.originalReportUnchanged = true;
  if (paginationOnly) {
    assert.equal(hash(fs.readFileSync(priorRecoveryFile)), priorRecoveryHash, "the failed recovery report must remain unchanged");
    report.recovery.priorRecoveryUnchanged = true;
  }
}

try {
  if (recovery) {
    await recoverRetainedFixture(); report.status = "passed";
  } else {
  const stateRoot = fresh("edupi-desktop-history-state-"); report.roots.state = stateRoot;
  const targets = ["main1", "main3"].map(label => {
    const dataRoot = fresh(`edupi-desktop-history-${label}-`), stateDir = path.join(stateRoot, `${label}-state`), agentDir = path.join(stateRoot, `${label}-agent`);
    for (const directory of [stateDir, agentDir]) fs.mkdirSync(directory, { mode: 0o700 });
    report.roots[label] = dataRoot;
    return { label, dataRoot, stateDir, agentDir, conversationId: `synthetic-desktop-history-${label}`, grantId: `history-${label}-grant`, occurredAt: new Date().toISOString() };
  });
  configureRoot(targets[0].dataRoot, targets[0].stateDir, targets[0].agentDir); checkpoint("fresh-isolated-roots", { roots: report.roots });
  const jiti = createJiti(import.meta.url, { tsconfigPaths: true });
  supervisor = await jiti.import(path.join(desktopRoot, "lib/edupi-runtime-supervisor.ts"));
  const snapshots = await jiti.import(path.join(desktopRoot, "lib/edupi-core-snapshot.ts"));
  const ownerTokens = await jiti.import(path.join(desktopRoot, "lib/edupi-owner-control-token.ts"));
  const [main1, main3] = targets;
  let session = await seed(main1, snapshots);
  await exerciseLateAndSeal(session.host, main1, await call(session.host, "health", null));
  const main1Before = await call(session.host, "health", null); await session.host.close();
  session = await startTarget(main1, snapshots); await verifyOwner(session.host, main1);
  assert.deepEqual(session.health.owner_message_capacity, main1Before.owner_message_capacity);
  assert.equal(session.health.owner_message_capacity.record_limit, 128); assert.equal(session.health.owner_message_capacity.gate_entry_limit, 128);
  assert.equal((await intent(session.host, main1, main1.withdrawal.message_ref)).status, "withdrawn");
  assert.ok(session.health.fencing_generation > main1Before.fencing_generation);
  assert.notEqual(session.health.instance_nonce, main1Before.instance_nonce);
  checkpoint("main1-host-cold-restart", { ownerId: main1.ownerId, rootRef: main1.rootRef,
    capacity: session.health.owner_message_capacity, generation: session.health.fencing_generation });
  await session.host.close();

  // The fixture helper upgrades a legacy capture gate. It is not a general
  // installer migration for an already registered Main1 v2 gate.
  session = await seed(main3, snapshots, { registered: false }); await session.host.close();
  configureRoot(main3.dataRoot, main3.stateDir, main3.agentDir); stage = "main3-test-fixture-migration";
  const ownerControlToken = ownerTokens.loadOwnerControlToken(main3.stateDir, main3.dataRoot);
  const loadCore = relative => import(pathToFileURL(path.join(coreRoot, "scripts", relative)).href);
  const { migrateCoreOwnerHistoryForTest } = await loadCore("test_core_runtime_v3_support.mjs");
  await migrateCoreOwnerHistoryForTest({ dataRoot: main3.dataRoot, ownerControlToken });
  checkpoint("main3-test-fixture-activated", { dataRoot: main3.dataRoot, testFixture: true,
    helper: "test_core_runtime_v3_support.mjs:migrateCoreOwnerHistoryForTest", productionMigration: false });
  session = await startTarget(main3, snapshots); await verifyOwner(session.host, main3);
  assert.equal(session.health.owner_message_capacity.storage, "sqlite_stream_v1");
  for (const key of ["record_limit", "gate_entry_limit", "limiting_factor"]) assert.equal(session.health.owner_message_capacity[key], null);
  main3.late = await register(session.host, main3, "old-uncaptured"); main3.sealed = await register(session.host, main3, "old-sealed");
  await exerciseLateAndSeal(session.host, main3, session.health);
  checkpoint("main3-normal-host-selected", { ownerId: main3.ownerId, rootRef: main3.rootRef, capacity: session.health.owner_message_capacity,
    oldRegistrationCapture: true, sealedAbsentReplay: true, withdrawnReplay: true });
  const stream = [];
  for (let index = 1; index <= streamCaptureCount; index++) {
    const id = `stream-${index}`, registration = await register(session.host, main3, id);
    const result = await captured(session.host, main3, id, registration);
    assert.equal(registration.replayed, false); assert.equal(result.replayed, false);
    assert.equal(result.receipt.external_send, false); stream.push({ id, registration, result });
    if (index === 1 || index % 128 === 0 || index === streamCaptureCount) checkpoint("main3-stream-capture", { actualStreamCaptures: index,
      capacity: (await call(session.host, "health", null)).owner_message_capacity });
  }
  const last = stream.at(-1), before = await call(session.host, "health", null);
  assert.equal(before.owner_message_capacity.records_used, streamCaptureCount + 2); assert.equal(before.owner_message_capacity.gate_entries_used, streamCaptureCount + 3);
  report.boundaries.capture513Verified = stress;
  assert.equal((await captured(session.host, main3, last.id, last.registration)).replayed, true);
  assert.equal((await register(session.host, main3, "old-uncaptured")).sequence, main3.late.sequence);
  assert.deepEqual((await call(session.host, "health", null)).owner_message_capacity, before.owner_message_capacity);
  await session.host.close(); stage = "main3-authenticated-pagination";
  await withAuthenticatedHistoryReader(main3.dataRoot, ownerControlToken, async port => {
    const seen = [], pages = [], pageLimit = stress ? 31 : 7; let cursor = null;
    do {
      const page = await port.readRecordPage({ cursor, limit: pageLimit });
      seen.push(...page.records.map(record => record.message_ref)); pages.push(page.records.length); cursor = page.cursor;
      signal.signal.throwIfAborted();
    } while (cursor);
    assert.equal(seen.length, streamCaptureCount + 2); assert.equal(new Set(seen).size, streamCaptureCount + 2);
    assert.deepEqual(new Set(seen), new Set([main3.old.receipt.receipt.message_ref, main3.late.message_ref, ...stream.map(item => item.registration.message_ref)]));
    const old = await port.readExact(main3.old.receipt.receipt.message_ref);
    assert.equal(old.status, "withdrawn"); assert.equal(old.text, null);
    assert.equal((await port.readExact(main3.late.message_ref)).text, capture(main3, "old-uncaptured").text, "old registered text must read back exactly");
    assert.equal((await port.readExact(last.registration.message_ref)).text, capture(main3, last.id).text, "final text must read back exactly");
    assert.equal(await port.readExact(main3.sealed.message_ref), null);
    checkpoint("main3-full-authenticated-pagination", { pageLimit, pageSizes: pages, exactRecords: seen.length,
      uniqueRecords: new Set(seen).size, withdrawnTextNull: true, oldRegisteredTextExact: true, finalCaptureTextExact: true,
      stressCapture513Verified: stress,
      reader: "Core branded normal-v3 runtime port after Desktop host close; no Runtime pagination endpoint" });
  });
  session = await startTarget(main3, snapshots); await verifyOwner(session.host, main3);
  assert.deepEqual(session.health.owner_message_capacity, before.owner_message_capacity);
  assert.ok(session.health.fencing_generation > before.fencing_generation); assert.notEqual(session.health.instance_nonce, before.instance_nonce);
  assert.equal((await intent(session.host, main3, last.registration.message_ref)).status, "current");
  assert.equal((await intent(session.host, main3, main3.withdrawal.message_ref)).status, "withdrawn");
  assert.equal((await captured(session.host, main3, last.id, last.registration)).replayed, true);
  await call(session.host, "owner_message_settle", main3.sealedInput, "stale_binding");
  assert.equal((await call(session.host, "owner_message_settle", settleInput(main3, "old-sealed", main3.sealed, session.health))).replayed, true);
  assert.equal((await register(session.host, main3, "old-uncaptured")).producer_epoch, main3.late.producer_epoch);
  assert.deepEqual((await call(session.host, "health", null)).owner_message_capacity, before.owner_message_capacity);
  assert.equal(session.health.queue.total, 0); assert.equal(report.modelRequests, 0);
  checkpoint("main3-real-host-cold-restart", { ownerId: main3.ownerId, rootRef: main3.rootRef, capacity: session.health.owner_message_capacity,
    priorGeneration: before.fencing_generation, generation: session.health.fencing_generation,
    nonceChanged: true, identityRetained: true, registrationRetained: true, staleSettleRejected: true, replayCountsUnchanged: true });
  await session.host.close(); report.status = "passed";
  }
} catch (error) {
  report.status = "failed";
  report.failure = lastFailure || { name: error?.name || "Error", code: error?.code || null,
    frames: String(error?.stack || "").split("\n").filter(line => /^\s+at /u.test(line)).slice(0, 8) };
  report.stage = stage;
} finally {
  clearTimeout(watchdog); clearTimeout(hardStop);
  await supervisor?.closeAllEduPiRuntimes();
  report.runtimeClosed = children.size === 0 && report.processes.every(child => child.closed);
  report.finishedAt = new Date().toISOString();
  childProcess.fork = originalFork; syncBuiltinESMExports(); globalThis.fetch = originalFetch;
  if (!report.runtimeClosed || report.modelRequests !== 0) report.status = "failed";
  write(); console.log(JSON.stringify({ status: report.status, evidence: reportFile, progress: progressFile,
    roots: report.roots, modelRequests: report.modelRequests, runtimeClosed: report.runtimeClosed,
    ...(report.failure ? { stage: report.stage, failure: report.failure } : {}) }));
  process.exitCode = report.status === "passed" ? 0 : 1;
}
