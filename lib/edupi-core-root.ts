import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { execFileSync } from "node:child_process";

export type CoreRuntimeIdentity = {
  core_commit: string;
  component_manifest_path: "contracts/edupi-desktop-component-manifest.json";
  component_manifest_hash: string;
};

export type ResolvedEduPiCore = {
  root: string;
  cwd: string;
  entrypoint: string;
  componentManifestPath: string;
  componentManifestHash: string;
  coreCommit: string;
};

export type ResolvedEduPiDataRoot = {
  root: string;
  allowedRoot: string;
  memoryDir: string;
  outputDir: string;
  lockDir: string;
};

function sha256(bytes: Buffer | string): string {
  return `sha256:${crypto.createHash("sha256").update(bytes).digest("hex")}`;
}

function canonicalize(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(canonicalize);
  if (!value || typeof value !== "object") return value;
  const record = value as Record<string, unknown>;
  return Object.fromEntries(Object.keys(record).sort().map((key) => [key, canonicalize(record[key])]));
}

function isInside(root: string, candidate: string): boolean {
  const relative = path.relative(root, candidate);
  return relative === "" || (!relative.startsWith(`..${path.sep}`) && relative !== ".." && !path.isAbsolute(relative));
}

function requireAbsolute(value: unknown, label: string): string {
  if (typeof value !== "string" || !value || !path.isAbsolute(value)) throw new Error(`${label} must be an absolute path`);
  return value;
}

function resolveDirectory(value: string, label: string): string {
  const resolved = fs.realpathSync(value);
  if (!fs.statSync(resolved).isDirectory()) throw new Error(`${label} must be a directory`);
  return resolved;
}

function containedPath(root: string, relative: string, label: string): string {
  const candidate = path.resolve(root, relative);
  if (!isInside(root, candidate)) throw new Error(`${label} is outside the data root`);

  let current = root;
  for (const component of path.relative(root, candidate).split(path.sep).filter(Boolean)) {
    current = path.join(current, component);
    let stats: fs.Stats;
    try {
      stats = fs.lstatSync(current);
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "ENOENT") break;
      throw error;
    }
    if (stats.isSymbolicLink()) throw new Error(`${label} contains a symlink component: ${current}`);
    const resolved = fs.realpathSync(current);
    if (!isInside(root, resolved)) throw new Error(`${label} is outside the data root`);
    if (!stats.isDirectory()) throw new Error(`${label} must be a directory: ${current}`);
  }
  return candidate;
}

/**
 * Resolve the user data root independently from the pinned Core code root.
 * The three derived paths are intentionally passed to Core; ambient path
 * overrides and HOME/cwd fallbacks are never consulted here.
 */
export function resolveEduPiDataRoot({
  configuredRoot = process.env.EDUPI_DATA_ROOT,
  allowedRoot = process.env.EDUPI_DATA_ALLOWED_ROOT,
}: {
  configuredRoot?: string;
  allowedRoot?: string;
} = {}): ResolvedEduPiDataRoot {
  const configured = requireAbsolute(configuredRoot, "EDUPI_DATA_ROOT");
  const allowedConfigured = requireAbsolute(allowedRoot || path.dirname(configured), "EDUPI_DATA_ALLOWED_ROOT");
  const root = resolveDirectory(configured, "EDUPI_DATA_ROOT");
  const allowed = resolveDirectory(allowedConfigured, "EDUPI_DATA_ALLOWED_ROOT");
  if (!isInside(allowed, root)) throw new Error("EDUPI_DATA_ROOT is outside EDUPI_DATA_ALLOWED_ROOT");
  return {
    root,
    allowedRoot: allowed,
    memoryDir: containedPath(root, ".edupi/memory", "EDUPI_MEMORY_DIR"),
    outputDir: containedPath(root, ".edupi/output", "EDUPI_OUTPUT_DIR"),
    lockDir: containedPath(root, ".edupi/locks", "EDUPI_LOCK_DIR"),
  };
}

