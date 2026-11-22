-- Run inside a transaction after the new migration; all fixtures must roll back.
create function pg_temp.student_assert(value boolean, label text)
returns void language plpgsql as $$
begin
  if value is distinct from true then raise exception 'student regression: %', label; end if;
end;
$$;
select pg_temp.student_assert(
  to_regprocedure('edupi.mutate_students(uuid,uuid,jsonb)') is not null,
  'students writer is missing'
);

create temporary table student_fixture on commit drop as
select gen_random_uuid() workspace_id, gen_random_uuid() other_workspace_id,
  gen_random_uuid() actor_id, gen_random_uuid() other_actor_id, gen_random_uuid() revoked_id;
insert into auth.users(id)
select actor_id from student_fixture union all select other_actor_id from student_fixture
union all select revoked_id from student_fixture;
insert into edupi.workspaces(id, owner_account_id, mode)
select workspace_id, actor_id, 'cloud' from student_fixture
union all select other_workspace_id, other_actor_id, 'cloud' from student_fixture;
insert into edupi.workspace_members(workspace_id, account_id, role, revoked_at)
select workspace_id, actor_id, 'owner', null::timestamptz from student_fixture
union all select workspace_id, other_actor_id, 'teacher', null from student_fixture
union all select workspace_id, revoked_id, 'teacher', now() from student_fixture
union all select other_workspace_id, other_actor_id, 'owner', null from student_fixture;

create function pg_temp.student_rejected(workspace uuid, actor uuid, body jsonb, expected text)
returns void language plpgsql as $$
declare
  before_rows jsonb;
  before_receipts bigint;
  before_versions bigint;
  rejected boolean := false;
begin
  select jsonb_agg(to_jsonb(s) order by student_id) into before_rows
    from edupi.student_profiles s where workspace_id = workspace;
  select count(*) into before_receipts from edupi.student_write_requests where workspace_id = workspace;
  select count(*) into before_versions from edupi.student_profile_versions where workspace_id = workspace;
  begin
    perform edupi.mutate_students(workspace, actor, body);
  exception when others then
    if sqlerrm <> expected then raise; end if;
    rejected := true;
  end;
  perform pg_temp.student_assert(rejected, 'expected rejection ' || expected);
  perform pg_temp.student_assert(before_rows is not distinct from
    (select jsonb_agg(to_jsonb(s) order by student_id) from edupi.student_profiles s where workspace_id = workspace),
    'rejection changed profiles');
  perform pg_temp.student_assert(before_receipts =
    (select count(*) from edupi.student_write_requests where workspace_id = workspace), 'rejection saved receipt');
  perform pg_temp.student_assert(before_versions =
    (select count(*) from edupi.student_profile_versions where workspace_id = workspace), 'rejection saved version');
end;
$$;

do $$
declare
  f record;
  roster jsonb := '{"action":"import","request_id":"roster-a","source_name":"合成名单.csv","students":[
    {"name":"合成同名","class_name":"一班","traits":["认真"],"parent_notes":[]},
    {"name":"合成同名","class_name":"二班","traits":[],"parent_notes":["已沟通"]}
  ]}'::jsonb;
  imported jsonb;
  replayed jsonb;
  edit jsonb;
  changed jsonb;
  restored jsonb;
  target edupi.student_profiles%rowtype;
  second_id text;
