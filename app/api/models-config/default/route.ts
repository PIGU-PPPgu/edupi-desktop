import { NextResponse } from "next/server";
import { getAgentDir, ModelRuntime, SettingsManager } from "@earendil-works/pi-coding-agent";
import { parseJsonWithinLimit } from "@/lib/bounded-form-data";
import { isApiRequestAllowed, hasJsonContentType } from "@/lib/request-security";
import { EDUPI_ROOT } from "@/lib/edupi-runtime";
import { invalidateModelsCache } from "@/lib/models-cache";

export async function POST(request: Request) {
  if (!isApiRequestAllowed(request) || !hasJsonContentType(request)) return NextResponse.json({error:"请求无效"},{status:403});
  try {
    const body = await parseJsonWithinLimit(request, 4096) as {provider?:unknown;modelId?:unknown} | null;
    if (!body || typeof body.provider !== "string" || typeof body.modelId !== "string" || Object.keys(body).some((key) => !["provider","modelId"].includes(key))) return NextResponse.json({error:"请选择模型"},{status:400});
    const runtime = await ModelRuntime.create();
    const model = runtime.getModel(body.provider, body.modelId);
    if (!model) return NextResponse.json({error:"请先在模型配置中保存该模型"},{status:400});
    const settings = SettingsManager.create(EDUPI_ROOT, getAgentDir());
    settings.setDefaultModelAndProvider(body.provider, body.modelId);
    await settings.flush();
    invalidateModelsCache();
    return NextResponse.json({success:true});
  } catch { return NextResponse.json({error:"默认模型保存失败，请重试"},{status:503}); }
}
