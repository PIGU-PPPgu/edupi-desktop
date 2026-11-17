import assert from "node:assert/strict";
import { EventEmitter } from "node:events";
import { randomBytes } from "node:crypto";
import { fork } from "node:child_process";
import fs from "node:fs";
import http from "node:http";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { pathToFileURL } from "node:url";
import { createJiti } from "jiti";
import { startCoreRuntimeHost } from "./core-runtime-host.mjs";
import { validatePrivateRecallModelConfiguration } from "./core-runtime-model-config.mjs";

const configuration = () => ({ model: { id: "synthetic", name: "Synthetic", provider: "synthetic",
  api: "openai-completions", baseUrl: "https://example.invalid/v1", reasoning: false, input: ["text"],
  cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 }, contextWindow: 32000, maxTokens: 4096 },
  apiKey: "synthetic-private-key", maxTokens: 4096, allowLoopback: false });

function fixture(t) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "edupi-recall-answer-host-"));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  fs.mkdirSync(path.join(root, "scripts"));
  fs.writeFileSync(path.join(root, "scripts/recall_facet_answer_assessor.mjs"), `
    const brands = new WeakSet();
    export let factories = 0;
    export function createRecallFacetAnswerAssessor({ runModel, maxCalls, timeoutMs }) {
      if (maxCalls !== 64 || timeoutMs !== 12000) throw new Error("unbounded answer");
      factories++;
      let active = null;
      const assessor = {
        assess(request) { return active = runModel(request).finally(() => { active = null; }); },
        waitForIdle() { return active?.catch(() => {}) ?? Promise.resolve(); },
      };
      brands.add(assessor); return assessor;
    }
    export const isRecallFacetAnswerAssessor = value => brands.has(value);
  `);
  fs.writeFileSync(path.join(root, "scripts/recall_source_support.mjs"), `
    export function createRecallSupportAssessor({ runModel }) {
      return { assess: runModel, waitForIdle: async () => {} };
    }
  `);
  fs.writeFileSync(path.join(root, "scripts/core_runtime_daemon.mjs"), `
    import { isRecallFacetAnswerAssessor } from "./recall_facet_answer_assessor.mjs";
    export let received, closes = 0;
    export async function createCoreRuntimeDaemon(options) {
      if (Object.hasOwn(options, "recallAnswers") && !isRecallFacetAnswerAssessor(options.recallAnswers)) throw new Error("foreign answer brand");
      received = options; return { async close() { closes++; } };
    }
  `);
  const options = { dataRoot: root, token: "synthetic-token", supervisorSessionId: "synthetic-session",
    coreCommit: "a".repeat(40), componentManifestHash: `sha256:${"b".repeat(64)}`, port: 0,
    ambientPlanning: true, ownerMessageRegistration: true, ownerControlToken: "synthetic-owner-control" };
  function channel(config = configuration()) {
    const value = new EventEmitter(); value.connected = true; value.sent = [];
    value.send = (message, callback) => {
      value.sent.push(message); callback?.();
      if (message.type === "model-config-request") queueMicrotask(() => value.emit("message",
        config ? { type: "model-config-result", id: message.id, configuration: config }
          : { type: "model-config-error", id: message.id, code: "model_unavailable" }));
    };
    return value;
  }
  return { root, options, channel, module: () => import(pathToFileURL(path.join(root, "scripts/core_runtime_daemon.mjs")).href) };
}

test("answer host defaults to no profile reads, no answer factory and no inference", async t => {
  const f = fixture(t), channel = f.channel();
  const host = await startCoreRuntimeHost({ coreRoot: f.root, options: f.options }, channel);
  try {
    const { received } = await f.module();
    assert.equal(received.recallAnswers, undefined);
    assert.equal(typeof received.recallSupport.assess, "function", "existing source support stays available");
    assert.deepEqual(channel.sent, []);
    const assessor = await import(pathToFileURL(path.join(f.root, "scripts/recall_facet_answer_assessor.mjs")).href);
    assert.equal(assessor.factories, 0);
  } finally { await host.close(); }
});

