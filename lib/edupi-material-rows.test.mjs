import assert from "node:assert/strict";
import test from "node:test";
import { createJiti } from "jiti";
const jiti = createJiti(import.meta.url);
const {buildMaterialRows,materialUploadScope} = await jiti.import("./edupi-material-rows.ts");
const {buildEducationContract} = await jiti.import("./edupi-education-contract.ts");

test("preparation materials reflect the shared task decision", () => {
  const data = buildEducationContract({workspace:"/tmp/test",tasks:[{id:"task-a",title:"备课",status:"accepted",content_status:"draft_ready",deliverables:["教案"]}]});
  data.generatedArtifacts=[{artifact_id:"file-a",title:"教案",relative_path:".edupi/output/a.md",task_id:"task-a",origin:"preparation",available:true,updated_at:"2026-09-08"}];
  assert.equal(buildMaterialRows(data)[0].status,"已确认");
  data.tasks[0].status="planned";
  assert.equal(buildMaterialRows(data)[0].status,"候选");
  data.generatedArtifacts[0].available=false;
  assert.equal(buildMaterialRows(data)[0].status,"文件已移动或删除");
});

test("uploaded material uses its persisted ID, not its intake review target", () => {
  const data=buildEducationContract({workspace:"/tmp/test",tasks:[]});
  data.teacherMaterials=[{material_id:"material-real",title:"lesson.docx",kind:"other",subject:"数学",class_id:"703",relative_path:".edupi/inbox/teacher-materials/lesson.docx",available:true}];
  data.intakeTargets=[{targetId:"material_intake_review",projectionKind:"material_intake",title:"lesson.docx",summary:"已接收材料",status:"accepted",reviewedAt:"2026-09-09"}];
  data.intakeReceipts=[{commandType:"intake_material",appliedIds:["material-real"],target:{targetId:"material_intake_review"},createdAt:"2026-09-09"}];
  const row=buildMaterialRows(data)[0];
  assert.equal(row.id,"material-real");
  assert.equal(row.subject,"数学 · 703");
  assert.equal(row.filePath,"/tmp/test/.edupi/inbox/teacher-materials/lesson.docx");
  assert.equal(row.date,"2026-09-09");
  assert.equal(row.summary,"已接收材料");
  data.teacherMaterials=[];
  assert.deepEqual(buildMaterialRows(data),[],"a historical accepted receipt must not revive a deleted material");
});

test("upload carries a known teacher scope without guessing among multiple classes", () => {
  assert.deepEqual(materialUploadScope({subject:"数学",classes:["703"]}),{subject:"数学",classId:"703"});
  assert.deepEqual(materialUploadScope({subject:"数学",classes:["703","704"]}),{subject:"数学",classId:null});
  assert.deepEqual(materialUploadScope(null),{subject:null,classId:null});
});
