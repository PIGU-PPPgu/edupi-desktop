-- Cloud state stays workspace scoped; Pi execution and model credentials stay
-- on the Desktop that owns the existing runtime lease.
create table edupi.cloud_chat_sessions (
  workspace_id uuid not null references edupi.workspaces(id) on delete cascade,
  session_id text not null check (length(session_id) between 1 and 160),
  title text not null default '',
  created_by uuid not null references auth.users(id) on delete cascade,
  model jsonb,
  thinking_level text not null default 'off',
  revision integer not null default 0,
  deleted_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  primary key (workspace_id, session_id)
);

create table edupi.cloud_chat_requests (
  workspace_id uuid not null,
  request_id text not null,
  session_id text not null,
  actor_id uuid not null references auth.users(id) on delete cascade,
  command_hash text not null,
  command jsonb not null,
  status text not null default 'queued'
    check (status in ('queued','claimed','running','completed','failed','uncertain','cancelled')),
  instance_id text,
  instance_nonce text,
  fencing_generation bigint,
  error_code text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  primary key (workspace_id, request_id),
  foreign key (workspace_id, session_id)
    references edupi.cloud_chat_sessions(workspace_id, session_id) on delete cascade
);

create table edupi.cloud_chat_messages (
  workspace_id uuid not null,
  session_id text not null,
  message_id text not null,
  request_id text not null,
  role text not null check (role in ('user','assistant')),
  message jsonb not null check (jsonb_typeof(message) = 'object'),
  created_at timestamptz not null default now(),
  primary key (workspace_id, session_id, message_id),
  foreign key (workspace_id, request_id)
    references edupi.cloud_chat_requests(workspace_id, request_id) on delete cascade
);

create table edupi.cloud_chat_events (
  workspace_id uuid not null,
  session_id text not null,
  event_id bigint generated always as identity,
  event_key text not null,
  request_id text not null,
  event jsonb not null check (jsonb_typeof(event) = 'object'),
  created_at timestamptz not null default now(),
  primary key (workspace_id, event_id),
  unique (workspace_id, event_key),
  foreign key (workspace_id, request_id)
    references edupi.cloud_chat_requests(workspace_id, request_id) on delete cascade
);
create index cloud_chat_requests_pending on edupi.cloud_chat_requests(workspace_id, created_at)
  where status = 'queued';
create index cloud_chat_session_events on edupi.cloud_chat_events(workspace_id,session_id,event_id);

create table edupi.cloud_entity_tombstones (
  workspace_id uuid not null references edupi.workspaces(id) on delete cascade,
  kind text not null,
  target_id text not null,
  revision integer not null check (revision >= 1),
  target_fingerprint text not null,
  deleted_fingerprint text not null,
  original jsonb not null,
  parent_id text,
  label text,
  actor_id uuid not null references auth.users(id) on delete cascade,
  deleted_at timestamptz not null default now(),
  restored_at timestamptz,
  primary key (workspace_id, kind, target_id)
);
create table edupi.cloud_entity_receipts (
  workspace_id uuid not null references edupi.workspaces(id) on delete cascade,
  request_id text not null,
  actor_id uuid not null references auth.users(id) on delete cascade,
  request_hash text not null,
  response jsonb not null,
  created_at timestamptz not null default now(),
  primary key (workspace_id,request_id)
);
create table edupi.runtime_event_receipts (
  workspace_id uuid not null references edupi.workspaces(id) on delete cascade,
  request_id text not null,
  actor_id uuid not null references auth.users(id) on delete cascade,
  request_hash text not null,
  response jsonb not null,
  created_at timestamptz not null default now(),
  primary key (workspace_id,request_id)
);
create table edupi.cloud_chat_receipts (
  workspace_id uuid not null references edupi.workspaces(id) on delete cascade,
  request_id text not null,
  actor_id uuid not null references auth.users(id) on delete cascade,
  request_hash text not null,
  response jsonb not null,
  created_at timestamptz not null default now(),
  primary key (workspace_id,request_id)
);

do $$
declare name text;
begin
  foreach name in array array['cloud_chat_sessions','cloud_chat_requests',
    'cloud_chat_messages','cloud_chat_events','cloud_entity_tombstones',
    'cloud_entity_receipts','runtime_event_receipts','cloud_chat_receipts']
  loop
    execute format('alter table edupi.%I enable row level security',name);
    execute format('create policy member_read on edupi.%I for select to authenticated using (edupi.is_workspace_member(workspace_id))',name);
    execute format('grant select on edupi.%I to authenticated',name);
    execute format('grant all on edupi.%I to service_role',name);
  end loop;
end $$;
grant usage,select on sequence edupi.cloud_chat_events_event_id_seq to service_role;

