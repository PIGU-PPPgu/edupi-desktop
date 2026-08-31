import path from "node:path";

export const EDUPI_MANAGED_WRITE_ERROR = "EduPi managed data requires the Core intake path";

type PathFlavor = "posix" | "win32";

function isWindowsPath(value: string): boolean {
  return /^[a-zA-Z]:[\\/]/.test(value) || value.startsWith("\\\\") || value.startsWith("//");
}

function flavorFor(dataRoot: string, candidate: string): PathFlavor {
  return isWindowsPath(dataRoot) || isWindowsPath(candidate) ? "win32" : "posix";
}

function resolvePath(value: string, flavor: PathFlavor, requireAbsolute: boolean): string | null {
  if (!value || value.includes("\0")) return null;
  const resolver = flavor === "win32" ? path.win32 : path.posix;
  if (requireAbsolute && !resolver.isAbsolute(value)) return null;
  return resolver.resolve(value);
}

function isWithin(root: string, candidate: string, flavor: PathFlavor): boolean {
  const resolver = flavor === "win32" ? path.win32 : path.posix;
  const comparableRoot = flavor === "win32" ? root.toLowerCase() : root;
  const comparableCandidate = flavor === "win32" ? candidate.toLowerCase() : candidate;
  const separator = resolver.sep;
  const rootWithSeparator = comparableRoot.endsWith(separator)
    ? comparableRoot
    : `${comparableRoot}${separator}`;
  return comparableCandidate === comparableRoot || comparableCandidate.startsWith(rootWithSeparator);
}

/** Resolve the configured Core data root's reserved directory without a fallback. */
export function resolveEduPiManagedRoot(dataRoot = process.env.EDUPI_DATA_ROOT): string | null {
  if (typeof dataRoot !== "string" || !dataRoot.trim() || dataRoot.includes("\0")) return null;
  const trimmedRoot = dataRoot.trim();
  const flavor = isWindowsPath(trimmedRoot) ? "win32" : "posix";
  const resolvedRoot = resolvePath(trimmedRoot, flavor, false);
  if (!resolvedRoot) return null;
  const resolver = flavor === "win32" ? path.win32 : path.posix;
  return resolver.join(resolvedRoot, ".edupi");
}

/**
 * Return whether a destination is in the configured Core-managed tree.
 *
 * An optional resolved path lets callers check a physical path obtained after
 * resolving an existing destination or its parent. Both the user-supplied and
 * resolved forms are considered so a symlink cannot enter or leave the managed
 * tree without being rejected by the mutation boundary.
 */
export function isEduPiManagedPath(
  candidatePath: string,
  dataRoot = process.env.EDUPI_DATA_ROOT,
  resolvedCandidatePath?: string,
): boolean {
  if (typeof candidatePath !== "string" || candidatePath.includes("\0")) return false;
  const configuredRoot = typeof dataRoot === "string" ? dataRoot.trim() : dataRoot;
  if (!configuredRoot) return false;

  const managedRoot = resolveEduPiManagedRoot(configuredRoot);
  if (!managedRoot) return false;
  const flavor = flavorFor(configuredRoot, candidatePath);
  const resolvedCandidate = resolvePath(candidatePath, flavor, true);
  if (!resolvedCandidate) return false;
  if (isWithin(managedRoot, resolvedCandidate, flavor)) return true;

  if (typeof resolvedCandidatePath !== "string" || resolvedCandidatePath.includes("\0")) return false;
  const resolvedFlavor = flavorFor(configuredRoot, resolvedCandidatePath);
  if (resolvedFlavor !== flavor) return false;
  const physicalCandidate = resolvePath(resolvedCandidatePath, resolvedFlavor, true);
  return physicalCandidate ? isWithin(managedRoot, physicalCandidate, resolvedFlavor) : false;
}
