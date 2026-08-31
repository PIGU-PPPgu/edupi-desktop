import { NextResponse } from "next/server";
import { EduPiSnapshotError } from "@/lib/edupi-core-snapshot";
import { reviewTeacherContextCandidate } from "@/lib/edupi-education-server";
import { TeacherContextReviewError, TEACHER_CONTEXT_REVIEW_DECISIONS, type TeacherContextReviewDecision } from "@/lib/edupi-teacher-context-review";
import { readTeacherContext } from "@/lib/edupi-onboarding-server";

export const dynamic = "force-dynamic";

export async function GET() {
  try {
    return NextResponse.json(await readTeacherContext());
  } catch {
    return NextResponse.json({ error: "教育上下文暂不可用", reason: "Core v1.1 education_workspace 快照不可用。" }, { status: 503 });
  }
}

type RawRecord = Record<string, unknown>;
const PUT_KEYS = new Set(["targetId", "expectedSnapshotId", "expectedRevision", "decision", "patch", "note", "reviewerId", "reviewer", "issuedAt"]);
const CONTEXT_FIELDS = new Set(["name", "role", "subject", "grade", "class_name"]);

function record(value: unknown): RawRecord | null {
  return value && typeof value === "object" && !Array.isArray(value) ? value as RawRecord : null;
}

function bodyError(reason: string): NextResponse {
  return NextResponse.json({ error: "invalid_teacher_context_review", code: "invalid_envelope", reason }, { status: 400 });
}

function errorCode(error: unknown): string {
  if (error instanceof TeacherContextReviewError) return error.code;
  if (error instanceof EduPiSnapshotError && error.code === "stale_snapshot") return "stale_snapshot";
  return "unavailable";
}

function errorStatus(code: string): number {
  return {
    invalid_envelope: 400,
    stale_snapshot: 409,
    stale_revision: 409,
    unsupported_command: 503,
    unavailable: 503,
  }[code] || 503;
}

function errorReason(code: string): string {
  if (code === "stale_snapshot") return "Core 教育快照已变化，请刷新后重试。";
  if (code === "stale_revision") return "教师上下文提案已更新，请刷新后重试。";
  if (code === "unsupported_command") return "Core 尚未启用教师上下文审核。";
  if (code === "invalid_envelope") return "教师上下文审核请求或 Core 回执无效。";
  return "教师上下文审核暂不可用。";
}

export async function PUT(request: Request) {
  let body: RawRecord | null;
  try {
    body = record(await request.json());
  } catch {
    return bodyError("请求必须是有效的 JSON 对象。");
  }
  if (!body) return bodyError("请求必须是有效的 JSON 对象。");
  const unknown = Object.keys(body).find((key) => !PUT_KEYS.has(key));
  if (unknown) return bodyError(`不支持的字段：${unknown}`);

  const targetId = body.targetId;
  const expectedSnapshotId = body.expectedSnapshotId;
  if (typeof targetId !== "string" || !targetId.trim() || targetId.length > 160) return bodyError("targetId 无效。");
  if (typeof expectedSnapshotId !== "string" || !expectedSnapshotId.trim() || expectedSnapshotId.length > 160) return bodyError("expectedSnapshotId 无效。");
  if (typeof body.expectedRevision !== "number" || !Number.isInteger(body.expectedRevision) || body.expectedRevision < 0) return bodyError("expectedRevision 无效。");
  if (!TEACHER_CONTEXT_REVIEW_DECISIONS.includes(body.decision as TeacherContextReviewDecision)) return bodyError("decision 仅支持 accept、modify、reject、hold。");
  if (body.patch !== undefined && body.patch !== null) {
    const patch = record(body.patch);
    if (!patch) return bodyError("patch 无效。");
    const unknownPatch = Object.keys(patch).find((key) => !CONTEXT_FIELDS.has(key));
    if (unknownPatch) return bodyError(`不支持的 patch 字段：${unknownPatch}`);
    for (const [key, value] of Object.entries(patch)) {
      if (typeof value !== "string" || !value.trim() || value.length > 120) return bodyError(`patch.${key} 无效。`);
    }
  }
  if (body.note !== undefined && body.note !== null && (typeof body.note !== "string" || body.note.length > 1000)) return bodyError("note 无效。");
  const reviewer = body.reviewerId ?? body.reviewer;
  if (typeof reviewer !== "string" || !reviewer.trim() || reviewer.length > 160) return bodyError("reviewerId 无效。");
  if (body.issuedAt !== undefined && (typeof body.issuedAt !== "string" || !body.issuedAt.trim() || body.issuedAt.length > 64)) return bodyError("issuedAt 无效。");

  try {
    const result = await reviewTeacherContextCandidate({
      targetId: targetId.trim(),
      expectedSnapshotId: expectedSnapshotId.trim(),
      expectedRevision: body.expectedRevision,
      decision: body.decision as TeacherContextReviewDecision,
      patch: body.patch as Record<string, unknown> | null | undefined,
      note: body.note as string | null | undefined,
      reviewerId: reviewer.trim(),
      issuedAt: body.issuedAt as string | undefined,
    });
    return NextResponse.json({ receipt: result.receipt, data: result.data }, { status: 200 });
  } catch (error) {
    const code = errorCode(error);
    return NextResponse.json({ error: code, code, reason: errorReason(code) }, { status: errorStatus(code) });
  }
}
