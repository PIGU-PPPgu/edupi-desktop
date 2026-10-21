import { NextResponse } from "next/server";
import { parseJsonWithinLimit, RequestBodyTooLargeError } from "@/lib/bounded-form-data";
import { EducationIntakeError, issueEducationIntake } from "@/lib/edupi-education-intake";
import { listStagedMaterials, settleStagedMaterial } from "@/lib/edupi-material-staging";
import { intakeRecognizedMaterial } from "@/lib/edupi-material-intake-flow";
import { MaterialRecognitionAdmissionError, withMaterialRecognitionLock } from "@/lib/edupi-material-recognition-lock";
import { hasJsonContentType, isApiRequestAllowed } from "@/lib/request-security";
import { parseTimetableIntakeCommand } from "@/lib/edupi-timetable-intake";
import { parseCalendarIntakeCommand } from "@/lib/edupi-calendar-intake-request";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
const MAX_BODY_BYTES = 256 * 1024;
const MATERIAL_KINDS = new Set(["worksheet", "lesson_note", "assessment", "classroom_record", "other"]);
const LEGACY_SOURCE_FIELDS = ["calendarSourceId", "calendarSourceFingerprint", "calendarPreviewFingerprint",
  "documentSourceId", "documentSourceFingerprint", "documentPairingFingerprint"] as const;
type RawRecord = Record<string, unknown>;
const record = (value: unknown): RawRecord | null => value && typeof value === "object" && !Array.isArray(value) ? value as RawRecord : null;
function invalid(): never { throw new EducationIntakeError("invalid_envelope", "材料接入字段无效。"); }
function optionalText(value: unknown, max: number): string | null {
  if (value === undefined || value === null) return null;
  if (typeof value !== "string" || value.length > max) invalid();
  return value.trim() || null;
}

function materialInput(body: RawRecord) {
  const allowed = ["kind", "stagingId", "title", "materialKind", "subject", "classId", "recognize",
    ...LEGACY_SOURCE_FIELDS, "calendarImportConfirmed", "documentPairings"];
  if (Object.keys(body).some(key => !allowed.includes(key))) invalid();
  const stagingId = optionalText(body.stagingId, 160);
  if (!stagingId || !/^stg_[a-f0-9]{32}$/u.test(stagingId)) invalid();
  if (body.recognize !== undefined && typeof body.recognize !== "boolean"
    || body.calendarImportConfirmed !== undefined && typeof body.calendarImportConfirmed !== "boolean") invalid();
  const sources = LEGACY_SOURCE_FIELDS.map(key => optionalText(body[key], 160));
  const pairings = body.documentPairings;
  if (pairings != null && (!Array.isArray(pairings) || pairings.length > 200 || pairings.some(value => {
    const choice = record(value);
    return !choice || Object.keys(choice).sort().join("|") !== "currentSourceOccurrenceRef|incomingVariantRef"
      || typeof choice.incomingVariantRef !== "string" || !/^document-occurrence-[a-f0-9]{32}-[a-f0-9]{32}$/u.test(choice.incomingVariantRef)
      || choice.currentSourceOccurrenceRef !== null && (typeof choice.currentSourceOccurrenceRef !== "string"
        || !choice.currentSourceOccurrenceRef || choice.currentSourceOccurrenceRef.length > 160
        || /[\u0000-\u001f\u007f]/u.test(choice.currentSourceOccurrenceRef));
  }))) invalid();
  // Reject intent before reading/parsing the file, issuing a receipt or deleting
  // anything. A CANCEL with zero active events must not enter the old sync chain.
  if (sources.some(Boolean) || pairings != null || body.calendarImportConfirmed === true) {
    throw new EducationIntakeError("file_schedule_update_unavailable", "旧文件安排暂不支持更新、配对或撤回。");
  }
  const descriptor = listStagedMaterials().find(item => item.staging_id === stagingId);
  if (!descriptor) throw new EducationIntakeError("staging_missing", "暂存材料不存在或已经处理。");
  const materialKind = optionalText(body.materialKind, 40) || "other";
  if (!MATERIAL_KINDS.has(materialKind)) invalid();
  return { descriptor, title: optionalText(body.title, 240) || descriptor.original_name,
    materialKind: materialKind as "worksheet" | "lesson_note" | "assessment" | "classroom_record" | "other",
    subject: optionalText(body.subject, 120), classId: optionalText(body.classId, 160) };
}

function statusFor(error: EducationIntakeError): number {
  if (error.code === "invalid_envelope" || error.code.startsWith("invalid_occurrence_")) return 400;
  if (["file_schedule_update_unavailable", "stale_snapshot", "staging_missing"].includes(error.code)
    || error.code.includes("integrity") || error.code.includes("conflict")) return 409;
  return 503;
}

export async function POST(request: Request) {
  if (!isApiRequestAllowed(request)) return NextResponse.json({ error: "Education intake request rejected" }, { status: 403 });
  if (!hasJsonContentType(request)) return NextResponse.json({ error: "Use application/json" }, { status: 415 });
  try {
    const body = record(await parseJsonWithinLimit(request, MAX_BODY_BYTES));
    if (!body || typeof body.kind !== "string") throw new EducationIntakeError("invalid_envelope", "教育导入请求无效。");
    if (body.kind === "material") {
      const material = materialInput(body);
      const result = await withMaterialRecognitionLock(material.descriptor.staging_id, () => intakeRecognizedMaterial(material));
      const receipt = result.receipts[0] ?? null;
      if (receipt && ["accepted", "modified"].includes(String(receipt.status))) settleStagedMaterial(material.descriptor.staging_id, "accepted_receipt");
      return NextResponse.json({ receipt, receipts: result.receipts, recognition: result.recognition,
        scheduleNeedsReview: result.scheduleNeedsReview, materialReceivedOnly: true,
        ...(result.materialScheduleProposal ? { materialScheduleProposal: result.materialScheduleProposal } : {}),
        ...(result.materialLessonProposal ? { materialLessonProposal: result.materialLessonProposal } : {}), staged: listStagedMaterials() });
    }
    const command = body.kind === "calendar" ? parseCalendarIntakeCommand(body)
      : body.kind === "timetable" ? parseTimetableIntakeCommand(body)
        : (() => { throw new EducationIntakeError("invalid_envelope", "不支持的教育导入类型。"); })();
    const result = await issueEducationIntake(command);
    return NextResponse.json({ receipt: result.receipt });
  } catch (error) {
    if (error instanceof RequestBodyTooLargeError) return NextResponse.json({ error: "Education intake request is too large" }, { status: 413 });
    if (error instanceof EducationIntakeError) return NextResponse.json({ error: error.message, code: error.code }, { status: statusFor(error) });
    if (error instanceof MaterialRecognitionAdmissionError) return NextResponse.json({ error: error.message, code: error.code }, { status: 409 });
    return NextResponse.json({ error: "教育导入暂不可用", code: "unavailable" }, { status: 503 });
  }
}
