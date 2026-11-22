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

function text(value: unknown, max = 240): string | null {
  return typeof value === "string" && value.trim() && value.length <= max ? value.trim() : null;
}

function safeFileName(value: unknown): string | null {
  const fileName = text(value, 180);
  if (!fileName || fileName.includes("/") || fileName.includes("\\") || fileName === "." || fileName === "..") return null;
  return fileName.replace(/[^\p{L}\p{N}._ -]/gu, "_");
}

Deno.serve(async (request) => {
  const options = handleOptions(request);
  if (options) return options;
  try {
    if (request.method !== "POST") return json({ error: "method_not_allowed", code: "method_not_allowed" }, 405);
    const body = await readJson(request, 32 * 1024);
    const context = await requireWorkspaceAdmin(request);
    if (body.action !== "create_upload") throw new ApiError(400, "invalid_material_request", "不支持的材料操作");
    const materialId = safeMaterialId(body.material_id);
    const fileName = safeFileName(body.file_name);
    const contentType = text(body.content_type, 160);
    const sizeBytes = body.size_bytes;
    const sha256 = text(body.sha256, 160);
    if (!materialId || !fileName || !contentType || !Number.isSafeInteger(sizeBytes) || Number(sizeBytes) < 1
      || Number(sizeBytes) > MAX_BYTES || !sha256 || !/^sha256:[A-Za-z0-9_-]{32,160}$/u.test(sha256)) {
      throw new ApiError(400, "invalid_material_request", "材料上传请求无效");
    }
    const objectKey = materialUploadObjectKey(context.workspaceId, materialId, fileName);
    if (!objectKey) throw new ApiError(400, "invalid_material_request", "材料上传请求无效");
    const { data, error } = await context.adminClient.storage
      .from("edupi-materials")
      .createSignedUploadUrl(objectKey);
    if (error || !data?.token) throw new ApiError(503, "material_storage_unavailable", "材料上传地址暂不可用");
    return json({
      ok: true,
      action: "create_upload",
      bucket: "edupi-materials",
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
