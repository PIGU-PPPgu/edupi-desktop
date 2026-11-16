#!/usr/bin/env node
import assert from "node:assert/strict";
import childProcess from "node:child_process";
import crypto from "node:crypto";
import fs from "node:fs";
import { syncBuiltinESMExports } from "node:module";
import os from "node:os";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

export const CORE_COMMIT = "98e4f7cd0c31dd30954574d2040bb1b948cdd954";
export const ROOT_PREFIX = "edupi-route1-canary-l4-116-20261117-";
const desktopRoot = fileURLToPath(new URL("..", import.meta.url));
const hash = bytes => `sha256:${crypto.createHash("sha256").update(bytes).digest("hex")}`;
const check = (value, code) => { if (!value) throw Object.assign(new Error(code), { code }); };
const dayAt = offset => new Intl.DateTimeFormat("en-CA", {
  timeZone: "Asia/Shanghai", year: "numeric", month: "2-digit", day: "2-digit",
}).format(new Date(Date.now() + offset * 86_400_000));

export function parseArguments(args) {
  if (args.length === 1 && args[0] === "--help") return { help: true };
  const result = {};
  for (let i = 0; i < args.length; i++) {
    const flag = args[i];
    check(["--create", "--core-root", "--evidence-dir"].includes(flag), "unknown_argument");
    const key = flag.slice(2);
    check(!Object.hasOwn(result, key), "duplicate_argument");
    if (flag === "--create") result[key] = true;
    else {
      const value = args[++i];
      check(typeof value === "string" && path.isAbsolute(value) && !value.startsWith("--"), "absolute_path_required");
      result[key] = value;
    }
  }
  check(result.create && result["core-root"] && result["evidence-dir"], "explicit_create_core_and_evidence_required");
  return { create: true, coreRoot: result["core-root"], evidenceDir: result["evidence-dir"] };
}

function canonicalDirectory(directory) {
  const stat = fs.lstatSync(directory);
  check(stat.isDirectory() && !stat.isSymbolicLink() && fs.realpathSync(directory) === directory, "canonical_directory_required");
  return directory;
}

export function writeExclusiveJson(file, value) {
  fs.writeFileSync(file, `${JSON.stringify(value, null, 2)}\n`, { flag: "wx", mode: 0o600 });
}

export function nativeFixturePaths(home, root, appConfigRoot) {
  check(path.isAbsolute(home) && path.isAbsolute(root) && path.isAbsolute(appConfigRoot), "absolute_path_required");
  check(path.dirname(root) === home && root === path.normalize(root)
    && /^edupi-route1-canary-[a-z0-9-]{1,80}$/u.test(path.basename(root))
    && new RegExp(`^${ROOT_PREFIX}[a-f0-9]{24}$`, "u").test(path.basename(root)), "exclusive_home_child_required");
  const stateDir = path.join(appConfigRoot, "route1-isolated", path.basename(root));
  check(!stateDir.startsWith(`${root}${path.sep}`) && !root.startsWith(`${stateDir}${path.sep}`), "state_must_be_separate");
  return { root, stateDir, agentDir: path.join(root, ".edupi", "agent") };
}

/** Only allocates new directories; an existing root or evidence leaf is never adopted. */
export function allocateFixture({ home, appConfigRoot, evidenceDir }) {
  canonicalDirectory(home);
  canonicalDirectory(appConfigRoot);
  canonicalDirectory(path.dirname(evidenceDir));
  check(path.isAbsolute(evidenceDir) && evidenceDir === path.normalize(evidenceDir), "canonical_evidence_path_required");
  const isolatedState = path.join(appConfigRoot, "route1-isolated");
  try { canonicalDirectory(isolatedState); }
  catch (error) { if (error.code !== "ENOENT") throw error; }
  // Reserve evidence first. A repeat command cannot even allocate a second data root.
  fs.mkdirSync(evidenceDir, { mode: 0o700 });
  canonicalDirectory(evidenceDir);
  // mkdtemp's mixed-case alphabet is rejected by the unchanged native guard.
  const root = path.join(home, `${ROOT_PREFIX}${crypto.randomBytes(12).toString("hex")}`);
  fs.mkdirSync(root, { mode: 0o700 });
  const fixture = nativeFixturePaths(home, root, appConfigRoot);
  try { fs.mkdirSync(isolatedState, { mode: 0o700 }); }
  catch (error) { if (error.code !== "EEXIST") throw error; }
  canonicalDirectory(isolatedState);
  fs.mkdirSync(fixture.stateDir, { mode: 0o700 });
  const edupiHome = path.join(root, ".edupi");
  fs.mkdirSync(edupiHome, { mode: 0o700 });
  for (const name of ["memory", "output", "locks", "agent"]) fs.mkdirSync(path.join(edupiHome, name), { mode: 0o700 });
  for (const directory of [root, fixture.stateDir, fixture.agentDir]) {
    canonicalDirectory(directory);
    const stat = fs.lstatSync(directory);
    check((stat.mode & 0o777) === 0o700 && stat.uid === process.getuid(), "private_owned_directory_required");
  }
  return { ...fixture, evidenceDir };
}

