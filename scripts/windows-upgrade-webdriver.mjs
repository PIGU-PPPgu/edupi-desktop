import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import { fileURLToPath } from "node:url";
import {
  OLD, assertDriverVersion, readInputs, requireValue, safeCode, versionBuild, writeJson,
} from "./windows-upgrade-support.mjs";

export const TARGET = Object.freeze({
  version: "0.3.117", releaseId: "447680099", assetId: "756730447",
  sourceSha: "a55777400dea49f1ba3d953418b6965a41942c3e",
  name: "EduPi_0.3.117_x64-setup.exe", size: 140263717,
  sha256: "5c7dab4a4966333228771bc5b8f43953d4df191bd187dc33779034d1d6fbeb6f",
  signatureId: "756730670", signatureSize: 440,
  signatureSha256: "586155be36c798cc55b5ec5a5898f4b773a14c56e0f5beea46200ce79094a954",
  cohortUrl: "https://raw.githubusercontent.com/PIGU-PPPgu/edupi-desktop/c8bc4aff57f06062ff8bf4e0c56c11b6d74580bd/docs/acceptance/update-cohorts/all-116-117-20261117.json",
  cohortSha256: "9a9e9e2246135ecd2cb311a29358e6a19cfefd106f9b0611a206396910fd0b95",
});
const digest = value => crypto.createHash("sha256").update(value).digest("hex");
const canonical = value => JSON.stringify(value, (_key, item) => {
  if (typeof item === "bigint") return { integer: String(item) };
  if (item instanceof Uint8Array) return { blob: Buffer.from(item).toString("hex") };
  return item && typeof item === "object" && !Array.isArray(item)
    ? Object.fromEntries(Object.keys(item).sort().map(key => [key, item[key]])) : item;
});
const ELEMENT = "element-6066-11e4-a52e-4f735466cecf";
const pause = ms => new Promise(resolve => setTimeout(resolve, ms));
const windowsPath = value => String(value).replaceAll("/", "\\").toLowerCase();

export function remoteDiagnostic(status, value) {
  const allowed = new Set(("session not created failed create start launch browser process exited running webview webview2 webviews " +
    "window windows found missing cannot connect disconnected devtools devtoolsactiveport debug debugging port timeout timed out " +
    "user data directory already use in permission access denied binary executable version supports current chrome edge msedge " +
    "msedgewebview2 file path invalid unknown error no was closed crashed unable environment").split(" "));
  const words = String(value?.message ?? "").toLowerCase().match(/[a-z][a-z0-9]*/gu) ?? [];
  const hResultCategories = [
    ["80070005", "access_denied"],
    ["80070002", "file_not_found"],
    ["80070003", "path_not_found"],
    ["80040154", "class_not_registered"],
    ["80004005", "unspecified_failure"],
  ].filter(([code]) => new RegExp(`\\bHRESULT\\s*[:=(]?\\s*0x${code}\\b`, "iu").test(String(value?.message ?? "")))
    .map(([, category]) => category);
  // A vocabulary, never reconstructed raw text. Paths, URLs, command lines,
  // usernames, opaque identifiers and secrets cannot be included.
  return { httpStatus: status, messageKeywords: [...new Set(words.filter(word => allowed.has(word)))],
    hResultCategories };
}

export class W3CDriver {
  constructor(endpoint, fetcher = fetch) {
    requireValue(/^http:\/\/127\.0\.0\.1:[1-9][0-9]{3,4}$/u.test(endpoint)
      && Number(new URL(endpoint).port) <= 65535, "webdriver_must_use_loopback");
    this.endpoint = endpoint;
    this.fetcher = fetcher;
    this.session = null;
  }
  async request(method, route, body, timeout = 120_000) {
    requireValue(/^\/(?:status|session(?:\/[A-Za-z0-9_-]+(?:\/[A-Za-z0-9_.%/-]+)?)?)$/u.test(route)
      && route.split("/").every(segment => {
        try { return ![".", ".."].includes(decodeURIComponent(segment)); } catch { return false; }
      }),
      "invalid_webdriver_route");
    let response, payload;
    try {
      response = await this.fetcher(`${this.endpoint}${route}`, {
        method, redirect: "error", headers: { "Content-Type": "application/json" },
        ...(body === undefined ? {} : { body: JSON.stringify(body) }), signal: AbortSignal.timeout(timeout),
      });
      payload = await response.json();
    } catch { throw new Error("webdriver_transport_failed"); }
    // Native driver exceptions may include URLs, paths or the request body.
    // Keep only the standard protocol error, never its message or stacktrace.
    if (!response.ok || payload?.value?.error) {
      const error = payload?.value?.error;
      const failure = new Error(`webdriver_${["no such element", "stale element reference", "session not created", "invalid session id",
        "element click intercepted", "timeout", "script timeout", "unknown error"].includes(error)
        ? error.replaceAll(" ", "_") : "protocol_error"}`);
      failure.diagnostic = remoteDiagnostic(response.status, payload?.value);
      throw failure;
    }
    requireValue(payload && Object.hasOwn(payload, "value"), "webdriver_invalid_response");
    return payload.value;
  }
  command(method, route, body, timeout) {
    requireValue(this.session, "webdriver_session_required");
    return this.request(method, `/session/${this.session}${route}`, body, timeout);
  }
  async attach(port) {
    requireValue(Number.isInteger(port) && port >= 1024 && port <= 65535, "invalid_owned_debug_port");
    const value = await this.request("POST", "/session", { capabilities: {
      alwaysMatch: { browserName: "webview2", "ms:edgeChromium": true,
        "ms:edgeOptions": { debuggerAddress: `127.0.0.1:${port}` }, acceptInsecureCerts: false },
      firstMatch: [{}],
    } });
    requireValue(/^[A-Za-z0-9_-]{1,128}$/u.test(value?.sessionId), "webdriver_session_missing");
    this.session = value.sessionId;
    await this.command("POST", "/timeouts", { script: 120_000, pageLoad: 120_000, implicit: 0 });
    return value.capabilities;
  }
  execute(script, args = []) { return this.command("POST", "/execute/sync", { script, args }); }
  executeAsync(script, args = []) { return this.command("POST", "/execute/async", { script, args }); }
  async wait(read, code, seconds = 90) {
    const deadline = Date.now() + seconds * 1000;
    while (Date.now() < deadline) {
      const result = await read();
      if (result) return result;
      await pause(300);
    }
    throw new Error(code);
  }
  // Element lookup uses JS only to choose a visible node. All clicks, typing
  // and dragging below use the actual W3C input endpoints.
  async visible(css, text) {
    return this.execute(`
      return Array.from(document.querySelectorAll(arguments[0])).find(e =>
        e.getClientRects().length && !e.disabled &&
        (arguments[1] === null || e.textContent.trim() === arguments[1])) || null;`, [css, text ?? null]);
  }
  async click(css, text) {
    const element = await this.wait(() => this.visible(css, text), "ui_click_target_unavailable");
    requireValue(typeof element[ELEMENT] === "string", "webdriver_element_missing");
    await this.command("POST", `/element/${element[ELEMENT]}/click`, {});
  }
  async screenshot(directory, name) {
    requireValue(/^windows-upgrade-[a-z-]+\.png$/u.test(name), "invalid_evidence_filename");
    const data = await this.command("GET", "/screenshot");
    requireValue(typeof data === "string" && data.length < 20_000_000, "invalid_screenshot");
    const png = Buffer.from(data, "base64");
    requireValue(png.subarray(0, 8).equals(Buffer.from("89504e470d0a1a0a", "hex")), "invalid_screenshot");
    fs.writeFileSync(path.join(directory, name), png, { flag: "wx", mode: 0o600 });
  }
  async close() {
    if (!this.session) return;
    await this.command("DELETE", "");
    this.session = null;
  }
}

