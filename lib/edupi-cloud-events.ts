import { updateEduPiEducationScope } from "./edupi-education-client.ts";

export const EDUPI_CLOUD_STATUS_CHANGED = "edupi-cloud-status-changed";
export const EDUPI_EDUCATION_SCOPE_CHANGED = "edupi-education-scope-changed";

export type EduPiCloudStatus = {
  mode: "local" | "cloud";
  generation?: number;
  configured: boolean;
  session: {
    state: "signed_in" | "signed_out" | "expired";
    user: { id: string; email: string | null } | null;
    expiresAt: string | null;
  };
  workspaceId: string | null;
  sync: { pending: number; conflict: number; failed: number };
  error: { code: string; message: string } | null;
  workspaces?: Array<{ id: string; mode: string }>;
  flushed?: number;
};

export function announceEduPiCloudStatus(status: EduPiCloudStatus) {
  const scope = {
    mode: status.mode,
    accountId: status.session.user?.id ?? null,
    workspaceId: status.workspaceId,
    ...(Number.isSafeInteger(status.generation) ? { generation: status.generation } : {}),
  };
  const changed = updateEduPiEducationScope(scope);
  if (changed) window.dispatchEvent(new CustomEvent(EDUPI_EDUCATION_SCOPE_CHANGED, { detail: scope }));
  window.dispatchEvent(new CustomEvent<EduPiCloudStatus>(EDUPI_CLOUD_STATUS_CHANGED, { detail: status }));
  return changed;
}
