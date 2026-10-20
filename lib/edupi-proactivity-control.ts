import crypto from "node:crypto";
import type { EduPiCapabilityDomain, EduPiProactivityDomain, EduPiProactivityScope } from "./edupi-proactivity-config";

const ID = /^[A-Za-z0-9][A-Za-z0-9._:@/+~=-]{0,159}$/u;
export const EDUPI_PROACTIVITY_CONVERSATION_ID = "desktop-ambient-canary-v1";
export const EDUPI_STUDENT_FOLLOWUP_CONVERSATION_ID = "desktop-student-followup-canary-v1";
export const EDUPI_PROACTIVITY_DURATION_DAYS = 7;
export const EDUPI_PROACTIVITY_MAX_CALLS = 12;
export const EDUPI_STUDENT_FOLLOWUP_MAX_CALLS = 4;
export const EDUPI_CAPABILITY_CONVERSATIONS: Record<EduPiCapabilityDomain, string> = Object.freeze({
  calendar_administration: "desktop-calendar-administration-canary-v1",
  lesson_reflection: "desktop-lesson-reflection-canary-v1",
  parent_communication: "desktop-parent-communication-canary-v1",
});

export function proactivityConversationId(domain: EduPiProactivityDomain): string {
  if (domain === "teaching_preparation") return EDUPI_PROACTIVITY_CONVERSATION_ID;
  if (domain === "student_followup") return EDUPI_STUDENT_FOLLOWUP_CONVERSATION_ID;
  const value = EDUPI_CAPABILITY_CONVERSATIONS[domain];
  if (!value) throw new EduPiProactivityControlError("proactivity_scope_unavailable");
  return value;
}

export type EduPiProactivityGrantBinding = {
  grantId: string;
  endsAt: string;
  spec: {
    scope: { class_id: string; subject: string };
    source_ids: string[];
    starts_at: string;
    ends_at: string;
    budget: { id: string; max_calls: number };
  } & ({ domains: ["teaching_preparation"]; actions: ["prepare", "update"] }
    | { domains: ["student_followup" | EduPiCapabilityDomain]; actions: ["update"] });
};

type RawRecord = Record<string, unknown>;
type InternalScope = {
  classId: string;
  className: string | null;
  subject: string;
  slotIds: string[];
  materialIds: string[];
};

export type EduPiProactivityScopeCandidate = {
  classId: string;
  className: string | null;
  subject: string;
  slotCount: number;
  materialCount: number;
  ready: boolean;
};

export class EduPiProactivityControlError extends Error {
  constructor(public readonly code: "proactivity_scope_unavailable" | "proactivity_scope_conflict" | "proactivity_response_invalid") {
    super(code); this.name = "EduPiProactivityControlError";
  }
}

function record(value: unknown): RawRecord | null {
  return value && typeof value === "object" && !Array.isArray(value) ? value as RawRecord : null;
}

function text(value: unknown, max: number): string | null {
  return typeof value === "string" && value.trim().length > 0 && value.length <= max && !/[\u0000-\u001f\u007f]/u.test(value)
    ? value.trim() : null;
}

function opaqueSource(kind: "conversation" | "timetable" | "material", value: string): string {
  return `${kind}:${crypto.createHash("sha256").update(value, "utf8").digest("hex")}`;
}

