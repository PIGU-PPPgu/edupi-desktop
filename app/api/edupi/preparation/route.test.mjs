import assert from "node:assert/strict";
import test from "node:test";
import { createJiti } from "jiti";

const { POST } = await createJiti(import.meta.url, { tsconfigPaths: true }).import("./route.ts");

function request(body, headers = {}) {
  return new Request("http://localhost/api/edupi/preparation", {
    method: "POST",
    headers: { host: "localhost", origin: "http://localhost", "content-type": "application/json", "sec-fetch-site": "same-origin", ...headers },
    body: typeof body === "string" ? body : JSON.stringify(body),
  });
}

test("rejects cross-site, non-JSON, malformed, oversized, and invalid preparation requests", async () => {
  assert.equal((await POST(request({ action: "run" }, { origin: "http://evil.test", "sec-fetch-site": "cross-site" }))).status, 403);
  assert.equal((await POST(request({ action: "run" }, { "content-type": "text/plain" }))).status, 415);

  for (const body of ["{", {}, [], { action: "unknown" }, { action: "ensure", taskId: "task-1" }, { action: "run", taskId: "bad\nid" }, { action: "run", taskId: "x".repeat(161) }, { action: "run", admin: true }]) {
    assert.equal((await POST(request(body))).status, 400);
  }

  assert.equal((await POST(request({ action: "run", taskId: "x".repeat(1100) }))).status, 413);
});
