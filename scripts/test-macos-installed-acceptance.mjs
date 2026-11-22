#!/usr/bin/env node

// Run only on a fresh GitHub hosted macos-15 VM. This branch also checks
// Zhixue's native chat UI with a synthetic receipt on the exact signed App.
import { createHash, randomBytes, randomUUID } from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawn } from "node:child_process";
import { Readable, Transform } from "node:stream";
import { pipeline } from "node:stream/promises";
import { setTimeout as wait } from "node:timers/promises";
import { fileURLToPath, pathToFileURL } from "node:url";
import { isDeepStrictEqual } from "node:util";
import { assertIsolatedProcessEvidence } from "./assert-macos-isolated-edupi.mjs";
import { cleanupRegisteredDirectories, registerCleanupDirectory } from "./macos-acceptance-cleanup.mjs";

const TEAM = "BY3XZG2839";
const BUNDLE = "com.abcwyc.pi-agent";
const SHA = /^[a-f0-9]{40}$/u;
const DIGEST = /^sha256:[a-f0-9]{64}$/u;
const harness = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const hash = bytes => `sha256:${createHash("sha256").update(bytes).digest("hex")}`;
const readJson = filename => JSON.parse(fs.readFileSync(filename, "utf8"));
const ZHIXUE_TITLE = "智学网扫码验收";
// Offline QR encoded from the text "EduPi synthetic QA".
const ZHIXUE_PNG = "iVBORw0KGgoAAAANSUhEUgAAAGAAAABgCAYAAADimHc4AAAAAklEQVR4AewaftIAAAM9SURBVO3BMW7kOAAAwW5C//9ynxMCCiRbM3NeOmCVfWFbZrAtNdiWGmxLDbalBttSg22pg2+o/JaKM5UrFU+o3KmYVKaKM5XfUnFlsC012JY6eKjiUyp3Kv6Sik+p/GSwLTXYlhpsSx28SeWJik+onFVMKlPFpHKm8gmVJypeNdiWGmxLHfwRKlcqzlR+UnGmMlX8JYNtqcG21MEfp3JWMalcUTmrmFSmitUG21KDbanBttTBmyp+S8UTFVcq7lS8quK3DLalBttSBw+prKByVjGpTBWTylnFpDJV3FH5FwbbUoNtqYNvVKyg8kTFpDJVnKk8UfGvDbalBttSg22pg2+oTBVPqJxVTCpPVEwqn6q4ovKpijsqU8WVwbbUYFvq4CGVs4pJ5YmKSeWs4krFmcpPVO5U3Km4ovKEylnFTwbbUoNtqYOHKs5UrlTcUbmjcqXiTsUTKlcq3lExqUwVrxpsSw22pQbbUgdvqnhCZaq4ozJVPKEyVUwqZxWTyp2KSeVVKmcVPxlsSw22pewLD6icVVxROauYVD5VcUXlTsUVlScqzlSmiknlTsWVwbbUYFvq4BsqU8U7VKaKOyqvUpkq7qhcqXhC5aziSsWrBttSg20p+8KHVO5UTCp3KiaVqeJM5RMVk8oTFWcqVypeNdiWGmxLDbal7AsLqHyqYlKZKs5Unqi4onJWMalMFa8abEsNtqUOvqHyqoo7KlPFHZWp4o7K/0nlEyp3Kq4MtqUG21L2hT9A5YmKKyp3KiaVqeIJlbOKSWWqOFOZKq4MtqUG21KDbamDb6j8loo7Fa+q+JTKVPGpip8MtqUG21IHD1V8SuVOxatUpopJ5aziiYonVK6o3Km4MtiWGmxLHbxJ5YmKJ1SmijsqU8Wk8iqVd1RMKlPFmcpPBttSg22pwbbUwR9RMancqZhUpoonKiaVOxVPVEwqrxpsSw22pQ7+uIozlSsqdyomlSdUpoozlScqfjLYlhpsSx28qeK3VEwqdyomlaniTsUTKpPKWcWk8onBttRgW2qwLXXwkMpvUpkqpoo7Kk+oTBWTyjtUnlCZKq4MtqUG21L2hW2ZwbbUYFtqsC012JYabEv9B59Am9CnIGvVAAAAAElFTkSuQmCC";
const inside = (root, candidate) => {
  const relative = path.relative(root, candidate);
  return relative === "" || relative !== ".." && !relative.startsWith(`..${path.sep}`) && !path.isAbsolute(relative);
};
const nonce = () => randomBytes(16).toString("hex");
let operationSignal;
const requestSignal = milliseconds => operationSignal
  ? AbortSignal.any([operationSignal, AbortSignal.timeout(milliseconds)]) : AbortSignal.timeout(milliseconds);

export class AcceptanceFailure extends Error {
  constructor(code) { super(code); this.name = "AcceptanceFailure"; this.code = code; }
}
function check(condition, code) {
  if (!condition) throw new AcceptanceFailure(code);
}
function equal(actual, expected, code) { check(isDeepStrictEqual(actual, expected), code); }

export function seedZhixueFixture(root) {
  check(fs.realpathSync(root) === root && /^edupi-route1-canary-[a-f0-9]{32}$/u.test(path.basename(root))
    && (fs.lstatSync(root).mode & 0o777) === 0o700, "zhixue_fixture_needs_private_canary");
  const title = ZHIXUE_TITLE;
  const flowId = randomUUID();
  const sessionId = randomUUID();
  const timestamp = new Date().toISOString();
  const id = "synthetic-zhixue-qr";
  const text = value => [{ type: "text", text: value }];
  const entries = [{ type: "session", version: 3, id: sessionId, timestamp, cwd: root }];
  const append = entry => entries.push({ ...entry, timestamp,
    id: (entries.length + 10).toString(16).padStart(8, "0"), parentId: entries.at(-1).type === "session" ? null : entries.at(-1).id });
  const message = item => append({ type: "message", message: { ...item, timestamp: Date.parse(timestamp) } });
  const model = { api: "openai-completions", provider: "synthetic", model: "synthetic-offline" };
  append({ type: "session_info", name: title });
  message({ role: "user", content: text("帮我看看智学网，先登录一下。") });
  message({ role: "assistant", ...model, stopReason: "toolUse",
    content: [{ type: "toolCall", id, name: "zhixue_login", arguments: {} }] });
  message({ role: "toolResult", toolCallId: id, toolName: "zhixue_login", isError: false,
    content: text("已提交登录请求。"), details: { zhixue: { version: 1, flowId, status: "starting" } } });
  const sessionDir = path.join(root, ".edupi/agent/sessions", `--${root.slice(1).replaceAll("/", "-")}--`);
  const zhixue = path.join(root, ".edupi/zhixue");
  check(!fs.existsSync(path.dirname(sessionDir)) && !fs.existsSync(zhixue), "zhixue_fixture_already_present");
  for (const directory of [sessionDir, zhixue]) fs.mkdirSync(directory, { recursive: true, mode: 0o700 });
  const session = path.join(sessionDir, `${timestamp.replaceAll(":", "-").replaceAll(".", "-")}_${sessionId}.jsonl`);
  fs.writeFileSync(session, `${entries.map(entry => JSON.stringify(entry)).join("\n")}\n`, { flag: "wx", mode: 0o600 });
  const put = (name, payload) => {
    const file = path.join(zhixue, name);
    const staged = `${file}.fixture`;
    fs.writeFileSync(staged, JSON.stringify({ version: 1, flowId, ...payload }), { flag: "wx", mode: 0o600 });
    fs.renameSync(staged, file);
  };
  const qr = path.join(zhixue, "login-qr.png");
  return {
    title, session,
    start() {
      const startedAt = new Date().toISOString();
      put("login-state.json", { status: "starting", startedAt, updatedAt: startedAt });
    },
    showQr() {
      fs.writeFileSync(qr, Buffer.from(ZHIXUE_PNG, "base64"), { flag: "wx", mode: 0o600 });
      put("login-state.json", { status: "awaiting_scan", qrPath: qr, updatedAt: new Date().toISOString() });
    },
    completeScan() {
      const authenticatedAt = new Date().toISOString();
      put("session.json", { authenticatedAt, cookies: [] });
      put("login_ok.json", { authenticatedAt });
      put("login-state.json", { status: "authenticated", authenticatedAt, updatedAt: authenticatedAt });
      fs.unlinkSync(qr);
    },
  };
}

export function validateInputs(raw) {
  const id = value => typeof value === "string" && /^[1-9]\d{0,15}$/u.test(value)
    && Number.isSafeInteger(Number(value));
  check(id(raw.releaseId) && id(raw.assetId), "invalid_release_or_asset_id");
  check(typeof raw.sourceSha === "string" && SHA.test(raw.sourceSha), "invalid_source_sha");
  check(typeof raw.assetSha256 === "string" && /^[a-f0-9]{64}$/u.test(raw.assetSha256), "invalid_asset_sha256");
  check(typeof raw.version === "string" && /^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)(?:-[0-9A-Za-z-]+(?:\.[0-9A-Za-z-]+)*)?$/u.test(raw.version)
    && raw.version.length <= 80, "invalid_version");
  check(typeof raw.repository === "string" && /^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/u.test(raw.repository)
    && raw.repository.split("/").every(part => part !== "." && part !== ".."), "invalid_repository");
  return { ...raw, releaseId: Number(raw.releaseId), assetId: Number(raw.assetId),
    assetName: `EduPi_${raw.version}_aarch64.dmg`, digest: `sha256:${raw.assetSha256}` };
}

