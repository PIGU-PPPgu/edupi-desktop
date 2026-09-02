import assert from "node:assert/strict";
import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";
import { createJiti } from "jiti";
import { buildPackagedCoreBundle } from "./packaged-core-bundle.mjs";

const desktopRoot = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const configuredCoreRoot = process.env.EDUPI_CORE_ROOT;
const jiti = createJiti(import.meta.url, { tsconfigPaths: true });
const { loadEduPiCompatManifest } = await jiti.import(path.join(desktopRoot, "lib", "edupi-bridge-manifest.ts"));
const { resolveEduPiCoreRoot } = await jiti.import(path.join(desktopRoot, "lib", "edupi-core-root.ts"));

function listFiles(root, current = root) {
  const files = [];
  for (const entry of fs.readdirSync(current, { withFileTypes: true }).sort((left, right) => left.name.localeCompare(right.name))) {
    const absolute = path.join(current, entry.name);
    const stat = fs.lstatSync(absolute);
    assert.equal(stat.isSymbolicLink(), false, `bundle contains a symlink: ${absolute}`);
    if (stat.isDirectory()) files.push(...listFiles(root, absolute));
    else if (stat.isFile()) files.push(path.relative(root, absolute).split(path.sep).join("/"));
    else throw new Error(`bundle contains a non-regular entry: ${absolute}`);
  }
  return files;
}

function hash(bytes) {
  return `sha256:${crypto.createHash("sha256").update(bytes).digest("hex")}`;
}

function destinationRoot() {
  const relative = `src-tauri/resources/edupi-core-test-${process.pid}-${Math.random().toString(16).slice(2)}`;
  const destination = path.join(desktopRoot, relative);
  fs.mkdirSync(path.dirname(destination), { recursive: true });
  return destination;
}

test("copies only the pinned Core closure and bundled validation works without .git", { skip: !configuredCoreRoot }, async () => {
  const destination = destinationRoot();
  try {
    const result = await buildPackagedCoreBundle({ coreRoot: configuredCoreRoot, desktopRoot, destinationRoot: destination });
    const compat = loadEduPiCompatManifest();
    assert.equal(result.coreCommit, compat.core_runtime.core_commit);
    assert.equal(result.componentManifestHash, compat.core_runtime.component_manifest_hash);
    assert.equal(fs.existsSync(path.join(destination, ".git")), false);
    assert.equal(fs.existsSync(path.join(destination, "fixtures/bridge/v1.1/fixture-manifest.json")), true);
    const manifest = JSON.parse(fs.readFileSync(path.join(destination, compat.core_runtime.component_manifest_path), "utf8"));
    const expectedFiles = [
      compat.core_runtime.component_manifest_path,
      ...manifest.modules.map((entry) => entry.path),
      ...manifest.assets.map((entry) => entry.path),
      ...manifest.runtime_dependencies.flatMap((dependency) => dependency.files.map((entry) => entry.path)),
      compat.contract_identities[0].fixture_manifest_path,
    ].sort();
    assert.deepEqual(listFiles(destination).sort(), expectedFiles);
    const typebox = manifest.runtime_dependencies.find((dependency) => dependency.name === "typebox");
    const typeboxValue = typebox.files.find((entry) => entry.path === "node_modules/typebox/build/value/index.mjs");
    assert.equal(typeboxValue.sha256, hash(fs.readFileSync(path.join(destination, typeboxValue.path))));
    assert.equal(typeboxValue.size, fs.statSync(path.join(destination, typeboxValue.path)).size);
  } finally {
    fs.rmSync(destination, { recursive: true, force: true });
  }
});

test("bundled validation rejects a tampered or missing runtime dependency file", { skip: !configuredCoreRoot }, async () => {
  const destination = destinationRoot();
  try {
    await buildPackagedCoreBundle({ coreRoot: configuredCoreRoot, desktopRoot, destinationRoot: destination });
    const compat = loadEduPiCompatManifest();
    const runtimeIdentity = compat.core_runtime;
    const runtimeFile = path.join(destination, "node_modules/typebox/build/value/index.mjs");
    fs.appendFileSync(runtimeFile, "\n// tampered\n", "utf8");
    assert.throws(
      () => resolveEduPiCoreRoot({ configuredRoot: destination, allowedRoot: path.dirname(destination), runtimeIdentity, validationMode: "bundled" }),
      /size|hash/i,
    );
    await buildPackagedCoreBundle({ coreRoot: configuredCoreRoot, desktopRoot, destinationRoot: destination });
    fs.rmSync(runtimeFile);
    assert.throws(
      () => resolveEduPiCoreRoot({ configuredRoot: destination, allowedRoot: path.dirname(destination), runtimeIdentity, validationMode: "bundled" }),
      /missing|enoent|regular/i,
    );
  } finally {
    fs.rmSync(destination, { recursive: true, force: true });
  }
});

test("external mode still requires Git while bundled mode does not infer from path", { skip: !configuredCoreRoot }, async () => {
  const destination = destinationRoot();
  try {
    const compat = loadEduPiCompatManifest();
    await buildPackagedCoreBundle({ coreRoot: configuredCoreRoot, desktopRoot, destinationRoot: destination });
    assert.throws(
      () => resolveEduPiCoreRoot({ configuredRoot: destination, allowedRoot: path.dirname(destination), runtimeIdentity: compat.core_runtime, validationMode: "external" }),
      /git|checkout|commit/i,
    );
    assert.throws(
      () => resolveEduPiCoreRoot({ configuredRoot: destination, allowedRoot: path.dirname(destination), runtimeIdentity: compat.core_runtime, validationMode: "unknown" }),
      /validation mode/i,
    );
    const bundled = resolveEduPiCoreRoot({ configuredRoot: destination, allowedRoot: path.dirname(destination), runtimeIdentity: compat.core_runtime, validationMode: "bundled" });
    assert.equal(bundled.validationMode, "bundled");
  } finally {
    fs.rmSync(destination, { recursive: true, force: true });
  }
});
