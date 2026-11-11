import crypto from "node:crypto";
import path from "node:path";
import { pathToFileURL } from "node:url";
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
  constructor(public readonly code: "proactivity_scope_unavailable" | "proactivity_scope_conflict" | "proactivity_source_capacity" | "proactivity_response_invalid") {
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
  const conflicts = new Map((Array.isArray(spine.conflicts) ? spine.conflicts : []).map(record)
    .filter((item): item is RawRecord => Boolean(item?.conflict_id))
    .map((item) => [String(item.conflict_id), item.status]));
  const required = domain === "calendar_administration" ? ["class", "term"]
    : domain === "lesson_reflection" ? ["class", "term", "lesson_occurrence"] : ["class", "term", "student", "parent"];
  type Group = { classId: string; className: string | null; subject: string; factIds: Set<string>; recipients: number; body: number };
  const groups = new Map<string, Group>();
  const recipients = new Map<string, number>();
  for (const raw of spine.accepted_facts.slice(0, 500)) {
    const fact = record(raw);
    if (!fact || fact.status !== "accepted" || !["evidence", "general", "academic"].includes(String(fact.fact_kind))
      || !CAPABILITY_PREDICATES[domain].includes(String(fact.predicate)) || !Array.isArray(fact.observation_ids) || fact.observation_ids.length === 0
      || !Array.isArray(fact.source_ids) || !Array.isArray(fact.conflict_ids)
      || fact.conflict_ids.some((id) => conflicts.get(String(id)) !== "resolved")) continue;
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
    const calendarEvents = domain === "calendar_administration" ? sources.map(item =>
      (item!.entity_ids as unknown[]).filter(id => entities.get(String(id))?.entity_kind === "calendar_event")) : [];
    const calendarEventId = calendarEvents.length > 0 && calendarEvents.every(ids => ids.length === 1 && ids[0] === calendarEvents[0][0])
      ? calendarEvents[0][0] : null;
    if (domain === "calendar_administration"
      ? fact.entity_id !== classId && fact.entity_id !== calendarEventId
      : domain === "lesson_reflection" ? fact.entity_id !== classId && fact.entity_id !== studentOrLesson
        : fact.entity_id !== (recipient ? parentId : studentOrLesson)) continue;
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
  if (domain === "lesson_reflection") {
    const slotCounts = new Map<string, number>();
    for (const slot of reflectionTimetable(workspace)) {
      const key = `${slot.class_id}\0${slot.subject}`;
      slotCounts.set(key, (slotCounts.get(key) ?? 0) + 1);
      const current = scopes.get(key) ?? { classId: slot.class_id as string, className: text(slot.class_name, 120),
        subject: slot.subject as string, slotCount: 0, materialCount: 0, ready: true };
      scopes.set(key, { ...current, slotCount: Math.max(current.slotCount, slotCounts.get(key)!) });
    }
  }
  return [...scopes.values()].sort((left, right) => `${left.classId}\0${left.subject}`.localeCompare(`${right.classId}\0${right.subject}`)).slice(0, 50);
}

function reflectionTimetable(workspace: unknown): RawRecord[] {
  const value = record(workspace), spine = record(value?.fact_spine);
  if (spine?.projection_kind !== "education_fact_v1" || spine.external_send !== false
    || !Array.isArray(spine.entities) || !Array.isArray(value?.timetable)) return [];
  const entities = spine.entities.map(record);
  if (entities.filter(item => item?.entity_kind === "term" && item.status === "active").length !== 1) return [];
  return value.timetable.map(record).filter((slot): slot is RawRecord => {
    if (!slot || slot.kind !== "class" || typeof slot.slot_id !== "string" || !ID.test(slot.slot_id)
      || typeof slot.class_id !== "string" || !ID.test(slot.class_id) || !text(slot.subject, 128)
      || !entities.some(item => item?.entity_kind === "class" && item.status === "active" && item.entity_id === slot.class_id)
      || typeof slot.start_time !== "string" || !/^(?:[01]\d|2[0-3]):[0-5]\d$/u.test(slot.start_time)
      || typeof slot.time_zone !== "string" || !text(slot.time_zone, 100)
      || !Array.isArray(slot.source_ids) || slot.source_ids.length === 0
      || slot.source_ids.some(id => typeof id !== "string" || !ID.test(id))) return false;
    try { new Intl.DateTimeFormat("en-US", { timeZone: slot.time_zone }); return true; }
    catch { return false; }
  });
}

export function lessonReflectionCompletionSourceId(scope: EduPiProactivityScope, lessonId: string): string {
  if (!ID.test(scope.classId) || !text(scope.subject, 128) || !ID.test(lessonId)) {
    throw new EduPiProactivityControlError("proactivity_scope_unavailable");
  }
  return `lesson-completion:${crypto.createHash("sha256").update(JSON.stringify([scope.classId, scope.subject, lessonId])).digest("hex")}`;
}

export function lessonReflectionSourceIds(scope: EduPiProactivityScope, workspace: unknown): string[] {
  const spine = record(record(workspace)?.fact_spine);
  if (spine?.projection_kind !== "education_fact_v1" || spine.external_send !== false
    || !Array.isArray(spine.entities) || !Array.isArray(spine.observations) || !Array.isArray(spine.accepted_facts)) return [];
  const entities = new Map(spine.entities.map(record).filter((item): item is RawRecord => Boolean(item?.status === "active"))
    .map(item => [String(item.entity_id), item]));
  const terms = [...entities.values()].filter(item => item.entity_kind === "term");
  if (terms.length !== 1 || entities.get(scope.classId)?.entity_kind !== "class") return [];
  const slots = reflectionTimetable(workspace).filter(slot => slot.class_id === scope.classId && slot.subject === scope.subject);
  const sources = new Set(slots.flatMap(slot => slot.source_ids as string[]));
  const lessons = new Set<string>();
  for (const entity of entities.values()) {
    if (entity.entity_kind !== "lesson_occurrence" || !ID.test(String(entity.entity_id)) || !Array.isArray(entity.external_refs)) continue;
    const refs = entity.external_refs.map(record).filter(item => item?.namespace === "edupi-timetable-occurrence-v1");
    if (refs.length !== 1 || typeof refs[0]?.external_id !== "string"
      || !/^\d{4}-\d{2}-\d{2}:[a-f0-9]{32}$/u.test(refs[0].external_id)) continue;
    const date = refs[0].external_id.slice(0, 10), instant = Date.parse(`${date}T00:00:00.000Z`);
    if (!Number.isFinite(instant) || new Date(instant).toISOString().slice(0, 10) !== date
      || !slots.some(slot => refs[0]!.external_id === `${date}:${crypto.createHash("sha256")
        .update(JSON.stringify([slot.slot_id, scope.classId, scope.subject, terms[0].entity_id])).digest("hex").slice(0, 32)}`)) continue;
    const lessonId = String(entity.entity_id);
    lessons.add(lessonId);
    sources.add(lessonReflectionCompletionSourceId(scope, lessonId));
  }
  const observations = new Map(spine.observations.map(record).filter((item): item is RawRecord => Boolean(item?.status === "active"))
    .map(item => [String(item.observation_id), item]));
  const conflicts = new Map((Array.isArray(spine.conflicts) ? spine.conflicts : []).map(record)
    .filter((item): item is RawRecord => Boolean(item)).map(item => [String(item.conflict_id), item.status]));
  for (const raw of spine.accepted_facts) {
    const fact = record(raw);
    if (!fact || fact.status !== "accepted" || !["evidence", "general", "academic"].includes(String(fact.fact_kind))
      || ![...CAPABILITY_PREDICATES.lesson_reflection, "lesson.completed"].includes(String(fact.predicate))
      || !Array.isArray(fact.observation_ids) || fact.observation_ids.length === 0
      || !Array.isArray(fact.source_ids) || fact.source_ids.length === 0
      || fact.source_ids.some(id => typeof id !== "string" || !ID.test(id))
      || new Set(fact.source_ids).size !== fact.source_ids.length
      || !Array.isArray(fact.conflict_ids) || fact.conflict_ids.some(id => conflicts.get(String(id)) !== "resolved")) continue;
    const observed = fact.observation_ids.map(id => observations.get(String(id)));
    if (!parentQuestionSubjectMatches(fact, observed, entities, scope.subject)) continue;
    const targets = observed.map(item => ["class", "term", "lesson_occurrence"].map(kind => {
      const ids = (item!.entity_ids as unknown[]).filter(id => entities.get(String(id))?.entity_kind === kind);
      return ids.length === 1 ? String(ids[0]) : null;
    }));
    if (targets.some(target => target.includes(null) || JSON.stringify(target) !== JSON.stringify(targets[0]))
      || targets[0][0] !== scope.classId || targets[0][1] !== terms[0].entity_id
      || !lessons.has(targets[0][2]!)
      || ![scope.classId, targets[0][2]].includes(String(fact.entity_id))
      || observed.some(item => (item!.entity_ids as unknown[]).some(id => ["student", "parent"].includes(String(entities.get(String(id))?.entity_kind))))
      || JSON.stringify([...new Set(observed.map(item => item!.source_id))].sort()) !== JSON.stringify([...fact.source_ids].sort())) continue;
    if (fact.predicate === "lesson.completed" && (fact.entity_id !== targets[0][2] || fact.fact_kind !== "evidence"
      || record(fact.confidence)?.basis !== "explicit"
      || observed.some(item => item!.source_kind !== "teacher_utterance"))) continue;
    for (const source of fact.source_ids) sources.add(source as string);
  }
  return [...sources].sort();
}

export function capabilityGrantSourceIds(domain: EduPiCapabilityDomain, scope: EduPiProactivityScope, workspace: unknown): string[] {
  const sourceIds = domain === "calendar_administration" ? calendarAdministrativeSourceIds(scope, workspace)
    : domain === "parent_communication" ? parentQuestionSourceIds(scope, workspace) : lessonReflectionSourceIds(scope, workspace);
  const grantedSources = [...new Set([opaqueSource("conversation", proactivityConversationId(domain)), ...sourceIds])];
  if (grantedSources.length > 128) throw new EduPiProactivityControlError("proactivity_source_capacity");
  return grantedSources;
}

export async function readLessonReflectionHistorySourceIds(input: {
  coreRoot: string; memoryDir: string; rootRef: string; ownerId: string;
  scope: EduPiProactivityScope; grant: RawRecord;
}): Promise<string[]> {
  const load = (file: string) => import(/* webpackIgnore: true */ pathToFileURL(path.join(input.coreRoot, "scripts", file)).href);
  try {
    const [{ loadEducationFactState, educationFactStateHash }, { selectReflectionHistory, selectReflectionContentHistory }] = await Promise.all([
      load("education_fact_store.mjs"), load("capability_source_reflection_history.mjs"),
    ]);
    const grantScope = record(input.grant.scope);
    if (typeof input.grant.id !== "string" || !ID.test(input.grant.id)
      || grantScope?.class_id !== input.scope.classId || grantScope?.subject !== input.scope.subject
      || !Array.isArray(input.grant.domains) || !input.grant.domains.includes("lesson_reflection")
      || !Array.isArray(input.grant.source_ids)
      || input.grant.source_ids.some(source => typeof source !== "string" || !ID.test(source))) {
      throw new Error("invalid_grant");
    }
    const grantedSources = new Set(input.grant.source_ids);
    const factState = loadEducationFactState({ memoryDir: input.memoryDir });
    const stateHash = educationFactStateHash(factState);
    const entities = new Map<string, RawRecord>(factState.entities.map((entity: RawRecord) => [String(entity.entity_id), entity]));
    const sources = new Set<string>();
    const now = new Date().toISOString();
    for (const [selectHistory, content] of [[selectReflectionHistory, false], [selectReflectionContentHistory, true]] as const) {
      const cursors = new Set<string>();
      let cursor: string | undefined;
      let snapshotHash: string | undefined;
      do {
        const page = selectHistory({ factState, grant: input.grant, root_ref: input.rootRef, now,
          binding: { ownerId: input.ownerId, domain: "lesson_reflection", grantId: input.grant.id,
            scope: { class_id: input.scope.classId, subject: input.scope.subject } },
          page_size: 100, ...(cursor ? { cursor } : {}) });
        if (page.status !== "ready" || page.read_only !== true || page.external_send !== false
          || !Array.isArray(page.entries) || page.entries.length > 100
          || typeof page.snapshot_hash !== "string" || !/^sha256:[a-f0-9]{64}$/u.test(page.snapshot_hash)
          || snapshotHash !== undefined && snapshotHash !== page.snapshot_hash) throw new Error("invalid_history");
        snapshotHash = page.snapshot_hash;
        for (const entry of page.entries) {
          const entity = entities.get(entry.lesson_id);
          if (entity?.entity_kind !== "lesson_occurrence" || entity.status !== "active"
            || !Array.isArray(entity.aliases)) throw new Error("invalid_history");
          const aliases = entity.aliases.map(record);
          const explicitSelection = aliases.filter(alias => alias?.namespace === "edupi-timetable-selection-v1");
          const selection = content && explicitSelection.length === 0
            ? aliases.filter(alias => alias?.namespace === "edupi-timetable-binding-v1") : explicitSelection;
          if (selection.length > 1 || content && selection.length !== 1
            || selection.some(alias => alias?.value !== entry.slot_id || content && alias?.source_id === entry.source_id)) {
            throw new Error("invalid_history");
          }
          const required = [entry.source_id, ...selection.map(alias => alias?.source_id)];
          if (required.some(source => typeof source !== "string" || !ID.test(source)
            || !grantedSources.has(source))) throw new Error("invalid_history");
          for (const source of required) sources.add(source);
        }
        if (page.next_cursor !== null && (typeof page.next_cursor !== "string"
          || page.next_cursor.length > 512 || !/^[A-Za-z0-9_-]+$/u.test(page.next_cursor)
          || page.entries.length === 0 || cursors.has(page.next_cursor))) throw new Error("invalid_history");
        cursor = page.next_cursor ?? undefined;
        if (cursor) cursors.add(cursor);
      } while (cursor);
    }
    if (educationFactStateHash(loadEducationFactState({ memoryDir: input.memoryDir })) !== stateHash) {
      throw new Error("history_changed");
    }
    return [...sources].sort();
  } catch {
    throw new EduPiProactivityControlError("proactivity_response_invalid");
  }
}

export function capabilityGrantId(domain: EduPiCapabilityDomain, scope: EduPiProactivityScope): string {
  const token = crypto.createHash("sha256").update(`${domain}\0${scope.classId}\0${scope.subject}`, "utf8").digest("hex").slice(0, 32);
  return `desktop_${domain}_v1_${token}`;
}

/** Bind only current accepted calendar deadline sources to the selected admin grant. */
export function calendarAdministrativeSourceIds(scope: EduPiProactivityScope, workspace: unknown): string[] {
  if (scope.subject !== "administration") return [];
  const spine = record(record(workspace)?.fact_spine);
  if (spine?.projection_kind !== "education_fact_v1" || spine.external_send !== false
    || !Array.isArray(spine.entities) || !Array.isArray(spine.observations) || !Array.isArray(spine.accepted_facts)) return [];
  const active = spine.entities.map(record).filter((item): item is RawRecord => Boolean(item?.status === "active"));
  const entities = new Map(active.map(item => [String(item.entity_id), item]));
  const terms = active.filter(item => item.entity_kind === "term");
  if (terms.length !== 1 || entities.get(scope.classId)?.entity_kind !== "class") return [];
  const observations = new Map(spine.observations.map(record).filter((item): item is RawRecord => Boolean(item?.status === "active"))
    .map(item => [String(item.observation_id), item]));
  const candidates: Array<{ key: string; sourceIds: string[] }> = [];
  const conflicts = Array.isArray(spine.conflicts) ? spine.conflicts.map(record) : [];
  const timestamp = /\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z/gu;
  for (const raw of spine.accepted_facts) {
    const fact = record(raw);
    if (!fact || fact.status !== "accepted" || fact.fact_kind !== "evidence" || fact.predicate !== "admin.deadline"
      || typeof fact.value !== "string" || fact.value.length > 1000
      || !Array.isArray(fact.source_ids) || !Array.isArray(fact.observation_ids) || fact.observation_ids.length === 0
      || !Array.isArray(fact.conflict_ids) || fact.conflict_ids.some(id => conflicts.find(item => item?.conflict_id === id)?.status !== "resolved")) continue;
    const dates = [...fact.value.matchAll(timestamp)].map(match => match[0]);
    const parsedDate = dates.length === 1 ? new Date(dates[0]) : null;
    if (!parsedDate || Number.isNaN(parsedDate.getTime()) || parsedDate.toISOString() !== dates[0]) continue;
    const observed = fact.observation_ids.map(id => observations.get(String(id)));
    if (observed.some(item => !item || item.source_kind !== "calendar" || !Array.isArray(item.entity_ids))) continue;
    const observedDays = new Set(observed.map(item => typeof item?.observed_at === "string" ? item.observed_at.slice(0, 10) : null));
    if (observedDays.size !== 1 || observedDays.has(null)) continue;
    const sourceIds = observed.map(item => text(item?.source_id, 160));
    const factSources = fact.source_ids as unknown[];
    if (sourceIds.some(id => !id || !ID.test(id)) || new Set(sourceIds).size !== factSources.length
      || sourceIds.some(id => !factSources.includes(id))) continue;
    const eventIds = new Set<string>();
    if (observed.some(item => {
      const ids = (kind: string) => (item!.entity_ids as unknown[]).filter(id => entities.get(String(id))?.entity_kind === kind);
      const classes = ids("class"), matchedTerms = ids("term"), events = ids("calendar_event");
      if (classes.length !== 1 || classes[0] !== scope.classId || matchedTerms.length !== 1
        || matchedTerms[0] !== terms[0].entity_id || events.length !== 1) return true;
      eventIds.add(String(events[0])); return false;
    }) || eventIds.size !== 1 || (fact.entity_id !== scope.classId && fact.entity_id !== [...eventIds][0])) continue;
    candidates.push({ key: `${scope.classId}\0${terms[0].entity_id}\0${[...eventIds][0]}`, sourceIds: sourceIds as string[] });
  }
  if (candidates.length > 128) throw new EduPiProactivityControlError("proactivity_source_capacity");
  const counts = new Map<string, number>();
  for (const candidate of candidates) counts.set(candidate.key, (counts.get(candidate.key) ?? 0) + 1);
  return [...new Set(candidates.filter(candidate => counts.get(candidate.key) === 1)
    .flatMap(candidate => candidate.sourceIds))].sort();
}

const PARENT_QUESTION_SUBJECT_KEYS = new Map([
  ["math", "mathematics", "数学"], ["chinese", "语文"], ["english", "英语"], ["physics", "物理"],
  ["chemistry", "化学"], ["biology", "生物"], ["history", "历史"], ["geography", "地理"],
  ["politics", "政治"], ["science", "科学"], ["music", "音乐"], ["art", "美术"], ["pe", "体育"],
].flatMap(group => group.map(alias => [alias, group[0]] as const)));

type ParentQuestionSubjectProof = { key: string; entityId: string | null };

function parentQuestionSubjectProof(value: unknown, entities: Map<string, RawRecord>): ParentQuestionSubjectProof | null {
  if (typeof value !== "string" || !value.trim()) return null;
  const subjectKey = (label: unknown) => typeof label === "string"
    ? PARENT_QUESTION_SUBJECT_KEYS.get(label.normalize("NFKC").trim().toLowerCase()) : undefined;
  const entity = entities.get(value);
  if (!entity) {
    const key = subjectKey(value);
    return key ? { key, entityId: null } : null;
  }
  if (entity.entity_kind !== "subject" || entity.status !== "active" || entity.entity_id !== value) return null;
  const labels = [entity.canonical_name, ...(Array.isArray(entity.aliases) ? entity.aliases.map(alias => record(alias)?.value) : [])];
  const keys = new Set(labels.map(subjectKey).filter((key): key is string => Boolean(key)));
  return keys.size === 1 ? { key: [...keys][0], entityId: value } : null;
}

function parentQuestionSubjectMatches(fact: RawRecord, observations: Array<RawRecord | undefined>,
  entities: Map<string, RawRecord>, subject: string): boolean {
  const authorized = parentQuestionSubjectProof(subject, entities);
  const factSubject = parentQuestionSubjectProof(fact.subject_ref, entities);
  const sameSubject = (left: ParentQuestionSubjectProof | null, right: ParentQuestionSubjectProof | null) =>
    left !== null && right !== null && left.key === right.key
      && (!left.entityId || !right.entityId || left.entityId === right.entityId);
  if (!sameSubject(factSubject, authorized)) return false;
  let taggedSubjectId: string | null = null;
  for (const observation of observations) {
    if (!observation || observation.status !== "active" || !Array.isArray(observation.entity_ids)
      || observation.entity_ids.some(id => typeof id !== "string" || !entities.has(id))) return false;
    const tagged = observation.entity_ids.filter(id => entities.get(id)?.entity_kind === "subject") as string[];
    if (tagged.length > 1) return false;
    if (tagged.length === 0) continue;
    const taggedSubject = parentQuestionSubjectProof(tagged[0], entities);
    if (!sameSubject(taggedSubject, authorized) || !sameSubject(taggedSubject, factSubject)
      || taggedSubjectId !== null && taggedSubjectId !== tagged[0]) return false;
    taggedSubjectId = tagged[0];
  }
  return true;
}

export function parentQuestionSourceIds(scope: EduPiProactivityScope, workspace: unknown): string[] {
  const spine = record(record(workspace)?.fact_spine);
  if (spine?.projection_kind !== "education_fact_v1" || spine.external_send !== false
    || !Array.isArray(spine.entities) || !Array.isArray(spine.observations) || !Array.isArray(spine.accepted_facts)) return [];
  const entities = new Map(spine.entities.map(record).filter((item): item is RawRecord => Boolean(item))
    .map(item => [String(item.entity_id), item]));
  if (entities.get(scope.classId)?.entity_kind !== "class" || entities.get(scope.classId)?.status !== "active"
    || [...entities.values()].filter(item => item.entity_kind === "term" && item.status === "active").length !== 1) return [];
  const observations = new Map(spine.observations.map(record).filter((item): item is RawRecord => Boolean(item?.status === "active"))
    .map(item => [String(item.observation_id), item]));
  const conflicts = new Map((Array.isArray(spine.conflicts) ? spine.conflicts : []).map(record)
    .filter((item): item is RawRecord => Boolean(item?.conflict_id)).map(item => [String(item.conflict_id), item.status]));
  const sources = new Set<string>();
  for (const raw of spine.accepted_facts) {
    const fact = record(raw);
    if (!fact || fact.status !== "accepted" || fact.predicate !== "communication.parent_question"
      || !["evidence", "general", "academic"].includes(String(fact.fact_kind))
      || !Array.isArray(fact.source_ids)
      || !Array.isArray(fact.observation_ids) || fact.observation_ids.length === 0
      || !Array.isArray(fact.conflict_ids) || fact.conflict_ids.some(id => conflicts.get(String(id)) !== "resolved")) continue;
    const observed = fact.observation_ids.map(id => observations.get(String(id)));
    if (!parentQuestionSubjectMatches(fact, observed, entities, scope.subject)) continue;
    const targets = observed.map(item => ["class", "term", "student", "parent"].map(kind => {
      const ids = (item!.entity_ids as unknown[]).filter(id => entities.get(String(id))?.entity_kind === kind);
      return ids.length === 1 && entities.get(String(ids[0]))?.status === "active" ? String(ids[0]) : null;
    }));
    if (targets.some(target => target.includes(null) || JSON.stringify(target) !== JSON.stringify(targets[0]))
      || targets[0][0] !== scope.classId || fact.entity_id !== targets[0][2]) continue;
    const observedSources = observed.map(item => text(item?.source_id, 160));
    const factSourceIds = fact.source_ids as unknown[];
    if (observedSources.some(id => !id || !ID.test(id))
      || new Set(observedSources).size !== factSourceIds.length
      || observedSources.some(id => !factSourceIds.includes(id))) continue;
    for (const id of observedSources) sources.add(id!);
  }
  return [...sources].sort();
}

export function buildCapabilityGrantBinding(domain: EduPiCapabilityDomain, scope: EduPiProactivityScope,
  workspace: unknown, now = new Date().toISOString()): EduPiProactivityGrantBinding {
  const instant = new Date(now);
  if (!buildCapabilityScopeCandidates(domain, workspace).some((item) => item.ready && item.classId === scope.classId && item.subject === scope.subject)
    || !Number.isFinite(instant.getTime()) || instant.toISOString() !== now) throw new EduPiProactivityControlError("proactivity_scope_unavailable");
  const token = crypto.createHash("sha256").update(`${domain}\0${scope.classId}\0${scope.subject}`, "utf8").digest("hex").slice(0, 32);
  const endsAt = new Date(instant.getTime() + EDUPI_PROACTIVITY_DURATION_DAYS * 86_400_000).toISOString();
  const grantedSources = capabilityGrantSourceIds(domain, scope, workspace);
  return { grantId: capabilityGrantId(domain, scope), endsAt, spec: {
    scope: { class_id: scope.classId, subject: scope.subject }, domains: [domain], actions: ["update"],
    source_ids: grantedSources, starts_at: new Date(instant.getTime() - 60_000).toISOString(),
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
