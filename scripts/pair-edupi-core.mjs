#!/usr/bin/env node
import assert from "node:assert/strict";
import crypto from "node:crypto";
import fs from "node:fs/promises";
import { lstatSync, readFileSync, realpathSync } from "node:fs";
import path from "node:path";
import { execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { createJiti } from "jiti";
import { buildPackagedCoreBundle } from "./packaged-core-bundle.mjs";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const compatPath = "contracts/edupi-core-compat.json";
const desktopManifestPath = "contracts/edupi-desktop-component-manifest.json";
const runtimeManifestPath = "contracts/edupi-core-runtime-component-manifest.json";
const canonical = value => Array.isArray(value) ? value.map(canonical)
  : value && typeof value === "object" ? Object.fromEntries(Object.keys(value).sort().map(key => [key, canonical(value[key])])) : value;
const hash = bytes => `sha256:${crypto.createHash("sha256").update(bytes).digest("hex")}`;
const readJson = async file => JSON.parse(await fs.readFile(file, "utf8"));

export function assertImmutableCoreCheckout(coreRoot, coreCommit) {
  if (typeof coreCommit !== "string" || !/^[a-f0-9]{40}$/.test(coreCommit)) throw new Error("--core-commit requires a full immutable lowercase 40-character commit, not a floating ref");
  if (!path.isAbsolute(coreRoot ?? "")) throw new Error("--core-root must be an absolute checkout path");
  coreRoot = realpathSync(coreRoot);
  const git = args => execFileSync("git", ["-C", coreRoot, ...args], { encoding: "utf8" }).trim();
  if (realpathSync(git(["rev-parse", "--show-toplevel"])) !== realpathSync(coreRoot)) throw new Error("Core root must be the checkout root");
  if (git(["rev-parse", "HEAD"]) !== coreCommit) throw new Error("Core checkout HEAD does not match --core-commit");
  // Status trusts index hints and clean filters. Neither proves which bytes
  // Node will import, so reject hidden entries and hash the raw checkout.
  const entries = git(["ls-files", "-v", "-z"]).split("\0").filter(Boolean);
  if (entries.some(entry => !entry.startsWith("H "))) throw new Error("Core index must not use assume-unchanged or skip-worktree flags");
  if (git(["status", "--porcelain=v1", "--untracked-files=all"])) throw new Error("Core checkout must be clean, including untracked files");
  const algorithm = git(["rev-parse", "--show-object-format"]);
  const directories = new Set();
  const tree = execFileSync("git", ["-C", coreRoot, "ls-tree", "-rz", "--full-tree", coreCommit], { encoding: "utf8" });
  for (const entry of tree.split("\0").filter(Boolean)) {
    const [, mode, type, oid, relative] = /^(\d+) (\w+) ([a-f0-9]+)\t([\s\S]+)$/.exec(entry) ?? [];
    if (type !== "blob" || !["100644", "100755"].includes(mode)) throw new Error(`Core tree requires regular tracked files, not symlinks/submodules: ${relative}`);
    const file = path.join(coreRoot, relative);
    for (let parent = path.dirname(file); parent !== coreRoot && !directories.has(parent); parent = path.dirname(parent)) {
      if (!lstatSync(parent).isDirectory()) throw new Error(`Core tracked parent must be a real directory: ${relative}`);
      directories.add(parent);
    }
    if (!lstatSync(file).isFile()) throw new Error(`Core tracked file must be regular, not a symlink: ${relative}`);
    const bytes = readFileSync(file);
    const actual = crypto.createHash(algorithm).update(`blob ${bytes.length}\0`).update(bytes).digest("hex");
    if (actual !== oid) throw new Error(`Core tracked bytes differ from pinned Git blob (checkout filters are not accepted): ${relative}`);
  }
}

export function assertComponentManifestIdentity(manifest, entrypoint) {
  const { component_manifest_hash: recorded, ...payload } = manifest;
  assert.equal(manifest.component_manifest_version, "1", "component manifest version");
  assert.equal(manifest.algorithm, "sha256-canonical-component-payload-v1", "component manifest algorithm");
  assert.equal(manifest.entrypoint, entrypoint, "component entrypoint");
  assert.equal(recorded, hash(JSON.stringify(canonical(payload))), "component manifest self-hash");
  if (!Array.isArray(manifest.modules) || !Array.isArray(manifest.assets) || !Array.isArray(manifest.runtime_dependencies)
    || !manifest.modules.some(entry => entry.path === entrypoint)) throw new Error("Component manifest closure lists are invalid");
}

async function verifySchema(coreRoot, desktopRoot, stem) {
  const schemaPath = `contracts/${stem}.schema.json`;
  const hashPath = `contracts/${stem}-hash.json`;
  const schema = await readJson(path.join(coreRoot, schemaPath));
  const identity = await readJson(path.join(coreRoot, hashPath));
  assert.equal(identity.algorithm, "sha256-canonical-json-v1", `${stem} hash algorithm`);
  assert.equal(identity.contract_version, { "edupi-bridge-v1.1": "1.1", "edupi-schedule-occurrence-v1.2": "1.2", "edupi-core-runtime-v1": "1.0" }[stem], `${stem} version`);
  assert.equal(identity.schema_path, schemaPath, `${stem} schema path`);
  assert.equal(identity.schema_hash, hash(JSON.stringify(canonical(schema))), `${stem} schema hash`);
  // Desktop mirrors stay explicit: generation must never silently replace a contract.
  if (stem !== "edupi-core-runtime-v1") {
    assert.deepEqual(await readJson(path.join(desktopRoot, schemaPath)), schema, `${stem} Desktop schema mirror`);
    if (stem !== "edupi-bridge-v1.1") assert.deepEqual(await readJson(path.join(desktopRoot, hashPath)), identity, `${stem} Desktop hash mirror`);
  }
  return identity;
}

export async function pairEduPiCore({ coreRoot, coreCommit, check = false, desktopRoot = root }) {
  assertImmutableCoreCheckout(coreRoot, coreCommit);
  coreRoot = await fs.realpath(coreRoot);
  desktopRoot = await fs.realpath(desktopRoot);
  const base = await readJson(path.join(desktopRoot, compatPath));
  const desktopManifest = await readJson(path.join(coreRoot, desktopManifestPath));
  const runtimeManifest = await readJson(path.join(coreRoot, runtimeManifestPath));
  assertComponentManifestIdentity(desktopManifest, "scripts/desktop_bridge_port.mjs");
  assertComponentManifestIdentity(runtimeManifest, "scripts/core_runtime_daemon.mjs");
  const bridge = await verifySchema(coreRoot, desktopRoot, "edupi-bridge-v1.1");
  const occurrence = await verifySchema(coreRoot, desktopRoot, "edupi-schedule-occurrence-v1.2");
  const runtime = await verifySchema(coreRoot, desktopRoot, "edupi-core-runtime-v1");
  const fixturePath = "fixtures/bridge/v1.1/fixture-manifest.json";
  const fixture = await readJson(path.join(coreRoot, fixturePath));
  assert.equal(fixture.algorithm, "sha256-raw-files-canonical-list-v1");
  assert.equal(fixture.fixture_manifest_hash, hash(JSON.stringify(fixture.files)), "fixture manifest hash");
  assert.deepEqual(await readJson(path.join(desktopRoot, fixturePath)), fixture, "Desktop fixture manifest mirror");
  for (const entry of fixture.files) {
    if (typeof entry.path !== "string" || path.isAbsolute(entry.path) || entry.path.includes("\\") || entry.path.split("/").some(part => part === ".." || part === "")) throw new Error("Invalid fixture path");
    const bytes = await fs.readFile(path.join(coreRoot, "fixtures/bridge/v1.1", entry.path));
    assert.equal(bytes.length, entry.size, `fixture size: ${entry.path}`);
    assert.equal(hash(bytes), entry.sha256, `fixture hash: ${entry.path}`);
    assert.deepEqual(await fs.readFile(path.join(desktopRoot, "fixtures/bridge/v1.1", entry.path)), bytes, `Desktop fixture mirror: ${entry.path}`);
  }
  const corePackage = await readJson(path.join(coreRoot, "package.json"));
  const candidate = {
    ...base,
    core_sdk: { pi: corePackage.dependencies["@earendil-works/pi-coding-agent"], pi_durable: corePackage.dependencies["@earendil-works/pi-durable"] },
    core_runtime: { core_commit: coreCommit, component_manifest_path: desktopManifestPath,
      component_manifest_hash: desktopManifest.component_manifest_hash,
      runtime_component_manifest_hash: runtimeManifest.component_manifest_hash, runtime_schema_hash: runtime.schema_hash },
    contract_identities: base.contract_identities.map(identity => identity.contract_id === "edupi-bridge-v1.1"
      ? { ...identity, schema_hash: bridge.schema_hash, fixture_manifest_hash: fixture.fixture_manifest_hash }
      : identity.contract_id === "edupi-schedule-occurrence-v1.2" ? { ...identity, schema_hash: occurrence.schema_hash } : identity),
  };
  const jiti = createJiti(import.meta.url);
  const { loadEduPiCompatManifest } = await jiti.import(path.join(root, "lib/edupi-bridge-manifest.ts"));
  loadEduPiCompatManifest(candidate);
  assertImmutableCoreCheckout(coreRoot, coreCommit);
  const generator = await jiti.import(path.join(coreRoot, "scripts/edupi_component_manifest.mjs"));
  // Regenerate both graphs, not just their self-hashes, so omitted imports/assets fail.
  assert.deepEqual(await generator.generateDesktopComponentManifest({ root: coreRoot, write: false }), desktopManifest, "Desktop component closure is stale");
  const { educationRuntimeAssets } = await jiti.import(path.join(coreRoot, "scripts/education_runtime_assets.mjs"));
  const explicitRuntimeAssets = [
    "scripts/edupi_component_manifest.mjs", "contracts/edupi-core-runtime-v1.schema.json", "contracts/edupi-core-runtime-v1-hash.json",
    ...["edupi-bridge-v1.1", "edupi-schedule-occurrence-v1.2", "edupi-education-fact-v1", "edupi-capability-v1"]
      .flatMap(stem => [`contracts/${stem}.schema.json`, `contracts/${stem}-hash.json`]),
    "contracts/windows-runtime-attestation-v1.json",
    ...["safety-education-summary-v1", "calendar-administration-package-v1", "lesson-reflection-v1", "parent-communication-v1"]
      .map(name => `capabilities/${name}/capability.json`), fixturePath,
  ];
  const runtimeClosure = generator.generateComponentManifest({ root: coreRoot, entrypoint: "scripts/core_runtime_daemon.mjs", assets: explicitRuntimeAssets, write: false });
  const modules = new Set(runtimeClosure.modules.map(entry => entry.path));
  assert.deepEqual(generator.generateComponentManifest({ root: coreRoot, entrypoint: "scripts/core_runtime_daemon.mjs",
    assets: [...explicitRuntimeAssets, ...(await educationRuntimeAssets(coreRoot)).filter(file => !modules.has(file))], write: false }), runtimeManifest, "Runtime component closure is stale");
  const temporary = await fs.mkdtemp(path.join(desktopRoot, ".manifest-pairing-"));
  try {
    // Keep actual external-root, dependency-file and Git-free bundle verification.
    await buildPackagedCoreBundle({ coreRoot, desktopRoot, compatManifest: candidate, destinationRoot: path.join(temporary, "bundle") });
    assertImmutableCoreCheckout(coreRoot, coreCommit);
    if (check) assert.deepEqual(base, candidate, "Compatibility manifest is stale; run pair-edupi-core.mjs without --check");
    else await fs.writeFile(path.join(desktopRoot, compatPath), `${JSON.stringify(candidate, null, 2)}\n`);
  } finally {
    await fs.rm(temporary, { recursive: true, force: true });
  }
  return candidate;
}

if (path.resolve(process.argv[1] ?? "") === fileURLToPath(import.meta.url)) {
  try {
    const args = process.argv.slice(2);
    const options = {};
    for (let index = 0; index < args.length; index++) {
      const flag = args[index];
      if (flag === "--check" && !options.check) options.check = true;
      else if (["--core-root", "--core-commit"].includes(flag) && args[index + 1] && !args[index + 1].startsWith("--")) {
        const key = flag === "--core-root" ? "coreRoot" : "coreCommit";
        if (options[key]) throw new Error(`Duplicate option: ${flag}`);
        options[key] = args[++index];
      } else throw new Error(`Unknown or incomplete option: ${flag}`);
    }
    const manifest = await pairEduPiCore(options);
    console.log(`${options.check ? "Verified" : "Generated"} ${compatPath}: ${manifest.core_runtime.core_commit}`);
  } catch (error) {
    console.error(error instanceof Error ? error.message : String(error));
    process.exitCode = 1;
  }
}
