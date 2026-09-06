import { DefaultResourceLoader } from "@earendil-works/pi-coding-agent";
import { resolve } from "node:path";
import { copyFileSync, existsSync, mkdirSync, readdirSync } from "node:fs";

export const EDUPI_ROOT = resolve(process.env.EDUPI_DATA_ROOT || process.env.EDUPI_PROJECT_ROOT || "../edupi");
export const EDUPI_CODE_ROOT = resolve(process.env.EDUPI_CORE_ROOT || process.env.EDUPI_PROJECT_ROOT || "../edupi");

export function prepareEducationResources(dataRoot = EDUPI_ROOT, codeRoot = EDUPI_CODE_ROOT): string {
  process.env.EDUPI_PROJECT_ROOT = dataRoot;
  process.env.EDUPI_MEMORY_DIR = resolve(dataRoot, ".edupi/memory");
  process.env.EDUPI_OUTPUT_DIR = resolve(dataRoot, ".edupi/output");
  process.env.EDUPI_LOCK_DIR = resolve(dataRoot, ".edupi/locks");
  const skillsDir = process.env.EDUPI_SKILLS_DIR || resolve(dataRoot, "skills");
  const sourceDir = resolve(codeRoot, "skills");
  const copyMissing = (source: string, destination: string) => {
    if (!existsSync(source)) return;
    mkdirSync(destination, { recursive: true });
    for (const entry of readdirSync(source, { withFileTypes: true })) {
      const from = resolve(source, entry.name), to = resolve(destination, entry.name);
      if (entry.isDirectory()) copyMissing(from, to);
      else if (entry.isFile() && !existsSync(to)) copyFileSync(from, to);
    }
  };
  if (existsSync(sourceDir) && resolve(sourceDir) !== resolve(skillsDir)) {
    for (const name of readdirSync(sourceDir)) if (/^\d{2}-/.test(name)) copyMissing(resolve(sourceDir, name), resolve(skillsDir, name));
  }
  process.env.EDUPI_SKILLS_DIR ||= skillsDir;
  process.env.EDUPI_DATA_DIR ||= existsSync(resolve(dataRoot, "data")) ? resolve(dataRoot, "data") : resolve(codeRoot, "data");
  process.env.EDUPI_CONFIG_DIR ||= existsSync(resolve(dataRoot, "config")) ? resolve(dataRoot, "config") : resolve(codeRoot, "config");
  return skillsDir;
}
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
