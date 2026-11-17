#!/usr/bin/env node

// Existing signed AppImages only. No build, signing, release mutation, feed
// mutation or manual target-version launch is available in this harness.
import assert from "node:assert/strict";
import { createHash, randomBytes } from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { execFileSync, spawn } from "node:child_process";
import { Readable, Transform } from "node:stream";
import { pipeline } from "node:stream/promises";
import { setTimeout as pause } from "node:timers/promises";
import { pathToFileURL } from "node:url";
import { W3CDriver } from "./windows-upgrade-webdriver.mjs";
import { STORAGE_PROGRAM } from "./test-macos-installed-acceptance.mjs";

const REPOSITORY = "PIGU-PPPgu/edupi-desktop";
const CORE = "98e4f7cd0c31dd30954574d2040bb1b948cdd954";
export const OLD_LINUX = Object.freeze({
  version: "0.3.116", source: "13de2b53d08d487a6abceb91ec1e37bd919af690",
  release: 447334004, asset: 755747553, bytes: 286820856,
  digest: "sha256:c354c4ab92c2845572016e7d15696fc363c52dbc17cd689e5f291c7471bb5027",
});
export const NEW_LINUX = Object.freeze({
  version: "0.3.117", source: "a55777400dea49f1ba3d953418b6965a41942c3e",
  release: 447680099, asset: 756698080, bytes: 289778168,
  digest: "sha256:0a4adcb61c714bc178e39eb147ac53267e4471c7b0a5c2b300978b9864266028",
  signatureAsset: 756698584,
  signatureDigest: "sha256:e5a602a033e64512609ba30bc247f900ee6a377deb01e93dd90c84ece626d1b4",
});
const ELEMENT = "element-6066-11e4-a52e-4f735466cecf";
const hash = bytes => `sha256:${createHash("sha256").update(bytes).digest("hex")}`;
const json = file => JSON.parse(fs.readFileSync(file, "utf8"));
const inside = (root, file) => file.startsWith(`${root}/`);
const code = error => {
  const value = error?.code || error?.message;
  return /^[a-z][a-z0-9_]{0,120}$/u.test(value || "") ? value : "linux_acceptance_failed";
};
function check(value, reason) {
  if (!value) throw Object.assign(new Error(reason), { code: reason });
}
function save(file, value) {
  fs.mkdirSync(path.dirname(file), { recursive: true, mode: 0o700 });
  fs.writeFileSync(file, `${JSON.stringify(value, null, 2)}\n`, { mode: 0o600 });
}
export function requireLinuxRunner(env, platform = process.platform) {
  check(platform === "linux" && env.GITHUB_ACTIONS === "true"
    && env.RUNNER_ENVIRONMENT === "github-hosted" && env.RUNNER_OS === "Linux",
  "fresh_hosted_linux_required");
}
export function linuxInputs(env) {
  const mode = env.LINUX_UPGRADE_MODE || "preflight";
  check(["preflight", "upgrade"].includes(mode), "invalid_acceptance_mode");
  const cohort = env.LINUX_UPGRADE_COHORT_URL || null;
  if (mode === "preflight") check(cohort === null, "preflight_cannot_select_update_feed");
  else check(typeof cohort === "string"
    && /^https:\/\/raw\.githubusercontent\.com\/PIGU-PPPgu\/edupi-desktop\/[a-f0-9]{40}\/docs\/acceptance\/update-cohorts\/[a-z0-9][a-z0-9-]{0,63}\.json$/u.test(cohort)
    && new URL(cohort).href === cohort, "immutable_first_party_cohort_required");
  return { mode, cohort };
}
export function linuxReleaseAsset(release, expected, publicRequired = false) {
  check(release?.id === expected.release && release.target_commitish === expected.source
    && release.tag_name === `v${expected.version}` && typeof release.draft === "boolean",
  "linux_release_identity_mismatch");
  if (publicRequired) check(release.draft === false, "public_target_required");
  const matches = release.assets?.filter(asset => asset.id === expected.asset) || [];
  check(matches.length === 1, "linux_asset_id_missing_or_duplicated");
  const asset = matches[0];
  check(asset.name === `EduPi_${expected.version}_amd64.AppImage` && asset.state === "uploaded"
    && asset.size === expected.bytes && asset.digest === expected.digest
    && asset.url === `https://api.github.com/repos/${REPOSITORY}/releases/assets/${expected.asset}`,
  "linux_asset_identity_mismatch");
  return asset;
}
export function linuxCohort(manifest, signature) {
  check(manifest?.version === NEW_LINUX.version, "cohort_target_version_mismatch");
  for (const platform of ["linux-x86_64", "linux-x86_64-appimage"]) {
    const entry = manifest.platforms?.[platform];
    check(entry?.url === `https://api.github.com/repos/${REPOSITORY}/releases/assets/${NEW_LINUX.asset}`
      && entry.signature === signature.trim(), "cohort_linux_asset_or_signature_mismatch");
  }
}
function reader(token) {
  async function request(relative, accept, authenticated) {
    const headers = { Accept: accept, "User-Agent": "edupi-linux-installed-acceptance",
      ...(authenticated && token ? { Authorization: `Bearer ${token}` } : {}) };
    let response = await fetch(`https://api.github.com/repos/${REPOSITORY}${relative}`, {
      method: "GET", headers, redirect: "manual", signal: AbortSignal.timeout(600_000),
    });
    if (response.status === 302 && accept === "application/octet-stream") {
      const target = new URL(response.headers.get("location"));
      check(target.protocol === "https:" && !target.username && !target.password && !target.port
        && ["release-assets.githubusercontent.com", "objects.githubusercontent.com"].includes(target.hostname),
      "unsafe_asset_redirect");
      await response.body?.cancel();
      response = await fetch(target, { method: "GET", redirect: "error",
        signal: AbortSignal.timeout(600_000) });
    }
    check(response.status === 200, "github_read_failed");
    return response;
  }
  return {
    metadata: async (release, authenticated) => (await request(`/releases/${release}`,
      "application/vnd.github+json", authenticated)).json(),
    asset: (asset, authenticated) => request(`/releases/assets/${asset}`, "application/octet-stream", authenticated),
  };
}
async function download(response, file, expected) {
  let bytes = 0;
  const digest = createHash("sha256");
  const meter = new Transform({ transform(chunk, _, done) {
    bytes += chunk.length;
    if (bytes > expected.bytes) return done(Object.assign(new Error(), { code: "asset_size_exceeded" }));
    digest.update(chunk); done(null, chunk);
  } });
  await pipeline(Readable.fromWeb(response.body), meter, fs.createWriteStream(file, { flags: "wx", mode: 0o700 }));
  check(bytes === expected.bytes && `sha256:${digest.digest("hex")}` === expected.digest,
    "asset_bytes_or_digest_mismatch");
}
async function fileHash(file) {
  const digest = createHash("sha256");
  for await (const part of fs.createReadStream(file)) digest.update(part);
  return `sha256:${digest.digest("hex")}`;
}
function paths(env) {
  const root = env.LINUX_UPGRADE_TASK;
  const evidence = env.LINUX_UPGRADE_EVIDENCE;
  check(path.isAbsolute(root || "") && root === path.resolve(root) && /^edupi-linux-upgrade-[0-9]+-[0-9]+$/u.test(path.basename(root)),
    "invalid_linux_task_path");
  check(path.dirname(root) === fs.realpathSync(env.RUNNER_TEMP), "task_must_be_direct_runner_temp_child");
  check(path.isAbsolute(evidence || "") && !inside(root, evidence), "evidence_must_survive_task_cleanup");
  return { root, evidence, config: path.join(root, "config.json"), app: path.join(root, "application.AppImage") };
}
async function prepare(env) {
  requireLinuxRunner(env);
  const inputs = linuxInputs(env), p = paths(env);
  check(!fs.existsSync(p.root), "task_already_exists");
  fs.mkdirSync(p.root, { mode: 0o700 });
  const taskIdentity = fs.statSync(p.root).ino;
  save(p.config, { ...inputs, ...p, taskIdentity });
  const api = reader(env.GH_TOKEN);
  const release = await api.metadata(OLD_LINUX.release, true);
  linuxReleaseAsset(release, OLD_LINUX);
  await download(await api.asset(OLD_LINUX.asset, true), p.app, OLD_LINUX);
  linuxReleaseAsset(await api.metadata(OLD_LINUX.release, true), OLD_LINUX);
  let target = null;
  if (inputs.mode === "upgrade") {
    // A public metadata read and signature download do not use the Draft token.
    const published = await api.metadata(NEW_LINUX.release, false);
    linuxReleaseAsset(published, NEW_LINUX, true);
    const sig = published.assets.filter(asset => asset.id === NEW_LINUX.signatureAsset);
    check(sig.length === 1 && sig[0].name === `EduPi_${NEW_LINUX.version}_amd64.AppImage.sig`
      && sig[0].digest === NEW_LINUX.signatureDigest && sig[0].size > 0 && sig[0].size < 8192,
    "target_signature_identity_mismatch");
    const response = await api.asset(NEW_LINUX.signatureAsset, false);
    const signature = Buffer.from(await response.arrayBuffer());
    check(signature.length === sig[0].size && hash(signature) === NEW_LINUX.signatureDigest,
      "target_signature_bytes_mismatch");
    const feed = await fetch(inputs.cohort, { redirect: "error", signal: AbortSignal.timeout(30_000) });
    check(feed.status === 200, "public_cohort_unavailable");
    const feedBytes = Buffer.from(await feed.arrayBuffer());
    check(feedBytes.length < 100_000, "cohort_size_exceeded");
    linuxCohort(JSON.parse(feedBytes.toString("utf8")), signature.toString("utf8"));
    target = { ...NEW_LINUX, cohortSha256: hash(feedBytes), signatureSha256: hash(signature) };
    // No target AppImage is downloaded by this script. Only the installed old
    // application's native updater may replace application.AppImage.
  }
  save(p.config, { ...inputs, ...p, old: OLD_LINUX, target, taskIdentity });
  save(p.evidence, { scope: "linux_appimage_native_upgrade", status: "prepared", mode: inputs.mode,
    old: OLD_LINUX, target, actualUpgradePassed: false, teacherWorkflow: "not_exercised" });
}
export function linuxEnvironment(p, inherited) {
  const home = path.join(p.root, "home"), data = path.join(home, "edupi-route1-canary-acceptance");
  const env = { PATH: "/usr/bin:/bin", LANG: "C.UTF-8", HOME: home,
    TMPDIR: path.join(p.root, "tmp"), DISPLAY: inherited.DISPLAY,
    XAUTHORITY: path.join(p.root, "xdg-runtime/Xauthority"),
    DBUS_SESSION_BUS_ADDRESS: inherited.DBUS_SESSION_BUS_ADDRESS,
    XDG_CONFIG_HOME: path.join(p.root, "xdg-config"), XDG_CACHE_HOME: path.join(p.root, "xdg-cache"),
    XDG_DATA_HOME: path.join(p.root, "xdg-data"), XDG_RUNTIME_DIR: path.join(p.root, "xdg-runtime"),
    EDUPI_PROJECT_ROOT: data, EDUPI_DATA_ROOT: data, EDUPI_DATA_ALLOWED_ROOT: home,
    EDUPI_ROUTE1_ISOLATED_CANARY: "1", PI_CODING_AGENT_DIR: path.join(data, ".edupi/agent"),
    PI_OFFLINE: "1", APPIMAGE_EXTRACT_AND_RUN: "1", TAURI_WEBVIEW_AUTOMATION: "true",
    WEBKIT_DISABLE_DMABUF_RENDERER: "1", NEXT_TELEMETRY_DISABLED: "1" };
  if (p.mode === "upgrade") env.EDUPI_ISOLATED_UPDATE_FEED = p.cohort;
  return env;
}
export function copyXvfbAuthority(source, destination) {
  check(typeof source === "string" && path.isAbsolute(source) && fs.realpathSync(source) === source,
    "canonical_xvfb_authority_required");
  const info = fs.lstatSync(source), parent = fs.lstatSync(path.dirname(source));
  check(info.isFile() && !info.isSymbolicLink() && info.uid === process.getuid()
    && info.size > 0 && (info.mode & 0o077) === 0 && parent.isDirectory() && parent.uid === process.getuid()
    && (parent.mode & 0o077) === 0 && path.basename(source) === "Xauthority"
    && /^xvfb-run\.[A-Za-z0-9]+$/u.test(path.basename(path.dirname(source))),
  "private_xvfb_authority_required");
  fs.copyFileSync(source, destination, fs.constants.COPYFILE_EXCL);
  fs.chmodSync(destination, 0o600);
}
export function linuxFetchWithSignal(signal, fetcher = fetch) {
  return (url, options = {}) => {
    check(!signal.aborted, "acceptance_interrupted");
    return fetcher(url, { ...options, signal: AbortSignal.any([signal, options.signal].filter(Boolean)) });
  };
}
export function markLinuxPassed(proof, signal, upgraded = false) {
  check(!proof.interrupted && !signal.aborted, "acceptance_interrupted");
  proof.actualUpgradePassed = upgraded;
  proof.status = "passed";
}
function processes() {
  const result = [];
  for (const directory of fs.readdirSync("/proc").filter(name => /^\d+$/u.test(name))) {
    try {
      const data = fs.readFileSync(`/proc/${directory}/stat`, "utf8");
      const fields = data.slice(data.lastIndexOf(")") + 2).trim().split(/\s+/u);
      if (fields[0] === "Z") continue;
      result.push({ pid: Number(directory), ppid: Number(fields[1]), pgid: Number(fields[2]),
        birth: fields[19], executable: fs.readlinkSync(`/proc/${directory}/exe`) });
    } catch { /* A process can exit during the read-only snapshot. */ }
  }
  return result;
}
export function ownedLinuxProcesses(known, current, root, driverIdentity) {
  const result = new Map();
  for (const row of current) {
    if (known.get(row.pid)?.birth === row.birth
      || row.pid === driverIdentity?.pid && row.birth === driverIdentity.birth || inside(root, row.executable))
      result.set(row.pid, row);
  }
  for (let changed = true; changed;) {
    changed = false;
    for (const row of current) if (!result.has(row.pid) && result.has(row.ppid)
      && BigInt(row.birth) >= BigInt(result.get(row.ppid).birth)) {
      result.set(row.pid, row); changed = true;
    }
  }
  return result;
}
export function parseLinuxListeners(text, port) {
  const result = [];
  for (const line of text.trim().split("\n").slice(1)) {
    const fields = line.trim().split(/\s+/u);
    if (fields.length < 10 || fields[3] !== "0A") continue;
    const [address, encodedPort] = fields[1].split(":");
    if (Number.parseInt(encodedPort, 16) !== port) continue;
    check(["0100007F", "00000000000000000000000001000000"].includes(address),
      "new_http_listener_not_loopback");
    check(/^\d+$/u.test(fields[9]), "invalid_listener_socket_inode");
    result.push(fields[9]);
  }
  return result;
}
function socketOwners(port, rows) {
  const inodes = new Set(["/proc/net/tcp", "/proc/net/tcp6"].flatMap(file =>
    parseLinuxListeners(fs.readFileSync(file, "utf8"), port)));
  check(inodes.size > 0, "new_http_listener_missing");
  const owners = new Set();
  for (const row of rows) {
    try {
      for (const fd of fs.readdirSync(`/proc/${row.pid}/fd`)) {
        let target;
        try { target = fs.readlinkSync(`/proc/${row.pid}/fd/${fd}`); } catch { continue; }
        const inode = /^socket:\[(\d+)\]$/u.exec(target)?.[1];
        if (inodes.has(inode)) owners.add(row.pid);
      }
    } catch { /* Other system users' descriptors are not task evidence. */ }
  }
  return [...owners];
}
export function assertLinuxRelaunch({ previous, app, rows, listenerPids, resources, commands, status, manifest, root }) {
  check(app.pid !== previous.pid && app.executable !== previous.executable
    && inside(root, app.executable) && !app.executable.endsWith(" (deleted)")
    && rows.some(row => row.pid === app.pid && row.birth === app.birth && row.executable === app.executable),
  "new_app_not_from_new_appimage");
  check(inside(root, resources) && manifest?.appVersion === NEW_LINUX.version
    && manifest.components?.some(item => item.id === "pi-agent-desktop" && item.version === NEW_LINUX.version),
  "new_app_bundle_manifest_mismatch");
  check(listenerPids.length === 1, "expected_one_new_http_owner");
  const http = rows.find(row => row.pid === listenerPids[0]);
  const node = path.join(resources, "node/node");
  check(http && http.ppid === app.pid && http.executable === node && BigInt(http.birth) >= BigInt(app.birth),
    "new_http_not_owned_by_new_app");
  const hosts = rows.filter(row => row.pid !== http.pid && row.executable === node
    && commands[row.pid]?.[1] === path.join(resources, "server/core-runtime-host.mjs"));
  check(hosts.length === 1, "expected_new_bundled_core_host");
  const host = hosts[0], visited = new Set();
  let child = host;
  while (child.pid !== app.pid && !visited.has(child.pid)) {
    visited.add(child.pid);
    const parent = rows.find(row => row.pid === child.ppid);
    check(parent && BigInt(child.birth) >= BigInt(parent.birth), "new_core_not_owned_by_new_app");
    child = parent;
  }
  check(child.pid === app.pid, "new_core_not_owned_by_new_app");
  check(status?.core?.status === "ready" && status.core.validationMode === "bundled"
    && status.projection?.status === "ready" && status.compatibility?.actual?.coreCommit === CORE
    && status.externalSend === false, "new_core_not_bundled_or_ready");
  return { httpOwner: { pid: http.pid, birth: http.birth }, coreHost: { pid: host.pid, birth: host.birth } };
}
async function screenshot(driver, p, label) {
  const bytes = Buffer.from(await driver.command("GET", "/screenshot"), "base64");
  check(bytes.length < 20_000_000 && bytes.subarray(0, 8).equals(Buffer.from("89504e470d0a1a0a", "hex")),
    "invalid_webview_screenshot");
  const file = path.join(path.dirname(p.evidence), `linux-upgrade-${label}.png`);
  fs.writeFileSync(file, bytes, { flag: "wx", mode: 0o600 });
}
async function nativeSnapshot(driver) {
  return driver.executeAsync(`
    const done=arguments[arguments.length-1];
    Promise.all([
      window.__TAURI_INTERNALS__.invoke("computer_use_status"),
      window.__TAURI_INTERNALS__.invoke("get_edupi_root_status"),
      fetch("/api/edupi/status?summary=1",{cache:"no-store"}).then(r=>r.ok?r.json():null)
    ]).then(([computer,roots,status])=>done({host:computer.host,roots,status}),()=>done(null));
  `);
}
export function assertLinuxSnapshot(snapshot, root) {
  check(snapshot?.host?.platform === "linux" && snapshot.host.appVersion === OLD_LINUX.version
    && Number.isInteger(snapshot.host.processId) && snapshot.host.processId > 1, "old_native_identity_mismatch");
  check(snapshot.roots?.dataRoot === root && snapshot.roots.dataSource === "environment"
    && snapshot.roots.coreSource === "bundled", "native_data_or_core_root_mismatch");
  check(snapshot.status?.core?.status === "ready" && snapshot.status.projection?.status === "ready"
    && snapshot.status.core.validationMode === "bundled"
    && snapshot.status.compatibility?.actual?.coreCommit === CORE && snapshot.status.externalSend === false,
  "linux_bundled_core_not_ready");
}
async function visibleClick(driver, css, text) {
  const element = await driver.wait(() => driver.visible(css, text), "linux_ui_target_unavailable");
  await driver.command("POST", `/element/${element[ELEMENT]}/click`, {});
}
function modelSummary(agent) {
  return Object.fromEntries(["settings.json", "models.json", "auth.json"].map(name => [name, hash(fs.readFileSync(path.join(agent, name)))]));
}
function storage(root) {
  return JSON.parse(execFileSync("/usr/bin/python3", ["-I", "-c", STORAGE_PROGRAM,
    path.join(root, ".edupi/runtime/core-runtime-v1.sqlite")], {
    encoding: "utf8", timeout: 10_000, env: { PATH: "/usr/bin:/bin", LANG: "C.UTF-8" },
    stdio: ["ignore", "pipe", "pipe"],
  }));
}
export function linuxStorageReadback(first, second) {
  assert.deepEqual(first.fileIdentity, second.fileIdentity);
  assert.equal(first.schemaSha256, second.schemaSha256);
  for (const [table, records] of Object.entries(first.persistentRecords)) {
    const restored = new Map(second.persistentRecords[table] || []);
    for (const [identity, digest] of records)
      check(restored.get(identity) === digest, "upgraded_sqlite_record_changed");
  }
}
async function run(env) {
  requireLinuxRunner(env);
  const p = json(paths(env).config);
  check(fs.realpathSync(p.root) === p.root && fs.statSync(p.root).ino === p.taskIdentity,
    "task_directory_identity_changed");
  check(await fileHash(p.app) === OLD_LINUX.digest, "old_appimage_changed_before_start");
  const proof = { scope: "linux_appimage_native_upgrade", status: "failed", mode: p.mode,
    actualUpgradePassed: false, teacherWorkflow: "not_exercised", guiAfterRestart: "not_exercised",
    old: OLD_LINUX, target: p.target, stage: "native_webdriver_start", cleanup: "pending" };
  const persist = () => save(p.evidence, proof);
  const controller = new AbortController();
  const taskFetch = linuxFetchWithSignal(controller.signal);
  const isolated = linuxEnvironment(p, env);
  check(isolated.DISPLAY && isolated.DBUS_SESSION_BUS_ADDRESS && env.XAUTHORITY, "private_xvfb_and_dbus_required");
  for (const directory of [isolated.HOME, isolated.EDUPI_DATA_ROOT, isolated.PI_CODING_AGENT_DIR,
    isolated.TMPDIR, isolated.XDG_CONFIG_HOME, isolated.XDG_CACHE_HOME, isolated.XDG_DATA_HOME, isolated.XDG_RUNTIME_DIR])
    fs.mkdirSync(directory, { recursive: true, mode: 0o700 });
  copyXvfbAuthority(env.XAUTHORITY, isolated.XAUTHORITY);
  for (const [name, content] of Object.entries({
    "settings.json": { defaultProvider: "synthetic", defaultModel: "offline" },
    "models.json": { providers: { synthetic: { api: "openai-completions", baseUrl: "http://127.0.0.1:9/v1",
      models: [{ id: "offline", name: "Synthetic offline", input: ["text"], contextWindow: 4096, maxTokens: 256,
        cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 } }] } } },
    "auth.json": {},
  })) fs.writeFileSync(path.join(isolated.PI_CODING_AGENT_DIR, name), JSON.stringify(content), { flag: "wx", mode: 0o600 });
  const models = modelSummary(isolated.PI_CODING_AGENT_DIR);
  const marker = path.join(isolated.EDUPI_DATA_ROOT, ".edupi/output/upgrade-synthetic-marker.json");
  fs.mkdirSync(path.dirname(marker), { recursive: true, mode: 0o700 });
  const markerBytes = Buffer.from(JSON.stringify({ synthetic: true, id: randomBytes(24).toString("hex") }));
  fs.writeFileSync(marker, markerBytes, { flag: "wx", mode: 0o600 });
  const markerIdentity = fs.statSync(marker).ino;
  const log = fs.openSync(path.join(p.root, "private-driver.log"), "wx", 0o600);
  let child, driver, timer, driverIdentity;
  const known = new Map();
  const sample = () => {
    const table = processes();
    for (const [pid, row] of ownedLinuxProcesses(known, table, p.root, driverIdentity)) known.set(pid, row);
    return table;
  };
  async function stop() {
    for (const signal of ["SIGTERM", "SIGKILL"]) {
      const owned = ownedLinuxProcesses(known, sample(), p.root, driverIdentity);
      for (const row of [...owned.values()].reverse()) {
        const current = processes().find(item => item.pid === row.pid);
        if (current?.birth === row.birth) try { process.kill(row.pid, signal); } catch (error) {
          if (error.code !== "ESRCH") throw error;
        }
      }
      for (let attempt = 0; attempt < 40; attempt++) {
        if (!ownedLinuxProcesses(known, sample(), p.root, driverIdentity).size) return;
        await pause(100);
      }
    }
    throw Object.assign(new Error(), { code: "linux_task_process_cleanup_failed" });
  }
  const interrupt = () => { proof.interrupted = true; controller.abort(); };
  process.on("SIGTERM", interrupt); process.on("SIGINT", interrupt);
  try {
    persist();
    child = spawn("/usr/bin/WebKitWebDriver", ["--host=127.0.0.1", "--port=4445"], {
      env: isolated, detached: true, stdio: ["ignore", log, log],
    });
    child.on("error", () => {}); check(Number.isInteger(child.pid), "webkit_driver_spawn_failed");
    driverIdentity = processes().find(row => row.pid === child.pid);
    check(driverIdentity, "webkit_driver_exited_before_sampling");
    timer = setInterval(sample, 250);
    driver = new W3CDriver("http://127.0.0.1:4445", taskFetch);
    await driver.wait(async () => {
      check(!controller.signal.aborted, "acceptance_interrupted");
      try { return await driver.request("GET", "/status"); } catch {
        check(!controller.signal.aborted, "acceptance_interrupted"); return null;
      }
    }, "webkit_driver_unavailable", 30);
    // Primary source: tauri-driver v2.0.4 server.rs maps tauri:options to
    // these native WebKit capabilities; webdriver.rs enables this same flag.
    const session = await driver.request("POST", "/session", { capabilities: { alwaysMatch: {
      "webkitgtk:browserOptions": { binary: p.app, args: [] }, acceptInsecureCerts: false,
    }, firstMatch: [{}] } });
    check(/^[A-Za-z0-9_-]{1,128}$/u.test(session?.sessionId), "webkit_session_not_created");
    driver.session = session.sessionId;
    await driver.command("POST", "/timeouts", { script: 120_000, implicit: 0, pageLoad: 120_000 });
    await driver.command("POST", "/window/rect", { width: 1440, height: 1000 });
    proof.stage = "old_native_source_root_core"; persist();
    const native = await driver.wait(async () => {
      check(!controller.signal.aborted, "acceptance_interrupted");
      try {
        const result = await nativeSnapshot(driver);
        proof.lastReadiness = Object.fromEntries(["core", "projection"].map(key => [key,
          ["ready", "starting", "unavailable", "degraded", "failed", "stopped"].includes(result?.status?.[key]?.status)
            ? result.status[key].status : "unobserved"]));
        return result?.status?.core?.status === "ready" && result.status.projection?.status === "ready" ? result : null;
      } catch { check(!controller.signal.aborted, "acceptance_interrupted"); return null; }
    }, "old_core_readiness_deadline", 180);
    assertLinuxSnapshot(native, isolated.EDUPI_DATA_ROOT);
    const oldPid = native.host.processId;
    const old = sample().find(row => row.pid === oldPid);
    check(old && inside(p.root, old.executable), "old_process_not_from_task_appimage");
    const firstStorage = storage(isolated.EDUPI_DATA_ROOT);
    const resourceLayout = path.relative(path.dirname(old.executable), path.dirname(native.roots.coreRoot));
    const oldIdentity = await driver.executeAsync(`
      const done=arguments[arguments.length-1];fetch("/api/desktop/identity",{cache:"no-store"})
        .then(r=>done({status:r.status,nonce:r.headers.get("x-pi-desktop-instance")}),()=>done(null));`);
    check(oldIdentity?.status === 204 && /^[a-f0-9]{64}$/u.test(oldIdentity.nonce || ""),
      "old_desktop_instance_identity_missing");
    proof.oldProcess = { pid: old.pid, birth: old.birth, version: native.host.appVersion, core: CORE, isolated: true };
    await driver.executeAsync(`
      const done=arguments[arguments.length-1];fetch(arguments[0],{cache:"no-store"})
        .then(r=>r.ok?r.json():null).then(x=>done(x),()=>done(null));`,
    [`/api/files/${marker.slice(1).split("/").map(encodeURIComponent).join("/")}?type=read`]).then(result => {
      check(result?.content === markerBytes.toString(), "old_app_marker_readback_failed");
    });
    const welcome = await driver.visible(".edupi-first-run button", "稍后再说");
    if (welcome) await driver.command("POST", `/element/${welcome[ELEMENT]}/click`, {});
    await visibleClick(driver, 'button[aria-label="设置"], button[aria-label="教师设置"]');
    await visibleClick(driver, 'nav[aria-label="设置分类"] button', "关于与更新");
    await driver.wait(() => driver.execute(`
      const e=document.querySelector('[data-setting-id="updates"]');
      return e?.getClientRects().length && e.innerText.includes("0.3.116");`),
    "old_settings_version_missing", 45);
    await screenshot(driver, p, "old-about");
    proof.oldWebView = { nativeVersion: OLD_LINUX.version, aboutVersionVisible: true, markerReadback: true };
    if (p.mode === "preflight") { markLinuxPassed(proof, controller.signal); proof.stage = "preflight_complete"; }
    else {
    proof.stage = "old_ui_update_discovery"; persist();
    await driver.wait(() => driver.execute(`
      const e=document.querySelector('[data-setting-id="updates"]');
      const b=e?.querySelector(".app-settings-row__control .native-button-primary");
      return e?.innerText.includes("0.3.117") && b && !b.disabled;`),
    "public_target_not_discovered_by_old_ui", 90);
    proof.discovery = { oldVersion: OLD_LINUX.version, visibleTarget: NEW_LINUX.version,
      cohortSha256: p.target.cohortSha256 };
    await screenshot(driver, p, "old-discovery");
    await visibleClick(driver, '[data-setting-id="updates"] .app-settings-row__control .native-button-primary');
    await visibleClick(driver, ".settings-update-preflight button", "继续更新");
    proof.stage = "native_download_install_auto_restart"; persist();
    const deadline = Date.now() + 12 * 60_000;
    let restarted = false;
    while (Date.now() < deadline && !proof.interrupted) {
      sample();
      // The only product launch is the old WebDriver launch above. This loop
      // observes the updater's automatic relaunch without a new WebDriver session.
      const fresh = processes().filter(row => row.pid !== oldPid && inside(p.root, row.executable)
        && path.basename(row.executable.replace(/ \(deleted\)$/u, "")) === "pi-agent-desktop");
      if (fresh.length === 1 && !processes().some(row => row.pid === oldPid && row.birth === old.birth)
        && await fileHash(p.app) === NEW_LINUX.digest) {
        const candidates = fs.readdirSync(isolated.XDG_CONFIG_HOME, { recursive: true })
          .filter(name => name.endsWith("ui-prefs.json"));
        for (const relative of candidates) {
          let port;
          try { port = json(path.join(isolated.XDG_CONFIG_HOME, relative)).serverPort; } catch { continue; }
          if (!Number.isInteger(port) || port < 1 || port > 65535) continue;
          const origin = `http://127.0.0.1:${port}`;
          try {
            const identity = await taskFetch(`${origin}/api/desktop/identity`, { redirect: "error", signal: AbortSignal.timeout(2000) });
            const instance = identity.headers.get("x-pi-desktop-instance");
            check(identity.status === 204 && /^[a-f0-9]{64}$/u.test(instance || "")
              && instance !== oldIdentity.nonce, "new_desktop_identity_unavailable");
            const status = await (await taskFetch(`${origin}/api/edupi/status?summary=1`, { redirect: "error", signal: AbortSignal.timeout(10_000) })).json();
            const updates = await (await taskFetch(`${origin}/api/updates`, { redirect: "error", signal: AbortSignal.timeout(15_000) })).json();
            check(status.core?.status === "ready" && status.projection?.status === "ready"
              && status.compatibility?.actual?.coreCommit === CORE && status.externalSend === false,
            "new_bundled_core_not_ready");
            check(updates.components?.some(item => item.project === "edupi-desktop" && item.currentVersion === NEW_LINUX.version),
              "new_server_version_not_117");
            const workspace = await (await taskFetch(`${origin}/api/edupi/workspace`, { redirect: "error", signal: AbortSignal.timeout(10_000) })).json();
            check(workspace.data?.workspace === isolated.EDUPI_DATA_ROOT, "new_workspace_root_changed");
            const restored = await (await taskFetch(`${origin}/api/files/${marker.slice(1).split("/").map(encodeURIComponent).join("/")}?type=read`,
              { redirect: "error", signal: AbortSignal.timeout(10_000) })).json();
            check(restored.content === markerBytes.toString() && fs.statSync(marker).ino === markerIdentity, "upgrade_marker_changed");
            assert.deepEqual(modelSummary(isolated.PI_CODING_AGENT_DIR), models);
            linuxStorageReadback(firstStorage, storage(isolated.EDUPI_DATA_ROOT));
            const environment = fs.readFileSync(`/proc/${fresh[0].pid}/environ`, "utf8").split("\0");
            for (const key of ["HOME", "EDUPI_DATA_ROOT", "EDUPI_PROJECT_ROOT", "PI_CODING_AGENT_DIR", "EDUPI_ISOLATED_UPDATE_FEED"])
              check(environment.includes(`${key}=${isolated[key]}`), "auto_relaunch_isolation_changed");
            const resources = path.resolve(path.dirname(fresh[0].executable), resourceLayout);
            check(fs.realpathSync(resources) === resources && inside(p.root, resources), "new_resources_not_canonical");
            const rows = sample(), listeners = socketOwners(port, rows), commands = {};
            for (const row of rows.filter(item => item.executable === path.join(resources, "node/node"))) {
              try { commands[row.pid] = fs.readFileSync(`/proc/${row.pid}/cmdline`, "utf8").split("\0"); } catch { /* Exited. */ }
            }
            const owners = assertLinuxRelaunch({ previous: old, app: fresh[0], rows: sample(), listenerPids: listeners,
              resources, commands, status, manifest: json(path.join(resources, "component-versions.json")), root: p.root });
            proof.newProcess = { pid: fresh[0].pid, birth: fresh[0].birth, version: NEW_LINUX.version, core: CORE,
              automaticRelaunchObserved: true, newDesktopInstance: true,
              ...owners, versionEvidence: ["signed_appimage_digest", "new_bundle_manifest", "bundled_server_current_version"] };
            proof.readback = { sameMarkerObject: true, throughNewInstalledHttp: true, sameDataRoot: true,
              modelConfigPreserved: true, sameSqliteFileAndPersistentRecords: true };
            restarted = true; break;
          } catch (error) { proof.lastRestartProbeFailure = code(error); }
        }
      }
      if (restarted) break;
      await pause(500, undefined, { signal: controller.signal });
    }
    check(restarted, proof.interrupted ? "acceptance_interrupted" : "native_upgrade_or_auto_restart_deadline");
    markLinuxPassed(proof, controller.signal, true); proof.stage = "upgrade_complete";
    }
  } catch (error) {
    proof.status = "failed"; proof.failure = controller.signal.aborted ? "acceptance_interrupted" : code(error);
    if (driver?.session) await screenshot(driver, p, "failure").catch(() => {});
  } finally {
    if (timer) clearInterval(timer);
    // Deleting an old WebDriver session after relaunch can close an unrelated
    // new window, so close the session only while the old App is still alive.
    if (!proof.actualUpgradePassed && driver?.session) await driver.close().catch(() => {});
    try { await stop(); proof.cleanup = "passed"; } catch (error) {
      proof.status = "failed"; proof.cleanup = code(error); process.exitCode = 1;
    }
    fs.closeSync(log);
    process.off("SIGTERM", interrupt); process.off("SIGINT", interrupt);
    if (proof.interrupted || controller.signal.aborted) {
      proof.status = "failed"; proof.actualUpgradePassed = false; proof.failure = "acceptance_interrupted";
    }
    persist();
  }
  return proof.status === "passed" ? 0 : 1;
}
export async function linuxMain(operation, env = process.env) {
  try {
    if (operation === "prepare") await prepare(env);
    else if (operation === "run") return await run(env);
    else if (operation === "cleanup") {
      requireLinuxRunner(env); const p = paths(env);
      if (fs.existsSync(p.root)) {
        const conf = json(p.config);
        check(fs.realpathSync(p.root) === p.root && fs.statSync(p.root).ino === conf.taskIdentity,
          "cleanup_task_identity_changed");
        check(!processes().some(row => inside(p.root, row.executable)), "cleanup_task_process_still_running");
        const before = fs.statfsSync(p.root);
        const allocatedKiB = Number(execFileSync("/usr/bin/du", ["-sk", p.root], { encoding: "utf8" }).split(/\s/u)[0]);
        fs.rmSync(p.root, { recursive: true });
        const after = fs.statfsSync(path.dirname(p.root));
        const proof = fs.existsSync(p.evidence) ? json(p.evidence) : {};
        proof.taskFilesCleanup = { removed: true, allocatedBytes: allocatedKiB * 1024,
          availableBytesDelta: after.bavail * after.bsize - before.bavail * before.bsize };
        save(p.evidence, proof);
      }
    } else check(false, "invalid_operation");
    return 0;
  } catch (error) {
    if (env.LINUX_UPGRADE_EVIDENCE) save(env.LINUX_UPGRADE_EVIDENCE, {
      ...(operation === "cleanup" && fs.existsSync(env.LINUX_UPGRADE_EVIDENCE)
        ? json(env.LINUX_UPGRADE_EVIDENCE) : {}),
      scope: "linux_appimage_native_upgrade", status: "failed", stage: operation, code: code(error),
      actualUpgradePassed: false, teacherWorkflow: "not_exercised",
    });
    return 1;
  }
}
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const result = await linuxMain(process.argv[2]);
  if (result) process.exitCode = result;
}
