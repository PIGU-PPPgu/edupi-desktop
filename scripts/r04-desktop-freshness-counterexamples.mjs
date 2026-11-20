#!/usr/bin/env node
/**
 * Observed Core behavior, no copied Core rules and no mock success responses.
 * P1 and P2 use different newly allocated Main4 roots. Evidence survives cleanup.
 */
import assert from "node:assert/strict";
import crypto from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { parseArgs, isDeepStrictEqual } from "node:util";
import { DatabaseSync } from "node:sqlite";
import { spawn } from "node:child_process";
import { createDesktopR04Fixture, R04_CORE_COMMIT, R04_SOURCE_TEXTS } from "./r04-desktop-acceptance-fixture.mjs";

const hash = bytes => `sha256:${crypto.createHash("sha256").update(bytes).digest("hex")}`;
const write = (file, value) => fs.writeFileSync(file, `${JSON.stringify(value, null, 2)}\n`, { mode: 0o600 });
const stats = file => {
  try {
    const stat = fs.lstatSync(file, { bigint: true });
    return Object.fromEntries(["dev", "ino", "mode", "size", "birthtimeNs", "mtimeNs", "ctimeNs"].map(key => [key, String(stat[key])]));
  } catch (error) { if (error.code === "ENOENT") return null; throw error; }
};
function snapshot(fixture) {
  const db = new DatabaseSync(fixture.root.databasePath, { readOnly: true });
  let tables;
  try {
    tables = Object.fromEntries(db.prepare("SELECT name FROM sqlite_schema WHERE type='table' ORDER BY name").all()
      .map(({ name }) => [name, db.prepare(`SELECT * FROM "${name.replaceAll('"', '""')}"`).all()
        .map(row => JSON.stringify(row)).sort()]));
  } finally { db.close(); }
  const files = {};
  const visit = directory => {
    if (!fs.existsSync(directory)) return;
    for (const entry of fs.readdirSync(directory, { withFileTypes: true }).sort((a, b) => a.name.localeCompare(b.name))) {
      const full = path.join(directory, entry.name);
      if (entry.isDirectory()) visit(full);
      else {
        assert.ok(entry.isFile() && !entry.isSymbolicLink());
        files[path.relative(fixture.dataRoot, full)] = hash(fs.readFileSync(full));
      }
    }
  };
  visit(fixture.environment.EDUPI_MEMORY_DIR); visit(fixture.environment.EDUPI_OUTPUT_DIR);
  const artifacts = {};
  for (const suffix of ["", "-wal", "-shm"]) {
    const full = `${fixture.root.databasePath}${suffix}`;
    artifacts[path.basename(full)] = { stat: stats(full),
      sha256: fs.existsSync(full) ? hash(fs.readFileSync(full)) : null };
  }
  return { at: new Date().toISOString(), artifacts, semanticHash: hash(JSON.stringify({ tables, files })), tables, files };
}
const compare = (before, after) => ({
  semanticsUnchanged: before.semanticHash === after.semanticHash,
  artifacts: Object.fromEntries(Object.keys(before.artifacts).map(name => {
    const first = before.artifacts[name], last = after.artifacts[name];
    return [name, { bytesUnchanged: first.sha256 === last.sha256,
      modeUnchanged: first.stat?.mode === last.stat?.mode, mtimeUnchanged: first.stat?.mtimeNs === last.stat?.mtimeNs,
      ctimeChanged: first.stat?.ctimeNs !== last.stat?.ctimeNs }];
  })),
});