export function pointerDrag(x, y, distance) {
  requireValue([x, y, distance].every(Number.isInteger) && x > 0 && y > 0 && distance !== 0
    && Math.abs(distance) <= 180 && x + distance > 0, "invalid_pointer_coordinates");
  return { actions: [{ type: "pointer", id: "acceptance-mouse", parameters: { pointerType: "mouse" }, actions: [
    { type: "pointerMove", duration: 0, origin: "viewport", x, y },
    { type: "pointerDown", button: 0 },
    { type: "pause", duration: 120 },
    ...[0.25, 0.5, 0.75, 1].map(fraction => ({
      type: "pointerMove", duration: 120, origin: "viewport", x: x + Math.round(distance * fraction), y,
    })),
    { type: "pointerUp", button: 0 },
  ] }] };
}

export function assertPointerEvidence({ events, before, after, saved, restored, beforeWidth, afterWidth, restoredWidth, draftRestored }) {
  requireValue(Array.isArray(events) && events.some(e => e.type === "pointerdown" && e.trusted && e.buttons === 1)
    && events.some(e => e.type === "pointermove" && e.trusted && (e.buttons & 1))
    && events.some(e => e.type === "pointerup" && e.trusted && e.buttons === 0), "trusted_pointer_sequence_missing");
  requireValue([before, after, saved, restored, beforeWidth, afterWidth, restoredWidth].every(Number.isFinite)
    && Math.abs(after - before) >= 24 && Math.abs(saved - after) <= 2
    && Math.abs(restored - saved) <= 2 && Math.abs(afterWidth - beforeWidth) >= 24
    && Math.abs(beforeWidth - before) <= 2 && Math.abs(afterWidth - after) <= 2
    && Math.abs(restoredWidth - restored) <= 2 && draftRestored === true, "pointer_width_or_draft_readback_failed");
}

export function assertNativeIdentity(snapshot, config) {
  const version = config.expectedVersion ?? OLD.version;
  requireValue([OLD.version, TARGET.version].includes(version), "unexpected_native_version");
  requireValue(snapshot?.host?.appVersion === version && snapshot.host.platform === "windows"
    && Number.isSafeInteger(snapshot.host.processId) && snapshot.host.processId > 0
    && (config.expectedPid === undefined || snapshot.host.processId === config.expectedPid)
    && windowsPath(snapshot.host.executablePath) === windowsPath(config.application), `native_${version === OLD.version ? "116" : "117"}_identity_mismatch`);
  requireValue(snapshot.server?.version === version && snapshot.server.status === 204
    && /^[a-f0-9]{64}$/u.test(snapshot.server.instance), "installed_server_identity_or_version_mismatch");
  requireValue(windowsPath(snapshot.roots?.dataRoot) === windowsPath(config.dataRoot)
    && snapshot.roots.dataSource === "environment" && snapshot.roots.coreSource === "bundled"
    && windowsPath(snapshot.roots.coreRoot) === windowsPath(path.win32.join(path.win32.dirname(config.application), "resources", "edupi-core"))
    && snapshot.runtime?.safeMode === true && snapshot.runtime.mobileBridgeEnabled === false,
  "native_isolation_or_safe_mode_mismatch");
}
export function assertNativeSnapshot(snapshot, config) {
  assertNativeIdentity(snapshot, config);
  requireValue(snapshot.status?.core?.status === "ready" && snapshot.status.projection?.status === "ready"
    && snapshot.status.compatibility?.actual?.coreCommit === OLD.coreSha
    && snapshot.status.core.validationMode === "bundled" && snapshot.status.externalSend === false
    && snapshot.status.core.capabilities?.g1_processor === "activation_pending", "core98_source_root_not_ready");
}

