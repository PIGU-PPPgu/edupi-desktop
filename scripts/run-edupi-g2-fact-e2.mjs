#!/usr/bin/env node
import assert from "node:assert/strict";
import crypto from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { execFileSync, spawnSync } from "node:child_process";
import { fileURLToPath, pathToFileURL } from "node:url";
import { createJiti } from "jiti";

const desktopRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

function fileHash(file) {
  return `sha256:${crypto.createHash("sha256").update(fs.readFileSync(file)).digest("hex")}`;
}

function invokeFreshCoreSnapshot(coreRoot, environment, requestId) {
  const response = spawnSync(process.execPath, ["--disable-warning=ExperimentalWarning", path.join(coreRoot, "scripts", "desktop_bridge_port.mjs")], {
    cwd: coreRoot,
    encoding: "utf8",
    input: JSON.stringify({ protocol: "edupi-desktop-bridge", protocol_version: 1, producer: "edupi-desktop", operation: "snapshot", request_id: requestId }),
    env: environment,
    timeout: 10_000,
    maxBuffer: 4 * 1024 * 1024,
  });
  assert.equal(response.error, undefined, response.error?.message);
  assert.equal(response.status, 0, response.stderr);
  const frames = response.stdout.trim().split(/\r?\n/u).filter(Boolean);
  assert.equal(frames.length, 1, "fresh Core snapshot must return exactly one frame");
  return JSON.parse(frames[0]);
}

async function consumeDesktopSnapshot(snapshot, dataRoot) {
  const jiti = createJiti(import.meta.url, { moduleCache: false });
  const [consumer, contract] = await Promise.all([
    jiti.import("../lib/edupi-bridge-consumer.ts"),
    jiti.import("../lib/edupi-education-contract.ts"),
  ]);
  const consumed = consumer.consumeCoreEnvelope(snapshot.envelope);
  assert.equal(consumed.ok, true, `Desktop rejected fresh Core envelope: ${JSON.stringify(consumed)}`);
  return contract.buildEducationContractFromWorkspace(consumed.value.education_workspace, {
    workspacePath: dataRoot,
    snapshotPayload: consumed.value,
    supportedCommands: snapshot.supported_commands,
  });
}

async function coreImport(coreRoot, relativePath) {
  return import(pathToFileURL(path.join(coreRoot, relativePath)).href);
}

