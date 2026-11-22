import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import { createHash } from "node:crypto";
import test from "node:test";
import { createJiti } from "jiti";
const jiti = createJiti(import.meta.url, { tsconfigPaths: true });
const { cloudPromptTranscript, ensureCloudChatWorker, stopCloudChatWorkers } = await jiti.import("./edupi-cloud-chat-worker.ts");
const { EduPiCloudError } = await jiti.import("./edupi-cloud-client.ts");
const scope = { issuer: "https://synthetic.invalid", accountId: "teacher", workspaceId: "workspace", generation: 1 };
const digest = value => createHash("sha256").update(JSON.stringify(value)).digest("hex");

test("one cloud prompt sees completed pairs and its own user message, excluding later queued messages", () => {
  const response = {
    requests: [
      { request_id: "done", status: "completed" }, { request_id: "cancelled", status: "cancelled" },
      { request_id: "first", status: "running" }, { request_id: "second", status: "queued" },
    ],
    messages: [["done", "assistant"], ["done", "user"], ["cancelled", "user"], ["first", "user"], ["second", "user"]]
      .map(([request_id, role]) => ({ request_id, role, message: { role, content: request_id } })),
  };
  assert.deepEqual(cloudPromptTranscript(response, "first").map(row => [row.request_id, row.role]),
    [["done", "user"], ["done", "assistant"], ["first", "user"]]);
  assert.throws(() => cloudPromptTranscript(response, "missing"));
});

for (const code of ["session_not_found", "chat_request_changed", "idempotency_conflict", null]) {
  test(`journal ${code || "null/corrupt"} cannot block another request or invoke the model`, async () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), "edupi-worker-recovery-"));
    const directory = path.join(root, digest([scope.issuer, scope.accountId, scope.workspaceId]));
    fs.mkdirSync(directory, { mode: 0o700 });
    const file = path.join(directory, `${"a".repeat(64)}.json`);
    const journal = { scope: digest([scope.issuer, scope.accountId, scope.workspaceId]),
      sessionId: "deleted", requestId: "old", status: "final",
      message: { role: "assistant", content: [{ type: "text", text: "retained evidence" }] } };
    fs.writeFileSync(file, JSON.stringify(code ? journal : null), { mode: 0o600 });
    fs.writeFileSync(path.join(directory, `${"b".repeat(64)}.json`), "{broken", { mode: 0o600 });
    let reached, timer, claims = 0, recoveries = 0;
    const checkpoint = new Promise((resolve, reject) => {
      reached = resolve; timer = setTimeout(() => reject(new Error("worker did not claim")), 2000);
    });
    const client = {
      runtimeDirectory: () => root,
      assertScope: async () => ({ installationId: "synthetic" }),
      operation: async (operation, body) => {
        if (operation === "runtime" && body.action === "register") return { instance_id: "desktop-synthetic", fencing_generation: 1 };
        if (operation === "runtime" && body.action === "lease_acquire") return { lease_token: "synthetic" };
        if (body.action === "recover") { recoveries++; throw new EduPiCloudError(code, code, code === "session_not_found" ? 404 : 409); }
        if (body.action === "claim") { claims++; stopCloudChatWorkers(); reached(); return { request: null }; }
        return {};
      },
    };
    try {
      ensureCloudChatWorker(client, scope, { intervalMs: 1, execute: async () => assert.fail("must not call the model") });
      await checkpoint;
      assert.equal(claims, 1);
      assert.equal(recoveries, code ? 1 : 0);
      const retained = JSON.parse(fs.readFileSync(file, "utf8"));
      if (code) {
        assert.equal(retained.status, "stopped"); assert.equal(retained.reason, code);
        assert.deepEqual(retained.message, journal.message);
      } else assert.equal(retained, null);
    } finally {
      clearTimeout(timer); stopCloudChatWorkers(); fs.rmSync(root, { recursive: true, force: true });
    }
  });
}
