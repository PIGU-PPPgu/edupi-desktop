import assert from "node:assert/strict";
import test from "node:test";
import { createJiti } from "jiti";

const { verifyCloudMaterialUploadResult } = await createJiti(import.meta.url, { tsconfigPaths: true }).import("./edupi-cloud-material-upload-verification.ts");
const bytes = new TextEncoder().encode("material-bytes");
const sha256 = "sha256:".concat("f".repeat(64));
const body = {
  request_id: "material-request", material_id: "material-a", size_bytes: bytes.byteLength, sha256,
};
const result = {
  ok: true, operation: "material-intake", request_id: "material-request",
  object_key: "workspace-a/material-a/verified-material.pdf", upload_verified: true,
  external_send: false, response: { ok: true, operation: "command", request_id: "material-request", external_send: false },
};

test("material verifier rejects metadata-only success and requires downloaded bytes", async () => {
  await assert.rejects(verifyCloudMaterialUploadResult(body, result, "workspace-a", async () => bytes), /二进制/);
  const actualHash = `sha256:${(await import("node:crypto")).createHash("sha256").update(bytes).digest("hex")}`;
  const verified = await verifyCloudMaterialUploadResult(
    { ...body, sha256: actualHash },
    result,
    "workspace-a",
    async objectKey => {
      assert.equal(objectKey, result.object_key);
      return bytes;
    },
  );
  assert.equal(verified.verified, true);
});

test("material verifier rejects a cross-workspace object and an incomplete command response", async () => {
  await assert.rejects(verifyCloudMaterialUploadResult({ ...body, sha256: "sha256:".concat("0".repeat(64)) }, result, "workspace-a", async () => bytes));
  await assert.rejects(verifyCloudMaterialUploadResult(
    { ...body, sha256: "sha256:".concat("0".repeat(64)) },
    { ...result, response: null },
    "workspace-a",
    async () => bytes,
  ));
  await assert.rejects(verifyCloudMaterialUploadResult(
    { ...body, sha256: "sha256:".concat("0".repeat(64)) },
    { ...result, object_key: "workspace-b/material-a/object" },
    "workspace-a",
    async () => bytes,
  ));
});