/** Intercept before the normal model-host listener can read configuration or run a provider. */
export function blockSeedModelRequests(child, counters) {
  const originalEmit = child.emit;
  child.emit = function (event, message, ...rest) {
    if (event === "message" && ["model-run", "model-config-request"].includes(message?.type)) {
      const configuration = message.type === "model-config-request";
      counters[configuration ? "modelConfigurationRequests" : "modelRequests"]++;
      if (child.connected) child.send({
        type: configuration ? "model-config-error" : "model-error", id: message.id, code: "model_unavailable",
      }, () => {});
      return true;
    }
    return originalEmit.call(this, event, message, ...rest);
  };
}

function git(repo, args) {
  return childProcess.execFileSync("git", ["-C", repo, ...args], {
    encoding: "utf8", timeout: 15_000, stdio: ["ignore", "pipe", "pipe"],
  }).trim();
}

function verifyCore(coreRoot) {
  canonicalDirectory(coreRoot);
  check(git(coreRoot, ["rev-parse", "HEAD"]) === CORE_COMMIT, "fixed_core98_required");
  check(git(coreRoot, ["status", "--porcelain", "--untracked-files=all"]) === "", "frozen_core_must_be_clean");
  const compat = JSON.parse(fs.readFileSync(path.join(desktopRoot, "contracts/edupi-core-compat.json"), "utf8")).core_runtime;
  check(compat.core_commit === CORE_COMMIT, "desktop_core98_pin_required");
  for (const [file, expected] of [
    [compat.component_manifest_path, compat.component_manifest_hash],
    ["contracts/edupi-core-runtime-component-manifest.json", compat.runtime_component_manifest_hash],
  ]) {
    check(JSON.parse(fs.readFileSync(path.join(coreRoot, file), "utf8")).component_manifest_hash === expected, "core_manifest_mismatch");
  }
  return compat;
}

async function migrateV3(loadCore, dataRoot, ownerControlToken) {
  const { prepareCoreRuntimeRoot } = await loadCore("core_runtime_root.mjs");
  const admission = await loadCore("core_runtime_writer_admission.mjs");
  const store = await loadCore("core_runtime_store.mjs");
  const { createAmbientAuthorizationStore } = await loadCore("ambient_authorization_store.mjs");
  const { createAmbientConversationStore } = await loadCore("ambient_conversation_store.mjs");
  const { activateCoreOwnerHistoryV3 } = await loadCore("core_owner_history_v3_store.mjs");
  const root = prepareCoreRuntimeRoot(dataRoot);
  let lease = await admission.acquireCoreRuntimeWriterAdmission({ root, kind: "daemon" }), runtime;
  try {
    const nonce = crypto.randomUUID();
    runtime = await store.createCoreRuntimeStore({
      dataRoot, supervisorSessionId: nonce, instanceNonce: nonce, processStartEvidence: nonce,
    });
    runtime.setLifecycle("ready");
    const key = purpose => crypto.createHmac("sha256", Buffer.from(ownerControlToken, "base64url"))
      .update(`edupi.owner.${purpose}.mac-key.v1\0${root.dataRootFingerprint}`).digest();
    const authorizationStore = createAmbientAuthorizationStore({ root, macKey: key("authorization") });
    const conversation = createAmbientConversationStore({ root, authorizationStore, runtimeStore: runtime, macKey: key("conversation") });
    runtime.setLifecycle("draining");
    const baseline = conversation.prepareMigrationBaseline();
    runtime.release(); runtime.close(); runtime = null;
    await lease.release();
    lease = await admission.acquireCoreRuntimeWriterAdmission({ root, kind: "daemon" });
    admission.prepareCoreRuntimeWriterAdmissionV2TransitionStoragePrimitive(lease).commit();
    lease = await admission.acquireCoreRuntimeWriterAdmissionV2Migration({ root });
    const options = { root, admissionLease: lease, ownerControlToken };
    (await store.prepareCoreRuntimeSchemaV2Transition({ root, admissionLease: lease, baseline })).commit();
    await store.advanceCoreOwnerGateV2Upgrade(options);
    const plan = await store.buildCoreOwnerHistoryV3SchemaReadyPlan(options);
    await store.transitionCoreOwnerHistoryV3Schema({ ...options, plan });
    await store.publishCoreOwnerHistoryV3SQLiteCandidate(options);
    check((await activateCoreOwnerHistoryV3(options)).status === "active", "v3_migration_inactive");
  } finally {
    try { if (runtime) { runtime.release(); runtime.close(); } }
    finally { await lease.release(); }
  }
}

