import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { stapleMacOSArtifact } from "./validate-macos-staple.mjs";

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  await stapleMacOSArtifact(process.argv[2]);
}
