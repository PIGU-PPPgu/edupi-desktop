import { NextResponse } from "next/server";
import { backgroundJobRequest, cancelBackgroundJob, pumpBackgroundJobs } from "@/lib/edupi-background-jobs";
import { hasJsonContentType, isApiRequestAllowed } from "@/lib/request-security";
import { parseJsonWithinLimit } from "@/lib/bounded-form-data";

export async function GET() {
  try { return NextResponse.json(await backgroundJobRequest()); }
  catch { return NextResponse.json({ error: "后台任务暂不可用" }, { status: 503 }); }
}

export async function POST(request: Request) {
  if (!isApiRequestAllowed(request) || !hasJsonContentType(request)) return NextResponse.json({ error: "请求无效" }, { status: 403 });
  try {
    const body = await parseJsonWithinLimit(request, 16000) as { action?: string; jobId?: string; title?: string; instructions?: string; kind?: string };
    let result;
    if (body.action === "enqueue" && typeof body.title === "string" && typeof body.instructions === "string" && body.instructions.trim() && body.instructions.length <= 12000 && ["document", "ocr", "ppt", "long_task"].includes(body.kind || "")) {
      result = await backgroundJobRequest("enqueue", { input: { idempotencyKey: crypto.randomUUID(), title: body.title, jobType: body.kind, instructions: body.instructions } });
    } else if ((body.action === "cancel" || body.action === "retry") && typeof body.jobId === "string" && /^agent_job_[a-f0-9]{32}$/.test(body.jobId)) {
      result = body.action === "cancel" ? await cancelBackgroundJob(body.jobId) : await backgroundJobRequest("retry", { job_id: body.jobId });
    } else return NextResponse.json({ error: "请填写任务类型与处理要求" }, { status: 400 });
    void pumpBackgroundJobs().catch(() => {});
    return NextResponse.json(result);
  } catch { return NextResponse.json({ error: "后台任务操作失败，请重试" }, { status: 503 }); }
}
