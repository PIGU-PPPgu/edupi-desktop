import { NextResponse } from "next/server";
import { existsSync, mkdirSync, readFileSync } from "fs";
import { dirname, join } from "path";
import { getAgentDir } from "@earendil-works/pi-coding-agent";
import { writePrivateFileAtomicSync } from "@/lib/atomic-file";
import { invalidateModelsCache } from "@/lib/models-cache";
import { normalizeModelsConfig } from "@/lib/model-config-normalize";
import { parseJsonWithinLimit, RequestBodyTooLargeError } from "@/lib/bounded-form-data";
import { isPrivateModelApiRequestAllowed } from "@/lib/private-model-api-auth";
import { hasJsonContentType } from "@/lib/request-security";

export const dynamic = "force-dynamic";

function getModelsPath(): string {
  return join(getAgentDir(), "models.json");
}

function readModelsJson(): Record<string, unknown> {
  const path = getModelsPath();
  if (!existsSync(path)) return { providers: {} };
  try {
    return JSON.parse(readFileSync(path, "utf8")) as Record<string, unknown>;
  } catch {
    return { providers: {} };
  }
}

function writeModelsJson(data: Record<string, unknown>): void {
  const path = getModelsPath();
  const dir = dirname(path);
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
  writePrivateFileAtomicSync(path, JSON.stringify(data, null, 2));
}

export async function GET(req: Request) {
  if (!isPrivateModelApiRequestAllowed(req)) return NextResponse.json({ error: "请求被拒绝。" }, { status: 403 });
  return NextResponse.json(readModelsJson());
}

export async function PUT(req: Request) {
  if (!isPrivateModelApiRequestAllowed(req)) return NextResponse.json({ error: "请求被拒绝。" }, { status: 403 });
  if (!hasJsonContentType(req)) return NextResponse.json({ error: "请提交模型配置。" }, { status: 415 });
  try {
    const body = await parseJsonWithinLimit(req, 1_500_000) as Record<string, unknown>;
    if (!body || typeof body !== "object" || Array.isArray(body)) return NextResponse.json({ error: "模型配置无效。" }, { status: 400 });
    writeModelsJson(normalizeModelsConfig(body));
    invalidateModelsCache();
    return NextResponse.json({ success: true });
  } catch (error) {
    if (error instanceof RequestBodyTooLargeError) return NextResponse.json({ error: "模型配置过大。" }, { status: 413 });
    return NextResponse.json({ error: "模型配置保存失败。" }, { status: 500 });
  }
}
