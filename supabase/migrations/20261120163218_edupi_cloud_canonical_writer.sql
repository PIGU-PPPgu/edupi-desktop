create table if not exists edupi.workspace_snapshots (
  workspace_id uuid not null references edupi.workspaces(id) on delete cascade,
  revision bigint not null check (revision >= 0),
  snapshot_id text not null,
  state_hash text not null check (state_hash ~ '^sha256:[A-Za-z0-9_-]+$'),
  payload jsonb not null check (jsonb_typeof(payload) = 'object'),
  reason text,
  created_at timestamptz not null default now(),
  primary key (workspace_id, revision),
  unique (workspace_id, snapshot_id),
  unique (workspace_id, state_hash)
);

alter table edupi.workspace_members
  add column if not exists revoked_at timestamptz,
  add column if not exists revocation_generation bigint not null default 0 check (revocation_generation >= 0);

create table if not exists edupi.workspace_provision_requests (
  account_id uuid not null references auth.users(id) on delete cascade,
  request_id text not null,
  workspace_id uuid not null references edupi.workspaces(id) on delete cascade,
  created_at timestamptz not null default now(),
  primary key (account_id, request_id),
  unique (workspace_id)
);

create table if not exists edupi.command_receipts (
  workspace_id uuid not null references edupi.workspaces(id) on delete cascade,
  receipt_id uuid primary key default gen_random_uuid(),
  request_id text not null,
  message_id text not null,
  idempotency_key text not null,
  envelope_hash text not null,
  command_type text not null,
  status text not null check (status in ('accepted', 'modified', 'replayed', 'rejected', 'failed', 'stale_snapshot')),
  before_snapshot_id text not null,
  after_snapshot_id text,
  before_state_hash text not null,
  after_state_hash text,
  receipt jsonb not null check (jsonb_typeof(receipt) = 'object'),
  envelope jsonb not null check (jsonb_typeof(envelope) = 'object'),
  actor_id uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (workspace_id, request_id),
  unique (workspace_id, idempotency_key)
);

create table if not exists edupi.audit_events (
  workspace_id uuid not null references edupi.workspaces(id) on delete cascade,
  audit_id uuid primary key default gen_random_uuid(),
  request_id text,
  actor_id uuid references auth.users(id) on delete set null,
  event_kind text not null,
  target_kind text,
  target_id text,
  payload jsonb not null default '{}'::jsonb check (jsonb_typeof(payload) = 'object'),
  external_send boolean not null default false check (external_send = false),
  created_at timestamptz not null default now()
);

create table if not exists edupi.tasks (
  workspace_id uuid not null references edupi.workspaces(id) on delete cascade,
  task_id text not null,
  title text not null,
  due_date date,
  note text,
  stage text not null default 'todo' check (stage in ('todo', 'progress', 'review', 'done')),
  status text not null default 'planned' check (status in ('planned', 'accepted', 'modified', 'rejected', 'hold')),
  revision integer not null default 0 check (revision >= 0),
  task jsonb not null check (jsonb_typeof(task) = 'object'),
  preparation_source jsonb check (preparation_source is null or jsonb_typeof(preparation_source) = 'object'),
  deleted_at timestamptz,
  external_send boolean not null default false check (external_send = false),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  primary key (workspace_id, task_id)
);

create table if not exists edupi.task_versions (
  workspace_id uuid not null,
  task_id text not null,
  revision integer not null check (revision >= 0),
  action text not null,
  payload jsonb not null check (jsonb_typeof(payload) = 'object'),
  request_id text not null,
  created_at timestamptz not null default now(),
  primary key (workspace_id, task_id, revision),
  foreign key (workspace_id, task_id)
    references edupi.tasks(workspace_id, task_id)
    on delete cascade
);

create table if not exists edupi.memories (
  workspace_id uuid not null references edupi.workspaces(id) on delete cascade,
  memory_id text not null,
  category text not null check (category in ('semester', 'class', 'teaching', 'preferences', 'school')),
  content text not null,
  state text not null default 'active' check (state in ('active', 'superseded')),
  memory jsonb not null default '{}'::jsonb check (jsonb_typeof(memory) = 'object'),
  revision integer not null default 0 check (revision >= 0),
  external_send boolean not null default false check (external_send = false),
  deleted_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  primary key (workspace_id, memory_id)
);

create table if not exists edupi.education_inputs (
  workspace_id uuid not null references edupi.workspaces(id) on delete cascade,
  input_id text not null,
  input_kind text not null check (input_kind in ('calendar', 'timetable', 'observation', 'follow_up', 'work_case')),
  revision integer not null default 0 check (revision >= 0),
  payload jsonb not null check (jsonb_typeof(payload) = 'object'),
  request_id text not null,
  external_send boolean not null default false check (external_send = false),
  deleted_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  primary key (workspace_id, input_id),
  unique (workspace_id, request_id)
);

create table if not exists edupi.materials (
  workspace_id uuid not null references edupi.workspaces(id) on delete cascade,
  material_id text not null,
  title text not null,
  kind text not null check (kind in ('worksheet', 'lesson_note', 'assessment', 'classroom_record', 'other')),
  subject text,
  class_id text,
  relative_path text,
  source_hash text,
  storage_bucket text not null default 'edupi-materials',
  storage_object_key text,
  intake_state text not null default 'accepted' check (intake_state in ('staged', 'accepted', 'rejected', 'deleted')),
  metadata_revision integer not null default 0 check (metadata_revision >= 0),
  metadata_history_count integer not null default 0 check (metadata_history_count >= 0),
  metadata_updated_at timestamptz not null default now(),
  material jsonb not null default '{}'::jsonb check (jsonb_typeof(material) = 'object'),
  deleted_at timestamptz,
  external_send boolean not null default false check (external_send = false),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  primary key (workspace_id, material_id)
);

create table if not exists edupi.material_versions (
  workspace_id uuid not null,
  material_id text not null,
  version_id text not null,
  revision integer not null check (revision >= 1),
  before_values jsonb not null check (jsonb_typeof(before_values) = 'object'),
  after_values jsonb not null check (jsonb_typeof(after_values) = 'object'),
  changed_fields jsonb not null default '[]'::jsonb check (jsonb_typeof(changed_fields) = 'array'),
  changed_at timestamptz not null default now(),
  source_kind text not null check (source_kind in ('teacher_edit', 'agent_update', 'restore')),
  request_id text not null,
  external_send boolean not null default false check (external_send = false),
  primary key (workspace_id, material_id, version_id),
  unique (workspace_id, request_id),
  foreign key (workspace_id, material_id)
    references edupi.materials(workspace_id, material_id)
    on delete cascade
);

create table if not exists edupi.artifacts (
  workspace_id uuid not null references edupi.workspaces(id) on delete cascade,
  artifact_id text not null,
  title text not null,
  relative_path text,
  storage_bucket text not null default 'edupi-materials',
  storage_object_key text,
  session_id text,
  task_id text,
  origin text not null default 'preparation',
  access text not null default 'editable' check (access in ('editable', 'read_only')),
  sha256 text,
  size_bytes bigint check (size_bytes is null or size_bytes >= 0),
  revision integer not null default 0 check (revision >= 0),
  artifact jsonb not null default '{}'::jsonb check (jsonb_typeof(artifact) = 'object'),
  deleted_at timestamptz,
  external_send boolean not null default false check (external_send = false),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  primary key (workspace_id, artifact_id)
);

create table if not exists edupi.facts (
  workspace_id uuid not null references edupi.workspaces(id) on delete cascade,
  fact_id text not null,
  entity_id text not null,
  fact_kind text not null check (fact_kind in ('error_pattern', 'progress', 'behavior', 'general', 'safety', 'academic', 'material', 'evidence')),
  predicate text not null,
  value text not null,
  subject_ref text,
  topic_ref text,
  confidence jsonb not null default '{"basis":"inferred","score":0}'::jsonb check (jsonb_typeof(confidence) = 'object'),
  status text not null default 'candidate' check (status in ('candidate', 'pending_review', 'held', 'accepted', 'rejected', 'superseded', 'deleted')),
  source_ids text[] not null default '{}',
  observation_ids text[] not null default '{}',
  conflict_ids text[] not null default '{}',
  has_predecessor boolean not null default false,
  revision integer not null default 0 check (revision >= 0),
  deleted_previous_status text,
  deleted_at timestamptz,
  external_send boolean not null default false check (external_send = false),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  primary key (workspace_id, fact_id)
);

create table if not exists edupi.fact_observations (
  workspace_id uuid not null references edupi.workspaces(id) on delete cascade,
  observation_id text not null,
  source_kind text not null check (source_kind in ('teacher_utterance', 'material', 'calendar', 'timetable', 'legacy')),
  source_id text not null,
  source_revision text not null,
  observation_text text not null,
  content_hash text not null,
  observed_at timestamptz not null,
  actor_ref text not null,
  entity_ids text[] not null default '{}',
  status text not null default 'active' check (status in ('active', 'stale')),
  revision integer not null default 0 check (revision >= 0),
  external_send boolean not null default false check (external_send = false),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  primary key (workspace_id, observation_id)
);

create table if not exists edupi.fact_reviews (
  workspace_id uuid not null references edupi.workspaces(id) on delete cascade,
  review_id uuid primary key default gen_random_uuid(),
  request_id text not null,
  fact_id text not null,
  action text not null check (action in ('capture', 'review', 'modify', 'delete', 'restore')),
  decision text,
  revision integer not null check (revision >= 0),
  result_fact_id text not null,
  status text not null,
  superseded_fact_id text,
  reviewer text not null,
  note text,
  before_payload jsonb not null default '{}'::jsonb check (jsonb_typeof(before_payload) = 'object'),
  after_payload jsonb not null default '{}'::jsonb check (jsonb_typeof(after_payload) = 'object'),
  external_send boolean not null default false check (external_send = false),
  created_at timestamptz not null default now(),
  unique (workspace_id, request_id)
);

create table if not exists edupi.fact_conflicts (
  workspace_id uuid not null references edupi.workspaces(id) on delete cascade,
  conflict_id text not null,
  entity_id text not null,
  predicate text not null,
  fact_ids text[] not null check (cardinality(fact_ids) = 2),
  source_ids text[] not null default '{}',
  revision integer not null default 0 check (revision >= 0),
  external_send boolean not null default false check (external_send = false),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  primary key (workspace_id, conflict_id)
);

