import { NextResponse } from "next/server";
import { parseJsonWithinLimit } from "@/lib/bounded-form-data";
import { hasJsonContentType, isApiRequestAllowed } from "@/lib/request-security";
import { classroomService, ClassroomError } from "@/lib/edupi-classroom-server";
import type { ClassroomRequest } from "@/lib/edupi-classroom-types";
import { createEduPiCloudClient, EduPiCloudError } from "@/lib/edupi-cloud-client";
import { captureEducationWriteScope } from "@/lib/edupi-cloud-request-scope";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(request: Request) {
  if (!isApiRequestAllowed(request)) return NextResponse.json({ error: "请求被拒绝。" }, { status: 403 });
  if (!hasJsonContentType(request)) return NextResponse.json({ error: "请使用 JSON 请求。" }, { status: 415 });
  try {
    const body = await parseJsonWithinLimit(request, 2 * 1024 * 1024) as ClassroomRequest;
    if (!body || typeof body !== "object" || !["grades", "seating", "duty"].includes(body.domain)
      || !["roster", "list", "read", "preview", "save", "restore", "publish"].includes(body.action)
      || Object.keys(body).some(key => !["domain", "action", "id", "expected_revision", "revision", "input", "request_id"].includes(key))) {
      return NextResponse.json({ error: "班级操作无效。" }, { status: 400 });
    }
    const selected = await captureEducationWriteScope(request);
    if (selected.mode === "cloud") {
      const client = createEduPiCloudClient();
      const result = await client.edge("edupi-classroom", { body }, selected.scope);
      const record = result.record && typeof result.record === "object" && !Array.isArray(result.record)
        ? result.record as Record<string, unknown> : null;
      if (["save", "restore"].includes(body.action as string) && record?.id) {
        const readback = await client.edge("edupi-classroom", {
          body: { domain: body.domain, action: "read", id: record.id, request_id: `${body.request_id || record.id}-readback` },
        }, selected.scope);
        const readbackRecord = readback.record && typeof readback.record === "object" && !Array.isArray(readback.record)
          ? readback.record as Record<string, unknown> : null;
        if (!readbackRecord || readbackRecord.revision !== record.revision
          || JSON.stringify(readbackRecord.input) !== JSON.stringify(record.input)
          || JSON.stringify(readbackRecord.result) !== JSON.stringify(record.result)) {
          throw new EduPiCloudError("readback_unverified", "云端方案写入后回读不一致，请重新打开。", 503);
        }
        return NextResponse.json(readback);
      }
      return NextResponse.json(result);
    }
    return NextResponse.json(await classroomService(body, request.signal));
  } catch (error) {
    if (error instanceof EduPiCloudError) {
      const status = error.status === 409 ? 409 : error.status >= 400 && error.status < 500 ? error.status : 503;
      return NextResponse.json({ error: error.message, code: error.code }, { status });
    }
    return NextResponse.json({ error: error instanceof Error ? error.message : "操作失败。", code: error instanceof ClassroomError ? error.code : "unavailable" },
      { status: error instanceof ClassroomError ? error.code === "stale_revision" ? 409 : 400 : 503 });
  }
}