test("answer bootstrap accepts only true with owner control, planning and registered messages", async t => {
  const f = fixture(t), channel = f.channel();
  for (const override of [{ recallAnswers: false }, { recallAnswers: 1 }, { recallAnswers: "1" },
    { recallAnswers: {} }, { recallAnswers: () => {} }, { ambientPlanning: undefined }, { ambientPlanning: false },
    { ownerMessageRegistration: undefined }, { ownerMessageRegistration: false },
    { ownerControlToken: undefined }, { ownerControlToken: "" }, { ownerControlToken: " " },
    { runModel: () => {} }, { apiKey: "untrusted" }, { model: {} }]) {
    await assert.rejects(startCoreRuntimeHost({ coreRoot: f.root,
      options: { ...f.options, recallAnswers: true, ...override } }, channel), /Invalid runtime bootstrap/);
  }
  assert.deepEqual(channel.sent, [], "invalid bootstrap cannot read a profile");
});

test("answer activation requires a complete private Live profile and preserves readable Core on failure", async t => {
  const f = fixture(t);
  const invalidProfiles = [null, ...[
    value => { delete value.model.cost; }, value => { value.model.cost.input = -1; },
    value => { value.model.cost.output = "0"; }, value => { value.model.cost.extra = 0; },
    value => { value.model.input = ["text", "image"]; }, value => { value.model.contextWindow = 100_000_001; },
    value => { value.model.maxTokens = 40000; }, value => { value.apiKey = "  "; },
    value => { value.apiKey = "synthetic\tkey"; }, value => { value.model.provider = " provider"; },
    value => { value.model.api = "openai-codex-responses"; }, value => { value.model.headers = { Authorization: "synthetic" }; },
    value => { value.model.baseUrl = "https://user:synthetic@example.invalid/v1"; },
    value => { value.maxCalls = 1000; },
  ].map(change => { const value = configuration(); change(value); return value; })];
  for (const config of invalidProfiles) {
    const channel = f.channel(config);
    const host = await startCoreRuntimeHost({ coreRoot: f.root, options: { ...f.options, recallAnswers: true } }, channel);
    try {
      const { received } = await f.module();
      assert.equal(received.recallAnswers, undefined, "unavailable profiles cannot look active");
      assert.equal(received.ownerMessageRegistration, true);
      assert.equal(received.ownerControlToken, f.options.ownerControlToken);
      assert.equal(typeof received.recallSupport.assess, "function");
      assert.deepEqual(channel.sent.map(value => value.type), ["model-config-request"]);
    } finally { await host.close(); }
  }
});

test("loopback answer profiles require both private opt-in and the explicit isolated canary", async t => {
  const f = fixture(t), config = configuration();
  config.model.baseUrl = "http://127.0.0.1:43210/v1"; config.allowLoopback = true;
  assert.throws(() => validatePrivateRecallModelConfiguration({ ...configuration(), allowLoopback: true }), { code: "model_unavailable" });
  assert.throws(() => validatePrivateRecallModelConfiguration(config), { code: "model_unavailable" });
  assert.deepEqual(validatePrivateRecallModelConfiguration(config, { allowLoopback: true }), config);
  assert.throws(() => validatePrivateRecallModelConfiguration({ ...config, allowLoopback: false },
    { allowLoopback: true }), { code: "model_unavailable" });
  const previous = process.env.EDUPI_DESKTOP_ISOLATED_CANARY;
  t.after(() => { if (previous === undefined) delete process.env.EDUPI_DESKTOP_ISOLATED_CANARY; else process.env.EDUPI_DESKTOP_ISOLATED_CANARY = previous; });
  for (const enabled of [undefined, "1"]) {
    if (enabled === undefined) delete process.env.EDUPI_DESKTOP_ISOLATED_CANARY; else process.env.EDUPI_DESKTOP_ISOLATED_CANARY = enabled;
    const host = await startCoreRuntimeHost({ coreRoot: f.root, options: { ...f.options, recallAnswers: true } }, f.channel(config));
    try { assert.equal(Boolean((await f.module()).received.recallAnswers), enabled === "1"); }
    finally { await host.close(); }
  }
});