create table if not exists edupi.fact_spine_snapshots (
  workspace_id uuid not null references edupi.workspaces(id) on delete cascade,
  revision bigint not null check (revision >= 0),
  state_hash text not null check (state_hash ~ '^sha256:[A-Za-z0-9_-]+$'),
  spine jsonb not null check (jsonb_typeof(spine) = 'object'),
  generated_at timestamptz not null default now(),
  external_send boolean not null default false check (external_send = false),
  primary key (workspace_id, revision),
  unique (workspace_id, state_hash)
);

create table if not exists edupi.work_cases (
  workspace_id uuid not null references edupi.workspaces(id) on delete cascade,
  work_case_id text not null,
  task_id text,
  current_state text not null,
  revision integer not null default 0 check (revision >= 0),
  work_case jsonb not null default '{}'::jsonb check (jsonb_typeof(work_case) = 'object'),
  deleted_at timestamptz,
  external_send boolean not null default false check (external_send = false),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  primary key (workspace_id, work_case_id)
);

create table if not exists edupi.work_case_transitions (
  workspace_id uuid not null,
  work_case_id text not null,
  revision integer not null check (revision >= 1),
  from_state text,
  to_state text not null,
  request_id text not null,
  payload jsonb not null default '{}'::jsonb check (jsonb_typeof(payload) = 'object'),
  created_at timestamptz not null default now(),
  primary key (workspace_id, work_case_id, revision),
  foreign key (workspace_id, work_case_id)
    references edupi.work_cases(workspace_id, work_case_id)
    on delete cascade
);

create table if not exists edupi.core_runtime_instances (
  workspace_id uuid not null references edupi.workspaces(id) on delete cascade,
  instance_id text not null,
  instance_nonce text not null,
  core_commit text not null,
  component_manifest_hash text,
  runtime_schema_hash text,
  data_root_fingerprint text,
  status text not null default 'registered' check (status in ('registered', 'ready', 'draining', 'stopped', 'quarantined')),
  fencing_generation bigint not null default 1 check (fencing_generation >= 1),
  capabilities jsonb not null default '{}'::jsonb check (jsonb_typeof(capabilities) = 'object'),
  metadata jsonb not null default '{}'::jsonb check (jsonb_typeof(metadata) = 'object'),
  registered_at timestamptz not null default now(),
  last_seen_at timestamptz not null default now(),
  stopped_at timestamptz,
  primary key (workspace_id, instance_id)
);

create table if not exists edupi.core_runtime_leases (
  workspace_id uuid not null references edupi.workspaces(id) on delete cascade,
  lease_name text not null,
  instance_id text not null,
  instance_nonce text not null,
  fencing_generation bigint not null check (fencing_generation >= 1),
  lease_token_hash text not null,
  expires_at timestamptz not null,
  updated_at timestamptz not null default now(),
  primary key (workspace_id, lease_name)
);

create table if not exists edupi.core_runtime_events (
  workspace_id uuid not null references edupi.workspaces(id) on delete cascade,
  event_id uuid primary key default gen_random_uuid(),
  instance_id text not null,
  instance_nonce text not null,
  fencing_generation bigint not null check (fencing_generation >= 1),
  event_kind text not null,
  payload jsonb not null default '{}'::jsonb check (jsonb_typeof(payload) = 'object'),
  created_at timestamptz not null default now()
);

create index if not exists workspace_snapshots_workspace_created_idx
  on edupi.workspace_snapshots (workspace_id, revision desc);

create index if not exists command_receipts_workspace_created_idx
  on edupi.command_receipts (workspace_id, created_at desc);

create index if not exists audit_events_workspace_created_idx
  on edupi.audit_events (workspace_id, created_at desc);

create index if not exists tasks_workspace_updated_idx
  on edupi.tasks (workspace_id, updated_at desc);

create index if not exists materials_workspace_updated_idx
  on edupi.materials (workspace_id, updated_at desc);

create index if not exists facts_workspace_updated_idx
  on edupi.facts (workspace_id, updated_at desc);

create index if not exists core_runtime_instances_workspace_seen_idx
  on edupi.core_runtime_instances (workspace_id, last_seen_at desc);

create index if not exists core_runtime_events_workspace_created_idx
  on edupi.core_runtime_events (workspace_id, created_at desc);

create or replace function edupi.json_sha256(payload jsonb)
returns text
language sql
immutable
set search_path = pg_catalog, edupi, extensions
as $$
  select 'sha256:' || encode(digest(convert_to(payload::text, 'utf8'), 'sha256'), 'hex');
$$;

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
      and member.revoked_at is null
  );
$$;

create or replace function edupi.create_workspace(
  p_request_id text,
  p_mode text default 'cloud'
)
returns jsonb
language plpgsql
security definer
set search_path = pg_catalog, edupi, extensions
as $$
declare
  actor_id uuid := auth.uid();
  existing_workspace uuid;
  workspace_id_value uuid;
  snapshot jsonb;
begin
  if actor_id is null or p_request_id is null or length(trim(p_request_id)) = 0
    or length(p_request_id) > 240 or p_mode not in ('local', 'cloud') then
    raise exception using errcode = '22023', message = 'invalid_workspace_request';
  end if;
  select workspace_id
    into existing_workspace
    from edupi.workspace_provision_requests
   where account_id = actor_id and request_id = p_request_id;
  if existing_workspace is not null then
    return jsonb_build_object(
      'ok', true,
      'workspace_id', existing_workspace,
      'replayed', true,
      'external_send', false
    );
  end if;

  insert into edupi.workspaces (owner_account_id, mode)
  values (actor_id, p_mode)
  returning id into workspace_id_value;
  insert into edupi.workspace_members (workspace_id, account_id, role)
  values (workspace_id_value, actor_id, 'owner');
  insert into edupi.workspace_provision_requests (account_id, request_id, workspace_id)
  values (actor_id, p_request_id, workspace_id_value);
  snapshot := edupi.refresh_workspace_snapshot(workspace_id_value, 'workspace_created');
  return jsonb_build_object(
    'ok', true,
    'workspace_id', workspace_id_value,
    'role', 'owner',
    'snapshot', snapshot,
    'replayed', false,
    'external_send', false
  );
end;
$$;

create or replace function edupi.revoke_workspace_member(
  target_workspace uuid,
  target_account uuid,
  p_request_id text
)
returns jsonb
language plpgsql
security definer
set search_path = pg_catalog, edupi, extensions
as $$
declare
  actor_id uuid := auth.uid();
  actor_role text;
  next_generation bigint;
begin
  select role
    into actor_role
    from edupi.workspace_members
   where workspace_id = target_workspace
     and account_id = actor_id
     and revoked_at is null;
  if actor_role not in ('owner', 'admin') then
    raise exception using errcode = '42501', message = 'workspace_forbidden';
  end if;
  if target_account = actor_id then
    raise exception using errcode = '22023', message = 'cannot_revoke_self';
  end if;
  update edupi.workspace_members
     set revoked_at = coalesce(revoked_at, now()),
         revocation_generation = revocation_generation + 1
   where workspace_id = target_workspace
     and account_id = target_account
  returning revocation_generation into next_generation;
  if next_generation is null then
    raise exception using errcode = 'P0002', message = 'member_not_found';
  end if;
  insert into edupi.audit_events (
    workspace_id, request_id, actor_id, event_kind, target_kind, target_id, payload
  )
  values (
    target_workspace, p_request_id, actor_id, 'workspace_member_revoked',
    'account', target_account::text,
    jsonb_build_object('revocation_generation', next_generation)
  );
  return jsonb_build_object(
    'ok', true,
    'workspace_id', target_workspace,
    'account_id', target_account,
    'revocation_generation', next_generation,
    'external_send', false
  );
end;
$$;

create or replace function edupi.workspace_snapshot_payload(target_workspace uuid)
returns jsonb
language sql
stable
set search_path = pg_catalog, edupi, extensions
as $$
  select jsonb_build_object(
    'workspace_id', target_workspace,
    'tasks', coalesce((
      select jsonb_agg(to_jsonb(item) order by item.task_id)
      from (
        select task_id, title, due_date, note, stage, status, revision, task, preparation_source, external_send
        from edupi.tasks
        where workspace_id = target_workspace and deleted_at is null
      ) item
    ), '[]'::jsonb),
    'facts', coalesce((
      select jsonb_agg(to_jsonb(item) order by item.fact_id)
      from (
        select fact_id, entity_id, fact_kind, predicate, value, subject_ref, topic_ref, confidence,
          status, source_ids, observation_ids, conflict_ids, has_predecessor, revision, external_send
        from edupi.facts
        where workspace_id = target_workspace and deleted_at is null
      ) item
    ), '[]'::jsonb),
    'fact_observations', coalesce((
      select jsonb_agg(to_jsonb(item) order by item.observation_id)
      from (
        select observation_id, source_kind, source_id, source_revision, observation_text, content_hash,
          observed_at, actor_ref, entity_ids, status, revision, external_send
        from edupi.fact_observations
        where workspace_id = target_workspace
      ) item
    ), '[]'::jsonb),
    'materials', coalesce((
      select jsonb_agg(to_jsonb(item) order by item.material_id)
      from (
        select material_id, title, kind, subject, class_id, relative_path, source_hash, storage_bucket,
          storage_object_key, intake_state, metadata_revision, metadata_history_count, metadata_updated_at,
          material, external_send
        from edupi.materials
        where workspace_id = target_workspace and deleted_at is null
      ) item
    ), '[]'::jsonb),
    'artifacts', coalesce((
      select jsonb_agg(to_jsonb(item) order by item.artifact_id)
      from (
        select artifact_id, title, relative_path, storage_bucket, storage_object_key, session_id, task_id,
          origin, access, sha256, size_bytes, revision, artifact, external_send
        from edupi.artifacts
        where workspace_id = target_workspace and deleted_at is null
      ) item
    ), '[]'::jsonb),
    'classroom_objects', coalesce((
      select jsonb_agg(to_jsonb(item) order by item.object_id)
      from (
        select object_id, domain, revision, input, result, issues, versions, task_id, publication
        from edupi.classroom_objects
        where workspace_id = target_workspace and deleted_at is null
      ) item
    ), '[]'::jsonb),
    'memories', coalesce((
      select jsonb_agg(to_jsonb(item) order by item.memory_id)
      from (
        select memory_id, category, content, state, memory, revision, external_send
        from edupi.memories
        where workspace_id = target_workspace and deleted_at is null
      ) item
    ), '[]'::jsonb),
    'work_cases', coalesce((
      select jsonb_agg(to_jsonb(item) order by item.work_case_id)
      from (
        select work_case_id, task_id, current_state, revision, work_case, external_send
        from edupi.work_cases
        where workspace_id = target_workspace and deleted_at is null
      ) item
    ), '[]'::jsonb),
    'external_send', false
  );
