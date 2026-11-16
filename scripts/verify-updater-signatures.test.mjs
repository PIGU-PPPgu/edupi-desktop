import assert from "node:assert/strict";
import { execFileSync, spawnSync } from "node:child_process";
import { existsSync } from "node:fs";
import { chmod, mkdir, mkdtemp, readFile, rename, rm, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

import { verifyUpdaterSignature, verifyUpdaterSignatures } from "./verify-updater-signatures.mjs";

const root = dirname(dirname(fileURLToPath(import.meta.url)));
const cliPath = join(root, "node_modules/@tauri-apps/cli/tauri.js");
const gatePath = join(root, "scripts/verify-updater-signatures.mjs");
// Never let the smoke test select an inherited release key, including old aliases.
const env = Object.fromEntries(Object.keys(process.env)
  .filter((name) => !name.toUpperCase().startsWith("TAURI_"))
  .map((name) => [name, process.env[name]]));

test("the pinned CLI exposes version signing and release gates run after final repackaging", async () => {
  const pkg = JSON.parse(await readFile(join(root, "package.json"), "utf8"));
  const lock = JSON.parse(await readFile(join(root, "package-lock.json"), "utf8"));
  const installed = JSON.parse(await readFile(join(root, "node_modules/@tauri-apps/cli/package.json"), "utf8"));
  assert.equal(pkg.devDependencies["@tauri-apps/cli"], "2.12.4");
  assert.equal(installed.version, "2.12.4");
  assert.equal(lock.packages[""].devDependencies["@tauri-apps/cli"], "2.12.4");
  for (const [path, entry] of Object.entries(lock.packages)) {
    if (path.startsWith("node_modules/@tauri-apps/cli")) assert.equal(entry.version, "2.12.4", path);
  }
  const help = execFileSync(process.execPath, [cliPath, "signer", "sign", "--help"], { env, encoding: "utf8" });
  assert.match(help, /--app-version <APP_VERSION>/);

  const workflow = await readFile(join(root, ".github/workflows/release.yml"), "utf8");
  const start = workflow.indexOf("      - name: Verify final updater signatures and signed version");
  assert.ok(start > workflow.indexOf("bash scripts/ensure-macos-app-ticket.sh"));
  assert.ok(start > workflow.indexOf("bash scripts/verify-macos-bundle-triad.sh"));
  assert.ok(start < workflow.indexOf("      - name: Replace verified macOS draft assets"));
  const step = workflow.slice(start, workflow.indexOf("\n      - name:", start + 1));
  assert.doesNotMatch(step, /\n\s+(?:if|continue-on-error):/);
  assert.match(step, /RELEASE_TARGET: \$\{\{ matrix\.target \}\}/);
  assert.match(step, /RELEASE_VERSION: \$\{\{ needs\.release\.outputs\.version \}\}/);
  assert.match(step, /node scripts\/verify-updater-signatures\.mjs/);
  assert.match(step, /--bundle-root "src-tauri\/target\/\$RELEASE_TARGET\/release\/bundle"/);
  assert.match(step, /--target "\$RELEASE_TARGET" --version "\$RELEASE_VERSION"/);
  assert.match(step, /--config src-tauri\/tauri\.conf\.json/);
  const ticket = await readFile(join(root, "scripts/ensure-macos-app-ticket.sh"), "utf8");
  assert.match(ticket, /tauri signer sign --app-version "\$RELEASE_VERSION" "\$updater"/);
  const config = JSON.parse(await readFile(join(root, "src-tauri/tauri.conf.json"), "utf8"));
  assert.equal(config.plugins.updater.requireSignedVersion, true);
});

test("real CLI throwaway signatures authenticate the version and every platform payload", async (t) => {
  const directory = await mkdtemp(join(tmpdir(), "edupi-signature-smoke-"));
  const keyPath = join(directory, "throwaway.key");
  const configPath = join(directory, "tauri.conf.json");
  const version = JSON.parse(await readFile(join(root, "src-tauri/pi-agent-desktop-package.json"), "utf8")).version;
  const payload = Buffer.from("EduPi version-bound updater CLI regression\n");
  const runCli = (args) => execFileSync(process.execPath, [cliPath, ...args], {
    env, timeout: 30_000, stdio: ["ignore", "ignore", "ignore"],
  });
  const sign = (artifactPath, appVersion = version) => runCli([
    "signer", "sign", "--private-key-path", keyPath, "--password", "",
    ...(appVersion === null ? [] : ["--app-version", appVersion]), artifactPath,
  ]);
  try {
    await chmod(directory, 0o700);
    // generate stdout/stderr are discarded, never captured or included in errors.
    runCli(["signer", "generate", "--ci", "--password", "", "--write-keys", keyPath]);
    if (process.platform !== "win32") {
      assert.equal((await stat(directory)).mode & 0o777, 0o700);
      assert.equal((await stat(keyPath)).mode & 0o777, 0o600);
    }
    const publicKey = (await readFile(`${keyPath}.pub`, "utf8")).trim();
    const config = { plugins: { updater: { pubkey: publicKey, requireSignedVersion: true } } };
    await writeFile(configPath, JSON.stringify(config));
    const layouts = [
      ["aarch64-apple-darwin", ["macos/EduPi.app.tar.gz"]],
      ["x86_64-unknown-linux-gnu", [`appimage/EduPi_${version}_amd64.AppImage`, `deb/EduPi_${version}_amd64.deb`]],
      ["x86_64-pc-windows-msvc", [`nsis/EduPi_${version}_x64-setup.exe`]],
    ];
    for (const [target, paths] of layouts) {
      const bundleRoot = join(directory, target);
      for (const path of paths) {
        const artifactPath = join(bundleRoot, path);
        await mkdir(dirname(artifactPath), { recursive: true });
        await writeFile(artifactPath, payload);
        sign(artifactPath);
      }
      await t.test(`${target} CLI gate accepts all ${paths.length} authenticated updater signatures`, async () => {
        const verified = await verifyUpdaterSignatures({ bundleRoot, target, version, configPath });
        assert.equal(verified.length, paths.length);
        const output = execFileSync(process.execPath, [
          gatePath, "--bundle-root", bundleRoot, "--target", target, "--version", version, "--config", configPath,
        ], { env, encoding: "utf8", timeout: 30_000 });
        assert.match(output, new RegExp(`Verified ${paths.length} updater signatures and signed version ${version.replaceAll(".", "\\.")}`));
      });
    }

    const target = "aarch64-apple-darwin";
    const bundleRoot = join(directory, target);
    const artifactPath = join(bundleRoot, "macos/EduPi.app.tar.gz");
    const signaturePath = `${artifactPath}.sig`;
    const original = await readFile(signaturePath, "utf8");
    const signatureText = Buffer.from(original, "base64").toString("utf8");
    assert.ok(signatureText.includes(`\tversion:${version}\n`));
    const gate = () => verifyUpdaterSignatures({ bundleRoot, target, version, configPath });

    await t.test("a correctly signed payload cannot be relabelled with another release version", async () => {
      await assert.rejects(verifyUpdaterSignature({ artifactPath, publicKey, version: "9.9.9" }), /must bind release version/);
    });
    await t.test("changing only the trusted version fails cryptographic verification", async () => {
      const changed = signatureText.replace(`\tversion:${version}`, "\tversion:9.9.9");
      await writeFile(signaturePath, Buffer.from(changed).toString("base64"));
      try {
        await assert.rejects(verifyUpdaterSignature({ artifactPath, publicKey, version: "9.9.9" }), /trusted comment signature is invalid/);
        const rejected = spawnSync(process.execPath, [
          gatePath, "--bundle-root", bundleRoot, "--target", target, "--version", "9.9.9", "--config", configPath,
        ], { env, stdio: "ignore", timeout: 30_000 });
        assert.equal(rejected.status, 1, "workflow gate must exit nonzero on an unauthenticated version");
      } finally {
        await writeFile(signaturePath, original);
      }
    });
    await t.test("changed payload bytes fail while the signed version remains valid", async () => {
      await writeFile(artifactPath, Buffer.from("tampered updater"));
      try {
        await assert.rejects(gate(), /artifact signature is invalid/);
      } finally {
        await writeFile(artifactPath, payload);
      }
    });
    await t.test("algorithm bytes must match Minisign exactly, including their high bits", async () => {
      const lines = signatureText.trimEnd().split("\n");
      const changed = Buffer.from(lines[1], "base64");
      changed[0] |= 0x80;
      lines[1] = changed.toString("base64");
      await writeFile(signaturePath, Buffer.from(lines.join("\n")).toString("base64"));
      try {
        await assert.rejects(gate(), /Invalid Minisign signature or public key/);
      } finally {
        await writeFile(signaturePath, original);
      }
      const keyLines = Buffer.from(publicKey, "base64").toString("utf8").trimEnd().split("\n");
      const changedKey = Buffer.from(keyLines[1], "base64");
      changedKey[0] |= 0x80;
      keyLines[1] = changedKey.toString("base64");
      await assert.rejects(verifyUpdaterSignature({
        artifactPath, version, publicKey: Buffer.from(keyLines.join("\n")).toString("base64"),
      }), /Invalid Minisign signature or public key/);
    });
    await t.test("real versionless CLI signatures fail even with version text in the untrusted comment", async () => {
      sign(artifactPath, null);
      const unsignedVersion = Buffer.from(await readFile(signaturePath, "utf8"), "base64").toString("utf8");
      const changed = unsignedVersion.replace("untrusted comment:", `untrusted comment: version:${version}`);
      await writeFile(signaturePath, Buffer.from(changed).toString("base64"));
      try {
        await assert.rejects(gate(), /must bind release version/);
      } finally {
        await writeFile(signaturePath, original);
      }
    });
    await t.test("every extra updater signature is checked, including ones outside the required names", async () => {
      const extraPath = join(bundleRoot, "extra/another-updater.tar.gz");
      await mkdir(dirname(extraPath));
      await writeFile(extraPath, payload);
      sign(extraPath, "9.9.9");
      try {
        await assert.rejects(gate(), /another-updater\.tar\.gz\.sig: Updater signature must bind/);
      } finally {
        await rm(dirname(extraPath), { recursive: true });
      }
    });
    await t.test("a missing Linux deb signature prevents a partly signed platform from passing", async () => {
      const linuxRoot = join(directory, "x86_64-unknown-linux-gnu");
      const debSignature = join(linuxRoot, `deb/EduPi_${version}_amd64.deb.sig`);
      await rename(debSignature, `${debSignature}.saved`);
      try {
        await assert.rejects(verifyUpdaterSignatures({
          bundleRoot: linuxRoot, target: "x86_64-unknown-linux-gnu", version, configPath,
        }), /Missing updater signature/);
      } finally {
        await rename(`${debSignature}.saved`, debSignature);
      }
    });
    await t.test("empty artifacts, malformed signatures and absent payloads fail closed", async () => {
      await writeFile(artifactPath, "");
      await assert.rejects(gate(), /missing or empty/);
      await writeFile(artifactPath, payload);
      await writeFile(signaturePath, "not-base64!");
      await assert.rejects(gate(), /Invalid signature Base64/);
      await writeFile(signaturePath, original);
      await rename(artifactPath, `${artifactPath}.saved`);
      try {
        await assert.rejects(gate(), /ENOENT/);
      } finally {
        await rename(`${artifactPath}.saved`, artifactPath);
      }
    });
    await t.test("production signature requirements and public keys cannot be silently omitted", async () => {
      await writeFile(configPath, JSON.stringify({ plugins: { updater: { ...config.plugins.updater, requireSignedVersion: false } } }));
      await assert.rejects(gate(), /must requireSignedVersion/);
      await writeFile(configPath, JSON.stringify({ plugins: { updater: { requireSignedVersion: true, pubkey: "" } } }));
      await assert.rejects(gate(), /public key is required/);
      await writeFile(configPath, JSON.stringify(config));
      await assert.rejects(verifyUpdaterSignatures({ bundleRoot, target: "unknown", version, configPath }), /Unsupported updater release target/);
      await gate();
    });
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
  assert.equal(existsSync(directory), false, "throwaway keys and payloads must be removed");
});
