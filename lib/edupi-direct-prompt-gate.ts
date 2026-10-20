import { DESKTOP_API_TOKEN_ENV } from "./desktop-api";
import { resolveEduPiBridgeRoots } from "./edupi-core-snapshot";
import { readEduPiProactivityActivation } from "./edupi-proactivity-config";
import type { EduPiProactivityDomain } from "./edupi-proactivity-config";
import { canStartEduPiCapabilityDrafts, canStartEduPiProactivity, canStartEduPiStudentFollowup } from "./safe-mode";

/** Direct Pi message routes may not bypass an enabled Core-first capture. */
export function eduPiDirectPromptGate(dependencies: {
  desktopToken?: string;
  dataRoot?: () => string;
  activation?: (dataRoot: string, domain: EduPiProactivityDomain) => boolean;
  g1Allowed?: boolean;
  g2Allowed?: boolean;
  g3Allowed?: boolean;
} = {}): "allowed" | "core_first_required" | "unavailable" {
  if (!(dependencies.desktopToken ?? process.env[DESKTOP_API_TOKEN_ENV])) return "allowed";
  try {
    const dataRoot = dependencies.dataRoot?.() ?? resolveEduPiBridgeRoots().dataRoot.root;
    const active = dependencies.activation ?? ((root: string, domain: EduPiProactivityDomain) =>
      readEduPiProactivityActivation({ dataRoot: root, domain }).enabled);
    const g1 = (dependencies.g1Allowed ?? canStartEduPiProactivity()) && active(dataRoot, "teaching_preparation");
    const g2 = (dependencies.g2Allowed ?? canStartEduPiStudentFollowup()) && active(dataRoot, "student_followup");
    const g3 = (dependencies.g3Allowed ?? canStartEduPiCapabilityDrafts())
      && (["calendar_administration", "lesson_reflection", "parent_communication"] as const).some(domain => active(dataRoot, domain));
    return g1 || g2 || g3 ? "core_first_required" : "allowed";
  } catch { return "unavailable"; }
}
