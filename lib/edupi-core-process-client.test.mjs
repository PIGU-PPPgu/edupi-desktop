import assert from "node:assert/strict";
import fs from "node:fs";
import http from "node:http";
import test from "node:test";
import { createJiti } from "jiti";

process.env.EDUPI_CORE_RENDEZVOUS_TEST_RESET = "1";
const jiti = createJiti(import.meta.url);
const { callEduPiCore, runCoreProcess } = await jiti.import("./edupi-core-process-client.ts");
const rendezvousModule = await jiti.import("./edupi-core-rendezvous.ts");

const schemaHash = `sha256:${"1".repeat(64)}`;
const manifestHash = `sha256:${"2".repeat(64)}`;
const coreCommit = "a".repeat(40);
const runtime = { coreCommit, componentManifestHash: manifestHash };
const dataRoot = { root: "/validated/data" };

function installRendezvous(port, { mode = "daemon", token = "bridge-capability-12345678" } = {}) {
  rendezvousModule.captureEduPiCoreRendezvous({
    EDUPI_CORE_RELEASE_MODE: mode,
    EDUPI_CORE_ENDPOINT: `http://127.0.0.1:${port}/runtime/v1`,
    EDUPI_CORE_CLIENT_TOKEN: token,
    EDUPI_CORE_SUPERVISOR_SESSION: "supervisor-client-12345678",
    EDUPI_CORE_SCHEMA_HASH: schemaHash,
    EDUPI_CORE_COMMIT: coreCommit,
    EDUPI_CORE_COMPONENT_MANIFEST_HASH: manifestHash,
    EDUPI_CORE_ATTESTATION: "attestation-client-12345678",
  });
}

function runtimeSuccess(outer, bridge = { ok: true, operation: "health", request_id: outer.request_id }) {
  return {
    protocol: "edupi-core-runtime",
    protocol_version: 1,
    schema_hash: schemaHash,
    request_id: outer.request_id,
    operation: outer.operation,
    ok: true,
    external_send: false,
    result: { bridge_contract_version: "1.1", bridge_frame: `${JSON.stringify(bridge)}\n` },
    error_code: null,
  };
}

async function createBroker(handler) {
  const server = http.createServer(handler);
  await new Promise((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", resolve);
  });
  return {
    port: server.address().port,
    close: () => new Promise((resolve) => server.close(resolve)),
  };
}

async function readRequest(request) {
  const chunks = [];
  for await (const chunk of request) chunks.push(chunk);
  return JSON.parse(Buffer.concat(chunks).toString("utf8"));
}

test("ordinary Web fails visibly without a supervised bridge capability", async () => {
  rendezvousModule.clearEduPiCoreRendezvousForTests();
  await assert.rejects(
    callEduPiCore({ operation: "health", requestId: "no-supervisor", runtime, dataRoot }),
    (error) => error?.code === "supervisor_unavailable",
  );
});

test("daemon and one-shot modes both use the narrow broker without raw Core authority", async () => {
  for (const mode of ["daemon", "one-shot"]) {
    rendezvousModule.clearEduPiCoreRendezvousForTests();
    const token = `capability-${mode}-12345678`;
    const observed = [];
    const broker = await createBroker(async (request, response) => {
      assert.equal(request.headers.authorization, `Bearer ${token}`);
      const outer = await readRequest(request);
      observed.push(outer);
      const body = JSON.stringify(runtimeSuccess(outer));
      response.writeHead(200, { "content-type": "application/json", "content-length": Buffer.byteLength(body) });
      response.end(body);
    });
    try {
      installRendezvous(broker.port, { mode, token });
      const health = await callEduPiCore({ operation: "health", requestId: `${mode}-health`, runtime, dataRoot });
      assert.equal(health.ok, true);
      await runCoreProcess({
        runtime,
        dataRoot,
        timeoutMs: 5_000,
        request: {
          protocol: "edupi-desktop-bridge",
          protocol_version: 1,
          producer: "edupi-desktop",
          operation: "students",
          request_id: `${mode}-students`,
          action: "import",
          students: [{ name: "保留字段", traits: [], parent_notes: [] }],
        },
      });
      assert.equal(observed[0].operation, "bridge_read");
      assert.equal(observed[1].operation, "bridge_call");
      assert.deepEqual(JSON.parse(observed[1].payload.bridge_frame).students, [{ name: "保留字段", traits: [], parent_notes: [] }]);
      assert.equal("EDUPI_CORE_TOKEN" in process.env, false);
    } finally {
      rendezvousModule.clearEduPiCoreRendezvousForTests();
      await broker.close();
    }
  }
});