begin
  select * into f from student_fixture;
  imported := edupi.mutate_students(f.workspace_id, f.actor_id, roster);
  perform pg_temp.student_assert(imported->>'imported' = '2' and imported->>'created' = '2', 'import count');
  perform pg_temp.student_assert((select count(*) = 2 from edupi.student_profiles where workspace_id=f.workspace_id), 'same-name separate classes');
  replayed := edupi.mutate_students(f.workspace_id, f.actor_id, roster);
  perform pg_temp.student_assert(replayed->>'replayed' = 'true'
    and replayed - 'replayed' = imported - 'replayed', 'exact replay receipt');
  perform pg_temp.student_rejected(f.workspace_id, f.actor_id,
    jsonb_set(roster, '{source_name}', '"different.csv"'), 'idempotency_conflict');
  perform pg_temp.student_rejected(f.workspace_id, f.other_actor_id, roster, 'idempotency_conflict');
  perform pg_temp.student_rejected(f.workspace_id, f.revoked_id, roster, 'workspace_forbidden');
  perform pg_temp.student_rejected(f.other_workspace_id, f.actor_id, roster, 'workspace_forbidden');
  replayed := edupi.mutate_students(f.other_workspace_id, f.other_actor_id, roster);
  perform pg_temp.student_assert(replayed->>'created'='2', 'request IDs scoped to workspace');
  perform pg_temp.student_rejected(f.workspace_id, f.actor_id,
    '{"action":"import","request_id":"ambiguous","source_name":"名单.csv","students":[{"name":"合成同名","traits":[],"parent_notes":[]}]}',
    'ambiguous_student');
  perform pg_temp.student_rejected(f.workspace_id, f.actor_id,
    '{"action":"import","request_id":"duplicate","source_name":"名单.csv","students":[
      {"name":"重复","class_name":"一班","traits":[],"parent_notes":[]},
      {"name":"重复","class_name":"一班","traits":[],"parent_notes":[]}]}', 'ambiguous_student');
  perform pg_temp.student_rejected(f.workspace_id, f.actor_id,
    '{"action":"import","request_id":"atomic-invalid","source_name":"名单.csv","students":[
      {"name":"不可留下的第一行","class_name":"一班","traits":[],"parent_notes":[]},
      {"name":"第二行","class_name":"一班","traits":[false],"parent_notes":[]}]}', 'invalid_request');

  select * into target from edupi.student_profiles where workspace_id=f.workspace_id and class_name='一班';
  select student_id into second_id from edupi.student_profiles where workspace_id=f.workspace_id and class_name='二班';
  update edupi.student_profiles set profile = profile || '{"error_patterns":[{"description":"移项"}],"trajectory":[{"event":"进步"}]}'::jsonb
    where workspace_id=f.workspace_id and student_id=target.student_id;
  select * into target from edupi.student_profiles where workspace_id=f.workspace_id and student_id=target.student_id;
  edit := jsonb_build_object('action','update','request_id','edit-a','expected_revision',target.profile_revision,
    'expected_updated_at',target.updated_at,'student',jsonb_build_object(
      'student_id',target.student_id,'name',target.name,'class_name','三班','traits',jsonb_build_array('主动提问'),'parent_notes',jsonb_build_array()));
  changed := edupi.mutate_students(f.workspace_id, f.actor_id, edit);
  perform pg_temp.student_assert(changed->>'profile_revision'='1' and changed->>'version_id' is not null, 'revision increments');
  select * into target from edupi.student_profiles where workspace_id=f.workspace_id and student_id=target.student_id;
  perform pg_temp.student_assert(target.class_name='三班' and target.profile->'traits'='["主动提问"]'
    and target.profile->'error_patterns'='[{"description":"移项"}]' and target.profile->'trajectory'='[{"event":"进步"}]', 'full profile preserved');
  perform pg_temp.student_assert((select class_name='二班' from edupi.student_profiles where workspace_id=f.workspace_id and student_id=second_id), 'namesake untouched');
  replayed := edupi.mutate_students(f.workspace_id, f.actor_id, edit);
  perform pg_temp.student_assert(replayed->>'replayed'='true' and
    (select count(*)=1 from edupi.student_profile_versions where workspace_id=f.workspace_id and student_id=target.student_id), 'edit replay no duplicate');
  perform pg_temp.student_rejected(f.workspace_id, f.actor_id,
    edit || '{"request_id":"stale-a"}', 'stale_student');
  perform pg_temp.student_rejected(f.workspace_id, f.actor_id,
    edit || jsonb_build_object('request_id','stale-time','expected_revision',1,
      'expected_updated_at',target.updated_at-interval '1 second'), 'stale_student');
  perform pg_temp.student_rejected(f.workspace_id, f.actor_id,
    edit || jsonb_build_object('request_id','wrong-name','expected_revision',1,'expected_updated_at',target.updated_at,
      'student',jsonb_build_object('student_id',target.student_id,'name','错误姓名','traits','[]'::jsonb,'parent_notes','[]'::jsonb)), 'student_not_found');

  restored := edupi.mutate_students(f.workspace_id, f.actor_id, jsonb_build_object(
    'action','restore','request_id','restore-a','student_id',target.student_id,'student_name',target.name,
    'version_id',changed->>'version_id','version_side','before','expected_revision',1,'expected_updated_at',target.updated_at));
  perform pg_temp.student_assert(restored->>'profile_revision'='2', 'restore creates a new revision');
  select * into target from edupi.student_profiles where workspace_id=f.workspace_id and student_id=target.student_id;
  perform pg_temp.student_assert(target.class_name='一班' and target.profile->'traits'='["认真"]'
    and target.profile->'error_patterns'='[{"description":"移项"}]', 'restore fields and preserve system records');
  perform pg_temp.student_rejected(f.workspace_id, f.actor_id,
    jsonb_build_object('action','restore','request_id','cross-student','student_id',second_id,'student_name',target.name,
      'version_id',changed->>'version_id','version_side','before','expected_revision',0), 'version_not_found');

  edit := edit || jsonb_build_object('request_id','no-change','expected_revision',2,'expected_updated_at',target.updated_at,
    'student',jsonb_build_object('student_id',target.student_id,'name',target.name,'traits',target.profile->'traits','parent_notes',target.profile->'parent_notes'));
  replayed := edupi.mutate_students(f.workspace_id,f.actor_id,edit);
  perform pg_temp.student_assert(replayed->'version_id'='null' and replayed->>'profile_revision'='2'
    and replayed->>'updated_at'=(to_jsonb(target.updated_at)#>>'{}'), 'no-op does not create history or touch timestamp');
  update edupi.student_profiles set deleted_at=now(), revision=revision+1 where workspace_id=f.workspace_id and student_id=target.student_id;
  perform pg_temp.student_rejected(f.workspace_id,f.actor_id,edit || '{"request_id":"deleted-edit"}','student_deleted');
  perform pg_temp.student_rejected(f.workspace_id,f.actor_id,
    '{"action":"import","request_id":"deleted-import","source_name":"名单.csv","students":[{"name":"合成同名","class_name":"一班","traits":[],"parent_notes":[]}]}', 'student_deleted');
  perform pg_temp.student_assert((select deleted_at is not null from edupi.student_profiles where workspace_id=f.workspace_id and student_id=target.student_id), 'soft deletion preserved');
  raise notice 'PASS import, exact retry, actor/workspace scope, identity, concurrency, history, restore, no-op and soft deletion';
end;
$$;

do $$
declare
  f record;
  current_student edupi.student_profiles%rowtype;
  old_version text;
  readback jsonb;
  restore_body jsonb;
  receipt jsonb;
  n integer;
begin
  select * into f from student_fixture;
  perform edupi.mutate_students(f.workspace_id,f.actor_id,
    '{"action":"import","request_id":"history-seed","source_name":"名单.csv","students":[
      {"name":"合成历史","class_name":"历史班","traits":["初始"],"parent_notes":[]}]}');
  perform edupi.mutate_students(f.workspace_id,f.actor_id,
    '{"action":"import","request_id":"history-merge","source_name":"名单.csv","students":[
      {"name":"合成历史","class_name":"历史班","traits":["初始","补充"],"parent_notes":["新增备注"]}]}');
  select * into current_student from edupi.student_profiles where workspace_id=f.workspace_id and name='合成历史';
  perform pg_temp.student_assert(current_student.profile->'traits'='["初始","补充"]' and current_student.profile_revision=1,
    'roster merges rather than replacing teacher values');
  select version_id into old_version from edupi.student_profile_versions
    where workspace_id=f.workspace_id and student_id=current_student.student_id and revision=1;
  for n in 2..50 loop
    perform edupi.mutate_students(f.workspace_id,f.actor_id,jsonb_build_object(
      'action','update','request_id','history-edit-'||n,'expected_revision',current_student.profile_revision,
      'expected_updated_at',current_student.updated_at,'student',jsonb_build_object(
        'student_id',current_student.student_id,'name',current_student.name,
        'traits',jsonb_build_array('合成特征'||n),'parent_notes',jsonb_build_array())));
    select * into current_student from edupi.student_profiles
      where workspace_id=f.workspace_id and student_id=current_student.student_id;
  end loop;
  perform set_config('request.jwt.claim.sub',f.actor_id::text,true);
  readback := edupi.read_students(f.workspace_id,jsonb_build_object(
    'action','history','request_id','history-read','student_id',current_student.student_id));
  perform pg_temp.student_assert(readback->'studentProfileVersions'->>'profile_history_count'='50', 'history bound before restore');
  restore_body := jsonb_build_object('action','restore','request_id','history-restore','student_id',current_student.student_id,
    'student_name',current_student.name,'version_id',old_version,'version_side','before','expected_revision',50);
  receipt := edupi.mutate_students(f.workspace_id,f.actor_id,restore_body);
  readback := edupi.read_students(f.workspace_id,jsonb_build_object(
    'action','history','request_id','history-read-after','student_id',current_student.student_id,'version_id',old_version));
  perform pg_temp.student_assert(readback->'studentProfileVersions'->>'profile_history_count'='50'
    and readback->'studentProfileVersions'->'versions'->0->>'revision'='2'
    and readback->'selected_version'->>'version_id'=old_version
    and readback->'student'->'traits'='["初始"]', 'bounded restore independently reads original archived version');
  perform pg_temp.student_assert((edupi.mutate_students(f.workspace_id,f.actor_id,restore_body))->>'replayed'='true',
    'restore exact replay');
  perform pg_temp.student_rejected(f.workspace_id,f.actor_id,restore_body ||
    '{"request_id":"expired-history","expected_revision":51}', 'version_not_found');
  raise notice 'PASS append-only history, roster merge, 50-version window and archived restore readback';
