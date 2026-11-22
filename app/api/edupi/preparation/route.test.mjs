import assert from "node:assert/strict";
import test from "node:test";
import { createJiti } from "jiti";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

const { POST } = await createJiti(import.meta.url, { tsconfigPaths: true }).import("./route.ts");
const { cloudStateTransaction } = await createJiti(import.meta.url, { tsconfigPaths: true }).import("../../../../lib/edupi-cloud-store.ts");

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

test("a stale cloud or local scope cannot start local preparation after a mode switch", async t => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "edupi-preparation-scope-"));
  const previous = process.env.PI_DESKTOP_STATE_DIR;
  process.env.PI_DESKTOP_STATE_DIR = root;
  t.after(() => {
    if (previous === undefined) delete process.env.PI_DESKTOP_STATE_DIR; else process.env.PI_DESKTOP_STATE_DIR = previous;
    fs.rmSync(root, { recursive: true, force: true });
  });
  await cloudStateTransaction(root, state => {
    state.mode = "local"; state.generation = 3;
    return { result: null, write: true };
  });
  for (const scope of [JSON.stringify(["cloud", "https://synthetic.invalid", "teacher", "workspace", 2]),
    JSON.stringify(["local", 2])]) {
    for (const body of [{ action: "run", taskId: "same-id" }, { action: "run" }, { action: "ensure" }]) {
      const response = await POST(request(body, { "x-edupi-cloud-scope": scope }));
      assert.equal(response.status, 409);
      assert.equal((await response.json()).code, "scope_changed");
    }
  }
});
