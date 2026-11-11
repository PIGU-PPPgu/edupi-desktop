import assert from "node:assert/strict";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import {
  createComponentManifest,
  readLocalComponentVersions,
  readPairedCoreIdentity,
  rootDir,
} from "./release-components.mjs";

const destination = join(rootDir, "src-tauri", "resources", "component-versions.json");
const manifest = createComponentManifest(await readLocalComponentVersions(), await readPairedCoreIdentity());
const args = process.argv.slice(2);
if (args.length && (args.length !== 1 || args[0] !== "--check")) throw new Error("Usage: write-component-versions.mjs [--check]");
if (args[0] === "--check") {
  assert.deepEqual(JSON.parse(await readFile(destination, "utf8")), manifest, "component-versions.json is stale");
  console.log(`Verified ${destination}`);
} else {
  await mkdir(dirname(destination), { recursive: true });
  await writeFile(destination, `${JSON.stringify(manifest, null, 2)}\n`);
  console.log(`Wrote ${destination}`);
}