create function edupi.require_cloud_runtime_lease(target_workspace uuid, actor_id uuid, proof jsonb)
returns void language plpgsql security definer
set search_path=pg_catalog,edupi,extensions as $$
begin
  if actor_id is null or not exists (
    select 1 from edupi.workspace_members where workspace_id=target_workspace
      and account_id=actor_id and revoked_at is null
  ) then raise exception 'workspace_forbidden'; end if;
  if not exists (
    select 1 from edupi.core_runtime_leases l
    join edupi.core_runtime_instances i using(workspace_id,instance_id,instance_nonce,fencing_generation)
    where l.workspace_id=target_workspace and l.lease_name=proof->>'lease_name'
      and l.instance_id=proof->>'instance_id' and l.instance_nonce=proof->>'instance_nonce'
      and l.fencing_generation=(proof->>'fencing_generation')::bigint
      and l.expires_at>clock_timestamp()
      and l.lease_token_hash=encode(digest(coalesce(proof->>'lease_token',''),'sha256'),'hex')
  ) then raise exception 'runtime_fenced'; end if;
end $$;
revoke all on function edupi.require_cloud_runtime_lease(uuid,uuid,jsonb) from public,anon,authenticated;
grant execute on function edupi.require_cloud_runtime_lease(uuid,uuid,jsonb) to service_role;

alter function edupi.runtime_transition(uuid,uuid,jsonb) rename to runtime_transition_before_cloud_queue;
revoke all on function edupi.runtime_transition_before_cloud_queue(uuid,uuid,jsonb) from public,anon,authenticated,service_role;
create function edupi.runtime_transition(target_workspace uuid,actor_id uuid,runtime_request jsonb)
returns jsonb language plpgsql security definer
set search_path=pg_catalog,edupi,extensions as $$
declare rid text; fingerprint text; previous edupi.runtime_event_receipts%rowtype; response jsonb;
begin
  if actor_id is null or not exists (
    select 1 from edupi.workspace_members where workspace_id=target_workspace
      and account_id=actor_id and revoked_at is null
  ) then raise exception 'workspace_forbidden'; end if;
  perform pg_advisory_xact_lock(hashtextextended(
    'edupi-instance:'||target_workspace::text||':'||coalesce(runtime_request->>'instance_id',''),0));
  if runtime_request->>'action' <> 'event' then
    return edupi.runtime_transition_before_cloud_queue(target_workspace,actor_id,runtime_request);
  end if;
  perform edupi.require_cloud_runtime_lease(target_workspace,actor_id,runtime_request);
  rid := coalesce(nullif(runtime_request->>'request_id',''),
    edupi.json_sha256(runtime_request-'lease_token'));
  fingerprint := edupi.json_sha256(runtime_request-'lease_token');
  select * into previous from edupi.runtime_event_receipts
    where workspace_id=target_workspace and request_id=rid;
  if found then
    if previous.actor_id<>actor_id or previous.request_hash<>fingerprint then
      raise exception 'idempotency_conflict';
    end if;
    return previous.response||'{"replayed":true}'::jsonb;
  end if;
  response:=edupi.runtime_transition_before_cloud_queue(target_workspace,actor_id,runtime_request);
  insert into edupi.runtime_event_receipts values(target_workspace,rid,actor_id,fingerprint,response,now());
  return response||'{"replayed":false}'::jsonb;
end $$;
revoke all on function edupi.runtime_transition(uuid,uuid,jsonb) from public,anon,authenticated;
grant execute on function edupi.runtime_transition(uuid,uuid,jsonb) to service_role;

create function edupi.cloud_chat_transition(target_workspace uuid,actor_id uuid,chat_request jsonb)
returns jsonb language plpgsql security definer
set search_path=pg_catalog,edupi,extensions as $$
declare
  action text:=chat_request->>'action';
  sid text:=chat_request->>'session_id';
  rid text:=chat_request->>'request_id';
  session_row edupi.cloud_chat_sessions%rowtype;
  request_row edupi.cloud_chat_requests%rowtype;
  command_value jsonb:=chat_request->'command';
  fingerprint text;
  events_value jsonb;
  item jsonb;
  existing jsonb;
  previous edupi.cloud_chat_receipts%rowtype;
  response jsonb;
  proof jsonb:=chat_request->'runtime';
  after_id bigint:=coalesce((chat_request->>'after')::bigint,0);
