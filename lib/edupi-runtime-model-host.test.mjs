import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import http from "node:http";
import crypto from "node:crypto";
import { pathToFileURL } from "node:url";
import { execFile } from "node:child_process";
import { isDeepStrictEqual, promisify } from "node:util";
import test from "node:test";
import { createJiti } from "jiti";
import { EventEmitter } from "node:events";
import { ModelRuntime, SettingsManager } from "@earendil-works/pi-coding-agent";
import ts from "typescript";
import * as privateModelProtocol from "../desktop/core-runtime-model-config.mjs";
const { createRuntimeModelHost, attachRuntimeModelHost } = await createJiti(import.meta.url).import("./edupi-runtime-model-host.ts");

test("G2 uses a separate bounded prompt path without exposing credentials", async t => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "edupi-g2-model-unit-"));
  t.after(() => fs.rmSync(root, {recursive:true, force:true}));
  fs.mkdirSync(path.join(root, "scripts"));
  fs.writeFileSync(path.join(root, "package.json"), '{"type":"module"}');
  fs.writeFileSync(path.join(root, "scripts/core_runtime_model_adapter.mjs"), 'export function buildG1LiveRequest(){throw new Error("G2 must not use G1 leases")}');
  fs.writeFileSync(path.join(root, "scripts/core_runtime_isolated_model.mjs"), `
    let calls = 0;
    export const callCount = () => calls;
    export function createIsolatedG1ModelRunner(config) {
      if(config.apiKey !== 'synthetic-key' || config.maxCalls !== 1 || config.timeoutMs > 120000) throw new Error('unbounded config');
      return async ({prompt,signal}) => { if(signal.aborted) throw new Error('cancelled'); calls++; return {output:prompt}; };
    }
  `);
  t.mock.method(SettingsManager, "create", () => ({getDefaultProvider:()=>"test", getDefaultModel:()=>"test"}));
  let selectedBaseUrl = "https://example.invalid/v1";
  let authenticatedBaseUrl;
  t.mock.method(ModelRuntime, "create", async () => ({getModel:()=>({id:"test",provider:"test",baseUrl:selectedBaseUrl,maxTokens:100}),
    getAuth:async()=>({auth:{apiKey:"synthetic-key",baseUrl:authenticatedBaseUrl}}), getCompatibilityRequestConfig:()=>({}), isUsingOAuth:()=>false}));
  const host = createRuntimeModelHost({coreRoot:root,projectRoot:root,agentDir:root});
  const request = {model_kind:"student_followup",prompt:"Synthetic Core prompt",deadline_at:new Date(Date.now()+60000).toISOString()};
  try {
    assert.deepEqual(await host.run(request, {signal:new AbortController().signal}), {output:request.prompt});
    await assert.rejects(host.run({...request,baseUrl:"https://other.invalid"},{signal:new AbortController().signal}), {code:"invalid_model_request"});
    await assert.rejects(host.run({...request,deadline_at:"invalid"},{signal:new AbortController().signal}), {code:"invalid_model_request"});
    const {callCount} = await import(path.join(root,"scripts/core_runtime_isolated_model.mjs"));
    assert.equal(callCount(),1);
    selectedBaseUrl = "https://coding.example.invalid/v1";
    await assert.rejects(host.run(request, {signal:new AbortController().signal}), {code:"model_unavailable"});
    selectedBaseUrl = "https://example.invalid/v1";
    authenticatedBaseUrl = "https://coding.example.invalid/v1";
    await assert.rejects(host.run(request, {signal:new AbortController().signal}), {code:"model_unavailable"});
    assert.equal(callCount(),1, "coding-plan endpoints never reach the isolated model runner");
  } finally { await host.close(); }
});

