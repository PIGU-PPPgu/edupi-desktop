import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

test("a Draft installer is checked against its frozen source contract", async () => {
  const source = await readFile(new URL("../.github/workflows/draft-windows-smoke.yml", import.meta.url), "utf8");
  const validation = source.indexOf("$release.target_commitish -ne $env:SOURCE_SHA");
  const checkout = source.indexOf("- name: Check out the candidate compatibility contract");
  const install = source.indexOf("- name: Install and verify in isolation");
  assert.ok(validation >= 0 && validation < checkout && checkout < install);
  const candidateStep = source.slice(checkout, install);
  assert.match(candidateStep, /ref: \$\{\{ inputs\.source_sha \}\}/u);
  assert.match(candidateStep, /path: \.edupi-candidate-source/u);
  assert.match(candidateStep, /sparse-checkout: contracts\/edupi-core-compat\.json/u);
  assert.match(candidateStep, /persist-credentials: false/u);
  assert.match(source.slice(install), /EDUPI_PREVIEW_COMPAT_PATH: \$\{\{ github\.workspace \}\}\/\.edupi-candidate-source\/contracts\/edupi-core-compat\.json/u);
});
