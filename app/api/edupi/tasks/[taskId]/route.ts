import { NextResponse } from "next/server";
import { parseJsonWithinLimit, RequestBodyTooLargeError } from "@/lib/bounded-form-data";
import { issueTaskBoardCommand, taskBoardContentHash, TaskBoardCommandError, type TaskBoardStage } from "@/lib/edupi-task-board-command";
import { readEducationContract } from "@/lib/edupi-education-server";
import { hasJsonContentType, isApiRequestAllowed } from "@/lib/request-security";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const MAX_BODY_BYTES = 16 * 1024;
const STAGES = new Set<TaskBoardStage>(["todo", "progress", "review", "done"]);

function record(value: unknown): Record<string, unknown> | null {
  return value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : null;
}

function taskId(value: unknown): string {
  if (typeof value !== "string" || !value.trim() || value.length > 160 || /[\u0000-\u001f\u007f]/.test(value)) throw new TaskBoardCommandError("invalid_envelope", "taskId 无效。");
  return value.trim();
}

function statusFor(code: string): number {
  if (code === "invalid_envelope") return 400;
  if (code === "task_missing") return 404;
  if (["stale_snapshot", "stale_revision", "invalid_transition", "stage_unchanged"].includes(code)) return 409;
  return 503;
}

export async function PATCH(request: Request, { params }: { params: Promise<{ taskId: string }> }) {
  if (!isApiRequestAllowed(request)) return NextResponse.json({ error: "Task stage request rejected", code: "forbidden" }, { status: 403 });
  if (!hasJsonContentType(request)) return NextResponse.json({ error: "Use application/json", code: "invalid_content_type" }, { status: 415 });
  try {
    const id = taskId((await params).taskId);
    const body = record(await parseJsonWithinLimit(request, MAX_BODY_BYTES));
    if (!body || Object.keys(body).some((key) => !["stage", "expectedRevision", "note"].includes(key))
      || typeof body.stage !== "string" || !STAGES.has(body.stage as TaskBoardStage)
      || typeof body.expectedRevision !== "number" || !Number.isInteger(body.expectedRevision) || body.expectedRevision < 0
      || (body.note !== undefined && body.note !== null && (typeof body.note !== "string" || body.note.length > 1000))) {
      throw new TaskBoardCommandError("invalid_envelope", "任务阶段字段无效。");
    }
    const stage = body.stage as TaskBoardStage;
    const note = typeof body.note === "string" ? body.note.trim() || null : null;
    const sourcePayload = { task_id: id, expected_revision: body.expectedRevision, to_stage: stage, note };
    const sourceId = `desktop-task-stage-${cryptoToken(id, body.expectedRevision, stage)}`;
    const result = await issueTaskBoardCommand({
      command_type: "move_task_stage",
      source: { source_id: sourceId, source_kind: "teacher_message", source_hash: taskBoardContentHash(sourcePayload), evidence_ids: [`evidence-${sourceId}`] },
      ...sourcePayload,
    });
    return NextResponse.json({ receipt: result.receipt, data: await readEducationContract() }, { status: 200 });
  } catch (error) {
    if (error instanceof RequestBodyTooLargeError) return NextResponse.json({ error: "Task stage request is too large", code: "too_large" }, { status: 413 });
    const code = error instanceof TaskBoardCommandError ? error.code : "unavailable";
    return NextResponse.json({ error: error instanceof TaskBoardCommandError ? error.message : "任务阶段更新暂不可用", code }, { status: statusFor(code) });
  }
}

function cryptoToken(id: string, revision: number, stage: string): string {
  return taskBoardContentHash({ id, revision, stage }).slice("sha256:".length, "sha256:".length + 24);
}
