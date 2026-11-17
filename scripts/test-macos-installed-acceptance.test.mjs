import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { execFileSync } from "node:child_process";
import test from "node:test";
import {
  AcceptanceFailure, HDI_INFO_PROGRAM, NODE_STORAGE_PROGRAM, STORAGE_PROGRAM, acceptanceCleanupReport,
  cleanupTargets, collectOwned, downloadVerified,
  githubReader, launchEnvironment, main, parseProcesses, requireHostedMac, validateInputs,
  trackAcceptanceDirectory, verifyBundleContracts, verifyHttpOwner, verifyMetadata, verifyRestart, verifyStatus, verifyTag, verifyWorkspace,
} from "./test-macos-installed-acceptance.mjs";
import { cleanupRegisteredDirectories, registerCleanupDirectory } from "./macos-acceptance-cleanup.mjs";

const digest = bytes => `sha256:${createHash("sha256").update(bytes).digest("hex")}`;
const sourceSha = "a".repeat(40);
const bytes = Buffer.from("synthetic signed DMG fixture, not an application");
const raw = { releaseId: "123", assetId: "456", sourceSha, assetSha256: digest(bytes).slice(7),
  version: "0.3.117", repository: "example/desktop" };
const input = validateInputs(raw);
const asset = { id: 456, name: input.assetName, state: "uploaded", size: bytes.length,
  digest: input.digest, url: "https://api.github.com/repos/example/desktop/releases/assets/456",
  updated_at: "2026-11-17T00:00:00Z" };
const release = { id: 123, tag_name: "v0.3.117", target_commitish: sourceSha, draft: true,
  prerelease: false, assets: [asset] };
const appPath = "/private/tmp/edupi-installed-fixture/EduPi.app";
const node = `${appPath}/Contents/Resources/resources/Pi Agent Server.app/Contents/MacOS/node`;
const row = (pid, ppid, pgid, command, birth = "Tue Nov 17 09:00:00 2026") =>
  ({ pid, ppid, pgid, command, birth, state: "S" });
const app = row(100, 50, 100, `${appPath}/Contents/MacOS/pi-agent-desktop`);
const http = row(101, 100, 101, "next-server (v16.4.3)");
const core = row(102, 101, 102, `${node} ${appPath}/Contents/Resources/resources/server/core-runtime-host.mjs`);
const fails = (callback, code) => assert.throws(callback, error => error instanceof AcceptanceFailure
  && error.code === code);
function temporary(t) {
  const directory = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), "mac-installed-helper-test-")));
  t.after(() => fs.rmSync(directory, { recursive: true, force: true }));
  return directory;
}

test("strict inputs reject injection, ambiguous identities, unsafe integers and malformed hashes", () => {
  assert.equal(input.assetName, "EduPi_0.3.117_aarch64.dmg");
  for (const [key, value, code] of [
    ["releaseId", "1; touch /tmp/x", "invalid_release_or_asset_id"],
    ["assetId", "9007199254740992", "invalid_release_or_asset_id"],
    ["assetId", "00456", "invalid_release_or_asset_id"],
    ["sourceSha", "$(printenv)", "invalid_source_sha"],
    ["sourceSha", "A".repeat(40), "invalid_source_sha"],
    ["assetSha256", "b".repeat(63), "invalid_asset_sha256"],
    ["version", "v0.3.117", "invalid_version"],
    ["version", "0.3.117\n$TOKEN", "invalid_version"],
    ["repository", "example/../../secrets", "invalid_repository"],
    ["repository", "../..", "invalid_repository"],
  ]) fails(() => validateInputs({ ...raw, [key]: value }), code);
});

