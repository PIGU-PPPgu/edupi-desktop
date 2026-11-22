#!/usr/bin/env bash

set -euo pipefail

remote_host="${EDUPI_REMOTE_HOST:-ubuntu@43.134.4.108}"
remote_command='
set -euo pipefail
. /srv/edupi-supabase/.supabase.env

workdir="/tmp/edupi-cloud-e2-$$"
mkdir -p "$workdir"

cleanup() {
  set +e
  if [ -n "${object_key:-}" ]; then
    curl -sS -o /dev/null -X DELETE "$API_URL/storage/v1/object/edupi-materials/$object_key" \
      -H "apikey: $SERVICE_ROLE_KEY" \
      -H "Authorization: Bearer $SERVICE_ROLE_KEY"
  fi
  if [ -n "${workspace_id:-}" ]; then
    docker exec supabase_db_edupi-desktop psql -U postgres -d postgres -v ON_ERROR_STOP=1 \
      -c "delete from edupi.workspaces where id = '\''$workspace_id'\'';" >/dev/null 2>&1
  fi
  if [ -n "${user_id:-}" ]; then
    curl -sS -o /dev/null -X DELETE "$API_URL/auth/v1/admin/users/$user_id" \
      -H "apikey: $SERVICE_ROLE_KEY" \
      -H "Authorization: Bearer $SERVICE_ROLE_KEY"
  fi
  rm -rf "$workdir"
}
trap cleanup EXIT

request() {
  local method="$1"
  local path="$2"
  local body="$3"
  local -a headers
  headers=(
    -H "apikey: $ANON_KEY"
    -H "Authorization: Bearer $access_token"
    -H "content-type: application/json"
  )
  if [ -n "${workspace_id:-}" ]; then
    headers+=(-H "x-edupi-workspace-id: $workspace_id")
  fi
  curl -sS -o "$workdir/response.json" -w "%{http_code}" -X "$method" \
    "$API_URL$path" "${headers[@]}" --data "$body"
}

expect_status() {
  local label="$1"
  local actual="$2"
  local expected="$3"
  if [ "$actual" != "$expected" ]; then
    printf "FAIL %s status=%s expected=%s body=" "$label" "$actual" "$expected"
    jq -c "{code,error}" "$workdir/response.json" 2>/dev/null || true
    exit 1
  fi
  printf "PASS %s status=%s\n" "$label" "$actual"
}

expect_field() {
  local label="$1"
  local expression="$2"
  local expected="$3"
  local actual
  actual="$(jq -r "$expression" "$workdir/response.json")"
  if [ "$actual" != "$expected" ]; then
    printf "FAIL %s actual=%s expected=%s\n" "$label" "$actual" "$expected"
    exit 1
  fi
  printf "PASS %s\n" "$label"
}

expect_upload_status() {
  case "$1" in
    200|201) printf "PASS material-upload status=%s\n" "$1" ;;
    *) printf "FAIL material-upload status=%s\n" "$1"; cat "$workdir/upload.json"; exit 1 ;;
  esac
}

expect_denied_status() {
  case "$1" in
    401|403) printf "PASS %s status=%s\n" "$2" "$1" ;;
    *) printf "FAIL %s status=%s\n" "$2" "$1"; exit 1 ;;
  esac
}

email="edupi-cloud-test-$(date +%s)-$$@example.invalid"
password="EdU$(date +%s)Cloud!Test"
signup_body="$(jq -nc --arg email "$email" --arg password "$password" \
  "{email:\$email,password:\$password}")"
status="$(curl -sS -o "$workdir/signup.json" -w "%{http_code}" -X POST \
  "$API_URL/auth/v1/signup" -H "apikey: $ANON_KEY" \
  -H "content-type: application/json" --data "$signup_body")"
[ "$status" = 200 ] || {
  echo "FAIL auth signup status=$status"
  jq -c "{code,error,msg}" "$workdir/signup.json"
  exit 1
}
access_token="$(jq -r ".access_token // empty" "$workdir/signup.json")"
user_id="$(jq -r ".user.id // empty" "$workdir/signup.json")"
[ -n "$access_token" ] && [ -n "$user_id" ] || {
  echo "FAIL auth signup missing session"
  exit 1
}
printf "PASS auth signup status=%s\n" "$status"

status="$(curl -sS -o "$workdir/account.json" -w "%{http_code}" -X GET \
  "$API_URL/functions/v1/edupi-account" -H "apikey: $ANON_KEY" \
  -H "Authorization: Bearer $access_token")"
