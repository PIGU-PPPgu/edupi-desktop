#!/usr/bin/env node
import assert from "node:assert/strict";
import crypto from "node:crypto";
import childProcess from "node:child_process";
import fs from "node:fs";
import http from "node:http";
import os from "node:os";
import path from "node:path";
import { syncBuiltinESMExports } from "node:module";
import { fileURLToPath } from "node:url";
import { createJiti } from "jiti";
import { setRecurringTestClockOffset, restoreRecurringTestClock } from "./test-edupi-recurring-clock.mjs";

assert.ok(process.env.EDUPI_CORE_ROOT && path.isAbsolute(process.env.EDUPI_CORE_ROOT), "EDUPI_CORE_ROOT is required");
const coreRoot = fs.realpathSync(process.env.EDUPI_CORE_ROOT);
const desktopRoot = fileURLToPath(new URL("..", import.meta.url));
assert.equal(fs.realpathSync(process.cwd()), fs.realpathSync(desktopRoot), "run from this Desktop checkout");
const compat = JSON.parse(fs.readFileSync(path.join(desktopRoot, "contracts/edupi-core-compat.json"), "utf8"));
const coreCommit = childProcess.execFileSync("git", ["-C", coreRoot, "rev-parse", "HEAD"], { encoding: "utf8" }).trim();
assert.equal(coreCommit, compat.core_runtime.core_commit, "Core must match the current Desktop pin");
const root = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), "edupi-recurring-desktop-e2-")));
const dataRoot = path.join(root, "data");
const stateDir = path.join(root, "state");
const agentDir = path.join(root, "agent");
const outputDir = path.join(dataRoot, ".edupi/output");
for (const directory of [stateDir, agentDir, outputDir, path.join(dataRoot, ".edupi/memory"), path.join(dataRoot, ".edupi/locks")]) {
  fs.mkdirSync(directory, { recursive: true, mode: 0o700 });
}
const token = crypto.randomBytes(32).toString("hex");
const environment = {
  EDUPI_PROJECT_ROOT: dataRoot, EDUPI_DATA_ROOT: dataRoot, EDUPI_DATA_ALLOWED_ROOT: root,
  EDUPI_CORE_ROOT: coreRoot, EDUPI_CORE_ALLOWED_ROOT: path.dirname(coreRoot),
  EDUPI_HOME: path.join(dataRoot, ".edupi"), EDUPI_MEMORY_DIR: path.join(dataRoot, ".edupi/memory"),
  EDUPI_OUTPUT_DIR: outputDir, EDUPI_LOCK_DIR: path.join(dataRoot, ".edupi/locks"),
  EDUPI_CORE_VALIDATION_MODE: "external", EDUPI_DESKTOP_ISOLATED_CANARY: "1",
  PI_DESKTOP_STATE_DIR: stateDir, PI_CODING_AGENT_DIR: agentDir, PI_DESKTOP_API_TOKEN: token, PI_OFFLINE: "1",
};
const previous = new Map(Object.keys(environment).map(key => [key, process.env[key]]));
Object.assign(process.env, environment);
let offset = 0;
const originalFork = childProcess.fork;
const forked = [];
const runtimeDiagnostics = [];
const projectionFailures = [];
childProcess.fork = (modulePath, args, options) => {
  assert.equal(path.basename(modulePath), "core-runtime-host.mjs");
  assert.equal(options.env.EDUPI_PROJECT_ROOT, dataRoot);
  const child = originalFork(modulePath, args, {
    ...options,
    stdio: ["ignore", "ignore", "pipe", "ipc"],
    execArgv: [...options.execArgv, "--import", fileURLToPath(new URL("./test-edupi-recurring-clock.mjs", import.meta.url))],
    env: { ...options.env, TMPDIR: os.tmpdir(), EDUPI_RECURRING_TEST_CLOCK_OFFSET: String(offset) },
  });
  forked.push(child);
  child.stderr.on("data", bytes => runtimeDiagnostics.push(bytes.toString().slice(0, 2000)));
  child.on("message", message => {
    if (message?.type === "runtime-error") runtimeDiagnostics.push({ type: message.type, code: message.code });
  });
  return child;
};
syncBuiltinESMExports();
const originalFetch = globalThis.fetch;
let parentFetchRequests = 0;
globalThis.fetch = async (input, options) => {
  const url = new URL(typeof input === "string" || input instanceof URL ? input : input.url);
  assert.equal(url.hostname, "127.0.0.1", "parent-process fetch must use loopback");
  parentFetchRequests++;
  const response = await originalFetch(input, options);
  if (typeof options?.body === "string") {
    const operation = JSON.parse(options.body).operation;
    if (["health", "prepare_due"].includes(operation)) {
      const result = await response.clone().json();
      runtimeDiagnostics.push({ operation, ok: result.ok, error: result.error, g1Processor: result.result?.capabilities?.g1_processor,
        result: operation === "prepare_due" ? result.result : undefined });
    }
  }
  return response;
};
let modelCalls = 0;
const modelServer = http.createServer((_request, response) => {
  modelCalls++;
  response.writeHead(500, { "content-type": "application/json" });
  response.end(JSON.stringify({ error: "recurring internal materials must never call a model" }));
});
let supervisor;
const hash = bytes => `sha256:${crypto.createHash("sha256").update(bytes).digest("hex")}`;
const dateAt = days => new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Shanghai", year: "numeric", month: "2-digit", day: "2-digit" })
  .format(new Date(Date.now() + days * 86_400_000));
