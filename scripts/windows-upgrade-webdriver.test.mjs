import assert from "node:assert/strict";
import fs from "node:fs";
import http from "node:http";
import os from "node:os";
import path from "node:path";
import { test } from "node:test";
import { OLD } from "./windows-upgrade-support.mjs";
import { W3CDriver, assertNativeSnapshot, assertPointerEvidence, pointerDrag, remoteDiagnostic, runWebViewPreflight } from "./windows-upgrade-webdriver.mjs";

const config = { application: "C:\\Users\\synthetic\\edupi-windows-upgrade-test\\application\\pi-agent-desktop.exe",
  dataRoot: "C:\\Users\\synthetic\\edupi-route1-canary-windows-upgrade-test" };
function native() {
  return { host: { appVersion: OLD.version, platform: "windows", processId: 1234, executablePath: config.application },
    roots: { dataRoot: config.dataRoot, dataSource: "environment", coreSource: "bundled",
      coreRoot: path.win32.join(path.win32.dirname(config.application), "resources", "edupi-core") },
    runtime: { safeMode: true, mobileBridgeEnabled: false },
    status: { core: { status: "ready", validationMode: "bundled", capabilities: { g1_processor: "activation_pending" } },
      projection: { status: "ready" }, compatibility: { actual: { coreCommit: OLD.coreSha } }, externalSend: false } };
}
const pointerProof = () => ({
  events: [{ type: "pointerdown", trusted: true, buttons: 1 }, { type: "pointermove", trusted: true, buttons: 1 },
    { type: "pointerup", trusted: true, buttons: 0 }],
  before: 284, after: 344, saved: 344, restored: 344,
  beforeWidth: 284, afterWidth: 344, restoredWidth: 344, draftRestored: true,
});

test("native proof requires the exact installed 116, original task path, bundled Core98 and guarded Safe Mode", () => {
  assert.doesNotThrow(() => assertNativeSnapshot(native(), config));
  const changes = [
    n => { n.host.appVersion = "0.3.117"; }, n => { n.host.platform = "linux"; },
    n => { n.host.processId = 0; }, n => { n.host.executablePath = "C:\\Other\\pi-agent-desktop.exe"; },
    n => { n.roots.dataRoot = "C:\\real-teacher"; }, n => { n.roots.dataSource = "persisted"; },
    n => { n.roots.coreSource = "environment"; }, n => { n.roots.coreRoot = "C:\\other-core"; },
    n => { n.runtime.safeMode = false; }, n => { n.runtime.mobileBridgeEnabled = true; },
    n => { n.status.core.status = "unavailable"; }, n => { n.status.projection.status = "unavailable"; },
    n => { n.status.core.validationMode = "fixture"; }, n => { n.status.externalSend = true; },
    n => { n.status.compatibility.actual.coreCommit = "a".repeat(40); },
    n => { n.status.core.capabilities.g1_processor = "active"; },
  ];
  for (const change of changes) { const n = native(); change(n); assert.throws(() => assertNativeSnapshot(n, config)); }
});

test("actual pointer contract refuses synthetic DOM events, released buttons, unchanged layout and missing reload persistence", () => {
  assert.doesNotThrow(() => assertPointerEvidence(pointerProof()));
  for (const change of [
    p => { p.events[1].trusted = false; }, p => { p.events[1].buttons = 0; },
    p => { p.events.pop(); }, p => { p.after = p.before; }, p => { p.saved = 284; },
    p => { p.restored = 284; }, p => { p.draftRestored = false; }, p => { p.before = NaN; },
    p => { p.afterWidth = p.beforeWidth; }, p => { p.restoredWidth = p.beforeWidth; },
  ]) { const p = pointerProof(); change(p); assert.throws(() => assertPointerEvidence(p)); }
  const actions = pointerDrag(300, 400, 60).actions[0];
  assert.equal(actions.type, "pointer");
  assert.equal(actions.parameters.pointerType, "mouse");
  assert.equal(actions.actions[1].type, "pointerDown");
  assert.deepEqual(actions.actions.at(-1), { type: "pointerUp", button: 0 });
  assert.equal(actions.actions.at(-2).x, 360);
  for (const args of [[0, 400, 60], [300, 400, 0], [300, 400, 500], [300.2, 400, 60]]) {
    assert.throws(() => pointerDrag(...args));
  }
});