[ "$status" = 200 ] || { echo "FAIL account list status=$status"; exit 1; }
printf "PASS account list status=%s\n" "$status"

workspace_request="cloud-workspace-$(date +%s)-$$"
body="$(jq -nc --arg request_id "$workspace_request" \
  "{action:\"create_workspace\",request_id:\$request_id,mode:\"cloud\"}")"
status="$(request POST /functions/v1/edupi-account "$body")"
expect_status workspace-create "$status" 201
workspace_id="$(jq -r ".workspace_id // empty" "$workdir/response.json")"
[ -n "$workspace_id" ] || { echo "FAIL workspace-create missing workspace_id"; exit 1; }
expect_field workspace-create-external-send ".external_send" false
status="$(request POST /functions/v1/edupi-account "$body")"
expect_status workspace-create-replay "$status" 200
expect_field workspace-create-replayed ".replayed" true
expect_field workspace-create-replay-same-id ".workspace_id" "$workspace_id"

direct_body="{\"task_id\":\"direct-write-must-fail\",\"title\":\"不能绕过 writer\"}"
status="$(curl -sS -o "$workdir/direct-write.json" -w "%{http_code}" -X POST \
  "$API_URL/rest/v1/tasks" -H "apikey: $ANON_KEY" \
  -H "Authorization: Bearer $access_token" -H "Content-Profile: edupi" \
  -H "Prefer: return=representation" -H "content-type: application/json" \
  --data "$direct_body")"
expect_denied_status "$status" direct-canonical-table-write

body="{\"operation\":\"snapshot\"}"
status="$(request POST /functions/v1/edupi-core-broker "$body")"
expect_status snapshot-initial "$status" 200
snapshot_id="$(jq -r ".snapshot_id // empty" "$workdir/response.json")"
[ -n "$snapshot_id" ] || { echo "FAIL snapshot missing snapshot_id"; exit 1; }
expect_field snapshot-external-send ".external_send" false

body="{\"operation\":\"mobile-dashboard\"}"
status="$(request POST /functions/v1/edupi-core-broker "$body")"
expect_status mobile-dashboard "$status" 200
expect_field mobile-dashboard-contract ".contract.contract_id" edupi-mobile-dashboard-v1
expect_field mobile-dashboard-version ".contract.contract_version" 1.0
expect_field mobile-dashboard-external-send ".external_send" false

invalid_fact="{\"operation\":\"education-facts\",\"action\":\"capture\",\"request_id\":\"invalid-fact-kind\",\"fact_id\":\"invalid-fact-kind\",\"entity_id\":\"student-cloud-e2\",\"fact_kind\":\"learning\",\"predicate\":\"bad\",\"value\":\"bad\",\"external_send\":false}"
status="$(request POST /functions/v1/edupi-core-broker "$invalid_fact")"
expect_status invalid-fact-kind "$status" 400
expect_field invalid-fact-kind-code ".code" invalid_fact_request

task_id="task-cloud-e2-$$"
task_request="task-create-$(date +%s)-$$"
task_envelope="$(jq -nc --arg snapshot_id "$snapshot_id" --arg request_id "$task_request" \
  --arg task_id "$task_id" \
  "{contract_version:\"1.1\",message_id:(\$request_id+\"-message\"),request_id:\$request_id,idempotency_key:(\$request_id+\"-idem\"),issued_at:(now|todateiso8601),producer:\"edupi-cloud-e2\",schema_hash:\"sha256:2749b1208b47bf475bd30d266b5ca1b213aa78c6c8b4dcd53059c524400565c8\",snapshot_id:\$snapshot_id,provenance:[],teacher_review:{state:\"pending_review\",reviewer_id:null,reviewed_at:null,note:null,revision:0},external_send:false,command:{command_type:\"create_task\",task:{task_id:\$task_id,title:\"云端验收任务\",due_date:\"2026-11-30\",note:\"隔离验收\",board_stage:\"todo\",board_revision:0,status:\"planned\",external_send:false}}}")"
body="$(jq -nc --arg envelope "$task_envelope" \
  "{operation:\"command\",envelope:(\$envelope|fromjson)}")"
