import assert from "node:assert/strict";
import test from "node:test";
import { createJiti } from "jiti";
const { loadOrCreateGitHubRuntimeKey } = await createJiti(import.meta.url).import("./desktop-keychain.ts");

test("Keychain initialization carries its key only over stdin and verifies storage", async () => {
  const calls = [];
  let stored = null;
  const key = await loadOrCreateGitHubRuntimeKey({ run: async (args, input) => {
    calls.push({ args, input });
    if (args[0] === "find-generic-password") return stored ? { code: 0, stdout: stored + "\n" } : { code: 44, stdout: "" };
    assert.deepEqual(args, ["-i", "-q"]);
    assert.doesNotMatch(input, /(?:^|\s)-A(?:\s|$)/);
    stored = input.match(/-w ([a-f0-9]{64})\n$/u)[1];
    return { code: 0, stdout: "" };
  } });
  assert.match(key, /^[a-f0-9]{64}$/);
  assert.equal(calls.length, 3);
  assert.equal(calls.some((call) => call.args.some((arg) => arg.includes(key))), false);
  assert.equal(calls.filter((call) => call.input?.includes(key)).length, 1);
});

test("existing database without its Keychain key never generates a replacement", async () => {
  let calls = 0;
  await assert.rejects(loadOrCreateGitHubRuntimeKey({ databaseExists: true, run: async () => { calls += 1; return { code: 44, stdout: "" }; } }), /github_keychain_unavailable/);
  assert.equal(calls, 1);
  await assert.rejects(loadOrCreateGitHubRuntimeKey({ run: async () => ({ code: 0, stdout: "not-a-key" }) }), /github_keychain_unavailable/);
  await assert.rejects(loadOrCreateGitHubRuntimeKey({ run: async () => ({ code: 36, stdout: "" }) }), /github_keychain_unavailable/);
});
