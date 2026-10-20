import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { createHash } from "node:crypto";
import { execFileSync } from "node:child_process";
import { createJiti } from "jiti";

const jiti = createJiti(import.meta.url);
const { resolveEduPiCoreRoot, resolveEduPiDataRoot, validateContainedRegularFile } = await jiti.import("./edupi-core-root.ts");
const configuredRoot = process.env.EDUPI_CORE_ROOT;

function temporaryDirectory(t, prefix) {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), prefix));
  t.after(() => fs.rmSync(directory, { recursive: true, force: true }));
  return directory;
}

function sha256(bytes) {
  return `sha256:${createHash("sha256").update(bytes).digest("hex")}`;
}

function canonicalize(value) {
  if (Array.isArray(value)) return value.map(canonicalize);
  if (!value || typeof value !== "object") return value;
  return Object.fromEntries(Object.keys(value).sort().map((key) => [key, canonicalize(value[key])]));
}

function coreFixture(t, fileCount = 1) {
  const root = fs.realpathSync(temporaryDirectory(t, "edupi-core-cache-"));
  const manifestPath = path.join(root, "contracts/edupi-desktop-component-manifest.json");
  for (const directory of ["contracts", "scripts", "assets"]) fs.mkdirSync(path.join(root, directory));
  const bytes = Buffer.from("export const value = 1;\n");
  const hash = sha256(bytes);
  const files = Array.from({ length: fileCount }, (_, index) => {
    const relative = index === 0 ? "scripts/desktop_bridge_port.mjs" : `assets/file-${index}.txt`;
    fs.writeFileSync(path.join(root, relative), bytes);
    return { path: relative, sha256: hash, size: bytes.byteLength };
  });
  let options;
  function writeManifest(entries = files) {
    const payload = {
      component_manifest_version: "1",
      algorithm: "sha256-canonical-component-payload-v1",
      entrypoint: "scripts/desktop_bridge_port.mjs",
      modules: [entries[0]],
      assets: entries.slice(1),
      runtime_dependencies: [],
    };
    const hash = sha256(JSON.stringify(canonicalize(payload)));
    fs.writeFileSync(manifestPath, JSON.stringify({ ...payload, component_manifest_hash: hash }));
    options = {
      configuredRoot: root,
      allowedRoot: root,
      validationMode: "bundled",
      runtimeIdentity: {
        core_commit: "cache-fixture",
        component_manifest_path: "contracts/edupi-desktop-component-manifest.json",
        component_manifest_hash: hash,
      },
    };
  }
  writeManifest();
  return { root, manifestPath, files, writeManifest, resolve: () => resolveEduPiCoreRoot(options) };
}

function trackFixtureReads(t, root) {
  const reads = [];
  const original = fs.readFileSync;
  t.mock.method(fs, "readFileSync", function (...args) {
    if (typeof args[0] === "string" && args[0].startsWith(`${root}${path.sep}`)) reads.push(args[0]);
    return Reflect.apply(original, this, args);
  });
  return reads;
}

test("resolves and verifies the pinned Core runtime", { skip: !configuredRoot }, () => {
  const realRoot = fs.realpathSync(configuredRoot);
  const manifestPath = path.join(realRoot, "contracts", "edupi-desktop-component-manifest.json");
  const manifest = JSON.parse(fs.readFileSync(manifestPath, "utf8"));
  const coreCommit = execFileSync("git", ["-C", realRoot, "rev-parse", "HEAD"], { encoding: "utf8" }).trim();
  const resolved = resolveEduPiCoreRoot({
    configuredRoot,
    allowedRoot: path.dirname(realRoot),
    runtimeIdentity: {
      core_commit: coreCommit,
      component_manifest_path: "contracts/edupi-desktop-component-manifest.json",
      component_manifest_hash: manifest.component_manifest_hash,
    },
  });
  assert.equal(resolved.root, realRoot);
  assert.equal(resolved.cwd, realRoot);
  assert.equal(resolved.entrypoint, path.join(realRoot, "scripts", "desktop_bridge_port.mjs"));
  assert.equal(resolved.componentManifestHash, manifest.component_manifest_hash);
});

test("fails closed on runtime identity drift", { skip: !configuredRoot }, () => {
  const realRoot = fs.realpathSync(configuredRoot);
  const manifest = JSON.parse(fs.readFileSync(path.join(realRoot, "contracts", "edupi-desktop-component-manifest.json"), "utf8"));
  assert.throws(() => resolveEduPiCoreRoot({ configuredRoot, allowedRoot: path.dirname(realRoot), runtimeIdentity: { core_commit: "wrong", component_manifest_path: "contracts/edupi-desktop-component-manifest.json", component_manifest_hash: manifest.component_manifest_hash } }), /commit/i);
  assert.throws(() => resolveEduPiCoreRoot({ configuredRoot, allowedRoot: path.dirname(realRoot), runtimeIdentity: { core_commit: execFileSync("git", ["-C", realRoot, "rev-parse", "HEAD"], { encoding: "utf8" }).trim(), component_manifest_path: "contracts/edupi-desktop-component-manifest.json", component_manifest_hash: "sha256:wrong" } }), /manifest hash/i);
});

