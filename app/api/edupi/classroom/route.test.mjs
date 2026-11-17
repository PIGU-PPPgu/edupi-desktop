import test from "node:test";
import assert from "node:assert/strict";
import { createJiti } from "jiti";
const jiti = createJiti(import.meta.url, { tsconfigPaths: true });
const { POST } = await jiti.import("./route.ts");
const { POST: importFile } = await jiti.import("./import/route.ts");

test("classroom routes reject cross-origin writes and imports", async () => {
  for (const handler of [POST, importFile]) {
    const response = await handler(new Request("http://localhost:30141/api/edupi/classroom", { method: "POST", headers: { origin: "https://example.org", host: "localhost:30141", "Content-Type": "application/json" }, body: "{}" }));
    assert.equal(response.status, 403);
  }
});

test("classroom route rejects unknown actions and injected bridge fields", async () => {
  for (const body of [{ domain: "grades", action: "writeFile" }, { domain: "grades", action: "list", operation: "delete" }]) {
    const response = await POST(new Request("http://localhost:30141/api/edupi/classroom", { method: "POST", headers: { origin: "http://localhost:30141", host: "localhost:30141", "Content-Type": "application/json" }, body: JSON.stringify(body) }));
    assert.equal(response.status, 400);
  }
});
