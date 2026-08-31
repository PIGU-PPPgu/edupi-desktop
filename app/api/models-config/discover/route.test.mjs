import assert from "node:assert/strict";
import test from "node:test";
import { createJiti } from "jiti";

const { POST } = await createJiti(import.meta.url, { tsconfigPaths: true }).import("./route.ts");

function request(headers = {}) {
  return new Request("http://localhost/api/models-config/discover", {
    method: "POST",
    headers: { host: "localhost", "content-type": "application/json", ...headers },
    body: JSON.stringify({}),
  });
}

test("model discovery rejects cross-site and non-JSON credential requests", async () => {
  const crossSite = await POST(request({ origin: "https://attacker.example", "sec-fetch-site": "cross-site" }));
  assert.equal(crossSite.status, 403);

  const wrongType = await POST(request({ "content-type": "text/plain" }));
  assert.equal(wrongType.status, 415);
});
