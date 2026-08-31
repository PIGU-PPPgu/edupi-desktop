import crypto from "node:crypto";
import { NextResponse } from "next/server";
import { parseJsonWithinLimit, RequestBodyTooLargeError } from "@/lib/bounded-form-data";
import { issueTaskBoardCommand, taskBoardContentHash, TaskBoardCommandError } from "@/lib/edupi-task-board-command";
import { readEducationContract } from "@/lib/edupi-education-server";
import { hasJsonContentType, isApiRequestAllowed } from "@/lib/request-security";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const MAX_BODY_BYTES = 32 * 1024;
const BODY_KEYS = new Set(["title", "dueDate", "note"]);

function record(value: unknown): Record<string, unknown> | null {
  return value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : null;
}

function dateOnly(value: unknown): string | null {
  if (value === undefined || value === null || value === "") return null;
  if (typeof value !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(value)) throw new TaskBoardCommandError("invalid_envelope", "截止日期无效。");
  const date = new Date(`${value}T00:00:00.000Z`);
  if (Number.isNaN(date.valueOf()) || date.toISOString().slice(0, 10) !== value) throw new TaskBoardCommandError("invalid_envelope", "截止日期无效。");
  return value;
}

function note(value: unknown): string | null {
  if (value === undefined || value === null || value === "") return null;
  if (typeof value !== "string" || value.length > 1000) throw new TaskBoardCommandError("invalid_envelope", "任务备注无效。");
  return value.trim() || null;
}

function statusFor(code: string): number {
  if (code === "invalid_envelope") return 400;
  if (["stale_snapshot", "stale_revision", "task_conflict", "invalid_transition", "stage_unchanged"].includes(code)) return 409;
  return 503;
}

export async function POST(request: Request) {
  if (!isApiRequestAllowed(request)) return NextResponse.json({ error: "Task creation request rejected", code: "forbidden" }, { status: 403 });
  if (!hasJsonContentType(request)) return NextResponse.json({ error: "Use application/json", code: "invalid_content_type" }, { status: 415 });
  try {
    const body = record(await parseJsonWithinLimit(request, MAX_BODY_BYTES));
    if (!body || Object.keys(body).some((key) => !BODY_KEYS.has(key)) || typeof body.title !== "string" || !body.title.trim() || body.title.length > 240) {
      throw new TaskBoardCommandError("invalid_envelope", "任务字段无效。");
    }
    const taskId = `teacher-task-${crypto.randomUUID()}`;
    const task = { task_id: taskId, title: body.title.trim(), due_date: dateOnly(body.dueDate), note: note(body.note) };
    const sourceId = `desktop-task-create-${taskId.slice("teacher-task-".length)}`;
    const result = await issueTaskBoardCommand({
      command_type: "create_task",
      source: { source_id: sourceId, source_kind: "teacher_message", source_hash: taskBoardContentHash(task), evidence_ids: [`evidence-${sourceId}`] },
      task,
    });
    return NextResponse.json({ receipt: result.receipt, data: await readEducationContract() }, { status: 200 });
  } catch (error) {
    if (error instanceof RequestBodyTooLargeError) return NextResponse.json({ error: "Task request is too large", code: "too_large" }, { status: 413 });
    const code = error instanceof TaskBoardCommandError ? error.code : "unavailable";
    return NextResponse.json({ error: error instanceof TaskBoardCommandError ? error.message : "任务创建暂不可用", code }, { status: statusFor(code) });
  }
}