async function snapshot(driver) {
  return driver.executeAsync(`
    const done = arguments[arguments.length - 1];
    Promise.all([
      window.__TAURI_INTERNALS__.invoke("computer_use_status"),
      window.__TAURI_INTERNALS__.invoke("get_edupi_root_status"),
      window.__TAURI_INTERNALS__.invoke("get_desktop_runtime_status"),
      fetch("/api/edupi/status?summary=1", {cache:"no-store"}).then(r => {
        if (!r.ok) throw new Error(); return r.json();
      }),
      fetch("/api/desktop/identity", {cache:"no-store"}).then(r=>({status:r.status,instance:r.headers.get("x-pi-desktop-instance")})),
      fetch("/api/updates", {cache:"no-store"}).then(r=>{if(!r.ok)throw new Error();return r.json();})
    ]).then(([computer, roots, runtime, status, identity, updates]) => done({ host: computer.host, roots, runtime, status,
      server:{...identity,version:updates.components?.find(c=>c.project==="edupi-desktop")?.currentVersion} }),
      () => done(null));
  `);
}

async function dismissWelcome(driver) {
  const element = await driver.visible(".edupi-first-run button", "稍后再说");
  if (element) await driver.command("POST", `/element/${element[ELEMENT]}/click`, {});
}

async function checkDragAndDraft(driver, config) {
  const current = await driver.command("GET", "/url");
  const origin = new URL(current);
  requireValue(origin.hostname === "127.0.0.1" && origin.protocol === "http:", "app_origin_must_use_loopback");
  const url = `${origin.origin}/?edupi=1&module=home&view=chat&cwd=${encodeURIComponent(config.dataRoot)}`;
  await driver.command("POST", "/url", { url });
  await dismissWelcome(driver);
  await driver.wait(() => driver.visible('textarea[aria-label="消息"], textarea[aria-label="Message"]'), "chat_input_unavailable");
  const textarea = await driver.visible('textarea[aria-label="消息"], textarea[aria-label="Message"]');
  const syntheticDraft = "合成 Windows 116 鼠标验收草稿，仅供测试，不发送。";
  await driver.command("POST", `/element/${textarea[ELEMENT]}/clear`, {});
  await driver.command("POST", `/element/${textarea[ELEMENT]}/value`, { text: syntheticDraft });
  const selector = '[data-resize-handle="teacher-sidebar"]';
  const geometry = await driver.wait(() => driver.execute(`
    const h = document.querySelector(arguments[0]);
    if (!h || !h.getClientRects().length) return null;
    const panel = document.getElementById(h.getAttribute("aria-controls"));
    if (!panel?.getClientRects().length) return null;
    const r = h.getBoundingClientRect();
    return {x:Math.round(r.x+r.width/2), y:Math.round(r.y+r.height/2),
      before:Number(h.getAttribute("aria-valuenow")), max:Number(h.getAttribute("aria-valuemax")),
      beforeWidth:panel.getBoundingClientRect().width,
      min:Number(h.getAttribute("aria-valuemin"))};`, [selector]), "sidebar_handle_unavailable");
  const distance = geometry.max - geometry.before >= 60 ? 60 : -60;
  requireValue(geometry.before + distance >= geometry.min && geometry.before + distance <= geometry.max,
    "sidebar_has_no_drag_space");
  await driver.execute(`
    window.__windowsUpgradePointer = [];
    for (const type of ["pointerdown", "pointermove", "pointerup"]) {
      document.addEventListener(type, e => {
        if (e.target.closest?.(arguments[0]) || window.__windowsUpgradePointer.some(p => p.type === "pointerdown")) {
          window.__windowsUpgradePointer.push({type:e.type, buttons:e.buttons, trusted:e.isTrusted});
        }
      }, true);
    }`, [selector]);
  try { await driver.command("POST", "/actions", pointerDrag(geometry.x, geometry.y, distance)); }
  finally { await driver.command("DELETE", "/actions").catch(() => {}); }
  const after = await driver.wait(() => driver.execute(`
    const h=document.querySelector(arguments[0]), saved=Number(localStorage.getItem("pi-sidebar-width"));
    const after=Number(h?.getAttribute("aria-valuenow"));
    const panel=h && document.getElementById(h.getAttribute("aria-controls"));
    const afterWidth=panel?.getBoundingClientRect().width;
    return Math.abs(after-arguments[1])>=24 && saved===after && Number.isFinite(afterWidth) && Math.abs(afterWidth-after)<=2
      ? {after,saved,afterWidth,events:window.__windowsUpgradePointer}:null;
  `, [selector, geometry.before]), "pointer_width_or_draft_readback_failed", 10);
  await driver.screenshot(config.evidenceDir, "windows-upgrade-old-drag.png");
  await driver.command("POST", "/refresh", {});
  await dismissWelcome(driver);
  const readback = await driver.wait(() => driver.execute(`
    const h=document.querySelector(arguments[0]);
    const panel=h && document.getElementById(h.getAttribute("aria-controls"));
    const input=document.querySelector('textarea[aria-label="消息"], textarea[aria-label="Message"]');
    if (!h || !panel?.getClientRects().length || !input || !h.getClientRects().length || input.value!==arguments[1]) return null;
    return {restored:Number(h.getAttribute("aria-valuenow")),
      restoredWidth:panel.getBoundingClientRect().width, draftRestored:input.value===arguments[1]};
  `, [selector, syntheticDraft]), "draft_refresh_readback_unavailable", 30);
  const result = { before: geometry.before, beforeWidth: geometry.beforeWidth, ...after, ...readback };
  assertPointerEvidence(result);
  await driver.screenshot(config.evidenceDir, "windows-upgrade-old-readback.png");
  return { status: "passed", input: "W3C pointer mouse and element value", ...result, draftSent: false, reload: true };
}

