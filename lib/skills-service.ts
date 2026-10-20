import { DefaultResourceLoader, getAgentDir } from "@earendil-works/pi-coding-agent";
import { realpathSync, statSync } from "node:fs";
import path from "node:path";
import type { SkillInfo, SkillsResponse } from "@/lib/api-types";
import { annotateSkillsWithInstallInfo } from "@/lib/skill-lock";
import { getProjectTrustStatus, projectTrustReloadOptions } from "@/lib/project-trust";
import { builtinEducationSkillPaths, EDUPI_CODE_ROOT, extensionPaths } from "@/lib/edupi-runtime";
import { isSafeModeEnabled, safeModeResourceOptions } from "@/lib/safe-mode";
import { isPathWithinRoots } from "@/lib/path-security";

/** Core write protection is independent of the general file-access allowlist. */
export function isCoreSkillReadOnly(filePath: string, coreRoot = process.env.EDUPI_CORE_ROOT): boolean {
  if (!coreRoot) return false;
  const roots = new Set([coreRoot]);
  let rootIdentity: { dev: bigint; ino: bigint } | undefined;
  try {
    const realRoot = realpathSync(coreRoot);
    roots.add(realRoot);
    rootIdentity = statSync(realRoot, { bigint: true });
  } catch { /* Keep the normalized configured path protected. */ }
  if (isPathWithinRoots(filePath, roots)) return true;
  try { if (isPathWithinRoots(realpathSync(filePath), roots)) return true; } catch { return false; }
  if (!rootIdentity) return false;
  // Ancestor identity catches case aliases and Core paths with outward symlinks.
  let ancestor = path.dirname(path.resolve(filePath));
  for (;;) {
    try {
      const identity = statSync(ancestor, { bigint: true });
      if (identity.dev === rootIdentity.dev && identity.ino === rootIdentity.ino) return true;
    } catch { /* Continue to an existing ancestor. */ }
    const parent = path.dirname(ancestor);
    if (parent === ancestor) return false;
    ancestor = parent;
  }
}

export async function loadSkillsWithInstallInfo(cwd: string): Promise<SkillsResponse> {
  const agentDir = getAgentDir();
  const safeMode = isSafeModeEnabled();
  const builtinSkillPaths = safeMode ? builtinEducationSkillPaths() : [];
  const loader = new DefaultResourceLoader({ cwd, agentDir, ...(safeMode ? {
    additionalExtensionPaths: extensionPaths,
    additionalSkillPaths: builtinSkillPaths,
    ...safeModeResourceOptions(true, { coreExtensionRoot: EDUPI_CODE_ROOT, builtinSkillPaths }),
  } : {}) });
  await loader.reload(projectTrustReloadOptions(cwd, agentDir));
  const { skills, diagnostics } = loader.getSkills();
  return {
    skills: annotateSkillsWithInstallInfo(skills as SkillInfo[], { cwd, agentDir })
      .map(skill => ({ ...skill, readOnly: isCoreSkillReadOnly(skill.filePath) })),
    diagnostics,
    projectResourcesLoaded: getProjectTrustStatus(cwd, agentDir).trusted,
  };
}