status="$(request POST /functions/v1/edupi-core-broker "$body")"
expect_status task-create "$status" 200
expect_field task-create-replayed ".replayed" false
task_snapshot_id="$(jq -r ".snapshot_id // empty" "$workdir/response.json")"
status="$(request POST /functions/v1/edupi-core-broker "$body")"
expect_status task-replay "$status" 200
expect_field task-replayed ".replayed" true
expect_field task-replay-same-snapshot ".snapshot_id" "$task_snapshot_id"

stale_body="$(jq -nc --arg snapshot_id "$snapshot_id" \
  "{operation:\"command\",envelope:{contract_version:\"1.1\",message_id:\"stale-message\",request_id:\"stale-task-$$\",idempotency_key:\"stale-idem\",issued_at:(now|todateiso8601),producer:\"edupi-cloud-e2\",schema_hash:\"sha256:2749b1208b47bf475bd30d266b5ca1b213aa78c6c8b4dcd53059c524400565c8\",snapshot_id:\$snapshot_id,provenance:[],teacher_review:{state:\"pending_review\",reviewer_id:null,reviewed_at:null,note:null,revision:0},external_send:false,command:{command_type:\"create_task\",task:{task_id:\"stale-task\",title:\"过期快照\",board_stage:\"todo\",board_revision:0,status:\"planned\",external_send:false}}}}")"
status="$(request POST /functions/v1/edupi-core-broker "$stale_body")"
expect_status task-stale-snapshot "$status" 409
expect_field task-stale-code ".code" stale_snapshot

fact_id="fact-cloud-e2-$$"
fact_request="fact-capture-$$"
body="$(jq -nc --arg request_id "$fact_request" --arg fact_id "$fact_id" \
  "{operation:\"education-facts\",action:\"capture\",request_id:\$request_id,fact_id:\$fact_id,entity_id:\"student-cloud-e2\",fact_kind:\"academic\",predicate:\"needs_review\",value:\"分数运算\",subject_ref:\"student-cloud-e2\",topic_ref:\"math\",confidence:{basis:\"explicit\",score:0.9},source_ids:[\"cloud-e2-source\"],observation_ids:[],conflict_ids:[],external_send:false}")"
status="$(request POST /functions/v1/edupi-core-broker "$body")"
expect_status fact-capture "$status" 200
expect_field fact-capture-status ".status" candidate
status="$(request POST /functions/v1/edupi-core-broker "$body")"
expect_status fact-capture-replay "$status" 200
expect_field fact-capture-replayed ".replayed" true

body="$(jq -nc --arg fact_id "$fact_id" \
  "{operation:\"education-facts\",action:\"review\",request_id:(\"fact-review-\"+\$fact_id),fact_id:\$fact_id,expected_revision:0,decision:\"accept\",reviewer:\"teacher\",note:\"云端验收\",external_send:false}")"
status="$(request POST /functions/v1/edupi-core-broker "$body")"
expect_status fact-accept "$status" 200
expect_field fact-accept-status ".status" accepted
body="$(jq -nc --arg fact_id "$fact_id" \
  "{operation:\"education-facts\",action:\"delete\",request_id:(\"fact-delete-\"+\$fact_id),fact_id:\$fact_id,expected_revision:1,external_send:false}")"
status="$(request POST /functions/v1/edupi-core-broker "$body")"
expect_status fact-delete "$status" 200
expect_field fact-delete-status ".status" deleted
body="$(jq -nc --arg fact_id "$fact_id" \
  "{operation:\"education-facts\",action:\"restore\",request_id:(\"fact-restore-\"+\$fact_id),fact_id:\$fact_id,expected_revision:2,external_send:false}")"
status="$(request POST /functions/v1/edupi-core-broker "$body")"
expect_status fact-restore "$status" 200
expect_field fact-restore-status ".status" accepted
body="$(jq -nc --arg fact_id "$fact_id" \
  "{operation:\"education-facts\",action:\"read\",request_id:\"fact-read\",fact_id:\$fact_id}")"
status="$(request POST /functions/v1/edupi-core-broker "$body")"
expect_status fact-read "$status" 200
expect_field fact-read-status ".fact.status" accepted

body="{\"operation\":\"education-facts\",\"action\":\"read_spine\",\"request_id\":\"spine-read\"}"
status="$(request POST /functions/v1/edupi-core-broker "$body")"
expect_status fact-spine-read "$status" 200
spine_hash="$(jq -r ".state_hash // empty" "$workdir/response.json")"
spine_body="$(jq -nc --arg expected "$spine_hash" \
  "{operation:\"education-facts\",action:\"replace_spine\",request_id:\"spine-replace\",expected_state_hash:\$expected,spine:{projection_kind:\"education_fact_v1\",acceptedFacts:[],factCandidates:[],external_send:false}}")"