async function checkAbout(driver, config, screenshotName) {
  const expected = config.expectedVersion ?? OLD.version;
  await driver.click('button[aria-label="设置"], button[aria-label="教师设置"]');
  await driver.click('nav[aria-label="设置分类"] button', "关于与更新");
  const version = await driver.wait(() => driver.execute(`
    const p=document.querySelector('[data-setting-id="updates"]');
    if (!p?.getClientRects().length) return null;
    const pattern=new RegExp("(?:^|[^0-9])"+arguments[0].replaceAll(".","\\\\.")+"(?:[^0-9]|$)");
    return pattern.test(p.innerText) ? arguments[0] : null;
  `, [expected]), "settings_expected_version_not_visible", 30);
  await driver.screenshot(config.evidenceDir, screenshotName);
  return { status: "passed", page: "关于与更新", version, upgradeClicked: false };
}

export async function runWebViewPreflight(config, driver = new W3CDriver(config.endpoint)) {
  versionBuild(config.runtimeVersion);
  requireValue(Number.isInteger(config.expectedPid) && config.expectedPid > 0, "owned_preflight_pid_required");
  const proof = { status: "blocked", actualUpgradePassed: false, phase: "webdriver-connect",
    connectionStrategy: "attach_owned_116", checks: [] };
  const file = path.join(config.evidenceDir, "windows-upgrade-webview.json");
  const save = () => writeJson(file, proof);
  save();
  try {
    const capabilities = await driver.attach(config.attachPort);
    assertDriverVersion(config.runtimeVersion, capabilities?.browserVersion);
    // EdgeDriver releases can report their vendor browserName. The native
    // bridge, executable/data paths, Safe Mode and runtime checks below
    // establish that this is the installed Tauri WebView, not an Edge tab.
    requireValue(["webview2", "msedge", "MicrosoftEdge"].includes(capabilities.browserName), "unexpected_webdriver_browser");
    proof.checks.push({ name: "webview2", status: "passed", browserName: capabilities.browserName,
      browserVersion: capabilities.browserVersion, runtimeVersion: config.runtimeVersion });
    save();
    proof.phase = "native-source-root-core98";
    // Attached WebView2 sessions do not own the native window rectangle.
    // The installed App supplies its real window; observe that viewport.
    proof.viewport = await driver.execute("return {width:innerWidth,height:innerHeight};");
    requireValue(proof.viewport?.width >= 1000 && proof.viewport?.height >= 600, "native_viewport_too_small");
    await driver.wait(() => driver.execute('return Boolean(window.__TAURI_INTERNALS__?.invoke);'), "tauri_bridge_unavailable");
    const native = await driver.wait(async () => {
      const value = await snapshot(driver);
      if (!value) return null;
      assertNativeIdentity(value, config);
      if (value.status?.core?.status !== "ready" || value.status.projection?.status !== "ready") return null;
      assertNativeSnapshot(value, config);
      return value;
    }, "native_status_unavailable", 120);
    assertNativeSnapshot(native, config);
    proof.appPid = native.host.processId;
    proof.checks.push({ name: "native-source-root-core98", status: "passed", version: native.host.appVersion,
      pid: native.host.processId, dataRootMatches: true, coreSource: "bundled", safeMode: true,
      coreCommit: OLD.coreSha, g1: "activation_pending", externalSend: false });
    save();
    await dismissWelcome(driver);
    proof.phase = "pointer-draft-refresh";
    proof.checks.push({ name: proof.phase, ...await checkDragAndDraft(driver, config) });
    save();
    proof.phase = "settings-version";
    proof.checks.push({ name: proof.phase, ...await checkAbout(driver, config, "windows-upgrade-old-about.png") });
    proof.status = "passed";
    proof.phase = "complete";
  } catch (error) {
    proof.code = safeCode(error);
    if (error.diagnostic) proof.diagnostic = error.diagnostic;
    const failed = /mismatch|not_a_real|pointer_width_or_draft|trusted_pointer/u.test(proof.code);
    proof.status = failed ? "failed" : "blocked";
    proof.checks.push({ name: proof.phase, status: proof.status, code: proof.code });
    await driver.screenshot(config.evidenceDir, "windows-upgrade-old-failure.png").catch(() => {});
  } finally {
    try { await driver.close(); proof.sessionClosed = true; }
    catch { proof.sessionClosed = false; proof.status = "blocked"; proof.code ||= "webdriver_session_cleanup_failed"; }
    save();
  }
  return proof;
}

export function assertTargetInputs(input) {
  requireValue(input?.mode === "upgrade" && input.target
    && ["releaseId", "assetId", "sourceSha", "sha256", "version", "cohortUrl"]
      .every(key => input.target[key] === TARGET[key]), "fixed_upgrade_target_required");
  return input.target;
}

export function assertTargetMetadata(release) {
  requireValue(String(release?.id) === TARGET.releaseId && release.draft === false
    && release.tag_name === `v${TARGET.version}` && release.target_commitish === TARGET.sourceSha,
  "public_target_release_identity_mismatch");
  const select = (id, name, size, sha256) => {
    const assets = (release.assets ?? []).filter(item => String(item.id) === id || item.name === name);
    requireValue(assets.length === 1, "target_asset_not_unique");
    const asset = assets[0];
    requireValue(String(asset.id) === id && asset.name === name && asset.size === size
      && asset.digest === `sha256:${sha256}` && asset.state === "uploaded"
      && asset.url === `https://api.github.com/repos/${OLD.repository}/releases/assets/${id}`
      && asset.browser_download_url === `https://github.com/${OLD.repository}/releases/download/v${TARGET.version}/${name}`,
    "public_target_asset_metadata_mismatch");
    return { id, name, size, sha256 };
  };
  return {
    installer: select(TARGET.assetId, TARGET.name, TARGET.size, TARGET.sha256),
    signature: select(TARGET.signatureId, `${TARGET.name}.sig`, TARGET.signatureSize, TARGET.signatureSha256),
  };
}