test("W3C HTTP performs launch, real pointer input, refresh, screenshot and deletion without npm browser packages", async t => {
  const calls = [], sessionId = "synthetic-session-id";
  const png = Buffer.from("89504e470d0a1a0a0000000049454e44ae426082", "hex");
  const server = http.createServer(async (request, response) => {
    const chunks = [];
    for await (const chunk of request) chunks.push(chunk);
    const text = Buffer.concat(chunks).toString();
    calls.push({ method: request.method, url: request.url, body: text ? JSON.parse(text) : null, headers: request.headers });
    let value = null;
    if (request.url === "/session") value = { sessionId, capabilities: { browserName: "webview2", browserVersion: "131.0.2903.48" } };
    if (request.url.endsWith("/execute/sync")) value = { verified: true };
    if (request.url.endsWith("/screenshot")) value = png.toString("base64");
    response.writeHead(200, { "Content-Type": "application/json" });
    response.end(JSON.stringify({ value }));
  });
  await new Promise(resolve => server.listen(0, "127.0.0.1", resolve));
  t.after(() => server.close());
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), "windows-upgrade-w3c-test-"));
  t.after(() => fs.rmSync(directory, { force: true, recursive: true }));
  const driver = new W3CDriver(`http://127.0.0.1:${server.address().port}`);
  assert.equal((await driver.launch(config.application)).browserName, "webview2");
  assert.deepEqual(await driver.execute("return {verified:true}"), { verified: true });
  await driver.command("POST", "/actions", pointerDrag(300, 400, 60));
  await driver.command("POST", "/refresh", {});
  await driver.screenshot(directory, "windows-upgrade-test.png");
  assert.deepEqual(fs.readFileSync(path.join(directory, "windows-upgrade-test.png")), png);
  await driver.close();
  assert.equal(driver.session, null);
  assert.deepEqual(calls[0].body.capabilities.alwaysMatch["tauri:options"], {
    application: config.application, args: ["--safe-mode"],
  });
  assert.equal(calls[0].body.capabilities.alwaysMatch.acceptInsecureCerts, false);
  assert.ok(calls.every(call => call.headers.authorization === undefined));
  assert.ok(calls.some(call => call.url.endsWith("/actions") && call.body.actions[0].parameters.pointerType === "mouse"));
  assert.deepEqual(calls.at(-1), { method: "DELETE", url: `/session/${sessionId}`, body: null, headers: calls.at(-1).headers });
});

test("protocol errors redact server messages, refuse redirects and reject off-machine endpoints", async () => {
  for (const endpoint of ["http://localhost:4444", "http://0.0.0.0:4444", "http://127.0.0.1:99999",
    "https://remote.example:4444", "http://user:password@127.0.0.1:4444"]) assert.throws(() => new W3CDriver(endpoint));
  const driver = new W3CDriver("http://127.0.0.1:4444", async (_url, init) => {
    assert.equal(init.redirect, "error");
    return Response.json({ value: { error: "session not created",
      message: "Bearer synthetic-secret https://private/path?token=synthetic", stacktrace: "private" } }, { status: 500 });
  });
  await assert.rejects(driver.launch(config.application), { message: "webdriver_session_not_created" });
  const failed = new W3CDriver("http://127.0.0.1:4444", async () => { throw new Error("synthetic-secret"); });
  await assert.rejects(failed.launch(config.application), { message: "webdriver_transport_failed" });
  await assert.rejects(driver.request("GET", "/session/id/../../outside"), /invalid_webdriver_route/);
  const diagnostic = remoteDiagnostic(500, { message: "session not created: no WebView2 process found. 0x80070005 C:\\private\\Alice\\data Bearer synthetic-secret https://private.example?token=synthetic" });
  assert.equal(diagnostic.httpStatus, 500);
  assert.deepEqual(diagnostic.hResults, ["0x80070005"]);
  assert.ok(diagnostic.messageKeywords.includes("webview2"));
  for (const secret of ["Alice", "private", "synthetic", "Bearer", "https:", "\\"]) {
    assert.equal(JSON.stringify(diagnostic).includes(secret), false);
  }
});