test("configured model host runs isolated localhost SDK and cancellation reaps its connection", { skip: !process.env.EDUPI_CORE_ROOT }, async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "edupi-model-host-"));
  let hang = false, calls = 0, received, onRequest, onHangClosed;
  const server = http.createServer(async (req, res) => {
    let raw = ""; for await (const chunk of req) raw += chunk;
    calls++; received = JSON.parse(raw);
    if (hang) res.once("close", () => onHangClosed?.());
    onRequest?.();
    assert.equal(req.headers.authorization, "Bearer isolated-test-credential");
    if (hang) return;
    const output = JSON.stringify({ artifacts: [{ title: "Outline", content: "Use the supplied cube material.", source_ids: ["material"] }] });
    const chunk = (delta, finish_reason) => `data: ${JSON.stringify({ id: "local", object: "chat.completion.chunk", created: 1, model: "local", choices: [{ index: 0, delta, finish_reason }] })}\n\n`;
    res.writeHead(200, { "content-type": "text/event-stream" });
    res.write(chunk({ role: "assistant", content: output }, null)); res.write(chunk({}, "stop")); res.end("data: [DONE]\n\n");
  });
  await new Promise(resolve => server.listen(0, "127.0.0.1", resolve));
  const agentDir = path.join(root, "agent"); fs.mkdirSync(agentDir);
  fs.writeFileSync(path.join(agentDir, "settings.json"), JSON.stringify({ defaultProvider: "local", defaultModel: "local" }));
  fs.writeFileSync(path.join(agentDir, "auth.json"), JSON.stringify({ local: { type: "api_key", key: "isolated-test-credential" } }));
  const config = { providers: { local: { baseUrl: `http://localhost:${server.address().port}/v1`, api: "openai-completions", models: [{ id: "local", name: "local", reasoning: false, input: ["text"], cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 }, contextWindow: 32000, maxTokens: 128 }] } } };
  fs.writeFileSync(path.join(agentDir, "models.json"), JSON.stringify(config));
  const host = createRuntimeModelHost({ coreRoot: process.env.EDUPI_CORE_ROOT, projectRoot: root, agentDir });
  try {
    const core = name => import(pathToFileURL(path.join(process.env.EDUPI_CORE_ROOT, "scripts", name)).href);
    const { buildHarnessLeaseRequest } = await core("core_runtime_harness.mjs");
    const { buildG1LiveRequest } = await core("core_runtime_model_adapter.mjs");
    const hash = text => `sha256:${crypto.createHash("sha256").update(text).digest("hex")}`;
    const request = () => buildG1LiveRequest({ lease: buildHarnessLeaseRequest({ lease_id: "lease", work_case_id: "work", execution_fingerprint: hash("execution"), attempt: 1, claim_token_hash: hash("claim"), fencing_generation: 1, source_revision: "revision", deadline_at: new Date(Date.now() + 20000).toISOString(), input: { work_case_id: "work", task_id: "task", title: "Cube", summary: "Synthetic", reason: "confirmed", due_at: "2026-09-08", source_semantic_fingerprint: hash("source"), source_revision: "revision", deliverables: ["Outline"] } }), materials: [{ source_id: "material", revision: "revision", content: "Cube material", sha256: hash("Cube material") }] });
    const result = await host.run(request(), { signal: new AbortController().signal });
    assert.equal(result.ok, true, JSON.stringify(result));
    assert.equal(result.capability_version, "g1-live-v1");
    assert.equal(result.output.artifacts[0].source_ids[0], "material");
    assert.equal(JSON.stringify(result).includes("isolated-test-credential"), false);
    assert.equal(received.tools, undefined);
    assert.equal(fs.existsSync(path.join(agentDir, "sessions")), false);
    await assert.rejects(host.run({ ...request(), baseUrl: "http://untrusted.example/v1" }, { signal: new AbortController().signal }), { code: "invalid_lease" });
    assert.equal(calls, 1, "request payload cannot select or override the configured endpoint");
    hang = true;
    const hangClosed = new Promise(resolve => { onHangClosed = resolve; });
    const cancel = new AbortController(); onRequest = () => cancel.abort();
    assert.equal((await host.run(request(), { signal: cancel.signal })).error_code, "cancelled");
    await hangClosed;
    config.providers.local.headers = { "X-Unsupported": "do-not-drop" };
    fs.writeFileSync(path.join(agentDir, "models.json"), JSON.stringify(config));
    assert.equal((await host.run(request(), { signal: new AbortController().signal })).error_code, "model_unavailable");
    assert.equal(calls, 2);
  } finally { await host.close(); server.closeAllConnections(); await new Promise(resolve => server.close(resolve)); fs.rmSync(root, { recursive: true, force: true }); }
});

test("parent broker only accepts model messages and cancels pending work on disconnect", async () => {
  const child = new EventEmitter(); child.connected = true;
  const sent = []; child.send = (value, callback) => { sent.push(value); callback?.(); };
  let signal, closeCount = 0;
  const broker = attachRuntimeModelHost(child, { run: (_request, options) => { signal = options.signal; return new Promise(resolve => signal.addEventListener("abort", () => resolve({ ok: false, error_code: "cancelled" }))); }, close: async () => { closeCount++; } });
  child.emit("message", { type: "runtime-ready", id: "unrelated", request: {} });
  assert.equal(signal, undefined);
  child.emit("message", { type: "model-run", id: "run-1", request: {} });
  assert.equal(signal.aborted, false);
  child.connected = false; child.emit("disconnect");
  await broker.close();
  assert.equal(signal.aborted, true);
  assert.equal(closeCount, 1);
  assert.deepEqual(sent, []);
});

test("parent private config broker rejects caller overrides and replay and cancels pending configuration", async () => {
  const child = new EventEmitter(); child.connected = true;
  const sent = []; child.send = (value, callback) => { sent.push(value); callback?.(); };
  let calls = 0, signal, resolveConfiguration;
  const config = { model: { id: "test", name: "test", provider: "test", api: "openai-completions", baseUrl: "https://example.invalid/v1", reasoning: false,
    input: ["text"], cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 }, contextWindow: 32000, maxTokens: 4096 }, apiKey: "synthetic-key", maxTokens: 4096, allowLoopback: false };
  const host = { run: async () => ({}), configuration: options => { calls++; signal = options.signal; return new Promise(resolve => { resolveConfiguration = resolve; }); }, close: async () => {} };
  const broker = attachRuntimeModelHost(child, host);
  const flush = () => new Promise(resolve => setImmediate(resolve));
  try {
    child.emit("message", { type: "model-config-request", id: "invalid", model: { baseUrl: "https://caller.invalid" } });
    child.emit("message", { type: "model-config-request", id: "x".repeat(101) });
    assert.equal(calls, 0);
    child.emit("message", { type: "model-config-request", id: "config-1" });
    assert.equal(calls, 1);
    child.emit("message", { type: "model-config-request", id: "config-1" });
    assert.equal(calls, 1);
    resolveConfiguration(config); await flush();
    assert.deepEqual(sent, [{ type: "model-config-result", id: "config-1", configuration: config }]);
    child.emit("message", { type: "model-config-request", id: "config-1" }); await flush();
    assert.equal(calls, 1, "a completed request ID cannot fetch credentials again");
    child.emit("message", { type: "model-config-request", id: "cancel-1" });
    child.emit("message", { type: "model-config-cancel", id: "cancel-1" });
    assert.equal(signal.aborted, true);
    resolveConfiguration(config); await flush();
    assert.equal(sent.filter(value => value.type === "model-config-result").length, 1);
    child.emit("message", { type: "model-config-request", id: "disconnect-1" });
    child.connected = false; child.emit("disconnect");
    assert.equal(signal.aborted, true);
    resolveConfiguration(config); await flush();
  } finally { await broker.close(); }
});

