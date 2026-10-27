import assert from "node:assert/strict";
import { randomBytes } from "node:crypto";
import { EventEmitter } from "node:events";
import fs from "node:fs";
import http from "node:http";
import path from "node:path";
import { pathToFileURL } from "node:url";
import test from "node:test";
import { createJiti } from "jiti";
import { startCoreRuntimeHost } from "./core-runtime-host.mjs";

test("real Core recall host screens current captured sources through private IPC and an isolated localhost model", {
  skip: !process.env.EDUPI_CORE_ROOT, timeout: 120000,
}, async () => {
  const coreRoot = process.env.EDUPI_CORE_ROOT;
  const core = file => import(pathToFileURL(path.join(coreRoot, "scripts", file)).href);
  const [{ createMemoryRecallFixture }, protocol] = await Promise.all([core("test_owner_memory_recall.mjs"), core("core_runtime_protocol.mjs")]);
  const { createRuntimeModelHost, attachRuntimeModelHost } = await createJiti(import.meta.url).import("../lib/edupi-runtime-model-host.ts");
  const ownerToken = randomBytes(32).toString("base64url"), token = randomBytes(32).toString("base64url");
  const fixture = await createMemoryRecallFixture({ ownerControlTokenForRoot: () => ownerToken });
  let host, broker, sequence = 0, requests = 0, invalid = false, hang = false;
  let hangStarted, hangClosed;
  const beganHang = new Promise(resolve => { hangStarted = resolve; });
  const closedHang = new Promise(resolve => { hangClosed = resolve; });
  const within = async (promise, message) => {
    let timer;
    try { return await Promise.race([promise, new Promise((_, reject) => { timer = setTimeout(() => reject(new Error(message)), 2000); })]); }
    finally { clearTimeout(timer); }
  };
  const sourcePrompts = [], modelProfiles = [];
  const server = http.createServer(async (req, res) => {
    let raw = ""; for await (const chunk of req) raw += chunk;
    requests++;
    const body = JSON.parse(raw), prompt = body.messages.findLast(message => message.role === "user").content;
    modelProfiles.push({ temperature: body.temperature, maxTokens: body.max_tokens ?? body.max_completion_tokens });
    const input = JSON.parse(prompt.slice(prompt.lastIndexOf("\n") + 1)); sourcePrompts.push(input);
    if (hang) { res.once("close", hangClosed); hangStarted(); return; }
    // Contract oracle only. This does not measure model semantic quality.
    const output = invalid ? "not valid JSON" : JSON.stringify({ decisions: input.sources.map(source => {
      const supported = input.query === fixture.markers.a && source.content === fixture.markers.a;
      return { source_id: source.source_id, verdict: supported ? "supported" : "abstain",
        answer_state: supported ? "present" : "unavailable", answer: supported ? source.content : null,
        evidence: supported ? [source.content] : [], reason: supported ? "answers_request" : "missing_attribute" };
    }) });
    const chunk = (delta, finish_reason) => `data: ${JSON.stringify({ id: "synthetic", object: "chat.completion.chunk", created: 1,
      model: "synthetic", choices: [{ index: 0, delta, finish_reason }] })}\n\n`;
    res.writeHead(200, { "content-type": "text/event-stream" });
    res.write(chunk({ role: "assistant", content: output }, null)); res.write(chunk({}, "stop")); res.end("data: [DONE]\n\n");
  });
  await new Promise(resolve => server.listen(0, "127.0.0.1", resolve));
  try {
    const captured = await fixture.capture(), identity = fixture.requestFor(captured);
    await fixture.stop();
    const agentDir = path.join(fixture.directory, "recall-model-agent"); fs.mkdirSync(agentDir);
    fs.writeFileSync(path.join(agentDir, "settings.json"), JSON.stringify({ defaultProvider: "synthetic", defaultModel: "synthetic" }));
    fs.writeFileSync(path.join(agentDir, "auth.json"), JSON.stringify({ synthetic: { type: "api_key", key: "synthetic-local-only" } }));
    fs.writeFileSync(path.join(agentDir, "models.json"), JSON.stringify({ providers: { synthetic: {
      api: "openai-completions", baseUrl: `http://127.0.0.1:${server.address().port}/v1`, models: [{ id: "synthetic", name: "Synthetic", reasoning: false,
        input: ["text"], cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 }, contextWindow: 32000, maxTokens: 4096 }],
    } } }));
    async function open() {
      const channel = new EventEmitter(); channel.connected = true;
      channel.send = (value, callback) => { queueMicrotask(() => channel.emit("message", value)); callback?.(); };
      broker = attachRuntimeModelHost(channel, createRuntimeModelHost({ coreRoot, projectRoot: fixture.dataRoot, agentDir, allowLoopback: true }));
      host = await startCoreRuntimeHost({ coreRoot, options: { dataRoot: fixture.dataRoot, token, ownerControlToken: ownerToken, port: 0,
        supervisorSessionId: `desktop-recall-${++sequence}`, coreCommit: "a".repeat(40), componentManifestHash: protocol.CORE_RUNTIME_SCHEMA_HASH,
        ambientPlanning: true, ownerMessageRegistration: true } }, channel);
    }
    const call = async (payload, signal) => {
      const response = await fetch(host.daemon.endpoint, { method: "POST", signal, headers: { "content-type": "application/json",
        authorization: `Bearer ${token}`, "x-edupi-owner-control": ownerToken }, body: JSON.stringify({ protocol: protocol.CORE_RUNTIME_PROTOCOL,
        protocol_version: protocol.CORE_RUNTIME_PROTOCOL_VERSION, schema_hash: protocol.CORE_RUNTIME_SCHEMA_HASH,
        request_id: `desktop-recall-call-${++sequence}`, operation: "owner_memory_recall", payload }) });
      const result = await response.json(); assert.equal(protocol.validateRuntimeResponse(result).ok, true); return result;
    };
    await open(); assert.equal(requests, 0, "startup and no-query reads cannot invoke a model");
    const listed = await call(identity); assert.equal(listed.result.model_execute, false); assert.equal(requests, 0);
    const allowed = await call({ ...identity, category: "class", query: fixture.markers.a });
    assert.equal(allowed.result.model_execute, true); assert.equal(allowed.result.source_support.status, "assessed");
    assert.deepEqual(allowed.result.entries.map(entry => entry.content), [fixture.markers.a]);
    assert.deepEqual(modelProfiles[0], { temperature: 0, maxTokens: 4096 }, "the actual SDK request must match the assessed recall profile");
    const missing = await call({ ...identity, category: "class", query: "寄送地址在哪里" });
    assert.equal(missing.result.model_execute, true); assert.deepEqual(missing.result.entries, []);
    invalid = true;
    const held = await call({ ...identity, category: "class", query: fixture.markers.a });
    assert.equal(held.result.status, "held"); assert.equal(held.result.source_support.reason_code, "invalid_result");
    assert.deepEqual(held.result.entries, []);
    const beforeForged = requests;
    assert.equal((await call({ ...identity, query: fixture.markers.a, source_support: { status: "assessed" } })).error_code, "invalid_request");
    assert.equal(requests, beforeForged);
    assert.ok(sourcePrompts.every(input => input.sources.every(source => source.content !== fixture.markers.b)));
    assert.ok(sourcePrompts.every(input => !JSON.stringify(input).includes(fixture.rootRef)));
    invalid = false; hang = true;
    const controller = new AbortController();
    const cancelled = call({ ...identity, category: "class", query: fixture.markers.a }, controller.signal);
    const observedCancellation = assert.rejects(cancelled, error => error.name === "AbortError");
    await within(beganHang, "isolated model did not receive the synthetic request");
    controller.abort(); await observedCancellation;
    await within(closedHang, "transport cancellation did not reap the isolated model connection");
    await host.close(); await broker.close(); host = null; broker = null;
    hang = false; await open();
    const cold = await call({ ...identity, category: "class", query: fixture.markers.a });
    assert.deepEqual(cold.result.entries.map(entry => entry.content), [fixture.markers.a]);
    assert.equal(requests, 5);
    console.log(JSON.stringify({ status: "passed", real_core_host: true, private_ipc: true, isolated_sdk_worker: true,
      current_scope_only: true, unsupported_answer_empty: true, invalid_output_held: true, forged_request_held: true,
      transport_cancellation_reaps_model: true, cold_restart: true, synthetic_provider_calls: requests,
      external_provider_calls: 0, semantic_quality: "not_measured" }));
  } finally {
    await host?.close(); await broker?.close(); server.closeAllConnections(); await new Promise(resolve => server.close(resolve));
    await fixture.close();
  }
});
