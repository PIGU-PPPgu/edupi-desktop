import assert from "node:assert/strict";
import test from "node:test";
import { createJiti } from "jiti";

const { ensureLoopbackModelAuth, isLoopbackModelUrl } = await createJiti(import.meta.url).import("./loopback-model-auth.ts");

test("loopback auth marker is memory-only and never applies to external URLs", async () => {
  assert.equal(isLoopbackModelUrl("http://127.0.0.1:1234/v1"), true);
  assert.equal(isLoopbackModelUrl("http://localhost:1234/v1"), true);
  assert.equal(isLoopbackModelUrl("https://[::1]:1234/v1"), true);
  assert.equal(isLoopbackModelUrl("https://example.com/v1"), false);

  const calls = [];
  const runtime = {
    async getAuth() { return undefined; },
    async setRuntimeApiKey(provider, key) { calls.push([provider, key]); },
  };
  assert.equal(await ensureLoopbackModelAuth({ provider: "local", baseUrl: "http://127.0.0.1:1234/v1" }, runtime.getAuth, runtime.setRuntimeApiKey), true);
  assert.deepEqual(calls, [["local", "local-loopback"]]);
  assert.equal(await ensureLoopbackModelAuth({ provider: "remote", baseUrl: "https://example.com/v1" }, runtime.getAuth, runtime.setRuntimeApiKey), false);
  assert.deepEqual(calls, [["local", "local-loopback"]]);
  assert.equal(await ensureLoopbackModelAuth({ provider: "local", baseUrl: "http://127.0.0.1:1234/v1" }, async () => ({ auth: { apiKey: "configured" } }), runtime.setRuntimeApiKey), false);
});
