import { NextResponse } from "next/server";
import { EduPiSnapshotError, readEduPiMemoryScopes } from "@/lib/edupi-core-snapshot";

export const dynamic = "force-dynamic";

export async function GET() {
  try {
    const { projection } = await readEduPiMemoryScopes();
    return NextResponse.json({ scope: "teacher_internal", externalSend: false, projection });
  } catch (error) {
    const reason = error instanceof EduPiSnapshotError ? error.code : "unavailable";
    return NextResponse.json({ error: "教育记忆作用域不可用", reason }, { status: 503 });
  }
}
