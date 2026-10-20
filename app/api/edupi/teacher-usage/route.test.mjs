import assert from "node:assert/strict";
import test from "node:test";
import { createJiti } from "jiti";
const { GET, POST } = await createJiti(import.meta.url, { tsconfigPaths: true }).import("./route.ts");
test("usage route authenticates every read and mutation before resolving Core", async () => {
  const prior = process.env.PI_DESKTOP_API_TOKEN;
  process.env.PI_DESKTOP_API_TOKEN = "synthetic-usage-test-".padEnd(64, "x");
  const url = "http://localhost:30141/api/edupi/teacher-usage";
  const base = { host: "localhost:30141", origin: "http://localhost:30141" };
  try {
    for (const headers of [base, { ...base, "x-pi-desktop-token": "wrong" }, { ...base, "x-pi-desktop-token": process.env.PI_DESKTOP_API_TOKEN, origin: "https://attacker.example" }, { ...base, "x-pi-desktop-token": process.env.PI_DESKTOP_API_TOKEN, host: "192.168.1.10:30141" }]) {
      assert.equal((await GET(new Request(url, { headers }))).status, 403);
      assert.equal((await POST(new Request(url, { method: "POST", headers: { ...headers, "content-type": "application/json" }, body: JSON.stringify({ action: "erase_all" }) }))).status, 403);
    }
    const headers = { ...base, "x-pi-desktop-token": process.env.PI_DESKTOP_API_TOKEN, "content-type": "application/json" };
    for (const body of [null, [], { action: "record", expected_owner_id: "other" }, { action: "consent_set", checked: false }]) {
      assert.equal((await POST(new Request(url, { method: "POST", headers, body: JSON.stringify(body) }))).status, 400);
    }
    assert.equal((await POST(new Request(url, { method: "POST", headers, body: JSON.stringify({ x: "a".repeat(8193) }) }))).status, 413);
  } finally { if (prior === undefined) delete process.env.PI_DESKTOP_API_TOKEN; else process.env.PI_DESKTOP_API_TOKEN = prior; }
});