export function validateContainedRegularFile({ allowedRoot, candidate }: { allowedRoot: string; candidate: string }): string {
  const root = fs.realpathSync(allowedRoot);
  const resolved = fs.realpathSync(candidate);
  if (!isInside(root, resolved)) throw new Error(`Core entry is outside allowed root: ${candidate}`);
  if (!fs.statSync(resolved).isFile()) throw new Error(`Core entry must be a regular file: ${candidate}`);
  return resolved;
}

function verifyManifestFile(root: string, entry: { path?: unknown; sha256?: unknown; size?: unknown }): void {
  if (typeof entry.path !== "string" || path.isAbsolute(entry.path) || entry.path.includes("..")) throw new Error("Invalid component manifest path");
  const resolved = validateContainedRegularFile({ allowedRoot: root, candidate: path.join(root, entry.path) });
  const bytes = fs.readFileSync(resolved);
  if (entry.size !== bytes.byteLength) throw new Error(`Component size mismatch: ${entry.path}`);
  if (entry.sha256 !== sha256(bytes)) throw new Error(`Component hash mismatch: ${entry.path}`);
}

export function resolveEduPiCoreRoot({
  configuredRoot,
  allowedRoot,
  runtimeIdentity,
}: {
  configuredRoot: string;
  allowedRoot: string;
  runtimeIdentity: CoreRuntimeIdentity;
}): ResolvedEduPiCore {
  if (!configuredRoot || !allowedRoot || !runtimeIdentity) throw new Error("Core root and runtime identity are required");
  const root = fs.realpathSync(configuredRoot);
  const allowed = fs.realpathSync(allowedRoot);
  if (!isInside(allowed, root)) throw new Error("Core root is outside allowed root");
  if (runtimeIdentity.component_manifest_path !== "contracts/edupi-desktop-component-manifest.json") throw new Error("Unexpected component manifest path");

  const head = execFileSync("git", ["-C", root, "rev-parse", "HEAD"], { encoding: "utf8" }).trim();
  if (head !== runtimeIdentity.core_commit) throw new Error(`Core commit mismatch: expected ${runtimeIdentity.core_commit}`);

  const componentManifestPath = validateContainedRegularFile({ allowedRoot: root, candidate: path.join(root, runtimeIdentity.component_manifest_path) });
  const manifest = JSON.parse(fs.readFileSync(componentManifestPath, "utf8")) as Record<string, unknown>;
  const { component_manifest_hash: recordedHash, ...payload } = manifest;
  const calculatedHash = sha256(Buffer.from(JSON.stringify(canonicalize(payload)), "utf8"));
  if (recordedHash !== calculatedHash || recordedHash !== runtimeIdentity.component_manifest_hash) throw new Error("Component manifest hash mismatch");

  const modules = Array.isArray(manifest.modules) ? manifest.modules as Array<{ path?: unknown; sha256?: unknown; size?: unknown }> : [];
  const assets = Array.isArray(manifest.assets) ? manifest.assets as Array<{ path?: unknown; sha256?: unknown; size?: unknown }> : [];
  const all = [...modules, ...assets];
  const paths = all.map((entry) => entry.path);
  if (paths.some((entry) => typeof entry !== "string") || new Set(paths).size !== paths.length) throw new Error("Duplicate or invalid component manifest entries");
  for (const entry of all) verifyManifestFile(root, entry);

  const entrypointRelative = "scripts/desktop_bridge_port.mjs";
  if (!modules.some((entry) => entry.path === entrypointRelative)) throw new Error("Component manifest omits fixed entrypoint");
  const entrypoint = validateContainedRegularFile({ allowedRoot: root, candidate: path.join(root, entrypointRelative) });
  return { root, cwd: root, entrypoint, componentManifestPath, componentManifestHash: String(recordedHash), coreCommit: runtimeIdentity.core_commit };
}
