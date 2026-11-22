-- Computation is performed by the pinned Core pure engines on the host. Empty
-- previews and caller-created task links are no longer admitted by the writer.
alter table edupi.classroom_objects add column if not exists computation jsonb;
alter table edupi.classroom_object_versions add column if not exists computation jsonb;
create table if not exists edupi.classroom_write_receipts (
  workspace_id uuid not null references edupi.workspaces(id) on delete cascade,
  request_id text not null, actor_id uuid not null references auth.users(id),
  request_hash text not null, response jsonb not null, created_at timestamptz not null default now(),
  primary key(workspace_id,request_id)
);
alter table edupi.classroom_write_receipts enable row level security;
revoke all on edupi.classroom_write_receipts from public, anon, authenticated;
grant all on edupi.classroom_write_receipts to service_role;
create table if not exists edupi.classroom_computation_admissions (
  workspace_id uuid not null references edupi.workspaces(id) on delete cascade,
  request_id text not null, actor_id uuid not null references auth.users(id),
  request_hash text not null, created_at timestamptz not null default now(),
  primary key(workspace_id,request_id)
);
alter table edupi.classroom_computation_admissions enable row level security;
revoke all on edupi.classroom_computation_admissions from public,anon,authenticated;
grant all on edupi.classroom_computation_admissions to service_role;

-- Only the Edge service role can attest after independently running the pinned
-- engine. The legacy broker exposes only mutate_classroom_object, so it cannot
-- bypass computation by forwarding a fabricated result.
create or replace function edupi.admit_classroom_computation(target_workspace uuid,actor_id uuid,classroom_request jsonb)
returns jsonb language plpgsql security definer set search_path=pg_catalog,edupi as $$
#variable_conflict use_variable
declare rid text:=classroom_request->>'request_id'; prior edupi.classroom_computation_admissions%rowtype;
begin
  if not exists(select 1 from edupi.workspace_members m where m.workspace_id=target_workspace
    and m.account_id=actor_id and m.revoked_at is null and m.role in ('owner','teacher','admin')) then raise exception 'workspace_forbidden'; end if;
  if rid is null or rid !~ '^[A-Za-z0-9_-]{1,160}$' then raise exception 'invalid_request'; end if;
  perform pg_advisory_xact_lock(hashtextextended('edupi-classroom-request:'||target_workspace::text||':'||rid,0));
  select * into prior from edupi.classroom_computation_admissions a where a.workspace_id=target_workspace and a.request_id=rid;
  if found then
    if prior.actor_id<>actor_id or prior.request_hash<>edupi.json_sha256(classroom_request) then raise exception 'idempotency_conflict'; end if;
  else
    insert into edupi.classroom_computation_admissions(workspace_id,request_id,actor_id,request_hash)
      values(target_workspace,rid,actor_id,edupi.json_sha256(classroom_request));
  end if;
  return jsonb_build_object('ok',true,'request_id',rid,'external_send',false);
end $$;
revoke all on function edupi.admit_classroom_computation(uuid,uuid,jsonb) from public,anon,authenticated;
grant execute on function edupi.admit_classroom_computation(uuid,uuid,jsonb) to service_role;

create or replace function edupi.cloud_classroom_read(target_workspace uuid, actor_id uuid, classroom_request jsonb)
returns jsonb language plpgsql security definer set search_path=pg_catalog,edupi as $$
#variable_conflict use_variable
declare
  action text:=classroom_request->>'action'; domain text:=classroom_request->>'domain';
  oid text:=classroom_request->>'id'; version integer:=(classroom_request->>'revision')::integer;
  base jsonb; item jsonb; task_value jsonb;