status="$(request POST /functions/v1/edupi-core-broker "$spine_body")"
expect_status fact-spine-replace "$status" 200
status="$(request POST /functions/v1/edupi-core-broker "$spine_body")"
expect_status fact-spine-replace-replay "$status" 200

body="{\"operation\":\"snapshot\"}"
status="$(request POST /functions/v1/edupi-core-broker "$body")"
expect_status snapshot-after-facts "$status" 200
snapshot_id="$(jq -r ".snapshot_id" "$workdir/response.json")"

material_id="material-cloud-e2-$$"
material_request="material-intake-$$"
material_envelope="$(jq -nc --arg snapshot_id "$snapshot_id" --arg request_id "$material_request" \
  --arg material_id "$material_id" \
  "{contract_version:\"1.1\",message_id:(\$request_id+\"-message\"),request_id:\$request_id,idempotency_key:(\$request_id+\"-idem\"),issued_at:(now|todateiso8601),producer:\"edupi-cloud-e2\",schema_hash:\"sha256:2749b1208b47bf475bd30d266b5ca1b213aa78c6c8b4dcd53059c524400565c8\",snapshot_id:\$snapshot_id,provenance:[],teacher_review:{state:\"pending_review\",reviewer_id:null,reviewed_at:null,note:null,revision:0},external_send:false,command:{command_type:\"intake_material\",material:{material_id:\$material_id,title:\"云端材料\",kind:\"lesson_note\",subject:\"数学\",class_id:\"703\",source_hash:\"sha256:cloud-e2\",external_send:false}}}")"
body="$(jq -nc --arg envelope "$material_envelope" \
  "{operation:\"command\",envelope:(\$envelope|fromjson)}")"
status="$(request POST /functions/v1/edupi-core-broker "$body")"
expect_status material-intake "$status" 200

body="$(jq -nc --arg material_id "$material_id" \
  "{operation:\"material-metadata\",action:\"update\",request_id:(\"material-update-\"+\$material_id),material_id:\$material_id,expected_revision:0,patch:{title:\"云端材料已改名\",subject:\"数学\",class_id:\"703\"},external_send:false}")"
status="$(request POST /functions/v1/edupi-core-broker "$body")"
expect_status material-update "$status" 200
expect_field material-update-revision ".revision" 1
status="$(request POST /functions/v1/edupi-core-broker "$body")"
expect_status material-update-replay "$status" 200
expect_field material-update-replayed ".replayed" true
body="$(jq -nc --arg material_id "$material_id" \
  "{operation:\"workspace-resources\",material_id:\$material_id,request_id:\"material-history\"}")"
status="$(request POST /functions/v1/edupi-core-broker "$body")"
expect_status material-history "$status" 200
expect_field material-history-count ".materialMetadataVersions.history_count" 1

data="edupi cloud upload test\n"
sha="$(printf "%s" "$data" | sha256sum | awk "{print \$1}")"
body="$(jq -nc --arg material_id "$material_id" --arg sha256 "sha256:$sha" \
  "{action:\"create_upload\",material_id:\$material_id,file_name:\"cloud-test.txt\",content_type:\"text/plain\",size_bytes:25,sha256:\$sha256}")"
status="$(request POST /functions/v1/edupi-materials "$body")"
expect_status material-upload-url "$status" 200
object_key="$(jq -r ".object_key // empty" "$workdir/response.json")"
upload_token="$(jq -r ".token // empty" "$workdir/response.json")"
[ -n "$object_key" ] && [ -n "$upload_token" ] || {
  echo "FAIL material-upload-url missing upload data"
  exit 1
}
status="$(printf "%s" "$data" | curl -sS -o "$workdir/upload.json" -w "%{http_code}" \
  -X PUT --path-as-is \
  "$API_URL/storage/v1/object/upload/sign/edupi-materials/$object_key?token=$upload_token" \
  -H "content-type: text/plain" --data-binary @-)"
expect_upload_status "$status"
status="$(curl -sS -o "$workdir/private-read.json" -w "%{http_code}" \
  "$API_URL/storage/v1/object/edupi-materials/$object_key")"
case "$status" in
  400|401|403|404) printf "PASS private-material-anonymous-read status=%s\n" "$status" ;;
  *) printf "FAIL private-material-anonymous-read status=%s\n" "$status"; exit 1 ;;