$$;

create or replace function edupi.refresh_workspace_snapshot(target_workspace uuid, snapshot_reason text default null)
returns jsonb
language plpgsql
security definer
set search_path = pg_catalog, edupi, extensions
as $$
declare
  current_snapshot edupi.workspace_snapshots%rowtype;
  next_payload jsonb;
  next_hash text;
  next_id text;
  next_revision bigint;
begin
  perform 1
  from edupi.workspaces
  where id = target_workspace
  for update;
  if not found then
    raise exception using errcode = 'P0002', message = 'workspace_not_found';
  end if;

  select *
    into current_snapshot
    from edupi.workspace_snapshots
   where workspace_id = target_workspace
   order by revision desc
   limit 1;

  next_payload := edupi.workspace_snapshot_payload(target_workspace);
  next_hash := edupi.json_sha256(next_payload);
  if current_snapshot.state_hash = next_hash then
    return jsonb_build_object(
      'snapshot_id', current_snapshot.snapshot_id,
      'state_hash', current_snapshot.state_hash,
      'revision', current_snapshot.revision,
      'payload', current_snapshot.payload
    );
  end if;

  next_id := 'snapshot_' || substring(next_hash from 8);
  next_revision := coalesce(current_snapshot.revision, -1) + 1;
  insert into edupi.workspace_snapshots (
    workspace_id, revision, snapshot_id, state_hash, payload, reason
  )
  values (
    target_workspace, next_revision, next_id, next_hash, next_payload, snapshot_reason
  )
  on conflict (workspace_id, state_hash) do nothing;

  select snapshot_id, state_hash, revision, payload
    into current_snapshot.snapshot_id, current_snapshot.state_hash,
      current_snapshot.revision, current_snapshot.payload
    from edupi.workspace_snapshots
   where workspace_id = target_workspace
     and state_hash = next_hash;

  return jsonb_build_object(
    'snapshot_id', current_snapshot.snapshot_id,
    'state_hash', current_snapshot.state_hash,
    'revision', current_snapshot.revision,
    'payload', current_snapshot.payload
  );
end;
$$;

create or replace function edupi.refresh_fact_spine(target_workspace uuid)
returns jsonb
language plpgsql
security definer
set search_path = pg_catalog, edupi, extensions
as $$
declare
  base_spine jsonb;
  spine_hash text;
  next_revision bigint;
  existing edupi.fact_spine_snapshots%rowtype;
begin
  select *
    into existing
    from edupi.fact_spine_snapshots
   where workspace_id = target_workspace
   order by revision desc
   limit 1;

  base_spine := jsonb_build_object(
    'projection_kind', 'education_fact_v1',
    'generated_at', now(),
    'entities', '[]'::jsonb,
    'observations', coalesce((
      select jsonb_agg(to_jsonb(item) order by item.id)
      from (
        select observation_id as id, source_kind as source_kind, source_id as source_id,
          source_revision as source_revision, observation_text as text, content_hash,
          observed_at, actor_ref, entity_ids, status, revision
        from edupi.fact_observations
        where workspace_id = target_workspace
      ) item
    ), '[]'::jsonb),
    'acceptedFacts', coalesce((
      select jsonb_agg(to_jsonb(item) order by item.id)
      from (
        select fact_id as id, entity_id as "entityId", fact_kind as kind, predicate, value,
          subject_ref as "subjectRef", topic_ref as "topicRef", confidence, status,
          source_ids as "sourceIds", observation_ids as "observationIds",
          conflict_ids as "conflictIds", has_predecessor as "hasPredecessor", revision
        from edupi.facts
        where workspace_id = target_workspace and status = 'accepted' and deleted_at is null
      ) item
    ), '[]'::jsonb),
    'factCandidates', coalesce((
      select jsonb_agg(to_jsonb(item) order by item.id)
      from (
        select fact_id as id, entity_id as "entityId", fact_kind as kind, predicate, value,
          subject_ref as "subjectRef", topic_ref as "topicRef", confidence, status,
          source_ids as "sourceIds", observation_ids as "observationIds",
          conflict_ids as "conflictIds", has_predecessor as "hasPredecessor", revision
        from edupi.facts
        where workspace_id = target_workspace
          and status in ('candidate', 'pending_review', 'held')
          and deleted_at is null
      ) item
    ), '[]'::jsonb),
    'hypotheses', '[]'::jsonb,
    'conflicts', coalesce((
      select jsonb_agg(to_jsonb(item) order by item.id)
      from (
        select conflict_id as id, entity_id, predicate, fact_ids, source_ids, revision
        from edupi.fact_conflicts
        where workspace_id = target_workspace
      ) item
    ), '[]'::jsonb),
    'studentViews', '[]'::jsonb,
    'teachingView', jsonb_build_object('acceptedFactIds', '[]'::jsonb, 'bySubject', '[]'::jsonb),
    'nextLessonFactIds', '[]'::jsonb,
    'uses', '[]'::jsonb,
    'external_send', false
  );
  spine_hash := edupi.json_sha256(base_spine);
  if existing.state_hash = spine_hash then
    return jsonb_build_object(
      'state_hash', existing.state_hash,
      'revision', existing.revision,
      'spine', existing.spine,
      'external_send', false
    );
  end if;

  next_revision := coalesce(existing.revision, -1) + 1;
  insert into edupi.fact_spine_snapshots (
    workspace_id, revision, state_hash, spine
  )
  values (
    target_workspace, next_revision, spine_hash,
    base_spine || jsonb_build_object('state_hash', spine_hash)
  )
  on conflict (workspace_id, state_hash) do nothing;

  select *
    into existing
    from edupi.fact_spine_snapshots
   where workspace_id = target_workspace
     and state_hash = spine_hash;

  return jsonb_build_object(
    'state_hash', existing.state_hash,
    'revision', existing.revision,
    'spine', existing.spine,
    'external_send', false
  );
end;
$$;

create or replace function edupi.apply_core_command(
  target_workspace uuid,
  actor_id uuid,
  command_envelope jsonb
)
returns jsonb
language plpgsql
security definer
set search_path = pg_catalog, edupi, extensions
as $$
declare
  current_snapshot jsonb;
  after_snapshot jsonb;
  existing_receipt edupi.command_receipts%rowtype;
  command jsonb;
  command_type text;
  request_id_value text;
  message_id_value text;
  idempotency_key_value text;
  envelope_hash_value text;
  target_kind text := null;
  target_id text := null;
  receipt_status text := 'accepted';
  applied_ids jsonb := '[]'::jsonb;
  rejected_ids jsonb := '[]'::jsonb;
  evidence_ids jsonb := '[]'::jsonb;
  teacher_review jsonb;
  rollback jsonb := '{"available":false,"rollbackId":null,"expiresAt":null}'::jsonb;
  task_row edupi.tasks%rowtype;
  material_row edupi.materials%rowtype;
  memory_row edupi.memories%rowtype;
  task_id_value text;
  material_id_value text;
  memory_id_value text;
  stage_value text;
  expected_revision_value integer;
  next_revision integer;
  status_value text;
  receipt_payload jsonb;
  receipt_envelope jsonb;
  receipt_uuid uuid;
