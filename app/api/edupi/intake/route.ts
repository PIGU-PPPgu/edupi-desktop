import { NextResponse } from "next/server";
import { parseJsonWithinLimit, RequestBodyTooLargeError } from "@/lib/bounded-form-data";
import { EducationIntakeError, issueEducationIntake } from "@/lib/edupi-education-intake";
import { listStagedMaterials, settleStagedMaterial } from "@/lib/edupi-material-staging";
import { buildMaterialIntakeCommand, intakeRecognizedMaterial } from "@/lib/edupi-material-intake-flow";
import { MaterialRecognitionAdmissionError, withMaterialRecognitionLock } from "@/lib/edupi-material-recognition-lock";
import { hasJsonContentType, isApiRequestAllowed } from "@/lib/request-security";
import { parseTimetableIntakeCommand } from "@/lib/edupi-timetable-intake";
import { parseCalendarIntakeCommand } from "@/lib/edupi-calendar-intake-request";
import { createEduPiCloudClient, EduPiCloudError } from "@/lib/edupi-cloud-client";
import { captureEducationWriteScope } from "@/lib/edupi-cloud-request-scope";
import { readVerifiedStagedMaterial } from "@/lib/edupi-material-recognition";
import { contentHash } from "@/lib/edupi-education-intake";
import { cloudMaterialIntakeIdentity } from "@/lib/edupi-cloud-intake";

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

function contentTypeForExtension(extension: string): string {
  return ({
    ".png": "image/png",
    ".jpg": "image/jpeg",
    ".jpeg": "image/jpeg",
    ".webp": "image/webp",
    ".pdf": "application/pdf",
    ".doc": "application/msword",
    ".docx": "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
    ".ics": "text/calendar",
  } as Record<string, string>)[extension] || "application/octet-stream";
}

function cloudResponse(result: { queued: boolean; result?: Record<string, unknown>; entry?: unknown }) {
  if (result.queued) return { receipt: null, queued: true, status: "pending_sync", queueEntry: result.entry };
  const response = result.result || {};
  const receipt = response.receipt && typeof response.receipt === "object" && !Array.isArray(response.receipt)
    ? (response.receipt as Record<string, unknown>).payload || response.receipt
    : null;
  return { receipt, queued: false, response };
}

export async function POST(request: Request) {
  if (!isApiRequestAllowed(request)) return NextResponse.json({ error: "Education intake request rejected" }, { status: 403 });
  if (!hasJsonContentType(request)) return NextResponse.json({ error: "Use application/json" }, { status: 415 });
  try {
    const body = record(await parseJsonWithinLimit(request, MAX_BODY_BYTES));
    if (!body || typeof body.kind !== "string") throw new EducationIntakeError("invalid_envelope", "教育导入请求无效。");
    const selected = await captureEducationWriteScope(request);
    if (selected.mode === "cloud") {
      const client = createEduPiCloudClient();
      if (body.kind === "material") {
        const material = materialInput(body);
        const command = buildMaterialIntakeCommand(material);
        if (command.command_type !== "intake_material") throw new EducationIntakeError("invalid_envelope", "材料接入请求无效。");
        const verified = await readVerifiedStagedMaterial(material.descriptor);
        const identity = cloudMaterialIntakeIdentity(command);
        const upload = await client.uploadMaterial({
          materialId: command.material.material_id,
          fileName: material.descriptor.original_name,
          contentType: contentTypeForExtension(verified.extension),
          sizeBytes: verified.bytes.byteLength,
          sha256: command.material.source_hash,
          bytes: verified.bytes,
          staging: material.descriptor,
          command,
          requestId: identity.requestId,
          idempotencyKey: identity.idempotencyKey,
        }, selected.scope);
        if (!("queued" in upload)) {
          throw new EduPiCloudError("material_upload_unverified", "材料上传结果无效。", 502);
        }
        if (upload.queued) {
          return NextResponse.json({
            receipt: null, queued: true, status: "pending_sync", queueEntry: upload.entry,
            materialReceivedOnly: true, staged: listStagedMaterials(),
          }, { status: 202 });
        }
        const result = record(upload.result?.response);
        const receiptEnvelope = record(result?.receipt);
        const receipt = receiptEnvelope?.payload || receiptEnvelope || null;
        if (upload.result?.upload_verified !== true || result?.operation !== "command"
          || result?.external_send !== false) {
          throw new EduPiCloudError("material_upload_unverified", "材料二进制尚未通过云端核对。", 503);
        }
        settleStagedMaterial(material.descriptor.staging_id, "accepted_receipt");
        return NextResponse.json({
          receipt, queued: false, response: result,
          storageObjectKey: upload.result.object_key,
          materialReceivedOnly: true,
          staged: listStagedMaterials(),
        });
      }
      const command = body.kind === "calendar" ? parseCalendarIntakeCommand(body)
        : body.kind === "timetable" ? parseTimetableIntakeCommand(body)
          : (() => { throw new EducationIntakeError("invalid_envelope", "不支持的教育导入类型。"); })();
      const hash = contentHash(command);
      const result = await client.intakeCommand(command, {
        requestId: `cloud-intake-${command.command_type}-${hash.slice("sha256:".length, "sha256:".length + 32)}`,
        idempotencyKey: hash,
      }, selected.scope);
      return NextResponse.json(cloudResponse(result));
    }
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
    if (error instanceof EduPiCloudError) {
      const status = error.status === 409 ? 409 : error.status >= 400 && error.status < 500 ? error.status : 503;
      return NextResponse.json({ error: error.message, code: error.code }, { status });
    }
    return NextResponse.json({ error: "教育导入暂不可用", code: "unavailable" }, { status: 503 });
  }
}
