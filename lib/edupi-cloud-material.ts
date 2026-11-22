import { createEduPiCloudClient, EduPiCloudError, type CloudScope } from "./edupi-cloud-client";
import { readCloudEducationWorkspaceBundle } from "./edupi-cloud-education";
import type { MaterialMetadataMutationReceipt, MaterialMetadataValues, MaterialMetadataVersion, MaterialMetadataVersionHistory } from "./edupi-material-metadata";

type Client = ReturnType<typeof createEduPiCloudClient>;
const record = (value: unknown): Record<string, unknown> =>
  value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : {};
const invalid = (): never => { throw new EduPiCloudError("invalid_response", "云端材料信息响应无效。", 502); };
function timestamp(value: unknown): string {
  if (typeof value !== "string" || Number.isNaN(Date.parse(value))) return invalid();
  return new Date(value).toISOString();
}
function values(value: unknown): MaterialMetadataValues {
  const source = record(value);
  if (typeof source.title !== "string" || !source.title
    || !["worksheet", "lesson_note", "assessment", "classroom_record", "other"].includes(String(source.kind))
    || source.subject !== null && typeof source.subject !== "string"
    || source.class_id !== null && typeof source.class_id !== "string") return invalid();
  return { title: source.title, kind: source.kind as MaterialMetadataValues["kind"],
    subject: source.subject as string | null, classId: source.class_id as string | null };
}
export async function readCloudMaterialHistory(client: Client, scope: CloudScope, materialId: string): Promise<MaterialMetadataVersionHistory> {
  const response = await client.operation("workspace-resources", { material_id: materialId }, scope);
  const source = record(response.materialMetadataVersions);
  if (source.material_id !== materialId || source.external_send !== false || !Number.isInteger(source.revision)
    || !Array.isArray(source.versions) || source.history_count !== source.versions.length) return invalid();
  const versions: MaterialMetadataVersion[] = source.versions.map(raw => {
    const row = record(raw);
    if (row.material_id !== materialId || typeof row.version_id !== "string" || typeof row.request_id !== "string"
      || !Number.isInteger(row.revision) || !["teacher_edit", "agent_update", "restore"].includes(String(row.source_kind))
      || !Array.isArray(row.changed_fields) || row.changed_fields.some(key => !["title", "kind", "subject", "class_id"].includes(String(key)))) return invalid();
    return { versionId: row.version_id, materialId, requestId: row.request_id, revision: Number(row.revision),
      beforeValues: values(row.before_values), afterValues: values(row.after_values),
      changedFields: row.changed_fields as MaterialMetadataVersion["changedFields"],
      changedAt: timestamp(row.changed_at), sourceKind: row.source_kind as MaterialMetadataVersion["sourceKind"] };
  });
  if (new Set(versions.map(version => version.versionId)).size !== versions.length
    || versions.some((version, index) => version.revision !== Number(source.revision) - versions.length + index + 1)) return invalid();
  return { materialId, revision: Number(source.revision), historyCount: versions.length, versions, externalSend: false };
}
export async function cloudMaterialMutationResponse(
  client: Client, scope: CloudScope, body: Record<string, unknown>, wire: Record<string, unknown>,
) {
  const materialId = String(body.material_id);
  const result: MaterialMetadataMutationReceipt = {
    requestId: String(wire.request_id), action: wire.action as "update" | "restore", materialId,
    versionId: wire.version_id === null ? null : String(wire.version_id),
    revision: Number(wire.revision), historyCount: Number(wire.history_count),
    updatedAt: timestamp(wire.updated_at), replayed: wire.replayed === true, externalSend: false,
  };
  const history = await readCloudMaterialHistory(client, scope, materialId);
  const data = (await readCloudEducationWorkspaceBundle(client, scope)).data;
  return { result, data, history };
}
