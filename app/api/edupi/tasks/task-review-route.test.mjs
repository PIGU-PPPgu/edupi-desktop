import assert from "node:assert/strict";
import fs from "node:fs";
import test from "node:test";
import { createJiti } from "jiti";

const { POST } = await createJiti(import.meta.url, { tsconfigPaths: true }).import("./[taskId]/review/route.ts");
const params = { params: Promise.resolve({ taskId: "task-1" }) };

function request(body, headers = {}) {
  return new Request("http://localhost/api/edupi/tasks/task-1/review", {
    method: "POST",
    headers: { host: "localhost", origin: "http://localhost", "content-type": "application/json", "sec-fetch-site": "same-origin", ...headers },
    body: typeof body === "string" ? body : JSON.stringify(body),
  });
}

test("rejects cross-site, non-JSON, malformed, unknown and invalid task review input", async () => {
  assert.equal((await POST(request({ decision: "accept" }, { origin: "http://evil.test", "sec-fetch-site": "cross-site" }), params)).status, 403);
  assert.equal((await POST(request({ decision: "accept" }, { "content-type": "text/plain" }), params)).status, 415);
  for (const body of [
    "{",
    {},
    { decision: "accept" },
    { decision: "accept", expectedRevision: -1 },
    { decision: "approve" },
    { decision: "accept", admin: true },
    { decision: "accept", patch: {} },
    { decision: "modify", patch: null },
    { decision: "modify", patch: { dueDate: "2026-02-31" } },
    { decision: "modify", patch: { deliverables: [""] } },
    { decision: "hold", note: "x".repeat(1001) },
  ]) assert.equal((await POST(request(body), params)).status, 400);
});

test("a valid camelCase task review reaches the Core boundary", async () => {
  const response = await POST(request({ decision: "modify", expectedRevision: 0, patch: { title: "新标题", dueDate: "2026-09-02", deliverables: ["周计划"] }, note: "调整" }), params);
  assert.equal(response.status, 503);
  const body = await response.json();
  assert.ok(["unsupported_command", "unavailable"].includes(body.code));
});

test("route is a bounded receipt-only Core adapter", () => {
  const source = fs.readFileSync(new URL("./[taskId]/review/route.ts", import.meta.url), "utf8");
  assert.match(source, /reviewEducationTask/);
  assert.doesNotMatch(source, /writeFile|appendFile|safeSave|teacher_task_review|\.edupi\/(?:memory|output)/);
});