// Only public, fixed first-party requests. No token, proxy credentials, signed
// redirect URL or executable download file enters the App or evidence.
async function publicGet(url, fetcher, accept = "application/vnd.github+json") {
  let response = await fetcher(url, { redirect: "manual", headers: { Accept: accept },
    signal: AbortSignal.timeout(1_200_000) });
  if ([301, 302, 303, 307, 308].includes(response.status)) {
    requireValue(url.startsWith(`https://api.github.com/repos/${OLD.repository}/releases/assets/`),
      "unexpected_public_redirect");
    let target;
    try { target = new URL(response.headers.get("location")); } catch { throw new Error("invalid_public_asset_redirect"); }
    requireValue(target.protocol === "https:" && !target.username && !target.password && !target.port && !target.hash
      && ["release-assets.githubusercontent.com", "objects.githubusercontent.com"].includes(target.hostname),
    "untrusted_public_asset_redirect");
    await response.body?.cancel();
    response = await fetcher(target.href, { redirect: "error", headers: { Accept: accept },
      signal: AbortSignal.timeout(1_200_000) });
  }
  requireValue(response.ok && response.body, "public_target_download_unavailable");
  return response;
}

export async function measureResponse(response, { size, sha256 }, keep = false) {
  let count = 0;
  const hash = crypto.createHash("sha256"), chunks = [];
  requireValue(response?.ok && response.body && Number.isSafeInteger(size) && size > 0
    && /^[a-f0-9]{64}$/u.test(sha256) && (!keep || size <= 65_536), "invalid_target_measurement");
  for await (const chunk of response.body) {
    count += chunk.length;
    requireValue(count <= size, "public_target_size_exceeded");
    hash.update(chunk);
    if (keep) chunks.push(Buffer.from(chunk));
  }
  requireValue(count === size && hash.digest("hex") === sha256, "public_target_bytes_mismatch");
  return keep ? Buffer.concat(chunks) : { size: count, sha256 };
}

export function assertCohort(cohort, signature) {
  requireValue(cohort?.version === TARGET.version && typeof signature === "string"
    && signature.length > 0 && signature.length < 1024
    && /^[A-Za-z0-9+/]+={0,2}$/u.test(signature), "target_cohort_signature_invalid");
  const decoded = Buffer.from(signature, "base64").toString("utf8");
  // This checks the signed-version envelope, NOT its cryptographic validity.
  // Only the installed native updater is permitted to verify/install it.
  requireValue(decoded.split(/\r?\n/u).some(line => line.startsWith("trusted comment:")
    && line.includes(`file:${TARGET.name}\tversion:${TARGET.version}`)), "target_signed_version_envelope_missing");
  for (const platform of ["windows-x86_64", "windows-x86_64-nsis"]) {
    requireValue(cohort.platforms?.[platform]?.url
      === `https://api.github.com/repos/${OLD.repository}/releases/assets/${TARGET.assetId}`
      && cohort.platforms[platform].signature === signature, "target_cohort_platform_mismatch");
  }
}

export async function verifyPublicTarget(input, { fetcher = fetch, measure = measureResponse } = {}) {
  assertTargetInputs(input);
  const base = `https://api.github.com/repos/${OLD.repository}`;
  const release = await (await publicGet(`${base}/releases/${TARGET.releaseId}`, fetcher)).json();
  const assets = assertTargetMetadata(release);
  let object = (await (await publicGet(`${base}/git/ref/tags/v${TARGET.version}`, fetcher)).json()).object;
  if (object?.type === "tag") {
    requireValue(/^[a-f0-9]{40}$/u.test(object.sha), "target_tag_invalid");
    object = (await (await publicGet(`${base}/git/tags/${object.sha}`, fetcher)).json()).object;
  }
  requireValue(object?.type === "commit" && object.sha === TARGET.sourceSha, "target_tag_source_mismatch");
  const sig = await measure(await publicGet(`${base}/releases/assets/${TARGET.signatureId}`, fetcher,
    "application/octet-stream"), assets.signature, true);
  const response = await publicGet(TARGET.cohortUrl, fetcher, "application/json");
  const pieces = [];
  let size = 0;
  for await (const piece of response.body) {
    size += piece.length;
    requireValue(size <= 65_536, "cohort_too_large");
    pieces.push(Buffer.from(piece));
  }
  const bytes = Buffer.concat(pieces);
  requireValue(digest(bytes) === TARGET.cohortSha256, "fixed_cohort_bytes_mismatch");
  assertCohort(JSON.parse(bytes.toString("utf8")), sig.toString("utf8").trim());
  await measure(await publicGet(`${base}/releases/assets/${TARGET.assetId}`, fetcher,
    "application/octet-stream"), assets.installer);
  return { status: "passed", ...TARGET, tagSourceVerified: true, publicAnonymousFullBytesVerified: true,
    cohortSha256: digest(bytes), signatureMatchesPublicAsset: true, nativeSignatureVerification: "required_during_ui_upgrade" };
}

export const SYNTHETIC_MODELS = Object.freeze({ providers: { synthetic: {
  api: "openai-completions", baseUrl: "http://127.0.0.1:9/v1",
  models: [{ id: "offline", name: "Synthetic offline", input: ["text"], contextWindow: 4096, maxTokens: 256,
    cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 } }],
} } });