async function migrateMain4(loadCore, dataRoot, ownerControlToken) {
  const { DatabaseSync } = await import("node:sqlite");
  const { prepareCoreRuntimeRoot } = await loadCore("core_runtime_root.mjs");
  const admission = await loadCore("core_runtime_writer_admission.mjs");
  const { createCoreRuntimeMigrationQuiescenceProof } = await loadCore("core_runtime_migration_quiescence.mjs");
  const { migrateCoreRuntimePlanningV4 } = await loadCore("core_runtime_store.mjs");
  const root = prepareCoreRuntimeRoot(dataRoot);
  const authority = () => {
    const db = new DatabaseSync(root.databasePath, { readOnly: true });
    try {
      const value = { ...db.prepare("SELECT * FROM authority WHERE singleton=1").get() };
      return { root_ref: root.dataRootFingerprint, fencing_generation: value.fencing_generation, authority: value };
    } finally { db.close(); }
  };
  let lease = await admission.acquireCoreRuntimeWriterAdmissionV3Runtime({ root, kind: "daemon", ownerControlToken });
  try {
    const before = authority();
    const proof = createCoreRuntimeMigrationQuiescenceProof({
      rootRef: before.root_ref, generation: before.fencing_generation,
      authority: before.authority, admissionLease: lease, checkCurrent: authority,
    });
    admission.prepareCoreRuntimeWriterAdmissionV3Transition(lease, proof).commit();
    lease = await admission.acquireCoreRuntimeWriterAdmissionV3Migration({ root });
    const result = await migrateCoreRuntimePlanningV4({ root, admissionLease: lease, ownerControlToken });
    check(result.status === "active" && result.schema_version === 4, "main4_migration_inactive");
  } finally { await lease.release(); }
}

async function seedSources(loadCore, dataRoot) {
  const { prepareCoreRuntimeRoot } = await loadCore("core_runtime_root.mjs");
  const { acquireCoreRuntimeWriterAdmission } = await loadCore("core_runtime_writer_admission.mjs");
  const facts = await loadCore("education_fact_store.mjs");
  const root = prepareCoreRuntimeRoot(dataRoot);
  check(root.ok, "synthetic_root_unavailable");
  const lease = await acquireCoreRuntimeWriterAdmission({ root, kind: "legacy_native_l4_synthetic_seed" });
  try {
    const memoryDir = path.join(dataRoot, ".edupi/memory"), now = new Date().toISOString();
    const entity = (kind, name) => facts.registerEducationEntity({ memoryDir, now, entity: {
      entity_kind: kind, namespace: "synthetic-native-l4-116", external_id: kind,
      canonical_name: name, aliases: [],
    } }).entity;
    const classroom = entity("class", "合成验收班-L4-116"), term = entity("term", "合成验收学期-L4-116");
    const student = entity("student", "合成学生-L4-116-甲"), parent = entity("parent", "合成家长-L4-116-甲");
    const calendarEvent = entity("calendar_event", "合成行政截止-L4-116");
    const sourceFact = (entityId, sourceId, kind, predicate, text, entityIds, subject = null) => {
      const observation = facts.captureEducationObservation({ memoryDir, now, observation: {
        source_kind: kind, source_id: sourceId, source_revision: "1", raw_text: text,
        observed_at: now, actor_ref: "synthetic-native-l4-teacher", entity_ids: entityIds,
      } }).observation;
      const proposed = facts.proposeEducationFact({ memoryDir, now, fact: {
        entity_id: entityId, fact_kind: "evidence", predicate, value: text,
        subject_ref: subject, confidence: { basis: "explicit", score: 1 },
        source_ids: [sourceId], observation_ids: [observation.observation_id],
      } }).fact;
      return facts.reviewEducationFact({ memoryDir, now, fact_id: proposed.fact_id,
        expected_revision: proposed.revision, decision: "accept", reviewer: "synthetic-native-l4-teacher" }).fact;
    };
    const deadlineAt = new Date(Date.now() + 2 * 86_400_000).toISOString();
    const admin = sourceFact(classroom.entity_id, "synthetic-native-l4-calendar", "calendar", "admin.deadline",
      `合成行政材料截止 ${deadlineAt}`, [classroom.entity_id, term.entity_id, calendarEvent.entity_id]);
    const body = sourceFact(student.entity_id, "synthetic-native-l4-communication", "teacher_utterance", "communication.fact",
      "合成学生-L4-116-甲本周完成合成练习，仅供隔离验收。", [classroom.entity_id, term.entity_id, student.entity_id, parent.entity_id], "math");
    return { classroom, term, student, parent, calendarEvent, admin, body, deadlineAt };
  } finally { await lease.release(); }
}

