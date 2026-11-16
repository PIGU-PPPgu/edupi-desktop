import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

test("single-platform builds override skipped notary ancestry while requiring a successful release guard", async () => {
  const source = await readFile(new URL("../.github/workflows/release.yml", import.meta.url), "utf8");
  const build = source.slice(source.indexOf("\n  build:"), source.indexOf("\n  draft-proof:"));
  assert.match(build, /needs: release/u);
  assert.match(build, /if: \$\{\{ !cancelled\(\) && inputs\.phase == 'draft' && needs\.release\.result == 'success' \}\}/u);
  assert.match(source, /release:\n\s+needs: notary-preflight/u);
  assert.match(source, /inputs\.platform == 'windows' \|\| inputs\.platform == 'linux' \|\| needs\.notary-preflight\.result == 'success'/u);
  assert.doesNotMatch(build, /continue-on-error:/u);
});
