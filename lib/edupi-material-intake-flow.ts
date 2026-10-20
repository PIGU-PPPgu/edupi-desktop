import { EducationIntakeError, issueEducationIntake, type EducationIntakeCommand, type MaterialIntake } from "./edupi-education-intake";
import type { EduPiMaterialLessonProposal, EduPiMaterialScheduleProposal } from "./edupi-core-process-client";
import type { MaterialStagingDescriptor } from "./edupi-material-staging";

type RawRecord = Record<string, unknown>;
type FlowInput = {
  descriptor: MaterialStagingDescriptor;
  title?: string;
  materialKind: MaterialIntake["kind"];
  subject: string | null;
  classId: string | null;
};
type IssueResult = { receipt: RawRecord; data: unknown; materialScheduleProposal?: EduPiMaterialScheduleProposal;
  materialLessonProposal?: EduPiMaterialLessonProposal };

/** File receipt never adopts arrangements. Only Core owner read/apply can do so. */
export async function intakeRecognizedMaterial(input: FlowInput, dependencies: {
  issue?: (command: EducationIntakeCommand) => Promise<IssueResult>;
} = {}) {
  const legacy = input as FlowInput & RawRecord;
  if (legacy.scheduleSourceId != null && legacy.scheduleSourceId !== "" || legacy.preserveOccurrenceEventIds === true) {
    throw new EducationIntakeError("file_schedule_update_unavailable", "旧文件安排暂不支持更新、配对或撤回。");
  }
  const descriptor = input.descriptor;
  const sourceId = descriptor.kind === "calendar"
    ? `calendar-evidence-${descriptor.source_hash.slice("sha256:".length, "sha256:".length + 32)}`
    : descriptor.staging_id;
  const command: EducationIntakeCommand = {
    command_type: "intake_material",
    source: { source_id: sourceId, source_kind: "teacher_file", source_hash: descriptor.source_hash, evidence_ids: [descriptor.staging_id] },
    material: {
      material_id: descriptor.kind === "calendar" ? sourceId : `material-${descriptor.staging_id.slice("stg_".length)}`,
      staging_id: descriptor.staging_id,
      staging_path: descriptor.staging_path,
      source_path: null,
      source_hash: descriptor.source_hash,
      expected_size_bytes: descriptor.expected_size_bytes,
      kind: input.materialKind,
      title: input.title?.trim() || descriptor.original_name,
      subject: input.subject,
      class_id: input.classId,
      source_scope: "desktop_staging",
    },
  };
  const result = await (dependencies.issue || issueEducationIntake)(command);
  return { receipts: [result.receipt], data: result.data,
    recognition: { eventCount: 0, slotCount: 0 }, scheduleNeedsReview: false,
    calendarOccurrences: [], cancelledOccurrenceRefs: [],
    ...(result.materialScheduleProposal ? { materialScheduleProposal: result.materialScheduleProposal } : {}),
    ...(result.materialLessonProposal ? { materialLessonProposal: result.materialLessonProposal } : {}) };
}
