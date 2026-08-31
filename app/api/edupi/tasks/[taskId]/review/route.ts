import { NextResponse } from "next/server";
import { parseJsonWithinLimit, RequestBodyTooLargeError } from "@/lib/bounded-form-data";
import { reviewEducationTask } from "@/lib/edupi-education-server";
import { TASK_REVIEW_DECISIONS, TaskReviewError, type TaskReviewDecision, type TaskReviewPatch } from "@/lib/edupi-task-review";
import { hasJsonContentType, isApiRequestAllowed } from "@/lib/request-security";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const MAX_BODY_BYTES = 16 * 1024;
const BODY_KEYS = new Set(["decision", "expectedRevision", "patch", "note"]);

function record(value: unknown): Record<string, unknown> | null {
  return value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : null;
}

function validDate(value: unknown): boolean {
  if (value === null) return true;
  if (typeof value !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const date = new Date(`${value}T00:00:00.000Z`);
  return !Number.isNaN(date.valueOf()) && date.toISOString().slice(0, 10) === value;
}

function validPatch(value: unknown, decision: TaskReviewDecision): value is TaskReviewPatch | null | undefined {
  if (decision !== "modify") return value === undefined || value === null;
  const patch = record(value);
  if (!patch) return false;
  const keys = Object.keys(patch);
  if (keys.length === 0 || keys.some((key) => !["title", "dueDate", "deliverables"].includes(key))) return false;
  if (Object.hasOwn(patch, "title") && (typeof patch.title !== "string" || !patch.title.trim() || patch.title.length > 240)) return false;
  if (Object.hasOwn(patch, "dueDate") && !validDate(patch.dueDate)) return false;
  return !Object.hasOwn(patch, "deliverables") || Array.isArray(patch.deliverables)
    && patch.deliverables.length <= 50
    && patch.deliverables.every((item) => typeof item === "string" && Boolean(item.trim()) && item.length <= 240);
}

function statusFor(code: string): number {
  if (code === "invalid_envelope") return 400;
  if (code === "task_missing") return 404;
  if (["stale_snapshot", "stale_revision", "task_owned_by_work_review"].includes(code)) return 409;
  return 503;
}

export async function POST(request: Request, { params }: { params: Promise<{ taskId: string }> }) {
  if (!isApiRequestAllowed(request)) return NextResponse.json({ error: "Task review request rejected", code: "forbidden" }, { status: 403 });
  if (!hasJsonContentType(request)) return NextResponse.json({ error: "Use application/json", code: "invalid_content_type" }, { status: 415 });
  try {
    const taskId = (await params).taskId;
    if (typeof taskId !== "string" || !taskId.trim() || taskId.length > 160 || /[\u0000-\u001f\u007f]/.test(taskId)) throw new TaskReviewError("invalid_envelope", "taskId 无效。");
    const body = record(await parseJsonWithinLimit(request, MAX_BODY_BYTES));
    if (!body || Object.keys(body).some((key) => !BODY_KEYS.has(key))) throw new TaskReviewError("invalid_envelope", "任务审核字段无效。");
    const decision = body.decision as TaskReviewDecision;
    if (!Number.isInteger(body.expectedRevision) || Number(body.expectedRevision) < 0
      || !TASK_REVIEW_DECISIONS.includes(decision) || !validPatch(body.patch, decision)
      || (body.note !== undefined && body.note !== null && (typeof body.note !== "string" || body.note.length > 1000))) {
      throw new TaskReviewError("invalid_envelope", "任务审核字段无效。");
    }
    const result = await reviewEducationTask({
      taskId: taskId.trim(),
      expectedRevision: Number(body.expectedRevision),
      decision,
      patch: body.patch as TaskReviewPatch | null | undefined,
      note: typeof body.note === "string" ? body.note.trim() || null : null,
      reviewerId: "teacher",
    });
    return NextResponse.json({ receipt: result.receipt, data: result.data }, { status: 200 });
  } catch (error) {
    if (error instanceof RequestBodyTooLargeError) return NextResponse.json({ error: "Task review request is too large", code: "too_large" }, { status: 413 });
    const code = error instanceof TaskReviewError ? error.code : "unavailable";
    return NextResponse.json({ error: error instanceof TaskReviewError ? error.message : "任务审核暂不可用", code }, { status: statusFor(code) });
  }
}
