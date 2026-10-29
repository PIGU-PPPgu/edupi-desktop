import { ModelRuntime } from "@earendil-works/pi-coding-agent";
import { NextResponse } from "next/server";
import { invalidateModelsCache } from "@/lib/models-cache";
import { removeStoredCredentialIfType, storeProviderCredential } from "@/lib/provider-credential-store";
import { parseJsonWithinLimit, RequestBodyTooLargeError } from "@/lib/bounded-form-data";
import { isPrivateModelApiRequestAllowed } from "@/lib/private-model-api-auth";
import { hasJsonContentType } from "@/lib/request-security";

export const dynamic = "force-dynamic";

type Params = { params: Promise<{ provider: string }> };

// GET /api/auth/api-key/[provider] — returns auth status (never returns the actual key)
export async function GET(req: Request, { params }: Params) {
  if (!isPrivateModelApiRequestAllowed(req)) return NextResponse.json({ error: "请求被拒绝。" }, { status: 403 });
  const { provider } = await params;
  const modelRuntime = await ModelRuntime.create();
  const status = modelRuntime.getProviderAuthStatus(provider);
  const displayName = modelRuntime.getProvider(provider)?.name ?? provider;
  const models = modelRuntime.getModels(provider).length;
  return NextResponse.json({ provider, displayName, configured: status.configured, source: status.source, models });
}

// POST /api/auth/api-key/[provider]  body: { apiKey: string }
export async function POST(req: Request, { params }: Params) {
  if (!isPrivateModelApiRequestAllowed(req)) return NextResponse.json({ error: "请求被拒绝。" }, { status: 403 });
  if (!hasJsonContentType(req)) return NextResponse.json({ error: "请提交 API Key。" }, { status: 415 });
  const { provider } = await params;
  try {
    const body = await parseJsonWithinLimit(req, 16 * 1024) as { apiKey?: unknown } | null;
    const apiKey = body?.apiKey;
    if (!apiKey || typeof apiKey !== "string" || !apiKey.trim()) {
      return NextResponse.json({ error: "apiKey is required" }, { status: 400 });
    }
    const modelRuntime = await ModelRuntime.create();
    const apiKeyAuth = modelRuntime.getProvider(provider)?.auth.apiKey;
    if (!apiKeyAuth?.login) {
      throw new Error(`${provider} does not support API key login`);
    }
    let keySubmitted = false;
    const credential = await apiKeyAuth.login({
      signal: req.signal,
      notify: () => {},
      prompt: async (prompt) => {
        if (prompt.type === "select") {
          const keyOption = prompt.options.find((option) => option.id === "api-key" || option.id === "bearer-token");
          if (keyOption) return keyOption.id;
          throw new Error(`${provider} requires interactive authentication setup`);
        }
        if (!keySubmitted && prompt.type === "secret") {
          keySubmitted = true;
          return apiKey.trim();
        }
        throw new Error(`${provider} requires additional authentication settings`);
      },
    });
    // ModelRuntime.login() persists the credential and then performs an
    // unbounded network catalog refresh. Store the returned credential
    // directly so a slow catalog cannot leave the save request hanging.
    await storeProviderCredential(provider, credential);
    invalidateModelsCache();
    return NextResponse.json({ success: true });
  } catch (error) {
    if (error instanceof RequestBodyTooLargeError) return NextResponse.json({ error: "API Key 过大。" }, { status: 413 });
    return NextResponse.json({ error: "API Key 保存失败。" }, { status: 500 });
  }
}

// DELETE /api/auth/api-key/[provider] — removes stored API key
export async function DELETE(req: Request, { params }: Params) {
  if (!isPrivateModelApiRequestAllowed(req)) return NextResponse.json({ error: "请求被拒绝。" }, { status: 403 });
  const { provider } = await params;
  try {
    const removal = await removeStoredCredentialIfType(provider, "api_key");
    if (removal.status === "type_mismatch") {
      return NextResponse.json(
        { error: `${provider} is authenticated with OAuth, not an API key` },
        { status: 409 },
      );
    }
    invalidateModelsCache();
    return NextResponse.json({ success: true });
  } catch {
    return NextResponse.json({ error: "API Key 移除失败。" }, { status: 500 });
  }
}