test("retains a Core working set larger than 8192 files across warm validations", (t) => {
  const fixture = coreFixture(t, 13_158);
  const reads = trackFixtureReads(t, fixture.root);
  fixture.resolve();
  assert.equal(reads.length, fixture.files.length + 1, "cold validation reads every component and the manifest");
  t.diagnostic(`cold reads: ${reads.length}`);
  for (let round = 1; round <= 3; round++) {
    reads.length = 0;
    fixture.resolve();
    t.diagnostic(`warm round ${round} reads: ${reads.length}`);
    assert.equal(reads.length, 1, "warm validation rereads only the manifest");
    assert.equal(reads[0], fixture.manifestPath);
  }
});

test("bounds the verified-file LRU at 32768 entries and evicts only the least recently used file", (t) => {
  const capacity = 32_768;
  const fixture = coreFixture(t, capacity + 1);
  const reads = trackFixtureReads(t, fixture.root);
  fixture.writeManifest(fixture.files.slice(0, capacity));
  fixture.resolve();
  assert.equal(reads.length, capacity + 1);

  fixture.writeManifest(fixture.files.slice(0, 2));
  reads.length = 0;
  fixture.resolve();
  assert.equal(reads.length, 1, "accessing the oldest entries promotes them without rereading their bytes");

  fixture.writeManifest([fixture.files[0], fixture.files[capacity]]);
  reads.length = 0;
  fixture.resolve();
  assert.deepEqual(reads, [fixture.manifestPath, path.join(fixture.root, fixture.files[capacity].path)]);

  fixture.writeManifest([fixture.files[0], fixture.files[1], fixture.files[3]]);
  reads.length = 0;
  fixture.resolve();
  assert.deepEqual(reads, [fixture.manifestPath], "a full cache preserves both promoted and untouched retained entries");

  fixture.writeManifest([fixture.files[0], fixture.files[2]]);
  reads.length = 0;
  fixture.resolve();
  assert.deepEqual(reads, [fixture.manifestPath, path.join(fixture.root, fixture.files[2].path)], "the single evicted entry must be hashed again");
});

test("rehashes and rejects same-length cached content after mtime is restored", (t) => {
  const fixture = coreFixture(t);
  const file = path.join(fixture.root, fixture.files[0].path);
  fs.utimesSync(file, 1_700_000_000, 1_700_000_000);
  fixture.resolve();
  const reads = trackFixtureReads(t, fixture.root);
  fixture.resolve();
  assert.deepEqual(reads, [fixture.manifestPath]);
  const before = fs.statSync(file, { bigint: true });

  fs.writeFileSync(file, "export const value = 2;\n");
  fs.utimesSync(file, 1_700_000_000, 1_700_000_000);
  const after = fs.statSync(file, { bigint: true });
  for (const field of ["dev", "ino", "size", "mtimeNs"]) assert.equal(after[field], before[field]);
  assert.notEqual(after.ctimeNs, before.ctimeNs);
  reads.length = 0;
  assert.throws(() => fixture.resolve(), /component hash mismatch/i);
  assert.deepEqual(reads, [fixture.manifestPath, file]);
});

test("rehashes and rejects an atomically replaced cached component", (t) => {
  const fixture = coreFixture(t);
  const file = path.join(fixture.root, fixture.files[0].path);
  fs.utimesSync(file, 1_700_000_000, 1_700_000_000);
  fixture.resolve();
  const before = fs.statSync(file, { bigint: true });
  const replacement = path.join(fixture.root, "replacement.mjs");
  fs.writeFileSync(replacement, "export const value = 2;\n");
  fs.utimesSync(replacement, 1_700_000_000, 1_700_000_000);
  fs.renameSync(replacement, file);
  const after = fs.statSync(file, { bigint: true });
  assert.equal(after.size, before.size);
  assert.equal(after.mtimeNs, before.mtimeNs);
  assert.notEqual(after.ino, before.ino);
  const reads = trackFixtureReads(t, fixture.root);
  assert.throws(() => fixture.resolve(), /component hash mismatch/i);
  assert.deepEqual(reads, [fixture.manifestPath, file]);
});

test("rejects a symlink to an already cached in-root regular file", (t) => {
  const fixture = coreFixture(t, 2);
  fixture.resolve();
  const file = path.join(fixture.root, fixture.files[0].path);
  fs.unlinkSync(file);
  fs.symlinkSync(path.join(fixture.root, fixture.files[1].path), file);
  const reads = trackFixtureReads(t, fixture.root);
  assert.throws(() => fixture.resolve(), /symlink/i);
  assert.deepEqual(reads, [fixture.manifestPath]);
});

test("rejects a directory replacing a cached regular file", (t) => {
  const fixture = coreFixture(t);
  fixture.resolve();
  const file = path.join(fixture.root, fixture.files[0].path);
  fs.unlinkSync(file);
  fs.mkdirSync(file);
  assert.throws(() => fixture.resolve(), /regular file/i);
});