esac

body="{\"operation\":\"snapshot\"}"
status="$(request POST /functions/v1/edupi-core-broker "$body")"
expect_status snapshot-before-classroom "$status" 200

class_id="classroom-cloud-e2-$$"
body="$(jq -nc --arg id "$class_id" \
  "{domain:\"grades\",action:\"preview\",id:\$id,input:{title:\"云端成绩方案\",class_name:\"703\"},result:{rows:[]},issues:[],request_id:(\"classroom-preview-\"+\$id)}")"
status="$(request POST /functions/v1/edupi-classroom "$body")"
expect_status classroom-preview "$status" 200
body="$(jq -nc --arg id "$class_id" \
  "{domain:\"grades\",action:\"save\",id:\$id,input:{title:\"云端成绩方案\",class_name:\"703\"},result:{rows:[{student_id:\"student-cloud-e2\",score:95}]},issues:[],request_id:(\"classroom-save-\"+\$id)}")"
status="$(request POST /functions/v1/edupi-classroom "$body")"
expect_status classroom-save "$status" 200
expect_field classroom-save-revision ".record.revision" 0
body="$(jq -nc --arg id "$class_id" \
  "{domain:\"grades\",action:\"read\",id:\$id,request_id:(\"classroom-read-\"+\$id)}")"
status="$(request POST /functions/v1/edupi-classroom "$body")"
expect_status classroom-read "$status" 200
expect_field classroom-read-title ".record.input.title" "云端成绩方案"

status="$(curl -sS -o "$workdir/events.json" -w "%{http_code}" -X GET \
  "$API_URL/functions/v1/edupi-student-events?limit=20" \
  -H "apikey: $ANON_KEY" -H "Authorization: Bearer $access_token" \
  -H "x-edupi-workspace-id: $workspace_id")"
expect_status student-events-list "$status" 200
docker exec supabase_db_edupi-desktop psql -X -q -U postgres -d postgres -v ON_ERROR_STOP=1 -c "
  insert into edupi.student_profiles(workspace_id,student_id,name) values
    ('\''$workspace_id'\'','\''filter-exact'\'','\''SyntheticExact'\''),
    ('\''$workspace_id'\'','\''filter-other'\'','\''SyntheticOther'\''),
    ('\''$workspace_id'\'','\''filter-duplicate-one'\'','\''SyntheticDuplicate'\''),
    ('\''$workspace_id'\'','\''filter-duplicate-two'\'','\''SyntheticDuplicate'\'');
  insert into edupi.student_events(workspace_id,event_id,kind,student_ids,student_labels,summary,recorded_at,updated_at,source) values
    ('\''$workspace_id'\'','\''filter-event-exact'\'','\''learning'\'',array['\''filter-exact'\''],array['\''SyntheticExact'\''],'\''isolated exact event'\'',now(),now(),'\''{}'\''),
    ('\''$workspace_id'\'','\''filter-event-other'\'','\''learning'\'',array['\''filter-other'\''],array['\''SyntheticOther'\''],'\''isolated other event'\'',now(),now(),'\''{}'\'');"
for name in SyntheticExact SyntheticMissing SyntheticDuplicate; do
  status="$(curl -sS -o "$workdir/response.json" -w "%{http_code}" \
    "$API_URL/functions/v1/edupi-student-events?student=$name" \
    -H "apikey: $ANON_KEY" -H "Authorization: Bearer $access_token" \
    -H "x-edupi-workspace-id: $workspace_id")"
  expect_status "student-name-$name" "$status" 200
  if [ "$name" = SyntheticExact ]; then
    expect_field student-name-exact-object ".record_ids | join(\",\")" filter-event-exact
    expect_field student-name-exact-total ".total" 1
  else
    expect_field "student-name-empty-$name" ".records | length" 0
  fi
done
body="{\"action\":\"set_topic_alias\",\"alias\":\"分数运算\",\"canonical\":\"数与式\"}"
status="$(request POST /functions/v1/edupi-student-events "$body")"
expect_status student-events-alias "$status" 200

instance_id="runtime-cloud-e2-$$"
instance_nonce="nonce-cloud-e2-$$"
runtime_body="$(jq -nc --arg instance_id "$instance_id" --arg instance_nonce "$instance_nonce" \
  "{operation:\"runtime\",action:\"register\",instance_id:\$instance_id,instance_nonce:\$instance_nonce,core_commit:\"3ce22b1e08804aa36dccf59d76a8e61b15f2c462\",component_manifest_hash:\"sha256:runtime-test\",runtime_schema_hash:\"sha256:schema-test\",data_root_fingerprint:\"sha256:data-test\",capabilities:{cloud_writer:true},metadata:{source:\"remote-e2\"}}")"
