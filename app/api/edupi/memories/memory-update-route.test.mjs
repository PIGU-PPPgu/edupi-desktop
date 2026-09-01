import assert from "node:assert/strict";
import fs from "node:fs";
import test from "node:test";
import { createJiti } from "jiti";

const { POST } = await createJiti(import.meta.url, { tsconfigPaths: true }).import("./[memoryId]/route.ts");
const params = { params: Promise.resolve({ memoryId: "pref-1" }) };

function request(body, headers = {}) {
  return new Request("http://localhost/api/edupi/memories/pref-1", {
    method: "POST",
    headers: { host: "localhost", origin: "http://localhost", "content-type": "application/json", "sec-fetch-site": "same-origin", ...headers },
    body: typeof body === "string" ? body : JSON.stringify(body),
  });
}

test("rejects cross-site, non-JSON, malformed, unknown and invalid memory updates", async () => {
  assert.equal((await POST(request({ expectedRevision: 0, content: "修改" }, { origin: "http://evil.test", "sec-fetch-site": "cross-site" }), params)).status, 403);
  assert.equal((await POST(request({ expectedRevision: 0, content: "修改" }, { "content-type": "text/plain" }), params)).status, 415);
  for (const body of ["{", {}, { expectedRevision: -1, content: "修改" }, { expectedRevision: 0, content: "" }, { expectedRevision: 0, content: "x".repeat(4001) }, { expectedRevision: 0, content: "修改", admin: true }]) {
    assert.equal((await POST(request(body), params)).status, 400);
  }
});

test("a valid manual memory update reaches only the Core boundary", async () => {
  const response = await POST(request({ expectedRevision: 0, content: "称呼我为吴老师，教授七年级数学" }), params);
  assert.equal(response.status, 503);
  const body = await response.json();
  assert.ok(["unsupported_command", "unavailable"].includes(body.code));
});

test("route is a bounded Core adapter without direct memory writes or Agent prompts", () => {
  const source = fs.readFileSync(new URL("./[memoryId]/route.ts", import.meta.url), "utf8");
  assert.match(source, /updateEducationMemory/);
  assert.doesNotMatch(source, /writeFile|appendFile|safeSave|startAgent|memory_write|\.edupi\/(?:memory|output)/);
});
