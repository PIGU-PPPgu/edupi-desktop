import { createHash } from "node:crypto";

type RecordValue = Record<string, unknown>;
export type MaterialBinaryDownload = (objectKey: string) => Promise<Uint8Array>;

function record(value: unknown): RecordValue | null {
  return value && typeof value === "object" && !Array.isArray(value) ? value as RecordValue : null;
}

function fail(message: string): never {
  throw new Error(message);
}

export async function verifyCloudMaterialUploadResult(
  body: RecordValue,
  result: RecordValue,
  workspaceId: string,
  download: MaterialBinaryDownload,
): Promise<{ objectKey: string; sha256: string; sizeBytes: number; verified: true }> {
  const objectKey = typeof result.object_key === "string" ? result.object_key : null;
  const sha256 = typeof body.sha256 === "string" ? body.sha256 : null;
  const sizeBytes = body.size_bytes;
  if (result.ok !== true || result.operation !== "material-intake" || result.external_send !== false
    || result.request_id !== body.request_id || result.upload_verified !== true
    || !objectKey || !objectKey.startsWith(`${workspaceId}/${String(body.material_id)}/`)
    || objectKey.includes("..") || !sha256 || !/^sha256:[a-f0-9]{64}$/u.test(sha256)
    || !Number.isSafeInteger(sizeBytes) || Number(sizeBytes) < 1 || Number(sizeBytes) > 25 * 1024 * 1024) {
    return fail("云端材料上传回执无效");
  }
  const commandResponse = record(result.response);
  if (!commandResponse || commandResponse.ok !== true || commandResponse.operation !== "command"
    || commandResponse.request_id !== body.request_id || commandResponse.external_send !== false) {
    return fail("云端材料接入回执无效");
  }
  const bytes = await download(objectKey);
  const actualHash = `sha256:${createHash("sha256").update(bytes).digest("hex")}`;
  if (bytes.byteLength !== sizeBytes || actualHash !== sha256) {
    return fail("云端材料二进制与原文件不一致");
  }
  return { objectKey, sha256, sizeBytes, verified: true };
}