test("loopback URL validation keeps IPv6 localhost eligible for the isolated host", async () => {
  const source = fs.readFileSync(new URL("./edupi-runtime-model-host.ts", import.meta.url), "utf8");
  assert.match(source, /\["localhost", "127\.0\.0\.1", "::1", "\[::1\]"\]/);
});

test("recall model requests keep a shared bounded attempt budget and drain unfinished work", { timeout: 30000 }, async t => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "edupi-recall-model-unit-"));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  fs.mkdirSync(path.join(root, "scripts"));
  fs.writeFileSync(path.join(root, "package.json"), '{"type":"module"}');
  fs.writeFileSync(path.join(root, "scripts/core_runtime_model_adapter.mjs"), 'export function buildG1LiveRequest(){throw new Error("recall must not acquire G1 leases")}');
  fs.writeFileSync(path.join(root, "scripts/core_runtime_isolated_model.mjs"), `
    let calls = 0, release, hold = false, began;
    export const count = () => calls;
    export const holdNext = () => { hold = true; return new Promise(resolve => { began = resolve; }); };
    export const finish = () => release();
    export function createIsolatedG1ModelRunner(config) {
      if (config.maxCalls !== 1 || config.maxTokens !== 4096 || config.timeoutMs > 12000 || config.temperature !== 0 || config.apiKey !== 'synthetic-key') throw new Error('unbounded recall');
      let completion;
      const run = async ({prompt, signal}) => {
        if (signal.aborted) throw new Error('cancelled');
        calls++;
        if (hold) { hold = false; completion = new Promise(resolve => { release = () => resolve({output: prompt}); }); began(); return completion; }
        return {output: prompt};
      };
      run.waitForIdle = () => completion || Promise.resolve();
      return run;
    }
  `);
  fs.writeFileSync(path.join(root, "settings.json"), JSON.stringify({ defaultProvider: "recall-unit", defaultModel: "synthetic" }));
  fs.writeFileSync(path.join(root, "auth.json"), JSON.stringify({ "recall-unit": { type: "api_key", key: "synthetic-key" } }));
  fs.writeFileSync(path.join(root, "models.json"), JSON.stringify({ providers: { "recall-unit": {
    api: "openai-completions", baseUrl: "https://example.invalid/v1", models: [{ id: "synthetic", name: "Synthetic", reasoning: false,
      input: ["text"], cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 }, contextWindow: 32000, maxTokens: 8192 }],
  } } }));
  const synthetic = await import(pathToFileURL(path.join(root, "scripts/core_runtime_isolated_model.mjs")).href);
  const open = () => createRuntimeModelHost({ coreRoot: root, projectRoot: root, agentDir: root });
  const request = () => ({ model_kind: "memory_recall", prompt: "Current source text only", deadline_at: new Date(Date.now() + 11000).toISOString() });
  const invoke = (host, controller = new AbortController()) => host.run(request(), { signal: controller.signal });
  const first = open(), peer = open();
  try {
    assert.deepEqual(await invoke(first), { output: "Current source text only" });
    await assert.rejects(first.run({ ...request(), maxCalls: 1000 }, { signal: new AbortController().signal }), { code: "invalid_model_request" });
    await assert.rejects(first.run({ ...request(), deadline_at: new Date(Date.now() + 30000).toISOString() }, { signal: new AbortController().signal }), { code: "invalid_model_request" });
    const cancelled = new AbortController(); cancelled.abort();
    await assert.rejects(invoke(first, cancelled), { code: "cancelled" });
    assert.equal(synthetic.count(), 1);
    const began = synthetic.holdNext(), controller = new AbortController();
    const pending = invoke(first, controller); await began;
    controller.abort();
    await assert.rejects(invoke(peer), { code: "model_unavailable" });
    let drained = false; const closing = first.close().then(() => { drained = true; });
    await new Promise(resolve => setTimeout(resolve, 15));
    assert.equal(drained, false, "abort alone must not release the unfinished backend or its budget slot");
    synthetic.finish(); await pending; await closing;
    for (let index = 2; index < 64; index++) await invoke(peer);
    assert.equal(synthetic.count(), 64);
    await assert.rejects(invoke(peer), { code: "model_unavailable" });
    await peer.close();
    const restarted = open();
    try { await assert.rejects(invoke(restarted), { code: "model_unavailable" }); assert.equal(synthetic.count(), 64); }
    finally { await restarted.close(); }
  } finally { await first.close(); await peer.close(); }
});