begin
  if actor_id is null or not exists (
    select 1
    from edupi.workspace_members
    where workspace_id = target_workspace and account_id = actor_id
  ) then
    raise exception using errcode = '42501', message = 'workspace_forbidden';
  end if;
  if jsonb_typeof(command_envelope) <> 'object'
    or command_envelope->>'contract_version' <> '1.1'
    or command_envelope->>'schema_hash' <> 'sha256:2749b1208b47bf475bd30d266b5ca1b213aa78c6c8b4dcd53059c524400565c8'
    or command_envelope->>'external_send' <> 'false'
    or jsonb_typeof(command_envelope->'command') <> 'object' then
    raise exception using errcode = '22023', message = 'invalid_envelope';
  end if;

  command := command_envelope->'command';
  command_type := command->>'command_type';
  request_id_value := command_envelope->>'request_id';
  message_id_value := command_envelope->>'message_id';
  idempotency_key_value := command_envelope->>'idempotency_key';
  envelope_hash_value := edupi.json_sha256(command_envelope);
  teacher_review := coalesce(command_envelope->'teacher_review', '{"state":"pending_review","reviewer_id":null,"reviewed_at":null,"note":null,"revision":0}'::jsonb);
  if request_id_value is null or message_id_value is null or idempotency_key_value is null
    or command_type is null then
    raise exception using errcode = '22023', message = 'invalid_envelope';
  end if;

  select *
    into existing_receipt
    from edupi.command_receipts
   where workspace_id = target_workspace
     and request_id = request_id_value
   for update;
  if found then
    if existing_receipt.envelope_hash <> envelope_hash_value then
      raise exception using errcode = 'P0001', message = 'idempotency_conflict';
    end if;
    return jsonb_build_object(
      'ok', true,
      'operation', 'command',
      'request_id', existing_receipt.request_id,
      'replayed', true,
      'supported_commands', '["review_observation","review_memory_candidate","review_teacher_context","review_work_candidate","review_follow_up","review_task","import_calendar","import_timetable","intake_material","create_task","move_task_stage","update_memory"]'::jsonb,
      'supported_projections', '["education_workspace"]'::jsonb,
      'receipt', existing_receipt.receipt,
      'snapshot_id', existing_receipt.after_snapshot_id,
      'state_hash', existing_receipt.after_state_hash,
      'external_send', false
    );
  end if;

  select *
    into existing_receipt
    from edupi.command_receipts
   where workspace_id = target_workspace
     and idempotency_key = idempotency_key_value
   for update;
  if found and existing_receipt.request_id <> request_id_value then
    raise exception using errcode = 'P0001', message = 'idempotency_conflict';
  end if;

  current_snapshot := edupi.refresh_workspace_snapshot(target_workspace, 'command_before');
  if command_envelope->>'snapshot_id' <> current_snapshot->>'snapshot_id' then
    raise exception using errcode = 'P0001', message = 'stale_snapshot';
  end if;

  if command_type not in (
    'review_observation', 'review_memory_candidate', 'review_teacher_context',
    'review_work_candidate', 'review_follow_up', 'review_task',
    'import_calendar', 'import_timetable', 'intake_material',
    'create_task', 'move_task_stage', 'update_memory'
  ) then
    raise exception using errcode = '22023', message = 'unsupported_command';
  end if;

  if command_type = 'create_task' then
    task_id_value := command->'task'->>'task_id';
    if task_id_value is null or command->'task'->>'title' is null then
      raise exception using errcode = '22023', message = 'invalid_task';
    end if;
    select *
      into task_row
      from edupi.tasks
     where workspace_id = target_workspace and task_id = task_id_value
     for update;
    if found then
      if task_row.task <> command->'task' then
        raise exception using errcode = 'P0001', message = 'task_conflict';
      end if;
      applied_ids := jsonb_build_array(task_id_value);
    else
      insert into edupi.tasks (
        workspace_id, task_id, title, due_date, note, stage, status, revision,
        task, preparation_source
      )
      values (
        target_workspace,
        task_id_value,
        command->'task'->>'title',
        nullif(command->'task'->>'due_date', '')::date,
        command->'task'->>'note',
        'todo',
        'planned',
        0,
        command->'task' || jsonb_build_object(
          'board_stage', 'todo',
          'board_revision', 0,
          'status', 'planned',
          'external_send', false
        ),
        command->'task'->'preparation_source'
      );
      insert into edupi.task_versions (
        workspace_id, task_id, revision, action, payload, request_id
      )
      values (
        target_workspace, task_id_value, 0, 'create', command->'task', request_id_value
      );
      insert into edupi.teacher_tasks (
        workspace_id, task_id, title, status, revision, task
      )
      values (
        target_workspace, task_id_value, command->'task'->>'title', 'planned', 0,
        command->'task' || jsonb_build_object('board_stage', 'todo', 'board_revision', 0, 'external_send', false)
      )
      on conflict (workspace_id, task_id) do update
        set title = excluded.title, task = excluded.task, revision = excluded.revision, updated_at = now();
      applied_ids := jsonb_build_array(task_id_value);
      target_kind := 'task';
      target_id := task_id_value;
      rollback := jsonb_build_object('available', true, 'rollbackId', 'rollback-' || request_id_value, 'expiresAt', (now() + interval '7 days'));
    end if;
  elsif command_type = 'move_task_stage' then
    task_id_value := command->>'task_id';
    stage_value := command->>'to_stage';
    expected_revision_value := (command->>'expected_revision')::integer;
    if task_id_value is null or stage_value not in ('todo', 'progress', 'review', 'done')
      or expected_revision_value is null then
      raise exception using errcode = '22023', message = 'invalid_task';
    end if;
    select *
      into task_row
      from edupi.tasks
     where workspace_id = target_workspace and task_id = task_id_value and deleted_at is null
     for update;
    if not found then
      raise exception using errcode = 'P0002', message = 'task_missing';
    end if;
    if task_row.revision <> expected_revision_value then
      raise exception using errcode = 'P0001', message = 'stale_revision';
    end if;
    if task_row.stage = stage_value then
      raise exception using errcode = 'P0001', message = 'stage_unchanged';
    end if;
    next_revision := task_row.revision + 1;
    status_value := case stage_value when 'todo' then 'planned' when 'progress' then 'accepted' when 'review' then 'modified' else 'accepted' end;
    update edupi.tasks
       set stage = stage_value,
           status = status_value,
           revision = next_revision,
           task = task || jsonb_build_object(
             'board_stage', stage_value,
             'board_revision', next_revision,
             'status', status_value,
             'stage_note', command->>'note',
             'external_send', false
           ),
           updated_at = now()
     where workspace_id = target_workspace and task_id = task_id_value;
    insert into edupi.task_versions (
      workspace_id, task_id, revision, action, payload, request_id
    )
    values (
      target_workspace, task_id_value, next_revision, 'move_task_stage', command, request_id_value
    );
    update edupi.teacher_tasks
       set status = status_value, revision = next_revision,
           task = task_row.task || jsonb_build_object('board_stage', stage_value, 'board_revision', next_revision, 'status', status_value, 'external_send', false),
           updated_at = now()
     where workspace_id = target_workspace and task_id = task_id_value;
    applied_ids := jsonb_build_array(task_id_value);
    target_kind := 'task';
    target_id := task_id_value;
    receipt_status := 'modified';
    rollback := jsonb_build_object('available', true, 'rollbackId', 'rollback-' || request_id_value, 'expiresAt', (now() + interval '7 days'));
  elsif command_type = 'intake_material' then
    material_id_value := command->'material'->>'material_id';
    if material_id_value is null or command->'material'->>'title' is null then
      raise exception using errcode = '22023', message = 'invalid_material';
    end if;
    select *
      into material_row
      from edupi.materials
     where workspace_id = target_workspace and material_id = material_id_value
     for update;
    if found then
      if material_row.source_hash is distinct from command->'material'->>'source_hash'
        and command->'material'->>'source_hash' is not null then
        raise exception using errcode = 'P0001', message = 'material_conflict';
      end if;
    else
      insert into edupi.materials (
        workspace_id, material_id, title, kind, subject, class_id, relative_path,
        source_hash, storage_object_key, intake_state, material
      )
      values (
        target_workspace,
        material_id_value,
        command->'material'->>'title',
        coalesce(command->'material'->>'kind', 'other'),
        command->'material'->>'subject',
        command->'material'->>'class_id',
        command->'material'->>'relative_path',
        command->'material'->>'source_hash',
        command->'material'->>'storage_object_key',
        'accepted',
        command->'material' || jsonb_build_object('external_send', false)
      );
      applied_ids := jsonb_build_array(material_id_value);
      target_kind := 'material_intake';
      target_id := material_id_value;
      rollback := jsonb_build_object('available', true, 'rollbackId', 'rollback-' || request_id_value, 'expiresAt', (now() + interval '7 days'));
    end if;
  elsif command_type = 'update_memory' then
    memory_id_value := coalesce(command->'memory'->>'memory_id', command->>'memory_id');
    if memory_id_value is null or coalesce(command->'memory'->>'content', command->>'content') is null then
      raise exception using errcode = '22023', message = 'invalid_memory';
    end if;
    select *
      into memory_row
      from edupi.memories
     where workspace_id = target_workspace and memory_id = memory_id_value
     for update;
    if found then
      update edupi.memories
         set content = coalesce(command->'memory'->>'content', command->>'content'),
             memory = coalesce(command->'memory', command) || jsonb_build_object('external_send', false),
             revision = memory_row.revision + 1,
             updated_at = now()
       where workspace_id = target_workspace and memory_id = memory_id_value;
    else
      insert into edupi.memories (
        workspace_id, memory_id, category, content, memory
      )
      values (
        target_workspace,
        memory_id_value,
        coalesce(command->'memory'->>'category', 'teaching'),
        coalesce(command->'memory'->>'content', command->>'content'),
        coalesce(command->'memory', command) || jsonb_build_object('external_send', false)
      );
    end if;
    applied_ids := jsonb_build_array(memory_id_value);
    target_kind := 'memory';
    target_id := memory_id_value;
    receipt_status := 'modified';
  elsif command_type in ('import_calendar', 'import_timetable') then
    target_id := coalesce(command->'source'->>'source_id', command->>'source_id', message_id_value);
    target_kind := case command_type when 'import_calendar' then 'calendar_import' else 'timetable_import' end;
    insert into edupi.education_inputs (
      workspace_id, input_id, input_kind, payload, request_id
    )
    values (
      target_workspace, target_id,
      case command_type when 'import_calendar' then 'calendar' else 'timetable' end,
      command, request_id_value
    )
    on conflict (workspace_id, input_id) do update
      set payload = excluded.payload, revision = edupi.education_inputs.revision + 1, updated_at = now();
    applied_ids := jsonb_build_array(target_id);
  else
    target_id := coalesce(
      command->'target'->>'target_id',
      command->>'task_id',
      command->>'candidate_id',
      command->>'observation_id',
      command->>'memory_id',
      command->'source'->>'source_id',
      message_id_value
    );
    target_kind := coalesce(command->'target'->>'target_kind', 'command');
    insert into edupi.audit_events (
      workspace_id, request_id, actor_id, event_kind, target_kind, target_id, payload
    )
    values (
      target_workspace, request_id_value, actor_id, command_type, target_kind, target_id, command
    );
    applied_ids := jsonb_build_array(target_id);
  end if;

  select value
    into evidence_ids
    from jsonb_each(command->'source')
   where key = 'evidence_ids';
  evidence_ids := coalesce(evidence_ids, '[]'::jsonb);
  after_snapshot := edupi.refresh_workspace_snapshot(target_workspace, 'command_after');
  receipt_uuid := gen_random_uuid();
  receipt_payload := jsonb_build_object(
    'receipt_id', 'receipt-' || replace(receipt_uuid::text, '-', ''),
    'command_id', message_id_value,
    'request_id', request_id_value,
    'command_type', command_type,
    'target', jsonb_build_object('target_kind', target_kind, 'target_id', target_id, 'command_type', command_type),
    'receipt_phase', 'mutation',
    'decision', null,
    'status', receipt_status,
    'applied_ids', applied_ids,
    'rejected_ids', rejected_ids,
    'reason_code', null,
    'evidence_ids', evidence_ids,
    'before_snapshot_id', current_snapshot->>'snapshot_id',
    'after_snapshot_id', after_snapshot->>'snapshot_id',
    'before_state_hash', current_snapshot->>'state_hash',
    'after_state_hash', after_snapshot->>'state_hash',
    'teacher_review', teacher_review,
    'rollback', rollback,
    'external_send', false,
    'created_at', now()
  );
  receipt_envelope := jsonb_build_object(
    'contract_version', '1.1',
    'message_id', 'receipt-' || replace(receipt_uuid::text, '-', ''),
    'request_id', request_id_value,
    'issued_at', now(),
    'producer', 'edupi-core',
    'schema_hash', 'sha256:2749b1208b47bf475bd30d266b5ca1b213aa78c6c8b4dcd53059c524400565c8',
    'snapshot_id', after_snapshot->>'snapshot_id',
    'provenance', coalesce(command_envelope->'provenance', '[]'::jsonb),
    'teacher_review', teacher_review,
    'external_send', false,
    'payload', receipt_payload
  );

  insert into edupi.command_receipts (
    workspace_id, receipt_id, request_id, message_id, idempotency_key, envelope_hash,
    command_type, status, before_snapshot_id, after_snapshot_id, before_state_hash,
    after_state_hash, receipt, envelope, actor_id
  )
  values (
    target_workspace, receipt_uuid, request_id_value, message_id_value, idempotency_key_value, envelope_hash_value,
    command_type, receipt_status, current_snapshot->>'snapshot_id', after_snapshot->>'snapshot_id',
    current_snapshot->>'state_hash', after_snapshot->>'state_hash', receipt_envelope, command_envelope, actor_id
  );

  insert into edupi.audit_events (
    workspace_id, request_id, actor_id, event_kind, target_kind, target_id, payload
  )
  values (
    target_workspace, request_id_value, actor_id, command_type, target_kind, target_id, receipt_payload
  );

  return jsonb_build_object(
    'ok', true,
    'operation', 'command',
    'request_id', request_id_value,
    'replayed', false,
    'supported_commands', '["review_observation","review_memory_candidate","review_teacher_context","review_work_candidate","review_follow_up","review_task","import_calendar","import_timetable","intake_material","create_task","move_task_stage","update_memory"]'::jsonb,
    'supported_projections', '["education_workspace"]'::jsonb,
    'receipt', receipt_envelope,
    'snapshot_id', after_snapshot->>'snapshot_id',
    'state_hash', after_snapshot->>'state_hash',
    'external_send', false
  );
