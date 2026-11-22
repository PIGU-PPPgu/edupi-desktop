alter table edupi.student_profiles
  add column profile_revision integer not null default 0 check (profile_revision >= 0);

create table edupi.student_profile_versions (
  workspace_id uuid not null references edupi.workspaces(id) on delete cascade,
  student_id text not null,
  version_id text not null,
  revision integer not null check (revision > 0),
  before_values jsonb not null check (jsonb_typeof(before_values) = 'object'),
  after_values jsonb not null check (jsonb_typeof(after_values) = 'object'),
  changed_fields jsonb not null check (jsonb_typeof(changed_fields) = 'array'),
  changed_at timestamptz not null,
  source_kind text not null check (source_kind in ('roster_import', 'teacher_edit', 'agent_update', 'restore')),
  request_id text not null,
  actor_id uuid not null references auth.users(id) on delete restrict,
  primary key (workspace_id, student_id, version_id),
  unique (workspace_id, student_id, revision),
  foreign key (workspace_id, student_id) references edupi.student_profiles(workspace_id, student_id) on delete cascade
);

create table edupi.student_write_requests (
  workspace_id uuid not null references edupi.workspaces(id) on delete cascade,
  request_id text not null check (length(request_id) between 1 and 160),
  actor_id uuid not null references auth.users(id) on delete restrict,
  request_hash text not null,
  result jsonb not null check (jsonb_typeof(result) = 'object'),
  created_at timestamptz not null default now(),
  primary key (workspace_id, request_id)
);

alter table edupi.student_profile_versions enable row level security;
alter table edupi.student_write_requests enable row level security;
create policy student_profile_versions_member_read on edupi.student_profile_versions
  for select to authenticated using (edupi.is_workspace_member(workspace_id));
revoke all on edupi.student_profile_versions, edupi.student_write_requests from public, anon, authenticated;
grant select on edupi.student_profile_versions to authenticated;
grant all on edupi.student_profile_versions, edupi.student_write_requests to service_role;
-- The writer runs with the Edge role's actual privileges, rather than
-- elevating to a SECURITY DEFINER. Row locks require UPDATE on one column.
grant select on edupi.workspaces, edupi.workspace_members to service_role;
grant update(id) on edupi.workspaces to service_role;
grant update(revoked_at) on edupi.workspace_members to service_role;
grant select, insert, update on edupi.student_profiles to service_role;
grant insert on edupi.audit_events to service_role;

