import { ModelRuntime } from "@earendil-works/pi-coding-agent";
import { projectModel } from "@/lib/model-provider-projection";

export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  const providerId = new URL(request.url).searchParams.get("provider")?.trim() || "";
  if (!/^[a-z0-9][a-z0-9._-]{0,79}$/i.test(providerId)) {
    return Response.json({ error: "Provider ID 无效" }, { status: 400 });
  }

  try {
    const runtime = await ModelRuntime.create();
    const provider = runtime.getProviders().find((entry) => entry.id === providerId);
    if (!provider) return Response.json({ error: "Provider 不存在" }, { status: 404 });
    const models = runtime.getModels(providerId)
      .slice(0, 500)
      .map((model) => projectModel(model as unknown as Record<string, unknown>))
      .filter((model) => model.id);
    return Response.json({
      provider: {
        id: provider.id,
        name: provider.name,
        ...(typeof provider.baseUrl === "string" ? { baseUrl: provider.baseUrl } : {}),
        ...(typeof models[0]?.api === "string" ? { api: models[0].api } : {}),
        models,
      },
    });
  } catch (error) {
    return Response.json({ error: error instanceof Error ? error.message : String(error) }, { status: 503 });
  }
}