// R04 uses the actual host run/broker and actual config/authorization/question
// modules. Only SDK configuration and the isolated runner are synthetic.
// Static and dynamic imports are allowlisted: this harness cannot load a real
// Core runner, model runtime, application root, or network client.
const recallJiti = createJiti(import.meta.url, { fsCache: false });
const recallConfig = await recallJiti.import("./edupi-recall-config.ts");
const recallAuthorization = await recallJiti.import("./edupi-recall-authorization.ts");
const recallState = await recallJiti.import("./edupi-recall-state.ts");
const trustedRecall = { approveNormal: () => true };
const recallQuestion = "  合成问题：\n谁主持第 2 次班会？  ";
const recallHash = value => `sha256:${crypto.createHash("sha256").update(value, "utf8").digest("hex")}`;
const deferred = () => {
  let resolve;
  const promise = new Promise(done => { resolve = done; });
  return { promise, resolve };
};
const forbiddenRecallDependency = () => assert.fail("real SDK/runtime access is forbidden in R04 host tests");

function compileRecallHost() {
  let removedFences = 0;
  const mutant = process.env.EDUPI_RECALL_HOST_TEST_MUTANT === "1";
  const output = ts.transpileModule(fs.readFileSync(new URL("./edupi-runtime-model-host.ts", import.meta.url), "utf8"), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, esModuleInterop: true },
    transformers: { before: [context => {
      const containsActivationRead = node => ts.isCallExpression(node)
        && ts.isIdentifier(node.expression) && node.expression.text === "readEduPiRecallActivation"
        || Boolean(ts.forEachChild(node, containsActivationRead));
      const visit = node => {
        // Opt-in red check, entirely in memory. The production source is never
        // rewritten; only the final post-await activation fence is removed.
        if (mutant && ts.isIfStatement(node) && ts.isIdentifier(node.expression)
          && node.expression.text === "answer" && containsActivationRead(node.thenStatement)) {
          removedFences++;
          return ts.factory.createEmptyStatement();
        }
        if (ts.isCallExpression(node) && node.expression.kind === ts.SyntaxKind.ImportKeyword) {
          return ts.factory.updateCallExpression(node, ts.factory.createIdentifier("importRecallDependency"), node.typeArguments, node.arguments);
        }
        return ts.visitEachChild(node, visit, context);
      };
      return source => ts.visitNode(source, visit);
    }] },
  }).outputText;
  if (mutant) assert.equal(removedFences, 1, "the red variant must remove exactly the last activation fence");
  return output;
}
const compiledRecallHost = compileRecallHost();

