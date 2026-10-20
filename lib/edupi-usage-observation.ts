import { prepareTeacherUsageEvent, readTeacherUsageStatus, recordTeacherUsageEvent } from "./edupi-teacher-usage";
import type { TeacherUsageAction, TeacherUsageSurface, TeacherUsageTargetKind } from "./edupi-teacher-usage-types";
import type { EducationWorkCase } from "./edupi-education-contract";

export type UsageObservationTarget = { kind: TeacherUsageTargetKind; targetId: string; expectedRevision?: number; expectedFingerprint?: string };
export type UsageObservation = { target: UsageObservationTarget | null; action: TeacherUsageAction; surface: TeacherUsageSurface; once?: boolean };

export function projectedArtifactUsageTarget(workspace: string, filePath: string | null, workCases: readonly Pick<EducationWorkCase, "externalSend" | "artifacts">[]): UsageObservationTarget | null {
  const root = workspace.replaceAll("\\", "/").replace(/\/+$/, "");
  if (!root || !filePath || filePath.includes("\0")) return null;
  const path = filePath.replaceAll("\\", "/");
  const matches = new Map<string, UsageObservationTarget>();
  for (const workCase of workCases) {
    if (workCase.externalSend !== false) continue;
    for (const artifact of workCase.artifacts) {
      const relative = artifact.relativePath.replaceAll("\\", "/");
      if (artifact.externalSend !== false || !relative.startsWith(".edupi/output/") || relative.split("/").some(part => !part || part === "." || part === "..")
        || `${root}/${relative}` !== path || !Number.isSafeInteger(artifact.revision) || artifact.revision < 1
        || !/^[A-Za-z0-9][A-Za-z0-9._:@/+~=-]{0,299}$/u.test(artifact.id)) continue;
      matches.set(`${artifact.id}:${artifact.revision}`, { kind: "artifact", targetId: artifact.id, expectedRevision: artifact.revision });
    }
  }
  return matches.size === 1 ? [...matches.values()][0] : null;
}
type Dependencies = {
  crypto: Crypto;
  readStatus: typeof readTeacherUsageStatus;
  prepare: typeof prepareTeacherUsageEvent;
  record: typeof recordTeacherUsageEvent;
};

/** Only call after a visible surface or completed user action, never on a request alone. */
export async function observeTeacherUsage(input: UsageObservation, overrides: Partial<Dependencies> = {}): Promise<"disabled" | "recorded" | "deferred"> {
  if (!input.target || input.once && !Number.isSafeInteger(input.target.expectedRevision)) return "disabled";
  const dependencies = { crypto: globalThis.crypto, readStatus: readTeacherUsageStatus, prepare: prepareTeacherUsageEvent, record: recordTeacherUsageEvent, ...overrides };
  try {
    const status = await dependencies.readStatus();
    const consent = status.usage.consent.consent_ref;
    if (!status.collecting || !consent) return "disabled";
    let eventId = `usage-${dependencies.crypto.randomUUID()}`;
    if (input.once) {
      const bytes = new TextEncoder().encode(JSON.stringify(["desktop-usage-v1", consent, input.target.kind, input.target.targetId,
        input.target.expectedRevision, input.target.expectedFingerprint ?? null, input.action, input.surface]));
      const digest = await dependencies.crypto.subtle.digest("SHA-256", bytes);
      eventId = `usage-${Array.from(new Uint8Array(digest), byte => byte.toString(16).padStart(2, "0")).join("")}`;
    }
    const event = await dependencies.prepare({ eventId, sessionId: `desktop-${input.surface}`, target: input.target,
      action: input.action, surface: input.surface, occurredAt: new Date().toISOString() });
    await dependencies.record(event);
    return "recorded";
  } catch {
    // The host owns any persisted unknown-result retry. Observation must not block teaching work.
    return "deferred";
  }
}