test("answer factory belongs to the daemon module registry and model work uses only private IPC", async t => {
  const f = fixture(t), channel = f.channel();
  const host = await startCoreRuntimeHost({ coreRoot: f.root, options: { ...f.options, recallAnswers: true } }, channel);
  try {
    const { received } = await f.module();
    assert.equal(typeof received.recallAnswers.assess, "function");
    assert.equal(JSON.stringify(received).includes(configuration().apiKey), false);
    assert.deepEqual(channel.sent.map(value => value.type), ["model-config-request"]);
    const result = received.recallAnswers.assess({ prompt: "synthetic question", signal: new AbortController().signal });
    const message = channel.sent.at(-1);
    assert.equal(message.type, "model-run");
    assert.deepEqual(Object.keys(message.request).sort(), ["deadline_at", "model_kind", "prompt"]);
    assert.equal(message.request.model_kind, "memory_recall");
    assert.equal(message.request.prompt, "synthetic question");
    assert.ok(Date.parse(message.request.deadline_at) - Date.now() <= 12000);
    assert.equal(JSON.stringify(message).includes(configuration().apiKey), false);
    channel.emit("message", { type: "model-result", id: message.id, result: { output: "synthetic answer" } });
    assert.deepEqual(await result, { output: "synthetic answer" });
  } finally { await host.close(); }
});

for (const interrupt of ["cancel", "deadline"]) {
  test(`answer ${interrupt} and host close retain unfinished IPC completion`, async t => {
    const f = fixture(t), channel = f.channel();
    const host = await startCoreRuntimeHost({ coreRoot: f.root, options: { ...f.options, recallAnswers: true } }, channel);
    t.mock.timers.enable({ apis: ["setTimeout"] });
    const { received } = await f.module();
    const controller = new AbortController();
    let finished = false, closed = false;
    const work = received.recallAnswers.assess({ prompt: "synthetic pending question", signal: controller.signal });
    const observed = assert.rejects(work, { code: "model_unavailable" }).then(() => { finished = true; });
    const message = channel.sent.at(-1);
    if (interrupt === "cancel") controller.abort();
    else t.mock.timers.tick(18000);
    await Promise.resolve();
    assert.equal(finished, false);
    assert.equal(channel.sent.at(-1).type, "model-cancel");
    const closing = host.close().then(() => { closed = true; });
    assert.equal(host.close(), host.close(), "close shares one real completion");
    await new Promise(resolve => setImmediate(resolve));
    assert.equal(closed, false, "daemon.close alone cannot release unfinished assessment");
    assert.equal(finished, false);
    channel.emit("message", { type: "model-error", id: message.id, code: "model_unavailable" });
    await observed; await closing;
    assert.equal(closed, true);
    assert.equal((await f.module()).closes, 1);
    t.mock.timers.reset();
  });
}

