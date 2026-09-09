import assert from "node:assert/strict";
import test from "node:test";
import { createJiti } from "jiti";
const { GET, POST } = await createJiti(import.meta.url, { tsconfigPaths: true }).import("./route.ts");
const request = (body, headers = {}) => new Request("http://localhost/api/edupi/plan-overlaps", { method: "POST", headers: { host: "localhost", "content-type": "application/json", ...headers }, body: JSON.stringify(body) });
test("rejects cross-origin reads/writes and non-json writes before data access", async () => {
  const headers = { origin: "https://attacker.example", "sec-fetch-site": "cross-site" };
  assert.equal((await GET(request({}, headers))).status, 403);
  assert.equal((await POST(request({ action: "scan" }, headers))).status, 403);
  assert.equal((await POST(request({}, { "content-type": "text/plain" }))).status, 415);
});
test("rejects invalid actions and ids before invoking service", async () => {
  for (const body of [null, [], { action: "delete" }, { action: "merge", id: "unknown" }, { action: "scan", injection: true }, { action: "merge", id: "a".repeat(64), keepId: 1 }]) assert.equal((await POST(request(body))).status, 400);
});