status="$(request POST /functions/v1/edupi-core-runtime "$runtime_body")"
expect_status runtime-register "$status" 200
generation="$(jq -r ".fencing_generation" "$workdir/response.json")"
lease_body="$(jq -nc --arg instance_id "$instance_id" --arg instance_nonce "$instance_nonce" \
  --arg generation "$generation" \
  "{operation:\"runtime\",action:\"lease_acquire\",instance_id:\$instance_id,instance_nonce:\$instance_nonce,fencing_generation:(\$generation|tonumber),lease_name:\"core-writer\",ttl_seconds:30}")"
status="$(request POST /functions/v1/edupi-core-runtime "$lease_body")"
expect_status runtime-lease-acquire "$status" 200
lease_token="$(jq -r ".lease_token // empty" "$workdir/response.json")"
[ -n "$lease_token" ] || { echo "FAIL runtime lease missing token"; exit 1; }
renew_body="$(jq -nc --arg instance_id "$instance_id" --arg instance_nonce "$instance_nonce" \
  --arg generation "$generation" --arg token "$lease_token" \
  "{operation:\"runtime\",action:\"lease_renew\",instance_id:\$instance_id,instance_nonce:\$instance_nonce,fencing_generation:(\$generation|tonumber),lease_name:\"core-writer\",lease_token:\$token,ttl_seconds:30}")"
status="$(request POST /functions/v1/edupi-core-runtime "$renew_body")"
expect_status runtime-lease-renew "$status" 200
event_body="$(jq -nc --arg instance_id "$instance_id" --arg instance_nonce "$instance_nonce" \
  --arg generation "$generation" --arg token "$lease_token" \
  "{operation:\"runtime\",action:\"event\",instance_id:\$instance_id,instance_nonce:\$instance_nonce,fencing_generation:(\$generation|tonumber),lease_name:\"core-writer\",lease_token:\$token,event_kind:\"remote_e2\",payload:{ok:true}}")"
status="$(request POST /functions/v1/edupi-core-runtime "$event_body")"
expect_status runtime-event "$status" 200
release_body="$(jq -nc --arg instance_id "$instance_id" --arg instance_nonce "$instance_nonce" \
  --arg generation "$generation" --arg token "$lease_token" \
  "{operation:\"runtime\",action:\"lease_release\",instance_id:\$instance_id,instance_nonce:\$instance_nonce,fencing_generation:(\$generation|tonumber),lease_name:\"core-writer\",lease_token:\$token}")"
status="$(request POST /functions/v1/edupi-core-runtime "$release_body")"
expect_status runtime-lease-release "$status" 200
replacement_nonce="nonce-cloud-e2-replaced-$$"
replacement="$(jq -nc --arg instance_id "$instance_id" --arg instance_nonce "$replacement_nonce" \
  "{operation:\"runtime\",action:\"register\",instance_id:\$instance_id,instance_nonce:\$instance_nonce,core_commit:\"3ce22b1e08804aa36dccf59d76a8e61b15f2c462\",capabilities:{cloud_writer:true},metadata:{source:\"remote-e2-replaced\"}}")"
status="$(request POST /functions/v1/edupi-core-runtime "$replacement")"
expect_status runtime-replace-instance "$status" 200
old_heartbeat="$(jq -nc --arg instance_id "$instance_id" --arg instance_nonce "$instance_nonce" \
  --arg generation "$generation" \
  "{operation:\"runtime\",action:\"heartbeat\",instance_id:\$instance_id,instance_nonce:\$instance_nonce,fencing_generation:(\$generation|tonumber)}")"
status="$(request POST /functions/v1/edupi-core-runtime "$old_heartbeat")"
expect_status runtime-old-generation-fenced "$status" 409
expect_field runtime-old-generation-code ".code" runtime_fenced

printf "%s\n" "REMOTE E2 COMPLETE"
'

ssh -T -i "${EDUPI_SSH_KEY:-$HOME/.ssh/id_ed25519}" \
  -o BatchMode=yes -o StrictHostKeyChecking=accept-new "$remote_host" \
  'bash -s' <<< "$remote_command"