test("release and asset ID metadata accept draft/private and public without tag release lookup", () => {
  for (const draft of [true, false]) {
    assert.deepEqual(verifyMetadata(input, { ...release, draft }, asset),
      { id: asset.id, name: asset.name, bytes: bytes.length, digest: input.digest, updatedAt: asset.updated_at });
  }
  for (const patch of [{ id: 124 }, { tag_name: "v0.3.116" }, { target_commitish: "main" },
    { target_commitish: "b".repeat(40) }])
    fails(() => verifyMetadata(input, { ...release, ...patch }, asset), "release_identity_mismatch");
  for (const patch of [{ name: "EduPi_0.3.117_x64.dmg" }, { digest: `sha256:${"b".repeat(64)}` },
    { state: "new" }, { size: 0 }, { id: 457 }, { url: "https://attacker.invalid/asset" }])
    fails(() => verifyMetadata(input, release, { ...asset, ...patch }), "asset_identity_mismatch");
  fails(() => verifyMetadata(input, { ...release, assets: [asset, asset] }, asset), "release_asset_membership_mismatch");
  fails(() => verifyMetadata(input, { ...release, assets: [] }, asset), "release_asset_membership_mismatch");
  fails(() => verifyMetadata(input, release, { ...asset, size: bytes.length + 1 }), "asset_metadata_changed");
  fails(() => verifyMetadata(input, release, { ...asset, updated_at: "2026-11-18T00:00:00Z" }), "asset_metadata_changed");
});

test("authenticated metadata and asset reads are GET only; redirects never receive credentials", async () => {
  const calls = [];
  const reader = githubReader(input, "private-fixture-token-never-printed", async (url, options) => {
    calls.push({ url: String(url), ...options });
    if (String(url).endsWith("/releases/123")) return Response.json(release);
    if (String(url).startsWith("https://api.github.com/")) return new Response(null, { status: 302,
      headers: { location: "https://release-assets.githubusercontent.com/fixture.dmg?signed=private" } });
    return new Response(bytes);
  });
  assert.deepEqual(await reader.json("/releases/123"), release);
  await reader.assetResponse();
  assert.equal(calls.length, 3);
  assert.ok(calls.every(call => call.method === "GET"));
  assert.equal(calls[0].headers.Authorization, "Bearer private-fixture-token-never-printed");
  assert.equal(calls[1].redirect, "manual");
  assert.equal(calls[2].headers.Authorization, undefined);
  assert.equal(calls[2].redirect, "error");
  await assert.rejects(reader.json("/releases/tags/v0.3.117"), { code: "unapproved_github_read" });
});

test("asset redirects fail closed for arbitrary hosts and HTTP without issuing a second fetch", async () => {
  for (const location of ["http://release-assets.githubusercontent.com/x", "https://attacker.invalid/x",
    "https://token@release-assets.githubusercontent.com/x"]) {
    let calls = 0;
    const reader = githubReader(input, "test-secret", async () => {
      calls++;
      return new Response(null, { status: 302, headers: { location } });
    });
    await assert.rejects(reader.assetResponse(), { code: "unsafe_asset_redirect" });
    assert.equal(calls, 1);
  }
});

test("a draft can have no tag ref; published releases and existing annotated tags bind the exact source", async () => {
  const requests = [];
  const missing = { async json(relative, options) {
    requests.push([relative, options]);
    assert.equal(options.allow404, true);
    return null;
  } };
  assert.deepEqual(await verifyTag(missing, input, true), { status: "absent_draft_exact_target", sourceSha });
  assert.deepEqual(requests[0], ["/git/ref/tags/v0.3.117", { allow404: true }]);
  const tagSha = "c".repeat(40);
  const annotated = { async json(relative) {
    return relative.includes("/ref/") ? { ref: "refs/tags/v0.3.117", object: { type: "tag", sha: tagSha } }
      : { sha: tagSha, object: { type: "commit", sha: sourceSha } };
  } };
  assert.equal((await verifyTag(annotated, input, false)).status, "commit_verified");
  await assert.rejects(verifyTag({ async json(_relative, options) {
    assert.equal(options.allow404, false); throw new AcceptanceFailure("github_metadata_read_failed");
  } }, input, false), { code: "github_metadata_read_failed" });
  await assert.rejects(verifyTag({ async json() {
    return { ref: "refs/tags/v0.3.117", object: { type: "commit", sha: "d".repeat(40) } };
  } }, input, true), { code: "tag_source_mismatch" });
  let depth = 0;
  await assert.rejects(verifyTag({ async json(relative) {
    depth++;
    return relative.includes("/ref/") ? { ref: "refs/tags/v0.3.117", object: { type: "tag", sha: tagSha } }
      : { sha: tagSha, object: { type: "tag", sha: tagSha } };
  } }, input, false), { code: "tag_source_mismatch" });
  assert.equal(depth, 9);
});

