import { DefaultResourceLoader, getAgentDir } from "@earendil-works/pi-coding-agent";
import type { SkillInfo, SkillsResponse } from "@/lib/api-types";
import { annotateSkillsWithInstallInfo } from "@/lib/skill-lock";
import { getProjectTrustStatus, projectTrustReloadOptions } from "@/lib/project-trust";
import { builtinEducationSkillPaths, EDUPI_CODE_ROOT, extensionPaths } from "@/lib/edupi-runtime";
import { isSafeModeEnabled, safeModeResourceOptions } from "@/lib/safe-mode";

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
    skills: annotateSkillsWithInstallInfo(skills as SkillInfo[], { cwd, agentDir }),
    diagnostics,
    projectResourcesLoaded: getProjectTrustStatus(cwd, agentDir).trusted,
  };
}
