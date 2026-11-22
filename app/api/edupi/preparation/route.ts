import { NextResponse } from "next/server";
import { preparationStatus, startPreparation, ensurePreparation } from "@/lib/edupi-preparation-runtime";
import { isApiRequestAllowed, hasJsonContentType } from "@/lib/request-security";
import { parseJsonWithinLimit, RequestBodyTooLargeError } from "@/lib/bounded-form-data";
import { readEducationContract } from "@/lib/edupi-education-server";
import { EduPiCloudError } from "@/lib/edupi-cloud-client";
import { captureEducationWriteScope } from "@/lib/edupi-cloud-request-scope";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
const MAX_BODY_BYTES = 1024;
const BODY_KEYS = new Set(["action", "taskId"]);

export async function GET(request: Request) {
  const taskId = new URL(request.url).searchParams.get("taskId") || undefined;
  if (taskId && (taskId.length > 160 || /[\r\n]/.test(taskId))) return NextResponse.json({ error: "任务标识无效" }, { status: 400 });
  try { return NextResponse.json(await preparationStatus(taskId)); }
  catch (error) {
    if (error instanceof EduPiCloudError) return NextResponse.json({ state: "error", error: error.message, code: error.code }, { status: error.status });
    return NextResponse.json({ state: "error", error: "备课状态暂不可用" }, { status: 503 });
  }
}
export async function POST(request: Request) {
  if (!isApiRequestAllowed(request)) return NextResponse.json({ error: "请求无效" }, { status: 403 });
  if (!hasJsonContentType(request)) return NextResponse.json({ error: "请使用 JSON 请求" }, { status: 415 });
  try {
    const body = await parseJsonWithinLimit(request, MAX_BODY_BYTES) as { action?: string; taskId?: string } | null;
    if (!body || typeof body !== "object" || Array.isArray(body) || !["ensure", "run"].includes(body.action || "") || Object.keys(body).some((key) => !BODY_KEYS.has(key)) || (body.action === "ensure" && body.taskId !== undefined)) return NextResponse.json({ error: "操作无效" }, { status: 400 });
    if (body.taskId !== undefined && (typeof body.taskId !== "string" || !body.taskId || body.taskId.length > 160 || /[\r\n]/.test(body.taskId))) return NextResponse.json({ error: "任务标识无效" }, { status: 400 });
    const selected = await captureEducationWriteScope(request);
    if (selected.mode === "cloud") throw new EduPiCloudError("unsupported_cloud_operation", "云端事项暂不支持本地备课执行。", 409);
    if (body.action === "ensure") return NextResponse.json(await ensurePreparation());
    if (body.taskId !== undefined) {
      const data = await readEducationContract();
      const executable = data.workCases.some((item) => item.taskId === body.taskId && ["teaching_before_class", "calendar_preparation"].includes(item.kind))
        || data.tasks.some((item) => item.id === body.taskId && item.trigger === "teaching_before_class" && Boolean(item.sourceEventId && item.sourceEventDate && item.materialId && item.deliverables.length));
      if (!executable) return NextResponse.json({ error: "该任务尚不支持自动准备" }, { status: 404 });
      return NextResponse.json(await startPreparation({ taskId: body.taskId }));
    }
    return NextResponse.json(await startPreparation());
  } catch (error) {
    if (error instanceof RequestBodyTooLargeError) return NextResponse.json({ error: "请求内容过大" }, { status: 413 });
    if (error instanceof EduPiCloudError) return NextResponse.json({ state: "error", error: error.message, code: error.code }, { status: error.status });
    return NextResponse.json({ state: "error", error: error instanceof Error ? error.message : "教育工作区暂不可用" }, { status: 503 });
  }
}
