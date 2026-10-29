import { NextResponse } from "next/server";
import { getAgentDir, ModelRuntime, SettingsManager } from "@earendil-works/pi-coding-agent";
import { parseJsonWithinLimit } from "@/lib/bounded-form-data";
import { hasJsonContentType } from "@/lib/request-security";
import { EDUPI_ROOT } from "@/lib/edupi-runtime";
import { invalidateModelsCache } from "@/lib/models-cache";
import { resolveVisibleModels } from "@/lib/model-scope";
import { isTeachingModelIneligible } from "@/lib/model-setup-presets";
import { isPrivateModelApiRequestAllowed } from "@/lib/private-model-api-auth";

export async function GET(request: Request) {
  if (!isPrivateModelApiRequestAllowed(request)) return NextResponse.json({ error: "请求无效" }, { status: 403 });
  try {
    const settings = SettingsManager.create(EDUPI_ROOT, getAgentDir());
    const provider = settings.getDefaultProvider(), modelId = settings.getDefaultModel();
    if (!provider || !modelId) return NextResponse.json({ configured: false, eligible: false });
    const runtime = await ModelRuntime.create();
    const model = runtime.getModel(provider, modelId);
    if (!model) return NextResponse.json({ configured: false, eligible: false });
    const auth = await runtime.getAuth(model);
    const configured = Boolean(auth?.auth.apiKey);
    const eligible = configured && !isTeachingModelIneligible(provider, auth?.auth.baseUrl || model.baseUrl);
    return NextResponse.json({ configured, eligible, ...(eligible ? {} : { reason: configured ? "coding_plan" : "credential_missing" }) });
  } catch { return NextResponse.json({ error: "默认模型状态暂不可用" }, { status: 503 }); }
}

export async function POST(request: Request) {
  if (!isPrivateModelApiRequestAllowed(request) || !hasJsonContentType(request)) return NextResponse.json({error:"请求无效"},{status:403});
  try {
    const body = await parseJsonWithinLimit(request, 4096) as {provider?:unknown;modelId?:unknown} | null;
    if (!body || typeof body.provider !== "string" || typeof body.modelId !== "string" || Object.keys(body).some((key) => !["provider","modelId"].includes(key))) return NextResponse.json({error:"请选择模型"},{status:400});
    const runtime = await ModelRuntime.create();
    const model = runtime.getModel(body.provider, body.modelId);
    if (!model) return NextResponse.json({error:"请先在模型配置中保存该模型"},{status:400});
    const settings = SettingsManager.create(EDUPI_ROOT, getAgentDir());
    const patterns = settings.getEnabledModels();
    if (patterns?.length) {
      const scope = await resolveVisibleModels(runtime, patterns);
      if (!scope.visible.some(item => item.provider === body.provider && item.id === body.modelId)) settings.setEnabledModels([...patterns, `${body.provider}/${body.modelId}`]);
    }
    settings.setDefaultModelAndProvider(body.provider, body.modelId);
    await settings.flush();
    invalidateModelsCache();
    return NextResponse.json({success:true});
  } catch { return NextResponse.json({error:"默认模型保存失败，请重试"},{status:503}); }
}
