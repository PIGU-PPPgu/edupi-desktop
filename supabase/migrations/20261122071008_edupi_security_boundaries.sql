-- Keep historical migrations intact; close authorization and lease gaps in place.
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
  if actor_role is null or actor_role not in ('owner', 'admin') then
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
          select 1 from edupi.workspace_members member
          where member.account_id = (select auth.uid())
            and member.workspace_id::text = split_part(name, '/', 1)
            and member.revoked_at is null
        )
      )
    $policy$;
    execute $policy$
      create policy edupi_material_objects_insert on storage.objects
      for insert to authenticated
      with check (
        bucket_id = 'edupi-materials'
        and exists (
          select 1 from edupi.workspace_members member
          where member.account_id = (select auth.uid())
            and member.workspace_id::text = split_part(name, '/', 1)
            and member.revoked_at is null
        )
      )
    $policy$;
    execute $policy$
      create policy edupi_material_objects_update on storage.objects
      for update to authenticated
      using (
        bucket_id = 'edupi-materials'
        and exists (
          select 1 from edupi.workspace_members member
          where member.account_id = (select auth.uid())
            and member.workspace_id::text = split_part(name, '/', 1)
            and member.revoked_at is null
        )
      )
      with check (
        bucket_id = 'edupi-materials'
        and exists (
          select 1 from edupi.workspace_members member
          where member.account_id = (select auth.uid())
            and member.workspace_id::text = split_part(name, '/', 1)
            and member.revoked_at is null
        )
      )
    $policy$;
    execute $policy$
      create policy edupi_material_objects_delete on storage.objects
      for delete to authenticated
      using (
        bucket_id = 'edupi-materials'
        and exists (
          select 1 from edupi.workspace_members member
          where member.account_id = (select auth.uid())
            and member.workspace_id::text = split_part(name, '/', 1)
            and member.revoked_at is null
        )
      )
    $policy$;
  end if;
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
  lease_expires_at_value timestamptz;
  ttl_seconds integer;
  event_kind_value text;
begin
  if actor_id is null or not exists (
    select 1 from edupi.workspace_members
    where workspace_id = target_workspace and account_id = actor_id and revoked_at is null
  ) then
    raise exception using errcode = '42501', message = 'workspace_forbidden';
  end if;
  if action_value is null
    or action_value not in ('register', 'heartbeat', 'lease_acquire', 'lease_renew', 'lease_release', 'event')
    or instance_id_value is null or instance_nonce_value is null then
    raise exception using errcode = '22023', message = 'invalid_runtime_request';
  end if;

  -- Registration still works without a lease, and a new nonce advances fencing.
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
  if not found or current_instance.instance_nonce is distinct from instance_nonce_value
    or current_instance.fencing_generation is distinct from (runtime_request->>'fencing_generation')::bigint then
    raise exception using errcode = 'P0001', message = 'runtime_fenced';
  end if;

  lease_name_value := runtime_request->>'lease_name';
  if lease_name_value is null then
    raise exception using errcode = '22023', message = 'invalid_runtime_lease';
  end if;
  -- Serialize the first acquire as well as existing rows. A row lock alone
  -- cannot protect a lease name that does not exist yet.
  perform pg_advisory_xact_lock(hashtextextended(
    'edupi-runtime-lease:' || target_workspace::text || ':' || lease_name_value, 0
  ));
  select *
    into current_lease
    from edupi.core_runtime_leases
   where workspace_id = target_workspace and lease_name = lease_name_value
   for update;

  if action_value = 'lease_acquire' then
    if found and current_lease.expires_at > clock_timestamp()
      and (current_lease.instance_id <> instance_id_value or current_lease.instance_nonce <> instance_nonce_value) then
      raise exception using errcode = 'P0001', message = 'lease_held';
    end if;
    lease_token_value := replace(gen_random_uuid()::text, '-', '') || replace(gen_random_uuid()::text, '-', '');
    ttl_seconds := greatest(5, least(coalesce((runtime_request->>'ttl_seconds')::integer, 30), 3600));
    lease_expires_at_value := clock_timestamp() + make_interval(secs => ttl_seconds);
    insert into edupi.core_runtime_leases (
      workspace_id, lease_name, instance_id, instance_nonce, fencing_generation,
      lease_token_hash, expires_at
    )
    values (
      target_workspace, lease_name_value, instance_id_value, instance_nonce_value,
      current_instance.fencing_generation,
      encode(digest(lease_token_value, 'sha256'), 'hex'),
      lease_expires_at_value
    )
    on conflict (workspace_id, lease_name) do update
      set instance_id = excluded.instance_id,
          instance_nonce = excluded.instance_nonce,
          fencing_generation = excluded.fencing_generation,
          lease_token_hash = excluded.lease_token_hash,
          expires_at = excluded.expires_at,
          updated_at = now();
    update edupi.core_runtime_instances
       set last_seen_at = now()
     where workspace_id = target_workspace and instance_id = instance_id_value;
    return jsonb_build_object(
      'ok', true, 'operation', 'runtime', 'action', action_value,
      'lease_name', lease_name_value, 'lease_token', lease_token_value,
      'expires_at', lease_expires_at_value,
      'fencing_generation', current_instance.fencing_generation, 'external_send', false
    );
  end if;

  -- A token only authorizes its live lease and the exact registered incarnation.
  -- Use wall time after the row lock so time spent waiting cannot revive a lease.
  if not found or current_lease.expires_at <= clock_timestamp()
    or current_lease.instance_id is distinct from instance_id_value
    or current_lease.instance_nonce is distinct from instance_nonce_value
    or current_lease.fencing_generation is distinct from current_instance.fencing_generation
    or current_lease.lease_token_hash is distinct from
      encode(digest(coalesce(runtime_request->>'lease_token', ''), 'sha256'), 'hex') then
    raise exception using errcode = 'P0001', message = 'lease_invalid';
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
  elsif action_value = 'lease_renew' then
    ttl_seconds := greatest(5, least(coalesce((runtime_request->>'ttl_seconds')::integer, 30), 3600));
    lease_expires_at_value := clock_timestamp() + make_interval(secs => ttl_seconds);
    update edupi.core_runtime_leases
       set expires_at = lease_expires_at_value, updated_at = now()
     where workspace_id = target_workspace and lease_name = lease_name_value;
    return jsonb_build_object(
      'ok', true, 'operation', 'runtime', 'action', action_value,
      'lease_name', lease_name_value, 'expires_at', lease_expires_at_value,
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

revoke all on function edupi.revoke_workspace_member(uuid, uuid, text) from public, anon;
grant execute on function edupi.revoke_workspace_member(uuid, uuid, text) to authenticated;
revoke all on function edupi.runtime_transition(uuid, uuid, jsonb) from public, anon, authenticated;
grant execute on function edupi.runtime_transition(uuid, uuid, jsonb) to service_role;
