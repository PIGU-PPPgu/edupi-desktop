import { isAbsolute } from "node:path";
import { expand } from "brace-expansion";
import { globSync as matchPaths } from "glob";

// Only Next's getRootDirs caller is overridden, not the general fast-glob API.
export function globSync(pattern, options) {
  if (typeof pattern !== "string" || options?.onlyDirectories !== true
    || Object.keys(options).some(key => key !== "onlyDirectories")) {
    throw new TypeError("Unsupported Next root-directory glob call");
  }
  return matchPaths(expand(pattern), {
    mark: true, absolute: isAbsolute(pattern),
  }).filter(entry => entry.endsWith("/"))
    .map(directory => directory.length > 1 ? directory.replace(/\/$/, "") : directory);
}
