create unique index if not exists audit_events_fact_spine_request_idx
on edupi.audit_events (workspace_id, request_id)
where event_kind = 'fact_spine_replace' and request_id is not null;

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
  existing_receipt jsonb;
  request_hash text;
  next_hash text;
  next_revision bigint;
  response_payload jsonb;
begin
  if actor_id is null or not exists (
    select 1
    from edupi.workspace_members
    where workspace_id = target_workspace
      and account_id = actor_id
      and revoked_at is null
  ) then
    raise exception using errcode = '42501', message = 'workspace_forbidden';
  end if;
  if request_id_value is null
    or jsonb_typeof(next_spine) <> 'object'
    or next_spine->>'external_send' <> 'false' then
    raise exception using errcode = '22023', message = 'invalid_fact_spine';
  end if;

  request_hash := edupi.json_sha256(jsonb_build_object(
    'expected_state_hash', expected_state_hash,
    'spine', next_spine
  ));

  perform 1
  from edupi.workspaces
  where id = target_workspace
  for update;
  if not found then
    raise exception using errcode = 'P0002', message = 'workspace_not_found';
  end if;

  select *
    into current_spine
    from edupi.fact_spine_snapshots
   where workspace_id = target_workspace
   order by revision desc
   limit 1
   for update;

  select payload
    into existing_receipt
    from edupi.audit_events
   where workspace_id = target_workspace
     and request_id = request_id_value
     and event_kind = 'fact_spine_replace'
   limit 1;
  if existing_receipt is not null then
    if (select target_id
        from edupi.audit_events
        where workspace_id = target_workspace
          and request_id = request_id_value
          and event_kind = 'fact_spine_replace'
        limit 1) <> request_hash then
      raise exception using errcode = 'P0001', message = 'idempotency_conflict';
    end if;
    return existing_receipt || jsonb_build_object('replayed', true);
  end if;

  if current_spine.state_hash is not null
    and expected_state_hash is distinct from current_spine.state_hash then
    raise exception using errcode = 'P0001', message = 'stale_fact_spine';
  end if;

  next_hash := edupi.json_sha256(next_spine - 'state_hash');
  next_revision := coalesce(current_spine.revision, -1) + 1;
  insert into edupi.fact_spine_snapshots (
    workspace_id, revision, state_hash, spine
  )
  values (
    target_workspace,
    next_revision,
    next_hash,
    next_spine || jsonb_build_object('state_hash', next_hash)
  )
  on conflict (workspace_id, state_hash) do nothing;

  response_payload := jsonb_build_object(
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

  insert into edupi.audit_events (
    workspace_id, request_id, actor_id, event_kind, target_kind, target_id, payload
  )
  values (
    target_workspace,
    request_id_value,
    actor_id,
    'fact_spine_replace',
    'fact_spine',
    request_hash,
    response_payload
  )
  on conflict do nothing
  returning payload into existing_receipt;

  if existing_receipt is not null then
    return existing_receipt;
  end if;

  select payload
    into existing_receipt
    from edupi.audit_events
   where workspace_id = target_workspace
     and request_id = request_id_value
     and event_kind = 'fact_spine_replace'
   limit 1;
  return existing_receipt || jsonb_build_object('replayed', true);
end;
$$;
