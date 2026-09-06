import { NextResponse } from "next/server";
import { generatedArtifactsRequest } from "@/lib/edupi-generated-artifacts";

export const dynamic = "force-dynamic";
export async function GET() {
  try { return NextResponse.json(await generatedArtifactsRequest("list")); }
  catch { return NextResponse.json({ error: "生成文件索引暂不可用" }, { status: 503 }); }
}