async function addParentQuestion(loadCore, fixture, ownerControlToken, ownerId, selected) {
  const { prepareCoreRuntimeRoot } = await loadCore("core_runtime_root.mjs");
  const { acquireCoreRuntimeWriterAdmissionV4Runtime } = await loadCore("core_runtime_writer_admission.mjs");
  const facts = await loadCore("education_fact_store.mjs");
  const lease = await acquireCoreRuntimeWriterAdmissionV4Runtime({
    root: prepareCoreRuntimeRoot(fixture.root), kind: "daemon", ownerControlToken,
  });
  try {
    const memoryDir = path.join(fixture.root, ".edupi/memory"), now = new Date().toISOString();
    const observation = facts.captureEducationObservation({ memoryDir, now, observation: {
      source_kind: "teacher_utterance", source_id: "synthetic-native-l4-parent-question", source_revision: "1",
      raw_text: "合成家长-L4-116-甲询问合成学生-L4-116-甲本周的合成练习情况。",
      observed_at: now, actor_ref: ownerId,
      entity_ids: [selected.classroom.entity_id, selected.term.entity_id, selected.student.entity_id, selected.parent.entity_id],
    } }).observation;
    const proposed = facts.proposeEducationFact({ memoryDir, now, fact: {
      entity_id: selected.student.entity_id, fact_kind: "evidence", predicate: "communication.parent_question",
      value: observation.raw_text, subject_ref: "math", confidence: { basis: "explicit", score: 1 },
      source_ids: [observation.source_id], observation_ids: [observation.observation_id],
    } }).fact;
    return facts.reviewEducationFact({ memoryDir, now, fact_id: proposed.fact_id,
      expected_revision: proposed.revision, decision: "accept", reviewer: ownerId }).fact;
  } finally { await lease.release(); }
}

function safeError(error, phase) {
  const candidate = typeof error?.code === "string" ? error.code : error?.name;
  return { phase, code: /^[A-Za-z0-9_]{1,100}$/u.test(candidate || "") ? candidate : "fixture_unavailable" };
}

/**
 * Creates data only. Does not launch the installed App, a browser, a model service,
 * or a chat session. The caller must separately verify native UI acceptance.
 */