export function verifyMetadata(input, release, asset) {
  check(release?.id === input.releaseId && release.tag_name === `v${input.version}`
    && release.target_commitish === input.sourceSha && typeof release.draft === "boolean"
    && typeof release.prerelease === "boolean", "release_identity_mismatch");
  check(Array.isArray(release.assets), "release_asset_index_missing");
  const indexed = release.assets.filter(row => row.id === input.assetId);
  check(indexed.length === 1 && release.assets.filter(row => row.name === input.assetName).length === 1,
    "release_asset_membership_mismatch");
  for (const row of [indexed[0], asset]) {
    check(row?.id === input.assetId && row.name === input.assetName && row.state === "uploaded"
      && Number.isSafeInteger(row.size) && row.size > 0 && row.digest === input.digest
      && row.url === `https://api.github.com/repos/${input.repository}/releases/assets/${input.assetId}`,
    "asset_identity_mismatch");
  }
  equal([asset.size, asset.digest, asset.updated_at], [indexed[0].size, indexed[0].digest, indexed[0].updated_at],
    "asset_metadata_changed");
  check(typeof asset.updated_at === "string" && Number.isFinite(Date.parse(asset.updated_at)), "asset_timestamp_invalid");
  return { id: asset.id, name: asset.name, bytes: asset.size, digest: asset.digest, updatedAt: asset.updated_at };
}

// API URLs are constructed locally. Never follow an API redirect carrying the
// token; only a separate unauthenticated GET may fetch the signed asset URL.
export function githubReader(input, token, fetcher = fetch) {
  const base = `https://api.github.com/repos/${input.repository}`;
  const headers = { Accept: "application/vnd.github+json", "X-GitHub-Api-Version": "2022-11-28",
    "User-Agent": "edupi-installed-acceptance", ...(token ? { Authorization: `Bearer ${token}` } : {}) };
  return {
    async json(relative, { allow404 = false } = {}) {
      check(/^\/(?:releases\/(?:\d+|assets\/\d+)|git\/(?:ref\/tags\/[^/]+|tags\/[a-f0-9]{40}))$/u.test(relative),
        "unapproved_github_read");
      const response = await fetcher(base + relative, { method: "GET", headers, redirect: "error",
        signal: requestSignal(30_000) });
      if (allow404 && response.status === 404) return null;
      check(response.status === 200, "github_metadata_read_failed");
      return response.json();
    },
    async assetResponse() {
      const signal = requestSignal(600_000);
      let response = await fetcher(`${base}/releases/assets/${input.assetId}`, {
        method: "GET", headers: { ...headers, Accept: "application/octet-stream" }, redirect: "manual", signal,
      });
      if (response.status === 302) {
        const location = new URL(response.headers.get("location"));
        check(location.protocol === "https:" && !location.username && !location.password
          && ["release-assets.githubusercontent.com", "objects.githubusercontent.com"].includes(location.hostname),
        "unsafe_asset_redirect");
        await response.body?.cancel();
        response = await fetcher(location, { method: "GET", redirect: "error", signal,
          headers: { Accept: "application/octet-stream" } });
      }
      check(response.status === 200 && !/json/iu.test(response.headers.get("content-type") || "")
        && response.body, "asset_download_failed");
      return response;
    },
  };
}

export async function verifyTag(reader, input, draft) {
  const ref = await reader.json(`/git/ref/tags/${encodeURIComponent(`v${input.version}`)}`, { allow404: draft });
  if (ref === null) {
    check(draft, "published_tag_reference_missing");
    return { status: "absent_draft_exact_target", sourceSha: input.sourceSha };
  }
  check(ref.ref === `refs/tags/v${input.version}`, "tag_reference_mismatch");
  let object = ref.object;
  for (let depth = 0; object?.type === "tag" && depth < 8; depth++) {
    check(SHA.test(object.sha), "invalid_annotated_tag");
    const tag = await reader.json(`/git/tags/${object.sha}`);
    check(tag.sha === object.sha, "annotated_tag_identity_mismatch");
    object = tag.object;
  }
  check(object?.type === "commit" && object.sha === input.sourceSha, "tag_source_mismatch");
  return { status: "commit_verified", sourceSha: object.sha };
}

export async function downloadVerified(response, destination, asset) {
  const length = response.headers.get("content-length");
  check(length === null || length === String(asset.bytes), "download_content_length_mismatch");
  let bytes = 0;
  const digest = createHash("sha256");
  const meter = new Transform({
    transform(chunk, _encoding, done) {
      bytes += chunk.length;
      if (bytes > asset.bytes) return done(new AcceptanceFailure("download_size_exceeded"));
      digest.update(chunk);
      done(null, chunk);
    },
  });
  await pipeline(Readable.fromWeb(response.body), meter,
    fs.createWriteStream(destination, { flags: "wx", mode: 0o600 }));
  check(bytes === asset.bytes && `sha256:${digest.digest("hex")}` === asset.digest, "download_bytes_or_digest_mismatch");
  return { bytes, digest: asset.digest };
}

function canonical(value) {
  if (Array.isArray(value)) return value.map(canonical);
  if (!value || typeof value !== "object") return value;
  return Object.fromEntries(Object.keys(value).sort().map(key => [key, canonical(value[key])]));
}
function contractPath(relative) {
  check(typeof relative === "string" && relative.length > 0 && !relative.includes("\\")
    && relative.split("/").every(part => part && part !== "." && part !== "..")
    && !path.isAbsolute(relative), "invalid_manifest_path");
  return relative;
}
function safeFile(root, relative) {
  contractPath(relative);
  const filename = path.join(root, relative);
  try {
    check(inside(root, fs.realpathSync(filename)) && fs.lstatSync(filename).isFile(), "manifest_file_outside_bundle");
  } catch (error) {
    if (error.code === "ENOENT") throw new AcceptanceFailure("bundled_contract_file_missing");
    throw error;
  }
  return filename;
}
function bundleFiles(root, relative = "") {
  return fs.readdirSync(path.join(root, relative), { withFileTypes: true }).flatMap(entry => {
    check(!entry.isSymbolicLink(), "bundle_contract_symlink_refused");
    const name = relative ? `${relative}/${entry.name}` : entry.name;
    if (entry.isDirectory()) return bundleFiles(root, name);
    check(entry.isFile(), "bundle_contract_special_file_refused");
    return [name];
  });
}

export function verifyBundleContracts(resources, compat) {
  const pin = compat.core_runtime;
  check(SHA.test(pin?.core_commit || "")
    && pin.component_manifest_path === "contracts/edupi-desktop-component-manifest.json"
    && ["component_manifest_hash", "runtime_component_manifest_hash", "runtime_schema_hash"].every(key => DIGEST.test(pin[key])),
  "unsupported_or_invalid_source_contract");
  const core = fs.realpathSync(path.join(resources, "edupi-core"));
  check(core === path.join(resources, "edupi-core"), "bundled_core_is_not_canonical");
  const checked = new Map();
  for (const [relative, field, entrypoint] of [
    [pin.component_manifest_path, "component_manifest_hash", "scripts/desktop_bridge_port.mjs"],
    ["contracts/edupi-core-runtime-component-manifest.json", "runtime_component_manifest_hash", "scripts/core_runtime_daemon.mjs"],
  ]) {
    const manifest = readJson(safeFile(core, relative));
    const { component_manifest_hash: recorded, ...payload } = manifest;
    check(manifest.component_manifest_version === "1" && manifest.algorithm === "sha256-canonical-component-payload-v1"
      && manifest.entrypoint === entrypoint && recorded === pin[field]
      && hash(JSON.stringify(canonical(payload))) === recorded, "bundled_manifest_hash_mismatch");
    check(Array.isArray(manifest.modules) && Array.isArray(manifest.assets)
      && Array.isArray(manifest.runtime_dependencies), "invalid_component_file_index");
    const entries = [...manifest.modules, ...manifest.assets];
    for (const dependency of manifest.runtime_dependencies) {
      check(Array.isArray(dependency.files), "invalid_runtime_dependency_index");
      entries.push(...dependency.files);
    }
    const seen = new Set();
    for (const entry of entries) {
      check(!seen.has(entry.path) && Number.isSafeInteger(entry.size) && entry.size >= 0 && DIGEST.test(entry.sha256),
        "invalid_component_file_identity");
      seen.add(entry.path);
      const filename = safeFile(core, entry.path);
      if (!checked.has(filename)) {
        const bytes = fs.readFileSync(filename);
        checked.set(filename, { size: bytes.length, sha256: hash(bytes) });
      }
      equal(checked.get(filename), { size: entry.size, sha256: entry.sha256 }, "bundled_core_file_mismatch");
    }
    check(seen.has(entrypoint), "component_entrypoint_missing");
  }
  equal(readJson(safeFile(core, "contracts/edupi-core-runtime-v1-hash.json")).schema_hash,
    pin.runtime_schema_hash, "runtime_schema_mismatch");
  const bridge = compat.contract_identities?.find(item => item.contract_id === "edupi-bridge-v1.1");
  check(bridge && DIGEST.test(bridge.schema_hash) && DIGEST.test(bridge.fixture_manifest_hash), "bridge_contract_missing");
  const fixtures = readJson(safeFile(core, bridge.fixture_manifest_path));
  check(fixtures.algorithm === "sha256-raw-files-canonical-list-v1" && Array.isArray(fixtures.files)
    && fixtures.fixture_manifest_hash === bridge.fixture_manifest_hash
    && hash(JSON.stringify(fixtures.files)) === bridge.fixture_manifest_hash, "fixture_manifest_mismatch");
  // packaged-core-bundle.mjs distributes the manifest and the exact runtime
  // closure union. Its referenced development examples are not runtime assets.
  const fixturePaths = new Set();
  for (const entry of fixtures.files) {
    contractPath(entry.path);
    check(!fixturePaths.has(entry.path) && Number.isSafeInteger(entry.size) && entry.size >= 0
      && DIGEST.test(entry.sha256), "fixture_index_entry_invalid");
    fixturePaths.add(entry.path);
  }
  const expectedFiles = [...new Set([...checked.keys()].map(filename => path.relative(core, filename).split(path.sep).join("/"))
    .concat([pin.component_manifest_path, "contracts/edupi-core-runtime-component-manifest.json", bridge.fixture_manifest_path]))];
  equal(bundleFiles(core).sort(), expectedFiles.sort(), "bundled_contract_inventory_mismatch");
  return { core_commit: pin.core_commit, component_manifest_hash: pin.component_manifest_hash,
    runtime_component_manifest_hash: pin.runtime_component_manifest_hash, runtime_schema_hash: pin.runtime_schema_hash,
    verifiedCoreFiles: checked.size, exactRuntimeInventory: true, fixtureIndexEntries: fixtures.files.length,
    developmentFixtureExamples: "not_in_distribution_contract" };
}

