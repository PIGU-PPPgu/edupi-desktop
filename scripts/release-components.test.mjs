import assert from "node:assert/strict";
import test from "node:test";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { execFileSync, spawnSync } from "node:child_process";
import {
  compareVersions,
  createComponentManifest,
  isReleasePinValid,
  nextPatchVersion,
  normalizeVersion,
  readPairedCoreIdentity,
  rootDir,
} from "./release-components.mjs";
import { verifyFixtureMirrors } from "./pair-edupi-core.mjs";

test("normalizes GitHub release tags", () => {
  assert.equal(normalizeVersion("v0.81.1"), "0.81.1");
  assert.equal(normalizeVersion("0.7.17"), "0.7.17");
  assert.throws(() => normalizeVersion("latest"), /Invalid release version/);
});

async function releaseFixture(t) {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), "edupi-release-identity-test-"));
  t.after(() => fs.rm(dir, { recursive: true, force: true }));
  for (const name of [
    ".gitattributes", "package.json", "contracts", "fixtures",
    "lib/edupi-bridge-manifest.ts", "lib/edupi-bridge-contract.ts",
    "scripts/release-components.mjs", "scripts/write-component-versions.mjs",
    "src-tauri/pi-agent-desktop-package.json", "src-tauri/Cargo.toml",
    "src-tauri/resources/component-versions.json",
  ]) {
    await fs.mkdir(path.dirname(path.join(dir, name)), { recursive: true });
    await fs.cp(path.join(rootDir, name), path.join(dir, name), { recursive: true });
  }
  return dir;
}

function runManifestCheck(dir) {
  return spawnSync(process.execPath, ["scripts/write-component-versions.mjs", "--check"], { cwd: dir, encoding: "utf8" });
}

test("Git autocrlf checkouts retain identical raw pairing identity and committed release manifests", async t => {
  const source = await releaseFixture(t);
  const git = (dir, args) => execFileSync("git", ["-C", dir, ...args], { encoding: "utf8" }).trim();
  git(source, ["init", "--quiet"]);
  git(source, ["config", "core.autocrlf", "false"]);
  await fs.writeFile(path.join(source, "control.txt"), "line one\nline two\n");
  git(source, ["add", "."]);
  git(source, ["-c", "user.name=Fixture", "-c", "user.email=fixture@example.invalid", "commit", "--quiet", "-m", "fixture"]);
  const identities = [];
  for (const autocrlf of ["false", "true", "input"]) {
    const checkout = await fs.mkdtemp(path.join(os.tmpdir(), "edupi-release-checkout-"));
    t.after(() => fs.rm(checkout, { recursive: true, force: true }));
    execFileSync("git", ["clone", "--quiet", "--no-checkout", source, checkout]);
    git(checkout, ["config", "core.autocrlf", autocrlf]);
    git(checkout, ["-c", "core.eol=lf", "checkout", "--quiet", "--force", "HEAD"]);
    await fs.symlink(path.join(rootDir, "node_modules"), path.join(checkout, "node_modules"), "junction");
    if (autocrlf === "true") assert.match(await fs.readFile(path.join(checkout, "control.txt"), "utf8"), /\r\n/);
    for (const name of ["contracts/edupi-core-compat.json", "src-tauri/resources/component-versions.json"]) {
      assert.deepEqual(await fs.readFile(path.join(checkout, name)), await fs.readFile(path.join(source, name)), `${name}: ${autocrlf}`);
      assert.match(git(checkout, ["check-attr", "text", "eol", "--", name]), /eol: lf/);
    }
    const result = runManifestCheck(checkout);
    assert.equal(result.status, 0, result.stderr);
    await verifyFixtureMirrors(source, checkout);
    if (autocrlf === "true") {
      const fixturePath = path.join(checkout, "fixtures/bridge/v1.1/command-unsupported.json");
      const before = await fs.readFile(fixturePath);
      await fs.writeFile(fixturePath, before.toString().replace(/\r?\n/g, "\r\n"));
      await assert.rejects(verifyFixtureMirrors(source, checkout), /Desktop fixture mirror/);
      await fs.writeFile(fixturePath, before);
      await verifyFixtureMirrors(source, checkout);
    }
    identities.push(JSON.parse(execFileSync(process.execPath, ["--input-type=module", "-e",
      'import { readPairedCoreIdentity } from "./scripts/release-components.mjs"; console.log(JSON.stringify(await readPairedCoreIdentity()));',
    ], { cwd: checkout, encoding: "utf8" })));
  }
  assert.deepEqual(identities[0], identities[1]);
  assert.deepEqual(identities[0], identities[2]);
});

