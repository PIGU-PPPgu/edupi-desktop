import assert from "node:assert/strict";
import fs from "node:fs";
import http from "node:http";
import os from "node:os";
import path from "node:path";
import crypto from "node:crypto";
import { test } from "node:test";
import { OLD } from "./windows-upgrade-support.mjs";
import {
  TARGET, SYNTHETIC_MODELS, W3CDriver, assertCohort, assertNativeSnapshot, assertPointerEvidence,
  assertStoragePreserved, assertSyntheticPreserved, assertTargetInputs, assertTargetMetadata, measureResponse,
  pointerDrag, readStorage, remoteDiagnostic, requestUiUpgrade, runWebViewPreflight, verifyPublicTarget, verifyUpgradedWebView,
} from "./windows-upgrade-webdriver.mjs";

const config = { application: "C:\\Users\\synthetic\\edupi-windows-upgrade-test\\application\\pi-agent-desktop.exe",
  dataRoot: "C:\\Users\\synthetic\\edupi-route1-canary-windows-upgrade-test", expectedPid: 1234, attachPort: 9222 };
function native() {
  return { host: { appVersion: OLD.version, platform: "windows", processId: 1234, executablePath: config.application },
    server: { version: OLD.version, status: 204, instance: "a".repeat(64) },
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
    n => { n.host.processId = 0; }, n => { n.host.processId = 1235; }, n => { n.host.executablePath = "C:\\Other\\pi-agent-desktop.exe"; },
    n => { n.server.version = TARGET.version; }, n => { n.server.instance = "missing"; },
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

test("W3C HTTP only attaches, performs real pointer input, refresh, screenshot and deletion without npm browser packages", async t => {
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
  assert.equal((await driver.attach(config.attachPort)).browserName, "webview2");
  assert.equal(driver.launch, undefined, "no helper launch API may start a replacement App");
  assert.deepEqual(await driver.execute("return {verified:true}"), { verified: true });
  await driver.command("POST", "/actions", pointerDrag(300, 400, 60));
  await driver.command("POST", "/refresh", {});
  await driver.screenshot(directory, "windows-upgrade-test.png");
  assert.deepEqual(fs.readFileSync(path.join(directory, "windows-upgrade-test.png")), png);
  await driver.close();
  assert.equal(driver.session, null);
  assert.equal(calls[0].body.capabilities.alwaysMatch["tauri:options"], undefined);
  assert.deepEqual(calls[0].body.capabilities.alwaysMatch["ms:edgeOptions"], { debuggerAddress: "127.0.0.1:9222" });
  assert.equal(calls[0].body.capabilities.alwaysMatch.acceptInsecureCerts, false);
  assert.ok(calls.every(call => call.headers.authorization === undefined));
  assert.ok(calls.some(call => call.url.endsWith("/actions") && call.body.actions[0].parameters.pointerType === "mouse"));
  assert.deepEqual(calls.at(-1), { method: "DELETE", url: `/session/${sessionId}`, body: null, headers: calls.at(-1).headers });
  await driver.attach(9222);
  const attached = calls.filter(call => call.url === "/session").at(-1).body.capabilities.alwaysMatch;
  assert.deepEqual(attached["ms:edgeOptions"], { debuggerAddress: "127.0.0.1:9222" });
  assert.equal(attached["tauri:options"], undefined, "attach must not launch an application");
  await driver.command("POST", "/element/f.ABC.d.DEF.e.3/click", {});
  await assert.rejects(driver.request("GET", "/session/id/%2e%2e/outside"), /invalid_webdriver_route/);
  await driver.close();
});

test("protocol errors redact server messages, refuse redirects and reject off-machine endpoints", async () => {
  for (const endpoint of ["http://localhost:4444", "http://0.0.0.0:4444", "http://127.0.0.1:99999",
    "https://remote.example:4444", "http://user:password@127.0.0.1:4444"]) assert.throws(() => new W3CDriver(endpoint));
  const driver = new W3CDriver("http://127.0.0.1:4444", async (_url, init) => {
    assert.equal(init.redirect, "error");
    return Response.json({ value: { error: "session not created",
      message: "Bearer synthetic-secret https://private/path?token=synthetic", stacktrace: "private" } }, { status: 500 });
  });
  await assert.rejects(driver.attach(config.attachPort), { message: "webdriver_session_not_created" });
  const failed = new W3CDriver("http://127.0.0.1:4444", async () => { throw new Error("synthetic-secret"); });
  await assert.rejects(failed.attach(config.attachPort), { message: "webdriver_transport_failed" });
  await assert.rejects(driver.request("GET", "/session/id/../../outside"), /invalid_webdriver_route/);
  const diagnostic = remoteDiagnostic(500, { message: "session not created: no WebView2 process found. HRESULT: 0x80070005 C:\\private\\Alice\\data Bearer synthetic-secret https://private.example?token=synthetic" });
  assert.equal(diagnostic.httpStatus, 500);
  assert.deepEqual(diagnostic.hResultCategories, ["access_denied"]);
  assert.equal(Object.hasOwn(diagnostic, "hResults"), false);
  assert.ok(diagnostic.messageKeywords.includes("webview2"));
  for (const secret of ["Alice", "private", "synthetic", "Bearer", "https:", "\\", "0x80070005"]) {
    assert.equal(JSON.stringify(diagnostic).includes(secret), false);
  }
});

test("diagnostic evidence never copies hexadecimal URL tokens or unknown HRESULTs", async t => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), "windows-upgrade-diagnostic-test-"));
  t.after(() => fs.rmSync(directory, { force: true, recursive: true }));
  for (const token of ["0x12ab34cd", "0x80070005", "0XDEADBEEF"]) {
    const message = `failed to connect https://private.invalid/callback?token=${token}`;
    const diagnostic = remoteDiagnostic(500, { message });
    assert.deepEqual(diagnostic.hResultCategories, []);
    assert.equal(JSON.stringify(diagnostic).includes(token), false);
    const driver = new W3CDriver("http://127.0.0.1:4444", async () => Response.json({
      value: { error: "session not created", message },
    }, { status: 500 }));
    const proof = await runWebViewPreflight({ ...config, runtimeVersion: "131.0.2903.48", evidenceDir: directory }, driver);
    assert.equal(proof.actualUpgradePassed, false);
    const evidence = fs.readFileSync(path.join(directory, "windows-upgrade-webview.json"), "utf8");
    assert.equal(evidence.includes(token), false);
    assert.equal(evidence.includes("private.invalid"), false);
  }
  assert.deepEqual(remoteDiagnostic(500, { message: "HRESULT: 0x12ab34cd" }).hResultCategories, []);
  assert.deepEqual(remoteDiagnostic(500, { message: "HRESULT=0X80070002; HRESULT (0x80040154)" }).hResultCategories,
    ["file_not_found", "class_not_registered"]);
});

