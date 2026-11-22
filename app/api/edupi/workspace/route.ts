import { NextResponse } from "next/server";
import { readEducationWorkspaceBundle } from "@/lib/edupi-education-server";
import { EduPiCloudError } from "@/lib/edupi-cloud-client";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET() {
  try {
    return NextResponse.json(await readEducationWorkspaceBundle());
  } catch (error) {
    if (error instanceof EduPiCloudError) return NextResponse.json({ code: error.code, error: error.message }, { status: error.status });
    return NextResponse.json({ error: "教育工作区暂不可用" }, { status: 503 });
  }
}
