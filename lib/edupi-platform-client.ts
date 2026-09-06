export type EduPiTeachingSkill = {
  skillId: string;
  title: string;
  lifecycleState: "draft" | "trial" | "validated" | "published" | "retired" | string;
  trialCount: number;
  canReuse: boolean;
  evidenceIds: string[];
  updatedAt: string | null;
};

export type EduPiTeachingSkillLifecycle = {
  status: "ready" | "empty" | "unavailable";
  generatedAt: string | null;
  skills: EduPiTeachingSkill[];
};

type RawRecord = Record<string, unknown>;

function record(value: unknown): RawRecord | null {
  return value && typeof value === "object" && !Array.isArray(value) ? value as RawRecord : null;
}

function text(value: unknown): string | null {
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

function strings(value: unknown): string[] {
  return Array.isArray(value) ? value.filter((item): item is string => typeof item === "string" && Boolean(item.trim())).map((item) => item.trim()) : [];
}

export function normalizeTeachingSkillLifecycle(value: unknown): EduPiTeachingSkillLifecycle {
  const projection = record(value);
  if (!projection || projection.projection_kind !== "teaching_skill_lifecycle" || projection.external_send !== false || !Array.isArray(projection.skills)) {
    return { status: "unavailable", generatedAt: null, skills: [] };
  }
  const skills = projection.skills.flatMap((value) => {
    const item = record(value);
    const skillId = text(item?.skill_id);
    if (!item || !skillId) return [];
    return [{
      skillId,
      title: text(item.title) || "未命名教学能力",
      lifecycleState: text(item.lifecycle_state) || "draft",
      trialCount: typeof item.trial_count === "number" && Number.isInteger(item.trial_count) && item.trial_count >= 0 ? item.trial_count : 0,
      canReuse: item.can_reuse === true,
      evidenceIds: strings(item.evidence_ids),
      updatedAt: text(item.updated_at),
    }];
  });
  return { status: skills.length > 0 ? "ready" : "empty", generatedAt: text(projection.generated_at), skills };
}

export async function readEduPiTeachingSkills(signal?: AbortSignal): Promise<EduPiTeachingSkillLifecycle> {
  try {
    const response = await fetch("/api/edupi/platform", { cache: "no-store", signal });
    if (!response.ok) return { status: "unavailable", generatedAt: null, skills: [] };
    const payload = record(await response.json());
    return normalizeTeachingSkillLifecycle(payload?.teachingSkills);
  } catch (error) {
    if (error instanceof DOMException && error.name === "AbortError") throw error;
    return { status: "unavailable", generatedAt: null, skills: [] };
  }
}
