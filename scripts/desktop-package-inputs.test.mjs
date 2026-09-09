import assert from "node:assert/strict";
import test from "node:test";
import path from "node:path";
import { isDesktopServerInput } from "./desktop-package-inputs.mjs";
test("desktop staging excludes local state and previous build trees, retains production chunks", () => {
  const root = path.resolve("fixture");
  for (const file of [".git/config", ".env.local", ".edupi/memory/preferences.json", "src-tauri/target/release/bundle/EduPi.app/file", "src-tauri/resources/server/server.js", ".next/server/page.js", ".next-desktop/standalone/server.js", "../outside"]) assert.equal(isDesktopServerInput(root, path.resolve(root, file)), false, file);
  for (const file of ["server.js", ".next-desktop/server/app/page.js", "contracts/edupi-core-compat.json", "node_modules/next/package.json"]) assert.equal(isDesktopServerInput(root, path.resolve(root, file)), true, file);
});
