import assert from "node:assert/strict";
import test from "node:test";
import { createJiti } from "jiti";

const { POST } = await createJiti(import.meta.url, { tsconfigPaths: true }).import("./route.ts");

function request(body, headers = {}) {
  return new Request("http://localhost/api/edupi/intake", {
    method: "POST",
    headers: { host: "localhost", "content-type": "application/json", ...headers },
    body: JSON.stringify(body),
  });
}

test("rejects cross-site and non-JSON education intake requests", async () => {
  const crossSite = await POST(request({ kind: "calendar", events: [] }, { origin: "https://attacker.example", "sec-fetch-site": "cross-site" }));
  assert.equal(crossSite.status, 403);
  const wrongType = await POST(request({ kind: "calendar", events: [] }, { "content-type": "text/plain" }));
  assert.equal(wrongType.status, 415);
});

test("rejects unknown and unbounded intake shapes before Core dispatch", async () => {
  for (const body of [
    { kind: "calendar", events: [], secret: "no" },
    { kind: "calendar", events: [] },
    { kind: "timetable", slots: [] },
    { kind: "material", stagingId: "bad", unknown: true },
    { kind: "unknown" },
  ]) {
    const response = await POST(request(body));
    assert.equal(response.status, 400);
    assert.equal((await response.json()).code, "invalid_envelope");
  }
});
