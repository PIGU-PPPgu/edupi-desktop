import { NextResponse } from "next/server";
import { FactLifecycleError, readDeletedEducationFacts } from "@/lib/edupi-fact-lifecycle";
import { parseDeletedFactPage } from "@/lib/edupi-fact-lifecycle-request";
import { isApiRequestAllowed } from "@/lib/request-security";
import { createEduPiCloudClient, EduPiCloudError } from "@/lib/edupi-cloud-client";
import { readCloudDeletedFactPage } from "@/lib/edupi-cloud-fact";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  if (!isApiRequestAllowed(request)) return NextResponse.json({ code: "forbidden", error: "事实删除记录请求被拒绝" }, { status: 403 });
  const page = parseDeletedFactPage(request.url);
  if (!page) return NextResponse.json({ code: "invalid_fact_request", error: "事实删除记录分页无效" }, { status: 400 });
  try {
    const client = createEduPiCloudClient();
    if ((await client.state()).mode === "cloud") {
      const scope = await client.captureScope();
      return NextResponse.json(await readCloudDeletedFactPage(client, scope, page.offset, page.limit));
    }
    return NextResponse.json(await readDeletedEducationFacts(page.offset, page.limit, request.signal));
  }
  catch (error) {
    if (error instanceof EduPiCloudError) return NextResponse.json({ code: error.code, error: error.message }, { status: error.status });
    const code = error instanceof FactLifecycleError ? error.code : "unavailable";
    return NextResponse.json({ code, error: code === "invalid_response" ? "事实删除记录响应无效" : "事实删除记录暂不可用" }, { status: code === "invalid_response" ? 502 : 503 });
  }
}
