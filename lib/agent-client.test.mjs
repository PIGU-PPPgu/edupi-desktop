import assert from "node:assert/strict";
import test from "node:test";
import { createJiti } from "jiti";
const { sendAgentCommand, AgentCommandPendingError } = await createJiti(import.meta.url).import("./agent-client.ts");

test("a queued model change or cancellation is never returned as an applied command", async t => {
  const original = globalThis.fetch;
  t.after(() => { globalThis.fetch = original; });
  for (const body of [{ queued: true, data: null }, { pendingSync: true, data: null }]) {
    globalThis.fetch = async () => Response.json(body, { status: 202 });
    await assert.rejects(sendAgentCommand("cloud-one", { type: "abort" }), error =>
      error instanceof AgentCommandPendingError && error.code === "pending_sync" && /联网/.test(error.message));
  }
  globalThis.fetch = async () => Response.json({ success: true, data: { applied: true } });
  assert.deepEqual(await sendAgentCommand("local-one", { type: "get_state" }), { applied: true });
});

test("a cloud command carries the displayed session scope instead of a later global account", async t => {
  const original = globalThis.fetch;
  t.after(() => { globalThis.fetch = original; });
  const scope = JSON.stringify(["cloud", "https://synthetic.invalid", "original-teacher", "workspace", 3]);
  globalThis.fetch = async (_url, options) => {
    assert.equal(options.headers.get("x-edupi-cloud-scope"), scope);
    return Response.json({ success: true, data: null });
  };
  await sendAgentCommand("cloud-one", { type: "abort" }, scope);
});
