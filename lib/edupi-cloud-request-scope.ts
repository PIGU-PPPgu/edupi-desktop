import { createEduPiCloudClient, EduPiCloudError, type CloudScope } from "./edupi-cloud-client";
import type { EduPiCloudState } from "./edupi-cloud-store";

export const EDUPI_CLOUD_SCOPE_HEADER = "x-edupi-cloud-scope";

export function cloudScopeKey(scope: CloudScope): string {
  return JSON.stringify(["cloud", scope.issuer, scope.accountId, scope.workspaceId, scope.generation]);
}

export function stateScopeKey(state: EduPiCloudState): string {
  return state.mode === "cloud"
    ? JSON.stringify(["cloud", state.issuer, state.session?.user.id ?? null, state.workspaceId, state.generation])
    : JSON.stringify(["local", state.generation]);
}

export async function captureEducationWriteScope(request: Request, client = createEduPiCloudClient()): Promise<{
  mode: "local" | "cloud"; scope?: CloudScope;
}> {
  const state = await client.state();
  const expected = request.headers.get(EDUPI_CLOUD_SCOPE_HEADER);
  const legacyLocal = expected === "local" && state.mode === "local";
  if (!legacyLocal && (expected !== null || state.mode === "cloud") && expected !== stateScopeKey(state)) {
    throw new EduPiCloudError("scope_changed", "工作区已改变，请刷新后再操作。", 409);
  }
  if (state.mode === "local") return { mode: "local" };
  const scope = await client.captureScope();
  if (cloudScopeKey(scope) !== expected) throw new EduPiCloudError("scope_changed", "工作区已改变，请刷新后再操作。", 409);
  return { mode: "cloud", scope };
}