export async function readStorage(file) {
  const stat = fs.lstatSync(file, { bigint: true });
  requireValue(stat.isFile() && !stat.isSymbolicLink() && stat.size > 0n && stat.ino > 0n, "database_identity_missing");
  const { DatabaseSync } = await import("node:sqlite");
  const db = new DatabaseSync(file, { readOnly: true });
  try {
    db.exec("PRAGMA query_only=ON; BEGIN");
    const query = sql => { const statement = db.prepare(sql); statement.setReadBigInts(true); return statement.all(); };
    requireValue(canonical(query("PRAGMA quick_check")) === canonical([{ quick_check: "ok" }]), "sqlite_quick_check_failed");
    const schema = query("SELECT name,sql FROM sqlite_master WHERE type='table' ORDER BY name");
    requireValue(schema.length > 0, "database_schema_missing");
    const quote = name => `"${name.replaceAll('"', '""')}"`;
    const records = {};
    for (const { name } of schema) {
      if (name.startsWith("sqlite_")) continue;
      const info = query(`PRAGMA table_info(${quote(name)})`);
      let columns = info.map(row => row.name), keys = info.filter(row => row.pk > 0n).sort((a, b) => Number(a.pk - b.pk)).map(row => row.name);
      if (name === "authority") { columns = ["singleton", "schema_version", "root_fingerprint"]; keys = ["singleton"]; }
      if (name === "events") {
        columns = ["event_id", "event_version", "event_type", "occurrence_time", "source_ref", "actor_ref", "scope_ref",
          "revision_ref", "payload_json", "canonical_json", "canonical_hash", "external_send"]; keys = ["event_id"];
      }
      const entries = query(`SELECT ${columns.map(quote).join(",")} FROM ${quote(name)}`).map(row => [
        digest(canonical(keys.length ? Object.fromEntries(keys.map(key => [key, row[key]])) : row)), digest(canonical(row)),
      ]).sort((a, b) => a[0].localeCompare(b[0]));
      requireValue(new Set(entries.map(row => row[0])).size === entries.length, "database_record_identity_not_unique");
      records[name] = entries;
    }
    requireValue(records.authority?.length === 1 && records.events?.length > 0, "database_baseline_records_missing");
    const after = fs.lstatSync(file, { bigint: true });
    requireValue(after.ino === stat.ino && after.dev === stat.dev && after.birthtimeNs === stat.birthtimeNs,
      "database_replaced_during_snapshot");
    return { readOnly: true, quickCheck: "ok", fileIdentity: [String(stat.dev), String(stat.ino), String(stat.birthtimeNs)],
      schemaSha256: digest(canonical(schema)), userVersion: String(query("PRAGMA user_version")[0].user_version),
      persistentRecords: records };
  } finally { db.close(); }
}

export function assertStoragePreserved(before, after) {
  for (const key of ["fileIdentity", "schemaSha256", "userVersion", "quickCheck", "readOnly"]) {
    requireValue(canonical(before?.[key]) === canonical(after?.[key]), "upgrade_database_identity_or_schema_changed");
  }
  requireValue(before.readOnly === true && before.quickCheck === "ok" && before.persistentRecords?.authority?.length === 1
    && before.persistentRecords.events?.length > 0, "upgrade_database_baseline_missing");
  for (const [table, records] of Object.entries(before.persistentRecords)) {
    const restored = new Map(after.persistentRecords?.[table] ?? []);
    requireValue(records.every(([id, hash]) => restored.get(id) === hash), "upgrade_database_record_changed");
  }
}

async function productData(driver, config, seed) {
  const markerPath = path.win32.join(config.dataRoot, ".edupi", "output", "upgrade-synthetic-marker.json");
  const route = "/api/files/" + markerPath.replaceAll("\\", "/").split("/").map(encodeURIComponent).join("/") + "?type=read";
  const result = await driver.executeAsync(`
    const [seed,models,markerRoute,values]=arguments, done=arguments[arguments.length-1];
    (async()=>{
      const json=async(url,init={})=>{
        const r=await fetch(url,{cache:"no-store",...init});
        if(!r.ok)throw new Error();return r.json();
      };
      // The desktop token never leaves this trusted WebView closure.
      const token=await window.__TAURI_INTERNALS__.invoke("get_desktop_api_token");
      const headers={"Content-Type":"application/json","x-pi-desktop-token":token};
      let contextId=null;
      if(seed){
        const capture=await json("/api/edupi/onboarding",{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify(values)});
        contextId=capture.candidate?.contextId;
        await json("/api/models-config",{method:"PUT",headers,body:JSON.stringify(models)});
      }
      const workspace=await json("/api/edupi/workspace");
      const candidates=workspace.data?.teacherContextCandidates||[];
      const candidate=candidates.find(c=>seed?c.contextId===contextId:c.contextId===values.contextId);
      const model=await json("/api/models-config",{headers});
      const marker=await json(markerRoute);
      return {workspace:workspace.data?.workspace,context:candidate?{contextId:candidate.contextId,proposedValues:candidate.proposedValues}:null,
        model,marker:marker.content};
    })().then(done,()=>done(null));
  `, [seed, SYNTHETIC_MODELS, route, seed ? config.syntheticValues : { contextId: config.contextId }]);
  requireValue(result && windowsPath(result.workspace) === windowsPath(config.dataRoot)
    && typeof result.context?.contextId === "string"
    && canonical(result.model) === canonical(SYNTHETIC_MODELS)
    && typeof result.marker === "string", "synthetic_product_readback_failed");
  return result;
}