create function edupi.student_text_valid(value jsonb, max_length integer)
returns boolean language sql immutable set search_path = pg_catalog as $$
  select jsonb_typeof(value) = 'string' and length(value #>> '{}') between 1 and max_length
    and value #>> '{}' = btrim(value #>> '{}')
    and value #>> '{}' !~ '[[:cntrl:]]';
$$;

create function edupi.student_list_valid(value jsonb)
returns boolean language sql immutable set search_path = pg_catalog, edupi as $$
  select case when jsonb_typeof(value) = 'array' then
    jsonb_array_length(value) <= 500 and not exists (
      select 1 from jsonb_array_elements(value) item where edupi.student_text_valid(item, 4096) is distinct from true
    ) else false end;
$$;

-- Flatten the complete stored profile, then override every identity/concurrency
-- field with authoritative columns. Unrelated Core profile fields survive edits.
create function edupi.student_profile_projection(target_workspace uuid, target_student text)
returns jsonb language sql stable security invoker set search_path = pg_catalog, edupi as $$
  select s.profile || jsonb_build_object(
    'student_id', s.student_id, 'name', s.name, 'class_name', s.class_name,
    'traits', coalesce(s.profile->'traits', '[]'::jsonb),
    'parent_notes', coalesce(s.profile->'parent_notes', '[]'::jsonb),
    'created_at', s.created_at, 'updated_at', s.updated_at, 'deleted_at', s.deleted_at,
    'revision', s.revision, 'profile_revision', s.profile_revision,
    'profile_history_count', least(50, (select count(*)::integer from edupi.student_profile_versions v
      where v.workspace_id=s.workspace_id and v.student_id=s.student_id))
  ) from edupi.student_profiles s
  where s.workspace_id=target_workspace and s.student_id=target_student;
$$;

create function edupi.read_students(target_workspace uuid, students_request jsonb)
returns jsonb language plpgsql stable security invoker set search_path = pg_catalog, edupi as $$
declare
  action_value text := students_request->>'action';
  request_id_value text := students_request->>'request_id';
  student_id_value text := students_request->>'student_id';
  current_student edupi.student_profiles%rowtype;
  versions_value jsonb;
  result jsonb;
begin
  if not edupi.is_workspace_member(target_workspace) then
    raise exception using errcode='42501', message='workspace_forbidden';
  end if;
  if jsonb_typeof(students_request) is distinct from 'object'
    or action_value is null or action_value not in ('list','read','history')
    or edupi.student_text_valid(students_request->'request_id',160) is distinct from true
    or students_request - array['action','request_id','student_id','version_id'] <> '{}'::jsonb then
    raise exception using errcode='22023', message='invalid_request';
  end if;
  result := jsonb_build_object('ok',true,'operation','students','action',action_value,
    'request_id',request_id_value,'workspace_id',target_workspace,'external_send',false);
  if action_value='list' then
    if students_request ?| array['student_id','version_id'] then raise exception using errcode='22023', message='invalid_request'; end if;
    return result || jsonb_build_object('students',coalesce((
      select jsonb_agg(edupi.student_profile_projection(target_workspace,s.student_id) order by s.student_id)
      from edupi.student_profiles s where s.workspace_id=target_workspace and s.deleted_at is null
    ),'[]'::jsonb));
  end if;
  if edupi.student_text_valid(students_request->'student_id',240) is distinct from true then
    raise exception using errcode='22023', message='invalid_request';
  end if;
  select * into current_student from edupi.student_profiles
    where workspace_id=target_workspace and student_id=student_id_value;
  if not found then raise exception using errcode='P0002', message='student_not_found'; end if;
  if current_student.deleted_at is not null then raise exception using errcode='P0001', message='student_deleted'; end if;
  result := result || jsonb_build_object('student',edupi.student_profile_projection(target_workspace,student_id_value));
  if action_value='read' then
    if students_request ? 'version_id' then raise exception using errcode='22023', message='invalid_request'; end if;
    return result;
  end if;
  if students_request ? 'version_id' then
    if edupi.student_text_valid(students_request->'version_id',160) is distinct from true then
      raise exception using errcode='22023', message='invalid_request';
    end if;
    result := result || jsonb_build_object('selected_version',(
      select jsonb_build_object('version_id',v.version_id,'student_id',v.student_id,'revision',v.revision,
        'before',v.before_values,'after',v.after_values,'changed_fields',v.changed_fields,
        'changed_at',v.changed_at,'source_kind',v.source_kind,'request_id',v.request_id)
      from edupi.student_profile_versions v where v.workspace_id=target_workspace
        and v.student_id=student_id_value and v.version_id=students_request->>'version_id'));
  end if;
  select coalesce(jsonb_agg(jsonb_build_object(
    'version_id',v.version_id,'student_id',v.student_id,'revision',v.revision,
    'before',v.before_values,'after',v.after_values,'changed_fields',v.changed_fields,
    'changed_at',v.changed_at,'source_kind',v.source_kind,'request_id',v.request_id
  ) order by v.revision),'[]'::jsonb) into versions_value from (
    select * from edupi.student_profile_versions
    where workspace_id=target_workspace and student_id=student_id_value order by revision desc limit 50
  ) v;
  return result || jsonb_build_object('studentProfileVersions',jsonb_build_object(
    'student_id',student_id_value,'student_name',current_student.name,
    'profile_revision',current_student.profile_revision,'profile_history_count',jsonb_array_length(versions_value),
    'versions',versions_value,'external_send',false));
end;
$$;

create function edupi.mutate_students(target_workspace uuid, actor_id uuid, students_request jsonb)
returns jsonb language plpgsql security invoker set search_path = pg_catalog, edupi, extensions as $$
declare
  action_value text := students_request->>'action';
  request_id_value text := students_request->>'request_id';
  request_hash_value text;
  prior_request edupi.student_write_requests%rowtype;
  current_student edupi.student_profiles%rowtype;
  target_version edupi.student_profile_versions%rowtype;
  student_value jsonb;
  input_students jsonb;
  name_value text;
  class_value text;
  student_id_value text;
  before_values jsonb;
  after_values jsonb;
  changed_fields_value jsonb;
  version_id_value text;
  timestamp_value timestamptz;
  match_count integer;
  total_value integer;
  created_value integer := 0;
  updated_value integer := 0;
  student_ids text[] := '{}';
  result jsonb;
begin
  -- A verified Edge session supplies actor_id. Lock membership and workspace so
  -- revocation, duplicate requests and name/class resolution cannot race a write.
  perform 1 from edupi.workspace_members where workspace_id=target_workspace
    and account_id=actor_id and revoked_at is null for share;
  if not found then raise exception using errcode='42501', message='workspace_forbidden'; end if;
  if jsonb_typeof(students_request) is distinct from 'object'
    or action_value is null or action_value not in ('import','update','restore')
    or edupi.student_text_valid(students_request->'request_id',160) is distinct from true
    or octet_length(students_request::text)>262144 then
    raise exception using errcode='22023', message='invalid_request';
  end if;
  perform 1 from edupi.workspaces where id=target_workspace for update;
  request_hash_value := edupi.json_sha256(jsonb_build_object(
    'workspace_id',target_workspace,'actor_id',actor_id,'request',students_request));
  select * into prior_request from edupi.student_write_requests
    where workspace_id=target_workspace and request_id=request_id_value;
  if found then
    if prior_request.actor_id is distinct from actor_id or prior_request.request_hash is distinct from request_hash_value then
      raise exception using errcode='P0001', message='idempotency_conflict';
    end if;
    return prior_request.result || '{"replayed":true}'::jsonb;
  end if;

  if action_value='import' then
    input_students := students_request->'students';
    if students_request - array['action','request_id','source_name','students'] <> '{}'::jsonb
      or edupi.student_text_valid(students_request->'source_name',240) is distinct from true
      or jsonb_typeof(input_students) is distinct from 'array' then
      raise exception using errcode='22023', message='invalid_request';
    end if;
    if jsonb_array_length(input_students) not between 1 and 500 then
      raise exception using errcode='22023', message='invalid_request';
    end if;
    -- A missing class may not be used to merge two namesakes in one upload.
    if exists (select 1 from jsonb_array_elements(input_students) with ordinality a(item,n)
      cross join jsonb_array_elements(input_students) with ordinality b(item,n)
      where a.n<b.n and a.item->>'name'=b.item->>'name'
        and (a.item->>'class_name' is null or b.item->>'class_name' is null
          or a.item->>'class_name'=b.item->>'class_name')) then
      raise exception using errcode='P0001', message='ambiguous_student';
    end if;
  elsif action_value='update' then
    if students_request - array['action','request_id','student','expected_revision','expected_updated_at'] <> '{}'::jsonb
      or edupi.student_text_valid(students_request->'expected_updated_at',64) is distinct from true then
      raise exception using errcode='22023', message='invalid_request';
    end if;
    input_students := jsonb_build_array(students_request->'student');
  else
    if students_request - array['action','request_id','student_id','student_name','version_id','version_side','expected_revision','expected_updated_at'] <> '{}'::jsonb
      or edupi.student_text_valid(students_request->'student_id',240) is distinct from true
      or edupi.student_text_valid(students_request->'student_name',120) is distinct from true
      or edupi.student_text_valid(students_request->'version_id',160) is distinct from true
      or students_request->>'version_side' is null or students_request->>'version_side' not in ('before','after')
      or (students_request ? 'expected_updated_at' and edupi.student_text_valid(students_request->'expected_updated_at',64) is distinct from true) then
      raise exception using errcode='22023', message='invalid_request';
    end if;
    input_students := jsonb_build_array(jsonb_build_object(
      'student_id',students_request->>'student_id','name',students_request->>'student_name'));
  end if;
  if action_value<>'import' and (
    jsonb_typeof(students_request->'expected_revision') is distinct from 'number'
    or students_request->>'expected_revision' !~ '^(0|[1-9][0-9]*)$'
    or (students_request->>'expected_revision')::numeric>2147483646) then
    raise exception using errcode='22023', message='invalid_request';
  end if;

  for student_value in select value from jsonb_array_elements(input_students) loop
    current_student := null;
    version_id_value := null;
    if jsonb_typeof(student_value) is distinct from 'object'
      or edupi.student_text_valid(student_value->'name',120) is distinct from true
      or (action_value<>'restore' and (
        student_value - array['student_id','name','class_name','traits','parent_notes'] <> '{}'::jsonb
        or edupi.student_list_valid(student_value->'traits') is distinct from true
        or edupi.student_list_valid(student_value->'parent_notes') is distinct from true))
      or (student_value ? 'class_name' and student_value->'class_name'<>'null'::jsonb
        and edupi.student_text_valid(student_value->'class_name',120) is distinct from true) then
      raise exception using errcode='22023', message='invalid_request';
    end if;
    name_value := student_value->>'name';
    class_value := student_value->>'class_name';
    if action_value='import' then
      if student_value ? 'student_id' then raise exception using errcode='22023', message='invalid_request'; end if;
      select count(*) into match_count from edupi.student_profiles
        where workspace_id=target_workspace and name=name_value and (class_value is null or class_name=class_value);
      if match_count>1 or (class_value is not null and exists (
        select 1 from edupi.student_profiles where workspace_id=target_workspace and name=name_value and class_name is null
      )) then raise exception using errcode='P0001', message='ambiguous_student'; end if;
      if match_count=1 then
        select * into current_student from edupi.student_profiles
          where workspace_id=target_workspace and name=name_value and (class_value is null or class_name=class_value) for update;
      end if;
    else
      if edupi.student_text_valid(student_value->'student_id',240) is distinct from true then
        raise exception using errcode='22023', message='invalid_request';
      end if;
      select * into current_student from edupi.student_profiles
        where workspace_id=target_workspace and student_id=student_value->>'student_id' for update;
      if current_student.student_id is null or current_student.name<>name_value then
        raise exception using errcode='P0002', message='student_not_found';
      end if;
    end if;
    if current_student.deleted_at is not null then raise exception using errcode='P0001', message='student_deleted'; end if;
    if current_student.student_id is null then
      student_id_value := 'student-cloud-' || gen_random_uuid()::text;
      insert into edupi.student_profiles(workspace_id,student_id,name,class_name,profile)
        values(target_workspace,student_id_value,name_value,class_value,jsonb_build_object(
          'traits',student_value->'traits','parent_notes',student_value->'parent_notes',
          'error_patterns','[]'::jsonb,'trajectory','[]'::jsonb))
        returning * into current_student;
      created_value := created_value+1;
    else
      student_id_value := current_student.student_id;
      if action_value<>'import' and (
        current_student.profile_revision<>(students_request->>'expected_revision')::integer
        or (students_request ? 'expected_updated_at'
          and current_student.updated_at is distinct from (students_request->>'expected_updated_at')::timestamptz)) then
        raise exception using errcode='P0001', message='stale_student';
      end if;
      if edupi.student_list_valid(coalesce(current_student.profile->'traits','[]'::jsonb)) is distinct from true
        or edupi.student_list_valid(coalesce(current_student.profile->'parent_notes','[]'::jsonb)) is distinct from true then
        raise exception using errcode='P0001', message='invalid_state';
      end if;
      before_values := jsonb_build_object('class_name',current_student.class_name,
        'traits',coalesce(current_student.profile->'traits','[]'::jsonb),
        'parent_notes',coalesce(current_student.profile->'parent_notes','[]'::jsonb));
      if action_value='restore' then
        select * into target_version from edupi.student_profile_versions
          where workspace_id=target_workspace and student_id=student_id_value and version_id=students_request->>'version_id';
        if not found then raise exception using errcode='P0002', message='version_not_found'; end if;
        -- Only versions visible through the bounded Core history can be restored.
        if target_version.revision<=current_student.profile_revision-50 then
          raise exception using errcode='P0002', message='version_not_found';
        end if;
        after_values := case students_request->>'version_side' when 'before' then target_version.before_values else target_version.after_values end;
        if before_values=after_values then raise exception using errcode='P0001', message='version_already_current'; end if;
      elsif action_value='import' then
        after_values := jsonb_build_object('class_name',coalesce(class_value,current_student.class_name),
          'traits',(select coalesce(jsonb_agg(value order by first_index),'[]'::jsonb) from (
            select value,min(n) first_index from jsonb_array_elements((before_values->'traits')||(student_value->'traits')) with ordinality t(value,n) group by value
          ) merged),
          'parent_notes',(select coalesce(jsonb_agg(value order by first_index),'[]'::jsonb) from (
            select value,min(n) first_index from jsonb_array_elements((before_values->'parent_notes')||(student_value->'parent_notes')) with ordinality t(value,n) group by value
          ) merged));
      else
        after_values := jsonb_build_object(
          'class_name',case when student_value ? 'class_name' then student_value->'class_name' else to_jsonb(current_student.class_name) end,
          'traits',student_value->'traits','parent_notes',student_value->'parent_notes');
      end if;
      if edupi.student_list_valid(after_values->'traits') is distinct from true
        or edupi.student_list_valid(after_values->'parent_notes') is distinct from true then
        raise exception using errcode='22023', message='invalid_request';
      end if;
      if before_values<>after_values then
        if exists (select 1 from edupi.student_profiles where workspace_id=target_workspace
          and student_id<>student_id_value and name=name_value
          and (after_values->>'class_name' is null or class_name is null or class_name=after_values->>'class_name')) then
          raise exception using errcode='P0001', message='ambiguous_student';
        end if;
        select coalesce(jsonb_agg(key order by n),'[]'::jsonb) into changed_fields_value
          from unnest(array['class_name','traits','parent_notes']) with ordinality fields(key,n)
          where before_values->key is distinct from after_values->key;
        update edupi.student_profiles set class_name=after_values->>'class_name',
          profile=profile || (after_values-'class_name'), revision=revision+1,
          profile_revision=profile_revision+1,updated_at=now()
          where workspace_id=target_workspace and student_id=student_id_value returning * into current_student;
        timestamp_value := current_student.updated_at;
        -- Storage IDs are explicitly translated to Core content-bound IDs by
        -- lib/edupi-cloud-students-verification.ts; restore translates back.
        version_id_value := 'cloud-student-profile-' || split_part(edupi.json_sha256(jsonb_build_object(
          'workspace_id',target_workspace,'student_id',student_id_value,'revision',current_student.profile_revision,
          'before',before_values,'after',after_values,'changed_at',timestamp_value,'actor_id',actor_id,'request_id',request_id_value)),':',2);
        insert into edupi.student_profile_versions(workspace_id,student_id,version_id,revision,
          before_values,after_values,changed_fields,changed_at,source_kind,request_id,actor_id)
          values(target_workspace,student_id_value,version_id_value,current_student.profile_revision,before_values,
            after_values,changed_fields_value,timestamp_value,
            case action_value when 'import' then 'roster_import' when 'restore' then 'restore' else 'teacher_edit' end,request_id_value,actor_id);
      end if;
      updated_value := updated_value+1;
    end if;
    student_ids := array_append(student_ids,student_id_value);
  end loop;
  select count(*)::integer into total_value from edupi.student_profiles where workspace_id=target_workspace and deleted_at is null;
  if total_value>500 then raise exception using errcode='22023', message='too_many_students'; end if;
  result := jsonb_build_object('ok',true,'operation','students','request_id',request_id_value,'action',action_value,
    'total',total_value,'replayed',false,'external_send',false);
  if action_value='import' then
    result := result || jsonb_build_object('created',created_value,'updated',updated_value,
      'imported',jsonb_array_length(input_students),'students',(
        select jsonb_agg(edupi.student_profile_projection(target_workspace,id) order by n)
        from unnest(student_ids) with ordinality t(id,n)));
  else
    result := result || jsonb_build_object('updated',1,'student_id',current_student.student_id,'student_name',current_student.name,
      'version_id',version_id_value,'profile_revision',current_student.profile_revision,
      'profile_history_count',least(50,(select count(*)::integer from edupi.student_profile_versions
        where workspace_id=target_workspace and student_id=current_student.student_id)),
      'updated_at',current_student.updated_at);
  end if;
  insert into edupi.student_write_requests(workspace_id,request_id,actor_id,request_hash,result)
    values(target_workspace,request_id_value,actor_id,request_hash_value,result);
  insert into edupi.audit_events(workspace_id,request_id,actor_id,event_kind,target_kind,target_id,payload)
    values(target_workspace,request_id_value,actor_id,'students_'||action_value,'student',
      case when action_value='import' then null else current_student.student_id end,result);
  perform edupi.refresh_workspace_snapshot(target_workspace,'students_'||action_value);
  return result;
end;
$$;

revoke all on function edupi.student_text_valid(jsonb,integer), edupi.student_list_valid(jsonb),
  edupi.student_profile_projection(uuid,text), edupi.read_students(uuid,jsonb), edupi.mutate_students(uuid,uuid,jsonb)
  from public, anon, authenticated;
grant execute on function edupi.student_text_valid(jsonb,integer), edupi.student_list_valid(jsonb),
  edupi.student_profile_projection(uuid,text), edupi.read_students(uuid,jsonb) to authenticated, service_role;
grant execute on function edupi.mutate_students(uuid,uuid,jsonb) to service_role;
