import { NextResponse } from "next/server";
import { bindEducationTaskSession, readEducationContract } from "@/lib/edupi-education-server";

export const dynamic = "force-dynamic";

export async function GET(
  _request: Request,
  { params }: { params: Promise<{ taskId: string }> },
) {
  const { taskId } = await params;
  const data = await readEducationContract();
  const task = data.tasks.find((item) => item.id === taskId);
  if (!task) return NextResponse.json({ error: "教学任务不存在" }, { status: 404 });
  return NextResponse.json({ binding: data.taskSessions[taskId] ?? null });
}

export async function PUT(
  request: Request,
  { params }: { params: Promise<{ taskId: string }> },
) {
  try {
    const { taskId } = await params;
    const body = await request.json() as { sessionId?: unknown };
    return NextResponse.json(await bindEducationTaskSession({ taskId, sessionId: body.sessionId }));
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    const status = /不存在/.test(message) ? 404 : /不属于|不满足/.test(message) ? 403 : 400;
    return NextResponse.json({ error: message }, { status });
  }
}
