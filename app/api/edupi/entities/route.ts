import { NextResponse } from "next/server";
import { EntityDeleteError, entityRestoreRequestId, readEntityDeletionLedger } from "@/lib/edupi-entity-delete";
import { isApiRequestAllowed } from "@/lib/request-security";
import { createEduPiCloudClient, EduPiCloudError } from "@/lib/edupi-cloud-client";
import { readCloudEntityDeletions } from "@/lib/edupi-cloud-entities";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  if (!isApiRequestAllowed(request)) return NextResponse.json({ error: "删除记录请求被拒绝。", code: "forbidden" }, { status: 403 });
  try {
    const client = createEduPiCloudClient();
    if ((await client.state()).mode === "cloud") {
      return NextResponse.json(await readCloudEntityDeletions(client));
    }
    const ledger = await readEntityDeletionLedger({ signal: request.signal });
    return NextResponse.json({ deletions: ledger.deletions.map((record) => ({ ...record, restoreRequestId: entityRestoreRequestId(record) })), history: ledger.history });
  } catch (error) {
    if (error instanceof EduPiCloudError) {
      return NextResponse.json({ error: error.message, code: error.code }, { status: error.status });
    }
    const code = error instanceof EntityDeleteError ? error.code : "unavailable";
    return NextResponse.json({ error: error instanceof Error ? error.message : "删除记录暂不可用。", code }, { status: 503 });
  }
}