function internalScopes(workspace: unknown, teacherMaterials: unknown): InternalScope[] {
  const value = record(workspace);
  const slots = Array.isArray(value?.timetable) ? value.timetable : [];
  const materials = Array.isArray(teacherMaterials) ? teacherMaterials : [];
  const groups = new Map<string, InternalScope>();
  for (const raw of slots.slice(0, 500)) {
    const slot = record(raw);
    const slotId = text(slot?.slot_id, 160);
    const classId = text(slot?.class_id, 160);
    const subject = text(slot?.subject, 128);
    if (!slotId || !classId || !subject || !ID.test(slotId) || !ID.test(classId) || slot?.kind !== "class") continue;
    const key = `${classId}\0${subject}`;
    const current = groups.get(key) || { classId, className: text(slot?.class_name, 120), subject, slotIds: [], materialIds: [] };
    if (!current.slotIds.includes(slotId) && current.slotIds.length < 50) current.slotIds.push(slotId);
    groups.set(key, current);
  }
  for (const raw of materials.slice(0, 500)) {
    const material = record(raw);
    const materialId = text(material?.material_id, 160);
    const classId = text(material?.class_id, 160);
    const subject = text(material?.subject, 128);
    if (!materialId || !classId || !subject || !ID.test(materialId) || !ID.test(classId) || material?.available === false) continue;
    const current = groups.get(`${classId}\0${subject}`);
    if (current && !current.materialIds.includes(materialId) && current.materialIds.length < 20) current.materialIds.push(materialId);
  }
  return [...groups.values()].map((item) => ({ ...item, slotIds: item.slotIds.sort(), materialIds: item.materialIds.sort() }))
    .sort((left, right) => `${left.classId}\0${left.subject}`.localeCompare(`${right.classId}\0${right.subject}`));
}

export function buildProactivityScopeCandidates(workspace: unknown, teacherMaterials: unknown): EduPiProactivityScopeCandidate[] {
  return internalScopes(workspace, teacherMaterials).slice(0, 50).map((item) => ({
    classId: item.classId,
    className: item.className,
    subject: item.subject,
    slotCount: item.slotIds.length,
    materialCount: item.materialIds.length,
    ready: item.slotIds.length > 0 && item.materialIds.length > 0,
  }));
}

export function buildStudentFollowupScopeCandidates(workspace: unknown): EduPiProactivityScopeCandidate[] {
  const value = record(workspace);
  const slots = Array.isArray(value?.timetable) ? value.timetable.slice(0, 500).map(record) : [];
  const students = Array.isArray(value?.students) ? value.students.slice(0, 500).map(record) : [];
  return internalScopes(workspace, []).filter((item) => item.subject === "数学").slice(0, 50).map((item) => {
    const matchingSlots = slots.filter((slot) => slot?.kind === "class" && slot.class_id === item.classId && slot.subject === item.subject);
    const classNames = new Set(matchingSlots.map((slot) => text(slot?.class_name, 120)));
    const className = classNames.size === 1 ? [...classNames][0] : null;
    // Only the current Core projection supplies the class mapping. Names and
    // student identities in conversation text remain Core's responsibility.
    const classIds = new Set(slots.filter((slot) => slot?.kind === "class" && slot.class_name === className && slot.subject === item.subject)
      .map((slot) => slot?.class_id));
    return {
      classId: item.classId,
      className: className ?? null,
      subject: item.subject,
      slotCount: item.slotIds.length,
      materialCount: 0,
      ready: Boolean(className && classIds.size === 1 && classIds.has(item.classId)
        && students.some((student) => student?.class_name === className)),
    };
  });
}

const CAPABILITY_PREDICATES: Record<EduPiCapabilityDomain, string[]> = {
  calendar_administration: ["admin.deadline", "admin.submission", "admin.meeting", "admin.confirmation"],
  lesson_reflection: ["lesson.observation", "lesson.statistic", "lesson.feedback", "lesson.outcome", "lesson.review"],
  parent_communication: ["communication.recipient_confirmed", "communication.fact", "communication.teacher_action", "communication.parent_question", "communication.review"],
};

/** Selection readiness comes only from the current public Fact spine. Core
 * still reconstructs and authorizes the exact lesson/recipient at capture. */