begin
  if actor_id is null or not exists (
    select 1 from edupi.workspace_members where workspace_id=target_workspace
      and account_id=actor_id and revoked_at is null
  ) then raise exception 'workspace_forbidden'; end if;
  if action='list' then
    return jsonb_build_object('ok',true,'operation','sessions','action',action,
      'workspace_id',target_workspace,'sessions',coalesce((
        select jsonb_agg(to_jsonb(s) order by s.updated_at desc) from (
          select s.*, (select count(*) from edupi.cloud_chat_messages m
            where m.workspace_id=s.workspace_id and m.session_id=s.session_id) as message_count,
            exists(select 1 from edupi.cloud_chat_requests r where r.workspace_id=s.workspace_id
              and r.session_id=s.session_id and r.status in ('queued','claimed','running')) as running
          from edupi.cloud_chat_sessions s where workspace_id=target_workspace
            and deleted_at is null order by updated_at desc limit 500
        ) s),'[]'::jsonb),'external_send',false);
  end if;
  if action='claim' then
    perform edupi.require_cloud_runtime_lease(target_workspace,actor_id,proof);
    -- Never automatically replay an uncertain model invocation after a process
    -- died. Queued requests remain safe to execute after restart.
    update edupi.cloud_chat_requests r set status='uncertain',error_code='executor_interrupted',updated_at=now()
      where workspace_id=target_workspace and status in ('claimed','running')
      and (instance_id,instance_nonce,fencing_generation) is distinct from
        (proof->>'instance_id',proof->>'instance_nonce',(proof->>'fencing_generation')::bigint);
    select r.* into request_row from edupi.cloud_chat_requests r
      join edupi.cloud_chat_sessions s using(workspace_id,session_id)
      where r.workspace_id=target_workspace and r.status='queued' and s.deleted_at is null
      and not exists(select 1 from edupi.cloud_chat_requests active
        where active.workspace_id=r.workspace_id and active.session_id=r.session_id
          and active.status in ('claimed','running'))
      order by r.created_at,r.request_id for update of r skip locked limit 1;
    if not found then return jsonb_build_object('ok',true,'operation','sessions',
      'action',action,'request',null,'external_send',false); end if;
    update edupi.cloud_chat_requests set status='claimed',instance_id=proof->>'instance_id',
      instance_nonce=proof->>'instance_nonce',fencing_generation=(proof->>'fencing_generation')::bigint,
      updated_at=now() where workspace_id=target_workspace and request_id=request_row.request_id
      returning * into request_row;
    return jsonb_build_object('ok',true,'operation','sessions','action',action,
      'workspace_id',target_workspace,'request',to_jsonb(request_row),'external_send',false);
  end if;
  if sid is null or length(sid) not between 1 and 160
    or sid ~ '[[:cntrl:]]' then raise exception 'invalid_chat_session'; end if;
  perform pg_advisory_xact_lock(hashtextextended('edupi-chat:'||target_workspace::text||':'||sid,0));
  if action in ('create','rename','delete','configure','cancel') then
    if rid is null or length(rid) not between 1 and 160 then raise exception 'invalid_chat_request'; end if;
    perform pg_advisory_xact_lock(hashtextextended('edupi-chat-request:'||target_workspace::text||':'||rid,0));
    fingerprint:=edupi.json_sha256(chat_request);
    select * into previous from edupi.cloud_chat_receipts
      where workspace_id=target_workspace and request_id=rid;
    if found then
      if previous.actor_id<>actor_id or previous.request_hash<>fingerprint
        then raise exception 'idempotency_conflict'; end if;
      return previous.response||'{"replayed":true}'::jsonb;
    end if;
  end if;
  select * into session_row from edupi.cloud_chat_sessions
    where workspace_id=target_workspace and session_id=sid for update;
  if action='create' then
    if found then
      raise exception 'idempotency_conflict';
    else
      insert into edupi.cloud_chat_sessions(workspace_id,session_id,title,created_by,model,thinking_level)
      values(target_workspace,sid,left(coalesce(chat_request->>'title',''),240),actor_id,
        chat_request->'model',coalesce(chat_request->>'thinking_level','off'))
      returning * into session_row;
    end if;
    response:=jsonb_build_object('ok',true,'operation','sessions','action',action,
      'request_id',rid,'workspace_id',target_workspace,'session',to_jsonb(session_row),'external_send',false);
    insert into edupi.cloud_chat_receipts values(target_workspace,rid,actor_id,fingerprint,response,now());
    return response;
  end if;
  if not found or session_row.deleted_at is not null and action<>'read' then raise exception 'session_not_found'; end if;
  if action='read' then
    return jsonb_build_object('ok',true,'operation','sessions','action',action,
      'workspace_id',target_workspace,'session',to_jsonb(session_row),
      'messages',coalesce((select jsonb_agg(to_jsonb(m) order by created_at,message_id)
        from edupi.cloud_chat_messages m where workspace_id=target_workspace and session_id=sid),'[]'::jsonb),
      'requests',coalesce((select jsonb_agg(to_jsonb(r) order by created_at,request_id)
        from edupi.cloud_chat_requests r where workspace_id=target_workspace and session_id=sid),'[]'::jsonb),
      'external_send',false);
  elsif action='events' then
    select coalesce(jsonb_agg(to_jsonb(e) order by event_id),'[]'::jsonb) into events_value from (
      select event_id,event,event_key,request_id from edupi.cloud_chat_events
        where workspace_id=target_workspace and session_id=sid and event_id>after_id
        order by event_id limit 200
    ) e;
    return jsonb_build_object('ok',true,'operation','sessions','action',action,
      'workspace_id',target_workspace,'events',events_value,'external_send',false);
  elsif action in ('rename','delete','configure','cancel') then
    if action in ('rename','configure') and (chat_request->>'expected_revision')::integer
      is distinct from session_row.revision then raise exception 'chat_request_changed'; end if;
    if action='rename' then
    if length(coalesce(chat_request->>'title',''))>240 then raise exception 'invalid_chat_title'; end if;
    update edupi.cloud_chat_sessions set title=chat_request->>'title',revision=revision+1,updated_at=now()
      where workspace_id=target_workspace and session_id=sid;
    elsif action='delete' then
    update edupi.cloud_chat_sessions set deleted_at=now(),revision=revision+1,updated_at=now()
      where workspace_id=target_workspace and session_id=sid;
    elsif action='configure' then
      if exists(select 1 from edupi.cloud_chat_requests where workspace_id=target_workspace
        and session_id=sid and status in ('queued','claimed','running')) then raise exception 'chat_request_changed'; end if;
      if chat_request ? 'model' and (jsonb_typeof(chat_request->'model')<>'object'
        or length(coalesce(chat_request->'model'->>'provider','')) not between 1 and 120
        or length(coalesce(chat_request->'model'->>'modelId','')) not between 1 and 200)
        or chat_request ? 'thinking_level' and chat_request->>'thinking_level'
          not in ('off','minimal','low','medium','high','xhigh') then raise exception 'invalid_chat_configuration'; end if;
      update edupi.cloud_chat_sessions set model=case when chat_request ? 'model'
          then chat_request->'model' else model end,
        thinking_level=coalesce(chat_request->>'thinking_level',thinking_level),
        revision=revision+1,updated_at=now() where workspace_id=target_workspace and session_id=sid;
    end if;
    if action in ('delete','cancel') then
    update edupi.cloud_chat_requests set status='cancelled',updated_at=now()
      where workspace_id=target_workspace and session_id=sid and status in ('queued','claimed','running');
    end if;
    response:=jsonb_build_object('ok',true,'operation','sessions','action',action,
      'workspace_id',target_workspace,'request_id',rid,'session_id',sid,
      'revision',(select revision from edupi.cloud_chat_sessions where workspace_id=target_workspace and session_id=sid),
      'external_send',false);
    insert into edupi.cloud_chat_receipts values(target_workspace,rid,actor_id,fingerprint,response,now());
    return response;
  elsif action='enqueue' then
    if rid is null or length(rid) not between 1 and 160
      or jsonb_typeof(command_value)<>'object' or length(coalesce(command_value->>'message','')) not between 1 and 64000
      or command_value->>'type' not in ('prompt','steer','follow_up','mobile_prompt')
      then raise exception 'invalid_chat_request'; end if;
    fingerprint:=edupi.json_sha256(jsonb_build_object('session_id',sid,'command',command_value));
    select * into request_row from edupi.cloud_chat_requests
      where workspace_id=target_workspace and request_id=rid;
    if found then
      if request_row.actor_id<>actor_id or request_row.command_hash<>fingerprint
        then raise exception 'idempotency_conflict'; end if;
      return jsonb_build_object('ok',true,'operation','sessions','action',action,'request_id',rid,
        'session_id',sid,'status',request_row.status,'replayed',true,'external_send',false);
    end if;
    insert into edupi.cloud_chat_requests(workspace_id,session_id,request_id,actor_id,command_hash,command)
      values(target_workspace,sid,rid,actor_id,fingerprint,command_value);
    insert into edupi.cloud_chat_messages(workspace_id,session_id,message_id,request_id,role,message)
      values(target_workspace,sid,rid||':user',rid,'user',
        jsonb_build_object('role','user','content',command_value->>'message','timestamp',
          floor(extract(epoch from clock_timestamp())*1000)));
    insert into edupi.cloud_chat_events(workspace_id,session_id,event_key,request_id,event)
      values(target_workspace,sid,rid||':queued',rid,
        jsonb_build_object('type','cloud_prompt_queued','clientRequestId',rid));
    update edupi.cloud_chat_sessions set updated_at=now() where workspace_id=target_workspace and session_id=sid;
    return jsonb_build_object('ok',true,'operation','sessions','action',action,'request_id',rid,
      'session_id',sid,'status','queued','replayed',false,'external_send',false);
  elsif action in ('running','append','complete','recover','fail') then
    perform edupi.require_cloud_runtime_lease(target_workspace,actor_id,proof);
    select * into request_row from edupi.cloud_chat_requests
      where workspace_id=target_workspace and request_id=rid and session_id=sid for update;
    if found and action='recover' and request_row.instance_id=proof->>'instance_id'
      and request_row.status in ('uncertain','claimed','running','completed') then
      update edupi.cloud_chat_requests set instance_nonce=proof->>'instance_nonce',
        fencing_generation=(proof->>'fencing_generation')::bigint,
        status=case when status='completed' then 'completed' else 'running' end
        where workspace_id=target_workspace and request_id=rid returning * into request_row;
    end if;
    if request_row.request_id is null or (request_row.instance_id,request_row.instance_nonce,request_row.fencing_generation)
      is distinct from (proof->>'instance_id',proof->>'instance_nonce',(proof->>'fencing_generation')::bigint)
      then raise exception 'runtime_fenced'; end if;
    if request_row.status='completed' and action in ('complete','recover') then
      if (select message from edupi.cloud_chat_messages where workspace_id=target_workspace
        and session_id=sid and message_id=rid||':assistant') is distinct from chat_request->'message'
        then raise exception 'idempotency_conflict'; end if;
      return jsonb_build_object('ok',true,'operation','sessions','action',action,
        'request_id',rid,'status','completed','replayed',true,'external_send',false);
    end if;
    if request_row.status not in ('claimed','running') then raise exception 'chat_request_changed'; end if;
    if action='running' then
      update edupi.cloud_chat_requests set status='running',updated_at=now()
        where workspace_id=target_workspace and request_id=rid;
    elsif action='append' then
      if jsonb_typeof(chat_request->'events')<>'array' or jsonb_array_length(chat_request->'events')>50
        then raise exception 'invalid_chat_events'; end if;
      for item in select value from jsonb_array_elements(chat_request->'events') loop
        if length(coalesce(item->>'key','')) not between 1 and 240 or jsonb_typeof(item->'event')<>'object'
          or octet_length((item->'event')::text)>262144 then raise exception 'invalid_chat_event'; end if;
        select event into existing from edupi.cloud_chat_events
          where workspace_id=target_workspace and event_key=rid||':'||(item->>'key');
        if found and existing<>item->'event' then raise exception 'idempotency_conflict'; end if;
        insert into edupi.cloud_chat_events(workspace_id,session_id,event_key,request_id,event)
          values(target_workspace,sid,rid||':'||(item->>'key'),rid,item->'event')
          on conflict(workspace_id,event_key) do nothing;
      end loop;
    elsif action in ('complete','recover') then
      if jsonb_typeof(chat_request->'message')<>'object' or chat_request->'message'->>'role'<>'assistant'
        or jsonb_typeof(chat_request->'message'->'content')<>'array'
        or exists(select 1 from jsonb_array_elements(chat_request->'message'->'content') b
          where b->>'type'<>'text' or jsonb_typeof(b->'text')<>'string')
        or octet_length((chat_request->'message')::text)>1048576 then raise exception 'invalid_chat_message'; end if;
      insert into edupi.cloud_chat_messages(workspace_id,session_id,message_id,request_id,role,message)
        values(target_workspace,sid,rid||':assistant',rid,'assistant',chat_request->'message');
      update edupi.cloud_chat_requests set status='completed',error_code=null,updated_at=now()
        where workspace_id=target_workspace and request_id=rid;
      insert into edupi.cloud_chat_events(workspace_id,session_id,event_key,request_id,event) values
        (target_workspace,sid,rid||':final',rid,jsonb_build_object('type','message_end',
          'message',chat_request->'message','entryId',rid||':assistant','clientRequestId',rid)),
        (target_workspace,sid,rid||':end',rid,jsonb_build_object('type','agent_end','clientRequestId',rid)),
        (target_workspace,sid,rid||':done',rid,jsonb_build_object('type','prompt_done','clientRequestId',rid)),
        (target_workspace,sid,rid||':settled',rid,jsonb_build_object('type','agent_settled','clientRequestId',rid));
    else
      update edupi.cloud_chat_requests set status=case when chat_request->>'uncertain'='true' then 'uncertain' else 'failed' end,
        error_code=left(coalesce(chat_request->>'error_code','prompt_failed'),80),updated_at=now()
        where workspace_id=target_workspace and request_id=rid;
      insert into edupi.cloud_chat_events(workspace_id,session_id,event_key,request_id,event)
        values(target_workspace,sid,rid||':failed',rid,jsonb_build_object('type','prompt_error',
          'errorMessage',case when chat_request->>'uncertain'='true' then '执行结果待确认，记录已保留。' else '本机执行未完成，请重试。' end,
          'clientRequestId',rid));
    end if;
    update edupi.cloud_chat_sessions set updated_at=now() where workspace_id=target_workspace and session_id=sid;
    return jsonb_build_object('ok',true,'operation','sessions','action',action,
      'request_id',rid,'session_id',sid,'external_send',false);
  end if;
  raise exception 'invalid_chat_action';