function markerSnapshot(file) {
  const stat = fs.lstatSync(file, { bigint: true });
  requireValue(stat.isFile() && !stat.isSymbolicLink() && stat.ino > 0n, "marker_identity_missing");
  return { sha256: digest(fs.readFileSync(file)), fileIdentity: [String(stat.dev), String(stat.ino), String(stat.birthtimeNs)] };
}

export function assertSyntheticPreserved(before, after) {
  requireValue(before?.context?.contextId && canonical(before.context) === canonical(after?.context)
    && canonical(before.model) === canonical(SYNTHETIC_MODELS) && canonical(after.model) === canonical(before.model)
    && before.marker === after.marker && canonical(before.markerFile) === canonical(after.markerFile),
  "upgrade_synthetic_same_object_readback_failed");
}

// The observer acknowledges only a verified native installer and old process
// exit. It is the sole source of this acknowledgement; no UI event fabricates it.
export async function requestUiUpgrade(config, driver = new W3CDriver(config.endpoint), storage = readStorage) {
  const proof = { status: "blocked", actualUpgradePassed: false, phase: "attach-old", seededViaApi: false, uiSaved: false };
  const save = () => writeJson(path.join(config.evidenceDir, "windows-upgrade-trigger.json"), proof);
  let triggered = false, acknowledged = false;
  save();
  try {
    requireValue(config.expectedVersion === OLD.version && config.target?.status === "passed"
      && config.target.sha256 === TARGET.sha256 && config.target.cohortUrl === TARGET.cohortUrl, "verified_target_required");
    const capabilities = await driver.attach(config.attachPort);
    assertDriverVersion(config.runtimeVersion, capabilities?.browserVersion);
    const oldNative = await snapshot(driver);
    assertNativeSnapshot(oldNative, config);
    proof.phase = "seed-and-readback"; save();
    const nonce = crypto.randomUUID();
    config.syntheticValues = { name: `Synthetic-${nonce}`, role: "合成验收教师", subject: "测试", grade: "synthetic", class_name: "no-real-students" };
    const markerFile = path.join(config.dataRoot, ".edupi", "output", "upgrade-synthetic-marker.json");
    fs.mkdirSync(path.dirname(markerFile), { recursive: true });
    fs.writeFileSync(markerFile, JSON.stringify({ synthetic: true, nonce, noRealModelsOrTeacherData: true }), { flag: "wx", mode: 0o600 });
    const data = await productData(driver, config, true);
    requireValue(canonical(data.context.proposedValues) === canonical(config.syntheticValues)
      && data.marker === fs.readFileSync(markerFile, "utf8"), "synthetic_seed_readback_failed");
    const baseline = { ...data, serverInstance: oldNative.server.instance, markerFile: markerSnapshot(markerFile),
      storage: await storage(path.join(config.dataRoot, ".edupi", "runtime", "core-runtime-v1.sqlite")) };
    writeJson(config.baselineFile, baseline);
    proof.seededViaApi = true;
    proof.baseline = { contextIdSha256: digest(data.context.contextId), modelSha256: digest(canonical(data.model)),
      markerSha256: baseline.markerFile.sha256, sqlReadOnly: true };
    await checkAbout(driver, config, "windows-upgrade-old-trigger-about.png");
    proof.phase = "old-ui-check-update"; save();
    await driver.click('[data-setting-id="updates"] .app-settings-row__control button.native-button:not(.native-button-primary)');
    await driver.wait(() => driver.execute(`
      const p=document.querySelector('[data-setting-id="updates"]');
      return p?.getClientRects().length && /(?:^|[^0-9])0\\.3\\.117(?:[^0-9]|$)/.test(p.innerText)
        && Boolean(p.querySelector(".app-settings-row__control button.native-button-primary:not(:disabled)"));
    `), "ui_target_117_not_available", 120);
    await driver.screenshot(config.evidenceDir, "windows-upgrade-ui-target.png");
    await driver.click('[data-setting-id="updates"] .app-settings-row__control .native-button-primary');
    await driver.wait(() => driver.visible(".settings-update-preflight button", "继续更新"), "ui_continue_update_missing");
    await driver.execute(`
      const flags={downloading:false,verifying:false,installing:false,error:false};
      window.__windowsUpgradeObserved=flags;
      const sample=()=>{
        const p=document.querySelector('[data-setting-id="updates"]');
        const t=p?.querySelector(".app-settings-row__control .native-button-primary")?.textContent||"";
        flags.downloading ||= /下载|Downloading/i.test(t);
        flags.verifying ||= /验证|校验|Verifying/i.test(t);
        flags.installing ||= /安装|Installing/i.test(t);
        flags.error ||= Boolean(p?.querySelector('[role="alert"]'));
      };
      new MutationObserver(sample).observe(document.body,{childList:true,subtree:true,characterData:true});sample();
    `);
    // Persist the start boundary BEFORE the W3C click; no installer may predate it.
    proof.triggeredAt = new Date().toISOString(); proof.phase = "native-download-signature-nsis"; save();
    writeJson(config.triggerFile, { triggeredAt: proof.triggeredAt, oldPid: config.expectedPid });
    await driver.click(".settings-update-preflight button", "继续更新");
    triggered = true; proof.uiContinueClicked = true; save();
    const deadline = Date.now() + (config.timeoutMs ?? 600_000);
    while (Date.now() < deadline) {
      if (fs.existsSync(config.ackFile)) {
        const ack = JSON.parse(fs.readFileSync(config.ackFile, "utf8"));
        requireValue(ack.oldPid === config.expectedPid && ack.oldExited === true && ack.installerVerified === true,
          "native_observer_ack_invalid");
        acknowledged = true;
        requireValue(proof.observed?.downloading === true, "native_download_ui_evidence_missing");
        proof.status = "passed"; proof.phase = "old-exited-native-installer-observed"; break;
      }
      try {
        const observed = await driver.execute("return window.__windowsUpgradeObserved || null;");
        if (observed) {
          proof.observed = observed; save();
          requireValue(!observed.error, "old_ui_native_upgrade_error");
        }
      } catch (error) {
        if (safeCode(error) === "old_ui_native_upgrade_error") throw error;
        proof.webviewDisconnected = true; save();
      }
      await pause(config.pollMs ?? 250);
    }
    requireValue(acknowledged, "native_installer_or_old_exit_not_observed");
  } catch (error) {
    proof.code = safeCode(error); proof.status = "blocked";
    await driver.screenshot(config.evidenceDir, "windows-upgrade-trigger-failure.png").catch(() => {});
  } finally {
    // A DELETE after old exit could reach the new WebView on its reused port.
    // PS retires only the retained driver processes before attaching afresh.
    if (!triggered) {
      await driver.close().catch(() => {});
      proof.sessionReleased = true;
    } else {
      proof.sessionReleased = false;
      proof.oldSessionAbandonedAfterNativeExit = acknowledged;
      proof.oldSessionCloseIssued = false;
    }
    save();
  }
  return proof;
}

