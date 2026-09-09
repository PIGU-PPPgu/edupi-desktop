export type EduPiTeachingSkill = {
  skillId: string;
  title: string;
  lifecycleState: "draft" | "trial" | "validated" | "published" | "retired" | string;
  trialCount: number;
  canReuse: boolean;
  evidenceIds: string[];
  updatedAt: string | null;
  details?: { content: string | null; truncated: boolean; approval: { status: string | null; feedback: string | null; at: string | null } | null; evaluation: { baseline: number | null; candidate: number | null; heldout: number | null; eligible: boolean; at: string | null } | null; trials: Array<{ at: string | null; outcome: string | null; prompt: string | null; evidence: string[] }>; files: Array<{ label: string; relativePath: string }> };
};

export type EduPiTeachingSkillLifecycle = {
  status: "ready" | "empty" | "unavailable";
  generatedAt: string | null;
  mutationEnabled: boolean;
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
    return { status: "unavailable", generatedAt: null, mutationEnabled: false, skills: [] };
  }
  const skills = projection.skills.flatMap((value) => {
    const item = record(value);
    const skillId = text(item?.skill_id);
    if (!item || !skillId) return [];
    const details = record(item.details);
    const approval = record(details?.approval);
    const evaluation = record(details?.evaluation);
    const score = (value: unknown) => typeof value === "number" && Number.isFinite(value) ? value : null;
    return [{
      skillId,
      title: text(item.title) || "未命名教学能力",
      lifecycleState: text(item.lifecycle_state) || "draft",
      trialCount: typeof item.trial_count === "number" && Number.isInteger(item.trial_count) && item.trial_count >= 0 ? item.trial_count : 0,
      canReuse: item.can_reuse === true,
      evidenceIds: strings(item.evidence_ids),
      updatedAt: text(item.updated_at),
      ...(details ? { details: {
        content: text(details.content)?.replace(/^---\r?\n[\s\S]*?\r?\n---(?:\r?\n|$)/, "").trim() || null, truncated: details.truncated === true,
        approval: approval ? { status: text(approval.status), feedback: text(approval.feedback), at: text(approval.at) } : null,
        evaluation: evaluation ? { baseline: score(evaluation.baseline), candidate: score(evaluation.candidate), heldout: score(evaluation.heldout), eligible: evaluation.eligible === true, at: text(evaluation.at) } : null,
        trials: (Array.isArray(details.trials) ? details.trials : []).flatMap(value => { const trial = record(value); return trial ? [{ at: text(trial.at), outcome: text(trial.outcome), prompt: text(trial.prompt), evidence: strings(trial.evidence) }] : []; }),
        files: (Array.isArray(details.files) ? details.files : []).flatMap(value => { const file = record(value); const relativePath = text(file?.relative_path); return relativePath && !/^(?:[\\/]|[A-Za-z]:)/.test(relativePath) && !relativePath.split(/[\\/]/).includes("..") ? [{ label: text(file?.label) || "文件", relativePath }] : []; }),
      } } : {}),
    }];
  });
  return { status: skills.length > 0 ? "ready" : "empty", generatedAt: text(projection.generated_at), mutationEnabled: projection.mutation_enabled === true, skills };
}

export async function readEduPiTeachingSkills(signal?: AbortSignal): Promise<EduPiTeachingSkillLifecycle> {
  try {
    const response = await fetch("/api/edupi/platform", { cache: "no-store", signal });
    if (!response.ok) return { status: "unavailable", generatedAt: null, mutationEnabled: false, skills: [] };
    const payload = record(await response.json());
    return normalizeTeachingSkillLifecycle(payload?.teachingSkills);
  } catch (error) {
    if (error instanceof DOMException && error.name === "AbortError") throw error;
    return { status: "unavailable", generatedAt: null, mutationEnabled: false, skills: [] };
  }
}
