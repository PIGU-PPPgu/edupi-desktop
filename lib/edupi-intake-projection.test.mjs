import assert from "node:assert/strict";
import test from "node:test";
import { createJiti } from "jiti";

const { buildEducationContract } = await createJiti(import.meta.url, { tsconfigPaths: true }).import("./edupi-education-contract.ts");

test("projects teacher-facing intake targets with original titles but without staging ids or hashes", () => {
  const data = buildEducationContract({
    workspace: {
      timetable: [{
        slot_id: "recognized-public-slot",
        day_of_week: 1,
        period: 1,
        subject: "数学",
        class_name: "七年级二班",
        kind: "class",
        notes: "材料识别待确认：",
        source_ids: ["stg_00000000000000000000000000000001"],
        evidence_ids: ["stg_00000000000000000000000000000001"],
      }],
      calendar: [], tasks: [], students: [], continuity: {}, source_summaries: [],
    },
    snapshotPayload: {
      review_targets: [{
        projection_kind: "material_intake",
        target: { target_kind: "material_intake", target_id: "material-target", command_type: "intake_material" },
        revision: 1,
        title: "第一学期校历.docx",
        summary: "已接收材料：第一学期校历.docx",
        status: "accepted",
        source_ids: ["stg_00000000000000000000000000000001"],
        evidence_ids: ["stg_00000000000000000000000000000001"],
        teacher_review: { state: "accepted", reviewer_id: "teacher", reviewed_at: "2026-08-29T08:00:00.000Z", note: null, revision: 1 },
        external_send: false,
        staging_id: "stg_hidden",
        source_hash: `sha256:${"a".repeat(64)}`,
        expected_size_bytes: 1024,
        intake_state: "accepted",
      }],
      receipts: [], review_history: [], observations: [], memory_candidates: [], memories: [], capabilities: {},
    },
  });
  assert.deepEqual(data.intakeTargets, [{
    projectionKind: "material_intake",
    targetId: "material-target",
    commandType: "intake_material",
    title: "第一学期校历.docx",
    summary: "已接收材料：第一学期校历.docx",
    status: "accepted",
    reviewedAt: "2026-08-29T08:00:00.000Z",
  }]);
  assert.equal(JSON.stringify(data.intakeTargets).includes("stg_"), false);
  assert.equal(JSON.stringify(data.intakeTargets).includes("sha256"), false);
  assert.equal(JSON.stringify(data.timetable).includes("stg_"), false);
  assert.deepEqual(data.timetable[0], {
    slot_id: "recognized-public-slot",
    day_of_week: 1,
    period: 1,
    subject: "数学",
    class_name: "七年级二班",
    kind: "class",
    notes: "材料识别待确认：",
  });
});
