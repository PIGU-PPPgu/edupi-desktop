import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { createJiti } from "jiti";
const jiti = createJiti(import.meta.url, { tsconfigPaths: true });
const { cloudStateTransaction } = await jiti.import("./edupi-cloud-store.ts");
const { bindEducationTaskSession } = await jiti.import("./edupi-education-server.ts");

test("a cloud task cannot create a binding in local teacher storage even when IDs coincide", async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "edupi-cloud-binding-"));
  const values = { PI_DESKTOP_STATE_DIR: root, EDUPI_CORE_ROOT: "/missing/cloud-binding-core",
    EDUPI_DATA_ROOT: "/missing/cloud-binding-data" };
  const before = Object.fromEntries(Object.keys(values).map(key => [key, process.env[key]]));
  Object.assign(process.env, values);
  try {
    await cloudStateTransaction(root, state => {
      state.mode = "cloud"; state.generation++;
      return { result: null, write: true };
    });
    await assert.rejects(bindEducationTaskSession({ taskId: "same-task-id", sessionId: "same-session-id" }),
      { code: "unsupported_cloud_operation", status: 409 });
    assert.deepEqual(fs.readdirSync(root), ["cloud"], "no local binding, Core or transcript files may be created");
  } finally {
    for (const [key, value] of Object.entries(before)) {
      if (value === undefined) delete process.env[key]; else process.env[key] = value;
    }
    fs.rmSync(root, { recursive: true, force: true });
  }
});
