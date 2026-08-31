import { DefaultResourceLoader } from "@earendil-works/pi-coding-agent";
import { resolve } from "node:path";

export const EDUPI_ROOT = resolve(process.env.EDUPI_DATA_ROOT || process.env.EDUPI_PROJECT_ROOT || "../edupi");
export const EDUPI_CODE_ROOT = resolve(process.env.EDUPI_CORE_ROOT || process.env.EDUPI_PROJECT_ROOT || "../edupi");
const extensionPaths = [
  "auto_extract.ts", "calendar.ts", "consciousness.ts", "diagnosis.ts", "education_article.ts",
  "evolution_engine.ts", "execution_engine.ts", "layers.ts", "memory.ts", "onboarding.ts",
  "parent_profiles.ts", "perception_l4.ts", "profiles.ts", "skill_router.ts", "subagent_consult.ts",
  "subconscious.ts", "subject_knowledge.ts", "timetable.ts",
].map((name) => resolve(EDUPI_CODE_ROOT, "extensions", name));

export function createEduPiResourceLoader({ cwd, agentDir }: { cwd: string; agentDir: string }) {
  return new DefaultResourceLoader({ cwd, agentDir, additionalExtensionPaths: extensionPaths });
}

export { extensionPaths };
