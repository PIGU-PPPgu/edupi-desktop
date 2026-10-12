import { DESKTOP_INSTANCE_ID_HEADER } from "./desktop-api";

/** Probe the same lightweight route the shell verifies before opening its WebView. */
export async function readPackagedServerIdentity(
  request: typeof fetch,
  signal: AbortSignal,
): Promise<string | null> {
  const response = await request("/api/desktop/identity", {
    method: "GET",
    cache: "no-store",
    signal,
  });
  if (response.status !== 204) return null;
  return response.headers.get(DESKTOP_INSTANCE_ID_HEADER)?.trim() || null;
}