test("download hashes actual streamed bytes, rejects truncation/tampering/oversize and uses private files", async t => {
  const directory = temporary(t);
  const identity = { bytes: bytes.length, digest: digest(bytes) };
  const good = path.join(directory, "good.dmg");
  assert.deepEqual(await downloadVerified(new Response(bytes), good, identity), identity);
  assert.equal(fs.statSync(good).mode & 0o777, 0o600);
  for (const [label, content, code] of [
    ["short", bytes.subarray(1), "download_bytes_or_digest_mismatch"],
    ["tampered", Buffer.alloc(bytes.length), "download_bytes_or_digest_mismatch"],
    ["long", Buffer.concat([bytes, Buffer.from("extra")]), "download_size_exceeded"],
  ]) {
    await assert.rejects(downloadVerified(new Response(content), path.join(directory, label), identity), { code });
  }
  await assert.rejects(downloadVerified(new Response(bytes, { headers: { "content-length": "1" } }),
    path.join(directory, "bad-length"), identity), { code: "download_content_length_mismatch" });
  await assert.rejects(downloadVerified(new Response(bytes), good, identity), { code: "EEXIST" });
});

function fixtureBundle(t) {
  const resources = temporary(t);
  const coreRoot = path.join(resources, "edupi-core");
  fs.mkdirSync(path.join(coreRoot, "contracts"), { recursive: true });
  fs.mkdirSync(path.join(coreRoot, "scripts"));
  fs.mkdirSync(path.join(coreRoot, "fixtures/bridge/v1.1"), { recursive: true });
  const canonical = value => Array.isArray(value) ? value.map(canonical)
    : value && typeof value === "object" ? Object.fromEntries(Object.keys(value).sort().map(key => [key, canonical(value[key])])) : value;
  const pin = { core_commit: "98e4f7cd0c31dd30954574d2040bb1b948cdd954",
    component_manifest_path: "contracts/edupi-desktop-component-manifest.json",
    runtime_schema_hash: `sha256:${"3".repeat(64)}` };
  const schemaPath = "contracts/edupi-core-runtime-v1-hash.json";
  const schemaBytes = Buffer.from(JSON.stringify({ schema_hash: pin.runtime_schema_hash }));
  fs.writeFileSync(path.join(coreRoot, schemaPath), schemaBytes);
  const schemaEntry = { path: schemaPath, size: schemaBytes.length, sha256: digest(schemaBytes) };
  const files = ["scripts/desktop_bridge_port.mjs", "scripts/core_runtime_daemon.mjs"].map(relative => {
    const content = Buffer.from(`// synthetic helper ${relative}\n`);
    fs.writeFileSync(path.join(coreRoot, relative), content);
    return { path: relative, size: content.length, sha256: digest(content) };
  });
  for (const [entry, field, filename] of [
    [files[0], "component_manifest_hash", pin.component_manifest_path],
    [files[1], "runtime_component_manifest_hash", "contracts/edupi-core-runtime-component-manifest.json"],
  ]) {
    const payload = { component_manifest_version: "1", algorithm: "sha256-canonical-component-payload-v1",
      entrypoint: entry.path, modules: [entry],
      assets: field === "runtime_component_manifest_hash" ? [schemaEntry] : [], runtime_dependencies: [] };
    pin[field] = digest(JSON.stringify(canonical(payload)));
    fs.writeFileSync(path.join(coreRoot, filename), JSON.stringify({ ...payload, component_manifest_hash: pin[field] }));
  }
  const fixtureBytes = Buffer.from('{"synthetic":true}\n');
  const fixtureFiles = [{ path: "synthetic.json", size: fixtureBytes.length, sha256: digest(fixtureBytes) }];
  const bridge = { contract_id: "edupi-bridge-v1.1", contract_version: "1.1", schema_hash: `sha256:${"4".repeat(64)}`,
    fixture_manifest_path: "fixtures/bridge/v1.1/fixture-manifest.json", fixture_manifest_hash: digest(JSON.stringify(fixtureFiles)),
    supported_commands: ["create_task"], supported_projections: ["education_workspace"] };
  fs.writeFileSync(path.join(coreRoot, bridge.fixture_manifest_path),
    JSON.stringify({ algorithm: "sha256-raw-files-canonical-list-v1",
      files: fixtureFiles, fixture_manifest_hash: bridge.fixture_manifest_hash }));
  return { resources, compat: { core_runtime: pin, contract_identities: [bridge] }, coreRoot };
}

