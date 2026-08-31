import assert from "node:assert/strict";
import test from "node:test";
import { createJiti } from "jiti";

const { PATCH } = await createJiti(import.meta.url, { tsconfigPaths: true }).import("./[taskId]/route.ts");
const params = { params: Promise.resolve({ taskId: "teacher-task-1" }) };

function request(body) {
  return new Request("http://localhost/api/edupi/tasks/teacher-task-1", {
    method: "PATCH",
    headers: { host: "localhost", origin: "http://localhost", "content-type": "application/json", "sec-fetch-site": "same-origin" },
    body: typeof body === "string" ? body : JSON.stringify(body),
  });
}

test("rejects malformed, unknown, stale-shaped and unsupported task stage requests", async () => {
  for (const body of ["{", {}, { stage: "done", expectedRevision: -1 }, { stage: "deleted", expectedRevision: 0 }, { stage: "progress", expectedRevision: 0, note: "x".repeat(1001) }, { stage: "progress", expectedRevision: 0, force: true }]) {
    const response = await PATCH(request(body), params);
    assert.equal(response.status, 400);
  }
});

test("a valid task stage request reaches the Core boundary", async () => {
  const response = await PATCH(request({ stage: "progress", expectedRevision: 0, note: null }), params);
  assert.equal(response.status, 503);
  const body = await response.json();
  assert.equal(body.code, "unavailable");
});
