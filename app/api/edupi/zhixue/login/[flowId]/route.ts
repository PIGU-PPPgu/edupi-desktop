import { isDesktopApiRequestAllowed } from "@/lib/desktop-api-auth";
import { resolveEduPiDataRoot } from "@/lib/edupi-core-root";
import { readEduPiZhixueLoginStatus } from "@/lib/edupi-zhixue-bridge";
import { isZhixueFlowId, type ZhixueFlowStatus } from "@/lib/edupi-zhixue-status";

export const dynamic = "force-dynamic";

const headers = { "Cache-Control": "no-store, private" };

export async function GET(request: Request, { params }: { params: Promise<{ flowId: string }> }) {
  if (!isDesktopApiRequestAllowed(request)) {
    return Response.json({ error: "forbidden" }, { status: 403, headers });
  }
  const { flowId } = await params;
  if (!isZhixueFlowId(flowId)) {
    return Response.json({ error: "invalid_flow" }, { status: 400, headers });
  }
  try {
    const status: ZhixueFlowStatus = readEduPiZhixueLoginStatus(resolveEduPiDataRoot().root, flowId);
    return Response.json(status, { headers });
  } catch {
    return Response.json({ error: "unavailable" }, { status: 503, headers });
  }
}
