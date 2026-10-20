import path from "node:path";
import { pathToFileURL } from "node:url";

/** Synthetic source setup only. Never call against a teacher data root. */
export async function seedCapabilityCanary({ coreRoot, dataRoot, recipientPending = false, recipientMissing = false }) {
  const { prepareCoreRuntimeRoot } = await import(pathToFileURL(path.join(coreRoot, "scripts/core_runtime_root.mjs")).href);
  const { acquireCoreRuntimeWriterAdmission } = await import(pathToFileURL(path.join(coreRoot, "scripts/core_runtime_writer_admission.mjs")).href);
  const root = prepareCoreRuntimeRoot(dataRoot);
  if (!root.ok) throw new Error("synthetic_root_unavailable");
  const admission = await acquireCoreRuntimeWriterAdmission({ root, kind: "legacy_desktop_capability_synthetic_seed" });
  try {
  const facts = await import(pathToFileURL(path.join(coreRoot, "scripts/education_fact_store.mjs")).href);
  const memoryDir = path.join(dataRoot, ".edupi/memory"), at = new Date().toISOString();
  const entity = (kind, suffix, name) => facts.registerEducationEntity({ memoryDir, now: at, entity: {
    entity_kind: kind, namespace: "desktop-capability-synthetic", external_id: `${kind}-${suffix}`, canonical_name: name, aliases: [],
  } }).entity;
  const term = entity("term", "shared", "隔离秋季学期");
  const sourceFact = (entityId, sourceId, predicate, text, entities, subject = null, pending = false) => {
    const observation = facts.captureEducationObservation({ memoryDir, now: at, observation: {
      source_kind: "teacher_utterance", source_id: sourceId, source_revision: "1", raw_text: text,
      observed_at: at, actor_ref: "synthetic-desktop-capability-teacher", entity_ids: entities,
    } }).observation;
    const proposed = facts.proposeEducationFact({ memoryDir, now: at, fact: {
      entity_id: entityId, fact_kind: "evidence", predicate, value: text, confidence: { basis: "explicit", score: 1 },
      subject_ref: subject, source_ids: [sourceId], observation_ids: [observation.observation_id],
    } }).fact;
    const fact = pending ? proposed : facts.reviewEducationFact({ memoryDir, now: at, fact_id: proposed.fact_id,
      expected_revision: proposed.revision, decision: "accept", reviewer: "synthetic-desktop-capability-teacher" }).fact;
    return { fact, reference: { fact_id: fact.fact_id, revision: fact.revision, fact_kind: fact.fact_kind,
      entity_id: fact.entity_id, predicate: fact.predicate, value: fact.value, term_ref: term.entity_id,
      class_ref: entities[0], occurred_on: at.slice(0, 10), source_ids: [...fact.source_ids] } };
  };
  const rows = [];
  for (const [suffix, className] of [["selected", "隔离一班"], ["foreign", "隔离二班"]]) {
    const classroom = entity("class", suffix, className), lesson = entity("lesson_occurrence", suffix, `${className}移项${suffix === "selected" ? "第一课" : "第二课"}`);
    const student = entity("student", suffix, `${className}林清禾`), parent = entity("parent", suffix, `${className}赵女士`);
    const admin = sourceFact(classroom.entity_id, `desktop-admin-${suffix}`, "admin.deadline", `${className}校历材料已核实。`, [classroom.entity_id, term.entity_id]);
    const reflection = sourceFact(classroom.entity_id, `desktop-reflection-${suffix}`, "lesson.observation", `${className}四组解释了移项。`, [classroom.entity_id, term.entity_id, lesson.entity_id], "math");
    const recipient = recipientMissing && suffix === "selected" ? null : sourceFact(parent.entity_id, `desktop-recipient-${suffix}`, "communication.recipient_confirmed", `${className}本次收件人已核实。`, [classroom.entity_id, term.entity_id, student.entity_id, parent.entity_id], null, recipientPending && suffix === "selected");
    const body = sourceFact(student.entity_id, `desktop-body-${suffix}`, "communication.fact", `${className}本周已完成练习。`, [classroom.entity_id, term.entity_id, student.entity_id, parent.entity_id], "math");
    const deadlineAt = new Date(Date.now() + 2 * 86_400_000).toISOString(), lessonAt = new Date(Date.now() - 3_600_000).toISOString();
    const base = `请整理${className}${term.canonical_name}的`;
    rows.push({ suffix, classroom, term, lesson, student, parent, admin, reflection, recipient, body, deadlineAt, lessonAt,
      requests: {
        calendar_administration: `${base}校历行政材料，完成时间 ${deadlineAt}。`,
        lesson_reflection: `${base}${lesson.canonical_name}的课堂复盘，上课时间 ${lessonAt}，完成时间 ${deadlineAt}。`,
        parent_communication: `${base}${student.canonical_name}给${parent.canonical_name}的家长沟通稿，完成时间 ${deadlineAt}。`,
      } });
  }
  return rows;
  } finally { await admission.release(); }
}
