import { NextResponse } from "next/server";
import { parseFormDataWithinLimit, parseJsonWithinLimit, RequestBodyTooLargeError } from "@/lib/bounded-form-data";
import { readEducationContract } from "@/lib/edupi-education-server";
import { parseStudentRosterFile, previewStudentRosterFile } from "@/lib/edupi-student-roster-file";
import { StudentRosterError, type StudentRosterRow } from "@/lib/edupi-student-roster-model";
import { processAutomaticStudentRoster, processManualStudentRoster, verifyImportedRosterReadback } from "@/lib/edupi-student-roster-import";
import { automaticRosterRequestId, importStudentRoster } from "@/lib/edupi-student-roster-server";
import { hasJsonContentType, isApiRequestAllowed } from "@/lib/request-security";
import { createEduPiCloudClient, EduPiCloudError } from "@/lib/edupi-cloud-client";
import { captureEducationWriteScope } from "@/lib/edupi-cloud-request-scope";
import { importCloudStudentRoster, readCloudStudentEducationData } from "@/lib/edupi-cloud-students";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
const MAX_JSON_BODY_BYTES = 1024 * 1024;
const MAX_FILE_BODY_BYTES = 6 * 1024 * 1024;

type RawRecord = Record<string, unknown>;
const record = (value: unknown): RawRecord | null => value && typeof value === "object" && !Array.isArray(value) ? value as RawRecord : null;
export async function POST(request: Request) {
  if (!isApiRequestAllowed(request)) return NextResponse.json({ error: "请求被拒绝。" }, { status: 403 });
  try {
    const importDependencies = async () => {
      const client = createEduPiCloudClient();
      const selected = await captureEducationWriteScope(request, client);
      if (selected.mode === "local") return {
        importRoster: (input: Parameters<typeof importStudentRoster>[0]) => importStudentRoster({ ...input, localOnly: true }),
        readContract: readEducationContract,
      };
      return {
        importRoster: (input: Parameters<typeof importStudentRoster>[0]) => importCloudStudentRoster(input, client, selected.scope),
        readContract: () => readCloudStudentEducationData(client, selected.scope),
      };
    };
    let sourceName: string;
    let students: StudentRosterRow[];
    let requestId: string;
    if (hasJsonContentType(request)) {
      const body = record(await parseJsonWithinLimit(request, MAX_JSON_BODY_BYTES));
      if (!body || Object.keys(body).some((key) => !["sourceName", "csv"].includes(key)) || typeof body.csv !== "string" || typeof body.sourceName !== "string" || body.sourceName.length > 240) return NextResponse.json({ error: "学生名单请求无效。" }, { status: 400 });
      return NextResponse.json(await processManualStudentRoster(body.csv, body.sourceName, request.signal, await importDependencies()));
    } else if (request.headers.get("content-type")?.toLocaleLowerCase().startsWith("multipart/form-data;")) {
      const form = await parseFormDataWithinLimit(request, MAX_FILE_BODY_BYTES);
      if ([...form.keys()].some((key) => key !== "file")) return NextResponse.json({ error: "学生名单请求无效。" }, { status: 400 });
      const file = form.get("file");
      if (!(file instanceof File) || !file.name || file.name.length > 240) return NextResponse.json({ error: "请选择名单文件。" }, { status: 400 });
      sourceName = file.name;
      const bytes = new Uint8Array(await file.arrayBuffer());
      const action = new URL(request.url).searchParams;
      if (action.get("preview") === "1") return NextResponse.json({ sourceName, sheets: previewStudentRosterFile(bytes, sourceName) });
      if (action.get("auto") === "1") return NextResponse.json(await processAutomaticStudentRoster(bytes, sourceName, request.signal, await importDependencies()));
      students = parseStudentRosterFile(bytes, sourceName);
      requestId = automaticRosterRequestId(bytes, sourceName);
    } else {
      return NextResponse.json({ error: "请上传名单文件。" }, { status: 415 });
    }
    const deps = await importDependencies();
    const result = await deps.importRoster({ students, sourceName, signal: request.signal, requestId });
    const data = await deps.readContract();
    verifyImportedRosterReadback(students, data);
    return NextResponse.json({ result, data, verified: true });
  } catch (error) {
    if (error instanceof RequestBodyTooLargeError) return NextResponse.json({ error: "名单文件过大。" }, { status: 413 });
    if (error instanceof StudentRosterError) return NextResponse.json({ error: error.message, code: error.code }, { status: 400 });
    if (error instanceof EduPiCloudError) {
      if (error.code === "write_queued") return NextResponse.json({
        queued: true, outboxId: "outboxId" in error ? error.outboxId : null, result: null, data: null,
      }, { status: 202 });
      return NextResponse.json({ error: error.message, code: error.code }, { status: error.status });
    }
    return NextResponse.json({ error: error instanceof Error ? error.message : "学生名单导入失败。" }, { status: 503 });
  }
}