end;
$$;

grant select on student_fixture to authenticated;
set local role authenticated;
do $$
declare
  f record;
  response jsonb;
  rejected boolean := false;
begin
  select * into f from student_fixture;
  perform set_config('request.jwt.claim.sub',f.actor_id::text,true);
  response := edupi.read_students(f.workspace_id,'{"action":"list","request_id":"rls-read"}');
  perform pg_temp.student_assert(response->>'workspace_id'=f.workspace_id::text
    and jsonb_array_length(response->'students')=2,'member reads full active roster under RLS');
  begin
    perform edupi.read_students(f.other_workspace_id,'{"action":"list","request_id":"rls-denied"}');
  exception when insufficient_privilege then rejected := true;
  end;
  perform pg_temp.student_assert(rejected,'cross-workspace read denied');
  rejected := false;
  begin
    perform edupi.mutate_students(f.workspace_id,f.actor_id,'{"action":"import","request_id":"not-edge"}');
  exception when insufficient_privilege then rejected := true;
  end;
  perform pg_temp.student_assert(rejected,'authenticated clients cannot call writer');
  perform set_config('request.jwt.claim.sub',f.revoked_id::text,true);
  rejected := false;
  begin
    perform edupi.read_students(f.workspace_id,'{"action":"list","request_id":"revoked-read"}');
  exception when insufficient_privilege then rejected := true;
  end;
  perform pg_temp.student_assert(rejected,'revoked member read denied');
  raise notice 'PASS actual authenticated reads, cross-workspace isolation, revoked membership and writer denial';
