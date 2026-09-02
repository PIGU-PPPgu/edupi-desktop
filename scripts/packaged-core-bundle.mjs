#!/usr/bin/env node

import crypto from "node:crypto";
import fs from "node:fs";
import { copyFile, lstat, mkdir, readdir, readFile, rm } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { createJiti } from "jiti";

const desktopRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const COMPONENT_MANIFEST_VERSION = "1";
const COMPONENT_MANIFEST_ALGORITHM = "sha256-canonical-component-payload-v1";
const FIXTURE_MANIFEST_RELATIVE_PATH = "fixtures/bridge/v1.1/fixture-manifest.json";

function sha256(bytes) {
  return `sha256:${crypto.createHash("sha256").update(bytes).digest("hex")}`;
}

function isInside(root, candidate) {
  const relative = path.relative(root, candidate);
  return relative === "" || (!relative.startsWith(`..${path.sep}`) && relative !== ".." && !path.isAbsolute(relative));
}

function toPosixRelative(root, absolute) {
  return path.relative(root, absolute).split(path.sep).join("/");
}

function isSafeRelativePath(value) {
  return typeof value === "string"
    && value.length > 0
    && !path.isAbsolute(value)
    && !/^[a-zA-Z]:[\\/]/u.test(value)
    && !value.split(/[\\/]/u).some((part) => part === ".." || part === "");
}

function requireAbsolute(value, label) {
  if (typeof value !== "string" || !path.isAbsolute(value)) throw new Error(`${label} must be an absolute path`);
  return value;
}

async function readRegularFile(root, relative, label) {
  if (!isSafeRelativePath(relative)) throw new Error(`${label} has an invalid path`);
  const absolute = path.resolve(root, ...relative.split("/"));
  if (!isInside(root, absolute)) throw new Error(`${label} escapes its root`);
  const stat = await lstat(absolute);
  if (stat.isSymbolicLink()) throw new Error(`${label} is a symlink`);
  if (!stat.isFile()) throw new Error(`${label} is not a regular file`);
  return { absolute, bytes: await readFile(absolute) };
}

async function loadSharedResolvers() {
  const jiti = createJiti(import.meta.url, { tsconfigPaths: true });
  const [manifestModule, rootModule] = await Promise.all([
    jiti.import(path.join(desktopRoot, "lib", "edupi-bridge-manifest.ts")),
    jiti.import(path.join(desktopRoot, "lib", "edupi-core-root.ts")),
  ]);
  return {
    loadEduPiCompatManifest: manifestModule.loadEduPiCompatManifest,
    resolveEduPiCoreRoot: rootModule.resolveEduPiCoreRoot,
  };
}

function componentFiles(manifest) {
  if (manifest.component_manifest_version !== COMPONENT_MANIFEST_VERSION || manifest.algorithm !== COMPONENT_MANIFEST_ALGORITHM) {
    throw new Error("Core component manifest has an unsupported version or algorithm");
  }
  if (!Array.isArray(manifest.modules) || !Array.isArray(manifest.assets) || !Array.isArray(manifest.runtime_dependencies)) {
    throw new Error("Core component manifest is missing a file or runtime dependency list");
  }
  const files = [];
  const paths = new Set();
  const add = (entry, label) => {
    if (!entry || !isSafeRelativePath(entry.path) || paths.has(entry.path)) throw new Error(`Core component has a duplicate or invalid ${label} path`);
    paths.add(entry.path);
    files.push(entry.path);
  };
  for (const entry of manifest.modules) add(entry, "module");
  for (const entry of manifest.assets) add(entry, "asset");
  const dependencyNames = new Set();
  for (const dependency of manifest.runtime_dependencies) {
    if (!dependency || typeof dependency.name !== "string" || dependencyNames.has(dependency.name)) {
      throw new Error("Core component has duplicate or invalid runtime dependency metadata");
    }
    dependencyNames.add(dependency.name);
    if (!Array.isArray(dependency.files)) throw new Error(`Runtime dependency ${dependency.name} has no file list`);
    for (const entry of dependency.files) add(entry, `runtime dependency ${dependency.name}`);
  }
  return { files: files.sort(), paths };
}

async function verifyFixtureManifest(coreRoot, contractIdentity) {
  const fixture = await readRegularFile(coreRoot, FIXTURE_MANIFEST_RELATIVE_PATH, "Core fixture manifest");
  if (contractIdentity.fixture_manifest_path !== FIXTURE_MANIFEST_RELATIVE_PATH) {
    throw new Error("Desktop fixture manifest path is not the pinned v1.1 path");
  }
  const manifest = JSON.parse(fixture.bytes.toString("utf8"));
  if (manifest.algorithm !== "sha256-raw-files-canonical-list-v1" || !Array.isArray(manifest.files)) {
    throw new Error("Core fixture manifest has an unsupported shape");
  }
  const calculated = sha256(Buffer.from(JSON.stringify(manifest.files), "utf8"));
  if (manifest.fixture_manifest_hash !== calculated || calculated !== contractIdentity.fixture_manifest_hash) {
    throw new Error("Core fixture manifest self-hash mismatch");
  }
  return fixture.bytes;
}