end;
$$;

create or replace function edupi.mutate_education_fact(
  target_workspace uuid,
  actor_id uuid,
  fact_request jsonb
)
returns jsonb
language plpgsql
security definer
set search_path = pg_catalog, edupi, extensions
as $$
declare
  request_id_value text := fact_request->>'request_id';
  fact_id_value text := fact_request->>'fact_id';
  action_value text := fact_request->>'action';
  expected_revision_value integer := (fact_request->>'expected_revision')::integer;
  current_fact edupi.facts%rowtype;
  existing_review edupi.fact_reviews%rowtype;
  before_payload jsonb;
  after_payload jsonb;
  next_revision integer;
  next_status text;
  superseded_id text;
  receipt_status text;
  spine jsonb;
begin
  if actor_id is null or not exists (
    select 1 from edupi.workspace_members
    where workspace_id = target_workspace and account_id = actor_id
  ) then
    raise exception using errcode = '42501', message = 'workspace_forbidden';
  end if;
  if request_id_value is null or fact_id_value is null or action_value not in ('review', 'modify', 'delete', 'restore') then
    raise exception using errcode = '22023', message = 'invalid_fact_request';
  end if;

  select *
    into existing_review
    from edupi.fact_reviews
   where workspace_id = target_workspace and request_id = request_id_value;
  if found then
    return jsonb_build_object(
      'ok', true,
      'operation', 'education-facts',
      'request_id', request_id_value,
      'action', action_value,
      'fact_id', fact_id_value,
      'result_fact_id', existing_review.result_fact_id,
      'revision', existing_review.revision,
      'status', existing_review.status,
      'superseded_fact_id', existing_review.superseded_fact_id,
      'replayed', true,
      'external_send', false
    );
  end if;

  select *
    into current_fact
    from edupi.facts
   where workspace_id = target_workspace and fact_id = fact_id_value
   for update;
  if not found then
    raise exception using errcode = 'P0002', message = 'fact_not_found';
  end if;
  if current_fact.revision <> expected_revision_value then
    raise exception using errcode = 'P0001', message = 'stale_fact';
  end if;
  before_payload := to_jsonb(current_fact);
  next_revision := current_fact.revision + 1;
  next_status := current_fact.status;
  superseded_id := null;

  if action_value = 'review' then
    next_status := case fact_request->>'decision'
      when 'accept' then 'accepted'
      when 'reject' then 'rejected'
      when 'hold' then 'held'
      else null
    end;
    if next_status is null then
      raise exception using errcode = '22023', message = 'invalid_review';
    end if;
    superseded_id := fact_request->>'supersedes_fact_id';
  elsif action_value = 'modify' then
    if fact_request->>'replacement_value' is null or fact_request->>'replacement_value' = '' then
      raise exception using errcode = '22023', message = 'invalid_fact_request';
    end if;
    update edupi.facts
       set value = fact_request->>'replacement_value',
           status = 'accepted',
           revision = next_revision,
           updated_at = now()
     where workspace_id = target_workspace and fact_id = fact_id_value;
    next_status := 'accepted';
  elsif action_value = 'delete' then
    update edupi.facts
       set deleted_previous_status = status,
           status = 'deleted',
           deleted_at = now(),
           revision = next_revision,
           updated_at = now()
     where workspace_id = target_workspace and fact_id = fact_id_value;
    next_status := 'deleted';
  else
    if current_fact.status <> 'deleted' then
      raise exception using errcode = 'P0001', message = 'invalid_fact_state';
    end if;
    update edupi.facts
       set status = coalesce(deleted_previous_status, 'accepted'),
           deleted_at = null,
           deleted_previous_status = null,
           revision = next_revision,
           updated_at = now()
     where workspace_id = target_workspace and fact_id = fact_id_value;
    next_status := coalesce(current_fact.deleted_previous_status, 'accepted');
  end if;

  if action_value in ('review', 'restore') then
    update edupi.facts
       set status = next_status,
           revision = next_revision,
           updated_at = now()
     where workspace_id = target_workspace and fact_id = fact_id_value;
  end if;

  select to_jsonb(item)
    into after_payload
    from edupi.facts item
   where workspace_id = target_workspace and fact_id = fact_id_value;

  insert into edupi.fact_reviews (
    workspace_id, request_id, fact_id, action, decision, revision, result_fact_id,
    status, superseded_fact_id, reviewer, note, before_payload, after_payload
  )
  values (
    target_workspace, request_id_value, fact_id_value, action_value, fact_request->>'decision',
    next_revision, fact_id_value, next_status, superseded_id,
    coalesce(fact_request->>'reviewer', 'teacher'), fact_request->>'note',
    before_payload, after_payload
  );

  if superseded_id is not null then
    update edupi.facts
       set status = 'superseded', revision = revision + 1, updated_at = now()
     where workspace_id = target_workspace and fact_id = superseded_id and status = 'accepted';
  end if;

  select edupi.refresh_fact_spine(target_workspace) into spine;
  receipt_status := next_status;
  return jsonb_build_object(
    'ok', true,
    'operation', 'education-facts',
    'request_id', request_id_value,
    'action', action_value,
    'fact_id', fact_id_value,
    'result_fact_id', fact_id_value,
    'revision', next_revision,
    'status', receipt_status,
    'superseded_fact_id', superseded_id,
    'replayed', false,
    'external_send', false,
    'fact_spine', spine
  );
end;
$$;

create or replace function edupi.capture_education_fact(
  target_workspace uuid,
  actor_id uuid,
  fact_request jsonb
)
returns jsonb
language plpgsql
security definer
set search_path = pg_catalog, edupi, extensions
as $$
declare
  request_id_value text := fact_request->>'request_id';
  fact_id_value text := fact_request->>'fact_id';
  before_payload jsonb := '{}'::jsonb;
  after_payload jsonb;
begin
  if actor_id is null or not exists (
    select 1 from edupi.workspace_members
    where workspace_id = target_workspace and account_id = actor_id and revoked_at is null
  ) then
    raise exception using errcode = '42501', message = 'workspace_forbidden';
  end if;
  if request_id_value is null or fact_id_value is null
    or fact_request->>'entity_id' is null
    or fact_request->>'fact_kind' is null
    or fact_request->>'predicate' is null
    or fact_request->>'value' is null then
    raise exception using errcode = '22023', message = 'invalid_fact_request';
  end if;
  if exists (
    select 1 from edupi.fact_reviews
    where workspace_id = target_workspace and request_id = request_id_value
  ) then
    return jsonb_build_object(
      'ok', true, 'operation', 'education-facts', 'request_id', request_id_value,
      'action', 'capture', 'fact_id', fact_id_value, 'result_fact_id', fact_id_value,
      'revision', 0, 'status', 'candidate', 'superseded_fact_id', null,
      'replayed', true, 'external_send', false
    );
  end if;
  if exists (
    select 1 from edupi.facts
    where workspace_id = target_workspace and fact_id = fact_id_value
  ) then
    raise exception using errcode = 'P0001', message = 'fact_conflict';
  end if;
  insert into edupi.facts (
    workspace_id, fact_id, entity_id, fact_kind, predicate, value, subject_ref, topic_ref,
    confidence, status, source_ids, observation_ids, conflict_ids, has_predecessor, revision
  )
  values (
    target_workspace, fact_id_value, fact_request->>'entity_id', fact_request->>'fact_kind',
    fact_request->>'predicate', fact_request->>'value', fact_request->>'subject_ref',
    fact_request->>'topic_ref', coalesce(fact_request->'confidence', '{"basis":"explicit","score":0}'::jsonb),
    'candidate',
    array(select jsonb_array_elements_text(coalesce(fact_request->'source_ids', '[]'::jsonb))),
    array(select jsonb_array_elements_text(coalesce(fact_request->'observation_ids', '[]'::jsonb))),
    array(select jsonb_array_elements_text(coalesce(fact_request->'conflict_ids', '[]'::jsonb))),
    false, 0
  )
  returning to_jsonb(facts.*) into after_payload;
  insert into edupi.fact_reviews (
    workspace_id, request_id, fact_id, action, decision, revision, result_fact_id,
    status, superseded_fact_id, reviewer, note, before_payload, after_payload
  )
  values (
    target_workspace, request_id_value, fact_id_value, 'capture', null, 0, fact_id_value,
    'candidate', null, coalesce(fact_request->>'reviewer', 'teacher'),
    fact_request->>'note', before_payload, after_payload
  );
  perform edupi.refresh_fact_spine(target_workspace);
  return jsonb_build_object(
    'ok', true, 'operation', 'education-facts', 'request_id', request_id_value,
    'action', 'capture', 'fact_id', fact_id_value, 'result_fact_id', fact_id_value,
    'revision', 0, 'status', 'candidate', 'superseded_fact_id', null,
    'replayed', false, 'external_send', false
  );