test("mock orchestration preserves phase evidence, closes the session on failure and cannot claim actual upgrade", async t => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), "windows-upgrade-orchestration-test-"));
  t.after(() => fs.rmSync(directory, { force: true, recursive: true }));
  function fakeDriver(hostVersion, { closeFails = false, geometryStuck = false, initiallyUnavailable = false } = {}) {
    const calls = [];
    let snapshots = 0;
    return {
      calls,
      async launch(application) { calls.push(["launch", application]); return { browserName: "webview2", browserVersion: "131.0.2903.48" }; },
      async wait(read, code) {
        for (let attempt = 0; attempt < 3; attempt++) { const value = await read(); if (value) return value; }
        throw new Error(code);
      },
      async command(method, route, body) {
        calls.push([method, route, body]);
        if (route === "/url" && method === "GET") return "http://127.0.0.1:30141/";
        return null;
      },
      async visible(css) { return css.includes("textarea") ? { "element-6066-11e4-a52e-4f735466cecf": "synthetic-textarea" } : null; },
      async click(css, text) { calls.push(["click", css, text]); },
      async execute(script) {
        if (script.includes("Boolean(window.__TAURI_INTERNALS__")) return true;
        if (script.includes("Math.round(r.x")) return { x: 300, y: 400, before: 284, beforeWidth: 284, max: 480, min: 200 };
        if (script.includes("events:window.__windowsUpgradePointer")) {
          const { after, saved, events } = pointerProof();
          return { after, saved, events, afterWidth: geometryStuck ? 284 : 344 };
        }
        if (script.includes("draftRestored:input.value")) return { restored: 344,
          restoredWidth: geometryStuck ? 284 : 344, draftRestored: true };
        if (script.includes('data-setting-id="updates"')) return "0.3.116";
        return null;
      },
      async executeAsync() {
        calls.push(["native-snapshot"]);
        const result = native(); result.host.appVersion = hostVersion;
        if (initiallyUnavailable && snapshots++ === 0) result.status.core.status = "unavailable";
        return result;
      },
      async screenshot(_directory, filename) { calls.push(["screenshot", filename]); },
      async close() { calls.push(["close"]); if (closeFails) throw new Error("synthetic error"); },
    };
  }
  const input = { ...config, runtimeVersion: "131.0.2903.48", evidenceDir: directory };
  const goodDriver = fakeDriver(OLD.version);
  const good = await runWebViewPreflight(input, goodDriver);
  assert.equal(good.status, "passed", JSON.stringify(good));
  assert.equal(good.actualUpgradePassed, false);
  assert.equal(good.sessionClosed, true);
  assert.equal(good.checks.length, 4);
  assert.ok(goodDriver.calls.some(call => call[1] === "/actions" && call[2]?.actions[0].type === "pointer"));
  assert.ok(goodDriver.calls.some(call => call[1] === "/refresh"));
  assert.deepEqual(goodDriver.calls.at(-1), ["close"]);
  const wrong = fakeDriver("0.3.117");
  const failure = await runWebViewPreflight(input, wrong);
  assert.equal(failure.status, "failed");
  assert.equal(failure.phase, "native-source-root-core98");
  assert.equal(failure.code, "native_116_identity_mismatch");
  assert.equal(failure.actualUpgradePassed, false);
  assert.deepEqual(wrong.calls.at(-1), ["close"]);
  const stuck = await runWebViewPreflight(input, fakeDriver(OLD.version, { geometryStuck: true }));
  assert.equal(stuck.status, "failed");
  assert.equal(stuck.code, "pointer_width_or_draft_readback_failed");
  assert.equal(stuck.actualUpgradePassed, false);
  const coldDriver = fakeDriver(OLD.version, { initiallyUnavailable: true });
  const cold = await runWebViewPreflight(input, coldDriver);
  assert.equal(cold.status, "passed");
  assert.equal(coldDriver.calls.filter(call => call[0] === "native-snapshot").length, 2);
  const closeFailure = await runWebViewPreflight(input, fakeDriver(OLD.version, { closeFails: true }));
  assert.equal(closeFailure.status, "blocked");
  assert.equal(closeFailure.sessionClosed, false);
  assert.equal(closeFailure.actualUpgradePassed, false);
  assert.equal(JSON.parse(fs.readFileSync(path.join(directory, "windows-upgrade-webview.json"))).sessionClosed, false);
});