test("bundled Core uses the supplied source contract and detects file tampering and a newer harness pin", t => {
  const fixture = fixtureBundle(t);
  assert.equal(verifyBundleContracts(fixture.resources, fixture.compat).verifiedCoreFiles, 3);
  const differentSource = structuredClone(fixture.compat);
  differentSource.core_runtime.component_manifest_hash = `sha256:${"f".repeat(64)}`;
  fails(() => verifyBundleContracts(fixture.resources, differentSource), "bundled_manifest_hash_mismatch");
  fs.appendFileSync(path.join(fixture.coreRoot, "scripts/desktop_bridge_port.mjs"), "// modified");
  fails(() => verifyBundleContracts(fixture.resources, fixture.compat), "bundled_core_file_mismatch");
});

test("bundled Core files cannot escape the package through symlinks", t => {
  const fixture = fixtureBundle(t);
  const target = path.join(fixture.resources, "outside.mjs");
  const original = path.join(fixture.coreRoot, "scripts/desktop_bridge_port.mjs");
  fs.renameSync(original, target);
  fs.symlinkSync(target, original);
  fails(() => verifyBundleContracts(fixture.resources, fixture.compat), "manifest_file_outside_bundle");
});

test("the exact runtime closure includes the pinned fixture index without development examples", t => {
  const fixture = fixtureBundle(t);
  const proof = verifyBundleContracts(fixture.resources, fixture.compat);
  assert.equal(proof.fixtureIndexEntries, 1);
  assert.equal(proof.exactRuntimeInventory, true);
  assert.equal(fs.existsSync(path.join(fixture.coreRoot, "fixtures/bridge/v1.1/synthetic.json")), false);
  fs.writeFileSync(path.join(fixture.coreRoot, "fixtures/bridge/v1.1/synthetic.json"), '{"synthetic":"unlisted"}');
  fails(() => verifyBundleContracts(fixture.resources, fixture.compat), "bundled_contract_inventory_mismatch");
});

test("missing runtime files and a changed fixture index are rejected against the supplied source contract", t => {
  const first = fixtureBundle(t), second = fixtureBundle(t);
  fs.unlinkSync(path.join(first.coreRoot, "scripts/core_runtime_daemon.mjs"));
  fails(() => verifyBundleContracts(first.resources, first.compat), "bundled_contract_file_missing");
  const index = path.join(second.coreRoot, "fixtures/bridge/v1.1/fixture-manifest.json");
  const value = JSON.parse(fs.readFileSync(index));
  value.files[0].sha256 = `sha256:${"a".repeat(64)}`;
  fs.writeFileSync(index, JSON.stringify(value));
  fails(() => verifyBundleContracts(second.resources, second.compat), "fixture_manifest_mismatch");
});

function readyStatus(compat) {
  const pin = compat.core_runtime, bridge = compat.contract_identities[0];
  const identity = { coreCommit: pin.core_commit, componentManifestHash: pin.component_manifest_hash,
    runtimeComponentManifestHash: pin.runtime_component_manifest_hash, schemaHash: bridge.schema_hash,
    fixtureManifestHash: bridge.fixture_manifest_hash, contractVersion: bridge.contract_version,
    supportedCommands: bridge.supported_commands, supportedProjections: bridge.supported_projections };
  return { externalSend: false, core: { status: "ready", lifecycle: "ready", validationMode: "bundled", ...identity },
    projection: { status: "ready" }, compatibility: { expected: identity, actual: identity } };
}