test("rechecks the manifest hash and declared component hash and size after warming", (t) => {
  const fixture = coreFixture(t);
  fixture.resolve();
  const reads = trackFixtureReads(t, fixture.root);
  const manifest = JSON.parse(fs.readFileSync(fixture.manifestPath, "utf8"));
  fs.writeFileSync(fixture.manifestPath, JSON.stringify({ ...manifest, component_manifest_hash: `sha256:${"0".repeat(64)}` }));
  reads.length = 0;
  assert.throws(() => fixture.resolve(), /manifest hash mismatch/i);
  assert.deepEqual(reads, [fixture.manifestPath]);

  for (const [patch, error] of [
    [{ sha256: `sha256:${"0".repeat(64)}` }, /component hash mismatch/i],
    [{ size: fixture.files[0].size + 1 }, /component size mismatch/i],
  ]) {
    fixture.writeManifest([{ ...fixture.files[0], ...patch }]);
    reads.length = 0;
    assert.throws(() => fixture.resolve(), error);
    assert.deepEqual(reads, [fixture.manifestPath, path.join(fixture.root, fixture.files[0].path)]);
  }
});

test("rejects directory entries and symlink escapes", (t) => {
  const temp = temporaryDirectory(t, "edupi-core-root-");
  const allowed = path.join(temp, "allowed");
  const external = path.join(temp, "external.mjs");
  fs.mkdirSync(allowed, { recursive: true });
  fs.writeFileSync(external, "export {};\n", "utf8");
  assert.throws(() => validateContainedRegularFile({ allowedRoot: allowed, candidate: allowed }), /regular file/i);
  const link = path.join(allowed, "desktop_bridge_port.mjs");
  fs.symlinkSync(external, link);
  assert.throws(() => validateContainedRegularFile({ allowedRoot: allowed, candidate: link }), /escape|outside/i);
});

test("resolves an explicit contained data root and derives only in-root paths", (t) => {
  const temp = temporaryDirectory(t, "edupi-data-root-");
  const dataRoot = path.join(temp, "project");
  fs.mkdirSync(dataRoot, { recursive: true });
  const resolved = resolveEduPiDataRoot({ configuredRoot: dataRoot, allowedRoot: temp });
  assert.equal(resolved.root, fs.realpathSync(dataRoot));
  assert.equal(resolved.memoryDir, path.join(resolved.root, ".edupi", "memory"));
  assert.equal(resolved.outputDir, path.join(resolved.root, ".edupi", "output"));
  assert.equal(resolved.lockDir, path.join(resolved.root, ".edupi", "locks"));
  assert.ok(resolved.memoryDir.startsWith(`${resolved.root}${path.sep}`));
});

test("rejects an .edupi symlink that escapes the data root", (t) => {
  const temp = temporaryDirectory(t, "edupi-data-symlink-");
  const dataRoot = path.join(temp, "project");
  const external = path.join(temp, "external");
  fs.mkdirSync(dataRoot, { recursive: true });
  fs.mkdirSync(external, { recursive: true });
  fs.symlinkSync(external, path.join(dataRoot, ".edupi"));

  assert.throws(() => resolveEduPiDataRoot({ configuredRoot: dataRoot, allowedRoot: temp }), /symlink/i);
});

test("rejects memory and output symlinks that escape the data root", (t) => {
  for (const directory of ["memory", "output"]) {
    const temp = temporaryDirectory(t, "edupi-data-child-symlink-");
    const dataRoot = path.join(temp, "project");
    const external = path.join(temp, "external");
    const edupiRoot = path.join(dataRoot, ".edupi");
    fs.mkdirSync(edupiRoot, { recursive: true });
    fs.mkdirSync(external, { recursive: true });
    fs.symlinkSync(external, path.join(edupiRoot, directory));

    assert.throws(() => resolveEduPiDataRoot({ configuredRoot: dataRoot, allowedRoot: temp }), /symlink/i);
  }
});

test("accepts existing normal derived directories and a missing locks directory", (t) => {
  const temp = temporaryDirectory(t, "edupi-data-directories-");
  const dataRoot = path.join(temp, "project");
  fs.mkdirSync(path.join(dataRoot, ".edupi", "memory"), { recursive: true });
  fs.mkdirSync(path.join(dataRoot, ".edupi", "output"), { recursive: true });

  const resolved = resolveEduPiDataRoot({ configuredRoot: dataRoot, allowedRoot: temp });
  assert.equal(resolved.memoryDir, path.join(resolved.root, ".edupi", "memory"));
  assert.equal(resolved.outputDir, path.join(resolved.root, ".edupi", "output"));
  assert.equal(resolved.lockDir, path.join(resolved.root, ".edupi", "locks"));
  assert.equal(fs.existsSync(resolved.lockDir), false);
});

test("requires an absolute data root and rejects allowed-root escapes", (t) => {
  const temp = temporaryDirectory(t, "edupi-data-boundary-");
  const outside = temporaryDirectory(t, "edupi-data-outside-");
  assert.throws(() => resolveEduPiDataRoot({ configuredRoot: "relative-data", allowedRoot: temp }), /absolute/i);
  assert.throws(() => resolveEduPiDataRoot({ configuredRoot: outside, allowedRoot: temp }), /outside/i);
});
