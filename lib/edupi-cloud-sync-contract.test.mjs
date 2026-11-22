import assert from "node:assert/strict";
import fs from "node:fs";
import { createHash } from "node:crypto";
import test from "node:test";
import { createJiti } from "jiti";
const { CLOUD_SYNC_CONTRACT, assertCloudSyncContract } = await createJiti(import.meta.url).import("./edupi-cloud-sync-contract.ts");
const canonical = value => Array.isArray(value) ? value.map(canonical) : value && typeof value === "object"
  ? Object.fromEntries(Object.keys(value).sort().map(key => [key, canonical(value[key])])) : value;
test("new sync identity binds the complete published operation contract", () => {
  const source = JSON.parse(fs.readFileSync(new URL("../contracts/edupi-cloud-sync-v1.json", import.meta.url)));
  const { schema_hash, ...body } = source;
  assert.equal(schema_hash, `sha256:${createHash("sha256").update(JSON.stringify(canonical(body))).digest("hex")}`);
  assertCloudSyncContract({ contract: CLOUD_SYNC_CONTRACT });
  for (const field of ["contract_id", "contract_version", "schema_hash"]) {
    assert.throws(() => assertCloudSyncContract({ contract: { ...CLOUD_SYNC_CONTRACT, [field]: "unknown" } }),
      { code: "unsupported_contract" });
  }
});