test("HTTP 200 is insufficient: Core/projection readiness, bundled mode and all three runtime identities must match", t => {
  const { compat } = fixtureBundle(t);
  const status = readyStatus(compat);
  assert.equal(verifyStatus(status, compat).core, "ready");
  fails(() => verifyStatus({ ok: true }, compat), "core_or_projection_not_ready");
  for (const field of ["status", "lifecycle", "validationMode"]) {
    const broken = structuredClone(status); broken.core[field] = "external";
    fails(() => verifyStatus(broken, compat), "core_or_projection_not_ready");
  }
  for (const location of ["core", "expected", "actual"]) {
    const broken = structuredClone(status);
    (location === "core" ? broken.core : broken.compatibility[location]).componentManifestHash = `sha256:${"f".repeat(64)}`;
    fails(() => verifyStatus(broken, compat), "running_contract_differs_from_package_source");
  }
});

test("runtime workspace must identify the canary root and bounded data sources", () => {
  const data = { workspace: "/synthetic/home/edupi-route1-canary-test", scope: "teacher_internal", externalSend: false,
    dataSources: { memory: { path: ".edupi/memory", status: "empty" } } };
  assert.equal(verifyWorkspace({ data }, data.workspace).rootMatches, true);
  fails(() => verifyWorkspace({ data }, "/different"), "runtime_workspace_root_mismatch");
  fails(() => verifyWorkspace({ data: { ...data, dataSources: { memory: { path: ".edupi/../outside", status: "ready" } } } },
    data.workspace), "runtime_data_source_mismatch");
});

test("launch environment is minimal, uses native HOME and has no external Core, credentials or inherited overrides", () => {
  const home = "/Users/synthetic-runner", root = `${home}/edupi-route1-canary-${"a".repeat(32)}`;
  const environment = launchEnvironment(home, root, "/private/tmp/task/tmp");
  assert.equal(environment.HOME, home);
  assert.equal(environment.EDUPI_DATA_ROOT, root);
  assert.equal(environment.EDUPI_PROJECT_ROOT, root);
  assert.equal(environment.EDUPI_DATA_ALLOWED_ROOT, home);
  assert.equal(environment.EDUPI_ROUTE1_ISOLATED_CANARY, "1");
  assert.equal(environment.PI_OFFLINE, "1");
  assert.equal(environment.PI_CODING_AGENT_DIR, `${root}/.edupi/agent`);
  for (const name of ["GH_TOKEN", "GITHUB_TOKEN", "EDUPI_CORE_ROOT", "EDUPI_CORE_ALLOWED_ROOT",
    "PI_DESKTOP_API_TOKEN", "EDUPI_SAFE_MODE", "NODE_OPTIONS", "DYLD_INSERT_LIBRARIES"])
    assert.equal(environment[name], undefined);
  fails(() => launchEnvironment(home, `${root}/child`, "/tmp"), "invalid_canary_home");
});

test("macOS process snapshots preserve PID, PPID, PGID and birth while excluding zombies", () => {
  const text = ` 100 50 100 Tue Nov 17 09:00:00 2026 S ${app.command}
 101 100 101 Tue Nov 17 09:00:00 2026 S next-server (v16.4.3)
 999 50 999 Tue Nov 17 09:00:00 2026 Z dead
`;
  assert.deepEqual(parseProcesses(text), [app, http]);
  fails(() => parseProcesses("100 no valid birth"), "unrecognized_ps_identity");
});

test("HTTP owner is the bundled direct App child and may have no argv/environment; Core is a different process", () => {
  assert.deepEqual(verifyHttpOwner({ processes: [app, http, core], listenerPids: [101], app, appPath, executablePaths: [node] }), http);
  fails(() => verifyHttpOwner({ processes: [app, http, core], listenerPids: [102], app, appPath, executablePaths: [node] }),
    "http_owner_not_direct_app_child");
  fails(() => verifyHttpOwner({ processes: [app, http], listenerPids: [101], app, appPath, executablePaths: ["/usr/bin/node"] }),
    "http_owner_not_bundled_node");
  fails(() => verifyHttpOwner({ processes: [{ ...app, birth: "Tue Nov 17 09:01:00 2026" }, http],
    listenerPids: [101], app, appPath, executablePaths: [node] }), "app_pid_or_birth_changed");
  fails(() => verifyHttpOwner({ processes: [app, http], listenerPids: [101, 102], app, appPath, executablePaths: [node] }),
    "expected_one_http_listener_owner");
});