end;
$$;

create or replace function edupi.replace_fact_spine(
  target_workspace uuid,
  actor_id uuid,
  request_id_value text,
  expected_state_hash text,
  next_spine jsonb
)
returns jsonb
language plpgsql
security definer
set search_path = pg_catalog, edupi, extensions
as $$
declare
  current_spine edupi.fact_spine_snapshots%rowtype;
  next_hash text;
  next_revision bigint;
begin
  if actor_id is null or not exists (
    select 1 from edupi.workspace_members
    where workspace_id = target_workspace and account_id = actor_id
  ) then
    raise exception using errcode = '42501', message = 'workspace_forbidden';
  end if;
  if jsonb_typeof(next_spine) <> 'object' or next_spine->>'external_send' <> 'false' then
    raise exception using errcode = '22023', message = 'invalid_fact_spine';
  end if;
  select *
    into current_spine
    from edupi.fact_spine_snapshots
   where workspace_id = target_workspace
   order by revision desc
   limit 1
   for update;
  if current_spine.state_hash is not null and expected_state_hash is distinct from current_spine.state_hash then
    raise exception using errcode = 'P0001', message = 'stale_fact_spine';
  end if;
  next_hash := edupi.json_sha256(next_spine - 'state_hash');
  next_revision := coalesce(current_spine.revision, -1) + 1;
  insert into edupi.fact_spine_snapshots (
    workspace_id, revision, state_hash, spine
  )
  values (
    target_workspace, next_revision, next_hash, next_spine || jsonb_build_object('state_hash', next_hash)
  )
  on conflict (workspace_id, state_hash) do nothing;
  return jsonb_build_object(
    'ok', true,
    'operation', 'education-facts',
    'request_id', request_id_value,
    'action', 'replace_spine',
    'state_hash', next_hash,
    'revision', next_revision,
    'spine', next_spine || jsonb_build_object('state_hash', next_hash),
    'replayed', false,
    'external_send', false
  );
end;
$$;

create or replace function edupi.mutate_material_metadata(
  target_workspace uuid,
  actor_id uuid,
  material_request jsonb
)
returns jsonb
language plpgsql
security definer
set search_path = pg_catalog, edupi, extensions
as $$
declare
  request_id_value text := material_request->>'request_id';
  material_id_value text := material_request->>'material_id';
  action_value text := material_request->>'action';
  expected_revision_value integer := (material_request->>'expected_revision')::integer;
  current_material edupi.materials%rowtype;
  existing_version edupi.material_versions%rowtype;
  before_values jsonb;
  desired_values jsonb;
  version_id_value text;
  next_revision integer;
  changed_fields jsonb := '[]'::jsonb;
  field_name text;
begin
  if actor_id is null or not exists (
    select 1 from edupi.workspace_members
    where workspace_id = target_workspace and account_id = actor_id
  ) then
    raise exception using errcode = '42501', message = 'workspace_forbidden';
  end if;
  if request_id_value is null or material_id_value is null or action_value not in ('update', 'restore') then
    raise exception using errcode = '22023', message = 'invalid_request';
  end if;
  select *
    into existing_version
    from edupi.material_versions
   where workspace_id = target_workspace and request_id = request_id_value;
  if found then
    return jsonb_build_object(
      'ok', true,
      'operation', 'material-metadata',
      'request_id', request_id_value,
      'action', action_value,
      'material_id', material_id_value,
      'version_id', existing_version.version_id,
      'revision', existing_version.revision,
      'history_count', (
        select count(*)::integer from edupi.material_versions
        where workspace_id = target_workspace and material_id = material_id_value
      ),
      'updated_at', existing_version.changed_at,
      'replayed', true,
      'external_send', false
    );
  end if;
  select *
    into current_material
    from edupi.materials
   where workspace_id = target_workspace and material_id = material_id_value and deleted_at is null
   for update;
  if not found then
    raise exception using errcode = 'P0002', message = 'material_not_found';
  end if;
  if current_material.metadata_revision <> expected_revision_value then
    raise exception using errcode = 'P0001', message = 'stale_material_metadata';
  end if;
  before_values := jsonb_build_object(
    'title', current_material.title,
    'kind', current_material.kind,
    'subject', current_material.subject,
    'class_id', current_material.class_id
  );
  if action_value = 'update' then
    desired_values := before_values || coalesce(material_request->'patch', '{}'::jsonb);
  else
    select case when material_request->>'version_side' = 'before' then version_row.before_values else version_row.after_values end
      into desired_values
      from edupi.material_versions version_row
     where version_row.workspace_id = target_workspace
       and version_row.material_id = material_id_value
       and version_row.version_id = material_request->>'version_id';
    if desired_values is null then
      raise exception using errcode = 'P0002', message = 'version_not_found';
    end if;
  end if;
  if desired_values->>'title' is null or desired_values->>'title' = '' then
    raise exception using errcode = '22023', message = 'invalid_material_metadata';
  end if;
  next_revision := current_material.metadata_revision + 1;
  changed_fields := '[]'::jsonb;
  foreach field_name in array array['title', 'kind', 'subject', 'class_id'] loop
    if (before_values->field_name) is distinct from (desired_values->field_name) then
      changed_fields := changed_fields || to_jsonb(field_name);
    end if;
  end loop;
  version_id_value := 'material-metadata-version-' || replace(gen_random_uuid()::text, '-', '');
  update edupi.materials
     set title = desired_values->>'title',
         kind = desired_values->>'kind',
         subject = desired_values->>'subject',
         class_id = desired_values->>'class_id',
         metadata_revision = next_revision,
         metadata_history_count = metadata_history_count + 1,
         metadata_updated_at = now(),
         material = material || jsonb_build_object(
           'title', desired_values->>'title',
           'kind', desired_values->>'kind',
           'subject', desired_values->>'subject',
           'class_id', desired_values->>'class_id',
           'external_send', false
         ),
         updated_at = now()
   where workspace_id = target_workspace and material_id = material_id_value;
  insert into edupi.material_versions (
    workspace_id, material_id, version_id, revision, before_values, after_values,
    changed_fields, source_kind, request_id
  )
  values (
    target_workspace, material_id_value, version_id_value, next_revision, before_values,
    desired_values, changed_fields, case when action_value = 'restore' then 'restore' else 'teacher_edit' end,
    request_id_value
  );
  return jsonb_build_object(
    'ok', true,
    'operation', 'material-metadata',
    'request_id', request_id_value,
    'action', action_value,
    'material_id', material_id_value,
    'version_id', version_id_value,
    'revision', next_revision,
    'history_count', current_material.metadata_history_count + 1,
    'updated_at', now(),
    'replayed', false,
    'external_send', false
  );
end;
$$;

create or replace function edupi.mutate_classroom_object(
  target_workspace uuid,
  actor_id uuid,
  classroom_request jsonb
)
returns jsonb
language plpgsql
security definer
set search_path = pg_catalog, edupi, extensions
as $$
declare
  action_value text := classroom_request->>'action';
  domain_value text := classroom_request->>'domain';
  object_id_value text := coalesce(classroom_request->>'id', 'classroom-' || replace(gen_random_uuid()::text, '-', ''));
  request_id_value text := coalesce(classroom_request->>'request_id', 'classroom-' || replace(gen_random_uuid()::text, '-', ''));
  expected_revision_value integer := (classroom_request->>'expected_revision')::integer;
  current_object edupi.classroom_objects%rowtype;
  version_object edupi.classroom_object_versions%rowtype;
  next_revision integer;
  next_input jsonb;
  next_result jsonb;
  next_issues jsonb;
  publication_value jsonb;
  task_id_value text;
  response_record jsonb;
