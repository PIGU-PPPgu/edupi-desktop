import type { EducationContract } from "./edupi-education-contract";

/** Only an uninitialized workspace needs to replace the shell with a blocker. */
export function shouldShowBlockingEducationLoad(education: EducationContract | null): education is null {
  return education === null;
}