test("mock orchestration preserves phase evidence, closes the session on failure and cannot claim actual upgrade", async t => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), "windows-upgrade-orchestration-test-"));
  t.after(() => fs.rmSync(directory, { force: true, recursive: true }));
  function fakeDriver(hostVersion, { closeFails = false, geometryStuck = false, initiallyUnavailable = false } = {}) {
    const calls = [];
    let snapshots = 0;
    return {
      calls,
      async attach(port) { calls.push(["attach", port]); return { browserName: "webview2", browserVersion: "131.0.2903.48" }; },
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
        if (script.includes("width:innerWidth")) return { width: 1440, height: 900 };
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

function targetRelease() {
  return { id: Number(TARGET.releaseId), tag_name: `v${TARGET.version}`, target_commitish: TARGET.sourceSha, draft: false,
    assets: [[TARGET.assetId, TARGET.name, TARGET.size, TARGET.sha256],
      [TARGET.signatureId, `${TARGET.name}.sig`, TARGET.signatureSize, TARGET.signatureSha256]].map(([id, name, size, hash]) => ({
      id: Number(id), name, size, digest: `sha256:${hash}`, state: "uploaded",
      url: `https://api.github.com/repos/${OLD.repository}/releases/assets/${id}`,
      browser_download_url: `https://github.com/${OLD.repository}/releases/download/v${TARGET.version}/${name}`,
    })) };
}
const syntheticSignature = Buffer.from(`untrusted comment: synthetic test only\nsynthetic\ntrusted comment: timestamp:1\tfile:${TARGET.name}\tversion:${TARGET.version}\nsynthetic\n`).toString("base64");
const targetCohort = () => ({ version: TARGET.version, platforms: Object.fromEntries(
  ["windows-x86_64", "windows-x86_64-nsis"].map(platform => [platform, {
    url: `https://api.github.com/repos/${OLD.repository}/releases/assets/${TARGET.assetId}`, signature: syntheticSignature,
  }])) });

test("target contract pins public release, exact installer and signature, immutable cohort and source commit", () => {
  assert.doesNotThrow(() => assertTargetInputs({ mode: "upgrade", target: TARGET }));
  for (const key of ["releaseId", "assetId", "sourceSha", "sha256", "version", "cohortUrl"]) {
    assert.throws(() => assertTargetInputs({ mode: "upgrade", target: { ...TARGET, [key]: `${TARGET[key]}-changed` } }));
  }
  assert.doesNotThrow(() => assertTargetMetadata(targetRelease()));
  for (const mutate of [
    r => { r.draft = true; }, r => { r.target_commitish = "main"; }, r => { r.tag_name = "untagged-123"; },
    r => { r.id++; }, r => { r.assets.push({ ...r.assets[0], id: 999 }); },
    r => { r.assets[0].browser_download_url = r.assets[0].browser_download_url.replace("/v0.3.117/", "/untagged-123/"); },
    ...["id", "size", "digest", "name", "url", "browser_download_url", "state"].map(key => r => { r.assets[1][key] = "changed"; }),
  ]) { const r = targetRelease(); mutate(r); assert.throws(() => assertTargetMetadata(r)); }
  assert.doesNotThrow(() => assertCohort(targetCohort(), syntheticSignature));
  for (const mutate of [
    c => { c.version = OLD.version; }, c => { delete c.platforms["windows-x86_64-nsis"]; },
    c => { c.platforms["windows-x86_64"].signature += "AA"; },
    c => { c.platforms["windows-x86_64"].url = "https://attacker.example/file"; },
  ]) { const c = targetCohort(); mutate(c); assert.throws(() => assertCohort(c, syntheticSignature)); }
  assert.throws(() => assertCohort(targetCohort(), Buffer.from("trusted comment: version:0.3.116").toString("base64")));
});

test("public target uses anonymous API IDs, validates tag and full streams, and refuses credential or foreign redirects", async () => {
  const calls = [], measured = [];
  // Windows checkout may convert the repository fixture to CRLF. The raw
  // immutable HTTPS response is LF and production hashes those exact bytes.
  const cohortBytes = Buffer.from(fs.readFileSync(new URL("../docs/acceptance/update-cohorts/all-116-117-20261117.json", import.meta.url), "utf8")
    .replaceAll("\r\n", "\n"));
  const publicSignature = JSON.parse(cohortBytes).platforms["windows-x86_64"].signature;
  const fetcher = async (url, init) => {
    calls.push({ url, init });
    if (url.endsWith(`/releases/${TARGET.releaseId}`)) return Response.json(targetRelease());
    if (url.endsWith(`/git/ref/tags/v${TARGET.version}`)) return Response.json({ object: { type: "commit", sha: TARGET.sourceSha } });
    if (url === TARGET.cohortUrl) return new Response(cohortBytes);
    return new Response("synthetic stream; bytes verified by independent measureResponse tests");
  };
  // Only the transport is simulated here; production always uses the real
  // streaming hasher. Real public bytes are additionally checked separately.
  const result = await verifyPublicTarget({ mode: "upgrade", target: TARGET }, { fetcher, measure: async (_response, asset, keep) => {
    measured.push(asset);
    return keep ? Buffer.from(publicSignature) : { size: asset.size, sha256: asset.sha256 };
  } });
  assert.equal(result.status, "passed");
  assert.equal(result.nativeSignatureVerification, "required_during_ui_upgrade");
  assert.deepEqual(measured.map(item => item.sha256), [TARGET.signatureSha256, TARGET.sha256]);
  assert.ok(calls.every(call => !call.init.headers.Authorization && call.init.redirect === "manual"));
  assert.ok(calls.some(call => call.url.endsWith(`/releases/assets/${TARGET.assetId}`)));
  let invoked = 0;
  await assert.rejects(verifyPublicTarget({ mode: "upgrade", target: TARGET }, {
    fetcher: async () => { invoked++; return new Response(null, { status: 302, headers: { location: "https://attacker.example/?token=private" } }); },
  }), /unexpected_public_redirect/);
  assert.equal(invoked, 1);
  await assert.rejects(verifyPublicTarget({ mode: "upgrade", target: TARGET }, {
    fetcher: async (url, init) => url.includes("/git/ref/") ? Response.json({ object: { type: "commit", sha: OLD.sourceSha } }) : fetcher(url, init),
  }), /target_tag_source_mismatch/);
  await assert.rejects(verifyPublicTarget({ mode: "upgrade", target: TARGET }, {
    fetcher: async (url, init) => url === TARGET.cohortUrl
      ? new Response(cohortBytes.toString("utf8").replaceAll("\n", "\r\n")) : fetcher(url, init),
    measure: async () => Buffer.from(publicSignature),
  }), /fixed_cohort_bytes_mismatch/);
  const bytes = Buffer.from("Synthetic signed installer content, never executed");
  const expected = { size: bytes.length, sha256: crypto.createHash("sha256").update(bytes).digest("hex") };
  assert.deepEqual(await measureResponse(new Response(bytes), expected), expected);
  for (const [body, contract] of [
    [bytes.subarray(1), expected], [Buffer.concat([bytes, bytes]), expected], [bytes, { ...expected, sha256: "0".repeat(64) }],
  ]) await assert.rejects(measureResponse(new Response(body), contract));
  await assert.rejects(measureResponse(new Response(new ReadableStream({ pull(controller) {
    controller.error(new Error("private interrupted transport"));
  } })), expected));
});

test("readonly SQLite snapshots retain database identity and the same immutable records across restart", async t => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), "windows-upgrade-sql-test-"));
  let db;
  t.after(() => { db?.close(); fs.rmSync(directory, { force: true, recursive: true }); });
  const file = path.join(directory, "core.sqlite");
  const { DatabaseSync } = await import("node:sqlite");
  db = new DatabaseSync(file);
  db.exec(`CREATE TABLE authority(singleton INTEGER PRIMARY KEY,schema_version INTEGER,root_fingerprint TEXT,owner_pid INTEGER);
    INSERT INTO authority VALUES(1,1,'synthetic-root',123);
    CREATE TABLE events(event_id TEXT PRIMARY KEY,event_version INTEGER,event_type TEXT,occurrence_time TEXT,
      source_ref TEXT,actor_ref TEXT,scope_ref TEXT,revision_ref TEXT,payload_json TEXT,canonical_json TEXT,canonical_hash TEXT,
      external_send INTEGER,settled INTEGER);
    INSERT INTO events VALUES('context-synthetic',1,'context','now','source','actor','scope','revision','{}','{}','hash',0,0);`);
  const beforeBytes = fs.readFileSync(file);
  const before = await readStorage(file);
  assert.deepEqual(fs.readFileSync(file), beforeBytes, "snapshot must not write to SQL");
  db.exec("UPDATE authority SET owner_pid=456; UPDATE events SET settled=1;");
  const after = await readStorage(file);
  assert.doesNotThrow(() => assertStoragePreserved(before, after));
  for (const mutate of [
    s => { s.fileIdentity[1] = "other-file"; }, s => { s.schemaSha256 = "other-schema"; },
    s => { s.readOnly = false; }, s => { s.persistentRecords.events[0][1] = "changed"; },
    s => { s.persistentRecords.events = []; },
  ]) { const changed = structuredClone(after); mutate(changed); assert.throws(() => assertStoragePreserved(before, changed)); }
  db.exec("UPDATE events SET payload_json='changed';");
  await assert.rejects(async () => assertStoragePreserved(before, await readStorage(file)), /upgrade_database_record_changed/);
});

