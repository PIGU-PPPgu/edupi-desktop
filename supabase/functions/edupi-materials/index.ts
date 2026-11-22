import {
  ApiError,
  handleOptions,
  json,
  readJson,
  requireWorkspaceAdmin,
  respondError,
} from "../_shared/http.ts";
import { materialUploadObjectKey, safeMaterialId } from "../_shared/material-path.ts";

const MAX_BYTES = 25 * 1024 * 1024;
const BUCKET = "edupi-materials";

function text(value: unknown, max = 240): string | null {
  return typeof value === "string" && value.trim() && value.length <= max ? value.trim() : null;
}

function safeFileName(value: unknown): string | null {
  const fileName = text(value, 180);
  if (!fileName || fileName.includes("/") || fileName.includes("\\") || fileName === "." || fileName === "..") return null;
  return fileName.replace(/[^\p{L}\p{N}._ -]/gu, "_");
}

function safeHash(value: unknown): string | null {
  return typeof value === "string" && /^sha256:[a-f0-9]{64}$/u.test(value) ? value : null;
}

function safeObjectKey(value: unknown, workspaceId: string, materialId: string, fileName: string, sourceHash: string): string | null {
  if (typeof value !== "string" || value.length > 500 || value.includes("\0")) return null;
  const expected = materialUploadObjectKey(workspaceId, materialId, fileName, sourceHash);
  return expected && value === expected ? value : null;
}

async function digest(bytes: Uint8Array): Promise<string> {
  const copy = new Uint8Array(bytes.byteLength);
  copy.set(bytes);
  const hash = await crypto.subtle.digest("SHA-256", copy.buffer);
  return `sha256:${Array.from(new Uint8Array(hash), byte => byte.toString(16).padStart(2, "0")).join("")}`;
}

Deno.serve(async (request) => {
  const options = handleOptions(request);
  if (options) return options;
  try {
    if (request.method !== "POST") return json({ error: "method_not_allowed", code: "method_not_allowed" }, 405);
    const body = await readJson(request, 32 * 1024);
    const context = await requireWorkspaceAdmin(request);
    if (body.action !== "create_upload" && body.action !== "verify_upload") {
      throw new ApiError(400, "invalid_material_request", "不支持的材料操作");
    }
    const materialId = safeMaterialId(body.material_id);
    const fileName = safeFileName(body.file_name);
    const contentType = text(body.content_type, 160);
    const sizeBytes = body.size_bytes;
    const sha256 = safeHash(body.sha256);
    if (!materialId || !fileName || !contentType || !Number.isSafeInteger(sizeBytes) || Number(sizeBytes) < 1
      || Number(sizeBytes) > MAX_BYTES || !sha256 || !/^sha256:[A-Za-z0-9_-]{32,160}$/u.test(sha256)) {
      throw new ApiError(400, "invalid_material_request", "材料上传请求无效");
    }
    const objectKey = safeObjectKey(body.object_key, context.workspaceId, materialId, fileName, sha256)
      || materialUploadObjectKey(context.workspaceId, materialId, fileName, sha256);
    if (!objectKey) throw new ApiError(400, "invalid_material_request", "材料上传请求无效");
    if (body.action === "verify_upload") {
      if (!safeObjectKey(body.object_key, context.workspaceId, materialId, fileName, sha256)) {
        throw new ApiError(400, "invalid_material_request", "材料对象路径无效");
      }
      const { data: file, error: downloadError } = await context.adminClient.storage.from(BUCKET).download(objectKey);
      if (downloadError || !file) throw new ApiError(409, "material_not_uploaded", "材料二进制尚未上传");
      const bytes = new Uint8Array(await file.arrayBuffer());
      if (bytes.byteLength !== Number(sizeBytes) || await digest(bytes) !== sha256) {
        throw new ApiError(409, "material_integrity_conflict", "材料二进制与原文件不一致");
      }
      const { error: receiptError } = await context.adminDb.from("material_upload_receipts").upsert({
        workspace_id: context.workspaceId, request_id: text(body.request_id, 160) || objectKey,
        material_id: materialId, storage_bucket: BUCKET, storage_object_key: objectKey,
        source_hash: sha256, size_bytes: Number(sizeBytes), actor_id: context.user.id,
      }, { onConflict: "workspace_id,request_id" });
      if (receiptError) throw new ApiError(503, "material_receipt_unavailable", "材料核验记录暂不可用");
      return json({
        ok: true, action: "verify_upload", material_id: materialId, object_key: objectKey,
        sha256, size_bytes: Number(sizeBytes), verified: true, external_send: false,
      });
    }
    const { data, error } = await context.adminClient.storage
      .from(BUCKET)
      .createSignedUploadUrl(objectKey);
    if (error || !data?.token) throw new ApiError(503, "material_storage_unavailable", "材料上传地址暂不可用");
    return json({
      ok: true,
      action: "create_upload",
      bucket: BUCKET,
      object_key: objectKey,
      token: data.token,
      path: objectKey,
      content_type: contentType,
      size_bytes: Number(sizeBytes),
      sha256,
      external_send: false,
    });
  } catch (error) {
    return respondError(error);
  }
});
