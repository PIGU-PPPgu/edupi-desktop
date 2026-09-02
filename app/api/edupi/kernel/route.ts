import { NextResponse } from "next/server";
import { EduPiSnapshotError, readEduPiKernelProjection } from "@/lib/edupi-core-snapshot";

export const dynamic = "force-dynamic";

export async function GET() {
  try {
    const { projection } = await readEduPiKernelProjection();
    return NextResponse.json({ scope: "teacher_internal", externalSend: false, projection });
  } catch (error) {
    const reason = error instanceof EduPiSnapshotError ? error.code : "unavailable";
    return NextResponse.json({ error: "自动运行状态不可用", reason }, { status: 503 });
  }
}
