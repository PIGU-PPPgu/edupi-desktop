import assert from "node:assert/strict";
import crypto from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import childProcess from "node:child_process";
import { syncBuiltinESMExports } from "node:module";
import { createJiti } from "jiti";
import { R04_QUERY, createDesktopR04Fixture } from "../scripts/r04-desktop-acceptance-fixture.mjs";

test("production stop pauses the admitted root after a real Core answer and cold restart keeps recall off",
  { skip: !process.env.EDUPI_R04_RAW_CORE_ROOT || process.platform === "win32", timeout: 120_000 }, async () => {
    const evidenceDir = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), "edupi-r04-stop-runtime-proof-")));
    const report = { synthetic: true, installedApp: false, modelKind: "allow-listed loopback fixture",
      scope: "actual C0 capture, Core model IPC and production settings/supervisor; SDK binding is covered by the paired raw test" };
    const started = performance.now();
    let lastPhase = "setup", primaryFailure = null;
    const phase = (value, extra = {}) => {
      lastPhase = value;
      console.log(JSON.stringify({ phase: value, elapsedMs: Math.round(performance.now() - started), ...extra }));
    };
    const fixture = await createDesktopR04Fixture({ coreRoot: process.env.EDUPI_R04_RAW_CORE_ROOT, evidenceDir });
    phase("fixture_ready");
    let supervisor;
    const originalFork = childProcess.fork;
    childProcess.fork = (file, args, options) => {
      const child = originalFork(file, args, options);
      if (options?.env?.EDUPI_PROJECT_ROOT === fixture.dataRoot) {
        phase("child_created", { pid: child.pid });
        for (const event of ["exit", "close", "disconnect"]) child.on(event, () => phase(`child_${event}`, { pid: child.pid }));
        const send = child.send.bind(child);
        child.send = (message, ...rest) => {
          if (["runtime-stop", "model-result", "model-error", "model-config-result", "model-config-error"].includes(message?.type)) {
            phase("parent_ipc", { pid: child.pid, type: message.type });
          }
          return send(message, ...rest);
        };
      }
      return child;
    };
    syncBuiltinESMExports();
    const hash = file => `sha256:${crypto.createHash("sha256").update(fs.readFileSync(file)).digest("hex")}`;
    try {
      await fixture.withEnvironment(async () => {
        const jiti = createJiti(import.meta.url, { tsconfigPaths: true, fsCache: false });
        supervisor = await jiti.import("./edupi-runtime-supervisor.ts");
        const { resolveEduPiBridgeRoots } = await jiti.import("./edupi-core-snapshot.ts");
        const { registerAndCapturePrompt } = await jiti.import("./edupi-registered-prompt.ts");
        const { createEduPiRecallSettingsService } = await jiti.import("./edupi-recall-settings-server.ts");
        const roots = resolveEduPiBridgeRoots(), host = await supervisor.ensureEduPiRuntime(roots);
        assert.equal(host.recallAnswersActive, true);
        phase("runtime_active");
        const beforeHealth = await host.call("health", null);
        const person = { root_ref: fixture.root.dataRootFingerprint, expected_owner_id: fixture.ownerId,
          message_ref: fixture.sources[0].message_ref, person_name: "张老师" };
        const read = await host.callOwnerControl("owner_recall_person_read", person);
        assert.equal(read.result.status, "current");
        const confirmed = await host.callOwnerControl("owner_recall_person_confirm", { ...person,
          command_id: `synthetic-stop-person-${crypto.randomUUID()}`, expected_source_fingerprint: read.result.source_fingerprint,
          expected_person_revision: read.result.person_revision });
        assert.equal(confirmed.result.status, "confirmed");
        phase("person_confirmed");
        const messageId = `synthetic-stop-query-${crypto.randomUUID()}`;
        const proof = await registerAndCapturePrompt(host, {
          rootRef: fixture.root.dataRootFingerprint, grantId: fixture.grantId,
          sessionId: fixture.sessionManager.getSessionId(), messageId, text: R04_QUERY,
          occurredAt: new Date().toISOString(), domain: "teaching_preparation",
          carrierId: "edupi.desktop.g1", planId: `synthetic-stop-plan-${crypto.randomUUID()}`,
          previousBinding: { ownerId: fixture.ownerId, grantId: fixture.grantId, grantVersion: 1 },
        }, { onBound() { assert.fail("unexpected rebinding"); }, onRegistered() {}, onCaptured() {} });
        phase("query_captured");
        const answer = await host.callOwnerControl("owner_memory_recall", {
          root_ref: fixture.root.dataRootFingerprint, expected_owner_id: fixture.ownerId, message_ref: proof.messageRef,
          conversation_id: fixture.sources[0].conversation_id, message_id: messageId,
          original_text_hash: `sha256:${crypto.createHash("sha256").update(R04_QUERY).digest("hex")}`,
          registration: proof.registration, query: R04_QUERY,
        });
        assert.equal(answer.ok, true); assert.equal(answer.result.status, "current");
        assert.equal(answer.result.answer.answer_verified, true);
        phase("answer_current");
        assert.equal(fixture.counters.facetRequests, 1); assert.equal(fixture.counters.ordinaryPiRequests, 0);
        const g1Config = path.join(fixture.stateDir, "edupi-proactivity.json"), g1Hash = hash(g1Config);
        const stoppedAt = performance.now();
        phase("stop_started");
        report.stop = await createEduPiRecallSettingsService().update({ enabled: false, expectedUpdatedAt: null });
        report.stopMs = Math.round(performance.now() - stoppedAt);
        phase("stop_returned", { stop: report.stop.stop, stopMs: report.stopMs });
        assert.equal(report.stop.activation.enabled, false);
        assert.deepEqual(report.stop.stop, { status: "stopped", grants: "none" });
        const after = await supervisor.ensureEduPiRuntime(roots), afterHealth = await after.call("health", null);
        assert.equal(after.recallAnswersActive, false); assert.equal(afterHealth.ok, true);
        assert.notEqual(afterHealth.result.instance_nonce, beforeHealth.result.instance_nonce);
        assert.equal(hash(g1Config), g1Hash); assert.equal(fixture.counters.facetRequests, 1);
        report.afterHealthy = true;
        phase("off_health_verified");
        await supervisor.closeAllEduPiRuntimes();
        const cold = await supervisor.ensureEduPiRuntime(roots);
        assert.equal(cold.recallAnswersActive, false);
        assert.equal((await cold.call("health", null)).ok, true);
        assert.equal((await createEduPiRecallSettingsService().get()).activation.enabled, false);
        report.coldOff = true; report.counters = fixture.counters;
        phase("cold_off_verified");
      });
    } catch (error) {
      primaryFailure = error;
      report.failure = { phase: lastPhase, code: error.code ?? error.name, message: error.message };
      console.log(JSON.stringify({ status: "failed", ...report }));
      throw error;
    } finally {
      phase("cleanup_started");
      let closed = true;
      await fixture.withEnvironment(async () => {
        try { await supervisor?.quarantineEduPiRuntime(fixture.dataRoot, { requireClosed: true }); }
        catch { closed = false; }
      });
      await fixture.stop({ cleanup: closed });
      if (closed) fs.rmSync(evidenceDir, { recursive: true, force: true });
      childProcess.fork = originalFork; syncBuiltinESMExports();
      if (!closed) phase("cleanup_unknown", { evidenceDir });
      if (!primaryFailure) assert.equal(closed, true, "unknown cleanup retains the synthetic fixture for bounded recovery");
      phase("cleanup_finished", { closed });
    }
    console.log(JSON.stringify({ status: "passed", ...report }));
  });