async function recallHostFixture(t, { mode = "normal", limit = 2 } = {}) {
  const root = fs.mkdtempSync(path.join(fs.realpathSync(os.tmpdir()), "edupi-r04-model-host-"));
  const dataRoot = path.join(root, "data"), stateDir = path.join(root, "state");
  const coreRoot = path.join(root, "core"), agentDir = path.join(root, "agent");
  const f = {
    root, dataRoot, stateDir, coreRoot, agentDir, hosts: [], brokers: [], gates: [], holds: [],
    env: mode === "canary" ? { EDUPI_CORE_RECALL_ANSWERS: "1", EDUPI_DESKTOP_ISOLATED_CANARY: "1" } : {},
    approveNormal: true, activations: [], reservations: [], marks: [], stateEvents: [], configurationReads: 0,
  };
  t.after(async () => {
    for (const gate of f.gates) gate.resume.resolve();
    for (const hold of f.holds) hold.completion.resolve({ output: "synthetic-recall-answer" });
    try {
      await Promise.all(f.brokers.map(broker => broker.close()));
      await Promise.all(f.hosts.map(host => host.close()));
    } finally {
      recallState.clearEduPiRecallQuestions(dataRoot);
      fs.rmSync(root, { recursive: true, force: true });
      assert.equal(fs.existsSync(root), false);
    }
  });
  for (const directory of [dataRoot, stateDir, coreRoot, agentDir, path.join(coreRoot, "scripts")]) {
    fs.mkdirSync(directory, { mode: 0o700 });
  }
  fs.writeFileSync(path.join(coreRoot, "package.json"), '{"type":"module"}');
  fs.writeFileSync(path.join(coreRoot, "scripts/core_runtime_model_adapter.mjs"),
    'export function buildG1LiveRequest() { throw new Error("R04 must not enter G1"); }');
  const runnerUrl = pathToFileURL(path.join(coreRoot, "scripts/core_runtime_isolated_model.mjs")).href;
  fs.writeFileSync(new URL(runnerUrl), `
    import assert from "node:assert/strict";
    export const control = { calls: [], configurations: [], next: null };
    export function createIsolatedG1ModelRunner(configuration) {
      assert.equal(configuration.apiKey, "synthetic-r04-key");
      assert.equal(configuration.maxCalls, 1);
      assert.equal(configuration.maxTokens, 4096);
      assert.equal(configuration.temperature, 0);
      assert.ok(configuration.timeoutMs > 0 && configuration.timeoutMs <= 12000);
      control.configurations.push(configuration);
      const hold = control.next; control.next = null;
      let completion = Promise.resolve();
      const run = async ({ prompt, signal }) => {
        assert.equal(signal.aborted, false);
        control.calls.push({ prompt, signal });
        if (hold) {
          completion = hold.completion.promise;
          hold.started.resolve();
          return await completion;
        }
        return { output: "synthetic-recall-answer" };
      };
      run.waitForIdle = () => completion;
      return run;
    }
  `);
  f.runner = (await import(runnerUrl)).control;
  f.configuration = {
    model: {
      id: "r04-synthetic", name: "R04 Synthetic", provider: "r04-test", api: "openai-completions",
      baseUrl: "https://r04-model.invalid/v1", reasoning: false, input: ["text"],
      cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 }, contextWindow: 32000, maxTokens: 8192,
    },
    apiKey: "synthetic-r04-key", maxTokens: 8192, allowLoopback: false,
  };
  // A full, protocol-valid snapshot, never SDK/auth resolution.
  privateModelProtocol.validatePrivateModelConfiguration(f.configuration);
  f.normalInput = {
    enabled: true, purpose: "r04_recall_answer", ownerId: "r04-test-owner", grantId: "r04_recall_aabbcc",
    grantVersion: 1, scope: { classId: "synthetic-class", subject: "数学", termId: "synthetic-term" },
    model: { provider: f.configuration.model.provider, modelId: f.configuration.model.id },
    budgetId: "r04_recall_budget_aabbcc", limit, validUntil: new Date(Date.now() + 3_600_000).toISOString(),
    consentId: "r04-test-consent",
  };
  f.options = () => ({ dataRoot, stateDir, env: f.env });
  f.writeConfig = async input => {
    f.currentConfig = await recallConfig.writeEduPiRecallConfig(input, {
      ...f.options(), expectedUpdatedAt: f.currentConfig?.updatedAt ?? null,
    }, trustedRecall);
    return f.currentConfig;
  };
  if (mode === "normal") await f.writeConfig(f.normalInput);
  const hostOptions = options => {
    assert.equal(options.dataRoot, dataRoot);
    return { ...options, stateDir, env: f.env };
  };
  const dependencies = {
    "node:path": path,
    "node:fs": { existsSync: file => {
      assert.equal(file, path.join(process.cwd(), "scripts/core_runtime_model_adapter.mjs"));
      return false;
    } },
    "node:crypto": { createHash: crypto.createHash },
    "node:util": { isDeepStrictEqual },
    "node:url": { pathToFileURL },
    "@earendil-works/pi-coding-agent": {
      getAgentDir: forbiddenRecallDependency,
      SettingsManager: { create: forbiddenRecallDependency },
      ModelRuntime: { create: forbiddenRecallDependency },
    },
    "./model-setup-presets": { isTeachingModelIneligible: forbiddenRecallDependency },
    "../desktop/core-runtime-model-config.mjs": privateModelProtocol,
    "./edupi-runtime-model-config": { readRuntimeModelConfiguration: async options => {
      assert.equal(options.projectRoot, dataRoot);
      assert.equal(options.agentDir, agentDir);
      f.configurationReads++;
      if (f.configurationGate) {
        f.configurationGate.entered.resolve();
        await f.configurationGate.resume.promise;
      }
      return structuredClone(f.configuration);
    } },
    "./edupi-recall-config": { readEduPiRecallActivation: options => {
      const result = recallConfig.readEduPiRecallActivation(hostOptions(options), { approveNormal: () => f.approveNormal });
      f.activations.push(result);
      return result;
    } },
    "./edupi-recall-authorization": {
      reserveRecallModelAttempt: async (input, options) => {
        const permit = await recallAuthorization.reserveRecallModelAttempt(input, hostOptions(options), {
          approveNormal: () => f.approveNormal,
        });
        f.reservations.push({ input, permit });
        if (f.reserveGate) {
          f.reserveGate.entered.resolve(permit);
          await f.reserveGate.resume.promise;
        }
        return permit;
      },
      markRecallModelAttempt: async (input, options) => {
        const result = await recallAuthorization.markRecallModelAttempt(input, hostOptions(options));
        f.marks.push(input);
        return result;
      },
    },
    "./edupi-recall-state": {
      claimEduPiRecallQuestion: recallState.claimEduPiRecallQuestion,
      settleEduPiRecallModel: (token, requestId) => {
        f.stateEvents.push({ type: "settle", token, requestId });
        return recallState.settleEduPiRecallModel(token, requestId);
      },
      clearEduPiRecallQuestions: value => {
        assert.equal(value, dataRoot);
        f.stateEvents.push({ type: "clear" });
        return recallState.clearEduPiRecallQuestions(value);
      },
    },
  };
  const testModule = { exports: {} };
  const importRecallDependency = async specifier => {
    assert.equal(specifier, runnerUrl, "only this test's newly written runner may be imported");
    if (f.importGate) {
      f.importGate.entered.resolve();
      await f.importGate.resume.promise;
    }
    return import(specifier);
  };
  // Transform dynamic import syntax only, so it passes through the same strict
  // allowlist as static imports; every run/failure/reserve/settle branch is real.
  new Function("require", "module", "exports", "globalThis", "importRecallDependency", compiledRecallHost)(name => {
    assert.ok(Object.hasOwn(dependencies, name), `unexpected R04 host dependency: ${name}`);
    return dependencies[name];
  }, testModule, testModule.exports, {}, importRecallDependency);
  f.open = () => {
    const host = testModule.exports.createRuntimeModelHost({ coreRoot, projectRoot: dataRoot, agentDir });
    f.hosts.push(host);
    return host;
  };
  f.host = f.open();
  f.broker = child => {
    const broker = testModule.exports.attachRuntimeModelHost(child, f.host);
    f.brokers.push(broker);
    return broker;
  };
  f.pause = phase => {
    const gate = { entered: deferred(), resume: deferred() };
    f.gates.push(gate);
    f[`${phase}Gate`] = gate;
    return gate;
  };
  f.holdRunner = () => {
    const hold = { started: deferred(), completion: deferred() };
    f.holds.push(hold);
    f.runner.next = hold;
    return hold;
  };
  f.request = (query = recallQuestion) => ({
    model_kind: "recall_answer",
    prompt: `Select exactly one current case from synthetic current sources.\nUNTRUSTED_INPUT_JSON:\n${JSON.stringify({ query })}`,
    deadline_at: new Date(Date.now() + 11_000).toISOString(),
  });
  f.run = (requestId, controller = new AbortController(), query = recallQuestion) =>
    f.host.run(f.request(query), { signal: controller.signal, requestId });
  f.prepare = (clientRequestId, overrides = {}) => {
    const binding = f.currentConfig?.enabled ? f.currentConfig : f.normalInput;
    return recallAuthorization.prepareRecallIntent({
      sessionId: "r04-synthetic-session", clientRequestId, rawQuery: recallQuestion, ownerId: binding.ownerId,
      grantId: binding.grantId, grantVersion: binding.grantVersion, scope: binding.scope, configConsentId: binding.consentId,
      ...overrides,
    }, f.options(), trustedRecall);
  };
  f.capture = async (clientRequestId, overrides = {}) => {
    const intent = await f.prepare(clientRequestId, overrides);
    const registration = {
      messageRef: `owner_message:${recallHash(clientRequestId).slice(7)}`, producerEpoch: "e".repeat(64),
      sequence: 1, fencingGeneration: 1, instanceNonce: "r04-synthetic-instance",
    };
    return recallAuthorization.markCapturedRecallIntent({
      intentId: intent.intentId, messageRef: registration.messageRef, registration,
    }, f.options(), trustedRecall);
  };
  f.begin = intent => recallState.beginEduPiRecallQuestion(dataRoot, intent.intentId, intent.queryHash);
  f.budget = () => recallAuthorization.readRecallBudget(f.normalInput.budgetId, f.options());
  f.ledgerBytes = () => fs.readFileSync(path.join(stateDir, "edupi-recall-authorization.json"), "utf8");
  return f;
}

