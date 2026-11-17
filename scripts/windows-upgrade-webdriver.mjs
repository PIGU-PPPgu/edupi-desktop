import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  OLD, assertDriverVersion, requireValue, safeCode, versionBuild, writeJson,
} from "./windows-upgrade-support.mjs";

const ELEMENT = "element-6066-11e4-a52e-4f735466cecf";
const pause = ms => new Promise(resolve => setTimeout(resolve, ms));
const windowsPath = value => String(value).replaceAll("/", "\\").toLowerCase();

export class W3CDriver {
  constructor(endpoint, fetcher = fetch) {
    requireValue(/^http:\/\/127\.0\.0\.1:[1-9][0-9]{3,4}$/u.test(endpoint)
      && Number(new URL(endpoint).port) <= 65535, "webdriver_must_use_loopback");
    this.endpoint = endpoint;
    this.fetcher = fetcher;
    this.session = null;
  }
  async request(method, route, body, timeout = 120_000) {
    requireValue(/^\/(?:status|session(?:\/[A-Za-z0-9_-]+(?:\/[A-Za-z0-9_/-]+)?)?)$/u.test(route),
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
      throw new Error(`webdriver_${["no such element", "stale element reference", "session not created", "invalid session id",
        "element click intercepted", "timeout", "script timeout", "unknown error"].includes(error)
        ? error.replaceAll(" ", "_") : "protocol_error"}`);
    }
    requireValue(payload && Object.hasOwn(payload, "value"), "webdriver_invalid_response");
    return payload.value;
  }
  command(method, route, body, timeout) {
    requireValue(this.session, "webdriver_session_required");
    return this.request(method, `/session/${this.session}${route}`, body, timeout);
  }
  async launch(application) {
    const value = await this.request("POST", "/session", { capabilities: {
      alwaysMatch: { "tauri:options": { application, args: ["--safe-mode"] }, acceptInsecureCerts: false },
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
  requireValue(snapshot?.host?.appVersion === OLD.version && snapshot.host.platform === "windows"
    && Number.isSafeInteger(snapshot.host.processId) && snapshot.host.processId > 0
    && windowsPath(snapshot.host.executablePath) === windowsPath(config.application), "native_116_identity_mismatch");
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
      })
    ]).then(([computer, roots, runtime, status]) => done({ host: computer.host, roots, runtime, status }),
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

async function checkAbout(driver, config) {
  await driver.click('button[aria-label="设置"], button[aria-label="教师设置"]');
  await driver.click('nav[aria-label="设置分类"] button', "关于与更新");
  const version = await driver.wait(() => driver.execute(`
    const p=document.querySelector('[data-setting-id="updates"]');
    if (!p?.getClientRects().length) return null;
    return /(?:^|[^0-9])0\\.3\\.116(?:[^0-9]|$)/.test(p.innerText) ? "0.3.116" : null;
  `), "settings_116_version_not_visible", 30);
  await driver.screenshot(config.evidenceDir, "windows-upgrade-old-about.png");
  return { status: "passed", page: "关于与更新", version, upgradeClicked: false };
}

export async function runWebViewPreflight(config, driver = new W3CDriver(config.endpoint)) {
  versionBuild(config.runtimeVersion);
  const proof = { status: "blocked", actualUpgradePassed: false, phase: "webdriver-connect", checks: [] };
  const file = path.join(config.evidenceDir, "windows-upgrade-webview.json");
  const save = () => writeJson(file, proof);
  save();
  try {
    const capabilities = await driver.launch(config.application);
    assertDriverVersion(config.runtimeVersion, capabilities?.browserVersion);
    // EdgeDriver releases can report their vendor browserName. The native
    // bridge, executable/data paths, Safe Mode and runtime checks below
    // establish that this is the installed Tauri WebView, not an Edge tab.
    requireValue(["webview2", "msedge", "MicrosoftEdge"].includes(capabilities.browserName), "unexpected_webdriver_browser");
    proof.checks.push({ name: "webview2", status: "passed", browserName: capabilities.browserName,
      browserVersion: capabilities.browserVersion, runtimeVersion: config.runtimeVersion });
    save();
    proof.phase = "native-source-root-core98";
    await driver.command("POST", "/window/rect", { width: 1440, height: 1000 });
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
    proof.checks.push({ name: proof.phase, ...await checkAbout(driver, config) });
    proof.status = "passed";
    proof.phase = "complete";
  } catch (error) {
    proof.code = safeCode(error);
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

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    requireValue(process.platform === "win32", "windows_only");
    const config = JSON.parse(fs.readFileSync(process.env.WINDOWS_UPGRADE_RUN_CONFIG, "utf8"));
    const result = await runWebViewPreflight(config);
    console.log(JSON.stringify({ status: result.status, code: result.code ?? null }));
    if (result.status !== "passed") process.exitCode = 1;
  } catch (error) {
    console.error(JSON.stringify({ status: "blocked", code: safeCode(error) }));
    process.exitCode = 1;
  }
}
