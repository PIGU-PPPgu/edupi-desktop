import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { spawn } from "node:child_process";
import { createJiti } from "jiti";

const { normalizeCloudStudentProfileHistory, verifyCloudStudentWrite } =
  await createJiti(import.meta.url, { tsconfigPaths: true }).import("../../../lib/edupi-cloud-students-verification.ts");
const migration = await readFile(new URL("../../migrations/20261122172636_edupi_students_writer.sql", import.meta.url), "utf8");
const regression = await readFile(new URL("./regression.sql", import.meta.url), "utf8");
const wireChecks = `
create temporary table student_wire_results(kind text, workspace_id uuid, body jsonb, receipt jsonb, response jsonb);
do $$
declare
  f record; body jsonb; receipt jsonb; response jsonb;
  current_student edupi.student_profiles%rowtype; original_version text;
begin
  select * into f from student_fixture;
  perform set_config('request.jwt.claim.sub',f.actor_id::text,true);
  body := '{"action":"import","request_id":"wire-import","source_name":"合成名单.csv","students":[
    {"name":"全链路合成学生","class_name":"一班","traits":["认真"],"parent_notes":[]}]}';
  receipt := edupi.mutate_students(f.workspace_id,f.actor_id,body);
  response := edupi.read_students(f.workspace_id,'{"action":"list","request_id":"wire-import"}');
  insert into student_wire_results values('import',f.workspace_id,body,receipt,response);
  select * into current_student from edupi.student_profiles where workspace_id=f.workspace_id and name='全链路合成学生';
  body := jsonb_build_object('action','update','request_id','wire-edit','expected_revision',0,
    'expected_updated_at',current_student.updated_at,'student',jsonb_build_object(
      'student_id',current_student.student_id,'name',current_student.name,'class_name','二班',
      'traits',jsonb_build_array('主动提问'),'parent_notes',jsonb_build_array('合成备注')));
  receipt := edupi.mutate_students(f.workspace_id,f.actor_id,body);
  original_version := receipt->>'version_id';
  response := edupi.read_students(f.workspace_id,jsonb_build_object(
    'action','history','request_id','wire-edit','student_id',current_student.student_id));
  insert into student_wire_results values('update',f.workspace_id,body,receipt,response);
  body := jsonb_build_object('action','restore','request_id','wire-restore','student_id',current_student.student_id,
    'student_name',current_student.name,'version_id',original_version,'version_side','before','expected_revision',1);
  receipt := edupi.mutate_students(f.workspace_id,f.actor_id,body);
  response := edupi.read_students(f.workspace_id,jsonb_build_object(
    'action','history','request_id','wire-restore','student_id',current_student.student_id,'version_id',original_version));
  insert into student_wire_results values('restore',f.workspace_id,body,receipt,response);
end;
$$;
select row_to_json(result) from student_wire_results result order by kind;
`;
const child = spawn("docker", [
  "exec", "-i", "supabase_db_edupi-desktop", "psql", "-X", "-qAt", "-U", "postgres",
  "-d", "postgres", "-v", "ON_ERROR_STOP=1",
], { stdio: ["pipe", "pipe", "pipe"] });
let output = "";
let errors = "";
child.stdout.on("data", value => { output += value; });
child.stderr.on("data", value => { errors += value; });
const exit = new Promise((resolve, reject) => {
  child.on("error", reject);
  child.on("exit", resolve);
});
child.stdin.end(`begin; set local lock_timeout='5s'; set local statement_timeout='30s';\n${migration}\n${regression}\n${wireChecks}\nrollback;\n`);
assert.equal(await exit, 0, errors);
const frames = output.split("\n").filter(line => line.startsWith("{")).map(line => JSON.parse(line));
assert.equal(frames.length, 3);
for (const frame of frames) {
  await verifyCloudStudentWrite(frame.body, frame.receipt, frame.workspace_id, async (operation, body) => {
    assert.equal(operation, "students");
    assert.equal(body.action, frame.response.action);
    return frame.response;
  });
  if (frame.kind !== "import") {
    const history = normalizeCloudStudentProfileHistory(frame.response, frame.workspace_id, frame.receipt.student_id);
    assert.match(history.versions.at(-1).versionId, /^student-profile-[A-Za-z0-9_-]{43}$/);
    assert.equal(history.profileRevision, frame.kind === "update" ? 1 : 2);
  }
}
console.log(errors.trim());
console.log("PASS real PostgreSQL import/update/restore receipts and rereads satisfy the cloud verifier and Core version-ID adapter; all schema/data changes rolled back.");