begin
  if actor_id is null or not exists (
    select 1 from edupi.workspace_members
    where workspace_id = target_workspace and account_id = actor_id
  ) then
    raise exception using errcode = '42501', message = 'workspace_forbidden';
  end if;
  if domain_value not in ('grades', 'seating', 'duty')
    or action_value not in ('preview', 'save', 'restore', 'publish') then
    raise exception using errcode = '22023', message = 'invalid_request';
  end if;
  if action_value = 'preview' then
    response_record := jsonb_build_object(
      'id', object_id_value,
      'domain', domain_value,
      'revision', 0,
      'created_at', now(),
      'updated_at', now(),
      'input', coalesce(classroom_request->'input', '{}'::jsonb),
      'result', coalesce(classroom_request->'result', '{}'::jsonb),
      'issues', coalesce(classroom_request->'issues', '[]'::jsonb),
      'versions', '[]'::jsonb,
      'publication', null
    );
    return jsonb_build_object(
      'ok', true,
      'operation', 'classroom',
      'request_id', request_id_value,
      'external_send', false,
      'record', response_record
    );
  end if;
  select *
    into current_object
    from edupi.classroom_objects
   where workspace_id = target_workspace
     and object_id = object_id_value
     and domain = domain_value
     and deleted_at is null
   for update;

  if action_value = 'save' and not found then
    next_input := coalesce(classroom_request->'input', '{}'::jsonb);
    next_result := coalesce(classroom_request->'result', '{}'::jsonb);
    next_issues := coalesce(classroom_request->'issues', '[]'::jsonb);
    insert into edupi.classroom_objects (
      workspace_id, object_id, domain, revision, created_at, updated_at,
      input, result, issues, versions
    )
    values (
      target_workspace, object_id_value, domain_value, 0, now(), now(),
      next_input, next_result, next_issues,
      jsonb_build_array(jsonb_build_object('revision', 0, 'saved_at', now(), 'action', 'save', 'restored_from', null))
    );
    insert into edupi.classroom_object_versions (
      workspace_id, object_id, revision, action, input, result, issues, restored_from
    )
    values (
      target_workspace, object_id_value, 0, 'save', next_input, next_result, next_issues, null
    );
  elsif not found then
    raise exception using errcode = 'P0002', message = 'not_found';
  elsif action_value = 'save' then
    if expected_revision_value is null or current_object.revision <> expected_revision_value then
      raise exception using errcode = 'P0001', message = 'stale_revision';
    end if;
    next_revision := current_object.revision + 1;
    next_input := coalesce(classroom_request->'input', current_object.input);
    next_result := coalesce(classroom_request->'result', current_object.result);
    next_issues := coalesce(classroom_request->'issues', current_object.issues);
    update edupi.classroom_objects
       set revision = next_revision, updated_at = now(), input = next_input,
           result = next_result, issues = next_issues,
           versions = versions || jsonb_build_array(jsonb_build_object(
             'revision', next_revision, 'saved_at', now(), 'action', 'save', 'restored_from', null
           ))
     where workspace_id = target_workspace and object_id = object_id_value;
    insert into edupi.classroom_object_versions (
      workspace_id, object_id, revision, action, input, result, issues, restored_from
    )
    values (
      target_workspace, object_id_value, next_revision, 'save', next_input, next_result, next_issues, null
    );
  elsif action_value = 'restore' then
    select *
      into version_object
      from edupi.classroom_object_versions
     where workspace_id = target_workspace
       and object_id = object_id_value
       and revision = (classroom_request->>'revision')::integer;
    if not found then
      raise exception using errcode = 'P0002', message = 'version_not_found';
    end if;
    if expected_revision_value is null or current_object.revision <> expected_revision_value then
      raise exception using errcode = 'P0001', message = 'stale_revision';
    end if;
    next_revision := current_object.revision + 1;
    update edupi.classroom_objects
       set revision = next_revision, updated_at = now(), input = version_object.input,
           result = version_object.result, issues = version_object.issues,
           versions = versions || jsonb_build_array(jsonb_build_object(
             'revision', next_revision, 'saved_at', now(), 'action', 'restore', 'restored_from', version_object.revision
           ))
     where workspace_id = target_workspace and object_id = object_id_value;
    insert into edupi.classroom_object_versions (
      workspace_id, object_id, revision, action, input, result, issues, restored_from
    )
    values (
      target_workspace, object_id_value, next_revision, 'restore', version_object.input,
      version_object.result, version_object.issues, version_object.revision
    );
  else
    task_id_value := coalesce(current_object.task_id, 'classroom-task-' || object_id_value);
    publication_value := jsonb_build_object(
      'task_id', task_id_value,
      'source_revision', current_object.revision,
      'state', 'pending'
    );
    update edupi.classroom_objects
       set publication = publication_value, task_id = task_id_value, updated_at = now()
     where workspace_id = target_workspace and object_id = object_id_value;
  end if;

  select jsonb_build_object(
    'id', object_id,
    'domain', domain,
    'revision', revision,
    'created_at', created_at,
    'updated_at', updated_at,
    'input', input,
    'result', result,
    'issues', issues,
    'versions', versions,
    'task_id', task_id,
    'publication', publication
  )
    into response_record
    from edupi.classroom_objects
   where workspace_id = target_workspace and object_id = object_id_value;
  return jsonb_build_object(
    'ok', true,
    'operation', 'classroom',
    'request_id', request_id_value,
    'external_send', false,
    'record', response_record
  );
end;
$$;

create or replace function edupi.runtime_transition(
  target_workspace uuid,
  actor_id uuid,
  runtime_request jsonb
)
returns jsonb
language plpgsql
security definer
set search_path = pg_catalog, edupi, extensions
as $$
declare
  action_value text := runtime_request->>'action';
  instance_id_value text := runtime_request->>'instance_id';
  instance_nonce_value text := runtime_request->>'instance_nonce';
  core_commit_value text := runtime_request->>'core_commit';
  current_instance edupi.core_runtime_instances%rowtype;
  current_lease edupi.core_runtime_leases%rowtype;
  generation_value bigint;
  lease_name_value text;
  lease_token_value text;
  ttl_seconds integer;
  event_kind_value text;
