import { readEduPiProactivityActivation } from "./edupi-proactivity-config";
import { readProactivityOwnerContext } from "./edupi-proactivity-runtime";
import { canStartEduPiCapabilityDrafts } from "./safe-mode";

export type SourceAdminNotificationActivation = {
  classId: string;
  grantId: string;
  ownerId: string;
  updatedAt: string;
};

/** A local G3 notification is permitted only while this exact canary remains selected. */
export function currentSourceAdminNotificationActivation(dataRoot: string): SourceAdminNotificationActivation | null {
  if (!canStartEduPiCapabilityDrafts()) return null;
  try {
    const value = readEduPiProactivityActivation({ dataRoot, domain: "calendar_administration" });
    if (!value.enabled || value.source !== "desktop_canary" || value.configurationStatus !== "ready"
      || value.scope?.subject !== "administration" || !value.scope.classId
      || !value.grantId || !value.ownerId || !value.updatedAt) return null;
    return { classId: value.scope.classId, grantId: value.grantId, ownerId: value.ownerId, updatedAt: value.updatedAt };
  } catch { return null; }
}

export async function readCurrentSourceAdminNotificationAuthority(
  host: { call(operation: string, payload: unknown): Promise<Record<string, unknown>> }, rootRef: string,
  dataRoot: string, now = Date.now(),
): Promise<(SourceAdminNotificationActivation & { grantVersion: number; endsAt: string }) | null> {
  const activation = currentSourceAdminNotificationActivation(dataRoot);
  if (!activation) return null;
  try {
    const owner = await readProactivityOwnerContext(host, rootRef, activation.grantId, now);
    if (!owner || owner.status !== "active" || owner.ownerId !== activation.ownerId || owner.grantId !== activation.grantId
      || !Number.isInteger(owner.grantVersion) || Date.parse(owner.endsAt) <= now) return null;
    return { ...activation, grantVersion: owner.grantVersion, endsAt: owner.endsAt };
  } catch { return null; }
}