function upgradeMock(config, { ack = true, download = true, modelChanged = false, wrongRoot = false, uiError = false } = {}) {
  const calls = [];
  return {
    calls,
    async attach(port) { calls.push(["attach", port]); return { browserVersion: "131.0.2903.48" }; },
    async launch() { throw new Error("must_never_launch_117"); },
    async command(method, route, body) { calls.push([method, route, body]); },
    async wait(read, code) { const value = await read(); if (!value) throw new Error(code); return value; },
    async visible() { return { "element-6066-11e4-a52e-4f735466cecf": "synthetic" }; },
    async click(css, text) {
      calls.push(["click", css, text]);
      if (text === "继续更新") assert.ok(fs.existsSync(config.triggerFile), "boundary must precede native UI click");
    },
    async screenshot(_directory, name) { calls.push(["screenshot", name]); },
    async close() { calls.push(["close"]); },
    async execute(script, args) {
      if (script.includes("return window.__windowsUpgradeObserved")) {
        if (ack) fs.writeFileSync(config.ackFile, JSON.stringify({ oldPid: config.expectedPid, oldExited: true, installerVerified: true }));
        return { downloading: download, verifying: false, installing: true, error: uiError };
      }
      if (script.includes("pattern.test")) return args[0];
      return true;
    },
    async executeAsync(script, args) {
      if (script.includes('"computer_use_status"')) {
        const n = native(); n.host.appVersion = config.expectedVersion; n.host.processId = config.expectedPid;
        n.server.version = config.expectedVersion;
        n.server.instance = (config.expectedVersion === TARGET.version ? "b" : "a").repeat(64);
        n.roots.dataRoot = wrongRoot ? "C:\\real-data" : config.dataRoot;
        return n;
      }
      assert.ok(script.includes('invoke("get_desktop_api_token")'));
      assert.ok(!script.includes("done(token)"));
      const seed = args[0];
      return {
        workspace: config.dataRoot,
        context: { contextId: "synthetic-context-uuid", proposedValues: seed ? args[3]
          : JSON.parse(fs.readFileSync(config.baselineFile, "utf8")).context.proposedValues },
        model: modelChanged ? { providers: {} } : SYNTHETIC_MODELS,
        marker: fs.readFileSync(path.join(config.dataRoot, ".edupi", "output", "upgrade-synthetic-marker.json"), "utf8"),
      };
    },
  };
}
const storageMock = async () => ({ readOnly: true, quickCheck: "ok", fileIdentity: ["1", "2", "3"], schemaSha256: "schema",
  userVersion: "1", persistentRecords: { authority: [["root", "hash"]], events: [["synthetic-context", "hash"]] } });