const firstDate = dateAt(0);
const secondDate = dateAt(7);
const taskInput = {
  clientRequestId: "84848484-8484-4484-8484-848484848484", title: "合成每周内部材料",
  dueDate: firstDate, note: "只整理合成内部议程，不发送", preparationSource: null,
  recurrence: { kind: "teacher_internal_materials", cadence: "weekly", untilDate: dateAt(21),
    leadDays: 0, deliverables: ["合成内部议程", "合成材料清单"] },
};
const templateId = `teacher-task-${taskInput.clientRequestId}`;
const apiRequest = (pathname, body) => new Request(`http://localhost${pathname}`, {
  method: body === undefined ? "GET" : "POST",
  headers: { host: "localhost", origin: "http://localhost", "content-type": "application/json",
    "sec-fetch-site": "same-origin", "x-pi-desktop-token": token },
  ...(body === undefined ? {} : { body: JSON.stringify(body) }),
});
const json = async response => {
  const body = await response.json();
  assert.equal(response.status, 200, JSON.stringify(body));
  return body;
};

try {
  await new Promise((resolve, reject) => {
    modelServer.once("error", reject);
    modelServer.listen(0, "127.0.0.1", resolve);
  });
  fs.writeFileSync(path.join(agentDir, "models.json"), JSON.stringify({ providers: { local: {
    api: "openai-completions", apiKey: "synthetic-local-placeholder",
    baseUrl: `http://127.0.0.1:${modelServer.address().port}/v1`,
    models: [{ id: "local", name: "Forbidden synthetic model", input: ["text"], reasoning: false, contextWindow: 32000, maxTokens: 2048,
      cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 } }],
  } } }), { mode: 0o600 });
  fs.writeFileSync(path.join(agentDir, "settings.json"), JSON.stringify({
    defaultProvider: "local", defaultModel: "local", extensions: [], packages: [], skills: [],
  }), { mode: 0o600 });
  const jiti = createJiti(import.meta.url, { tsconfigPaths: true });
  const { readRuntimeModelConfiguration } = await jiti.import("../lib/edupi-runtime-model-config.ts");
  await readRuntimeModelConfiguration({ projectRoot: dataRoot, agentDir, signal: new AbortController().signal });
  supervisor = await jiti.import("../lib/edupi-runtime-supervisor.ts");
  const taskRoute = await jiti.import("../app/api/edupi/tasks/route.ts");
  const educationRoute = await jiti.import("../app/api/edupi/education/route.ts");
  const fileRoute = await jiti.import("../app/api/files/[...path]/route.ts");
  const proactivityRoute = await jiti.import("../app/api/edupi/proactivity/route.ts");
  const feedbackRoute = await jiti.import("../app/api/edupi/teacher-feedback/route.ts");
  const { NextRequest } = await import("next/server.js");
  const { issueEducationIntake } = await jiti.import("../lib/edupi-education-intake.ts");
  const { stageMaterialInputs } = await jiti.import("../lib/edupi-material-staging.ts");
  const { intakeRecognizedMaterial } = await jiti.import("../lib/edupi-material-intake-flow.ts");
  const { resolveEduPiBridgeRoots } = await jiti.import("../lib/edupi-core-snapshot.ts");
  const readEducation = async () => json(await educationRoute.GET());
  const executionRows = () => {
    const file = path.join(outputDir, "calendar_work_execution_state.json");
    return fs.existsSync(file) ? JSON.parse(fs.readFileSync(file, "utf8")).executions : [];
  };
  const readFile = async artifact => {
    const absolute = path.resolve(dataRoot, artifact.relative_path);
    assert.ok(absolute.startsWith(`${outputDir}${path.sep}`));
    const request = new NextRequest(`http://localhost/api/files/${absolute.split("/").filter(Boolean).join("/")}?type=read`);
    const result = await json(await fileRoute.GET(request, { params: Promise.resolve({ path: absolute.split("/").filter(Boolean) }) }));
    const actual = hash(Buffer.from(result.content));
    const diskBytes = fs.readFileSync(absolute);
    const sizeBytes = Buffer.byteLength(result.content, "utf8");
    assert.ok(sizeBytes > 0);
    assert.equal(sizeBytes, diskBytes.length);
    assert.equal(actual, hash(diskBytes));
    const durable = executionRows().flatMap(item => item.artifacts).find(item => item.artifact_id === artifact.artifact_id);
    assert.ok(durable);
    assert.equal(actual, durable.sha256);
    return { artifactId: artifact.artifact_id, hash: actual, sizeBytes, relativePath: artifact.relative_path };
  };
  const waitPeriod = async date => {
    const deadline = performance.now() + 25_000;
    let data;
    let observedReady = false;
    while (performance.now() < deadline) {
      data = await readEducation();
      const task = data.tasks.find(item => item.trigger === "teacher_recurring_weekly" && item.sourceEventDate === date);
      const workCase = task && data.workCases.find(item => item.taskId === task.id);
      const execution = task && executionRows().find(item => item.task_id === task.id && item.status === "draft_ready");
      if (task && execution) {
        if (!observedReady) {
          observedReady = true;
          continue;
        }
        const artifacts = execution.artifacts;
        assert.equal(artifacts.length, 2);
        assert.deepEqual(artifacts.map(item => item.title).sort(), [...taskInput.recurrence.deliverables].sort());
        assert.equal(executionRows().filter(item => item.task_id === task.id).length, 1);
        const projected = data.generatedArtifacts.filter(item => item.task_id === task.id && item.available);
        const files = await Promise.all(artifacts.map(readFile));
        try {
          assert.equal(execution.attempt, 1, `single execution attempt for ${date}`);
          assert.equal(task.contentStatus, "draft_ready");
          assert.equal(workCase?.currentState, "draft_ready");
          assert.deepEqual([...workCase.artifactIds].sort(), artifacts.map(item => item.artifact_id).sort());
          assert.deepEqual(projected.map(item => item.artifact_id).sort(), artifacts.map(item => item.artifact_id).sort());
          for (const file of files) {
            const projection = projected.find(item => item.artifact_id === file.artifactId);
            assert.equal(projection?.relative_path, file.relativePath, `education relative_path for ${file.artifactId}`);
            assert.equal(projection?.size_bytes, file.sizeBytes, `education size_bytes for ${file.artifactId}`);
          }
        } catch (error) {
          if (!projectionFailures.some(item => item.taskId === task.id)) projectionFailures.push({
            date, taskId: task.id, expected: "draft_ready with two matching readable artifacts",
            taskContentStatus: task.contentStatus, workCaseState: workCase?.currentState,
            workCaseArtifactCount: workCase?.artifactIds.length, educationArtifactCount: projected.length,
            durableExecutionStatus: execution.status, durableArtifactCount: artifacts.length,
            assertion: error.message,
          });
        }
        return { taskId: task.id, workCaseId: workCase?.id, executionId: execution.execution_id,
          attempt: execution.attempt, date, files };
      }
      await new Promise(resolve => setTimeout(resolve, 150));
    }
    throw new Error(`period ${date} unavailable: ${JSON.stringify({ tasks: data?.tasks, workCases: data?.workCases })}`);
  };
  const created = await json(await taskRoute.POST(apiRequest("/api/edupi/tasks", taskInput)));
  assert.equal(created.taskId, templateId);
  assert.equal(created.receipt.status, "accepted");
  assert.match(created.receipt.template_definition_hash, /^sha256:[a-f0-9]{64}$/u);
  assert.equal(created.receipt.external_send, false);
  assert.equal(created.preparation, null);
  assert.equal(created.data.tasks.filter(item => item.id === templateId).length, 1);
  assert.deepEqual(created.data.tasks.find(item => item.id === templateId).recurrence, taskInput.recurrence);
  const initialReplay = await json(await taskRoute.POST(apiRequest("/api/edupi/tasks", taskInput)));
  assert.equal(initialReplay.replayed, true);
  assert.equal(initialReplay.taskId, templateId);
  assert.equal(modelCalls, 0);
  assert.equal(executionRows().length, 0, "default-off G1 must not execute the accepted template");
  assert.equal((await readEducation()).workCases.filter(item => item.currentState === "draft_ready").length, 0);

  const slot = { slot_id: "synthetic-recurring-scope", day_of_week: new Date(`${firstDate}T12:00:00+08:00`).getUTCDay() || 7,
    period: 1, subject: "数学", class_name: "合成周期班", class_id: "synthetic-recurring-class",
    kind: "class", notes: null, start_time: "09:00", time_zone: "Asia/Shanghai" };
  const timetable = await issueEducationIntake({ command_type: "import_timetable",
    source: { source_id: "synthetic-recurring-scope", source_kind: "teacher_message",
      source_hash: hash(JSON.stringify(slot)), evidence_ids: ["synthetic-recurring-scope"] }, slots: [slot] });
  assert.equal(timetable.receipt.status, "accepted");
  const descriptor = stageMaterialInputs([{ name: "synthetic-recurring-scope.pdf", mimeType: "application/pdf",
    bytes: new Uint8Array(Buffer.from("%PDF-1.4\nSynthetic recurring scope only\n")) }])[0];
  const material = await intakeRecognizedMaterial({ descriptor, title: "合成周期授权材料", materialKind: "lesson_note",
    subject: "数学", classId: slot.class_id, recognize: false });
  assert.equal(material.receipts[0].status, "accepted");
  assert.equal((await json(await feedbackRoute.POST(apiRequest("/api/edupi/teacher-feedback", { action: "bootstrap" })))).ok, true);
  const before = await json(await proactivityRoute.GET(apiRequest("/api/edupi/proactivity")));
  assert.equal(before.activation.enabled, false);
  const enabled = await json(await proactivityRoute.POST(apiRequest("/api/edupi/proactivity", {
    enabled: true, classId: slot.class_id, subject: "数学", expectedUpdatedAt: before.activation.updatedAt,
  })));
  assert.equal(enabled.activation.enabled, true);
  assert.equal(enabled.externalSend, false);
  const health = await (await supervisor.ensureEduPiRuntime(resolveEduPiBridgeRoots())).call("health", null);
  assert.equal(health.result.capabilities.g1_processor, "active");
  const first = await waitPeriod(firstDate);
  const firstReplay = await json(await taskRoute.POST(apiRequest("/api/edupi/tasks", taskInput)));
  assert.equal(firstReplay.replayed, true);
  assert.deepEqual(await waitPeriod(firstDate), first);
  await supervisor.closeAllEduPiRuntimes();
  assert.ok(forked.every(child => child.exitCode !== null || child.signalCode !== null));
  assert.deepEqual(await waitPeriod(firstDate), first);
  await supervisor.closeAllEduPiRuntimes();
  offset = 7 * 86_400_000;
  setRecurringTestClockOffset(offset);
  const second = await waitPeriod(secondDate);
  assert.notEqual(second.taskId, first.taskId);
  assert.notEqual(second.executionId, first.executionId);
  assert.ok(second.files.every(file => !first.files.some(previousFile => previousFile.artifactId === file.artifactId)));
  for (const file of first.files) assert.equal(hash(fs.readFileSync(path.join(dataRoot, file.relativePath))), file.hash);
  await supervisor.closeAllEduPiRuntimes();
  assert.deepEqual(await waitPeriod(secondDate), second);
  const finalReplay = await json(await taskRoute.POST(apiRequest("/api/edupi/tasks", taskInput)));
  assert.equal(finalReplay.replayed, true);
  assert.equal(finalReplay.taskId, templateId);
  assert.equal(finalReplay.data.tasks.filter(item => item.id === templateId).length, 1);
  assert.deepEqual(await waitPeriod(secondDate), second);
  assert.equal(modelCalls, 0);
  console.log(JSON.stringify({ status: projectionFailures.length ? "failed" : "passed", synthetic: true, desktopCommit: childProcess.execFileSync("git", ["rev-parse", "HEAD"], { encoding: "utf8" }).trim(),
    coreCommit, templateId, acceptedReceipt: created.receipt.receipt_id, templateDefinitionHash: created.receipt.template_definition_hash,
    first, second, coreProcessLaunches: forked.length,
    networkObservations: { parentFetchRequests, configuredModelEndpointCalls: modelCalls, coreChildNetwork: "unmonitored" },
    responseFlags: { taskReceiptExternalSend: created.receipt.external_send, proactivityExternalSend: enabled.externalSend },
    clock: "test-only Date offset in parent and real Core child; second period +7 days",
    passed: ["Desktop task POST accepted and exact replay", "G1 timer first and second periods",
      ...(projectionFailures.length ? [] : ["file route bytes and education path/size_bytes match disk and durable SHA256"]),
      "real Core child exit/relaunch preserves execution/attempt/artifacts", "first-period files retained"],
    projectionFailures,
    unverified: ["browser interaction", "signed installed application", "natural seven-day elapsed time", "teaching content quality",
      "absence of external sends across all processes; Core child networking is not monitored"],
  }, null, 2));
  if (projectionFailures.length) process.exitCode = 1;
} catch (error) {
  console.error(JSON.stringify({ status: "failed", coreProcessLaunches: forked.length, runtimeDiagnostics }));
  throw error;
} finally {
  await supervisor?.closeAllEduPiRuntimes();
  childProcess.fork = originalFork;
  syncBuiltinESMExports();
  globalThis.fetch = originalFetch;
  restoreRecurringTestClock();
  modelServer.closeAllConnections();
  if (modelServer.listening) await new Promise(resolve => modelServer.close(resolve));
  for (const [key, value] of previous) {
    if (value === undefined) delete process.env[key];
    else process.env[key] = value;
  }
  assert.equal(path.dirname(root), fs.realpathSync(os.tmpdir()));
  assert.ok(path.basename(root).startsWith("edupi-recurring-desktop-e2-"));
  fs.rmSync(root, { recursive: true, force: true });
}