export async function verifyUpgradedWebView(config, driver = new W3CDriver(config.endpoint), storage = readStorage) {
  const proof = { status: "blocked", actualUpgradePassed: false, phase: "attach-automatically-restarted-117",
    connectionStrategy: "attach_only", manuallyLaunched: false };
  const save = () => writeJson(path.join(config.evidenceDir, "windows-upgrade-readback.json"), proof);
  save();
  try {
    requireValue(config.expectedVersion === TARGET.version && config.observer?.status === "passed"
      && config.observer.newPid === config.expectedPid && config.observer.oldPid !== config.expectedPid
      && config.observer.installerSha256 === TARGET.sha256 && config.observer.automaticRestart === true,
    "verified_automatic_restart_required");
    const capabilities = await driver.attach(config.attachPort);
    assertDriverVersion(config.runtimeVersion, capabilities?.browserVersion);
    const native = await driver.wait(async () => {
      const value = await snapshot(driver);
      if (!value) return null;
      assertNativeIdentity(value, config);
      if (value.status?.core?.status !== "ready" || value.status?.projection?.status !== "ready") return null;
      assertNativeSnapshot(value, config);
      return value;
    }, "new_native_status_unavailable", 120);
    proof.native = { pid: native.host.processId, version: TARGET.version, sameExecutablePath: true,
      dataRootMatches: true, coreRootMatches: true, coreCommit: OLD.coreSha, externalSend: false, safeMode: true };
    proof.phase = "same-object-readback"; save();
    const before = JSON.parse(fs.readFileSync(config.baselineFile, "utf8"));
    requireValue(/^[a-f0-9]{64}$/u.test(before.serverInstance) && native.server.instance !== before.serverInstance,
      "new_server_instance_not_observed");
    const after = await productData(driver, { ...config, contextId: before.context.contextId }, false);
    after.markerFile = markerSnapshot(path.join(config.dataRoot, ".edupi", "output", "upgrade-synthetic-marker.json"));
    assertSyntheticPreserved(before, after);
    const database = await storage(path.join(config.dataRoot, ".edupi", "runtime", "core-runtime-v1.sqlite"));
    assertStoragePreserved(before.storage, database);
    proof.readback = { status: "passed", seededViaApi: true, uiSaved: false, sameTeacherContextId: true,
      sameSyntheticMarkerBytesAndFile: true, sameOfflineModel: true, sameSqlFileAndRecords: true,
      newInstalledServerVersion: TARGET.version, newServerInstance: true,
      contextIdSha256: digest(before.context.contextId), modelSha256: digest(canonical(after.model)),
      markerSha256: after.markerFile.sha256, sqlSchemaSha256: database.schemaSha256 };
    await dismissWelcome(driver);
    await checkAbout(driver, config, "windows-upgrade-new-about.png");
    proof.status = "passed"; proof.phase = "complete";
  } catch (error) {
    proof.code = safeCode(error);
    await driver.screenshot(config.evidenceDir, "windows-upgrade-readback-failure.png").catch(() => {});
  } finally {
    try { await driver.close(); proof.sessionClosed = true; }
    catch { proof.sessionClosed = false; proof.status = "blocked"; proof.code ||= "new_webdriver_cleanup_failed"; }
    save();
  }
  return proof;
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    const config = JSON.parse(fs.readFileSync(process.env.WINDOWS_UPGRADE_RUN_CONFIG, "utf8"));
    let result;
    if (config.action === "verify-target") {
      const file = path.join(config.evidenceDir, "windows-upgrade-target.json");
      writeJson(file, { status: "blocked", actualUpgradePassed: false, phase: "public-target-verification" });
      try {
        result = await verifyPublicTarget(readInputs(config.inputEnvironment));
        writeJson(file, result);
      } catch (error) {
        writeJson(file, { status: "blocked", actualUpgradePassed: false, phase: "public-target-verification", code: safeCode(error) });
        throw error;
      }
    } else {
      requireValue(process.platform === "win32", "windows_only");
      requireValue(["preflight", "request-upgrade", "verify-upgrade"].includes(config.action), "unknown_helper_action");
      result = await ({ preflight: runWebViewPreflight, "request-upgrade": requestUiUpgrade, "verify-upgrade": verifyUpgradedWebView })[config.action](config);
    }
    console.log(JSON.stringify({ status: result.status, code: result.code ?? null }));
    if (result.status !== "passed") process.exitCode = 1;
  } catch (error) {
    console.error(JSON.stringify({ status: "blocked", code: safeCode(error) }));
    process.exitCode = 1;
  }
}
