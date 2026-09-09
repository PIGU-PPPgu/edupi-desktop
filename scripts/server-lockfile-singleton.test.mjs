import assert from "node:assert/strict";
import test from "node:test";
import { createJiti } from "jiti";

test("server routes share the native lockfile module and its signal handlers", async () => {
  const jiti = createJiti(import.meta.url);
  const { default: config } = await jiti.import("../next.config.ts");
  assert.ok(config.serverExternalPackages.includes("proper-lockfile"));
});
