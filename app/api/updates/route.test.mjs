import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const source = await readFile(new URL("./route.ts", import.meta.url), "utf8");

test("cached available releases remain in the startup reminder response", () => {
  assert.match(source, /const components = APP_UPDATE_PROJECTS\.map/);
  assert.match(source, /updates: getAvailableAppUpdates\(components\)/);
});

test("a manual settings check cannot be coalesced behind a routine cached check", () => {
  assert.match(source, /if \(forceRefresh\) \{\s*updateCheck = performUpdateCheck\(true\)/);
  assert.match(source, /else \{\s*if \(!globalThis\.__piWebAppUpdateCheck\)/);
});
