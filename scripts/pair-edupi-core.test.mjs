import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { execFileSync, spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import test from "node:test";
import { createJiti } from "jiti";
import { assertComponentManifestIdentity, assertImmutableCoreCheckout, pairEduPiCore } from "./pair-edupi-core.mjs";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const compatRelative = "contracts/edupi-core-compat.json";
const compat = JSON.parse(await fs.readFile(path.join(root, compatRelative), "utf8"));
const { loadEduPiCompatManifest } = await createJiti(import.meta.url).import(path.join(root, "lib/edupi-bridge-manifest.ts"));

async function temporary(t) {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), "edupi-pairing-test-"));
  t.after(() => fs.rm(dir, { recursive: true, force: true }));
  return dir;
}

async function desktopFixture(t) {
  const dir = await temporary(t);
  for (const entry of ["contracts", "fixtures", "package.json"]) await fs.cp(path.join(root, entry), path.join(dir, entry), { recursive: true });
  return dir;
}

async function gitFixture(t, files) {
  const dir = await temporary(t);
  const git = args => execFileSync("git", ["-C", dir, ...args], { encoding: "utf8" }).trim();
  git(["init", "--quiet"]);
  git(["config", "core.autocrlf", "false"]);
  for (const [name, bytes] of Object.entries(files)) {
    await fs.mkdir(path.dirname(path.join(dir, name)), { recursive: true });
    await fs.writeFile(path.join(dir, name), bytes);
  }
  git(["add", "."]);
  git(["-c", "user.name=Fixture", "-c", "user.email=fixture@example.invalid", "commit", "--quiet", "-m", "fixture"]);
  return { dir, git, commit: git(["rev-parse", "HEAD"]) };
}

test("rejects hidden source and manifest edits before importing any Core code", async t => {
  for (const flag of ["--assume-unchanged", "--skip-worktree"]) {
    for (const name of ["scripts/edupi_component_manifest.mjs", "contracts/edupi-desktop-component-manifest.json"]) {
      const { dir, git, commit } = await gitFixture(t, { [name]: "{}\n" });
      git(["update-index", flag, name]);
      // Even an unmodified hidden file is unacceptable.
      assert.throws(() => assertImmutableCoreCheckout(dir, commit), /assume-unchanged or skip-worktree/);
      await fs.writeFile(path.join(dir, name), "throw new Error('must never execute');\n");
      assert.equal(git(["status", "--porcelain=v1"]), "", "status alone misses the mutation");
      await assert.rejects(pairEduPiCore({ coreRoot: dir, coreCommit: commit }), /assume-unchanged or skip-worktree/);
    }
  }
});

test("compares raw blobs even when clean filters or EOL conversion hide different bytes", async t => {
  const { dir, git, commit } = await gitFixture(t, {
    ".gitattributes": "source.mjs filter=fixture\nmanifest.json text\n",
    "source.mjs": "trusted\n",
    "manifest.json": "{}\n",
  });
  git(["config", "filter.fixture.clean", "printf 'trusted\\n'"]);
  git(["config", "filter.fixture.smudge", "cat"]);
  await fs.writeFile(path.join(dir, "source.mjs"), "untrusted\n");
  git(["add", "source.mjs"]);
  assert.equal(git(["status", "--porcelain=v1"]), "");
  assert.throws(() => assertImmutableCoreCheckout(dir, commit), /pinned Git blob.*source.mjs/);
  await fs.writeFile(path.join(dir, "source.mjs"), "trusted\n");
  git(["add", "source.mjs"]);
  await fs.writeFile(path.join(dir, "manifest.json"), "{}\r\n");
  git(["add", "manifest.json"]);
  assert.equal(git(["status", "--porcelain=v1"]), "");
  assert.throws(() => assertImmutableCoreCheckout(dir, commit), /pinned Git blob.*manifest.json/);
});

test("rejects tracked symlinks and symlinked parents even with matching target bytes", async t => {
  const { dir, git } = await gitFixture(t, { "directory/source.mjs": "trusted\n" });
  const outside = await temporary(t);
  await fs.writeFile(path.join(outside, "source.mjs"), "trusted\n");
  await fs.symlink(path.join(outside, "source.mjs"), path.join(dir, "linked.mjs"));
  git(["add", "linked.mjs"]);
  git(["-c", "user.name=Fixture", "-c", "user.email=fixture@example.invalid", "commit", "--quiet", "-m", "symlink"]);
  assert.throws(() => assertImmutableCoreCheckout(dir, git(["rev-parse", "HEAD"])), /not symlinks/);
  await fs.rm(path.join(dir, "linked.mjs"));
  git(["rm", "--cached", "linked.mjs"]);
  git(["-c", "user.name=Fixture", "-c", "user.email=fixture@example.invalid", "commit", "--quiet", "-m", "remove symlink"]);
  await fs.rm(path.join(dir, "directory"), { recursive: true });
  await fs.symlink(outside, path.join(dir, "directory"));
  // Git may itself report the replaced directory; either rejection is safe.
  assert.throws(() => assertImmutableCoreCheckout(dir, git(["rev-parse", "HEAD"])), /clean|real directory/);
});

