import { DESKTOP_INSTANCE_ID_HEADER } from "./desktop-api";

export type DesktopProbeOutcome = "ok" | "http" | "missing_header" | "identity_mismatch" | "timeout" | "network";

export type DesktopConnectionProbeRecord = {
  sequence: number;
  startedAt: number;
  documentStartedAt: number;
  durationMs: number;
  visibility: DocumentVisibilityState;
  settledVisibility: DocumentVisibilityState;
  outcome: DesktopProbeOutcome;
  httpStatus: number | null;
  instance: "unavailable" | "pinned" | "same" | "changed";
};

/** Probe the same lightweight route the shell verifies before opening its WebView. */
export async function readPackagedServerIdentity(
  request: typeof fetch,
  signal: AbortSignal,
  observe?: (response: { outcome: "ok" | "http" | "missing_header"; httpStatus: number }) => void,
): Promise<string | null> {
  const response = await request("/api/desktop/identity", {
    method: "GET",
    cache: "no-store",
    signal,
  });
  if (response.status !== 204) {
    observe?.({ outcome: "http", httpStatus: response.status });
    return null;
  }
  const instanceId = response.headers.get(DESKTOP_INSTANCE_ID_HEADER)?.trim() || null;
  observe?.({ outcome: instanceId ? "ok" : "missing_header", httpStatus: response.status });
  return instanceId;
}
