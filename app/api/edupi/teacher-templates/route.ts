import { parseJsonWithinLimit, RequestBodyTooLargeError } from "@/lib/bounded-form-data";
import { isDesktopApiRequestAllowed } from "@/lib/desktop-api-auth";
import { resolveEduPiDataRoot } from "@/lib/edupi-core-root";
import { EduPiTeacherTemplateError, readEduPiTeacherTemplateConfig, teacherTemplateKeys, teacherTemplateTime } from "@/lib/edupi-teacher-template-config";
import { stopTeacherTemplates } from "@/lib/edupi-teacher-template-server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
const json = (value: unknown, status = 200) => Response.json(value, { status, headers: { "cache-control": "no-store" } });
const forbidden = () => json({ code: "forbidden", error: "周期材料请求被拒绝。" }, 403);
export async function GET(request: Request) {
  if (!isDesktopApiRequestAllowed(request)) return forbidden();
  try {
    const read = readEduPiTeacherTemplateConfig({ dataRoot: resolveEduPiDataRoot().root });
    return json({ version: 1, status: read.status, enabled: read.config?.enabled === true,
      scope: read.config?.binding?.scope ?? null, selectedCount: read.config?.binding?.templateIds.length ?? 0,
      updatedAt: read.config?.updatedAt ?? null });
  } catch { return json({ error: "周期材料设置暂不可用。", code: "unavailable" }, 503); }
}
export async function POST(request: Request) {
  if (!isDesktopApiRequestAllowed(request)) return forbidden();
  if (request.headers.get("content-type")?.split(";")[0].trim().toLowerCase() !== "application/json") {
    return json({ code: "invalid_content_type", error: "请使用 JSON 请求。" }, 415);
  }
  try {
    const body = await parseJsonWithinLimit(request, 2048);
    if (!teacherTemplateKeys(body, ["enabled", "expectedUpdatedAt"]) || body.enabled !== false
      || body.expectedUpdatedAt !== null && !teacherTemplateTime(body.expectedUpdatedAt)) {
      return json({ code: "invalid_input", error: "周期材料停止字段无效。" }, 400);
    }
    return json(await stopTeacherTemplates(body.expectedUpdatedAt as string | null));
  } catch (error) {
    if (error instanceof RequestBodyTooLargeError) return json({ code: "too_large", error: "请求过大。" }, 413);
    const code = error instanceof EduPiTeacherTemplateError ? error.code : "unavailable";
    return json({ code, error: code === "teacher_template_config_conflict" ? "周期材料已更新，请刷新后重试。" : "周期材料停止状态暂不可用。" },
      code === "teacher_template_config_conflict" ? 409 : 503);
  }
}
