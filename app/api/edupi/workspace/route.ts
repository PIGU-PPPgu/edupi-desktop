import { NextResponse } from "next/server";
import { readEducationWorkspaceBundle } from "@/lib/edupi-education-server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET() {
  try {
    return NextResponse.json(await readEducationWorkspaceBundle());
  } catch {
    return NextResponse.json({ error: "教育工作区暂不可用" }, { status: 503 });
  }
}