async function listFiles(root, current = root) {
  const files = [];
  for (const entry of (await readdir(current, { withFileTypes: true })).sort((left, right) => left.name.localeCompare(right.name))) {
    const absolute = path.join(current, entry.name);
    const stat = await lstat(absolute);
    if (stat.isSymbolicLink()) throw new Error(`Bundled Core contains a symlink: ${absolute}`);
    if (stat.isDirectory()) files.push(...await listFiles(root, absolute));
    else if (stat.isFile()) files.push(toPosixRelative(root, absolute));
    else throw new Error(`Bundled Core contains a non-regular entry: ${absolute}`);
  }
  return files;
}

async function copyCoreFiles(sourceRoot, destinationRoot, relativeFiles) {
  await rm(destinationRoot, { recursive: true, force: true });
  await mkdir(destinationRoot, { recursive: true });
  for (const relative of relativeFiles) {
    if (!isSafeRelativePath(relative)) throw new Error(`Core bundle path is invalid: ${relative}`);
    const source = path.resolve(sourceRoot, ...relative.split("/"));
    const destination = path.resolve(destinationRoot, ...relative.split("/"));
    if (!isInside(sourceRoot, source) || !isInside(destinationRoot, destination)) throw new Error(`Core bundle path escapes its root: ${relative}`);
    const sourceStat = await lstat(source);
    if (sourceStat.isSymbolicLink() || !sourceStat.isFile()) throw new Error(`Core bundle source is not a regular file: ${relative}`);
    await mkdir(path.dirname(destination), { recursive: true });
    await copyFile(source, destination);
  }
  const actualFiles = (await listFiles(destinationRoot)).sort();
  if (actualFiles.length !== relativeFiles.length || actualFiles.some((file, index) => file !== relativeFiles[index])) {
    throw new Error("Bundled Core contains an unlisted or missing file");
  }
}

async function verifyRuntimeFileClosure(sourceRoot, manifest) {
  for (const dependency of manifest.runtime_dependencies) {
    const packageRoot = path.resolve(sourceRoot, ...dependency.root.split("/"));
    const listed = dependency.files.map((entry) => path.relative(packageRoot, path.resolve(sourceRoot, ...entry.path.split("/"))).split(path.sep).join("/")).sort();
    const actual = (await listFiles(packageRoot)).sort();
    if (actual.length !== listed.length || actual.some((file, index) => file !== listed[index])) {
      throw new Error(`Runtime dependency ${dependency.name} has an unlisted or missing file`);
    }
  }
}

export async function buildPackagedCoreBundle({
  coreRoot = process.env.EDUPI_CORE_ROOT,
  desktopRoot: requestedDesktopRoot = desktopRoot,
  destinationRoot,
} = {}) {
  const configuredCoreRoot = requireAbsolute(coreRoot, "EDUPI_CORE_ROOT");
  const resolvedDesktopRoot = fs.realpathSync(requireAbsolute(requestedDesktopRoot, "Desktop root"));
  const sourceRoot = fs.realpathSync(configuredCoreRoot);
  if (!fs.statSync(sourceRoot).isDirectory()) throw new Error("EDUPI_CORE_ROOT must be a directory");
  const destination = path.resolve(destinationRoot || path.join(resolvedDesktopRoot, "src-tauri", "resources", "edupi-core"));
  if (!isInside(resolvedDesktopRoot, destination)) throw new Error("Bundled Core destination must be inside Desktop root");

  const { loadEduPiCompatManifest, resolveEduPiCoreRoot } = await loadSharedResolvers();
  const identity = loadEduPiCompatManifest();
  const runtimeIdentity = identity.core_runtime;
  const contractIdentity = identity.contract_identities[0];
  const external = resolveEduPiCoreRoot({
    configuredRoot: sourceRoot,
    allowedRoot: path.dirname(sourceRoot),
    runtimeIdentity,
    validationMode: "external",
  });
  if (external.coreCommit !== runtimeIdentity.core_commit || external.componentManifestHash !== runtimeIdentity.component_manifest_hash) {
    throw new Error("External Core identity does not match Desktop pin");
  }

  const manifestBytes = (await readRegularFile(external.root, runtimeIdentity.component_manifest_path, "Core component manifest")).bytes;
  const manifest = JSON.parse(manifestBytes.toString("utf8"));
  const { files } = componentFiles(manifest);
  await verifyFixtureManifest(external.root, contractIdentity);
  await verifyRuntimeFileClosure(external.root, manifest);
  const relativeFiles = [...new Set([...files, runtimeIdentity.component_manifest_path, FIXTURE_MANIFEST_RELATIVE_PATH])].sort();
  await copyCoreFiles(external.root, destination, relativeFiles);

  const bundled = resolveEduPiCoreRoot({
    configuredRoot: destination,
    allowedRoot: path.dirname(destination),
    runtimeIdentity,
    validationMode: "bundled",
  });
  if (bundled.coreCommit !== runtimeIdentity.core_commit || bundled.componentManifestHash !== runtimeIdentity.component_manifest_hash) {
    throw new Error("Bundled Core identity does not match Desktop pin");
  }
  return {
    sourceRoot: external.root,
    destinationRoot: bundled.root,
    coreCommit: bundled.coreCommit,
    componentManifestHash: bundled.componentManifestHash,
    files: relativeFiles.length,
  };
}

if (path.resolve(process.argv[1] || "") === fileURLToPath(import.meta.url)) {
  try {
    const result = await buildPackagedCoreBundle();
    console.log(JSON.stringify({ status: "passed", ...result }, null, 2));
  } catch (error) {
    console.error(error instanceof Error ? error.message : String(error));
    process.exitCode = 1;
  }
}