test("pin mismatch and oversized inner requests reject before contacting the broker", async () => {
  rendezvousModule.clearEduPiCoreRendezvousForTests();
  let calls = 0;
  const broker = await createBroker((_request, response) => {
    calls += 1;
    response.writeHead(500).end();
  });
  try {
    installRendezvous(broker.port);
    await assert.rejects(
      callEduPiCore({ operation: "health", requestId: "pin-mismatch", runtime: { ...runtime, coreCommit: "b".repeat(40) }, dataRoot }),
      (error) => error?.code === "runtime_identity",
    );
    await assert.rejects(
      runCoreProcess({ runtime, dataRoot, request: { operation: "health", padding: "x".repeat(256 * 1024) }, timeoutMs: 1_000 }),
      (error) => error?.code === "request_limit",
    );
    assert.equal(calls, 0);
  } finally {
    rendezvousModule.clearEduPiCoreRendezvousForTests();
    await broker.close();
  }
});

test("strictly rejects malformed envelopes, extra frames, content-length drift, and invalid UTF-8", async () => {
  for (const behavior of ["extra-key", "extra-frame", "length", "utf8"]) {
    rendezvousModule.clearEduPiCoreRendezvousForTests();
    const broker = await createBroker(async (request, response) => {
      const outer = await readRequest(request);
      if (behavior === "utf8") {
        response.writeHead(200, { "content-type": "application/json", "content-length": "2" });
        response.end(Buffer.from([0xc3, 0x28]));
        return;
      }
      const value = runtimeSuccess(outer);
      if (behavior === "extra-key") value.extra = true;
      if (behavior === "extra-frame") value.result.bridge_frame += "{}\n";
      const body = JSON.stringify(value);
      response.writeHead(200, {
        "content-type": "application/json",
        "content-length": behavior === "length" ? String(Buffer.byteLength(body) + 1) : String(Buffer.byteLength(body)),
      });
      response.end(body);
    });
    try {
      installRendezvous(broker.port);
      await assert.rejects(
        callEduPiCore({ operation: "health", requestId: `invalid-${behavior}`, runtime, dataRoot }),
        (error) => ["runtime_identity", "bridge_response", "content_length", "runtime_utf8"].includes(error?.code),
      );
    } finally {
      rendezvousModule.clearEduPiCoreRendezvousForTests();
      await broker.close();
    }
  }
});

test("timeout and caller abort never fall back to a local writer", async () => {
  rendezvousModule.clearEduPiCoreRendezvousForTests();
  const broker = await createBroker(() => {});
  try {
    installRendezvous(broker.port);
    await assert.rejects(
      runCoreProcess({
        runtime,
        dataRoot,
        request: { protocol: "edupi-desktop-bridge", protocol_version: 1, producer: "edupi-desktop", operation: "health", request_id: "timeout" },
        timeoutMs: 25,
      }),
      (error) => error?.code === "timeout",
    );
    const controller = new AbortController();
    controller.abort();
    await assert.rejects(
      callEduPiCore({ operation: "health", requestId: "aborted", runtime, dataRoot, signal: controller.signal }),
      (error) => error?.code === "aborted",
    );
  } finally {
    rendezvousModule.clearEduPiCoreRendezvousForTests();
    await broker.close();
  }
});

test("source contains no Core-token or child-process writer path", () => {
  const source = fs.readFileSync(new URL("./edupi-core-process-client.ts", import.meta.url), "utf8");
  assert.doesNotMatch(source, /EDUPI_CORE_TOKEN|node:child_process|\bspawn\s*\(|process\.execPath|shell:\s*false/);
  assert.match(source, /capability_token/);
  assert.match(source, /redirect:\s*"error"/);
  assert.match(source, /MAX_OUTER_REQUEST_BYTES|MAX_OUTER_RESPONSE_BYTES/);
});