test("task cleanup includes detached helper groups and title-erased orphans but excludes recycled PIDs and unrelated apps", () => {
  const unrelated = row(300, 1, 300, "/Applications/Other.app/Contents/MacOS/main");
  const grandchild = row(103, 102, 102, "synthetic-core-worker");
  let owned = collectOwned(new Map(), [app, http, core, grandchild, unrelated], appPath, app.pid);
  assert.deepEqual([...owned.keys()].sort(), [100, 101, 102, 103]);
  assert.deepEqual(cleanupTargets(owned, [app, http, core, grandchild, unrelated]), { groups: [100, 101, 102], pids: [] });
  const orphan = { ...http, ppid: 1 };
  const reused = { ...core, birth: "Tue Nov 17 09:02:00 2026", ppid: 1, command: "/usr/bin/unrelated" };
  owned = collectOwned(owned, [orphan, reused, unrelated], appPath, null);
  assert.deepEqual([...owned.keys()], [101]);
  assert.deepEqual(cleanupTargets(owned, [orphan, reused, unrelated]), { groups: [101], pids: [] });
  const titleErased = { ...http, ppid: 1 };
  assert.deepEqual([...collectOwned(new Map(), [titleErased, unrelated], appPath, null, [101]).keys()], [101]);
  const mixedGroup = { ...unrelated, pgid: 101 };
  assert.deepEqual(cleanupTargets(new Map([[101, http]]), [http, mixedGroup]), { groups: [], pids: [101] });
});

for (const reader of ["system_python", "node_sqlite"]) {
test(`read-only SQLite ${reader} preserves records and detects replacement or content loss`, t => {
  const directory = temporary(t), database = path.join(directory, "synthetic.sqlite");
  const python = process.platform === "darwin" ? "/usr/bin/python3" : "python3";
  execFileSync(python, ["-c", `import sqlite3,sys
with sqlite3.connect(sys.argv[1]) as db:
 db.execute("CREATE TABLE synthetic_marker(id TEXT PRIMARY KEY, content TEXT NOT NULL)")
 db.execute("INSERT INTO synthetic_marker VALUES ('synthetic-only', 'stable content')")
`, database]);
  const before = fs.readFileSync(database);
  const readStorage = () => JSON.parse(reader === "system_python"
    ? execFileSync(python, ["-c", STORAGE_PROGRAM, database], { encoding: "utf8" })
    : execFileSync(process.execPath, ["--disable-warning=ExperimentalWarning", "--input-type=module", "-e",
      NODE_STORAGE_PROGRAM, database], { encoding: "utf8" }));
  const first = readStorage(), second = readStorage();
  assert.deepEqual(first, second);
  assert.equal(first.quickCheck, "ok");
  assert.equal(first.readOnly, true);
  assert.deepEqual(fs.readFileSync(database), before);
  const launch = { appPid: 100, instanceNonce: "a".repeat(64), storage: first,
    marker: { sha256: digest("same synthetic marker"), fileIdentity: ["1", "2"] },
    version: "0.3.117", core: { validationMode: "bundled" }, modelConfig: { digest: digest("{}") } };
  const restarted = { ...launch, appPid: 200, instanceNonce: "b".repeat(64), storage: second };
  verifyRestart(launch, restarted);
  for (const patch of [{ appPid: 100 }, { instanceNonce: launch.instanceNonce }])
    fails(() => verifyRestart(launch, { ...restarted, ...patch }), "restart_did_not_create_new_app_and_instance");
  execFileSync(python, ["-c", `import sqlite3,sys
with sqlite3.connect(sys.argv[1]) as db:
 db.execute("INSERT INTO synthetic_marker VALUES ('a-new-record-is-allowed', 'new content')")
`, database]);
  verifyRestart(launch, { ...restarted, storage: readStorage() });
  execFileSync(python, ["-c", `import sqlite3,sys
with sqlite3.connect(sys.argv[1]) as db:
 db.execute("UPDATE synthetic_marker SET content='changed' WHERE id='synthetic-only'")
`, database]);
  fails(() => verifyRestart(launch, { ...restarted, storage: readStorage() }), "restart_database_record_changed");
  execFileSync(python, ["-c", `import sqlite3,sys
with sqlite3.connect(sys.argv[1]) as db:
 db.execute("DELETE FROM synthetic_marker")
 db.execute("INSERT INTO synthetic_marker VALUES ('different-content', 'different content')")
`, database]);
  fails(() => verifyRestart(launch, { ...restarted, storage: readStorage() }), "restart_database_record_changed");
  fs.renameSync(database, database + ".original");
  fs.copyFileSync(database + ".original", database);
  fails(() => verifyRestart(launch, { ...restarted, storage: readStorage() }), "restart_database_identity_changed");
  for (const key of ["marker", "version", "core", "modelConfig"])
    fails(() => verifyRestart(launch, { ...restarted, [key]: "changed" }), `restart_${key}_changed`);
});
}

