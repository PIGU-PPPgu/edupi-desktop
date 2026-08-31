import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { mkdtemp, readFile, rm, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, relative } from "node:path";
import test from "node:test";
import { createJiti } from "jiti";

const jiti = createJiti(import.meta.url);
const { bindTaskSessionFile, readTaskSessionFile } = await jiti.import("./edupi-task-session-store.ts");
const { taskSessionFile } = await jiti.import("./edupi-education-server.ts");

test("task-session bindings use a deterministic Desktop/Pi-agent path per data root", async () => {
  const root = await mkdtemp(join(tmpdir(), "edupi-task-session-path-"));
  const agentDir = join(root, "agent");
  const dataRoot = join(root, "teacher-a");
  const otherDataRoot = join(root, "teacher-b");
  const previousAgentDir = process.env.PI_CODING_AGENT_DIR;
  process.env.PI_CODING_AGENT_DIR = agentDir;
  try {
    const file = taskSessionFile(dataRoot);
    const rootHash = createHash("sha256").update(dataRoot).digest("hex");
    assert.equal(file, join(agentDir, "edupi-desktop", "task-session-bindings", `${rootHash}.json`));
    assert.equal(file, taskSessionFile(dataRoot));
    assert.notEqual(file, taskSessionFile(otherDataRoot));
    assert.ok(relative(dataRoot, file).startsWith(".."));
    assert.equal(file.startsWith(join(agentDir, "edupi-desktop", "task-session-bindings")), true);

    await bindTaskSessionFile(file, {
      taskId: "task-a",
      sessionId: "session-a",
      now: "2026-08-24T00:00:00.000Z",
    });
    const storedText = await readFile(file, "utf8");
    assert.equal(storedText.includes(dataRoot), false);
    assert.deepEqual(JSON.parse(storedText), {
      schema_version: 1,
      bindings: [{ task_id: "task-a", session_id: "session-a", bound_at: "2026-08-24T00:00:00.000Z" }],
      updated_at: "2026-08-24T00:00:00.000Z",
    });
    await bindTaskSessionFile(file, {
      taskId: "task-a",
      sessionId: "session-b",
      now: "2026-08-24T00:00:01.000Z",
    });
    assert.deepEqual((await readTaskSessionFile(file)).bindings, [{
      task_id: "task-a",
      session_id: "session-b",
      bound_at: "2026-08-24T00:00:01.000Z",
    }]);
  } finally {
    if (previousAgentDir === undefined) delete process.env.PI_CODING_AGENT_DIR;
    else process.env.PI_CODING_AGENT_DIR = previousAgentDir;
    await rm(root, { recursive: true, force: true });
  }
});

test("task-session store persists atomically with owner-only permissions", async () => {
  const root = await mkdtemp(join(tmpdir(), "edupi-task-session-store-"));
  const file = join(root, "nested", "task_sessions.json");
  try {
    assert.deepEqual(await readTaskSessionFile(file), { schema_version: 1, bindings: [] });
    await bindTaskSessionFile(file, {
      taskId: "task-a",
      sessionId: "session-a",
      now: "2026-08-24T00:00:00.000Z",
    });
    const parsed = JSON.parse(await readFile(file, "utf8"));
    assert.deepEqual(parsed.bindings, [{ task_id: "task-a", session_id: "session-a", bound_at: "2026-08-24T00:00:00.000Z" }]);
    if (process.platform !== "win32") assert.equal((await stat(file)).mode & 0o777, 0o600);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("concurrent binds serialize without losing either task", async () => {
  const root = await mkdtemp(join(tmpdir(), "edupi-task-session-race-"));
  const file = join(root, "task_sessions.json");
  try {
    await Promise.all([
      bindTaskSessionFile(file, { taskId: "task-a", sessionId: "session-a", now: "2026-08-24T00:00:00.000Z" }),
      bindTaskSessionFile(file, { taskId: "task-b", sessionId: "session-b", now: "2026-08-24T00:00:01.000Z" }),
    ]);
    const stored = await readTaskSessionFile(file);
    assert.deepEqual(stored.bindings.map((binding) => binding.task_id).sort(), ["task-a", "task-b"]);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("a structurally corrupted binding index is never silently overwritten", async () => {
  const root = await mkdtemp(join(tmpdir(), "edupi-task-session-corrupt-"));
  const file = join(root, "task_sessions.json");
  const corrupted = '{"schema_version":1,"bindings":[{"task_id":"task-a"}]}\n';
  try {
    await writeFile(file, corrupted, { mode: 0o600 });
    await assert.rejects(() => bindTaskSessionFile(file, { taskId: "task-b", sessionId: "session-b" }), /索引损坏/);
    assert.equal(await readFile(file, "utf8"), corrupted);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
