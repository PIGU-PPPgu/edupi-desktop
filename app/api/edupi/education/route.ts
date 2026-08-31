import { NextResponse } from "next/server";
import { EduPiSnapshotError } from "@/lib/edupi-core-snapshot";
import {
  WorkCandidateReviewError,
  WORK_CANDIDATE_REVIEW_DECISIONS,
  type WorkCandidateReviewDecision,
} from "@/lib/edupi-work-candidate-review";
import { readEducationContract, reviewWorkCandidate } from "@/lib/edupi-education-server";

export const dynamic = "force-dynamic";

export async function GET() {
  try {
    return NextResponse.json(await readEducationContract());
  } catch {
    return NextResponse.json({ error: "教育投影暂不可用", reason: "Core v1.1 education_workspace 快照不可用。" }, { status: 503 });
  }
}

type RawRecord = Record<string, unknown>;

const POST_KEYS = new Set(["commandType", "candidateId", "expectedSnapshotId", "expectedRevision", "decision", "patch", "note"]);
const WORK_CANDIDATE_SUPPRESSION_SCOPES = new Set(["this_candidate", "matching_reason", "next_cycle"]);

function record(value: unknown): RawRecord | null {
  return value && typeof value === "object" && !Array.isArray(value) ? value as RawRecord : null;
}

function bodyError(reason: string): NextResponse {
  return NextResponse.json({ error: "invalid_work_candidate_review", code: "invalid_envelope", reason }, { status: 400 });
}

function isDateOnly(value: unknown): value is string {
  if (typeof value !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const date = new Date(`${value}T00:00:00.000Z`);
  return !Number.isNaN(date.valueOf()) && date.toISOString().slice(0, 10) === value;
}

function errorCode(error: unknown): string {
  if (error instanceof WorkCandidateReviewError) return error.code;
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
  if (code === "stale_revision") return "Today 待办候选已更新，请刷新后重试。";
  if (code === "unsupported_command") return "Core 尚未启用 Today 待办审核。";
  if (code === "invalid_envelope") return "Today 待办审核请求或 Core 回执无效。";
  return "Core Today 待办审核暂不可用。";
}

function validatePatch(value: unknown, decision: WorkCandidateReviewDecision): boolean {
  if (value === undefined || value === null) return decision === "accept" || decision === "reject" || decision === "hold";
  const patch = record(value);
  if (!patch) return false;
  const keys = Object.keys(patch);
  if (decision === "modify") {
    if (keys.length === 0 || keys.some((key) => !["title", "summary", "dueAt"].includes(key))) return false;
    if (Object.hasOwn(patch, "title") && (typeof patch.title !== "string" || !patch.title.trim() || patch.title.length > 240)) return false;
    if (Object.hasOwn(patch, "summary") && (typeof patch.summary !== "string" || !patch.summary.trim() || patch.summary.length > 2000)) return false;
    if (Object.hasOwn(patch, "dueAt") && patch.dueAt !== null && !isDateOnly(patch.dueAt)) return false;
    return true;
  }
  if (decision === "snooze") return keys.length === 1 && keys[0] === "snoozeUntil" && isDateOnly(patch.snoozeUntil)
    && patch.snoozeUntil > new Date().toISOString().slice(0, 10);
  if (decision === "suppress") return keys.length === 1 && keys[0] === "suppressionScope"
    && typeof patch.suppressionScope === "string" && WORK_CANDIDATE_SUPPRESSION_SCOPES.has(patch.suppressionScope);
  return false;
}

export async function POST(request: Request) {
  let body: RawRecord | null;
  try {
    body = record(await request.json());
  } catch {
    return bodyError("请求必须是有效的 JSON 对象。");
  }
  if (!body) return bodyError("请求必须是有效的 JSON 对象。");
  if (Object.keys(body).some((key) => !POST_KEYS.has(key))) return bodyError("请求包含不支持的字段。");
  if (body.commandType !== "review_work_candidate") return bodyError("commandType 仅支持 review_work_candidate。");
  if (typeof body.candidateId !== "string" || !body.candidateId.trim() || body.candidateId.length > 160) return bodyError("candidateId 无效。");
  if (typeof body.expectedSnapshotId !== "string" || !body.expectedSnapshotId.trim() || body.expectedSnapshotId.length > 160) return bodyError("expectedSnapshotId 无效。");
  if (typeof body.expectedRevision !== "number" || !Number.isInteger(body.expectedRevision) || body.expectedRevision < 0) return bodyError("expectedRevision 无效。");
  const decision = body.decision as WorkCandidateReviewDecision;
  if (!WORK_CANDIDATE_REVIEW_DECISIONS.includes(decision)) return bodyError("decision 无效。");
  if (!validatePatch(body.patch, decision)) return bodyError("patch 与 decision 不匹配。");
  if (body.note !== undefined && body.note !== null && (typeof body.note !== "string" || body.note.length > 1000)) return bodyError("note 无效。");
  if (decision === "suppress" && (typeof body.note !== "string" || !body.note.trim())) return bodyError("suppress 必须提供 note。");

  try {
    const result = await reviewWorkCandidate({
      targetId: body.candidateId.trim(),
      expectedSnapshotId: body.expectedSnapshotId.trim(),
      expectedRevision: body.expectedRevision,
      decision,
      patch: body.patch as Record<string, unknown> | null | undefined,
      note: body.note as string | null | undefined,
      reviewerId: "teacher",
      issuedAt: new Date().toISOString(),
    });
    return NextResponse.json({ receipt: result.receipt, data: result.data }, { status: 200 });
  } catch (error) {
    const code = errorCode(error);
    return NextResponse.json({ error: code, code, reason: errorReason(code) }, { status: errorStatus(code) });
  }
}