export async function createNativeL4Fixture({ create, coreRoot, evidenceDir }) {
  check(create === true, "explicit_create_required");
  check(process.platform === "darwin", "native_fixture_requires_macos");
  check(fs.realpathSync(process.cwd()) === fs.realpathSync(desktopRoot), "run_from_driver_checkout");
  const compat = verifyCore(coreRoot);
  const home = canonicalDirectory(os.homedir());
  const appConfigRoot = path.join(home, "Library/Application Support/com.abcwyc.pi-agent");
  const fixture = allocateFixture({ home, appConfigRoot, evidenceDir });
  const proofFile = path.join(evidenceDir, "native-l4-fixture.json");
  const start = { ...fixture, coreRoot, coreCommit: CORE_COMMIT, desktopCommit: git(desktopRoot, ["rev-parse", "HEAD"]),
    createdAt: new Date().toISOString(), syntheticOnly: true };
  writeExclusiveJson(path.join(evidenceDir, "native-l4-fixture-start.json"), start);
  const counters = { modelRequests: 0, modelConfigurationRequests: 0, deniedParentFetch: 0 };
  const launches = [], children = [], runtimeErrors = [], bridgeFailures = [];
  const originalFork = childProcess.fork, originalFetch = globalThis.fetch;
  const environment = {
    EDUPI_PROJECT_ROOT: fixture.root, EDUPI_DATA_ROOT: fixture.root, EDUPI_DATA_ALLOWED_ROOT: home,
    EDUPI_CORE_ROOT: coreRoot, EDUPI_CORE_ALLOWED_ROOT: path.dirname(coreRoot), EDUPI_CORE_VALIDATION_MODE: "external",
    EDUPI_HOME: path.join(fixture.root, ".edupi"), EDUPI_MEMORY_DIR: path.join(fixture.root, ".edupi/memory"),
    EDUPI_OUTPUT_DIR: path.join(fixture.root, ".edupi/output"), EDUPI_LOCK_DIR: path.join(fixture.root, ".edupi/locks"),
    PI_CODING_AGENT_DIR: fixture.agentDir, PI_DESKTOP_STATE_DIR: fixture.stateDir,
    PI_DESKTOP_API_TOKEN: crypto.randomBytes(32).toString("hex"), PI_OFFLINE: "1",
    EDUPI_DESKTOP_ISOLATED_CANARY: "1", EDUPI_SAFE_MODE: "0", EDUPI_AMBIENT_PLANNING: undefined, TZ: "Asia/Shanghai",
  };
  const previous = new Map(Object.keys(environment).map(key => [key, process.env[key]]));
  let supervisor, phase = "initializing", result, failure;
  try {
    for (const [key, value] of Object.entries(environment)) {
      if (value === undefined) delete process.env[key]; else process.env[key] = value;
    }
    // No credential or live provider configuration is copied from the real agent.
    writeExclusiveJson(path.join(fixture.agentDir, "settings.json"), { packages: [], extensions: [], skills: [] });
    writeExclusiveJson(path.join(fixture.agentDir, "models.json"), { providers: {} });
    childProcess.fork = (file, args, options) => {
      check(path.resolve(file) === path.join(desktopRoot, "desktop/core-runtime-host.mjs")
        && options.env.EDUPI_PROJECT_ROOT === fixture.root && options.cwd === coreRoot, "unexpected_seed_host");
      const child = originalFork(file, args, options);
      children.push(child);
      blockSeedModelRequests(child, counters);
      const launch = { pid: child.pid, exited: false };
      launches.push(launch);
      child.once("close", () => { launch.exited = true; });
      child.on("message", message => {
        if (message?.type === "runtime-error") runtimeErrors.push(safeError({ code: message.code }, phase));
      });
      return child;
    };
    syncBuiltinESMExports();
    globalThis.fetch = async (input, options) => {
      const url = new URL(typeof input === "string" || input instanceof URL ? input : input.url);
      if (url.protocol !== "http:" || !["localhost", "127.0.0.1"].includes(url.hostname)) {
        counters.deniedParentFetch++;
        throw Object.assign(new Error("external_seed_fetch_denied"), { code: "external_seed_fetch_denied" });
      }
      const response = await originalFetch(input, options);
      if (typeof options?.body === "string") {
        const sent = JSON.parse(options.body);
        if (sent.operation === "bridge_call") {
          const received = await response.clone().json();
          if (received.ok === false) {
            const frame = JSON.parse(sent.payload.bridge_frame);
            bridgeFailures.push({
              sequence: bridgeFailures.length + 1, ...safeError({ code: received.error_code }, phase),
              runtimeOperation: "bridge_call", bridgeOperation: frame.operation,
              commandType: frame.envelope?.command?.command_type ?? null,
            });
          }
        }
      }
      return response;
    };
    const { createJiti } = await import("jiti");
    const jiti = createJiti(import.meta.url, { tsconfigPaths: true });
    const loadDesktop = file => jiti.import(path.join(desktopRoot, file));
    const loadCore = file => import(pathToFileURL(path.join(coreRoot, "scripts", file)).href);
    const protocol = await loadCore("core_runtime_protocol.mjs");
    check(protocol.CORE_RUNTIME_SCHEMA_HASH === compat.runtime_schema_hash, "runtime_schema_mismatch");
    const request = (pathname, body) => new Request(`http://localhost${pathname}`, {
      method: body === undefined ? "GET" : "POST",
      headers: { host: "localhost", origin: "http://localhost", "sec-fetch-site": "same-origin",
        "content-type": "application/json", "x-pi-desktop-token": environment.PI_DESKTOP_API_TOKEN },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    });
    const json = async response => {
      const body = await response.json();
      check(response.status === 200 || response.status === 202, `api_${response.status}_${/^[a-z_]+$/u.test(body.code || "") ? body.code : "unavailable"}`);
      check(body.externalSend !== true && body.receipt?.external_send !== true, "external_send_not_permitted");
      return body;
    };
    phase = "synthetic-sources";
    const selected = await seedSources(loadCore, fixture.root);
    const rootsModule = await loadDesktop("lib/edupi-core-snapshot.ts");
    supervisor = await loadDesktop("lib/edupi-runtime-supervisor.ts");
    const activation = await loadDesktop("app/api/edupi/proactivity/route.ts");
    const questionRoute = await loadDesktop("app/api/edupi/proactivity/parent-question-recipient/route.ts");
    const questionClient = await loadDesktop("lib/edupi-parent-question-recipient-client.ts");
    const { loadOwnerControlToken } = await loadDesktop("lib/edupi-owner-control-token.ts");
    const roots = rootsModule.resolveEduPiBridgeRoots();
    const readActivation = async domain => json(await activation.GET(request(`/api/edupi/proactivity?domain=${domain}`)));
    const entries = async () => questionClient.parseParentQuestionRecipientEntries(
      await json(await questionRoute.GET(request("/api/edupi/proactivity/parent-question-recipient"))));
    phase = "owner-bootstrap";
    let host = await supervisor.ensureEduPiRuntime(roots);
    const health = await host.call("health", null);
    check(health.ok, "seed_health_unavailable");
    const rootRef = health.result.data_root_fingerprint;
    const bootstrapped = await host.callOwnerControl("owner_control", {
      command_id: "synthetic-native-l4-bootstrap", root_ref: rootRef, expected_owner_id: null, action: "bootstrap",
    });
    check(bootstrapped.ok, "owner_bootstrap_failed");
    await supervisor.closeAllEduPiRuntimes();
    const ownerControlToken = loadOwnerControlToken(fixture.stateDir, fixture.root);
    phase = "v3-migration";
    await migrateV3(loadCore, fixture.root, ownerControlToken);
    phase = "g3-g5-activation";
    for (const [domain, subject] of [["calendar_administration", "administration"], ["parent_communication", "math"]]) {
      const state = await readActivation(domain);
      check(state.activation.enabled === false
        && state.scopes.some(scope => scope.classId === selected.classroom.entity_id && scope.subject === subject && scope.ready), "synthetic_scope_not_ready");
      const enabled = await json(await activation.POST(request("/api/edupi/proactivity", {
        domain, enabled: true, classId: selected.classroom.entity_id, subject, expectedUpdatedAt: state.activation.updatedAt,
      })));
      check(enabled.activation.enabled && enabled.limits.maxModelCalls === 0, "zero_model_activation_required");
    }
    await supervisor.closeAllEduPiRuntimes();
    check(launches.every(item => item.exited), "seed_hosts_running_before_migration");
    phase = "main4-migration";
    await migrateMain4(loadCore, fixture.root, ownerControlToken);
    host = await supervisor.ensureEduPiRuntime(roots);
    const ownerRead = await host.callOwnerControl("owner_read", { root_ref: rootRef });
    check(ownerRead.ok && ownerRead.result.owner?.id, "owner_read_unavailable");
    await supervisor.closeAllEduPiRuntimes();
    phase = "g5-question";
    const question = await addParentQuestion(loadCore, fixture, ownerControlToken, ownerRead.result.owner.id, selected);
    check((await entries()).length === 0, "question_must_require_grant_refresh");
    await json(await activation.POST(request("/api/edupi/proactivity",
      questionClient.parentQuestionRefreshInput(await readActivation("parent_communication")))));
    const pending = await entries();
    check(pending.length === 1 && pending[0].status === "needs_confirmation"
      && pending[0].questionFactId === question.fact_id
      && pending[0].candidate.student_id === selected.student.entity_id
      && pending[0].candidate.recipient_id === selected.parent.entity_id
      && pending[0].candidate.confirmed_fact_id === null && pending[0].candidate.message_ref === null, "g5_not_pending_confirmation");
    // Intentionally no confirmation, cancellation, task review, or synthetic chat.
    phase = "g3-draft-readback";
    let snapshot, g3;
    const deadline = performance.now() + 70_000;
    do {
      snapshot = await rootsModule.readEduPiEducationSnapshot({ roots });
      g3 = snapshot.payload.work_cases.filter(item => item.case_kind === "capability_package"
        && item.trigger_id?.startsWith("source_admin_"));
      if (g3.length === 1 && g3[0].current_state === "draft_ready" && g3[0].artifacts.length === 3) break;
      await new Promise(resolve => setTimeout(resolve, 150));
    } while (performance.now() < deadline);
    check(g3.length === 1 && g3[0].current_state === "draft_ready" && g3[0].artifacts.length === 3, "g3_draft_unavailable");
    const task = snapshot.workspace.tasks.find(item => item.task_id === g3[0].task_id);
    check(task && (!task.review_history || task.review_history.length === 0)
      && !task.reviewed_at && !["accepted", "rejected", "hold", "modified"].includes(task.status), "g3_must_be_unreviewed");
    const artifacts = g3[0].artifacts.map(artifact => {
      const file = path.resolve(fixture.root, artifact.relative_path);
      check(file.startsWith(`${environment.EDUPI_OUTPUT_DIR}${path.sep}`)
        && fs.realpathSync(file) === file && artifact.external_send === false, "artifact_not_isolated");
      const bytes = fs.readFileSync(file);
      check(bytes.length > 0 && hash(bytes) === artifact.sha256, "artifact_readback_mismatch");
      return { id: artifact.artifact_id, relativePath: artifact.relative_path, sha256: artifact.sha256, sizeBytes: bytes.length };
    });
    check(!snapshot.payload.work_cases.some(item => item.trigger_id === pending[0].candidate.case_id), "g5_must_not_have_a_preconfirmed_case");
    phase = "recurring-templates";
    const tasks = await loadDesktop("app/api/edupi/tasks/route.ts");
    const recurring = await seedRecurringTemplates({ tasks, request, readActivation, bridgeFailures });
    phase = "restart-readback";
    await supervisor.closeAllEduPiRuntimes();
    // Explicit roots suppress readEduPiEducationSnapshot's automatic ensure.
    // Start the new managed host before asking for its source-case projection.
    await supervisor.ensureEduPiRuntime(roots);
    const restarted = await rootsModule.readEduPiEducationSnapshot({ roots });
    check(restarted.payload.work_cases.some(item => item.work_case_id === g3[0].work_case_id
      && item.current_state === "draft_ready" && item.artifacts.length === 3), "g3_restart_readback_failed");
    assert.deepEqual(await entries(), pending, "G5 must remain pending after a real host restart");
    for (const template of recurring.templates) {
      check(restarted.workspace.tasks.some(item => item.task_id === template.taskId), "template_restart_readback_failed");
    }
    const spine = restarted.workspace.fact_spine;
    check(!spine.accepted_facts.some(fact => fact.predicate.startsWith("lesson.")
      || fact.predicate === "communication.recipient_confirmed"), "unexpected_g4_or_recipient_fact");
    const { DatabaseSync } = await import("node:sqlite");
    const db = new DatabaseSync(path.join(environment.EDUPI_HOME, "runtime/core-runtime-v1.sqlite"), { readOnly: true });
    let storage;
    try {
      check(db.prepare("PRAGMA quick_check").get().quick_check === "ok"
        && db.prepare("PRAGMA foreign_key_check").get() === undefined
        && db.prepare("PRAGMA user_version").get().user_version === 4
        && db.prepare("SELECT schema_version FROM authority WHERE singleton=1").get().schema_version === 4, "main4_readback_failed");
      storage = { schemaVersion: 4, quickCheck: "ok", foreignKeyCheck: "ok" };
    } finally { db.close(); }
    result = { status: recurring.status === "blocked" ? "prepared-g3-g5-recurring-blocked" : "prepared-isolated-native-l4-fixture",
      complete: recurring.status !== "blocked", ...start, storage,
      environment: { node: process.version, platform: process.platform, arch: process.arch },
      bundledCoreCommitRequired: CORE_COMMIT, seedCoreValidationMode: "external",
      g3: { status: "draft_ready", teacherReview: "pending", restartReadback: true, factId: selected.admin.fact_id,
        workCaseId: g3[0].work_case_id, taskId: task.task_id, artifacts },
      g5: { status: "needs_confirmation", restartReadback: true, questionFactId: question.fact_id, caseId: pending[0].candidate.case_id,
        studentId: selected.student.entity_id, recipientId: selected.parent.entity_id },
      recurring, classId: selected.classroom.entity_id, termId: selected.term.entity_id,
      nativeLaunchEnvironment: { EDUPI_DATA_ROOT: fixture.root, EDUPI_PROJECT_ROOT: fixture.root, EDUPI_ROUTE1_ISOLATED_CANARY: "1" },
      productionMigration: false, realTeacherDataWritten: false, externalSend: false,
      unverified: ["signed App native UI", "G3 review and notification interaction", "G5 recipient confirmation and subsequent review",
        "recurring activation, natural due dates and native pause/resume", "real model and teaching content quality"] };
    verifyCore(coreRoot);
  } catch (error) { failure = safeError(error, phase); }
  finally {
    try { if (supervisor) await supervisor.closeAllEduPiRuntimes(); }
    catch (error) { failure ||= safeError(error, "close-seed-hosts"); }
    // The supervisor normally owns termination. Kill only this driver's children if its close failed.
    for (const child of children) {
      if (child.exitCode !== null || child.signalCode !== null) continue;
      try {
        const closed = new Promise(resolve => child.once("close", resolve));
        child.kill("SIGKILL");
        let timer;
        try { await Promise.race([closed, new Promise(resolve => { timer = setTimeout(resolve, 3000); })]); }
        finally { clearTimeout(timer); }
      } catch (error) { failure ||= safeError(error, "terminate-seed-host"); }
    }
    for (const [key, value] of previous) {
      if (value === undefined) delete process.env[key]; else process.env[key] = value;
    }
    globalThis.fetch = originalFetch; childProcess.fork = originalFork; syncBuiltinESMExports();
  }
  const remaining = launches.filter(item => {
    if (item.exited) return false;
    try { process.kill(item.pid, 0); return true; } catch { return false; }
  }).map(item => item.pid);
  if (remaining.length) failure ||= { phase: "cleanup", code: "seed_hosts_still_running" };
  if (Object.values(counters).some(value => value !== 0)) failure ||= { phase: "model-boundary", code: "unexpected_seed_request" };
  const proof = { ...(result || start), status: failure ? "fixture-preparation-failed" : result.status,
    ...(failure ? { failure } : {}), counters, runtimeErrors, bridgeFailures, seedHosts: launches, remainingSeedHostPids: remaining,
    driverSha256: hash(fs.readFileSync(fileURLToPath(import.meta.url))), evidenceFile: proofFile };
  writeExclusiveJson(proofFile, proof);
  return proof;
}

