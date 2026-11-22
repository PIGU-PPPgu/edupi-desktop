import { createHash } from "node:crypto";
import { buildEducationContractFromWorkspace, type EducationContract, type EducationFact, type EducationFactSpine, type EducationTeacherMaterial } from "./edupi-education-contract";
import { createEduPiCloudClient, type CloudScope, EduPiCloudError } from "./edupi-cloud-client";
import type { TeacherContextSnapshot } from "./edupi-onboarding-types";
import { cloudScopeKey } from "./edupi-cloud-request-scope";
import { readCloudStudentRoster } from "./edupi-cloud-students";
import { cacheCloudEntities } from "./edupi-cloud-entity-cache";

function record(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : {};
}

function text(value: unknown, fallback = ""): string {
  return typeof value === "string" && value.trim() ? value.trim() : fallback;
}

function emptyContext(): TeacherContextSnapshot {
  return {
    name: "", subject: "", grade: "", school: "", roles: [], classes: [],
    configured: false, checklist: [], memoryDirectory: "cloud", editable: false,
    editReason: "云端工作区资料由 Supabase 管理。",
  };
}

function cloudTask(value: unknown): Record<string, unknown> {
  const source = record(value);
  const nested = record(source.task);
  return {
    ...nested, ...source,
    id: text(source.task_id || nested.task_id),
    task_id: text(source.task_id || nested.task_id),
    title: text(source.title || nested.title, "教师内部准备任务"),
    due_date: source.due_date ?? nested.due_date ?? null,
    note: source.note ?? nested.note ?? null,
    status: text(source.status, "planned"),
    board_stage: source.stage,
    board_revision: Number.isInteger(source.revision) ? source.revision : 0,
    board_updated_at: source.updated_at ?? null,
    scope: "teacher_internal",
    requires_teacher_review: true,
    external_send: false,
  };
}

function factSpine(rawFacts: unknown, students: Array<Record<string, unknown>>, stateHash: string, rawSpine: unknown): EducationFactSpine | null {
  const facts = Array.isArray(rawFacts) ? rawFacts.map(record) : [];
  const entities: EducationFactSpine["entities"] = [];
  for (const student of students) {
    const id = text(student.student_id);
    if (!id) continue;
    entities.push({ id, kind: "student", name: text(student.name, id), externalRefs: [{ namespace: "school-roster", externalId: id }], revision: Number(student.revision || 0) });
  }
  const accepted: EducationFact[] = [];
  const candidates: EducationFact[] = [];
  for (const source of facts) {
    const id = text(source.fact_id);
    const entityId = text(source.entity_id);
    const kind = ["error_pattern", "progress", "behavior", "general", "safety", "academic", "material", "evidence"].includes(String(source.fact_kind)) ? source.fact_kind as EducationFact["kind"] : null;
    const status = ["candidate", "pending_review", "held", "accepted"].includes(String(source.status)) ? source.status : null;
    if (!status) continue; // Deleted/rejected/superseded rows are not active facts.
    const confidence = record(source.confidence);
    const arrays = [source.source_ids, source.observation_ids, source.conflict_ids];
    if (!id || !entityId || !kind || typeof source.value !== "string" || typeof source.predicate !== "string"
      || !["explicit", "model_assisted", "inferred"].includes(String(confidence.basis))
      || typeof confidence.score !== "number" || confidence.score < 0 || confidence.score > 1
      || arrays.some(items => !Array.isArray(items) || items.some(item => typeof item !== "string"))
      || source.external_send !== false || !Number.isInteger(source.revision)) {
      throw new EduPiCloudError("invalid_response", "云端事实字段无效。", 502);
    }
    const fact: EducationFact = {
      id, entityId, kind, predicate: source.predicate, value: source.value,
      subjectRef: typeof source.subject_ref === "string" ? source.subject_ref : null,
      topicRef: typeof source.topic_ref === "string" ? source.topic_ref : null,
      confidence: { basis: confidence.basis as EducationFact["confidence"]["basis"], score: confidence.score },
      status: status as EducationFact["status"], sourceIds: source.source_ids as string[], observationIds: source.observation_ids as string[],
      conflictIds: source.conflict_ids as string[], hasPredecessor: source.has_predecessor === true, revision: Number(source.revision),
    };
    if (status === "accepted") accepted.push(fact); else candidates.push(fact);
  }
  const acceptedIds = accepted.map(item => item.id);
  const sourceSpine = record(rawSpine);
  const allFacts = new Map([...accepted, ...candidates].map(fact => [fact.id, fact]));
  const conflicts: EducationFactSpine["conflicts"] = [];
  for (const raw of Array.isArray(sourceSpine.conflicts) ? sourceSpine.conflicts : []) {
    const conflict = record(raw);
    const id = text(conflict.id || conflict.conflict_id);
    const entityId = text(conflict.entity_id);
    const factIds = conflict.fact_ids;
    if (!id || !entityId || typeof conflict.predicate !== "string" || !Array.isArray(factIds)
      || factIds.length !== 2 || factIds.some(id => typeof id !== "string")
      || !Array.isArray(conflict.source_ids) || conflict.source_ids.some(id => typeof id !== "string")
      || !Number.isInteger(conflict.revision)) throw new EduPiCloudError("invalid_response", "云端事实冲突字段无效。", 502);
    if (factIds.some(id => !allFacts.has(id))) continue;
    if (factIds.some(id => allFacts.get(id)?.entityId !== entityId)) throw new EduPiCloudError("invalid_response", "云端事实冲突对象不一致。", 502);
    conflicts.push({ id, entityId, predicate: conflict.predicate, factIds: factIds as [string, string], sourceIds: conflict.source_ids as string[], revision: Number(conflict.revision) });
  }
  const studentViews = entities.filter(entity => entity.kind === "student").map(student => ({
    studentId: student.id, name: student.name,
    acceptedFactIds: accepted.filter(fact => fact.entityId === student.id).map(fact => fact.id),
    pendingFactIds: candidates.filter(fact => fact.entityId === student.id).map(fact => fact.id),
  }));
  const digest = /^sha256:[a-f0-9]{64}$/u.test(stateHash) ? stateHash : `sha256:${createHash("sha256").update(JSON.stringify([...accepted, ...candidates])).digest("hex")}`;
  return {
    stateHash: digest, generatedAt: new Date().toISOString(),
    entities, observations: [], acceptedFacts: accepted, factCandidates: candidates,
    hypotheses: [], conflicts, studentViews, uses: [], teachingView: { acceptedFactIds: acceptedIds, bySubject: [] }, nextLessonFactIds: [],
  };
}