begin
  if not exists(select 1 from edupi.workspace_members m where m.workspace_id=target_workspace
    and m.account_id=actor_id and m.revoked_at is null) then raise exception 'workspace_forbidden'; end if;
  if domain not in ('grades','seating','duty') or action not in ('roster','list','read') then raise exception 'invalid_request'; end if;
  base:=jsonb_build_object('ok',true,'operation','classroom','action',action,'workspace_id',target_workspace,
    'request_id',classroom_request->>'request_id','external_send',false);
  if action='roster' then
    return base||jsonb_build_object('students',coalesce((select jsonb_agg(jsonb_build_object(
      'student_id',s.student_id,'name',s.name,'class_name',coalesce(s.class_name,''),
      'traits',coalesce(s.profile->'traits','[]'::jsonb),'revision',s.revision,'profile_revision',s.profile_revision)
      order by s.student_id) from edupi.student_profiles s where s.workspace_id=target_workspace and s.deleted_at is null),'[]'::jsonb));
  elsif action='list' then
    return base||jsonb_build_object('records',coalesce((select jsonb_agg(jsonb_build_object(
      'id',c.object_id,'domain',c.domain,'title',c.input->>'title','class_name',c.input->>'class_name',
      'revision',c.revision,'updated_at',c.updated_at,'date',coalesce(c.input->>'date',c.input->>'start_date'),
      'mode',c.input->>'mode','task_id',c.task_id) order by c.updated_at desc)
      from edupi.classroom_objects c where c.workspace_id=target_workspace and c.domain=domain and c.deleted_at is null),'[]'::jsonb));
  end if;
  select jsonb_build_object('id',c.object_id,'domain',c.domain,'revision',c.revision,'created_at',c.created_at,
    'updated_at',c.updated_at,'input',c.input,'result',c.result,'issues',c.issues,'versions',c.versions,
    'task_id',c.task_id,'publication',c.publication,'computation',c.computation) into item
    from edupi.classroom_objects c where c.workspace_id=target_workspace and c.object_id=oid and c.domain=domain and c.deleted_at is null;
  if item is null then raise exception 'not_found'; end if;
  if version is not null then
    select item||jsonb_build_object('revision',v.revision,'updated_at',v.created_at,'input',v.input,'result',v.result,
      'issues',v.issues,'computation',v.computation,'versions',coalesce((select jsonb_agg(e order by (e->>'revision')::integer)
        from jsonb_array_elements(item->'versions') e where (e->>'revision')::integer<=version),'[]'::jsonb)) into item
      from edupi.classroom_object_versions v where v.workspace_id=target_workspace and v.object_id=oid and v.revision=version;
    if item is null then raise exception 'version_not_found'; end if;
  end if;
  select jsonb_build_object('task_id',t.task_id,'title',t.title,'due_date',t.due_date,'note',t.note,
    'stage',t.stage,'status',t.status,'revision',t.revision) into task_value from edupi.tasks t
    where t.workspace_id=target_workspace and t.task_id=item->>'task_id' and t.deleted_at is null;
  return base||jsonb_build_object('record',item,'task',task_value);
end $$;
revoke all on function edupi.cloud_classroom_read(uuid,uuid,jsonb) from public,anon,authenticated;
grant execute on function edupi.cloud_classroom_read(uuid,uuid,jsonb) to service_role;

create or replace function edupi.mutate_classroom_object(target_workspace uuid, actor_id uuid, classroom_request jsonb)
returns jsonb language plpgsql security definer set search_path=pg_catalog,edupi,extensions as $$
#variable_conflict use_variable
declare
  action text:=classroom_request->>'action'; domain text:=classroom_request->>'domain';
  oid text:=classroom_request->>'id'; rid text:=classroom_request->>'request_id';
  expected integer:=(classroom_request->>'expected_revision')::integer;
  computed jsonb:=classroom_request->'computed'; source jsonb:=classroom_request->'source_request';
  current_object edupi.classroom_objects%rowtype; historical edupi.classroom_object_versions%rowtype;
  receipt edupi.classroom_write_receipts%rowtype; fingerprint text:=edupi.json_sha256(classroom_request);
  next_revision integer; roster_value jsonb; ref jsonb; actual_ref edupi.classroom_objects%rowtype;
  ids jsonb; student_id_value text; class_value text; publication_value jsonb; task_id_value text;
  task_title text; task_note text; task_due date; task_json jsonb; response jsonb; now_value timestamptz:=clock_timestamp();