export async function runEduPiG2FactE2({ coreRoot = process.env.EDUPI_CORE_ROOT } = {}) {
  if (typeof coreRoot !== "string" || !path.isAbsolute(coreRoot)) throw new Error("EDUPI_CORE_ROOT is required");
  const runtimeRoot = fs.realpathSync(coreRoot);
  const compat = JSON.parse(fs.readFileSync(path.join(desktopRoot, "contracts", "edupi-core-compat.json"), "utf8"));
  const commit = execFileSync("git", ["-C", runtimeRoot, "rev-parse", "HEAD"], { encoding: "utf8" }).trim();
  assert.equal(commit, compat.core_runtime.core_commit);

  const parent = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), "edupi-g2-paired-")));
  const dataRoot = path.join(parent, "data");
  const home = path.join(dataRoot, ".edupi");
  const memoryDir = path.join(home, "memory");
  const outputDir = path.join(home, "output");
  const lockDir = path.join(home, "locks");
  for (const directory of [memoryDir, outputDir, lockDir]) fs.mkdirSync(directory, { recursive: true, mode: 0o700 });
  const environmentKeys = ["EDUPI_PROJECT_ROOT", "EDUPI_DATA_ROOT", "EDUPI_HOME", "EDUPI_MEMORY_DIR", "EDUPI_OUTPUT_DIR", "EDUPI_LOCK_DIR", "EDUPI_CORE_COMMIT"];
  const previous = new Map(environmentKeys.map((key) => [key, process.env[key]]));
  Object.assign(process.env, {
    EDUPI_PROJECT_ROOT: dataRoot,
    EDUPI_DATA_ROOT: dataRoot,
    EDUPI_HOME: home,
    EDUPI_MEMORY_DIR: memoryDir,
    EDUPI_OUTPUT_DIR: outputDir,
    EDUPI_LOCK_DIR: lockDir,
    EDUPI_CORE_COMMIT: commit,
  });

  let admission;
  try {
    const rootModule = await coreImport(runtimeRoot, "scripts/core_runtime_root.mjs");
    const admissionModule = await coreImport(runtimeRoot, "scripts/core_runtime_writer_admission.mjs");
    admission = await admissionModule.acquireCoreRuntimeWriterAdmission({ root: rootModule.prepareCoreRuntimeRoot(dataRoot), kind: "legacy_g2_paired_e2", busyTimeoutMs: 250 });
    const store = await coreImport(runtimeRoot, "scripts/education_fact_store.mjs");
    const compiler = await coreImport(runtimeRoot, "scripts/g2_fact_compiler.mjs");
    const projector = await coreImport(runtimeRoot, "scripts/education_fact_projection.mjs");
    const now = "2026-09-07T04:00:00.000Z";
    const sourceId = "g2-paired-source-1";
    const rawText = "刚才讲移项变号，张三听懂了，李四还是不会，赵六上课走神。";
    const definitions = [
      ["student-synthetic-a", "张三"],
      ["student-synthetic-b", "李四"],
      ["student-synthetic-c", "赵六"],
    ];
    const entities = definitions.map(([externalId, name]) => store.registerEducationEntity({
      memoryDir,
      now,
      entity: { entity_kind: "student", namespace: "school-roster", external_id: externalId, canonical_name: name, aliases: [{ namespace: "benchmark", external_id: externalId, value: externalId, source_id: "g2-paired-roster" }] },
    }).entity);
    const roster = entities.map((entity) => ({ student_id: entity.entity_id, name: entity.canonical_name, aliases: entity.aliases.map((alias) => alias.value) }));
    const compiled = compiler.compileG2Utterance({
      memoryDir,
      now,
      message: { source_id: sourceId, source_revision: "1", raw_text: rawText, observed_at: now, actor_ref: "teacher-synthetic-1" },
      roster,
      model_result: {
        status: "ok",
        candidates: [
          { mention: "张三", fact_kind: "progress", predicate: "observed_mastery_signal", value: "移项变号已听懂", evidence_quote: "张三听懂了", confidence: 1 },
          { mention: "李四", fact_kind: "error_pattern", predicate: "observed_needs_verification", value: "移项变号仍需验证", evidence_quote: "李四还是不会", confidence: 1 },
          { mention: "赵六", fact_kind: "behavior", predicate: "observed_attention_signal", value: "课堂注意力观察", evidence_quote: "赵六上课走神", confidence: 1 },
        ],
        unresolved: [],
        external_send: false,
      },
    });
    assert.equal(compiled.facts.length, 3);
    assert.equal(new Set(compiled.facts.map((fact) => fact.entity_id)).size, 3);
    assert.equal(compiled.observation.raw_text, rawText);

    const mastery = compiled.facts.find((fact) => fact.predicate === "observed_mastery_signal");
    const attention = compiled.facts.find((fact) => fact.predicate === "observed_attention_signal");
    const modified = store.modifyEducationFact({ memoryDir, now: "2026-09-07T04:05:00.000Z", fact_id: mastery.fact_id, expected_revision: mastery.revision, replacement_value: "移项变号已听懂，下一课复核一次", reviewer: "teacher-synthetic-1", note: "保留一次复核" }).fact;
    const acceptedAttention = store.reviewEducationFact({ memoryDir, now: "2026-09-07T04:05:00.000Z", fact_id: attention.fact_id, expected_revision: attention.revision, decision: "accept", reviewer: "teacher-synthetic-1", note: "仅记录本次课堂观察" }).fact;
    assert.equal(acceptedAttention.status, "accepted");

    const state = store.loadEducationFactState({ memoryDir });
    const nextLessonFacts = projector.selectNextLessonFacts({ state, student_ids: entities.map((entity) => entity.entity_id), subject_ref: "math", topic_ref: "equation", limit: 20 });
    assert.equal(nextLessonFacts.length, 3);
    store.recordEducationFactUse({ memoryDir, now: "2026-09-07T04:06:00.000Z", use: { use_key: "g2-paired-next-lesson", consumer_kind: "next_lesson", consumer_ref: "lesson-g2-next", fact_ids: nextLessonFacts.map((fact) => fact.fact_id), used_at: "2026-09-07T04:06:00.000Z" } });
    const legacyFile = path.join(memoryDir, "class.json");
    fs.writeFileSync(legacyFile, `${JSON.stringify({ entries: [{ id: "legacy-g2-1", content: "旧版只读记录", meta: { student: "张三" } }], updated_at: now }, null, 2)}\n`, { mode: 0o600 });
    const legacyBefore = fileHash(legacyFile);
    const factFile = store.getEducationFactStateFile({ memoryDir });
    const factBeforeDesktop = fileHash(factFile);

    await admission.release();
    admission = null;
    const snapshotEnvironment = {
      PATH: process.env.PATH,
      LANG: process.env.LANG || "en_US.UTF-8",
      LC_ALL: process.env.LC_ALL || "en_US.UTF-8",
      TZ: process.env.TZ || "Asia/Shanghai",
      NODE_ENV: "test",
      EDUPI_PROJECT_ROOT: dataRoot,
      EDUPI_HOME: home,
      EDUPI_MEMORY_DIR: memoryDir,
      EDUPI_OUTPUT_DIR: outputDir,
      EDUPI_LOCK_DIR: lockDir,
      EDUPI_CORE_COMMIT: commit,
    };
    const firstSnapshot = invokeFreshCoreSnapshot(runtimeRoot, snapshotEnvironment, "g2-paired-snapshot-1");
    assert.equal(firstSnapshot.ok, true);
    const desktopFirst = await consumeDesktopSnapshot(firstSnapshot, dataRoot);
    const expectedIds = nextLessonFacts.map((fact) => fact.fact_id).sort();
    assert.deepEqual(desktopFirst.factSpine.acceptedFacts.map((fact) => fact.factId).sort(), expectedIds);
    assert.ok(desktopFirst.factSpine.studentViews.every((view) => view.acceptedFactIds.every((id) => expectedIds.includes(id))));
    assert.deepEqual(desktopFirst.factSpine.teachingView.acceptedFactIds.sort(), expectedIds);
    assert.deepEqual(desktopFirst.factSpine.nextLessonFactIds.sort(), expectedIds);
    assert.equal(desktopFirst.factSpine.acceptedFacts.some((fact) => fact.factId === mastery.fact_id), false);
    assert.ok(desktopFirst.factSpine.acceptedFacts.some((fact) => fact.factId === modified.fact_id));
    assert.equal(fileHash(factFile), factBeforeDesktop, "Desktop projection is read-only");
    assert.equal(fileHash(legacyFile), legacyBefore, "legacy JSON remains shadow/read-only");

    const secondSnapshot = invokeFreshCoreSnapshot(runtimeRoot, snapshotEnvironment, "g2-paired-snapshot-2");
    const desktopRestart = await consumeDesktopSnapshot(secondSnapshot, dataRoot);
    assert.deepEqual(desktopRestart.factSpine, desktopFirst.factSpine);
    assert.deepEqual(desktopRestart.factSpine.uses[0].factIds.sort(), expectedIds);

    return {
      status: "passed",
      split_students: 3,
      raw_observation_preserved: true,
      modified_fact_shared: true,
      fresh_core_snapshot_processes: 2,
      desktop_envelope_validated: true,
      restart_projection_stable: true,
      canonical_fact_ids: expectedIds,
      desktop_direct_writes: 0,
      legacy_shadow_unchanged: true,
      external_send: false,
    };
  } finally {
    try { await admission?.release(); } finally {
      for (const [key, value] of previous) {
        if (value === undefined) delete process.env[key];
        else process.env[key] = value;
      }
      fs.rmSync(parent, { recursive: true, force: true });
    }
  }
}

if (path.resolve(process.argv[1] || "") === fileURLToPath(import.meta.url)) {
  process.stdout.write(`${JSON.stringify(await runEduPiG2FactE2(), null, 2)}\n`);
}