test("Node's read-only SQLite opens a clean WAL database without sidecars and rejects writes", t => {
  const directory = temporary(t), database = path.join(directory, "wal.sqlite");
  execFileSync(process.execPath, ["--disable-warning=ExperimentalWarning", "--input-type=module", "-e", `
    import {DatabaseSync} from "node:sqlite";
    const db=new DatabaseSync(process.argv[1]);
    db.exec("PRAGMA journal_mode=WAL; CREATE TABLE synthetic(id INTEGER PRIMARY KEY, content TEXT); INSERT INTO synthetic VALUES(1,'stable'); PRAGMA wal_checkpoint(TRUNCATE)");
    db.close();
  `, database]);
  assert.equal(fs.existsSync(database + "-wal"), false);
  assert.equal(fs.existsSync(database + "-shm"), false);
  const before = fs.readFileSync(database);
  const read = JSON.parse(execFileSync(process.execPath, ["--disable-warning=ExperimentalWarning",
    "--input-type=module", "-e", NODE_STORAGE_PROGRAM, database], { encoding: "utf8" }));
  assert.equal(read.quickCheck, "ok"); assert.equal(read.readOnly, true); assert.equal(read.queryOnly, true);
  assert.equal(read.driver.engine, "node:sqlite");
  assert.equal(read.persistentRecords.synthetic.length, 1);
  execFileSync(process.execPath, ["--disable-warning=ExperimentalWarning", "--input-type=module", "-e", `
    import assert from "node:assert/strict"; import {DatabaseSync} from "node:sqlite";
    const db=new DatabaseSync(process.argv[1],{readOnly:true,allowExtension:false});
    assert.throws(()=>db.exec("DELETE FROM synthetic"),/readonly|read.only/i);db.close();
  `, database]);
  assert.deepEqual(fs.readFileSync(database), before);
});

test("created but unregistered directories stay visible as cleanup failures while registered siblings are removed", async t => {
  const root = temporary(t), entries = [], failures = [];
  const directories = Object.fromEntries(["canary", "synthetic_default", "task"].map(role => {
    const directory = path.join(root, role);
    fs.mkdirSync(directory, { mode: 0o700 });
    fs.writeFileSync(path.join(directory, "marker"), "synthetic-only");
    return [role, directory];
  }));
  const register = (directory, options) => {
    if (options.role === "synthetic_default")
      throw Object.assign(new Error("private fixture text must not enter evidence"), { code: "cleanup_registration_refused" });
    return registerCleanupDirectory(directory, options);
  };
  for (const role of ["canary", "task"])
    trackAcceptanceDirectory({ directory: directories[role], role, entries, failures }, register);
  assert.throws(() => trackAcceptanceDirectory({
    directory: directories.synthetic_default, role: "synthetic_default", entries, failures,
  }, register), { code: "cleanup_registration_refused" });
  const report = acceptanceCleanupReport(await cleanupRegisteredDirectories(entries, { measureBytes: async () => 4096 }), failures);
  assert.equal(report.status, "failed");
  assert.equal(report.registrationFailures[0].role, "synthetic_default");
  assert.equal(report.registrationFailures[0].status, "failed");
  assert.ok(fs.existsSync(path.join(directories.synthetic_default, "marker")));
  assert.equal(fs.existsSync(directories.canary), false);
  assert.equal(fs.existsSync(directories.task), false);
  assert.equal(JSON.stringify(report).includes(root), false);
  assert.doesNotMatch(JSON.stringify(report), /private fixture text/u);
});