export function buildCapabilityScopeCandidates(domain: EduPiCapabilityDomain, workspace: unknown): EduPiProactivityScopeCandidate[] {
  const spine = record(record(workspace)?.fact_spine);
  if (spine?.projection_kind !== "education_fact_v1" || spine.external_send !== false
    || !Array.isArray(spine.entities) || !Array.isArray(spine.observations) || !Array.isArray(spine.accepted_facts)) return [];
  const entities = new Map(spine.entities.slice(0, 500).map(record).filter((item): item is RawRecord => Boolean(item?.status === "active"))
    .map((item) => [String(item.entity_id), item]));
  const observations = new Map(spine.observations.slice(0, 500).map(record).filter((item): item is RawRecord => Boolean(item?.status === "active"))
    .map((item) => [String(item.observation_id), item]));
  const conflicts = new Set((Array.isArray(spine.conflicts) ? spine.conflicts : []).map(record).map((item) => item?.conflict_id));
  const required = domain === "calendar_administration" ? ["class", "term"]
    : domain === "lesson_reflection" ? ["class", "term", "lesson_occurrence"] : ["class", "term", "student", "parent"];
  type Group = { classId: string; className: string | null; subject: string; factIds: Set<string>; recipients: number; body: number };
  const groups = new Map<string, Group>();
  const recipients = new Map<string, number>();
  for (const raw of spine.accepted_facts.slice(0, 500)) {
    const fact = record(raw);
    if (!fact || fact.status !== "accepted" || !["evidence", "general", "academic"].includes(String(fact.fact_kind))
      || !CAPABILITY_PREDICATES[domain].includes(String(fact.predicate)) || !Array.isArray(fact.observation_ids) || fact.observation_ids.length === 0
      || !Array.isArray(fact.source_ids) || !Array.isArray(fact.conflict_ids) || fact.conflict_ids.some((id) => conflicts.has(id))) continue;
    const sources = fact.observation_ids.map((id) => observations.get(String(id)));
    if (sources.some((item) => !item || !Array.isArray(item.entity_ids))) continue;
    const targets = sources.map((item) => required.map((kind) => {
      const ids = (item!.entity_ids as unknown[]).filter((id) => entities.get(String(id))?.entity_kind === kind);
      return ids.length === 1 ? String(ids[0]) : null;
    }));
    if (targets.some((target) => target.some((id) => id === null) || JSON.stringify(target) !== JSON.stringify(targets[0]))) continue;
    if (JSON.stringify([...new Set(sources.map((item) => String(item!.source_id)))].sort()) !== JSON.stringify([...fact.source_ids].sort())) continue;
    const [classId, , studentOrLesson, parentId] = targets[0] as string[];
    if (!ID.test(classId)) continue;
    const recipient = domain === "parent_communication" && fact.predicate === "communication.recipient_confirmed";
    if (fact.entity_id !== (domain === "parent_communication" ? recipient ? parentId : studentOrLesson : classId)) continue;
    const targetKey = JSON.stringify(targets[0]);
    if (recipient) {
      if (fact.fact_kind === "evidence" && record(fact.confidence)?.basis === "explicit"
        && sources.every((item) => item!.source_kind === "teacher_utterance")) recipients.set(targetKey, (recipients.get(targetKey) ?? 0) + 1);
      continue;
    }
    const subject = domain === "calendar_administration" ? "administration" : text(fact.subject_ref, 128);
    if (!subject) continue;
    const key = `${targetKey}\0${subject}`;
    const group = groups.get(key) ?? { classId, className: text(entities.get(classId)?.canonical_name, 120), subject, factIds: new Set(), recipients: 0, body: 0 };
    group.factIds.add(String(fact.fact_id)); group.body++;
    groups.set(key, group);
  }
  const scopes = new Map<string, EduPiProactivityScopeCandidate>();
  for (const [key, group] of groups) {
    if (domain === "parent_communication" && (recipients.get(key.slice(0, key.lastIndexOf("\0"))) ?? 0) > 1) continue;
    const scopeKey = `${group.classId}\0${group.subject}`;
    const current = scopes.get(scopeKey) ?? { classId: group.classId, className: group.className, subject: group.subject, slotCount: 0, materialCount: 0, ready: true };
    current.slotCount++; current.materialCount += group.factIds.size;
    scopes.set(scopeKey, current);
  }
  return [...scopes.values()].sort((left, right) => `${left.classId}\0${left.subject}`.localeCompare(`${right.classId}\0${right.subject}`)).slice(0, 50);
}