async function reachRecallGate(gate, operation) {
  return Promise.race([gate.entered.promise, operation.then(
    () => assert.fail("host completed before reaching the expected await"),
    error => assert.fail(`host rejected before reaching the expected await: ${error.code ?? error}`),
  )]);
}

// A fresh process has no model-host budget map or question state. It reads the
// real ledger and can ask the real authorizer to reject replays/overspending.
async function coldRecallBudget(f, requests = []) {
  const source = `
    import { createJiti } from "jiti";
    const [modulePath, payload] = process.argv.slice(1);
    const auth = await createJiti(import.meta.url, { fsCache: false }).import(modulePath);
    const { options, budgetId, requests } = JSON.parse(payload), permits = [];
    for (const input of requests) permits.push(await auth.reserveRecallModelAttempt(input, options, { approveNormal: () => true }));
    console.log(JSON.stringify({ budget: auth.readRecallBudget(budgetId, options), permits }));
  `;
  const { stdout } = await promisify(execFile)(process.execPath, ["--input-type=module", "-e", source,
    path.resolve("lib/edupi-recall-authorization.ts"), JSON.stringify({
      options: f.options(), budgetId: f.normalInput.budgetId, requests,
    })], { cwd: process.cwd(), env: {}, timeout: 15_000, maxBuffer: 256_000 });
  return JSON.parse(stdout);
}

for (const phase of ["configuration", "import"]) {
  for (const withdrawal of ["stop", "safe-mode", "normal-mode"]) {
    test(`R04 canary ${phase} await fences ${withdrawal} before the runner`, { timeout: 15_000 }, async t => {
      const f = await recallHostFixture(t, { mode: "canary" }), gate = f.pause(phase);
      const pending = f.run(`canary-${phase}-${withdrawal}`);
      await reachRecallGate(gate, pending);
      assert.equal(f.activations[0].enabled, true);
      assert.equal(f.activations[0].mode, "canary");
      if (withdrawal === "stop") await f.writeConfig({ enabled: false });
      else if (withdrawal === "safe-mode") f.env.EDUPI_SAFE_MODE = "1";
      else await f.writeConfig(f.normalInput);
      gate.resume.resolve();
      const error = await pending.then(() => null, error => error);
      assert.equal(f.runner.calls.length, 0, "a withdrawn activation must never invoke the runner");
      assert.equal(error?.code, "model_unavailable");
      assert.equal(f.reservations.length, 0, "canary is not a persistent normal permit");
      if (withdrawal === "stop") {
        assert.equal(recallConfig.readEduPiRecallActivation(f.options(), trustedRecall).reason, "stopped");
      }
    });
  }
}

