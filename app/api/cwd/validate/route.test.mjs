import assert from "node:assert/strict";
import { chmod, mkdir, mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";
import { createJiti } from "jiti";

const jiti = createJiti(import.meta.url, { tsconfigPaths: true });
const { POST } = await jiti.import("./route.ts");

function validateRequest(cwd) {
  return new Request("http://localhost/api/cwd/validate", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ cwd }),
  });
}

test("rejects a read-denied directory with a permission error, not 'does not exist'", async (t) => {
  if (process.platform === "win32") return t.skip("chmod does not restrict reads on Windows");
  const root = await mkdtemp(path.join(tmpdir(), "edupi-validate-"));
  const denied = path.join(root, "denied");
  await mkdir(denied);
  await chmod(denied, 0o000);
  try {
    const response = await POST(validateRequest(denied));
    assert.equal(response.status, 403);
    const data = await response.json();
    assert.ok(data.error.includes(denied), `message should name the denied path, got: ${data.error}`);
    assert.doesNotMatch(data.error, /does not exist|EACCES|EPERM/);
  } finally {
    await chmod(denied, 0o755);
    await rm(root, { recursive: true, force: true });
  }
});

test("accepts a readable directory", async () => {
  const root = await mkdtemp(path.join(tmpdir(), "edupi-validate-"));
  try {
    const response = await POST(validateRequest(root));
    assert.equal(response.status, 200);
    const data = await response.json();
    assert.equal(data.success, true);
    assert.equal(data.cwd, root);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("reports missing directories as before", async () => {
  const missing = path.join(tmpdir(), `edupi-missing-${Date.now()}`);
  const response = await POST(validateRequest(missing));
  assert.equal(response.status, 400);
  const data = await response.json();
  assert.match(data.error, /Directory does not exist/);
});
