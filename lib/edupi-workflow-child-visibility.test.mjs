import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { createJiti } from "jiti";

test("private workflow child never appears in live chats or running ids", async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "edupi-private-child-"));
  const cwd = path.join(root, "workspace"), child = path.join(root, "child-sessions"), agentDir = path.join(root, "agent");
  for (const directory of [cwd, child, agentDir]) fs.mkdirSync(directory, { mode: 0o700 });
  process.env.PI_CODING_AGENT_DIR = agentDir;
  process.env.PI_DESKTOP_STATE_DIR = root;
  let session;
  try {
    const { startRpcSession, getLiveSessionSnapshots, getRunningRpcSessionIds } = await createJiti(import.meta.url, { tsconfigPaths: true }).import("./rpc-manager.ts");
    ({ session } = await startRpcSession(`private-child-${Date.now()}`, "", cwd, {
      toolNames: ["read", "find", "grep", "ls"], strictToolNames: true, isolatedSessionDir: child,
    }));
    await session.waitUntilReady();
    session.inner.sessionManager.appendMessage({ role: "user", content: "synthetic private task", timestamp: Date.now() });
    assert.equal(session.getLiveSnapshot(), null);
    assert.deepEqual(getLiveSessionSnapshots(new Set()), []);
    session.isRunning = () => true;
    assert.deepEqual(getRunningRpcSessionIds(), []);
  } finally {
    session?.destroy();
    fs.rmSync(root, { recursive: true, force: true });
  }
});