for (const withdrawal of ["stop", "safe-mode", "config-change", "same-config-rewrite", "cancel"]) {
  test(`R04 normal durable reserve await fences ${withdrawal} and never refunds unknown`, { timeout: 15_000 }, async t => {
    const f = await recallHostFixture(t, { limit: 1 }), intent = await f.capture("reserved-question");
    const token = f.begin(intent), gate = f.pause("reserve"), controller = new AbortController();
    const requestId = `normal-reserved-${withdrawal}`, pending = f.run(requestId, controller);
    const permit = await reachRecallGate(gate, pending);
    assert.equal(permit.permitted, true, "the actual authorizer must fsync a permit before withdrawal");
    assert.equal(f.budget().used, 1);
    assert.equal(f.budget().attempts[0].status, "unknown");
    if (withdrawal === "stop") await f.writeConfig({ enabled: false });
    else if (withdrawal === "safe-mode") f.env.EDUPI_SAFE_MODE = "1";
    else if (withdrawal === "config-change") {
      await f.writeConfig({ ...f.normalInput, scope: { ...f.normalInput.scope, termId: "changed-term" } });
    } else if (withdrawal === "same-config-rewrite") await f.writeConfig(f.normalInput);
    else { recallState.finishEduPiRecallQuestion(token, false); controller.abort(); }
    gate.resume.resolve();
    const error = await pending.then(() => null, error => error);
    assert.equal(f.runner.calls.length, 0, "a durable permit cannot bypass the final activation/cancellation fence");
    assert.equal(error?.code, withdrawal === "cancel" ? "cancelled" : "model_unavailable");
    assert.deepEqual(f.marks, []);
    assert.equal(f.budget().used, 1);
    assert.equal(f.budget().attempts[0].status, "unknown");
    assert.ok(f.stateEvents.some(event => event.type === "settle" && event.token === token && event.requestId === requestId));
    await f.host.close();
    delete f.env.EDUPI_SAFE_MODE;
    await f.writeConfig(f.normalInput);
    const retry = await f.capture("retry-after-restart");
    f.host = f.open();
    f.begin(retry);
    await assert.rejects(f.run(requestId), { code: "model_unavailable" });
    assert.equal(f.reservations.at(-1).permit.reason, "recall_request_replayed");
    f.begin(retry);
    await assert.rejects(f.run("normal-after-restart"), { code: "model_unavailable" });
    assert.equal(f.reservations.at(-1).permit.reason, "recall_budget_exhausted");
    const replay = { requestId, intentId: retry.intentId, queryHash: retry.queryHash,
      purpose: "r04_recall_answer", model: { provider: f.configuration.model.provider, id: f.configuration.model.id } };
    const cold = await coldRecallBudget(f, [replay, { ...replay, requestId: "cold-over-budget" }]);
    assert.equal(cold.budget.used, 1);
    assert.equal(cold.budget.remaining, 0);
    assert.deepEqual(cold.budget.attempts.map(attempt => attempt.status), ["unknown"]);
    assert.deepEqual(cold.permits.map(value => value.reason), ["recall_request_replayed", "recall_budget_exhausted"]);
    await assert.rejects(recallAuthorization.markRecallModelAttempt({ requestId, status: "refunded" }, f.options()),
      { code: "recall_invalid_input" });
    assert.equal(f.runner.calls.length, 0);
    assert.equal(f.budget().used, 1);
  });
}

test("R04 normal broker binds IPC to exact same-text intents and consumes persistent N, not legacy 64", { timeout: 15_000 }, async t => {
  const f = await recallHostFixture(t), first = await f.capture("first-question");
  f.begin(first);
  assert.deepEqual(await f.run("normal-first"), { output: "synthetic-recall-answer" });
  assert.equal(f.budget().used, 1);
  assert.equal(f.budget().attempts[0].intentId, first.intentId);
  assert.equal(f.budget().attempts[0].queryHash, recallHash(recallQuestion));
  const second = await f.capture("second-question");
  assert.notEqual(first.intentId, second.intentId);
  assert.equal(first.queryHash, second.queryHash);
  const child = new EventEmitter(); child.connected = true;
  let response;
  child.send = (value, callback) => { response.resolve(value); callback?.(); };
  f.broker(child);
  const dispatch = async id => {
    response = deferred();
    child.emit("message", { type: "model-run", id, request: f.request() });
    const result = await response.promise;
    // The broker removes its pending IPC entry in the following microtask.
    await new Promise(resolve => setImmediate(resolve));
    return result;
  };
  f.begin(second);
  assert.deepEqual(await dispatch("normal-second"), {
    type: "model-result", id: "normal-second", result: { output: "synthetic-recall-answer" },
  });
  assert.deepEqual(f.budget().attempts.map(attempt => [attempt.requestId, attempt.intentId, attempt.status]), [
    ["normal-first", first.intentId, "used"], ["normal-second", second.intentId, "used"],
  ]);
  assert.equal(f.reservations[1].input.intentId, second.intentId);
  const before = f.ledgerBytes(), reads = f.configurationReads;
  // Receipt/person revalidation uses these read-only authorization primitives;
  // it never dispatches a model kind.
  for (const selector of [{ intentId: first.intentId },
    { sessionId: second.sessionId, clientRequestId: second.clientRequestId }]) {
    for (let i = 0; i < 3; i++) {
      assert.equal(recallAuthorization.readRecallIntent(selector, f.options(), trustedRecall).readyForDispatch, true);
      assert.equal(f.budget().used, 2);
    }
  }
  assert.equal(f.ledgerBytes(), before);
  assert.equal(f.configurationReads, reads);
  f.begin(second);
  assert.deepEqual(await dispatch("normal-second"), { type: "model-error", id: "normal-second", code: "model_unavailable" });
  assert.equal(f.reservations.at(-1).permit.reason, "recall_request_replayed");
  const third = await f.capture("third-question"); f.begin(third);
  await assert.rejects(f.run("normal-over-N"), { code: "model_unavailable" });
  assert.equal(f.reservations.at(-1).permit.reason, "recall_budget_exhausted");
  assert.equal(f.runner.calls.length, 2);
  assert.equal(f.budget().remaining, 0);
  assert.equal((await coldRecallBudget(f)).budget.used, 2);
});