test("hdiutil plist preserves mount ownership when an image includes CFData aliases", () => {
  const python = process.platform === "darwin" ? "/usr/bin/python3" : "python3";
  const decode = xml => JSON.parse(execFileSync(python, ["-I", "-c", HDI_INFO_PROGRAM],
    { input: xml, encoding: "utf8" }));
  const xml = `<?xml version="1.0" encoding="UTF-8"?>
<plist version="1.0"><dict><key>images</key><array><dict>
<key>image-path</key><string>/private/tmp/synthetic.dmg</string>
<key>image-alias</key><data>AAECAwQ=</data>
<key>system-entities</key><array>
<dict><key>dev-entry</key><string>/dev/disk9</string></dict>
<dict><key>mount-point</key><string>/private/tmp/synthetic/mount</string></dict>
</array></dict></array></dict></plist>`;
  assert.deepEqual(decode(xml), { images: [{
    "image-path": "/private/tmp/synthetic.dmg",
    "system-entities": [{ "mount-point": "/private/tmp/synthetic/mount" }],
  }] });
  assert.deepEqual(decode('<plist version="1.0"><dict><key>images</key><array/></dict></plist>'),
    { images: [] });
});

test("local CLI fails before native process or App operations and still leaves deidentified failure evidence", async t => {
  const directory = temporary(t), filename = path.join(directory, "e.JSON");
  const env = { ACCEPT_RELEASE_ID: raw.releaseId, ACCEPT_ASSET_ID: raw.assetId, ACCEPT_SOURCE_SHA: raw.sourceSha,
    ACCEPT_ASSET_SHA256: raw.assetSha256, ACCEPT_VERSION: raw.version, GITHUB_REPOSITORY: raw.repository,
    ACCEPT_SOURCE_DIR: directory, ACCEPT_EVIDENCE: filename, GH_TOKEN: "secret-must-never-appear" };
  assert.equal(await main(["prepare"], env), 0);
  assert.equal(JSON.parse(fs.readFileSync(filename)).status, "failed");
  assert.equal(await main(["run"], env), 1);
  const evidence = fs.readFileSync(filename, "utf8");
  assert.equal(JSON.parse(evidence).failure.code, "fresh_github_hosted_macos_required_no_local_app_operations");
  assert.doesNotMatch(evidence, /secret-must-never-appear/u);
  assert.equal(fs.statSync(filename).mode & 0o777, 0o600);
  assert.equal(await main(["prepare", "--version", "0.3.117", "--version", "0.3.116"], env), 1);
});

test("hosted gate rejects self hosted runners and other OSes", () => {
  const env = { GITHUB_ACTIONS: "true", RUNNER_ENVIRONMENT: "github-hosted", RUNNER_OS: "macOS" };
  requireHostedMac(env, "darwin");
  fails(() => requireHostedMac({ ...env, RUNNER_ENVIRONMENT: "self-hosted" }, "darwin"),
    "fresh_github_hosted_macos_required_no_local_app_operations");
  fails(() => requireHostedMac(env, "linux"), "fresh_github_hosted_macos_required_no_local_app_operations");
});

test("workflow keeps inputs in environment, source checkout exact, permissions scoped and artifacts allowlisted", () => {
  const workflow = fs.readFileSync(new URL("../.github/workflows/macos-installed-acceptance.yml", import.meta.url), "utf8");
  assert.match(workflow, /runs-on: macos-15/u);
  assert.match(workflow, /ref: \$\{\{ inputs\.source_sha \}\}/u);
  assert.match(workflow, /permissions: \{\}/u);
  assert.match(workflow, /contents: write/u);
  assert.match(workflow, /if: always\(\)/u);
  assert.match(workflow, /path: \$\{\{ env\.ACCEPT_EVIDENCE \}\}/u);
  assert.doesNotMatch(workflow, /run:.*\$\{\{ inputs\./u);
  assert.doesNotMatch(workflow, /npm (?:ci|install|run)|next build|gh (?:release|workflow)|security |sudo |pull_request/u);
});