end;
$$;
reset role;

grant select on student_fixture to service_role;
set local role service_role;
do $$
declare f record; receipt jsonb;
begin
  select * into f from student_fixture;
  receipt := edupi.mutate_students(f.workspace_id,f.actor_id,
    '{"action":"import","request_id":"edge-role-import","source_name":"名单.csv","students":[
      {"name":"合成服务端","class_name":"服务端班","traits":[],"parent_notes":[]}]}');
  perform pg_temp.student_assert(receipt->>'created'='1','service_role writer actually works');
  perform pg_temp.student_rejected(f.workspace_id,f.revoked_id,
    '{"action":"import","request_id":"edge-role-revoked","source_name":"名单.csv","students":[
      {"name":"不可写入","class_name":"服务端班","traits":[],"parent_notes":[]}]}','workspace_forbidden');
  raise notice 'PASS actual Edge service role can write and still rejects revoked actors';
end;
$$;
reset role;

do $$
begin
  perform pg_temp.student_assert(not has_function_privilege('anon','edupi.mutate_students(uuid,uuid,jsonb)','execute')
    and not has_function_privilege('authenticated','edupi.mutate_students(uuid,uuid,jsonb)','execute')
    and has_function_privilege('service_role','edupi.mutate_students(uuid,uuid,jsonb)','execute'), 'RPC service-only ACL');
  raise notice 'PASS student writer callable only by the Edge service role';
end;
$$;