function cloudMaterials(value: unknown, workspaceId: string): EducationTeacherMaterial[] {
  if (!Array.isArray(value)) return [];
  return value.flatMap(raw => {
    const source = record(raw);
    const materialId = text(source.material_id);
    const title = text(source.title);
    const kind = source.kind;
    if (!materialId || !title || !["worksheet", "lesson_note", "assessment", "classroom_record", "other"].includes(String(kind))) return [];
    const updated = text(source.metadata_updated_at, new Date(0).toISOString());
    if (Number.isNaN(Date.parse(updated))) return [];
    const metadataRevision = Number.isInteger(source.metadata_revision) ? Number(source.metadata_revision) : 0;
    const historyCount = Number.isInteger(source.metadata_history_count) ? Number(source.metadata_history_count) : 0;
    return [{
      material_id: materialId, title, kind: kind as EducationTeacherMaterial["kind"],
      subject: typeof source.subject === "string" ? source.subject : null,
      class_id: typeof source.class_id === "string" ? source.class_id : null,
      relative_path: `cloud:${workspaceId}/${materialId}`, available: false,
      metadata_revision: metadataRevision,
      metadata_history_count: historyCount,
      metadata_updated_at: updated, external_send: false,
    }];
  });
}

export async function readCloudEducationWorkspaceBundle(
  client = createEduPiCloudClient(), selected?: CloudScope,
): Promise<{ context: TeacherContextSnapshot; data: EducationContract }> {
  const scope = selected || await client.captureScope();
  const dashboard = await client.dashboard(scope);
  const snapshot = await client.snapshot(scope);
  const payload = record(snapshot.payload);
  const spineResponse = Array.isArray(payload.facts) && payload.facts.length
    ? await client.operation("education-facts", { action: "read_spine" }, scope) : {};
  const workspaceId = dashboard.payload.workspace_id;
  const students = await readCloudStudentRoster(client, scope);
  const lifecycle = await client.operation("entities", { action: "list" }, scope);
  cacheCloudEntities(client, scope, lifecycle);
  const workspace = {
    students,
    tasks: (Array.isArray(payload.tasks) ? payload.tasks : dashboard.payload.tasks).map(cloudTask),
    calendar: dashboard.payload.calendar, timetable: dashboard.payload.timetable,
    continuity: { memories: payload.memories || [], signals: [], insights: [], themes: [], subject_knowledge: [], teaching_priorities: [], family_contacts: [], documents: [], last_dream: null },
  };
  const data = buildEducationContractFromWorkspace(workspace, {
    workspacePath: `cloud:${workspaceId}`,
    snapshotPayload: { observations: [], memory_candidates: [], review_targets: [], receipts: [], review_history: [], memories: [], work_cases: [] },
    supportedCommands: [], entityDeleteEnabled: false,
  });
  data.cloudScope = cloudScopeKey(scope);
  data.capabilities.entityDelete = { enabled: true,
    targetKinds: ["calendar", "timetable", "memory", "student", "task", "material"], reason: "" };
  data.teacherMaterials = cloudMaterials(payload.materials, workspaceId);
  const counts = { students: data.students.length, tasks: data.tasks.length, calendar: data.calendar.length,
    timetable: data.timetable.length, materials: data.teacherMaterials.length } as const;
  for (const [key, count] of Object.entries(counts)) {
    data.dataSources[key as keyof typeof counts] = { path: `cloud:${workspaceId}/${key}`,
      present: true, count, status: count ? "ready" : "empty", observedAt: new Date().toISOString() };
  }
  for (const capability of ["calendar", "timetable", "materialIntake"] as const) {
    data.capabilities[capability] = { ...data.capabilities[capability], enabled: true, reason: "" };
  }
  data.factSpine = factSpine(payload.facts, students, text(snapshot.state_hash), spineResponse.spine);
  data.workspaceResourcesUnavailable = false;
  data.generatedArtifactsUnavailable = false;
  data.generatedArtifacts = [];
  return { context: emptyContext(), data };
}
