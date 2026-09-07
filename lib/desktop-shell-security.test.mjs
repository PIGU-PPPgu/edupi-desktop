import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { createJiti } from "jiti";

const jiti = createJiti(import.meta.url);
const { redactDesktopSecrets, redactDesktopSpawnContext } = await jiti.import("./desktop-shell-security.ts");

test("desktop credentials never enter Agent or user bash environments", () => {
  const redacted = redactDesktopSecrets({
    PATH: "/usr/bin",
    PI_SESSION_ID: "session-a",
    PI_DESKTOP_API_TOKEN: "secret-token",
    PI_DESKTOP_INSTANCE_ID: "secret-instance",
    EDUPI_CORE_CLIENT_TOKEN: "bridge-capability",
    EDUPI_CORE_TOKEN: "core-secret",
    EDUPI_CORE_ENDPOINT: "http://127.0.0.1:1/runtime/v1",
    EDUPI_CORE_ATTESTATION: "core-attestation",
  });
  assert.equal(redacted.PATH, "/usr/bin");
  assert.equal(redacted.PI_SESSION_ID, "session-a");
  assert.equal(redacted.PI_DESKTOP_API_TOKEN, undefined);
  assert.equal(redacted.PI_DESKTOP_INSTANCE_ID, undefined);
  assert.equal(redacted.EDUPI_CORE_CLIENT_TOKEN, undefined);
  assert.equal(redacted.EDUPI_CORE_TOKEN, undefined);
  assert.equal(redacted.EDUPI_CORE_ENDPOINT, undefined);
  assert.equal(redacted.EDUPI_CORE_ATTESTATION, undefined);
});

test("bash spawn hook preserves command and cwd while replacing the environment", () => {
  const result = redactDesktopSpawnContext({
    command: "pwd",
    cwd: "/tmp/workspace",
    env: { SAFE: "yes", PI_DESKTOP_API_TOKEN: "secret" },
  });
  assert.deepEqual(result, { command: "pwd", cwd: "/tmp/workspace", env: { SAFE: "yes" } });
});

test("rpc manager applies redaction to model bash and explicit user bash", async () => {
  const source = await readFile(new URL("./rpc-manager.ts", import.meta.url), "utf8");
  assert.match(source, /createBashToolDefinition\(sessionCwd, \{[^\n]*spawnHook: redactDesktopSpawnContext[^\n]*\}\)/);
  assert.match(source, /operations: createDesktopSafeBashOperations/);
});
