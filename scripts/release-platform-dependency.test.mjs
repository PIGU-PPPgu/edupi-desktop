import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

test("the default release dispatch selects only the Mac target", async () => {
  const source = await readFile(new URL("../.github/workflows/release.yml", import.meta.url), "utf8");
  const input = source.slice(source.indexOf("      platform:\n"), source.indexOf("\npermissions:"));
  const defaultPlatform = input.match(/^\s+default: (\S+)$/mu)?.[1];
  assert.equal(defaultPlatform, "macos", "the default must not dispatch the all-platform matrix");
  const targetLine = source.split("\n").find(line => /^\s+target: \$\{\{ fromJSON\(/u.test(line));
  assert.ok(targetLine, "release target matrix must remain explicit");
  const selections = new Map([...targetLine.matchAll(/inputs\.platform == '([^']+)' && '([^']+)'/gu)]
    .map(([, platform, targets]) => [platform, JSON.parse(targets)]));
  assert.deepEqual(selections.get(defaultPlatform), ["aarch64-apple-darwin"]);
  assert.match(input, /options: \[all, macos\]/u);
});

test("single-platform builds override skipped notary ancestry while requiring a successful release guard", async () => {
  const source = await readFile(new URL("../.github/workflows/release.yml", import.meta.url), "utf8");
  const build = source.slice(source.indexOf("\n  build:"), source.indexOf("\n  draft-proof:"));
  assert.match(build, /needs: release/u);
  assert.match(build, /if: \$\{\{ !cancelled\(\) && inputs\.phase == 'draft' && needs\.release\.result == 'success' \}\}/u);
  assert.match(source, /release:\n\s+needs: notary-preflight/u);
  assert.match(source, /inputs\.platform == 'windows' \|\| inputs\.platform == 'linux' \|\| needs\.notary-preflight\.result == 'success'/u);
  assert.doesNotMatch(build, /continue-on-error:/u);
});