for (const invalid of ["release-gate", "prepared", "wrong-model", "wrong-scope", "missing-ipc", "untrusted-prompt", "wrong-query"]) {
  test(`R04 normal ${invalid} cannot reach the runner without a persistent permit`, { timeout: 15_000 }, async t => {
    const f = await recallHostFixture(t);
    const intent = invalid === "prepared" ? await f.prepare("invalid-question") : await f.capture("invalid-question");
    f.begin(intent);
    if (invalid === "release-gate") {
      assert.equal(recallConfig.EDUPI_RECALL_NORMAL_RELEASE_APPROVED, false);
      assert.equal(recallConfig.readEduPiRecallActivation(f.options()).reason, "normal_not_approved");
      f.approveNormal = false;
    } else if (invalid === "wrong-model") f.configuration.model.id = "wrong-model";
    else if (invalid === "wrong-scope") {
      await f.writeConfig({ ...f.normalInput, scope: { ...f.normalInput.scope, classId: "other-class" } });
      await f.capture("current-scope-same-text");
    }
    const request = f.request(invalid === "wrong-query" ? recallQuestion.trim() : recallQuestion);
    if (invalid === "untrusted-prompt") request.prompt = `UNTRUSTED_INPUT_JSON:\n${JSON.stringify({ query: recallQuestion })}`;
    await assert.rejects(f.host.run(request, {
      signal: new AbortController().signal, requestId: invalid === "missing-ipc" ? undefined : `invalid-${invalid}`,
    }), { code: "model_unavailable" });
    assert.equal(f.runner.calls.length, 0);
    assert.equal(f.budget(), null);
    if (["prepared", "wrong-scope"].includes(invalid)) assert.equal(f.reservations.at(-1).permit.reason, "recall_intent_unavailable");
    if (invalid === "wrong-model") assert.equal(f.reservations.at(-1).permit.reason, "recall_binding_mismatch");
  });
}

test("R04 normal simultaneous same-text questions are ambiguous until the unclaimed terminal is released", { timeout: 15_000 }, async t => {
  const f = await recallHostFixture(t), first = await f.capture("same-text-first"), second = await f.capture("same-text-second");
  const firstToken = f.begin(first); f.begin(second);
  await assert.rejects(f.run("ambiguous-ipc"), { code: "model_unavailable" });
  assert.equal(f.reservations.length, 0);
  assert.equal(f.runner.calls.length, 0);
  recallState.finishEduPiRecallQuestion(firstToken, true);
  assert.deepEqual(await f.run("exact-second-ipc"), { output: "synthetic-recall-answer" });
  assert.equal(f.budget().attempts[0].intentId, second.intentId);
  assert.equal(f.budget().used, 1);
});

test("R04 normal cancelled unclaimed tombstone cannot lend authorization to the next same-text question", { timeout: 15_000 }, async t => {
  const f = await recallHostFixture(t), first = await f.capture("cancelled-first"), second = await f.capture("next-same-text");
  const tombstone = f.begin(first);
  recallState.finishEduPiRecallQuestion(tombstone, false);
  const next = f.begin(second);
  for (const requestId of ["late-cancelled-ipc", "new-question-ipc"]) {
    await assert.rejects(f.run(requestId), { code: "model_unavailable" });
  }
  recallState.finishEduPiRecallQuestion(next, true);
  await assert.rejects(f.run("tombstone-only-ipc"), { code: "model_unavailable" });
  assert.equal(f.reservations.length, 0);
  assert.equal(f.runner.calls.length, 0);
  assert.equal(f.budget(), null);
  await f.host.close();
  f.host = f.open(); f.begin(second);
  assert.deepEqual(await f.run("new-channel-ipc"), { output: "synthetic-recall-answer" });
  assert.equal(f.budget().attempts[0].intentId, second.intentId);
  assert.equal(f.budget().used, 1);
});

test("R04 normal actual completion settles a cancelled claim and close clears only after drain", { timeout: 15_000 }, async t => {
  const f = await recallHostFixture(t), first = await f.capture("running-first"), second = await f.capture("running-next");
  const token = f.begin(first), hold = f.holdRunner(), controller = new AbortController();
  const pending = f.run("running-ipc", controller);
  await reachRecallGate({ entered: hold.started }, pending);
  assert.equal(f.budget().used, 1);
  assert.equal(f.budget().attempts[0].status, "unknown");
  recallState.finishEduPiRecallQuestion(token, false); controller.abort(); f.begin(second);
  await assert.rejects(f.run("while-cancelled-still-running"), { code: "model_unavailable" });
  assert.equal(f.runner.calls.length, 1);
  assert.equal(f.reservations.length, 1);
  assert.deepEqual(f.stateEvents, []);
  let drained = false;
  const closing = f.host.close().then(() => { drained = true; });
  await new Promise(resolve => setImmediate(resolve));
  assert.equal(drained, false);
  assert.deepEqual(f.stateEvents, [], "close cannot erase tombstones or claims while actual work remains");
  hold.completion.resolve({ output: "synthetic-recall-answer" });
  await pending; await closing;
  assert.deepEqual(f.stateEvents, [{ type: "settle", token, requestId: "running-ipc" }, { type: "clear" }]);
  assert.equal(f.budget().used, 1);
  assert.equal(f.budget().attempts[0].status, "used");
  f.host = f.open(); f.begin(second);
  assert.deepEqual(await f.run("after-drain-ipc"), { output: "synthetic-recall-answer" });
  assert.equal(f.budget().used, 2);
  assert.equal(f.budget().attempts[1].intentId, second.intentId);
});