export function verifyStatus(payload, compat) {
  const pin = compat.core_runtime;
  const bridge = compat.contract_identities.find(item => item.contract_id === "edupi-bridge-v1.1");
  check(payload?.core?.status === "ready" && payload.core.lifecycle === "ready"
    && payload.projection?.status === "ready" && payload.core.validationMode === "bundled"
    && payload.externalSend === false, "core_or_projection_not_ready");
  const expected = {
    coreCommit: pin.core_commit, componentManifestHash: pin.component_manifest_hash,
    runtimeComponentManifestHash: pin.runtime_component_manifest_hash, contractVersion: bridge.contract_version,
    schemaHash: bridge.schema_hash, fixtureManifestHash: bridge.fixture_manifest_hash,
    supportedCommands: bridge.supported_commands, supportedProjections: bridge.supported_projections,
  };
  for (const record of [payload.core, payload.compatibility?.expected, payload.compatibility?.actual]) {
    check(record && Object.entries(expected).every(([key, value]) => isDeepStrictEqual(record[key], value)),
      "running_contract_differs_from_package_source");
  }
  return { core: "ready", projection: "ready", validationMode: "bundled", ...expected };
}

export function verifyWorkspace(bundle, root) {
  const data = bundle?.data;
  check(data?.workspace === root && data.externalSend === false
    && data.scope === "teacher_internal" && data.dataSources && Object.keys(data.dataSources).length > 0,
  "runtime_workspace_root_mismatch");
  for (const source of Object.values(data.dataSources)) {
    check(typeof source.path === "string" && source.path.startsWith(".edupi/")
      && !source.path.split("/").includes("..")
      && ["ready", "empty", "unavailable"].includes(source.status), "runtime_data_source_mismatch");
  }
  return { rootMatches: true, dataSources: Object.fromEntries(Object.entries(data.dataSources)
    .map(([key, source]) => [key, { path: source.path, status: source.status }])) };
}

export function launchEnvironment(home, root, temp) {
  check(path.dirname(root) === home && /^edupi-route1-canary-[a-f0-9]{32}$/u.test(path.basename(root)),
    "invalid_canary_home");
  return {
    HOME: home, PATH: "/usr/bin:/bin:/usr/sbin:/sbin", TMPDIR: `${temp}/`, LANG: "en_US.UTF-8",
    EDUPI_DATA_ROOT: root, EDUPI_PROJECT_ROOT: root, EDUPI_DATA_ALLOWED_ROOT: home,
    EDUPI_ROUTE1_ISOLATED_CANARY: "1", PI_OFFLINE: "1",
    PI_CODING_AGENT_DIR: path.join(root, ".edupi/agent"), NEXT_TELEMETRY_DISABLED: "1",
  };
}

export function parseProcesses(text) {
  return text.trim().split("\n").filter(Boolean).map(line => {
    const match = /^\s*(\d+)\s+(\d+)\s+(\d+)\s+([A-Za-z]{3}\s+[A-Za-z]{3}\s+\d+\s+\d{2}:\d{2}:\d{2}\s+\d{4})\s+(\S+)\s+(.+)$/u.exec(line);
    check(match, "unrecognized_ps_identity");
    return { pid: Number(match[1]), ppid: Number(match[2]), pgid: Number(match[3]),
      birth: match[4].replace(/\s+/gu, " "), state: match[5], command: match[6] };
  }).filter(item => !item.state.startsWith("Z"));
}
const sameProcess = (left, right) => left && right && left.pid === right.pid && left.birth === right.birth;

export function verifyHttpOwner({ processes, listenerPids, app, appPath, executablePaths }) {
  check(listenerPids.length === 1, "expected_one_http_listener_owner");
  const current = processes.find(row => row.pid === app.pid);
  check(sameProcess(app, current) && current.command === `${appPath}/Contents/MacOS/pi-agent-desktop`, "app_pid_or_birth_changed");
  const http = processes.find(row => row.pid === listenerPids[0]);
  check(http && http.ppid === app.pid && http.pid !== app.pid, "http_owner_not_direct_app_child");
  check(executablePaths.includes(`${appPath}/Contents/Resources/resources/Pi Agent Server.app/Contents/MacOS/node`),
    "http_owner_not_bundled_node");
  return http;
}

// Ownership survives process.title changes and reparenting through captured
// PID/birth pairs and groups, but a recycled PID or group is never adopted.
export function collectOwned(previous, processes, appPath, appPid, bundledNodePids = []) {
  const result = new Map();
  for (const row of processes) {
    const known = previous.get(row.pid);
    if (sameProcess(known, row) || row.pid === appPid && row.command === `${appPath}/Contents/MacOS/pi-agent-desktop`
      || row.command.startsWith(`${appPath}/Contents/`) || bundledNodePids.includes(row.pid)) result.set(row.pid, row);
  }
  for (let changed = true; changed;) {
    changed = false;
    const groups = new Set([...result.values()].map(row => row.pgid));
    for (const row of processes) {
      if (!result.has(row.pid) && (result.has(row.ppid) || groups.has(row.pgid))) {
        result.set(row.pid, row); changed = true;
      }
    }
  }
  return result;
}

export function cleanupTargets(owned, current) {
  const verified = current.filter(row => sameProcess(owned.get(row.pid), row));
  const groups = [...new Set(verified.map(row => row.pgid))].filter(group => group > 1
    && current.filter(row => row.pgid === group).every(row => verified.some(item => item.pid === row.pid)));
  return { groups, pids: verified.filter(row => !groups.includes(row.pgid)).map(row => row.pid) };
}

// Fixed Python program, argv-only path, read-only URI. No SQL is interpolated.
export const STORAGE_PROGRAM = `
import hashlib, json, os, pathlib, sqlite3, sys
p = pathlib.Path(sys.argv[1])
if p.is_symlink() or not p.is_file() or p.stat().st_size == 0:
    raise RuntimeError("database_missing")
def digest(value):
    return hashlib.sha256(json.dumps(value, sort_keys=True, separators=(",", ":")).encode()).hexdigest()
def value(v):
    return {"blob": v.hex()} if isinstance(v, bytes) else v
def quote(name):
    return '"' + name.replace('"', '""') + '"'
with sqlite3.connect(p.as_uri() + "?mode=ro", uri=True) as db:
    db.execute("PRAGMA query_only=ON")
    if db.execute("PRAGMA quick_check").fetchall() != [("ok",)]:
        raise RuntimeError("sqlite_quick_check_failed")
    schema = db.execute("SELECT name, sql FROM sqlite_master WHERE type='table' ORDER BY name").fetchall()
    if not schema:
        raise RuntimeError("database_schema_missing")
    v = db.execute("PRAGMA user_version").fetchone()[0]
    records = {}
    for table, sql in schema:
        if table.startswith("sqlite_"):
            continue
        info = db.execute("PRAGMA table_info(" + quote(table) + ")").fetchall()
        columns = [r[1] for r in info]
        keys = [r[1] for r in sorted(info, key=lambda r: r[5]) if r[5] > 0]
        # Ownership and event settlement change on a normal restart. The
        # persisted root identity and immutable event contents must survive.
        if table == "authority":
            columns = ["singleton", "schema_version", "root_fingerprint"]
            keys = ["singleton"]
        elif table == "events":
            columns = ["event_id", "event_version", "event_type", "occurrence_time", "source_ref",
                       "actor_ref", "scope_ref", "revision_ref", "payload_json", "canonical_json",
                       "canonical_hash", "external_send"]
            keys = ["event_id"]
        rows = db.execute("SELECT " + ",".join(map(quote, columns)) + " FROM " + quote(table)).fetchall()
        entries = []
        for row in rows:
            content = dict(zip(columns, map(value, row)))
            identity = {key: content[key] for key in keys} if keys else content
            entries.append([digest(identity), digest(content)])
        if len({entry[0] for entry in entries}) != len(entries):
            raise RuntimeError("database_record_identity_not_unique")
        records[table] = sorted(entries)
    if not any(records.values()):
        raise RuntimeError("database_has_no_persisted_records")
s = p.stat()
print(json.dumps({"quickCheck":"ok","readOnly":True,"fileIdentity":[str(s.st_dev),str(s.st_ino)],
 "bytes":s.st_size,"userVersion":v,"schemaSha256":hashlib.sha256(json.dumps(schema).encode()).hexdigest(),
 "persistentRecords":records}))
`;

