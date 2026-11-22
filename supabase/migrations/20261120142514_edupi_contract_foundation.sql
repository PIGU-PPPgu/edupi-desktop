create schema if not exists edupi;

create extension if not exists pgcrypto;

create table if not exists edupi.contract_versions (
  contract_id text primary key,
  contract_version text not null,
  schema_hash text not null,
  core_commit text,
  supported_commands jsonb not null default '[]'::jsonb,
  supported_projections jsonb not null default '[]'::jsonb,
  captured_at timestamptz not null default now()
);

create table if not exists edupi.workspaces (
  id uuid primary key default gen_random_uuid(),
  owner_account_id uuid not null references auth.users(id) on delete restrict,
  mode text not null check (mode in ('local', 'cloud')),
  local_data_ref text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists edupi.workspace_members (
  workspace_id uuid not null references edupi.workspaces(id) on delete cascade,
  account_id uuid not null references auth.users(id) on delete cascade,
  role text not null check (role in ('owner', 'teacher', 'reviewer', 'admin')),
  created_at timestamptz not null default now(),
  primary key (workspace_id, account_id)
);

create table if not exists edupi.student_profiles (
  workspace_id uuid not null references edupi.workspaces(id) on delete cascade,
  student_id text not null,
  name text not null,
  class_name text,
  profile jsonb not null default '{}'::jsonb check (jsonb_typeof(profile) = 'object'),
  revision integer not null default 0 check (revision >= 0),
  deleted_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  primary key (workspace_id, student_id)
);

create table if not exists edupi.student_events (
  workspace_id uuid not null references edupi.workspaces(id) on delete cascade,
  event_id text not null,
  kind text not null check (kind in ('learning', 'interaction')),
  student_ids text[] not null default '{}',
  student_labels text[] not null default '{}',
  class_name text,
  canonical_topic text,
  topic text,
  summary text not null,
  observed_on date,
  recorded_at timestamptz not null,
  updated_at timestamptz not null,
  revision integer not null default 0 check (revision >= 0),
  source jsonb not null check (jsonb_typeof(source) = 'object'),
  history jsonb not null default '[]'::jsonb check (jsonb_typeof(history) = 'array'),
  deleted_at timestamptz,
  external_send boolean not null default false check (external_send = false),
  primary key (workspace_id, event_id)
);

create table if not exists edupi.student_event_revisions (
  workspace_id uuid not null,
  event_id text not null,
  revision integer not null check (revision >= 0),
  payload jsonb not null check (jsonb_typeof(payload) = 'object'),
  request_id text not null,
  recorded_at timestamptz not null default now(),
  primary key (workspace_id, event_id, revision),
  foreign key (workspace_id, event_id)
    references edupi.student_events(workspace_id, event_id)
    on delete cascade
);

create table if not exists edupi.student_topic_aliases (
  workspace_id uuid not null references edupi.workspaces(id) on delete cascade,
  alias text not null,
  canonical text not null,
  updated_at timestamptz not null default now(),
  primary key (workspace_id, alias)
);

create table if not exists edupi.teacher_tasks (
  workspace_id uuid not null references edupi.workspaces(id) on delete cascade,
  task_id text not null,
  title text not null,
  status text not null check (status in ('planned', 'accepted', 'modified', 'rejected', 'hold')),
  revision integer not null default 0 check (revision >= 0),
  task jsonb not null check (jsonb_typeof(task) = 'object'),
  deleted_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  primary key (workspace_id, task_id)
);

create table if not exists edupi.classroom_objects (
  workspace_id uuid not null references edupi.workspaces(id) on delete cascade,
  object_id text not null,
  domain text not null check (domain in ('grades', 'seating', 'duty')),
  revision integer not null default 0 check (revision >= 0),
  created_at timestamptz not null,
  updated_at timestamptz not null,
  input jsonb not null check (jsonb_typeof(input) = 'object'),
  result jsonb not null default '{}'::jsonb check (jsonb_typeof(result) = 'object'),
  issues jsonb not null default '[]'::jsonb check (jsonb_typeof(issues) = 'array'),
  versions jsonb not null default '[]'::jsonb check (jsonb_typeof(versions) = 'array'),
  task_id text,
  publication jsonb check (publication is null or jsonb_typeof(publication) = 'object'),
  deleted_at timestamptz,
  primary key (workspace_id, object_id)
);

create table if not exists edupi.classroom_object_versions (
  workspace_id uuid not null,
  object_id text not null,
  revision integer not null check (revision >= 0),
  action text not null check (action in ('save', 'restore', 'preview', 'publish')),
  input jsonb not null check (jsonb_typeof(input) = 'object'),
  result jsonb not null default '{}'::jsonb check (jsonb_typeof(result) = 'object'),
  issues jsonb not null default '[]'::jsonb check (jsonb_typeof(issues) = 'array'),
  restored_from integer,
  created_at timestamptz not null default now(),
  primary key (workspace_id, object_id, revision),
  foreign key (workspace_id, object_id)
    references edupi.classroom_objects(workspace_id, object_id)
    on delete cascade
);

create table if not exists edupi.task_session_bindings (
  workspace_id uuid not null references edupi.workspaces(id) on delete cascade,
  task_id text not null,
  session_id text not null,
  bound_at timestamptz not null,
  status text not null default 'idle' check (status in ('running', 'idle', 'missing')),
  primary key (workspace_id, task_id),
  unique (workspace_id, session_id)
);

create table if not exists edupi.review_receipts (
  workspace_id uuid not null references edupi.workspaces(id) on delete cascade,
  receipt_id uuid primary key default gen_random_uuid(),
  request_id text not null,
  command_id text not null,
  command_type text not null,
  target_kind text,
  target_id text,
  decision text,
  status text not null,
  applied_ids jsonb not null default '[]'::jsonb,
  rejected_ids jsonb not null default '[]'::jsonb,
  evidence_ids jsonb not null default '[]'::jsonb,
  before_snapshot_id text not null,
  after_snapshot_id text,
  before_state_hash text not null,
  after_state_hash text,
  rollback jsonb not null default '{"available":false,"rollbackId":null,"expiresAt":null}'::jsonb,
  external_send boolean not null default false check (external_send = false),
  created_at timestamptz not null default now(),
  unique (workspace_id, request_id)
);

create index if not exists student_events_workspace_updated_idx
  on edupi.student_events (workspace_id, updated_at desc);

create index if not exists student_events_workspace_student_idx
  on edupi.student_events using gin (student_ids);

create index if not exists classroom_objects_workspace_domain_idx
  on edupi.classroom_objects (workspace_id, domain, updated_at desc);

create index if not exists review_receipts_workspace_created_idx
  on edupi.review_receipts (workspace_id, created_at desc);

create unique index if not exists student_event_revisions_request_idx
  on edupi.student_event_revisions (workspace_id, request_id);

create or replace function edupi.is_workspace_member(target_workspace uuid)
returns boolean
language sql
stable
set search_path = pg_catalog, edupi
as $$
  select exists (
    select 1
    from edupi.workspace_members member
    where member.workspace_id = target_workspace
      and member.account_id = (select auth.uid())
  );
$$;

create or replace function edupi.list_student_events(
  target_workspace uuid,
  p_student_id text default null,
  p_kind text default null,
  p_offset integer default 0,
  p_limit integer default 20,
  p_query text default null,
  p_from date default null,
  p_to date default null
)
returns table (
  event_id text,
  kind text,
  student_ids text[],
  student_labels text[],
  class_name text,
  canonical_topic text,
  topic text,
  summary text,
  observed_on date,
  recorded_at timestamptz,
  updated_at timestamptz,
  revision integer,
  source jsonb,
  history jsonb,
  history_count integer,
  total_count bigint
)
language sql
stable
set search_path = pg_catalog, edupi
as $$
  select
    event.event_id,
    event.kind,
    event.student_ids,
    event.student_labels,
    event.class_name,
    event.canonical_topic,
    event.topic,
    event.summary,
    event.observed_on,
    event.recorded_at,
    event.updated_at,
    event.revision,
    event.source,
    event.history,
    jsonb_array_length(event.history)::integer,
    count(*) over ()
  from edupi.student_events event
  where edupi.is_workspace_member(target_workspace)
    and event.workspace_id = target_workspace
    and event.deleted_at is null
    and (p_student_id is null or event.student_ids @> array[p_student_id]::text[])
    and (p_kind is null or event.kind = p_kind)
    and (p_from is null or event.observed_on >= p_from)
    and (p_to is null or event.observed_on <= p_to)
    and (
      p_query is null
      or position(lower(p_query) in lower(concat_ws(' ', event.summary, event.topic, event.canonical_topic))) > 0
    )
  order by event.updated_at desc, event.event_id asc
  offset greatest(p_offset, 0)
  limit least(greatest(p_limit, 1), 100);
$$;

create or replace function edupi.mutate_student_event(
  target_workspace uuid,
  p_event_id text,
  p_expected_revision integer,
  p_action text,
  p_summary text default null,
  p_topic text default null,
  p_observed_on date default null,
  p_request_id text default gen_random_uuid()::text
)
returns jsonb
language plpgsql
set search_path = pg_catalog, edupi
as $$
declare
  current_row edupi.student_events%rowtype;
  updated_row edupi.student_events%rowtype;
  replay_revision integer;
begin
  if not edupi.is_workspace_member(target_workspace) then
    raise exception using errcode = '42501', message = 'workspace_forbidden';
  end if;

  select revision
    into replay_revision
    from edupi.student_event_revisions
   where workspace_id = target_workspace
     and request_id = p_request_id
   limit 1;
  if replay_revision is not null then
    return jsonb_build_object(
      'ok', true,
      'event_id', p_event_id,
      'revision', replay_revision,
      'replayed', true,
      'external_send', false
    );
  end if;

  select *
    into current_row
    from edupi.student_events
   where workspace_id = target_workspace
     and event_id = p_event_id
     and deleted_at is null
   for update;
  if not found then
    raise exception using errcode = 'P0002', message = 'event_not_found';
  end if;

  if current_row.revision <> p_expected_revision then
    raise exception using errcode = 'P0001', message = 'stale_event';
  end if;
  if p_action not in ('update_event', 'delete_event') then
    raise exception using errcode = '22023', message = 'invalid_event_action';
  end if;

  update edupi.student_events
     set summary = case when p_action = 'update_event' then coalesce(p_summary, current_row.summary) else current_row.summary end,
         topic = case when p_action = 'update_event' then p_topic else current_row.topic end,
         observed_on = case when p_action = 'update_event' then p_observed_on else current_row.observed_on end,
         history = current_row.history || jsonb_build_array(jsonb_build_object(
           'summary', current_row.summary,
           'topic', current_row.topic,
           'observed_on', current_row.observed_on,
           'revision', current_row.revision,
           'updated_at', current_row.updated_at
         )),
         revision = current_row.revision + 1,
         updated_at = now(),
         deleted_at = case when p_action = 'delete_event' then now() else null end
   where workspace_id = target_workspace
     and event_id = p_event_id
     and revision = p_expected_revision
   returning * into updated_row;

  if not found then
    raise exception using errcode = 'P0001', message = 'stale_event';
  end if;

  insert into edupi.student_event_revisions (
    workspace_id, event_id, revision, payload, request_id
  )
  values (
    target_workspace, p_event_id, updated_row.revision, to_jsonb(updated_row), p_request_id
  );

  return jsonb_build_object(
    'ok', true,
    'event_id', updated_row.event_id,
    'revision', updated_row.revision,
    'replayed', false,
    'external_send', false,
    'record', to_jsonb(updated_row)
  );
end;
$$;

create or replace function edupi.set_updated_at()
returns trigger
language plpgsql
set search_path = pg_catalog, edupi
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

drop trigger if exists student_profiles_set_updated_at on edupi.student_profiles;
create trigger student_profiles_set_updated_at
before update on edupi.student_profiles
for each row execute function edupi.set_updated_at();

drop trigger if exists student_events_set_updated_at on edupi.student_events;
create trigger student_events_set_updated_at
before update on edupi.student_events
for each row execute function edupi.set_updated_at();

drop trigger if exists teacher_tasks_set_updated_at on edupi.teacher_tasks;
create trigger teacher_tasks_set_updated_at
before update on edupi.teacher_tasks
for each row execute function edupi.set_updated_at();

alter table edupi.contract_versions enable row level security;
alter table edupi.workspaces enable row level security;
alter table edupi.workspace_members enable row level security;
alter table edupi.student_profiles enable row level security;
alter table edupi.student_events enable row level security;
alter table edupi.student_event_revisions enable row level security;
alter table edupi.student_topic_aliases enable row level security;
alter table edupi.teacher_tasks enable row level security;
alter table edupi.classroom_objects enable row level security;
alter table edupi.classroom_object_versions enable row level security;
alter table edupi.task_session_bindings enable row level security;
alter table edupi.review_receipts enable row level security;

create policy contract_versions_authenticated_read on edupi.contract_versions
for select to authenticated using (true);

create policy workspaces_member_read on edupi.workspaces
for select to authenticated
using (owner_account_id = (select auth.uid()) or edupi.is_workspace_member(id));

create policy workspace_members_self_or_owner_read on edupi.workspace_members
for select to authenticated
using (
  account_id = (select auth.uid())
  or exists (
    select 1 from edupi.workspaces workspace
    where workspace.id = workspace_members.workspace_id
      and workspace.owner_account_id = (select auth.uid())
  )
);

create policy student_profiles_member_read on edupi.student_profiles
for select to authenticated using (edupi.is_workspace_member(workspace_id));

create policy student_events_member_read on edupi.student_events
for select to authenticated using (edupi.is_workspace_member(workspace_id));

create policy student_events_member_update on edupi.student_events
for update to authenticated
using (edupi.is_workspace_member(workspace_id))
with check (edupi.is_workspace_member(workspace_id));

create policy student_events_member_delete on edupi.student_events
for delete to authenticated using (edupi.is_workspace_member(workspace_id));

create policy student_event_revisions_member_read on edupi.student_event_revisions
for select to authenticated using (edupi.is_workspace_member(workspace_id));

create policy student_event_revisions_member_insert on edupi.student_event_revisions
for insert to authenticated with check (edupi.is_workspace_member(workspace_id));

create policy student_topic_aliases_member_read on edupi.student_topic_aliases
for select to authenticated using (edupi.is_workspace_member(workspace_id));

create policy student_topic_aliases_member_insert on edupi.student_topic_aliases
for insert to authenticated with check (edupi.is_workspace_member(workspace_id));

create policy student_topic_aliases_member_update on edupi.student_topic_aliases
for update to authenticated
using (edupi.is_workspace_member(workspace_id))
with check (edupi.is_workspace_member(workspace_id));

create policy teacher_tasks_member_read on edupi.teacher_tasks
for select to authenticated using (edupi.is_workspace_member(workspace_id));

create policy classroom_objects_member_read on edupi.classroom_objects
for select to authenticated using (edupi.is_workspace_member(workspace_id));

create policy classroom_object_versions_member_read on edupi.classroom_object_versions
for select to authenticated using (edupi.is_workspace_member(workspace_id));

create policy task_session_bindings_member_read on edupi.task_session_bindings
for select to authenticated using (edupi.is_workspace_member(workspace_id));

create policy review_receipts_member_read on edupi.review_receipts
for select to authenticated using (edupi.is_workspace_member(workspace_id));

revoke all on schema edupi from anon, authenticated;
grant usage on schema edupi to authenticated;
grant select on edupi.contract_versions to authenticated;
grant select on edupi.workspaces, edupi.workspace_members, edupi.student_profiles,
  edupi.student_events, edupi.student_event_revisions, edupi.teacher_tasks,
  edupi.student_topic_aliases,
  edupi.classroom_objects, edupi.classroom_object_versions,
  edupi.task_session_bindings, edupi.review_receipts to authenticated;
grant insert, update, delete on edupi.student_events, edupi.student_event_revisions,
  edupi.student_topic_aliases to authenticated;
grant execute on function edupi.list_student_events(uuid, text, text, integer, integer, text, date, date) to authenticated;
grant execute on function edupi.mutate_student_event(uuid, text, integer, text, text, text, date, text) to authenticated;

insert into edupi.contract_versions (
  contract_id,
  contract_version,
  schema_hash,
  core_commit,
  supported_commands,
  supported_projections
)
values
(
  'edupi-bridge-v1.1',
  '1.1',
  'sha256:2749b1208b47bf475bd30d266b5ca1b213aa78c6c8b4dcd53059c524400565c8',
  '3ce22b1e08804aa36dccf59d76a8e61b15f2c462',
  '["review_observation","review_memory_candidate","review_teacher_context","review_work_candidate","review_follow_up","review_task","import_calendar","import_timetable","intake_material","create_task","move_task_stage","update_memory"]'::jsonb,
  '["education_workspace"]'::jsonb
),
(
  'edupi-schedule-occurrence-v1.2',
  '1.2',
  'sha256:b739852f427520f787ad32c7f41b258976a3b41d60fa6116439696c1495b97cb',
  '3ce22b1e08804aa36dccf59d76a8e61b15f2c462',
  '["import_calendar"]'::jsonb,
  '["schedule_occurrence"]'::jsonb
)
on conflict (contract_id) do update set
  contract_version = excluded.contract_version,
  schema_hash = excluded.schema_hash,
  core_commit = excluded.core_commit,
  supported_commands = excluded.supported_commands,
  supported_projections = excluded.supported_projections,
  captured_at = now();