test("upgrade orchestration clicks old UI, observes native exit, then only attaches new PID and reads the same objects", async t => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), "windows-upgrade-ui-test-"));
  t.after(() => fs.rmSync(directory, { force: true, recursive: true }));
  const input = { ...config, dataRoot: path.join(directory, "canary"), expectedVersion: OLD.version,
    runtimeVersion: "131.0.2903.48", evidenceDir: directory, baselineFile: path.join(directory, "baseline.json"),
    triggerFile: path.join(directory, "trigger.json"), ackFile: path.join(directory, "ack.json"),
    target: { status: "passed", ...TARGET }, pollMs: 1, timeoutMs: 1000 };
  const oldDriver = upgradeMock(input);
  const trigger = await requestUiUpgrade(input, oldDriver, storageMock);
  assert.equal(trigger.status, "passed", JSON.stringify(trigger));
  assert.equal(trigger.seededViaApi, true);
  assert.equal(trigger.uiSaved, false);
  assert.equal(trigger.actualUpgradePassed, false);
  assert.equal(trigger.oldSessionAbandonedAfterNativeExit, true);
  assert.equal(trigger.oldSessionCloseIssued, false);
  assert.equal(oldDriver.calls.some(call => call[0] === "close"), false);
  assert.deepEqual(oldDriver.calls.filter(call => call[0] === "click").map(call => call[2]).filter(Boolean),
    ["关于与更新", "继续更新"]);
  const newer = { ...input, expectedVersion: TARGET.version, expectedPid: config.expectedPid + 1,
    observer: { status: "passed", oldPid: config.expectedPid, newPid: config.expectedPid + 1,
      installerSha256: TARGET.sha256, automaticRestart: true } };
  const newDriver = upgradeMock(newer);
  const readback = await verifyUpgradedWebView(newer, newDriver, storageMock);
  assert.equal(readback.status, "passed", JSON.stringify(readback));
  assert.equal(readback.actualUpgradePassed, false, "only outer PS runner may finalize after env restore and cleanup");
  assert.equal(readback.readback.sameSqlFileAndRecords, true);
  assert.equal(readback.manuallyLaunched, false);
  assert.deepEqual(newDriver.calls[0], ["attach", config.attachPort]);
  assert.deepEqual(newDriver.calls.at(-1), ["close"]);
  for (const change of [
    c => { c.observer.automaticRestart = false; }, c => { c.expectedPid = config.expectedPid; },
    c => { c.observer.installerSha256 = OLD.sha256; },
  ]) {
    const bad = structuredClone(newer); change(bad);
    assert.equal((await verifyUpgradedWebView(bad, upgradeMock(bad), storageMock)).status, "blocked");
  }
  for (const options of [{ wrongRoot: true }, { modelChanged: true }]) {
    assert.equal((await verifyUpgradedWebView(newer, upgradeMock(newer, options), storageMock)).status, "blocked");
  }
  const baseline = JSON.parse(fs.readFileSync(input.baselineFile));
  const broken = structuredClone(baseline); broken.context.contextId = "other-object";
  assert.throws(() => assertSyntheticPreserved(baseline, broken));
  const safeEvidence = fs.readFileSync(path.join(directory, "windows-upgrade-trigger.json"), "utf8");
  assert.equal(safeEvidence.includes(input.dataRoot), false);
  assert.equal(safeEvidence.includes("synthetic-context-uuid"), false);
});

test("upgrade trigger fails closed on missing native acknowledgement or UI download, preserves pending App session", async t => {
  for (const options of [{ ack: false }, { download: false }, { uiError: true }, { wrongRoot: true }]) {
    const directory = fs.mkdtempSync(path.join(os.tmpdir(), "windows-upgrade-negative-test-"));
    t.after(() => fs.rmSync(directory, { force: true, recursive: true }));
    const input = { ...config, dataRoot: path.join(directory, "canary"), expectedVersion: OLD.version,
      runtimeVersion: "131.0.2903.48", evidenceDir: directory, baselineFile: path.join(directory, "baseline.json"),
      triggerFile: path.join(directory, "trigger.json"), ackFile: path.join(directory, "ack.json"),
      target: { status: "passed", ...TARGET }, pollMs: 1, timeoutMs: 10 };
    const driver = upgradeMock(input, options);
    const proof = await requestUiUpgrade(input, driver, storageMock);
    assert.equal(proof.status, "blocked");
    assert.equal(proof.actualUpgradePassed, false);
    if (options.ack === false || options.uiError === true) {
      assert.equal(driver.calls.some(call => call[0] === "close"), false, "pending old App must survive until PS cleanup");
    }
  }
});