test("check CLI rejects every stale Core identity field even when appVersion still matches", async t => {
  const dir = await releaseFixture(t);
  await fs.symlink(path.join(rootDir, "node_modules"), path.join(dir, "node_modules"), "junction");
  const file = path.join(dir, "src-tauri/resources/component-versions.json");
  const before = await fs.readFile(file, "utf8");
  const manifest = JSON.parse(before);
  assert.equal(runManifestCheck(dir).status, 0);
  for (const key of Object.keys(manifest.core)) {
    const stale = structuredClone(manifest);
    stale.core[key] = key === "core_commit" ? "0".repeat(40)
      : key.endsWith("hash") ? `sha256:${"0".repeat(64)}` : "stale";
    assert.equal(stale.appVersion, manifest.appVersion);
    const bytes = `${JSON.stringify(stale, null, 2)}\n`;
    await fs.writeFile(file, bytes);
    const result = runManifestCheck(dir);
    assert.equal(result.status, 1, key);
    assert.match(result.stderr, /component-versions.json is stale/, key);
    assert.equal(await fs.readFile(file, "utf8"), bytes, "check must reject without regenerating");
  }
  await fs.writeFile(file, before);
  assert.equal(runManifestCheck(dir).status, 0);
});

test("compares stable and prerelease versions", () => {
  assert.equal(compareVersions("0.81.1", "0.81.0"), 1);
  assert.equal(compareVersions("0.81", "0.81.0"), 0);
  assert.equal(compareVersions("1.0.0-rc.2", "1.0.0-rc.10"), -1);
  assert.equal(compareVersions("1.0.0", "1.0.0-rc.10"), 1);
});

test("bumps the patch version", () => {
  assert.equal(nextPatchVersion("v0.1.0"), "0.1.1");
  assert.equal(nextPatchVersion("1.2"), "1.2.1");
});

test("only accepts explicit pins for the exact bundled component version", () => {
  assert.equal(isReleasePinValid({ version: "0.8.7", reason: "Fork compatibility review" }, "0.8.7"), true);
  assert.equal(isReleasePinValid({ version: "0.8.8", reason: "Wrong version" }, "0.8.7"), false);
  assert.equal(isReleasePinValid({ version: "0.8.7", reason: "" }, "0.8.7"), false);
});

test("writes an auditable three-component manifest with the paired Core identity", async () => {
  const core = await readPairedCoreIdentity();
  assert.deepEqual(
    createComponentManifest({ "pi-agent-desktop": "0.1.0", pi: "0.81.1", "pi-web": "0.7.17" }, core),
    {
      schemaVersion: 1,
      appVersion: "0.1.0",
      core,
      components: [
        { id: "pi-agent-desktop", repository: "PIGU-PPPgu/edupi-desktop", version: "0.1.0" },
        { id: "pi", repository: "earendil-works/pi", version: "0.81.1" },
        { id: "pi-web", repository: "agegr/pi-web", version: "0.7.17" },
      ],
    },
  );
});


test("release manifests require a complete immutable Core identity", async () => {
  const versions = { "pi-agent-desktop": "0.1.0", pi: "1.0.2", "pi-web": "0.8.7" };
  const core = await readPairedCoreIdentity();
  assert.throws(() => createComponentManifest(versions), /Core release identity/);
  for (const key of Object.keys(core)) {
    assert.throws(() => createComponentManifest(versions, { ...core, [key]: "main" }), /Core release identity/);
  }
});
