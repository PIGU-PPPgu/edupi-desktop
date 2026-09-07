import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import test from "node:test";
import { createJiti } from "jiti";

const jiti = createJiti(import.meta.url);
process.env.EDUPI_CORE_RENDEZVOUS_TEST_RESET = "1";
const rendezvous = await jiti.import("./edupi-core-rendezvous.ts");

function environment(mode = "daemon") {
  return {
    EDUPI_CORE_RELEASE_MODE: mode,
    EDUPI_CORE_ENDPOINT: "http://127.0.0.1:42001/runtime/v1",
    EDUPI_CORE_CLIENT_TOKEN: "capability-value-12345678",
    EDUPI_CORE_SUPERVISOR_SESSION: "supervisor-value-12345678",
    EDUPI_CORE_SCHEMA_HASH: `sha256:${"1".repeat(64)}`,
    EDUPI_CORE_COMMIT: "a".repeat(40),
    EDUPI_CORE_COMPONENT_MANIFEST_HASH: `sha256:${"2".repeat(64)}`,
    EDUPI_CORE_ATTESTATION: "attestation-value-12345678",
  };
}

test("captures and deletes the attested rendezvous before application startup", () => {
  rendezvous.clearEduPiCoreRendezvousForTests();
  const env = environment();
  const value = rendezvous.captureEduPiCoreRendezvous(env);
  assert.equal(value.mode, "daemon");
  assert.equal(value.endpoint, "http://127.0.0.1:42001/runtime/v1");
  assert.equal(env.EDUPI_CORE_CLIENT_TOKEN, undefined);
  assert.equal(env.EDUPI_CORE_ENDPOINT, undefined);
  assert.equal(rendezvous.getEduPiCoreRendezvous().capability_token, "capability-value-12345678");
  rendezvous.clearEduPiCoreRendezvousForTests();
});

test("ordinary Web and invalid release modes remain unavailable", () => {
  rendezvous.clearEduPiCoreRendezvousForTests();
  assert.equal(rendezvous.captureEduPiCoreRendezvous({}), null);
  assert.throws(() => rendezvous.captureEduPiCoreRendezvous({ ...environment(), EDUPI_CORE_RELEASE_MODE: "invalid" }), /unavailable|invalid/i);
  rendezvous.clearEduPiCoreRendezvousForTests();
});

test("one-shot rendezvous does not fabricate daemon-only identity", () => {
  rendezvous.clearEduPiCoreRendezvousForTests();
  const env = environment("one-shot");
  const value = rendezvous.captureEduPiCoreRendezvous(env);
  assert.equal(value.mode, "one-shot");
  assert.equal("data_root_fingerprint" in value, false);
  assert.equal(value.endpoint, "http://127.0.0.1:42001/runtime/v1");
  rendezvous.clearEduPiCoreRendezvousForTests();
});

test("rejects and scrubs a raw Core authority token", () => {
  rendezvous.clearEduPiCoreRendezvousForTests();
  const env = { ...environment(), EDUPI_CORE_TOKEN: "raw-core-authority-token" };
  assert.throws(
    () => rendezvous.captureEduPiCoreRendezvous(env),
    (error) => error?.code === "supervisor_unavailable",
  );
  assert.equal(env.EDUPI_CORE_TOKEN, undefined);
  assert.equal(env.EDUPI_CORE_CLIENT_TOKEN, undefined);
});

test("production capture is immutable and cannot be reset", () => {
  const source = `
    import { createJiti } from "jiti";
    const jiti = createJiti(import.meta.url);
    const module = await jiti.import("./lib/edupi-core-rendezvous.ts");
    module.captureEduPiCoreRendezvous({
      EDUPI_CORE_RELEASE_MODE: "daemon",
      EDUPI_CORE_ENDPOINT: "http://127.0.0.1:42001/runtime/v1",
      EDUPI_CORE_CLIENT_TOKEN: "production-capability-12345678",
      EDUPI_CORE_SUPERVISOR_SESSION: "production-session-12345678",
      EDUPI_CORE_SCHEMA_HASH: "sha256:" + "1".repeat(64),
      EDUPI_CORE_COMMIT: "a".repeat(40),
      EDUPI_CORE_COMPONENT_MANIFEST_HASH: "sha256:" + "2".repeat(64),
      EDUPI_CORE_ATTESTATION: "production-attestation-12345678"
    });
    const descriptor = Object.getOwnPropertyDescriptor(globalThis, Symbol.for("edupi.core.bridge-capability.v1"));
    let resetBlocked = false;
    try { module.clearEduPiCoreRendezvousForTests(); } catch { resetBlocked = true; }
    process.stdout.write(JSON.stringify({ configurable: descriptor.configurable, resetBlocked }));
  `;
  const environment = { ...process.env };
  delete environment.EDUPI_CORE_RENDEZVOUS_TEST_RESET;
  const result = JSON.parse(execFileSync(process.execPath, ["--input-type=module", "--eval", source], {
    cwd: process.cwd(),
    env: environment,
    encoding: "utf8",
  }));
  assert.deepEqual(result, { configurable: false, resetBlocked: true });
});
