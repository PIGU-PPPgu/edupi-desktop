import assert from "node:assert/strict";
import test from "node:test";
import { createJiti } from "jiti";
const jiti = createJiti(import.meta.url);
const {buildMaterialRows} = await jiti.import("./edupi-material-rows.ts");
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