// Use the application's actual SQLite runtime for installed macOS evidence.
// A system Python reader can fail to open a clean WAL-mode database once its
// sidecars have been removed. No immutable flag or writable fallback is used.
export const NODE_STORAGE_PROGRAM = String.raw`
import fs from "node:fs";
import { createHash } from "node:crypto";
import { DatabaseSync } from "node:sqlite";
const filename = process.argv[1];
const stat = fs.lstatSync(filename, { bigint: true });
if (!stat.isFile() || stat.isSymbolicLink() || stat.size === 0n || fs.realpathSync(filename) !== filename)
  throw new Error("database_missing_or_not_canonical");
const encode = value => {
  if (typeof value === "bigint") return { int64: value.toString() };
  if (value instanceof Uint8Array) return { blob: Buffer.from(value).toString("hex") };
  if (Array.isArray(value)) return value.map(encode);
  if (value && typeof value === "object")
    return Object.fromEntries(Object.keys(value).sort().map(key => [key, encode(value[key])]));
  return value;
};
const digest = value => createHash("sha256").update(JSON.stringify(encode(value))).digest("hex");
const quote = name => '"' + name.replaceAll('"', '""') + '"';
const db = new DatabaseSync(filename, { readOnly: true, allowExtension: false });
let result;
try {
  db.exec("PRAGMA query_only=ON; PRAGMA busy_timeout=5000");
  const integrity = db.prepare("PRAGMA quick_check").all();
  if (db.prepare("PRAGMA query_only").get().query_only !== 1
    || integrity.length !== 1 || integrity[0].quick_check !== "ok")
    throw new Error("sqlite_readonly_or_quick_check_failed");
  const schema = db.prepare("SELECT name, sql FROM sqlite_master WHERE type='table' ORDER BY name").all();
  if (!schema.length) throw new Error("database_schema_missing");
  const records = {};
  for (const { name: table } of schema) {
    if (table.startsWith("sqlite_")) continue;
    const info = db.prepare("PRAGMA table_info(" + quote(table) + ")").all();
    let columns = info.map(row => row.name);
    let keys = info.filter(row => row.pk > 0).sort((a, b) => a.pk - b.pk).map(row => row.name);
    if (table === "authority") {
      columns = ["singleton", "schema_version", "root_fingerprint"]; keys = ["singleton"];
    } else if (table === "events") {
      columns = ["event_id", "event_version", "event_type", "occurrence_time", "source_ref",
        "actor_ref", "scope_ref", "revision_ref", "payload_json", "canonical_json", "canonical_hash", "external_send"];
      keys = ["event_id"];
    }
    const statement = db.prepare("SELECT " + columns.map(quote).join(",") + " FROM " + quote(table));
    statement.setReadBigInts(true);
    records[table] = statement.all().map(row => [
      digest(keys.length ? Object.fromEntries(keys.map(key => [key, row[key]])) : row), digest(row),
    ]).sort((a, b) => a[0].localeCompare(b[0], "en"));
    if (new Set(records[table].map(entry => entry[0])).size !== records[table].length)
      throw new Error("database_record_identity_not_unique");
  }
  if (!Object.values(records).some(rows => rows.length)) throw new Error("database_has_no_persisted_records");
  result = {
    quickCheck: "ok", readOnly: true, queryOnly: true, fileIdentity: [String(stat.dev), String(stat.ino)],
    bytes: Number(stat.size), userVersion: db.prepare("PRAGMA user_version").get().user_version,
    schemaSha256: digest(schema), persistentRecords: records,
    driver: { engine: "node:sqlite", nodeVersion: process.versions.node, sqliteVersion: process.versions.sqlite },
  };
} finally { db.close(); }
console.log(JSON.stringify(result));
`;

export function verifyRestart(first, second, targetVersion = first.version) {
  check(first.appPid !== second.appPid && first.instanceNonce !== second.instanceNonce,
    "restart_did_not_create_new_app_and_instance");
  equal(first.storage.fileIdentity, second.storage.fileIdentity, "restart_database_identity_changed");
  for (const key of ["schemaSha256", "userVersion", "quickCheck", "readOnly"])
    equal(first.storage[key], second.storage[key], "restart_database_schema_changed");
  if (first.version === targetVersion)
    equal(first.storage.driver, second.storage.driver, "restart_database_reader_changed");
  const records = first.storage.persistentRecords;
  check(records && Object.values(records).some(rows => rows.length > 0), "restart_database_baseline_records_missing");
  for (const [table, rows] of Object.entries(records)) {
    const restored = new Map(second.storage.persistentRecords?.[table] || []);
    for (const [identity, digest] of rows)
      check(restored.get(identity) === digest, "restart_database_record_changed");
  }
  equal(second.version, targetVersion, "restart_version_changed");
  for (const key of ["core", "modelConfig", "marker"])
    equal(first[key], second[key], `restart_${key}_changed`);
}

// All command output and environment stays private. Only fixed error codes,
// selected identity fields and hashes may enter e.JSON or the console.
async function command(binary, args, { input, allowed = [0], timeout = 60_000 } = {}) {
  return new Promise((resolve, reject) => {
    const child = spawn(binary, args, { env: { PATH: "/usr/bin:/bin:/usr/sbin:/sbin", LC_ALL: "C",
      HOME: os.homedir() }, stdio: ["pipe", "pipe", "pipe"], signal: operationSignal, killSignal: "SIGKILL" });
    const stdout = [], stderr = [];
    let size = 0, timer;
    const consume = target => chunk => {
      size += chunk.length;
      if (size > 16 * 1024 * 1024) child.kill("SIGKILL");
      else target.push(chunk);
    };
    child.stdout.on("data", consume(stdout));
    child.stderr.on("data", consume(stderr));
    const tool = path.basename(binary).replace(/[^A-Za-z0-9_]/gu, "_");
    child.on("error", () => { clearTimeout(timer); reject(new AcceptanceFailure(
      operationSignal?.aborted ? "acceptance_interrupted" : `${tool}_unavailable`)); });
    child.on("close", code => {
      clearTimeout(timer);
      if (!allowed.includes(code) || size > 16 * 1024 * 1024) return reject(new AcceptanceFailure(`${tool}_failed`));
      resolve({ code, stdout: Buffer.concat(stdout).toString("utf8"), stderr: Buffer.concat(stderr).toString("utf8") });
    });
    timer = setTimeout(() => child.kill("SIGKILL"), timeout);
    child.stdin.on("error", () => {});
    child.stdin.end(input);
  });
}

async function processTable() {
  return parseProcesses((await command("/bin/ps", ["-axo", "pid=,ppid=,pgid=,lstart=,stat=,command="])).stdout);
}
async function executablePaths(pid) {
  const result = await command("/usr/sbin/lsof", ["-nP", "-a", "-p", String(pid), "-d", "txt", "-Fn"], { allowed: [0, 1] });
  return result.stdout.split("\n").filter(line => line.startsWith("n")).map(line => line.slice(1));
}
function pidEvidence(row, role) {
  return { role, pid: row.pid, ppid: row.ppid, pgid: row.pgid, birth: row.birth };
}
async function plist(filename) {
  return JSON.parse((await command("/usr/bin/plutil", ["-convert", "json", "-o", "-", filename])).stdout);
}
// Mounted image records may contain CFData aliases. Decode the actual plist,
// then retain only the fields needed to establish mount ownership.
export const HDI_INFO_PROGRAM = `
import json, plistlib, sys
record = plistlib.loads(sys.stdin.buffer.read())
if not isinstance(record, dict) or not isinstance(record.get("images", []), list):
    raise RuntimeError("invalid_hdi_info")
images = []
for image in record.get("images", []):
    if not isinstance(image, dict) or not isinstance(image.get("system-entities", []), list):
        raise RuntimeError("invalid_hdi_image")
    images.append({
        "image-path": image.get("image-path"),
        "system-entities": [
            {"mount-point": entity["mount-point"]}
            for entity in image.get("system-entities", [])
            if isinstance(entity, dict) and "mount-point" in entity
        ],
    })
print(json.dumps({"images": images}))
`;
async function hdiInfo() {
  const info = await command("/usr/bin/hdiutil", ["info", "-plist"]);
  return JSON.parse((await command("/usr/bin/python3", ["-I", "-c", HDI_INFO_PROGRAM], { input: info.stdout })).stdout);
}
async function signature(target, dmg = false) {
  await command("/usr/bin/codesign", ["--verify", ...(dmg ? [] : ["--deep"]), "--strict", "--verbose=2", target]);
  const details = await command("/usr/bin/codesign", ["--display", "--verbose=4", target]);
  const text = details.stdout + details.stderr;
  check(/^TeamIdentifier=BY3XZG2839$/mu.test(text) && /^Authority=Developer ID Application: .+ \(BY3XZG2839\)$/mu.test(text),
    "developer_id_team_mismatch");
  await command("/usr/bin/xcrun", ["stapler", "validate", target]);
  await command("/usr/sbin/spctl", ["--assess", "--type", dmg ? "open" : "execute",
    ...(dmg ? ["--context", "context:primary-signature"] : []), "--verbose=2", target]);
  return { codesign: "passed", stapler: "passed", spctl: "passed", developerIdTeam: TEAM };
}

async function jsonProbe(origin, pathname, timeout = 20_000) {
  try {
    const response = await fetch(origin + pathname, { method: "GET", redirect: "error",
      headers: { Origin: origin, "Sec-Fetch-Site": "same-origin" }, signal: requestSignal(timeout) });
    if (response.status !== 200) return null;
    return await response.json();
  } catch { return null; }
}

export function requireHostedMac(env, platform = process.platform) {
  check(platform === "darwin" && env.GITHUB_ACTIONS === "true" && env.RUNNER_ENVIRONMENT === "github-hosted"
    && env.RUNNER_OS === "macOS", "fresh_github_hosted_macos_required_no_local_app_operations");
}

function newEvidence() {
  const numeric = value => /^[1-9]\d*$/u.test(value || "") ? value : null;
  return {
    schemaVersion: 1, scope: "macos_signed_dmg_install_app_cold_start", status: "failed",
    stage: "awaiting_source_checkout", startedAt: new Date().toISOString(),
    run: { id: numeric(process.env.GITHUB_RUN_ID), attempt: numeric(process.env.GITHUB_RUN_ATTEMPT),
      workflowSha: SHA.test(process.env.GITHUB_WORKFLOW_SHA || "") ? process.env.GITHUB_WORKFLOW_SHA : null },
    claims: { gui: "not_exercised", normalCmdQ: "not_exercised", teacherWorkflow: "not_exercised",
      updater: "not_exercised", modelGeneration: "not_exercised", storage: "synthetic_only" },
    sourceDesktop: null, asset: null, currentOS: null, package: null, readback: null,
    launches: [], cleanup: { status: "not_started" },
  };
}
function saveEvidence(filename, evidence) {
  check(path.isAbsolute(filename) && !filename.includes("\n"), "absolute_evidence_path_required");
  fs.mkdirSync(path.dirname(filename), { recursive: true, mode: 0o700 });
  // The artifact is an allowlisted object; never include logs, argv or env.
  fs.writeFileSync(filename, `${JSON.stringify(evidence, null, 2)}\n`, { mode: 0o600 });
}