end $$;
revoke all on function edupi.cloud_chat_transition(uuid,uuid,jsonb) from public,anon,authenticated;
grant execute on function edupi.cloud_chat_transition(uuid,uuid,jsonb) to service_role;

create function edupi.cloud_entity_state(target_workspace uuid, target_kind text, target_id_value text)
returns jsonb language plpgsql security definer
set search_path=pg_catalog,edupi,extensions as $$
declare table_name text; key_name text; object_value jsonb; parent_value text; matches integer;
begin
  case target_kind
    when 'task' then table_name:='tasks'; key_name:='task_id';
    when 'student' then table_name:='student_profiles'; key_name:='student_id';
    when 'material' then table_name:='materials'; key_name:='material_id';
    when 'memory' then table_name:='memories'; key_name:='memory_id';
    when 'calendar','timetable' then
      select count(*) into matches from edupi.education_inputs i
      cross join lateral jsonb_array_elements(coalesce(i.payload->case target_kind
        when 'calendar' then 'events' else 'slots' end,'[]'::jsonb)) e
      where i.workspace_id=target_workspace and i.input_kind=target_kind and i.deleted_at is null
        and coalesce(e->>'event_id',e->>'slot_id',e->>'id')=target_id_value;
      if matches>1 then raise exception 'ambiguous_entity'; end if;
      select e,i.input_id into object_value,parent_value from edupi.education_inputs i
      cross join lateral jsonb_array_elements(coalesce(i.payload->case target_kind
        when 'calendar' then 'events' else 'slots' end,'[]'::jsonb)) e
      where i.workspace_id=target_workspace and i.input_kind=target_kind and i.deleted_at is null
        and coalesce(e->>'event_id',e->>'slot_id',e->>'id')=target_id_value;
      return case when object_value is null then null else
        jsonb_build_object('object',object_value,'parent_id',parent_value,
          'fingerprint',edupi.json_sha256(object_value),'deleted',false) end;
    else raise exception 'invalid_entity_kind';
  end case;
  execute format('select to_jsonb(t) from edupi.%I t where workspace_id=$1 and %I=$2',table_name,key_name)
    into object_value using target_workspace,target_id_value;
  if object_value is null then return null; end if;
  return jsonb_build_object('object',object_value,'parent_id',null,
    'fingerprint',edupi.json_sha256(object_value),'deleted',object_value->>'deleted_at' is not null);