begin
  if not exists(select 1 from edupi.workspace_members m where m.workspace_id=target_workspace
    and m.account_id=actor_id and m.revoked_at is null and m.role in ('owner','teacher','admin')) then raise exception 'workspace_forbidden'; end if;
  if domain not in ('grades','seating','duty') or action not in ('save','restore','publish')
    or oid is null or oid !~ '^[A-Za-z0-9_-]{1,120}$' or rid is null or rid !~ '^[A-Za-z0-9_-]{1,160}$'
    or expected is null or expected<0 or expected>2147483646 then raise exception 'invalid_request'; end if;
  perform 1 from edupi.workspaces where id=target_workspace for update;
  perform pg_advisory_xact_lock(hashtextextended('edupi-classroom-request:'||target_workspace::text||':'||rid,0));
  select * into receipt from edupi.classroom_write_receipts r where r.workspace_id=target_workspace and r.request_id=rid;
  if found then
    if receipt.actor_id<>actor_id or receipt.request_hash<>fingerprint then raise exception 'idempotency_conflict'; end if;
    return receipt.response||jsonb_build_object('replayed',true);
  end if;
  if not exists(select 1 from edupi.classroom_computation_admissions a where a.workspace_id=target_workspace
    and a.request_id=rid and a.actor_id=actor_id and a.request_hash=fingerprint) then raise exception 'compute_admission_required'; end if;
  if jsonb_typeof(source) is distinct from 'object' or source->>'domain' is distinct from domain
    or source->>'action' is distinct from action or source->>'id' is distinct from oid
    or source->>'request_id' is distinct from rid or source->'expected_revision' is distinct from classroom_request->'expected_revision'
    or jsonb_typeof(computed) is distinct from 'object'
    or computed->>'core_commit' is distinct from 'fc89b3bc899a55b0fdad61b8f37e238d950f37c6'
    or jsonb_typeof(computed->'input') is distinct from 'object'
    or jsonb_typeof(computed->'source_input') is distinct from 'object'
    or jsonb_typeof(computed->'result') is distinct from 'object' or computed->'result'='{}'::jsonb
    or jsonb_typeof(computed->'issues') is distinct from 'array'
    or jsonb_typeof(computed->'references') is distinct from 'array'
    or jsonb_typeof(computed->'roster') is distinct from 'array'
    or exists(select 1 from jsonb_array_elements(computed->'issues') i where i->>'severity'='error')
    or jsonb_array_length(coalesce(computed->'unresolved','[]'::jsonb))>0 then raise exception 'compute_required'; end if;
  perform pg_advisory_xact_lock(hashtextextended('edupi-classroom:'||target_workspace::text||':'||oid,0));
  select * into current_object from edupi.classroom_objects c where c.workspace_id=target_workspace and c.object_id=oid for update;
  if found and (current_object.domain<>domain or current_object.deleted_at is not null) then raise exception 'not_found'; end if;
  if coalesce(current_object.revision,0)<>expected then raise exception 'stale_revision'; end if;
  if current_object.object_id is null and action<>'save' then raise exception 'not_found'; end if;
  if jsonb_array_length(coalesce(current_object.versions,'[]'::jsonb))>=100 then raise exception 'invalid_capacity'; end if;
  -- Lock and compare the exact authoritative roster used by the host calculation.
  perform 1 from edupi.student_profiles s where s.workspace_id=target_workspace and s.deleted_at is null order by s.student_id for share;
  select edupi.cloud_classroom_read(target_workspace,actor_id,jsonb_build_object('domain',domain,'action','roster'))->'students' into roster_value;
  if computed->'roster' is distinct from roster_value then raise exception 'stale_roster'; end if;
  class_value:=computed->'input'->>'class_name';
  if domain='grades' then
    select coalesce(jsonb_agg(r->'student_id'),'[]'::jsonb) into ids from jsonb_array_elements(computed->'input'->'rows') r;
    if jsonb_typeof(computed->'result'->'subjects') is distinct from 'array'
      or jsonb_typeof(computed->'result'->'students') is distinct from 'array' then raise exception 'compute_required'; end if;
  else
    ids:=computed->'input'->'student_ids';
    if jsonb_typeof(computed->'result'->'assignments') is distinct from 'array' then raise exception 'compute_required'; end if;
  end if;
  if jsonb_typeof(ids) is distinct from 'array' or jsonb_array_length(ids)<1
    or (select count(distinct value) from jsonb_array_elements_text(ids))<>jsonb_array_length(ids) then raise exception 'invalid_students'; end if;
  for student_id_value in select jsonb_array_elements_text(ids) loop
    if not exists(select 1 from edupi.student_profiles s where s.workspace_id=target_workspace and s.student_id=student_id_value
      and s.class_name=class_value and s.deleted_at is null) then raise exception 'invalid_students'; end if;
  end loop;
  for ref in select value from jsonb_array_elements(computed->'references') order by value->>'id' loop
    select * into actual_ref from edupi.classroom_objects c where c.workspace_id=target_workspace and c.object_id=ref->>'id' for share;
    if not found or actual_ref.deleted_at is not null or actual_ref.domain<>'grades'
      or to_jsonb(actual_ref.revision) is distinct from ref->'revision'
      or actual_ref.input is distinct from ref->'input' or actual_ref.result is distinct from ref->'result'
      or actual_ref.computation->>'core_commit' is distinct from 'fc89b3bc899a55b0fdad61b8f37e238d950f37c6'
      or actual_ref.computation->'input' is distinct from actual_ref.input
      or actual_ref.computation->'result' is distinct from actual_ref.result
      or actual_ref.input->>'class_name' is distinct from class_value then raise exception 'stale_reference'; end if;
  end loop;
  for student_id_value in select value from unnest(array[computed->'input'->>'baseline_id',computed->'input'->>'exam_id']) value where value is not null loop
    if not exists(select 1 from jsonb_array_elements(computed->'references') r where r->>'id'=student_id_value)
      then raise exception 'stale_reference'; end if;
  end loop;
  if action='restore' then
    if source->'revision' is distinct from classroom_request->'revision' then raise exception 'invalid_request'; end if;
    select * into historical from edupi.classroom_object_versions v where v.workspace_id=target_workspace
      and v.object_id=oid and v.revision=(classroom_request->>'revision')::integer;
    if not found then raise exception 'version_not_found'; end if;
    if historical.input is distinct from computed->'input' or historical.result is distinct from computed->'result'
      then raise exception 'restore_changed'; end if;
  elsif action='publish' then
    if domain<>'duty' or current_object.input is distinct from computed->'input'
      or current_object.result is distinct from computed->'result' then raise exception 'invalid_publication'; end if;
  end if;
  if current_object.task_id is not null and action in ('save','restore')
    and exists(select 1 from unnest(array['title','class_name','start_date','days']) key
      where current_object.input->key is distinct from computed->'input'->key) then raise exception 'linked_identity'; end if;
  next_revision:=expected+1; publication_value:=current_object.publication; task_id_value:=current_object.task_id;
  if action='publish' then
    task_id_value:='duty-'||oid;
    if current_object.task_id is not null then raise exception 'already_published'; end if;
    task_title:=left(class_value||' '||(computed->'input'->>'title'),240);
    task_due:=(computed->'input'->>'start_date')::date;
    task_note:='值日方案 '||oid||'。从 '||(computed->'input'->>'start_date')||' 起 '||(computed->'input'->>'days')||' 天，完整排班及当前工作量见关联方案。';
    if exists(select 1 from edupi.tasks t where t.workspace_id=target_workspace and t.task_id=task_id_value)
      or exists(select 1 from edupi.teacher_tasks t where t.workspace_id=target_workspace and t.task_id=task_id_value) then raise exception 'task_conflict'; end if;
    task_json:=jsonb_build_object('task_id',task_id_value,'title',task_title,'due_date',task_due,'note',task_note,
      'board_stage','todo','board_revision',0,'status','planned','classroom_id',oid,'source_revision',expected,'external_send',false);
    insert into edupi.tasks(workspace_id,task_id,title,due_date,note,task) values(target_workspace,task_id_value,task_title,task_due,task_note,task_json);
    insert into edupi.teacher_tasks(workspace_id,task_id,title,status,revision,task) values(target_workspace,task_id_value,task_title,'planned',0,task_json);
    insert into edupi.task_versions(workspace_id,task_id,revision,action,payload,request_id) values(target_workspace,task_id_value,0,'create',task_json,rid);
    publication_value:=jsonb_build_object('task_id',task_id_value,'source_revision',expected,'state','linked');
  end if;
  if current_object.object_id is null then
    insert into edupi.classroom_objects(workspace_id,object_id,domain,revision,created_at,updated_at,input,result,issues,versions,computation)
      values(target_workspace,oid,domain,next_revision,now_value,now_value,computed->'input',computed->'result',computed->'issues','[]',computed);
  end if;
  update edupi.classroom_objects c set revision=next_revision,updated_at=now_value,input=computed->'input',result=computed->'result',
    issues=computed->'issues',computation=computed,task_id=task_id_value,publication=publication_value,
    versions=c.versions||jsonb_build_array(jsonb_build_object('revision',next_revision,'saved_at',now_value,'action',action,
      'restored_from',case when action='restore' then (classroom_request->>'revision')::integer else null end))
    where c.workspace_id=target_workspace and c.object_id=oid;
  insert into edupi.classroom_object_versions(workspace_id,object_id,revision,action,input,result,issues,restored_from,created_at,computation)
    values(target_workspace,oid,next_revision,action,computed->'input',computed->'result',computed->'issues',
      case when action='restore' then (classroom_request->>'revision')::integer else null end,now_value,computed);
  response:=edupi.cloud_classroom_read(target_workspace,actor_id,jsonb_build_object('domain',domain,'action','read','id',oid,'request_id',rid))
    ||jsonb_build_object('action',action,'replayed',false);
  insert into edupi.classroom_write_receipts(workspace_id,request_id,actor_id,request_hash,response) values(target_workspace,rid,actor_id,fingerprint,response);
  return response;
end $$;
revoke all on function edupi.mutate_classroom_object(uuid,uuid,jsonb) from public,anon,authenticated;
grant execute on function edupi.mutate_classroom_object(uuid,uuid,jsonb) to service_role;