test("requires explicit immutable commit and rejects floating refs and CLI typos", () => {
  for (const ref of [undefined, "main", "HEAD", "v1.0.0", "a".repeat(39), "A".repeat(40)]) {
    assert.throws(() => assertImmutableCoreCheckout(root, ref), /immutable/);
  }
  for (const args of [["--wat"], ["--check", "--check"], ["--core-root"], ["--core-commit", "main"]]) {
    const result = spawnSync(process.execPath, [path.join(root, "scripts/pair-edupi-core.mjs"), ...args], { encoding: "utf8" });
    assert.equal(result.status, 1);
  }
});

test("rejects tracked and untracked dirty Core and mismatched HEAD", async t => {
  const dir = await temporary(t);
  const git = args => execFileSync("git", ["-C", dir, ...args], { encoding: "utf8" }).trim();
  git(["init", "--quiet"]);
  await fs.writeFile(path.join(dir, "source"), "clean\n");
  git(["add", "source"]);
  git(["-c", "user.name=Fixture", "-c", "user.email=fixture@example.invalid", "commit", "--quiet", "-m", "fixture"]);
  const commit = git(["rev-parse", "HEAD"]);
  assertImmutableCoreCheckout(dir, commit);
  assert.throws(() => assertImmutableCoreCheckout(dir, "0".repeat(40)), /HEAD/);
  await fs.writeFile(path.join(dir, "untracked"), "dirty");
  assert.throws(() => assertImmutableCoreCheckout(dir, commit), /clean/);
  await fs.unlink(path.join(dir, "untracked"));
  await fs.writeFile(path.join(dir, "source"), "changed\n");
  assert.throws(() => assertImmutableCoreCheckout(dir, commit), /clean/);
  git(["add", "source"]);
  assert.throws(() => assertImmutableCoreCheckout(dir, commit), /clean/);
});

test("manifest validator retains strict contract shapes without hardcoded runtime digests", () => {
  assert.deepEqual(loadEduPiCompatManifest(), compat);
  const mutations = [
    value => { value.core_runtime.core_commit = "main"; },
    value => { value.core_runtime.runtime_component_manifest_hash = "sha256:short"; },
    value => { value.core_runtime.extra = true; },
    value => { value.contract_identities[0].schema_hash = `sha256:${"0".repeat(64)}`; },
    value => { value.contract_identities[0].fixture_manifest_hash = `sha256:${"0".repeat(64)}`; },
    value => { value.contract_identities[1].depends_on = []; },
    value => { value.contract_identities[1].supported_commands = ["create_task"]; },
    value => { value.supported_commands.pop(); },
    value => { value.unsupported_command_reasons = {}; },
    value => { value.unsupported_command_reasons.review_insight = ""; },
    value => { value.contract_identities = null; },
  ];
  for (const mutate of mutations) {
    const value = structuredClone(compat);
    mutate(value);
    assert.throws(() => loadEduPiCompatManifest(value));
  }
});

const coreRoot = process.env.EDUPI_CORE_ROOT;
test("generates and checks actual immutable Core, rejects stale identity and wrong mirrors, cleans bundles", { skip: !coreRoot }, async t => {
  const desktopRoot = await desktopFixture(t);
  const file = path.join(desktopRoot, compatRelative);
  const options = { coreRoot, coreCommit: compat.core_runtime.core_commit, desktopRoot };
  const before = await fs.readFile(file, "utf8");
  assert.deepEqual(await pairEduPiCore({ ...options, check: true }), compat);
  assert.equal(await fs.readFile(file, "utf8"), before, "check must not rewrite");
  const stale = structuredClone(compat);
  stale.core_runtime.core_commit = "0".repeat(40);
  await fs.writeFile(file, JSON.stringify(stale));
  await assert.rejects(pairEduPiCore({ ...options, check: true }), /stale/);
  assert.equal(await fs.readFile(file, "utf8"), JSON.stringify(stale), "failed check must not write");
  assert.deepEqual(await pairEduPiCore(options), compat);
  assert.equal(await fs.readFile(file, "utf8"), before, "generation is deterministic and preserves metadata");
  const schema = path.join(desktopRoot, "contracts/edupi-bridge-v1.1.schema.json");
  await fs.writeFile(schema, "{}");
  await assert.rejects(pairEduPiCore({ ...options, check: true }), /Desktop schema mirror/);
  assert.deepEqual((await fs.readdir(desktopRoot)).filter(name => name.startsWith(".manifest-pairing-")), []);
});


test("rejects wrong self-hashes, versions, algorithms and entrypoints for both component manifests", { skip: !coreRoot }, async () => {
  for (const [name, entrypoint] of [["edupi-desktop", "scripts/desktop_bridge_port.mjs"], ["edupi-core-runtime", "scripts/core_runtime_daemon.mjs"]]) {
    const manifest = JSON.parse(await fs.readFile(path.join(coreRoot, `contracts/${name}-component-manifest.json`), "utf8"));
    assertComponentManifestIdentity(manifest, entrypoint);
    for (const change of [
      value => { value.component_manifest_hash = `sha256:${"0".repeat(64)}`; },
      value => { value.component_manifest_version = "2"; },
      value => { value.algorithm = "sha256"; },
      value => { value.entrypoint = "scripts/unrelated.mjs"; },
      value => { value.modules.pop(); },
      value => { value.assets.pop(); },
    ]) {
      const candidate = structuredClone(manifest);
      change(candidate);
      assert.throws(() => assertComponentManifestIdentity(candidate, entrypoint));
    }
  }
});