export function trackAcceptanceDirectory({ directory, role, nativeProfile = false, entries, failures },
  register = registerCleanupDirectory) {
  try { entries.push(register(directory, { role, nativeProfile })); }
  catch (error) {
    failures.push(Object.freeze({ role, phase: "registration", status: "failed",
      code: /^cleanup_[a-z_]{1,70}$/u.test(error?.code || "") ? error.code : "cleanup_registration_failed",
      errno: ["ENOENT", "EACCES", "EPERM", "ENOTDIR", "ELOOP", "EIO", "ENOSPC"].includes(error?.code) ? error.code : null }));
    throw error;
  }
}
export function acceptanceCleanupReport(report, registrationFailures) {
  return Object.freeze({ ...report,
    status: registrationFailures.length ? "failed" : report.status,
    registrationFailures: Object.freeze([...registrationFailures]),
  });
}

export async function runAcceptance(input, source, evidence, persist, abort = new AbortController().signal) {
  let task, home, root, teacher, appPath, mount, diskImage;
  const cleanupEntries = [], registrationFailures = [];
  const ownDirectory = (directory, role, nativeProfile = false) =>
    trackAcceptanceDirectory({ directory, role, nativeProfile, entries: cleanupEntries, failures: registrationFailures });
  const processes = { known: new Map(), appPid: null };
  const liveApps = [];
  const upgrade = input.upgradeFrom122 === true;
  const oldInput = upgrade ? validateInputs({
    repository: input.repository, version: "0.3.122",
    releaseId: "453538388", assetId: "775046164",
    sourceSha: "7fa842804aff8c9f2142cae56c6ddffdac9403d6",
    assetSha256: "b1fc0625df9c8c9f30cbac80175e4707d25179759c34e24d882b1f49a8a5279e",
  }) : input;
  const stage = name => { evidence.stage = name; persist(); check(!abort.aborted, "acceptance_interrupted"); };
  async function sample() {
    const table = await processTable();
    const nodes = [];
    if (appPath) {
      // process.title can erase both argv and ps eww for next-server. Its
      // executable mapping still binds it to this installed copy.
      for (const row of table.filter(item => /^next-server(?:\s|$)/u.test(item.command))) {
        if ((await executablePaths(row.pid)).includes(`${appPath}/Contents/Resources/resources/Pi Agent Server.app/Contents/MacOS/node`)) nodes.push(row.pid);
      }
      const owned = collectOwned(processes.known, table, appPath, processes.appPid, nodes);
      for (const [pid, row] of owned) processes.known.set(pid, row);
    }
    return table;
  }
  async function stopAll() {
    const signalled = [];
    for (const signal of ["SIGTERM", "SIGKILL"]) {
      const table = await sample();
      const targets = cleanupTargets(processes.known, table);
      for (const group of targets.groups) {
        try { process.kill(-group, signal); signalled.push({ pgid: group, signal }); }
        catch (error) { if (error.code !== "ESRCH") throw new AcceptanceFailure("task_group_cleanup_failed"); }
      }
      for (const pid of targets.pids) {
        // Re-read birth immediately before any individual PID signal.
        const current = (await processTable()).find(row => row.pid === pid);
        if (!sameProcess(processes.known.get(pid), current)) continue;
        try { process.kill(pid, signal); signalled.push({ pid, signal }); }
        catch (error) { if (error.code !== "ESRCH") throw new AcceptanceFailure("task_pid_cleanup_failed"); }
      }
      const deadline = Date.now() + 8_000;
      do {
        const current = await sample();
        if (!cleanupTargets(processes.known, current).groups.length
          && !cleanupTargets(processes.known, current).pids.length) return { method: "SIGTERM_with_SIGKILL_fallback",
          cmdQ: "not_exercised", remainingTaskPids: 0, signals: signalled };
        await wait(200);
      } while (Date.now() < deadline);
    }
    throw new AcceptanceFailure("task_processes_remain_after_cleanup");
  }
  try {
    stage("runner_preflight");
    requireHostedMac(process.env);
    operationSignal = abort;
    home = fs.realpathSync(os.homedir());
    check(!/\s/u.test(home), "runner_home_must_be_canonical_without_spaces");
    const currentOS = (await command("/usr/bin/sw_vers", ["-productVersion"])).stdout.trim();
    const architecture = (await command("/usr/bin/uname", ["-m"])).stdout.trim();
    check(/^15\./u.test(currentOS) && architecture === "arm64", "macos15_arm64_required");
    evidence.currentOS = { platform: "darwin", version: currentOS, architecture,
      kernel: (await command("/usr/bin/uname", ["-r"])).stdout.trim() };
    const windows = await command("/usr/bin/pgrep", ["-x", "WindowServer"], { allowed: [0, 1] });
    check(windows.code === 0 && /^\d+(?:\n\d+)*\n?$/u.test(windows.stdout.trim()), "windowserver_unavailable");
    await command("/bin/launchctl", ["print", `gui/${process.getuid()}`]);
    evidence.windowServer = { available: true, guiSessionAvailable: true, guiInteraction: false };
    const initial = await processTable();
    check(!initial.some(row => /(?:^|\/)pi-agent-desktop(?:\s|$)|core-runtime-host\.mjs|Pi Agent Server\.app/u.test(row.command)),
      "runner_already_has_edupi_processes");
    stage("exact_source_contract");
    source = fs.realpathSync(source);
    const sourceSha = (await command("/usr/bin/git", ["-C", source, "rev-parse", "HEAD"])).stdout.trim();
    equal(sourceSha, input.sourceSha, "source_checkout_sha_mismatch");
    equal((await command("/usr/bin/git", ["-C", source, "status", "--porcelain", "--untracked-files=no"])).stdout, "",
      "source_checkout_has_modifications");
    const compatFile = path.join(source, "contracts/edupi-core-compat.json");
    const compat = readJson(compatFile);
    equal(readJson(path.join(source, "src-tauri/pi-agent-desktop-package.json")).version, input.version,
      "source_version_mismatch");
    evidence.sourceDesktop = { sha: sourceSha, treeSha: (await command("/usr/bin/git",
      ["-C", source, "rev-parse", "HEAD^{tree}"])).stdout.trim(), contractSha256: hash(fs.readFileSync(compatFile)),
    contractOrigin: "exact_package_source_checkout" };
    evidence.harnessSha = (await command("/usr/bin/git", ["-C", harness, "rev-parse", "HEAD"])).stdout.trim();
    stage("release_and_asset_metadata_by_id");
    const reader = githubReader(input, process.env.GH_TOKEN || process.env.GITHUB_TOKEN);
    const release = await reader.json(`/releases/${input.releaseId}`);
    const assetMetadata = await reader.json(`/releases/assets/${input.assetId}`);
    const asset = verifyMetadata(input, release, assetMetadata);
    evidence.release = { id: input.releaseId, tag: release.tag_name, sourceSha: release.target_commitish,
      draft: release.draft, prerelease: release.prerelease, metadataById: true, operations: ["GET"] };
    evidence.asset = asset;
    evidence.tag = await verifyTag(reader, input, release.draft);
    const oldReader = upgrade ? githubReader(oldInput, process.env.GH_TOKEN || process.env.GITHUB_TOKEN) : reader;
    let oldAsset = asset;
    if (upgrade) {
      check(!release.draft && !release.prerelease, "upgrade_target_not_a_stable_release");
      const oldRelease = await oldReader.json(`/releases/${oldInput.releaseId}`);
      check(!oldRelease.draft && !oldRelease.prerelease, "upgrade_source_not_a_stable_release");
      oldAsset = verifyMetadata(oldInput, oldRelease, await oldReader.json(`/releases/assets/${oldInput.assetId}`));
      const oldTag = await verifyTag(oldReader, oldInput, false);
      evidence.upgrade = { sourceVersion: oldInput.version, targetVersion: input.version, oldAsset, oldTag,
        input: "published_update_service", triggered: false };
    }
    stage("private_synthetic_directories");
    task = fs.realpathSync(fs.mkdtempSync("/private/tmp/edupi-installed-"));
    fs.chmodSync(task, 0o700);
    ownDirectory(task, "task");
    check(/^\/private\/tmp\/edupi-installed-[A-Za-z0-9]+$/u.test(task), "invalid_task_directory");
    appPath = path.join(task, "EduPi.app");
    mount = path.join(task, "mount");
    diskImage = path.join(task, oldAsset.name);
    root = path.join(home, `edupi-route1-canary-${nonce()}`);
    teacher = path.join(home, `edupi-installed-synthetic-default-${nonce()}`);
    for (const directory of [root, teacher]) {
      fs.mkdirSync(directory, { mode: 0o700 });
      ownDirectory(directory, directory === root ? "canary" : "synthetic_default");
    }
    // Refuse to overwrite any prior native profile, even on a hosted runner.
    for (const [relative, role] of [
      [`Application Support/${BUNDLE}`, "native_support"], [`Logs/${BUNDLE}`, "native_logs"],
      [`Caches/${BUNDLE}`, "native_cache"], [`WebKit/${BUNDLE}`, "native_webkit"],
      [`HTTPStorages/${BUNDLE}`, "native_http"], [`Saved Application State/${BUNDLE}.savedState`, "native_saved_state"],
    ]) {
      const directory = path.join(home, "Library", relative);
      check(!fs.existsSync(directory), "native_profile_is_not_fresh");
      fs.mkdirSync(directory, { recursive: true, mode: 0o700 });
      ownDirectory(directory, role, true);
    }
    const config = path.join(home, "Library/Application Support", BUNDLE);
    const prefs = path.join(config, "ui-prefs.json");
    const persistedWorkspace = upgrade ? root : teacher;
    fs.writeFileSync(prefs, JSON.stringify({ edupiDataRoot: persistedWorkspace }), { flag: "wx", mode: 0o600 });
    const piHome = path.join(home, ".pi");
    if (upgrade) {
      // A normal restart reads the runner's normal agent directory.
      check(!fs.existsSync(piHome), "runner_pi_profile_is_not_fresh");
      fs.mkdirSync(piHome, { mode: 0o700 });
      ownDirectory(piHome, "synthetic_pi_home");
    }
    const agent = upgrade ? path.join(piHome, "agent") : path.join(root, ".edupi/agent");
    fs.mkdirSync(agent, { recursive: true, mode: 0o700 });
    fs.mkdirSync(path.join(task, "tmp"), { mode: 0o700 });
    const models = {
      "models.json": { providers: { synthetic: { api: "openai-completions", baseUrl: "http://127.0.0.1:9/v1",
        ...(upgrade ? { apiKey: "synthetic-offline-key" } : {}),
        models: [{ id: "synthetic-offline", name: "Synthetic offline", input: ["text"], contextWindow: 4096, maxTokens: 256,
          cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 } }] } } },
      "settings.json": { defaultProvider: "synthetic", defaultModel: "synthetic-offline" },
      "auth.json": {},
    };
    for (const [name, value] of Object.entries(models))
      fs.writeFileSync(path.join(agent, name), `${JSON.stringify(value)}\n`, { flag: "wx", mode: 0o600 });
    const modelSummary = () => Object.fromEntries(Object.keys(models).map(name => {
      const filename = path.join(agent, name);
      check(fs.lstatSync(filename).isFile() && (fs.statSync(filename).mode & 0o077) === 0,
        "model_configuration_not_private");
      return [name, { sha256: hash(fs.readFileSync(filename)), bytes: fs.statSync(filename).size }];
    }));
    const initialModels = modelSummary();
    const teacherFingerprint = hash(JSON.stringify(fs.readdirSync(teacher)));
    evidence.isolation = { syntheticOnly: true, canaryDirectlyUnderRunnerHome: true, mode: "0700",
      separateSyntheticTeacherDefaultRoot: true, inheritedSecrets: false, externalCoreRoot: false,
      persistedSyntheticWorkspace: upgrade,
      canaryRootSha256: hash(root), syntheticTeacherDefaultRootSha256: hash(teacher),
      installedApp: "$TASK/EduPi.app", nativePrefs: "$RUNNER_HOME/Library/Application Support/com.abcwyc.pi-agent/ui-prefs.json" };
    await command("/bin/df", ["-h", task]);
    await command("/usr/bin/du", ["-sh", task]);
    stage("download_exact_dmg");
    evidence.download = await downloadVerified(await oldReader.assetResponse(), diskImage, oldAsset);
    // Re-read both ID metadata records to catch replacement during download.
    const rereadRelease = await oldReader.json(`/releases/${oldInput.releaseId}`);
    equal(verifyMetadata(oldInput, rereadRelease, await oldReader.json(`/releases/assets/${oldInput.assetId}`)),
      oldAsset, "asset_changed_during_download");
    await verifyTag(oldReader, oldInput, rereadRelease.draft);
    stage("signed_notarized_dmg");
    evidence.dmgSignature = await signature(diskImage, true);
    stage("readonly_dmg_install");
    fs.mkdirSync(mount, { mode: 0o700 });
    await command("/usr/bin/hdiutil", ["attach", "-readonly", "-nobrowse", "-noautoopen", "-mountpoint", mount, diskImage]);
    const image = (await hdiInfo()).images?.find(row => row["image-path"] === diskImage);
    check(image && image["system-entities"]?.some(row => row["mount-point"] === mount), "mounted_dmg_identity_mismatch");
    const mountLine = (await command("/sbin/mount", [])).stdout.split("\n").find(line => line.includes(` on ${mount} (`));
    check(mountLine && /\bread-only\b/u.test(mountLine), "mounted_dmg_is_not_readonly");
    const apps = fs.readdirSync(mount).filter(name => name.endsWith(".app"));
    check(apps.length === 1 && apps[0] === "EduPi.app"
      && fs.lstatSync(path.join(mount, apps[0])).isDirectory(), "expected_unique_edupi_app_in_dmg");
    evidence.install = { source: "downloaded_dmg", mountReadOnly: true, uniqueApp: "EduPi.app",
      destination: "$TASK/EduPi.app", copiedWith: "ditto" };
    evidence.mountedAppSignature = await signature(path.join(mount, "EduPi.app"));
    await command("/usr/bin/ditto", [path.join(mount, "EduPi.app"), appPath]);
    equal(fs.realpathSync(appPath), appPath, "installed_app_is_not_canonical");
    evidence.installedAppSignature = await signature(appPath);
    const info = await plist(path.join(appPath, "Contents/Info.plist"));
    check(info.CFBundleIdentifier === BUNDLE && info.CFBundleExecutable === "pi-agent-desktop"
      && info.CFBundleShortVersionString === oldInput.version && info.CFBundleVersion === oldInput.version, "installed_plist_mismatch");
    const executable = path.join(appPath, "Contents/MacOS/pi-agent-desktop");
    const resources = path.join(appPath, "Contents/Resources/resources");
    const node = path.join(resources, "Pi Agent Server.app/Contents/MacOS/node");
    for (const binary of [executable, node])
      equal((await command("/usr/bin/lipo", ["-archs", binary])).stdout.trim(), "arm64", "installed_binary_not_arm64");
    equal(readJson(path.join(resources, "component-versions.json")).appVersion, oldInput.version, "component_version_mismatch");
    evidence.package = { version: oldInput.version, bundleId: BUNDLE, architecture: "arm64",
      appExecutableSha256: hash(fs.readFileSync(executable)), nativePlistVersion: info.CFBundleShortVersionString };
    stage("bundled_core_exact_source_contract");
    evidence.bundledCore = verifyBundleContracts(resources, compat);
    // No launch can accidentally run the App still on the mounted image.
    await command("/usr/bin/hdiutil", ["detach", mount]);
    check(!(await hdiInfo()).images?.some(row => row["system-entities"]?.some(entity => entity["mount-point"] === mount)),
      "dmg_still_mounted_before_launch");
    stage("prepare_zhixue_synthetic_chat_check");
    const zhixueProbe = path.join(task, "zhixue-ax-check");
    await command("/usr/bin/swiftc", [
      "-module-cache-path", path.join(task, "swift-cache"),
      path.join(harness, "scripts/macos-zhixue-native-probe.swift"), "-o", zhixueProbe,
    ], { timeout: 100_000 });
    const zhixue = upgrade ? { title: ZHIXUE_TITLE } : seedZhixueFixture(root);
    if (!upgrade) {
      zhixue.start();
      evidence.zhixue = { syntheticOnly: true, tested: [] };
    }
    const checkZhixue = async (app, mode) => {
      stage(`zhixue_${mode}_native_chat`);
      check(sameProcess(app, (await sample()).find(row => row.pid === app.pid)), "zhixue_app_identity_changed");
      const result = await command(zhixueProbe, [String(app.pid), appPath, mode, zhixue.title],
        { allowed: [0, 1], timeout: 100_000 });
      if (result.code !== 0) {
        const reason = result.stderr.trim();
        evidence.zhixue.failure = /^[a-z0-9_]{1,85}$/u.test(reason) ? reason : "native_probe_failed";
        throw new AcceptanceFailure(`zhixue_${mode}_not_observed`);
      }
      if (mode === "restart") {
        const [initial, resultAccess, unexpected] = result.stdout.trim().split(" ");
        check(!unexpected && ["visible_before_navigation", "not_in_initial_snapshot"].includes(initial)
          && ["result_button", "direct"].includes(resultAccess),
          "zhixue_restart_navigation_evidence_missing");
        evidence.zhixue.restart = {
          originalChatReopened: true,
          loginReceiptVisibleInInitialSnapshot: initial === "visible_before_navigation",
          resultAccess,
          loginReceiptVisibleAfterReopen: true,
          staleQrAbsent: true,
        };
      }
      evidence.zhixue.tested.push(mode);
      evidence.windowServer.guiInteraction = true;
      persist();
    };
    const checkUpgrade = async (app, mode) => {
      stage(mode);
      check(sameProcess(app, (await sample()).find(row => row.pid === app.pid)), "updater_app_identity_changed");
      const result = await command(zhixueProbe, [String(app.pid), appPath, mode, zhixue.title],
        { allowed: [0, 1], timeout: 140_000 });
      if (result.code !== 0) {
        const reason = result.stderr.trim();
        evidence.upgrade.failure = /^[a-z0-9_]{1,85}$/u.test(reason) ? reason : "native_probe_failed";
        throw new AcceptanceFailure("native_upgrade_control_not_observed");
      }
      evidence.windowServer.guiInteraction = true;
      persist();
    };
    const markerPath = path.join(root, ".edupi/output/installed-acceptance-marker.json");
    const markerValue = { schemaVersion: 1, synthetic: true, id: nonce(), sourceDesktop: input.sourceSha,
      version: input.version, assetSha256: input.assetSha256 };
    let markerBaseline;
    const markerRead = () => {
      check(fs.realpathSync(markerPath) === markerPath && fs.lstatSync(markerPath).isFile(), "marker_path_changed");
      equal(readJson(markerPath), markerValue, "synthetic_marker_readback_mismatch");
      const stat = fs.statSync(markerPath, { bigint: true });
      return { sha256: hash(fs.readFileSync(markerPath)), fileIdentity: [String(stat.dev), String(stat.ino)],
        objectIdSha256: hash(markerValue.id), synthetic: true };
    };
    for (const label of ["first", "restart"]) {
      stage(`${label}_real_app_startup`);
      equal(fs.statSync(root).mode & 0o777, 0o700, "canary_root_is_not_private");
      let app;
      if (upgrade && label === "restart") {
        stage("await_automatic_updater_relaunch");
        const restartDeadline = Date.now() + 8 * 60_000;
        const first = evidence.launches[0];
        while (!abort.aborted && Date.now() < restartDeadline) {
          const table = await sample();
          app = table.find(row => row.command === executable && row.pid !== first.appPid);
          if (app) break;
          await wait(500);
        }
        check(app, "native_updater_automatic_relaunch_missing");
        processes.appPid = app.pid;
      } else {
        const log = fs.openSync(path.join(task, `${label}-app.log`), "wx", 0o600);
        let child;
        try {
          // A fresh hosted user has only the persisted synthetic workspace.
          // The native updater may start the new process through LaunchServices.
          const environment = upgrade
            ? { HOME: home, PATH: "/usr/bin:/bin:/usr/sbin:/sbin", LANG: "en_US.UTF-8",
              PI_OFFLINE: "1", NEXT_TELEMETRY_DISABLED: "1" }
            : launchEnvironment(home, root, path.join(task, "tmp"));
          child = spawn(executable, [], { cwd: task, env: environment,
            detached: true, stdio: ["ignore", log, log] });
          child.on("error", () => {});
          liveApps.push(child);
        } finally { fs.closeSync(log); }
        check(Number.isInteger(child.pid), "installed_app_spawn_failed");
        processes.appPid = child.pid;
        app = (await sample()).find(row => row.pid === child.pid);
        check(app && app.command === executable, "installed_app_exited_during_startup");
      }
      const observedVersion = (await plist(path.join(appPath, "Contents/Info.plist"))).CFBundleShortVersionString;
      equal(observedVersion, label === "first" ? oldInput.version : input.version, "installed_version_changed_before_launch");
      if (upgrade && label === "restart") {
        equal(hash(fs.readFileSync(executable)), "sha256:056c24a32e4dbe8081826f2389f5f41f201001a56bfb939fb7c44e39e19ba708",
          "relaunch_binary_is_not_accepted_123");
        evidence.upgrade.updatedAppSignature = await signature(appPath);
        equal(readJson(path.join(resources, "component-versions.json")).appVersion, input.version, "updated_component_version_mismatch");
        evidence.upgrade.updatedBundledCore = verifyBundleContracts(resources, compat);
      }
      const launch = { label, appPid: app.pid, app: pidEvidence(app, "installed_app"), status: "starting" };
      evidence.launches.push(launch); persist();
      const deadline = Date.now() + 150_000;
      let ready = false;
      while (Date.now() < deadline) {
        check(!abort.aborted, "acceptance_interrupted");
        const table = await sample();
        check(sameProcess(app, table.find(row => row.pid === app.pid)), "installed_app_exited_before_ready");
        // Native fs::write can briefly truncate prefs while choosing the port.
        let nativePrefs;
        try { nativePrefs = readJson(prefs); }
        catch { await wait(250); continue; }
        equal(nativePrefs.edupiDataRoot, persistedWorkspace, "synthetic_default_root_preference_changed");
        const port = nativePrefs.serverPort;
        if (!Number.isInteger(port) || port < 1 || port > 65535) { await wait(500); continue; }
        launch.port = port;
        const origin = `http://127.0.0.1:${port}`;
        const requestNonce = nonce();
        let identity;
        try {
          identity = await fetch(`${origin}/api/desktop/identity?nonce=${requestNonce}`, {
            method: "GET", redirect: "error", headers: { Origin: origin, "Cache-Control": "no-cache" },
            signal: requestSignal(2_000),
          });
        } catch { await wait(500); continue; }
        if (identity.status !== 204) { await identity.body?.cancel(); await wait(500); continue; }
        const instanceNonce = identity.headers.get("x-pi-desktop-instance");
        check(/^[a-f0-9]{64}$/u.test(instanceNonce || "") && /no-store/iu.test(identity.headers.get("cache-control") || ""),
          "desktop_204_identity_nonce_missing");
        launch.identity = { httpStatus: 204, requestNonce, cache: "no-store" };
        launch.instanceNonce = instanceNonce;
        if (label === "restart") check(instanceNonce !== evidence.launches[0].instanceNonce, "stale_desktop_instance_after_restart");
        const listeners = await command("/usr/sbin/lsof", ["-nP", `-iTCP:${port}`, "-sTCP:LISTEN", "-Fpn"]);
        const listenerPids = [...new Set([...listeners.stdout.matchAll(/^p(\d+)$/gmu)].map(match => Number(match[1])))];
        check(listeners.stdout.split("\n").filter(line => line.startsWith("n")).every(line => line === `n127.0.0.1:${port}`),
          "http_listener_not_loopback_only");
        const beforeHttp = await sample();
        const http = verifyHttpOwner({ processes: beforeHttp, listenerPids, app, appPath,
          executablePaths: listenerPids.length === 1 ? await executablePaths(listenerPids[0]) : [] });
        launch.httpOwner = pidEvidence(http, "app_http_child");
        persist();
        const payload = await jsonProbe(origin, "/api/edupi/status?summary=1");
        const readiness = value => ["ready", "unavailable", "starting", "degraded", "failed", "stopped", "draining"]
          .includes(value) ? value : "unobserved";
        launch.lastReadiness = { core: readiness(payload?.core?.status), projection: readiness(payload?.projection?.status) };
        if (payload?.core?.status !== "ready" || payload.projection?.status !== "ready") { await wait(500); continue; }
        const core = verifyStatus(payload, compat);
        const workspace = await jsonProbe(origin, "/api/edupi/workspace");
        if (!workspace) { await wait(500); continue; }
        const runtime = verifyWorkspace(workspace, root);
        const afterHttp = await sample();
        check(sameProcess(http, afterHttp.find(row => row.pid === http.pid)), "http_owner_changed_during_probe");
        check(sameProcess(app, afterHttp.find(row => row.pid === app.pid)), "app_changed_during_probe");
        const coreCommand = `${node} ${resources}/server/core-runtime-host.mjs`;
        const hosts = afterHttp.filter(row => row.command === coreCommand);
        check(hosts.length === 1 && hosts[0].pid !== http.pid, "expected_distinct_bundled_core_host");
        const host = hosts[0];
        let ancestor = host, ancestry = new Set();
        while (ancestor && ancestor.pid !== app.pid && !ancestry.has(ancestor.pid)) {
          ancestry.add(ancestor.pid);
          ancestor = afterHttp.find(row => row.pid === ancestor.ppid);
        }
        check(ancestor?.pid === app.pid, "core_host_not_owned_by_installed_app");
        // Only App/Core environments are inspected. next-server's erased
        // environment is deliberately not used as an acceptance prerequisite.
        if (!upgrade) {
          const environments = [];
          for (const row of [app, host]) {
            environments.push({ ...row, environment: (await command("/bin/ps",
              ["eww", "-p", String(row.pid), "-o", "command="])).stdout });
          }
          try { assertIsolatedProcessEvidence({ root, realRoot: teacher, home, appPath, processes: environments }); }
          catch { throw new AcceptanceFailure("native_isolation_guard_failed"); }
        }
        launch.coreHost = pidEvidence(host, "core_host");
        launch.version = observedVersion; launch.core = core; launch.runtime = runtime;
        launch.nativeGuard = upgrade ? "hosted_persisted_synthetic_workspace" : "passed";
        if (label === "first" && !markerBaseline) {
          fs.mkdirSync(path.dirname(markerPath), { recursive: true, mode: 0o700 });
          fs.writeFileSync(markerPath, `${JSON.stringify(markerValue)}\n`, { flag: "wx", mode: 0o600 });
          markerBaseline = markerRead();
        }
        const fileRoute = `/api/files/${markerPath.slice(1).split("/").map(encodeURIComponent).join("/")}?type=read`;
        const fileResponse = await jsonProbe(origin, fileRoute);
        // File-root discovery has a short cache. The new workspace's output
        // allowlist may need one cache expiry before the read can succeed.
        if (!fileResponse) { await wait(500); continue; }
        check(typeof fileResponse?.content === "string", "app_marker_readback_unavailable");
        equal(JSON.parse(fileResponse.content), markerValue, "app_marker_object_mismatch");
        launch.marker = markerRead();
        equal(launch.marker, markerBaseline, "marker_changed_across_app_launches");
        equal(hash(fileResponse.content), launch.marker.sha256, "marker_http_bytes_differ_from_disk");
        launch.markerReadback = { throughInstalledHttp: true, fromDisk: true, contentSha256: hash(fileResponse.content) };
        launch.modelConfig = modelSummary();
        equal(launch.modelConfig, initialModels, "synthetic_model_configuration_changed");
        if (upgrade) {
          const configuredModels = await jsonProbe(origin, `/api/models?cwd=${encodeURIComponent(root)}`);
          equal(configuredModels?.defaultModel, { provider: "synthetic", modelId: "synthetic-offline" },
            "installed_app_uses_a_different_default_model");
          launch.appDefaultModel = configuredModels.defaultModel;
        }
        check(sameProcess(app, (await sample()).find(row => row.pid === app.pid)),
          "app_exited_before_controlled_shutdown");
        ready = true; break;
      }
      check(ready, "installed_app_core_startup_deadline_no_node_fallback");
      if (upgrade && label === "restart") {
        await checkUpgrade(app, "upgrade-new");
        evidence.claims.gui = "signed_app_update_controls_and_updated_version";
      } else if (!upgrade && label === "first") {
        zhixue.start();
        await checkZhixue(app, "open");
        zhixue.showQr();
        await checkZhixue(app, "qr");
        zhixue.completeScan();
        await checkZhixue(app, "success");
      } else if (!upgrade) {
        await checkZhixue(app, "restart");
        evidence.claims.gui = "signed_app_synthetic_zhixue_scan_and_reopen";
      }
      if (!upgrade || label === "restart") {
        stage(`${label}_stop_all_task_processes`);
        launch.shutdown = await stopAll();
        processes.appPid = null;
      }
      stage(`${label}_readonly_sqlite_and_marker_readback`);
      const database = path.join(root, ".edupi/runtime/core-runtime-v1.sqlite");
      equal(fs.realpathSync(database), database, "sqlite_not_canonical_in_canary");
      launch.storage = JSON.parse((await command(node, [
        "--disable-warning=ExperimentalWarning", "--input-type=module", "-e", NODE_STORAGE_PROGRAM, database,
      ])).stdout);
      check(launch.storage.driver?.engine === "node:sqlite" && launch.storage.readOnly === true
        && launch.storage.queryOnly === true, "bundled_sqlite_readonly_probe_missing");
      equal(markerRead(), markerBaseline, "marker_changed_after_app_exit");
      equal(modelSummary(), initialModels, "model_configuration_changed_after_app_exit");
      equal(hash(JSON.stringify(fs.readdirSync(teacher))), teacherFingerprint, "synthetic_default_root_touched");
      launch.status = "passed";
      if (upgrade && label === "first") {
        await checkUpgrade(app, "upgrade-old");
        evidence.upgrade.triggered = true;
      }
      persist();
    }
    stage(upgrade ? "native_upgrade_readback" : "cold_restart_comparison");
    verifyRestart(evidence.launches[0], evidence.launches[1], input.version);
    evidence.readback = { sameSqliteFile: true, readOnlyQuickCheckTwice: true, persistentSqliteRecordsPreserved: true, sameMarkerObject: true,
      ...(upgrade ? { updatedVersion: input.version } : { sameVersion: true }),
      sameBundledCore: true, sameModelConfig: true, newAppPid: true, newInstanceNonce: true };
    if (upgrade) {
      evidence.claims.updater = "public_release_native_download_signature_install_and_automatic_relaunch";
      evidence.upgrade.automaticRelaunch = true;
    }
    evidence.status = "passed";
  } catch (error) {
    evidence.status = "failed";
    evidence.failure = { stage: evidence.stage, code: abort.aborted ? "acceptance_interrupted"
      : error instanceof AcceptanceFailure || /^cleanup_[a-z_]{1,70}$/u.test(error?.code || "")
        ? error.code : "unexpected_acceptance_failure",
      type: error instanceof AcceptanceFailure ? "AcceptanceFailure" : "Error" };
  } finally {
    // Cleanup must still run after an interrupted command/download.
    operationSignal = undefined;
    const failures = [];
    try {
      evidence.cleanup.processes = await stopAll();
    } catch { failures.push("task_process_cleanup_failed"); }
    evidence.cleanup.observedTaskProcesses = [...processes.known.values()].map(row => pidEvidence(row, "task_process"));
    for (const child of liveApps) child.unref();
    let detached = true;
    if (mount && diskImage) {
      try {
        const images = (await hdiInfo()).images || [];
        const mounted = images.find(row => row["system-entities"]?.some(entity => entity["mount-point"] === mount));
        if (mounted) {
          check(mounted["image-path"] === diskImage, "cleanup_mount_identity_mismatch");
          await command("/usr/bin/hdiutil", ["detach", mount], { allowed: [0, 1] });
          if ((await hdiInfo()).images?.some(row => row["system-entities"]?.some(entity => entity["mount-point"] === mount)))
            await command("/usr/bin/hdiutil", ["detach", "-force", mount]);
        }
        check(!(await hdiInfo()).images?.some(row => row["system-entities"]?.some(entity => entity["mount-point"] === mount)),
          "cleanup_mount_still_attached");
      } catch { detached = false; failures.push("task_dmg_detach_failed"); }
    }
    // Never traverse a mounted volume or remove files still in use.
    if (task && detached && failures.length === 0) {
      let before;
      try { before = fs.statfsSync("/private/tmp"); }
      catch { failures.push("task_disk_measurement_failed"); }
      try {
        const ordered = [...cleanupEntries.filter(entry => entry.role !== "task"),
          ...cleanupEntries.filter(entry => entry.role === "task")];
        const baseReport = await cleanupRegisteredDirectories(ordered, {
          measureBytes: async directory => Number((await command("/usr/bin/du", ["-sk", directory])).stdout.split(/\s/u)[0]) * 1024,
          onProgress: snapshot => {
            evidence.cleanup.directories = acceptanceCleanupReport(snapshot, registrationFailures); persist();
          },
        });
        const report = acceptanceCleanupReport(baseReport, registrationFailures);
        evidence.cleanup.directories = report;
        evidence.cleanup.files = {
          removedRoles: report.results.filter(item => item.status === "removed").map(item => item.role),
          alreadyAbsentRoles: report.results.filter(item => item.status === "already_absent").map(item => item.role),
          removedAllocatedBytes: report.removedAllocatedBytes,
          availableBytesDelta: null,
        };
        if (report.status !== "passed") failures.push("task_directory_cleanup_failed");
        if (before) {
          const after = fs.statfsSync("/private/tmp");
          evidence.cleanup.files.availableBytesDelta = after.bavail * after.bsize - before.bavail * before.bsize;
        }
        await command("/bin/df", ["-h", "/private/tmp"]);
      } catch { failures.push("task_directory_cleanup_failed"); }
    }
    evidence.cleanup.mount = detached ? "detached_or_not_mounted" : "failed";
    evidence.cleanup.status = failures.length ? "failed" : "passed";
    if (failures.length) {
      evidence.status = "failed"; evidence.cleanup.failures = failures;
    }
    if (abort.aborted) {
      evidence.status = "failed";
      evidence.failure = { stage: evidence.stage, code: "acceptance_interrupted", type: "AcceptanceFailure" };
    }
    evidence.finishedAt = new Date().toISOString();
    persist();
  }
  return evidence.status === "passed" ? 0 : 1;
}

