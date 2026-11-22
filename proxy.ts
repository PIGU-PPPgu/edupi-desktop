import { NextResponse, type NextRequest } from "next/server";
import {
  isApiRequestAllowed,
  isApiRequestHostAllowed,
} from "@/lib/request-security";
import {
  isValidBasicAuthorization,
  isWebPasswordEnabled,
} from "@/lib/web-auth";
import { readCloudStateSync } from "@/lib/edupi-cloud-store";
import { cloudChatRoutePath, localChatWriteScopeMatches } from "@/lib/edupi-cloud-chat-routing";

function isLoopbackHost(host: string | null): boolean {
  if (!host) return false;
  try {
    const hostname = new URL(`http://${host}`).hostname.replace(/^\[|\]$/g, "").toLowerCase();
    return hostname === "localhost" || hostname.endsWith(".localhost") || hostname === "127.0.0.1" || hostname === "::1";
  } catch {
    return false;
  }
}

function isLanMobilePath(pathname: string): boolean {
  return pathname === "/mobile" || pathname === "/mobile/" || pathname.startsWith("/api/mobile/");
}

export function proxy(request: NextRequest) {
  const isApiRequest = request.nextUrl.pathname === "/api"
    || request.nextUrl.pathname.startsWith("/api/");
  const lanMode = process.env.EDUPI_MOBILE_BRIDGE_ENABLED === "1";
  const isLanRequest = lanMode && !isLoopbackHost(request.headers.get("host"));
  if (isLanRequest && !isLanMobilePath(request.nextUrl.pathname)) {
    return new NextResponse("EduPi desktop APIs are loopback-only", { status: 403, headers: { "Cache-Control": "no-store" } });
  }
  const isTrustedRequest = isApiRequest
    ? isApiRequestAllowed(request)
    : isApiRequestHostAllowed(request);

  if (!isTrustedRequest) {
    if (!isApiRequest) {
      return new NextResponse("Untrusted request", { status: 403 });
    }
    return NextResponse.json({ error: "Untrusted API request" }, { status: 403 });
  }

  const password = process.env.PI_WEB_PASSWORD;
  if (
    isWebPasswordEnabled(password)
    && !isValidBasicAuthorization(request.headers.get("authorization"), password)
  ) {
    return new NextResponse("Authentication required", {
      status: 401,
      headers: {
        "Cache-Control": "no-store",
        "WWW-Authenticate": 'Basic realm="Pi Web", charset="UTF-8"',
      },
    });
  }

  const cloudPath = cloudChatRoutePath(request.nextUrl.pathname);
  if (cloudPath) {
    try {
      const state = readCloudStateSync(process.env.PI_DESKTOP_STATE_DIR);
      if (state.mode === "cloud" || state.generation === 0 && process.env.EDUPI_DATA_MODE === "cloud") {
        const destination = request.nextUrl.clone();
        destination.pathname = cloudPath;
        // Next normalizes loopback rewrites to localhost. The browser's origin
        // was checked above; keep that validated internal request consistent
        // with the normalized authority used by the route handler.
        const forwarded = new Headers(request.headers);
        if (forwarded.has("origin")) forwarded.set("origin", destination.origin);
        return NextResponse.rewrite(destination, { request: { headers: forwarded } });
      }
      if (["POST", "PATCH", "PUT", "DELETE"].includes(request.method)
        && !localChatWriteScopeMatches(request.headers.get("x-edupi-cloud-scope"), state.generation)) {
        return NextResponse.json({ error: "数据模式已改变，请刷新后再操作。", code: "scope_changed" },
          { status: 409, headers: { "Cache-Control": "no-store" } });
      }
    } catch {
      return NextResponse.json({ error: "同步配置无法读取，请在设置中恢复。", code: "cloud_state_unavailable" },
        { status: 503 });
    }
  }
  return NextResponse.next();
}

export const config = { matcher: ["/", "/mobile/:path*", "/api/:path*"] };
