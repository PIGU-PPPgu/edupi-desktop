import source from "../contracts/edupi-cloud-sync-v1.json" with { type: "json" };

export const CLOUD_SYNC_CONTRACT = Object.freeze({
  contract_id: source.contract_id,
  contract_version: source.contract_version,
  schema_hash: source.schema_hash,
});
export function assertCloudSyncContract(value: unknown): void {
  const response = value && typeof value === "object" ? value as Record<string, unknown> : null;
  const contract = response?.contract && typeof response.contract === "object"
    ? response.contract as Record<string, unknown> : null;
  if (!contract || Object.entries(CLOUD_SYNC_CONTRACT).some(([key, expected]) => contract[key] !== expected)) {
    throw Object.assign(new Error("云端同步接口版本不受支持。"), { code: "unsupported_contract" });
  }
}