export function buildCapabilityGrantBinding(domain: EduPiCapabilityDomain, scope: EduPiProactivityScope,
  workspace: unknown, now = new Date().toISOString()): EduPiProactivityGrantBinding {
  const instant = new Date(now);
  if (!buildCapabilityScopeCandidates(domain, workspace).some((item) => item.ready && item.classId === scope.classId && item.subject === scope.subject)
    || !Number.isFinite(instant.getTime()) || instant.toISOString() !== now) throw new EduPiProactivityControlError("proactivity_scope_unavailable");
  const token = crypto.createHash("sha256").update(`${domain}\0${scope.classId}\0${scope.subject}`, "utf8").digest("hex").slice(0, 32);
  const endsAt = new Date(instant.getTime() + EDUPI_PROACTIVITY_DURATION_DAYS * 86_400_000).toISOString();
  return { grantId: `desktop_${domain}_v1_${token}`, endsAt, spec: {
    scope: { class_id: scope.classId, subject: scope.subject }, domains: [domain], actions: ["update"],
    source_ids: [opaqueSource("conversation", proactivityConversationId(domain))], starts_at: new Date(instant.getTime() - 60_000).toISOString(),
    ends_at: endsAt, budget: { id: `capability_budget_v1_${token}`, max_calls: 4 },
  } };
}

export function buildProactivityGrantBinding(
  scope: EduPiProactivityScope,
  workspace: unknown,
  teacherMaterials: unknown,
  now = new Date().toISOString(),
): EduPiProactivityGrantBinding {
  const current = internalScopes(workspace, teacherMaterials).find((item) => item.classId === scope.classId && item.subject === scope.subject);
  if (!current || current.slotIds.length === 0 || current.materialIds.length === 0) {
    throw new EduPiProactivityControlError("proactivity_scope_unavailable");
  }
  const instant = new Date(now);
  if (!Number.isFinite(instant.getTime()) || instant.toISOString() !== now) throw new EduPiProactivityControlError("proactivity_scope_unavailable");
  const token = crypto.createHash("sha256").update(`${scope.classId}\0${scope.subject}`, "utf8").digest("hex").slice(0, 32);
  const grantId = `desktop_canary_v2_${token}`;
  const startsAt = new Date(instant.getTime() - 60_000).toISOString();
  const endsAt = new Date(instant.getTime() + EDUPI_PROACTIVITY_DURATION_DAYS * 86_400_000).toISOString();
  const sourceIds = [
    opaqueSource("conversation", EDUPI_PROACTIVITY_CONVERSATION_ID),
    ...current.slotIds.map((id) => opaqueSource("timetable", id)),
    ...current.materialIds.map((id) => opaqueSource("material", id)),
  ].sort();
  return {
    grantId,
    endsAt,
    spec: {
      scope: { class_id: scope.classId, subject: scope.subject },
      domains: ["teaching_preparation"],
      actions: ["prepare", "update"],
      source_ids: sourceIds,
      starts_at: startsAt,
      ends_at: endsAt,
      budget: { id: `budget_v2_${token}`, max_calls: EDUPI_PROACTIVITY_MAX_CALLS },
    },
  };
}

export function buildStudentFollowupGrantBinding(
  scope: EduPiProactivityScope,
  workspace: unknown,
  now = new Date().toISOString(),
): EduPiProactivityGrantBinding {
  const current = buildStudentFollowupScopeCandidates(workspace).find((item) => item.classId === scope.classId && item.subject === scope.subject);
  const instant = new Date(now);
  if (!current?.ready || !Number.isFinite(instant.getTime()) || instant.toISOString() !== now) {
    throw new EduPiProactivityControlError("proactivity_scope_unavailable");
  }
  const token = crypto.createHash("sha256").update(`${scope.classId}\0${scope.subject}`, "utf8").digest("hex").slice(0, 32);
  const endsAt = new Date(instant.getTime() + EDUPI_PROACTIVITY_DURATION_DAYS * 86_400_000).toISOString();
  return {
    grantId: `desktop_student_followup_v1_${token}`,
    endsAt,
    spec: {
      scope: { class_id: scope.classId, subject: scope.subject },
      domains: ["student_followup"],
      actions: ["update"],
      source_ids: [opaqueSource("conversation", EDUPI_STUDENT_FOLLOWUP_CONVERSATION_ID)],
      starts_at: new Date(instant.getTime() - 60_000).toISOString(),
      ends_at: endsAt,
      budget: { id: `student_followup_budget_v1_${token}`, max_calls: EDUPI_STUDENT_FOLLOWUP_MAX_CALLS },
    },
  };
}