export async function seedRecurringTemplates({ tasks, request, readActivation, bridgeFailures = [] }) {
  const firstDate = dayAt(1);
  const templates = [], attempts = [];
  for (const cadence of ["weekly", "monthly"]) {
    // Monthly templates deliberately avoid days 29–31, which the official form rejects.
    const dueDate = cadence === "weekly" || Number(firstDate.slice(8)) <= 28 ? firstDate
      : `${firstDate.slice(0, 7)}-28`;
    const monthlyDate = cadence === "monthly" && dueDate < firstDate
      ? new Date(Date.UTC(Number(firstDate.slice(0, 4)), Number(firstDate.slice(5, 7)), 1)).toISOString().slice(0, 10) : dueDate;
    const input = { clientRequestId: crypto.randomUUID(), title: `合成${cadence === "weekly" ? "每周" : "每月"}内部材料-L4-116`,
      dueDate: monthlyDate, note: "合成内部材料验收，不发送。", preparationSource: null,
      recurrence: { kind: "teacher_internal_materials", cadence, untilDate: dayAt(90),
        leadDays: 0, deliverables: ["合成内部议程", "合成材料清单"] } };
    const failureOffset = bridgeFailures.length;
    const response = await tasks.POST(request("/api/edupi/tasks", input)), created = await response.json();
    if (![200, 202].includes(response.status)) {
      const bridgeFailure = bridgeFailures.slice(failureOffset).find(item => item.commandType === "create_task");
      attempts.push({ cadence, status: "blocked", httpStatus: response.status,
        ...safeError({ code: created.code }, "tasks.POST"), firstBridgeFailure: bridgeFailure ?? null });
      continue;
    }
    check(created.receipt.status === "accepted" && created.receipt.external_send === false
      && created.preparation === null && created.taskId === `teacher-task-${input.clientRequestId}`, "recurring_template_not_accepted");
    const replayResponse = await tasks.POST(request("/api/edupi/tasks", input));
    check([200, 202].includes(replayResponse.status), "recurring_replay_unavailable");
    const replay = await replayResponse.json();
    check(replay.replayed === true && replay.taskId === created.taskId, "recurring_template_replay_failed");
    templates.push({ taskId: created.taskId, cadence, dueDate: input.dueDate, recurrence: input.recurrence });
    attempts.push({ cadence, status: "created", httpStatus: response.status });
  }
  const state = await readActivation("teaching_preparation");
  check(state.activation.enabled === false, "recurring_must_remain_disabled");
  return { status: attempts.some(item => item.status === "blocked") ? "blocked" : "templates-created-g1-disabled",
    activationEnabled: false, templates, attempts, firstFailure: attempts.find(item => item.status === "blocked") ?? null,
    contract: { coreCommit: CORE_COMMIT, file: "scripts/core_runtime_daemon.mjs", function: "bridgeCallResult",
      gateLine: 697, rejectionLine: 706, dispatchLine: 715,
      bootstrapOrActivationCanUnlockMain4CreateTask: false },
    limitation: "Core98 selects Main4 from the writer admission schema. Its bridgeCallResult rejects create_task and import_timetable before dispatchBridgeRequest regardless of owner bootstrap, grants or G1 activation. Pre-migration template creation and subsequent Main4 operation are not validated by this driver; no taskboard fallback was used." };
}

if (process.argv[1] && pathToFileURL(path.resolve(process.argv[1])).href === import.meta.url) {
  try {
    const options = parseArguments(process.argv.slice(2));
    if (options.help) console.log("node scripts/create-native-l4-acceptance-fixture.mjs --create --core-root <canonical Core98 checkout> --evidence-dir <new absolute directory>");
    else {
      const proof = await createNativeL4Fixture(options);
      console.log(JSON.stringify({ status: proof.status, root: proof.root, stateDir: proof.stateDir, agentDir: proof.agentDir,
        g3: proof.g3 && { status: proof.g3.status, taskId: proof.g3.taskId, workCaseId: proof.g3.workCaseId },
        g5: proof.g5, recurring: proof.recurring, failure: proof.failure, counters: proof.counters,
        remainingSeedHostPids: proof.remainingSeedHostPids, evidenceFile: proof.evidenceFile }));
      if (proof.status === "fixture-preparation-failed") process.exitCode = 1;
    }
  } catch (error) {
    console.error(JSON.stringify({ status: "fixture-not-created", ...safeError(error, "preflight") }));
    process.exitCode = 1;
  }
}