export async function runDesktopR04Counterexamples({ coreRoot, expectedCoreCommit = R04_CORE_COMMIT, evidenceDir, only } = {}) {
  evidenceDir = evidenceDir ? fs.realpathSync(evidenceDir)
    : fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), "edupi-r04-counterexamples-")));
  const reportFile = path.join(evidenceDir, `counterexamples-${crypto.randomUUID()}.json`);
  const report = { version: 1, coreRoot, coreCommit: expectedCoreCommit, startedAt: new Date().toISOString(),
    environment: { node: process.version, platform: process.platform, arch: process.arch, clock: "real" },
    status: "running", syntheticOnly: true, externalProviderCalls: 0, reportFile, checks: {}, cleanup: [] };
  const save = () => write(reportFile, report);
  save();
  if (!only) {
    // Separate OS processes are required because reused Core fixture modules
    // bind legacy environment paths at import. These are ordinary Node
    // subprocesses, not agents, and never inherit a real model configuration.
    for (const check of ["p1", "p2"]) {
      try {
        const stdout = await new Promise((resolve, reject) => {
          const child = spawn(process.execPath, ["--disable-warning=ExperimentalWarning", fileURLToPath(import.meta.url),
            "--core-root", coreRoot, "--core-commit", expectedCoreCommit, "--evidence-dir", evidenceDir, "--only", check],
          { env: { PATH: process.env.PATH, TMPDIR: fs.realpathSync(os.tmpdir()), LANG: "en_US.UTF-8", TZ: "Asia/Shanghai" },
            stdio: ["ignore", "pipe", "pipe"] });
          let output = "", errors = "";
          child.stdout.setEncoding("utf8"); child.stderr.setEncoding("utf8");
          child.stdout.on("data", chunk => { output += chunk; });
          child.stderr.on("data", chunk => { errors += chunk; });
          child.once("error", reject);
          child.once("close", code => output.trim()
            ? resolve({ output, exitCode: code }) : reject(new Error(errors || `counterexample_worker_exit_${code}`)));
        });
        const summary = JSON.parse(stdout.output.trim().split("\n").at(-1));
        const childReport = JSON.parse(fs.readFileSync(summary.reportFile, "utf8"));
        report.checks[check] = { ...childReport.checks[check], workerReportFile: summary.reportFile, workerExitCode: stdout.exitCode };
        report.cleanup.push(...childReport.cleanup);
      } catch (error) { report.checks[check] = { status: "failed", error: error.message }; }
      save();
    }
    report.status = Object.values(report.checks).every(check => check.status === "reproduced") ? "reproduced" : "failed";
    report.finishedAt = new Date().toISOString(); save();
    return report;
  }
  assert.ok(["p1", "p2"].includes(only));
  let fixture;
  if (only === "p1") {
  try {
    fixture = await createDesktopR04Fixture({ coreRoot, expectedCoreCommit, evidenceDir });
    report.checks.p1 = { fixtureEvidence: fixture.evidenceFile, status: "running" }; save();
    await fixture.withV4Runtime(async ({ conversationStore, planningPort }) => {
      const before = snapshot(fixture);
      const registered = conversationStore.readRegisteredExact(fixture.sources[0].message_ref);
      assert.equal(registered.record.text, R04_SOURCE_TEXTS[0]);
      const afterRegistered = snapshot(fixture);
      const checkpoint = planningPort.readCheckpoint();
      const afterCheckpoint = snapshot(fixture);
      const registeredDiff = compare(before, afterRegistered), checkpointDiff = compare(afterRegistered, afterCheckpoint);
      const noOpChmod = diff => diff.semanticsUnchanged && Object.entries(diff.artifacts)
        .some(([name, value]) => !name.endsWith("-shm") && value.bytesUnchanged && value.modeUnchanged && value.mtimeUnchanged && value.ctimeChanged);
      Object.assign(report.checks.p1, { before, afterRegistered, afterCheckpoint, checkpoint,
        registeredDiff, checkpointDiff, registeredText: registered.record.text,
        readRegisteredExactReproduced: noOpChmod(registeredDiff), readCheckpointReproduced: noOpChmod(checkpointDiff),
        status: noOpChmod(registeredDiff) && noOpChmod(checkpointDiff) ? "reproduced" : "not_reproduced" });
      save();
      assert.ok(report.checks.p1.readRegisteredExactReproduced, "P1 readRegisteredExact no-op chmod was not observed");
      assert.ok(report.checks.p1.readCheckpointReproduced, "P1 readCheckpoint no-op chmod was not observed");
    });
  } catch (error) {
    report.checks.p1 ??= {};
    Object.assign(report.checks.p1, { status: "failed", error: error.message }); save();
  } finally {
    if (fixture) {
      await fixture.stop();
      report.cleanup.push({ fixtureEvidence: fixture.evidenceFile, dataRootRemoved: !fs.existsSync(fixture.dataRoot),
        privateRootRemoved: !fs.existsSync(fixture.container), coreStopped: true, providerStopped: true });
      fixture = null; save();
    }
  }
  }
  // P2 always runs, even when P1 reproduces or fails. It must establish a real
  // complete answer before waiting; an all-held run is explicitly a failure.
  if (only === "p2") {
  try {
    fixture = await createDesktopR04Fixture({ coreRoot, expectedCoreCommit, evidenceDir });
    report.checks.p2 = { fixtureEvidence: fixture.evidenceFile, status: "running" }; save();
    await fixture.startCore();
    const personRequest = { root_ref: fixture.root.dataRootFingerprint, expected_owner_id: fixture.ownerId,
      message_ref: fixture.sources[0].message_ref, person_name: "张老师" };
    const preview = await fixture.call("owner_recall_person_read", personRequest);
    assert.equal(preview.result?.status, "current", JSON.stringify(preview));
    const confirmation = await fixture.call("owner_recall_person_confirm", { ...personRequest,
      command_id: "r04-p2-confirm-synthetic-teacher", expected_source_fingerprint: preview.result.source_fingerprint,
      expected_person_revision: preview.result.person_revision });
    assert.equal(confirmation.result?.status, "confirmed", JSON.stringify(confirmation));
    const query = await fixture.captureQuery();
    await fixture.stopCore();
    let endsAt, mutation;
    await fixture.withV4Runtime(async ({ planningPort }) => {
      endsAt = new Date(Date.now() + 9000).toISOString();
      const checkpoint = planningPort.readCheckpoint(), at = new Date().toISOString();
      mutation = planningPort.mutate({ expected_generation: checkpoint.generation,
        expected_history_tip_hash: checkpoint.history_tip_hash, expected_checkpoint_hash: checkpoint.current_state_hash,
        operations: fixture.sources.map(source => ({ kind: "apply_goal_command", command: { action: "update",
          goal_id: source.goal.id, expected_version: source.goalVersion, at, goal: { ...source.goal, ends_at: endsAt } } })) });
    });
    await fixture.startCore();
    Object.assign(report.checks.p2, { personRead: preview, personConfirm: confirmation, query, endsAt, planningMutation: mutation });
    save();
    const baseline = await fixture.call("owner_memory_recall", query);
    report.checks.p2.baseline = baseline; save();
    assert.equal(baseline.ok, true, JSON.stringify(baseline));
    assert.equal(baseline.result.status, "current", "P2 requires a genuine current complete answer before expiry");
    assert.equal(baseline.result.answer.text, R04_SOURCE_TEXTS.join("\n"));
    assert.equal(baseline.result.answer.question_case_verified, true);
    assert.equal(baseline.result.answer.answer_verified, true);
    assert.equal(baseline.result.entries.length, 2);
    const memoryIds = baseline.result.entries.map(entry => entry.id);
    const noQuery = { ...query }; delete noQuery.query;
    const baselineNoQuery = await fixture.call("owner_memory_recall", { ...noQuery, memory_ids: memoryIds, limit: 50 });
    assert.equal(baselineNoQuery.result?.status, "current", JSON.stringify(baselineNoQuery));
    assert.equal(baselineNoQuery.result.model_execute, false);
    const beforeExpiry = snapshot(fixture);
    const remainingBeforeWaitMs = Date.parse(endsAt) - Date.now();
    // SDK cold start can consume part of the short Goal lifetime. Always wait
    // at least five real seconds, even if expiry is now less than five away.
    const waitMs = Math.max(5000, remainingBeforeWaitMs + 150);
    Object.assign(report.checks.p2, { baselineNoQuery, beforeExpiry, remainingBeforeWaitMs, waitMs }); save();
    assert.ok(waitMs >= 5000 && waitMs <= 10000, `expected an actual 5–10 second wait, received ${waitMs} ms`);
    await new Promise(resolve => setTimeout(resolve, waitMs));
    const afterWait = snapshot(fixture);
    const grant = await fixture.call("owner_read", { root_ref: fixture.root.dataRootFingerprint });
    report.checks.p2.grant = grant; save();
    assert.equal(grant.ok, true, JSON.stringify(grant));
    const activeGrant = grant.result.grants.find(item => item.id === fixture.grantId);
    assert.equal(activeGrant.status, "active");
    assert.ok(Date.parse(activeGrant.ends_at) > Date.now());
    const afterNoQuery = await fixture.call("owner_memory_recall", { ...noQuery, memory_ids: memoryIds, limit: 50 });
    const afterFullQuery = await fixture.call("owner_memory_recall", query);
    const afterReads = snapshot(fixture);
    const waitDiff = compare(beforeExpiry, afterWait), readsDiff = compare(beforeExpiry, afterReads);
    const currentIds = afterNoQuery.result?.entries?.map(entry => entry.id).sort();
    const reproduced = afterNoQuery.result?.status === "current" && afterNoQuery.result?.model_execute === false
      && isDeepStrictEqual(currentIds, [...memoryIds].sort()) && afterFullQuery.result?.status === "held"
      && waitDiff.semanticsUnchanged && readsDiff.semanticsUnchanged;
    Object.assign(report.checks.p2, { afterWait, afterReads, waitDiff, readsDiff, afterNoQuery, afterFullQuery,
      memoryIds, counters: fixture.counters, status: reproduced ? "reproduced" : "not_reproduced" }); save();
    assert.ok(reproduced, "P2 complete-query/no-query divergence was not established");
    assert.equal(fixture.counters.ordinaryPiRequests, 0);
  } catch (error) {
    report.checks.p2 ??= {};
    Object.assign(report.checks.p2, { status: "failed", error: error.message, stack: error.stack,
      fixtureEvidence: fixture?.evidenceFile ?? error.fixtureEvidence }); save();
  } finally {
    if (fixture) {
      await fixture.stop();
      report.cleanup.push({ fixtureEvidence: fixture.evidenceFile, dataRootRemoved: !fs.existsSync(fixture.dataRoot),
        privateRootRemoved: !fs.existsSync(fixture.container), coreStopped: true, providerStopped: true }); save();
    }
  }
  }
  report.status = Object.values(report.checks).every(check => check.status === "reproduced") ? "reproduced" : "failed";
  report.finishedAt = new Date().toISOString(); save();
  return report;
}

if (process.argv[1] && pathToFileURL(path.resolve(process.argv[1])).href === import.meta.url) {
  const { values } = parseArgs({ options: { "core-root": { type: "string" }, "core-commit": { type: "string" },
    "evidence-dir": { type: "string" }, only: { type: "string" } } });
  runDesktopR04Counterexamples({ coreRoot: values["core-root"], expectedCoreCommit: values["core-commit"] ?? R04_CORE_COMMIT,
    evidenceDir: values["evidence-dir"], only: values.only }).then(report => {
    console.log(JSON.stringify({ status: report.status, reportFile: report.reportFile,
      checks: Object.fromEntries(Object.entries(report.checks).map(([key, value]) => [key, {
        status: value.status, error: value.error }])), cleanup: report.cleanup }));
    if (report.status !== "reproduced") process.exitCode = 1;
  }).catch(error => { console.error(JSON.stringify({ status: "failed",
    code: typeof error.code === "string" && /^[A-Za-z0-9_:-]{1,100}$/u.test(error.code) ? error.code : error.name }));
  process.exitCode = 1; });
}