begin
  if actor_id is null or not exists (
    select 1 from edupi.workspace_members
    where workspace_id = target_workspace and account_id = actor_id
  ) then
    raise exception using errcode = '42501', message = 'workspace_forbidden';
  end if;
  if action_value not in ('register', 'heartbeat', 'lease_acquire', 'lease_renew', 'lease_release', 'event')
    or instance_id_value is null or instance_nonce_value is null then
    raise exception using errcode = '22023', message = 'invalid_runtime_request';
  end if;

  if action_value = 'register' then
    select *
      into current_instance
      from edupi.core_runtime_instances
     where workspace_id = target_workspace and instance_id = instance_id_value
     for update;
    if found and current_instance.instance_nonce <> instance_nonce_value then
      generation_value := current_instance.fencing_generation + 1;
    else
      generation_value := coalesce(current_instance.fencing_generation, 0);
      if generation_value < 1 then generation_value := 1; end if;
    end if;
    insert into edupi.core_runtime_instances (
      workspace_id, instance_id, instance_nonce, core_commit, component_manifest_hash,
      runtime_schema_hash, data_root_fingerprint, status, fencing_generation,
      capabilities, metadata
    )
    values (
      target_workspace, instance_id_value, instance_nonce_value, coalesce(core_commit_value, 'unknown'),
      runtime_request->>'component_manifest_hash', runtime_request->>'runtime_schema_hash',
      runtime_request->>'data_root_fingerprint', 'ready', generation_value,
      coalesce(runtime_request->'capabilities', '{}'::jsonb),
      coalesce(runtime_request->'metadata', '{}'::jsonb)
    )
    on conflict (workspace_id, instance_id) do update
      set instance_nonce = excluded.instance_nonce,
          core_commit = excluded.core_commit,
          component_manifest_hash = excluded.component_manifest_hash,
          runtime_schema_hash = excluded.runtime_schema_hash,
          data_root_fingerprint = excluded.data_root_fingerprint,
          status = 'ready',
          fencing_generation = excluded.fencing_generation,
          capabilities = excluded.capabilities,
          metadata = excluded.metadata,
          last_seen_at = now(),
          stopped_at = null;
    return jsonb_build_object(
      'ok', true, 'operation', 'runtime', 'action', action_value,
      'instance_id', instance_id_value, 'instance_nonce', instance_nonce_value,
      'fencing_generation', generation_value, 'status', 'ready', 'external_send', false
    );
  end if;

  select *
    into current_instance
    from edupi.core_runtime_instances
   where workspace_id = target_workspace and instance_id = instance_id_value
   for update;
  if not found or current_instance.instance_nonce <> instance_nonce_value
    or current_instance.fencing_generation <> (runtime_request->>'fencing_generation')::bigint then
    raise exception using errcode = 'P0001', message = 'runtime_fenced';
  end if;
  update edupi.core_runtime_instances
     set last_seen_at = now(), status = case when action_value = 'heartbeat' then 'ready' else status end
   where workspace_id = target_workspace and instance_id = instance_id_value;

  if action_value = 'heartbeat' then
    return jsonb_build_object(
      'ok', true, 'operation', 'runtime', 'action', action_value,
      'instance_id', instance_id_value, 'fencing_generation', current_instance.fencing_generation,
      'status', 'ready', 'external_send', false
    );
  end if;

  lease_name_value := runtime_request->>'lease_name';
  if lease_name_value is null then
    raise exception using errcode = '22023', message = 'invalid_runtime_lease';
  end if;
  select *
    into current_lease
    from edupi.core_runtime_leases
   where workspace_id = target_workspace and lease_name = lease_name_value
   for update;

  if action_value = 'lease_acquire' then
    if found and current_lease.expires_at > now()
      and (current_lease.instance_id <> instance_id_value or current_lease.instance_nonce <> instance_nonce_value) then
      raise exception using errcode = 'P0001', message = 'lease_held';
    end if;
    lease_token_value := replace(gen_random_uuid()::text, '-', '') || replace(gen_random_uuid()::text, '-', '');
    ttl_seconds := greatest(5, least(coalesce((runtime_request->>'ttl_seconds')::integer, 30), 3600));
    insert into edupi.core_runtime_leases (
      workspace_id, lease_name, instance_id, instance_nonce, fencing_generation,
      lease_token_hash, expires_at
    )
    values (
      target_workspace, lease_name_value, instance_id_value, instance_nonce_value,
      current_instance.fencing_generation,
      encode(digest(lease_token_value, 'sha256'), 'hex'),
      now() + make_interval(secs => ttl_seconds)
    )
    on conflict (workspace_id, lease_name) do update
      set instance_id = excluded.instance_id,
          instance_nonce = excluded.instance_nonce,
          fencing_generation = excluded.fencing_generation,
          lease_token_hash = excluded.lease_token_hash,
          expires_at = excluded.expires_at,
          updated_at = now();
    return jsonb_build_object(
      'ok', true, 'operation', 'runtime', 'action', action_value,
      'lease_name', lease_name_value, 'lease_token', lease_token_value,
      'expires_at', now() + make_interval(secs => ttl_seconds),
      'fencing_generation', current_instance.fencing_generation, 'external_send', false
    );
  end if;

  if not found or encode(digest(coalesce(runtime_request->>'lease_token', ''), 'sha256'), 'hex') <> current_lease.lease_token_hash then
    raise exception using errcode = 'P0001', message = 'lease_invalid';
  end if;
  if action_value = 'lease_renew' then
    ttl_seconds := greatest(5, least(coalesce((runtime_request->>'ttl_seconds')::integer, 30), 3600));
    update edupi.core_runtime_leases
       set expires_at = now() + make_interval(secs => ttl_seconds), updated_at = now()
     where workspace_id = target_workspace and lease_name = lease_name_value;
    return jsonb_build_object(
      'ok', true, 'operation', 'runtime', 'action', action_value,
      'lease_name', lease_name_value, 'expires_at', now() + make_interval(secs => ttl_seconds),
      'fencing_generation', current_instance.fencing_generation, 'external_send', false
    );
  elsif action_value = 'lease_release' then
    delete from edupi.core_runtime_leases
     where workspace_id = target_workspace and lease_name = lease_name_value;
    return jsonb_build_object(
      'ok', true, 'operation', 'runtime', 'action', action_value,
      'lease_name', lease_name_value, 'fencing_generation', current_instance.fencing_generation,
      'external_send', false
    );
  end if;

  event_kind_value := runtime_request->>'event_kind';
  if event_kind_value is null then
    raise exception using errcode = '22023', message = 'invalid_runtime_event';
  end if;
  insert into edupi.core_runtime_events (
    workspace_id, instance_id, instance_nonce, fencing_generation, event_kind, payload
  )
  values (
    target_workspace, instance_id_value, instance_nonce_value,
    current_instance.fencing_generation, event_kind_value,
    coalesce(runtime_request->'payload', '{}'::jsonb)
  );
  return jsonb_build_object(
    'ok', true, 'operation', 'runtime', 'action', action_value,
    'event_kind', event_kind_value, 'fencing_generation', current_instance.fencing_generation,
    'external_send', false
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

do $$
declare
  table_name text;
begin
  foreach table_name in array array[
    'workspace_snapshots', 'command_receipts', 'audit_events', 'tasks', 'task_versions',
    'memories', 'education_inputs', 'materials', 'material_versions', 'artifacts',
    'facts', 'fact_observations', 'fact_reviews', 'fact_conflicts', 'fact_spine_snapshots',
    'work_cases', 'work_case_transitions', 'core_runtime_instances', 'core_runtime_leases',
    'core_runtime_events'
  ] loop
    execute format('alter table edupi.%I enable row level security', table_name);
    execute format('drop policy if exists %I_member_read on edupi.%I', table_name, table_name);
    execute format(
      'create policy %I_member_read on edupi.%I for select to authenticated using (edupi.is_workspace_member(workspace_id))',
      table_name, table_name
    );
    execute format('revoke all on edupi.%I from anon, authenticated', table_name);
    execute format('grant select on edupi.%I to authenticated', table_name);
  end loop;
end;
$$;

do $$
begin
  if to_regclass('storage.objects') is not null then
    execute 'drop policy if exists edupi_material_objects_select on storage.objects';
    execute 'drop policy if exists edupi_material_objects_insert on storage.objects';
    execute 'drop policy if exists edupi_material_objects_update on storage.objects';
    execute 'drop policy if exists edupi_material_objects_delete on storage.objects';
    execute $policy$
      create policy edupi_material_objects_select on storage.objects
      for select to authenticated
      using (
        bucket_id = 'edupi-materials'
        and exists (
          select 1
          from edupi.workspace_members member
          where member.account_id = (select auth.uid())
            and member.workspace_id::text = split_part(name, '/', 1)
        )
      )
    $policy$;
    execute $policy$
      create policy edupi_material_objects_insert on storage.objects
      for insert to authenticated
      with check (
        bucket_id = 'edupi-materials'
        and exists (
          select 1
          from edupi.workspace_members member
          where member.account_id = (select auth.uid())
            and member.workspace_id::text = split_part(name, '/', 1)
        )
      )
    $policy$;
    execute $policy$
      create policy edupi_material_objects_update on storage.objects
      for update to authenticated
      using (
        bucket_id = 'edupi-materials'
        and exists (
          select 1
          from edupi.workspace_members member
          where member.account_id = (select auth.uid())
            and member.workspace_id::text = split_part(name, '/', 1)
        )
      )
      with check (
        bucket_id = 'edupi-materials'
        and exists (
          select 1
          from edupi.workspace_members member
          where member.account_id = (select auth.uid())
            and member.workspace_id::text = split_part(name, '/', 1)
        )
      )
    $policy$;
    execute $policy$
      create policy edupi_material_objects_delete on storage.objects
      for delete to authenticated
      using (
        bucket_id = 'edupi-materials'
        and exists (
          select 1
          from edupi.workspace_members member
          where member.account_id = (select auth.uid())
            and member.workspace_id::text = split_part(name, '/', 1)
        )
      )
    $policy$;
  end if;
end;
$$;

drop trigger if exists tasks_set_updated_at on edupi.tasks;
create trigger tasks_set_updated_at
before update on edupi.tasks
for each row execute function edupi.set_updated_at();

drop trigger if exists memories_set_updated_at on edupi.memories;
create trigger memories_set_updated_at
before update on edupi.memories
for each row execute function edupi.set_updated_at();

drop trigger if exists materials_set_updated_at on edupi.materials;
create trigger materials_set_updated_at
before update on edupi.materials
for each row execute function edupi.set_updated_at();

drop trigger if exists artifacts_set_updated_at on edupi.artifacts;
create trigger artifacts_set_updated_at
before update on edupi.artifacts
for each row execute function edupi.set_updated_at();

drop trigger if exists facts_set_updated_at on edupi.facts;
create trigger facts_set_updated_at
before update on edupi.facts
for each row execute function edupi.set_updated_at();

drop trigger if exists fact_observations_set_updated_at on edupi.fact_observations;
create trigger fact_observations_set_updated_at
before update on edupi.fact_observations
for each row execute function edupi.set_updated_at();

drop trigger if exists fact_conflicts_set_updated_at on edupi.fact_conflicts;
create trigger fact_conflicts_set_updated_at
before update on edupi.fact_conflicts
for each row execute function edupi.set_updated_at();

drop trigger if exists work_cases_set_updated_at on edupi.work_cases;
create trigger work_cases_set_updated_at
before update on edupi.work_cases
for each row execute function edupi.set_updated_at();

drop trigger if exists education_inputs_set_updated_at on edupi.education_inputs;
create trigger education_inputs_set_updated_at
before update on edupi.education_inputs
for each row execute function edupi.set_updated_at();

drop trigger if exists command_receipts_set_updated_at on edupi.command_receipts;
create trigger command_receipts_set_updated_at
before update on edupi.command_receipts
for each row execute function edupi.set_updated_at();

revoke insert, update, delete on edupi.student_events, edupi.student_event_revisions,
  edupi.student_topic_aliases from authenticated;

create or replace function edupi.mutate_topic_alias(
  target_workspace uuid,
  p_alias text,
  p_canonical text
)
returns jsonb
language plpgsql
security definer
set search_path = pg_catalog, edupi
as $$
begin
  if not edupi.is_workspace_member(target_workspace) then
    raise exception using errcode = '42501', message = 'workspace_forbidden';
  end if;
  insert into edupi.student_topic_aliases (workspace_id, alias, canonical, updated_at)
  values (target_workspace, p_alias, p_canonical, now())
  on conflict (workspace_id, alias) do update
    set canonical = excluded.canonical, updated_at = now();
  return jsonb_build_object(
    'ok', true, 'action', 'set_topic_alias',
    'alias', p_alias, 'canonical', p_canonical, 'external_send', false
  );
end;
$$;

alter function edupi.mutate_student_event(uuid, text, integer, text, text, text, date, text) security definer;
revoke all on function edupi.mutate_student_event(uuid, text, integer, text, text, text, date, text) from public;
revoke all on function edupi.mutate_topic_alias(uuid, text, text) from public;
revoke all on function edupi.apply_core_command(uuid, uuid, jsonb) from public;
revoke all on function edupi.mutate_education_fact(uuid, uuid, jsonb) from public;
revoke all on function edupi.capture_education_fact(uuid, uuid, jsonb) from public;
revoke all on function edupi.replace_fact_spine(uuid, uuid, text, text, jsonb) from public;
revoke all on function edupi.mutate_material_metadata(uuid, uuid, jsonb) from public;
revoke all on function edupi.mutate_classroom_object(uuid, uuid, jsonb) from public;
revoke all on function edupi.runtime_transition(uuid, uuid, jsonb) from public;
revoke all on function edupi.refresh_workspace_snapshot(uuid, text) from public;
revoke all on function edupi.refresh_fact_spine(uuid) from public;
revoke all on function edupi.create_workspace(text, text) from public;
revoke all on function edupi.revoke_workspace_member(uuid, uuid, text) from public;
grant usage on schema edupi to service_role;
grant execute on function edupi.mutate_student_event(uuid, text, integer, text, text, text, date, text) to authenticated, service_role;
grant execute on function edupi.mutate_topic_alias(uuid, text, text) to authenticated, service_role;
grant execute on function edupi.apply_core_command(uuid, uuid, jsonb) to service_role;
grant execute on function edupi.mutate_education_fact(uuid, uuid, jsonb) to service_role;
grant execute on function edupi.capture_education_fact(uuid, uuid, jsonb) to service_role;
grant execute on function edupi.replace_fact_spine(uuid, uuid, text, text, jsonb) to service_role;
grant execute on function edupi.mutate_material_metadata(uuid, uuid, jsonb) to service_role;
grant execute on function edupi.mutate_classroom_object(uuid, uuid, jsonb) to service_role;
grant execute on function edupi.runtime_transition(uuid, uuid, jsonb) to service_role;
grant execute on function edupi.refresh_workspace_snapshot(uuid, text) to service_role;
grant execute on function edupi.refresh_fact_spine(uuid) to service_role;
grant execute on function edupi.create_workspace(text, text) to authenticated;
grant execute on function edupi.revoke_workspace_member(uuid, uuid, text) to authenticated;

insert into edupi.contract_versions (
  contract_id, contract_version, schema_hash, core_commit, supported_commands, supported_projections
)
values (
  'edupi-cloud-canonical-writer',
  '1.0',
  'sha256:2749b1208b47bf475bd30d266b5ca1b213aa78c6c8b4dcd53059c524400565c8',
  '3ce22b1e08804aa36dccf59d76a8e61b15f2c462',
  '["review_observation","review_memory_candidate","review_teacher_context","review_work_candidate","review_follow_up","review_task","import_calendar","import_timetable","intake_material","create_task","move_task_stage","update_memory"]'::jsonb,
  '["education_workspace","education_fact_v1","core_runtime"]'::jsonb
)
on conflict (contract_id) do update set
  contract_version = excluded.contract_version,
  schema_hash = excluded.schema_hash,
  core_commit = excluded.core_commit,
  supported_commands = excluded.supported_commands,
  supported_projections = excluded.supported_projections,
  captured_at = now();