function parseCli(argv, env) {
  const raw = { releaseId: env.ACCEPT_RELEASE_ID, assetId: env.ACCEPT_ASSET_ID, sourceSha: env.ACCEPT_SOURCE_SHA,
    assetSha256: env.ACCEPT_ASSET_SHA256, version: env.ACCEPT_VERSION,
    repository: env.GITHUB_REPOSITORY || "PIGU-PPPgu/edupi-desktop",
    source: env.ACCEPT_SOURCE_DIR, evidence: env.ACCEPT_EVIDENCE };
  const keys = { "release-id": "releaseId", "asset-id": "assetId", "source-sha": "sourceSha",
    "asset-sha256": "assetSha256", version: "version", repository: "repository", "source-dir": "source", evidence: "evidence" };
  const seen = new Set();
  for (let i = 0; i < argv.length; i += 2) {
    const key = keys[argv[i]?.slice(2)];
    check(argv[i]?.startsWith("--") && key && argv[i + 1] !== undefined && !seen.has(key), "invalid_cli_argument");
    seen.add(key); raw[key] = argv[i + 1];
  }
  return raw;
}

export async function main(argv = process.argv.slice(2), env = process.env) {
  if (argv[0] === "--help") {
    console.log("Usage: node scripts/test-macos-installed-acceptance.mjs prepare|run --release-id ID --asset-id ID --source-sha SHA40 --asset-sha256 SHA256 --version VERSION --source-dir /absolute/release-source --evidence /absolute/e.JSON [--repository OWNER/REPO]\nrun requires a fresh GitHub hosted macos-15 arm64 VM. It launches the installed App; it does not exercise GUI, Cmd+Q, teacher workflows or upgrades.");
    return 0;
  }
  const evidence = newEvidence();
  let filename = env.ACCEPT_EVIDENCE;
  try {
    const raw = parseCli(argv.slice(1), env);
    filename = raw.evidence;
    check(["prepare", "run"].includes(argv[0]), "invalid_cli_operation");
    check(typeof filename === "string" && path.isAbsolute(filename), "absolute_evidence_path_required");
    const input = validateInputs(raw);
    if (env.ACCEPT_UPGRADE_FROM_122 === "true") {
      check(input.version === "0.3.123" && input.repository === "PIGU-PPPgu/edupi-desktop"
        && input.sourceSha === "adee2798c6b43a3602e7e5627489388d0228b6db"
        && input.releaseId === 454539958 && input.assetId === 779850956
        && input.assetSha256 === "2dcf30d5af18886dbb6fc939343be049017c3e7cbdacbc97054a3bb2b4893de8",
      "native_upgrade_target_must_be_frozen_123");
      input.upgradeFrom122 = true;
      evidence.scope = "macos_signed_app_native_upgrade_122_to_123";
    }
    evidence.request = { releaseId: input.releaseId, assetId: input.assetId, sourceSha: input.sourceSha,
      assetSha256: input.assetSha256, version: input.version, repository: input.repository };
    saveEvidence(filename, evidence);
    if (argv[0] === "prepare") return 0;
    // This check precedes all process inspection, mounting, native profile or
    // App operations, including cleanup. Local invocations cannot launch Apps.
    requireHostedMac(env);
    check(typeof raw.source === "string" && path.isAbsolute(raw.source), "absolute_source_checkout_required");
    const controller = new AbortController();
    const interrupt = () => controller.abort();
    process.on("SIGTERM", interrupt); process.on("SIGINT", interrupt);
    // Leave time for finally/asset upload before the job's 25 minute deadline.
    const budget = setTimeout(interrupt, 20 * 60_000);
    const previousUmask = process.umask(0o077);
    try {
      return await runAcceptance(input, raw.source, evidence, () => saveEvidence(filename, evidence), controller.signal);
    } finally {
      clearTimeout(budget);
      process.umask(previousUmask);
      process.off("SIGTERM", interrupt); process.off("SIGINT", interrupt);
      console.log(JSON.stringify({ status: evidence.status, stage: evidence.stage,
        failure: evidence.failure || null, cleanup: evidence.cleanup.status }));
    }
  } catch (error) {
    evidence.status = "failed";
    evidence.failure = { stage: evidence.stage, code: error instanceof AcceptanceFailure ? error.code : "invalid_acceptance_invocation" };
    if (typeof filename === "string" && path.isAbsolute(filename)) saveEvidence(filename, evidence);
    console.error(JSON.stringify({ status: "failed", code: evidence.failure.code }));
    return 1;
  }
}

if (process.argv[1] && pathToFileURL(path.resolve(process.argv[1])).href === import.meta.url)
  process.exitCode = await main();
