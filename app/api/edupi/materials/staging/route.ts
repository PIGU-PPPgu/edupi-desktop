import { NextRequest, NextResponse } from "next/server";
import {
  MATERIAL_STAGING_MAX_REQUEST_BYTES,
  listStagedMaterials,
  MaterialStagingError,
  settleStagedMaterial,
  stageMaterialInputs,
  stageMaterialPaths,
  type MaterialStagingInput,
} from "@/lib/edupi-material-staging";
import { DESKTOP_API_TOKEN_ENV } from "@/lib/desktop-api";
import { isDesktopApiRequestAllowed } from "@/lib/desktop-api-auth";
import {
  parseFormDataWithinLimit,
  parseJsonWithinLimit,
  RequestBodyTooLargeError,
} from "@/lib/bounded-form-data";
import { hasJsonContentType, isApiRequestAllowed } from "@/lib/request-security";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const MAX_PATHS_JSON_BYTES = 64 * 1024;
const MAX_CLEANUP_JSON_BYTES = 4 * 1024;

function responseStatus(error: MaterialStagingError): number {
  if (error.code === "configuration" || error.code === "unavailable") return 503;
  if (error.code === "forbidden_root" || error.code === "forbidden_source" || error.code === "symlink") return 403;
  if (error.code === "too_large") return 413;
  if (error.code === "unsupported_type") return 415;
  return 400;
}

function requestAllowed(request: Request): boolean {
  if (!isApiRequestAllowed(request)) return false;
  const expectedToken = process.env[DESKTOP_API_TOKEN_ENV]?.trim();
  return !expectedToken || isDesktopApiRequestAllowed(request, expectedToken);
}

function exactRecord(value: unknown, keys: readonly string[]): Record<string, unknown> | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const record = value as Record<string, unknown>;
  return Object.keys(record).every((key) => keys.includes(key)) ? record : null;
}

export async function GET(request: NextRequest | Request) {
  if (!requestAllowed(request)) {
    return NextResponse.json({ error: "Material staging authorization required" }, { status: 403 });
  }
  try {
    return NextResponse.json({ staged: listStagedMaterials() });
  } catch (error) {
    if (error instanceof MaterialStagingError) {
      return NextResponse.json({ error: error.message, code: error.code }, { status: responseStatus(error) });
    }
    return NextResponse.json({ error: "Material staging unavailable" }, { status: 500 });
  }
}

export async function POST(request: NextRequest | Request) {
  if (!requestAllowed(request)) {
    return NextResponse.json({ error: "Material staging authorization required" }, { status: 403 });
  }
  try {
    if (hasJsonContentType(request)) {
      if (!isDesktopApiRequestAllowed(request)) {
        return NextResponse.json({ error: "Desktop authorization required for native paths" }, { status: 403 });
      }
      const body = exactRecord(await parseJsonWithinLimit(request, MAX_PATHS_JSON_BYTES), ["sourcePaths"]);
      if (!body || !Array.isArray(body.sourcePaths)) {
        return NextResponse.json({ error: "sourcePaths must be the only field" }, { status: 400 });
      }
      return NextResponse.json({ staged: stageMaterialPaths(body.sourcePaths) }, { status: 201 });
    }

    const contentType = request.headers.get("content-type")?.toLowerCase() ?? "";
    if (!contentType.startsWith("multipart/form-data;")) {
      return NextResponse.json({ error: "Use multipart form data or native sourcePaths JSON" }, { status: 415 });
    }
    const form = await parseFormDataWithinLimit(request, MATERIAL_STAGING_MAX_REQUEST_BYTES);
    const entries = [...form.entries()];
    if (entries.length === 0 || entries.some(([key, value]) => key !== "files" || typeof value === "string")) {
      return NextResponse.json({ error: "files must be the only multipart field" }, { status: 400 });
    }
    const inputs: MaterialStagingInput[] = [];
    for (const [, value] of entries) {
      const file = value as File;
      inputs.push({ name: file.name, mimeType: file.type, bytes: new Uint8Array(await file.arrayBuffer()) });
    }
    return NextResponse.json({ staged: stageMaterialInputs(inputs) }, { status: 201 });
  } catch (error) {
    if (error instanceof RequestBodyTooLargeError) {
      return NextResponse.json({ error: "Staged materials must total 100MB or less" }, { status: 413 });
    }
    if (error instanceof MaterialStagingError) {
      return NextResponse.json({ error: error.message, code: error.code }, { status: responseStatus(error) });
    }
    return NextResponse.json({ error: "Material staging unavailable" }, { status: 500 });
  }
}

export async function DELETE(request: NextRequest | Request) {
  if (!requestAllowed(request)) {
    return NextResponse.json({ error: "Material staging authorization required" }, { status: 403 });
  }
  if (!hasJsonContentType(request)) {
    return NextResponse.json({ error: "Use application/json" }, { status: 415 });
  }
  try {
    const body = exactRecord(await parseJsonWithinLimit(request, MAX_CLEANUP_JSON_BYTES), ["stagingId"]);
    if (!body || typeof body.stagingId !== "string") {
      return NextResponse.json({ error: "stagingId must be the only field" }, { status: 400 });
    }
    settleStagedMaterial(body.stagingId, "teacher_cleanup");
    return NextResponse.json({ staged: listStagedMaterials() });
  } catch (error) {
    if (error instanceof RequestBodyTooLargeError) {
      return NextResponse.json({ error: "Cleanup request is too large" }, { status: 413 });
    }
    if (error instanceof MaterialStagingError) {
      return NextResponse.json({ error: error.message, code: error.code }, { status: responseStatus(error) });
    }
    return NextResponse.json({ error: "Material staging unavailable" }, { status: 500 });
  }
}
