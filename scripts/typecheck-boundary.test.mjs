import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

test("Desktop typecheck excludes generated native bundles, not application source", async () => {
  const config = JSON.parse(await readFile(new URL("../tsconfig.json", import.meta.url), "utf8"));
  for (const path of ["src-tauri/resources", "src-tauri/target", ".edupi-core-runtime"]) assert.ok(config.exclude.includes(path));
  for (const path of ["app", "components", "lib", "hooks"]) assert.ok(!config.exclude.includes(path));
});