end $$;
revoke all on function edupi.cloud_entity_state(uuid,text,text) from public,anon,authenticated;
grant execute on function edupi.cloud_entity_state(uuid,text,text) to service_role;

create function edupi.cloud_entity_transition(target_workspace uuid,actor_id uuid,entity_request jsonb)
returns jsonb language plpgsql security definer
set search_path=pg_catalog,edupi,extensions as $$
declare
  action_value text:=entity_request->>'action';
  kind_value text:=entity_request->>'kind';
  id_value text:=entity_request->>'id';
  rid text:=entity_request->>'request_id';
  request_hash_value text;
  previous edupi.cloud_entity_receipts%rowtype;
  tomb edupi.cloud_entity_tombstones%rowtype;
  current_state jsonb;
  next_state jsonb;
  table_name text;
  key_name text;
  field_name text;
  deleted_hash text;
  next_revision integer;
  response jsonb;
  parent_row edupi.education_inputs%rowtype;
begin
  if actor_id is null or not exists (
    select 1 from edupi.workspace_members m where m.workspace_id=target_workspace
      and m.account_id=actor_id and m.revoked_at is null
  ) then raise exception 'workspace_forbidden'; end if;
  if action_value='list' then
    return jsonb_build_object('ok',true,'operation','entities','action','list',
      'workspace_id',target_workspace,'states',coalesce((
        select jsonb_agg(jsonb_build_object('kind',x.kind,'id',x.id,
          'fingerprint',edupi.cloud_entity_state(target_workspace,x.kind,x.id)->>'fingerprint'))
        from (
          select 'task'::text kind,task_id id from edupi.tasks where workspace_id=target_workspace and deleted_at is null
          union all select 'student',student_id from edupi.student_profiles where workspace_id=target_workspace and deleted_at is null
          union all select 'material',material_id from edupi.materials where workspace_id=target_workspace and deleted_at is null
          union all select 'memory',memory_id from edupi.memories where workspace_id=target_workspace and deleted_at is null
          union all select i.input_kind,coalesce(e->>'event_id',e->>'slot_id',e->>'id')
            from edupi.education_inputs i cross join lateral jsonb_array_elements(coalesce(
              i.payload->case i.input_kind when 'calendar' then 'events' else 'slots' end,'[]'::jsonb)) e
            where i.workspace_id=target_workspace and i.input_kind in ('calendar','timetable') and i.deleted_at is null
        ) x),'[]'::jsonb),'deletions',coalesce((
        select jsonb_agg(to_jsonb(t) order by t.deleted_at desc) from (
          select kind,target_id,revision,target_fingerprint,label,deleted_at,actor_id
          from edupi.cloud_entity_tombstones where workspace_id=target_workspace
            and restored_at is null order by deleted_at desc limit 1000
        ) t),'[]'::jsonb),'history',coalesce((
        select jsonb_agg(r.response||jsonb_build_object('occurred_at',r.created_at) order by r.created_at desc)
        from (select response,created_at from edupi.cloud_entity_receipts
          where workspace_id=target_workspace order by created_at desc limit 1000) r
      ),'[]'::jsonb),'external_send',false);
  end if;
  if kind_value is null or kind_value not in ('task','student','material','memory','calendar','timetable')
    or id_value is null or length(id_value) not between 1 and 160
    or id_value ~ '[[:cntrl:]]' then raise exception 'invalid_entity'; end if;
  perform pg_advisory_xact_lock(hashtextextended('edupi-entity:'||target_workspace::text||':'||kind_value||':'||id_value,0));
  current_state:=edupi.cloud_entity_state(target_workspace,kind_value,id_value);
  select * into tomb from edupi.cloud_entity_tombstones
    where workspace_id=target_workspace and kind=kind_value and target_id=id_value for update;
  if action_value='read' then
    if current_state is null and tomb.target_id is not null and tomb.restored_at is null then
      current_state:=jsonb_build_object('object',tomb.original,'deleted',true,
        'fingerprint',tomb.deleted_fingerprint,'parent_id',tomb.parent_id);
    end if;
    if current_state is null then raise exception 'target_not_found'; end if;
    return jsonb_build_object('ok',true,'operation','entities','action','read',
      'workspace_id',target_workspace,'target',jsonb_build_object('kind',kind_value,'id',id_value),
      'state',current_state,'tombstone_revision',tomb.revision,'external_send',false);
  end if;
  if action_value is null or action_value not in ('delete','restore') or rid is null
    or length(rid) not between 1 and 160 then raise exception 'invalid_entity_request'; end if;
  request_hash_value:=edupi.json_sha256(entity_request);
  perform pg_advisory_xact_lock(hashtextextended('edupi-entity-request:'||target_workspace::text||':'||rid,0));
  select * into previous from edupi.cloud_entity_receipts where workspace_id=target_workspace and request_id=rid;
  if found then
    if previous.actor_id<>actor_id or previous.request_hash<>request_hash_value then raise exception 'idempotency_conflict'; end if;
    return previous.response||'{"replayed":true}'::jsonb;
  end if;
  -- The existing workspace lock also serializes canonical command/import
  -- writers before the fingerprint is checked.
  perform 1 from edupi.workspaces where id=target_workspace for update;
  current_state:=edupi.cloud_entity_state(target_workspace,kind_value,id_value);
  if action_value='delete' then
    if current_state is null or current_state->>'deleted'='true' then raise exception 'target_not_found'; end if;
    if entity_request->>'expected_fingerprint' is distinct from current_state->>'fingerprint'
      then raise exception 'target_changed'; end if;
    next_revision:=coalesce(tomb.revision,0)+1;
  else
    if tomb.target_id is null or tomb.restored_at is not null then raise exception 'target_not_deleted'; end if;
    if entity_request->>'expected_fingerprint' is distinct from tomb.target_fingerprint
      or (entity_request->>'tombstone_revision')::integer is distinct from tomb.revision then raise exception 'stale_tombstone'; end if;
    if kind_value in ('calendar','timetable') then
      if current_state is not null then raise exception 'target_changed'; end if;
    elsif current_state is null or current_state->>'deleted'<>'true'
      or current_state->>'fingerprint' is distinct from tomb.deleted_fingerprint then raise exception 'target_changed'; end if;
    next_revision:=tomb.revision;
  end if;
  if kind_value in ('calendar','timetable') then
    field_name:=case kind_value when 'calendar' then 'events' else 'slots' end;
    select * into parent_row from edupi.education_inputs
      where workspace_id=target_workspace and input_id=case when action_value='delete'
        then current_state->>'parent_id' else tomb.parent_id end for update;
    if not found or parent_row.deleted_at is not null then raise exception 'target_changed'; end if;
    if action_value='delete' then
      update edupi.education_inputs i set payload=jsonb_set(i.payload,array[field_name],coalesce((
        select jsonb_agg(e) from jsonb_array_elements(i.payload->field_name) e
          where coalesce(e->>'event_id',e->>'slot_id',e->>'id')<>id_value
      ),'[]'::jsonb)),revision=revision+1,updated_at=now()
      where workspace_id=target_workspace and input_id=parent_row.input_id;
      deleted_hash:=edupi.json_sha256(jsonb_build_object('kind',kind_value,'id',id_value,
        'deleted',true,'revision',next_revision,'original',current_state->'object'));
    else
      update edupi.education_inputs i set payload=jsonb_set(i.payload,array[field_name],
        coalesce(i.payload->field_name,'[]'::jsonb)||jsonb_build_array(tomb.original)),
        revision=revision+1,updated_at=now()
      where workspace_id=target_workspace and input_id=parent_row.input_id;
    end if;
  else
    case kind_value
      when 'task' then table_name:='tasks'; key_name:='task_id';
      when 'student' then table_name:='student_profiles'; key_name:='student_id';
      when 'material' then table_name:='materials'; key_name:='material_id';
      when 'memory' then table_name:='memories'; key_name:='memory_id';
    end case;
    execute format('update edupi.%I set deleted_at=$3,updated_at=now()%s where workspace_id=$1 and %I=$2',
      table_name,'',key_name)
      using target_workspace,id_value,case when action_value='delete' then now() else null::timestamptz end;
    if kind_value='task' then
      update edupi.teacher_tasks set deleted_at=case when action_value='delete' then now() else null end,
        updated_at=now() where workspace_id=target_workspace and task_id=id_value;
    end if;
    next_state:=edupi.cloud_entity_state(target_workspace,kind_value,id_value);
    deleted_hash:=next_state->>'fingerprint';
  end if;
  if action_value='delete' then
    insert into edupi.cloud_entity_tombstones(workspace_id,kind,target_id,revision,target_fingerprint,
      deleted_fingerprint,original,parent_id,label,actor_id)
    values(target_workspace,kind_value,id_value,next_revision,current_state->>'fingerprint',deleted_hash,
      current_state->'object',current_state->>'parent_id',coalesce(current_state->'object'->>'title',
        current_state->'object'->>'name',current_state->'object'->>'content',id_value),actor_id)
    on conflict(workspace_id,kind,target_id) do update set revision=excluded.revision,
      target_fingerprint=excluded.target_fingerprint,deleted_fingerprint=excluded.deleted_fingerprint,
      original=excluded.original,parent_id=excluded.parent_id,label=excluded.label,
      actor_id=excluded.actor_id,deleted_at=now(),restored_at=null;
  else
    update edupi.cloud_entity_tombstones set restored_at=now()
      where workspace_id=target_workspace and kind=kind_value and target_id=id_value;
  end if;
  perform edupi.refresh_workspace_snapshot(target_workspace,'cloud_entity_'||action_value);
  response:=jsonb_build_object('ok',true,'operation','entities','action',action_value,
    'request_id',rid,'workspace_id',target_workspace,'target',jsonb_build_object('kind',kind_value,'id',id_value),
    'target_fingerprint',case when action_value='delete' then current_state->>'fingerprint' else tomb.target_fingerprint end,
    'tombstone_revision',next_revision,'deleted_at',case when action_value='delete' then now() else null end,
    'restored_at',case when action_value='restore' then now() else null end,'replayed',false,'external_send',false);
  insert into edupi.cloud_entity_receipts values(target_workspace,rid,actor_id,request_hash_value,response,now());
  return response;
end $$;
revoke all on function edupi.cloud_entity_transition(uuid,uuid,jsonb) from public,anon,authenticated;
grant execute on function edupi.cloud_entity_transition(uuid,uuid,jsonb) to service_role;

insert into edupi.contract_versions(contract_id,contract_version,schema_hash,supported_commands,supported_projections)
values('edupi-cloud-sync-v1','1.0','sha256:2ef7b7849941bc6fd1cb1cff884b9d5ba4f08b8cb83dadaf8968529f3509c197',
  '["sessions","entities","students","runtime"]'::jsonb,'["cloud_sessions","cloud_entity_lifecycle","cloud_students"]'::jsonb);