test("paired Core brands answer assessors in the real daemon and runs only an isolated loopback SDK through the private broker", {
  skip: !process.env.EDUPI_CORE_ROOT, timeout: 120000,
}, async () => {
  const coreRoot = fs.realpathSync(process.env.EDUPI_CORE_ROOT);
  const coreUrl = file => pathToFileURL(path.join(coreRoot, "scripts", file)).href;
  const [{ createMemoryRecallFixture }, protocol, answers, support] = await Promise.all([
    import(coreUrl("test_owner_memory_recall.mjs")), import(coreUrl("core_runtime_protocol.mjs")),
    import(coreUrl("recall_facet_answer_assessor.mjs")), import(coreUrl("recall_source_support.mjs")),
  ]);
  const { createRuntimeModelHost, attachRuntimeModelHost } = await createJiti(import.meta.url).import("../lib/edupi-runtime-model-host.ts");
  const ownerToken = randomBytes(32).toString("base64url"), bearer = randomBytes(32).toString("base64url");
  const fixture = await createMemoryRecallFixture({ ownerControlTokenForRoot: () => ownerToken });
  const previous = process.env.EDUPI_DESKTOP_ISOLATED_CANARY;
  process.env.EDUPI_DESKTOP_ISOLATED_CANARY = "1";
  let host, broker, child, childExit, calls = 0, invalid = false, hang = false, modelStarted, modelClosed;
  const started = new Promise(resolve => { modelStarted = resolve; });
  const closed = new Promise(resolve => { modelClosed = resolve; });
  const profiles = [];
  const server = http.createServer(async (req, res) => {
    let bytes = ""; for await (const chunk of req) bytes += chunk;
    assert.equal(req.headers.authorization, "Bearer synthetic-private-key");
    calls++;
    const body = JSON.parse(bytes);
    profiles.push({ temperature: body.temperature, maxTokens: body.max_tokens ?? body.max_completion_tokens });
    const prompt = body.messages.findLast(value => value.role === "user").content;
    const data = JSON.parse(prompt.split("UNTRUSTED_INPUT_JSON:\n")[1]);
    assert.equal(prompt.includes("private-answer-case"), false);
    assert.equal(prompt.includes("private-answer-person"), false);
    if (hang) { res.once("close", modelClosed); modelStarted(); return; }
    const selected = data.cases[0];
    const person = selected.sources.find(source => source.content.includes("张老师"));
    const ordinal = selected.sources.find(source => source.content.includes("第二场"));
    // A protocol oracle, not a claim about model semantic accuracy.
    const output = invalid ? "invalid JSON" : JSON.stringify({ case_id: selected.case_id, anchor: "花灯班会", decisions: [
      { facet_id: "facet_0", source_id: person.source_id, verdict: "supported", answer: ["张老师"], evidence: [person.content], answer_kind: "person" },
      { facet_id: "facet_0", source_id: ordinal.source_id, verdict: "abstain" },
      { facet_id: "facet_1", source_id: person.source_id, verdict: "abstain" },
      { facet_id: "facet_1", source_id: ordinal.source_id, verdict: "supported", answer: ["第二场"], evidence: [ordinal.content], answer_kind: "ordinal" },
    ] });
    const chunk = (delta, finish_reason) => `data: ${JSON.stringify({ id: "synthetic-answer", object: "chat.completion.chunk", created: 1,
      model: "synthetic", choices: [{ index: 0, delta, finish_reason }] })}\n\n`;
    res.writeHead(200, { "content-type": "text/event-stream" });
    res.write(chunk({ role: "assistant", content: output }, null)); res.write(chunk({}, "stop")); res.end("data: [DONE]\n\n");
  });
  await new Promise(resolve => server.listen(0, "127.0.0.1", resolve));
  const input = { query: "花灯班会由谁主持，排在第几场？",
    facets: [{ id: "facet_0", text: "由谁主持" }, { id: "facet_1", text: "排在第几场" }],
    cases: [{ id: "private-answer-case", sources: [
      { id: "private-answer-person", content: "花灯班会由张老师主持。", source_fingerprint: `sha256:${"a".repeat(64)}` },
      { id: "private-answer-order", content: "花灯班会排在第二场。", source_fingerprint: `sha256:${"b".repeat(64)}` },
    ] }] };
  try {
    const captured = await fixture.capture();
    await fixture.stop();
    const agentDir = path.join(fixture.directory, "answer-agent"), wrapper = path.join(fixture.directory, "answer-core-wrapper");
    fs.mkdirSync(agentDir); fs.mkdirSync(path.join(wrapper, "scripts"), { recursive: true });
    fs.writeFileSync(path.join(agentDir, "settings.json"), JSON.stringify({ defaultProvider: "synthetic", defaultModel: "synthetic" }));
    fs.writeFileSync(path.join(agentDir, "auth.json"), JSON.stringify({ synthetic: { type: "api_key", key: "synthetic-private-key" } }));
    fs.writeFileSync(path.join(agentDir, "models.json"), JSON.stringify({ providers: { synthetic: {
      api: "openai-completions", baseUrl: `http://127.0.0.1:${server.address().port}/v1`,
      models: [{ ...configuration().model, provider: undefined, api: undefined, baseUrl: undefined }],
    } } }));
    for (const file of ["recall_source_support.mjs", "recall_facet_answer_assessor.mjs"]) {
      fs.writeFileSync(path.join(wrapper, "scripts", file), `export * from ${JSON.stringify(coreUrl(file))};`);
    }
    // Observe the exact options while retaining the real daemon and its guards.
    fs.writeFileSync(path.join(wrapper, "scripts/core_runtime_daemon.mjs"), `
      import { createCoreRuntimeDaemon as create } from ${JSON.stringify(coreUrl("core_runtime_daemon.mjs"))};
      export let received;
      export async function createCoreRuntimeDaemon(options) { received = options; return create(options); }
    `);
    const daemonModule = await import(pathToFileURL(path.join(wrapper, "scripts/core_runtime_daemon.mjs")).href);
    let sequence = 0;
    const open = async () => {
      const channel = new EventEmitter(); channel.connected = true; channel.sent = [];
      channel.send = (value, callback) => { channel.sent.push(value); queueMicrotask(() => channel.emit("message", value)); callback?.(); };
      broker = attachRuntimeModelHost(channel, createRuntimeModelHost({ coreRoot, projectRoot: fixture.dataRoot, agentDir, allowLoopback: true }));
      host = await startCoreRuntimeHost({ coreRoot: wrapper, options: { dataRoot: fixture.dataRoot, token: bearer, ownerControlToken: ownerToken,
        port: 0, supervisorSessionId: `desktop-answer-${++sequence}`, coreCommit: "a".repeat(40),
        componentManifestHash: protocol.CORE_RUNTIME_SCHEMA_HASH, ambientPlanning: true, ownerMessageRegistration: true, recallAnswers: true } }, channel);
      assert.equal(channel.sent.filter(value => value.type === "model-config-request").length, 1);
      assert.equal(answers.isRecallFacetAnswerAssessor(daemonModule.received.recallAnswers), true);
      assert.equal(answers.isRecallFacetAnswerAssessor({ ...daemonModule.received.recallAnswers }), false);
      assert.equal(support.isRecallSupportAssessor(daemonModule.received.recallSupport), true);
      return daemonModule.received.recallAnswers;
    };
    let assessor = await open();
    assert.equal(calls, 0, "valid private profile activation does not invoke a model");
    const response = await fetch(host.daemon.endpoint, { method: "POST", headers: { "content-type": "application/json",
      authorization: `Bearer ${bearer}`, "x-edupi-owner-control": ownerToken }, body: JSON.stringify({
      protocol: protocol.CORE_RUNTIME_PROTOCOL, protocol_version: protocol.CORE_RUNTIME_PROTOCOL_VERSION,
      schema_hash: protocol.CORE_RUNTIME_SCHEMA_HASH, request_id: "answer-source-list", operation: "owner_memory_recall",
      payload: fixture.requestFor(captured),
    }) });
    const listed = await response.json();
    assert.equal(protocol.validateRuntimeResponse(listed).ok, true);
    assert.equal(listed.result.model_execute, false);
    assert.equal(calls, 0, "source-only recall remains model-free");
    const assessed = await assessor.assess(input);
    assert.equal(assessed.status, "assessed", JSON.stringify({ result: assessed, loopbackCalls: calls }));
    assert.equal(assessed.case_id, input.cases[0].id);
    assert.deepEqual(assessed.facets.map(value => value.answer), [["张老师"], ["第二场"]]);
    assert.deepEqual(profiles[0], { temperature: 0, maxTokens: 4096 });
    invalid = true;
    assert.equal((await assessor.assess(input)).reason_code, "invalid_result");
    invalid = false; hang = true;
    const cancellation = new AbortController();
    const work = assessor.assess({ ...input, signal: cancellation.signal });
    await started; cancellation.abort();
    assert.equal((await work).reason_code, "cancelled");
    assert.equal((await assessor.assess(input)).reason_code, "model_busy", "response cancellation cannot free the unfinished Core assessor");
    await closed; await assessor.waitForIdle();
    await host.close(); await broker.close(); host = null; broker = null;
    hang = false; assessor = await open();
    assert.equal((await assessor.assess(input)).status, "assessed");
    assert.equal(calls, 4);
    assert.ok(profiles.every(value => value.temperature === 0 && value.maxTokens === 4096));
    await host.close(); await broker.close(); host = null; broker = null;

    child = fork(new URL("./core-runtime-host.mjs", import.meta.url), [], {
      execArgv: [], stdio: ["ignore", "ignore", "ignore", "ipc"], cwd: coreRoot,
      env: { PATH: process.env.PATH, LANG: "C.UTF-8", TZ: "Asia/Shanghai", EDUPI_DESKTOP_ISOLATED_CANARY: "1",
        EDUPI_PROJECT_ROOT: fixture.dataRoot, EDUPI_DATA_ROOT: fixture.dataRoot, EDUPI_HOME: path.join(fixture.dataRoot, ".edupi"),
        EDUPI_MEMORY_DIR: path.join(fixture.dataRoot, ".edupi/memory"), EDUPI_OUTPUT_DIR: path.join(fixture.dataRoot, ".edupi/output"),
        EDUPI_LOCK_DIR: path.join(fixture.dataRoot, ".edupi/locks") },
    });
    childExit = new Promise(resolve => child.once("close", code => resolve(code)));
    broker = attachRuntimeModelHost(child, createRuntimeModelHost({ coreRoot, projectRoot: fixture.dataRoot, agentDir, allowLoopback: true }));
    const messageTypes = [];
    const ready = new Promise((resolve, reject) => {
      child.once("error", reject);
      child.on("message", value => {
        messageTypes.push(value.type);
        if (value.type === "runtime-ready") resolve(value);
        if (value.type === "runtime-error") reject(new Error(value.code));
      });
    });
    child.send({ type: "runtime-start", coreRoot, options: { dataRoot: fixture.dataRoot, token: bearer, ownerControlToken: ownerToken,
      port: 0, supervisorSessionId: "desktop-answer-real-child", coreCommit: "a".repeat(40),
      componentManifestHash: protocol.CORE_RUNTIME_SCHEMA_HASH, ambientPlanning: true, ownerMessageRegistration: true, recallAnswers: true } });
    const childRuntime = await ready;
    assert.deepEqual(messageTypes, ["model-config-request", "runtime-ready"], "the actual child requests one private profile and does not infer on startup");
    const personResponse = await fetch(childRuntime.endpoint, { method: "POST", headers: { "content-type": "application/json",
      authorization: `Bearer ${bearer}`, "x-edupi-owner-control": ownerToken }, body: JSON.stringify({
      protocol: protocol.CORE_RUNTIME_PROTOCOL, protocol_version: protocol.CORE_RUNTIME_PROTOCOL_VERSION,
      schema_hash: protocol.CORE_RUNTIME_SCHEMA_HASH, request_id: "answer-real-child-brand", operation: "owner_recall_person_read",
      payload: { root_ref: fixture.rootRef, expected_owner_id: fixture.ownerId, message_ref: captured.message_ref, person_name: "张老师" },
    }) });
    const person = await personResponse.json();
    assert.equal(protocol.validateRuntimeResponse(person).ok, true);
    assert.equal(person.ok, true, JSON.stringify(person));
    assert.equal(person.result.status, "held", "the branded answer capability reads the actual source and abstains for an absent person");
    assert.equal(calls, 4, "activation and local person proof never invoke a model");
    child.send({ type: "runtime-stop" });
    assert.equal(await childExit, 0);
    await broker.close(); child = null; broker = null;
  } finally {
    if (child) { child.kill("SIGKILL"); await childExit; }
    await host?.close(); await broker?.close();
    server.closeAllConnections(); await new Promise(resolve => server.close(resolve));
    await fixture.close();
    if (previous === undefined) delete process.env.EDUPI_DESKTOP_ISOLATED_CANARY; else process.env.EDUPI_DESKTOP_ISOLATED_CANARY = previous;
  }
});
