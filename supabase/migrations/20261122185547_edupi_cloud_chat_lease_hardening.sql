-- Every lease replacement and chat callback shares this order:
-- instance advisory lock, lease advisory lock, session/row locks.
alter function edupi.runtime_transition(uuid,uuid,jsonb)
  rename to runtime_transition_before_lease_serialization;
revoke all on function edupi.runtime_transition_before_lease_serialization(uuid,uuid,jsonb)
  from public,anon,authenticated,service_role;
create function edupi.runtime_transition(target_workspace uuid,actor_id uuid,runtime_request jsonb)
returns jsonb language plpgsql security definer set search_path=pg_catalog,edupi,extensions as $$
begin
  if actor_id is null or not exists(select 1 from edupi.workspace_members where
    workspace_id=target_workspace and account_id=actor_id and revoked_at is null) then
    raise exception 'workspace_forbidden';
  end if;
  perform pg_advisory_xact_lock(hashtextextended('edupi-instance:'||target_workspace::text||':'||
    coalesce(runtime_request->>'instance_id',''),0));
  if runtime_request->>'lease_name' is not null then
    perform pg_advisory_xact_lock(hashtextextended('edupi-lease:'||target_workspace::text||':'||
      (runtime_request->>'lease_name'),0));
  end if;
  return edupi.runtime_transition_before_lease_serialization(target_workspace,actor_id,runtime_request);
end $$;
revoke all on function edupi.runtime_transition(uuid,uuid,jsonb) from public,anon,authenticated;
grant execute on function edupi.runtime_transition(uuid,uuid,jsonb) to service_role;

alter function edupi.cloud_chat_transition(uuid,uuid,jsonb)
  rename to cloud_chat_transition_before_lease_serialization;
revoke all on function edupi.cloud_chat_transition_before_lease_serialization(uuid,uuid,jsonb)
  from public,anon,authenticated,service_role;
create function edupi.cloud_chat_transition(target_workspace uuid,actor_id uuid,chat_request jsonb)
returns jsonb language plpgsql security definer set search_path=pg_catalog,edupi,extensions as $$
declare proof jsonb:=chat_request->'runtime';
begin
  if actor_id is null or not exists(select 1 from edupi.workspace_members where
    workspace_id=target_workspace and account_id=actor_id and revoked_at is null) then
    raise exception 'workspace_forbidden';
  end if;
  if chat_request->>'action' in ('claim','running','append','complete','recover','fail') then
    if proof->>'lease_name' is distinct from 'cloud-chat' then raise exception 'runtime_fenced'; end if;
    perform pg_advisory_xact_lock(hashtextextended('edupi-instance:'||target_workspace::text||':'||
      coalesce(proof->>'instance_id',''),0));
    perform pg_advisory_xact_lock(hashtextextended('edupi-lease:'||target_workspace::text||':cloud-chat',0));
    perform edupi.require_cloud_runtime_lease(target_workspace,actor_id,proof);
  end if;
  return edupi.cloud_chat_transition_before_lease_serialization(target_workspace,actor_id,chat_request);
end $$;
revoke all on function edupi.cloud_chat_transition(uuid,uuid,jsonb) from public,anon,authenticated;
grant execute on function edupi.cloud_chat_transition(uuid,uuid,jsonb) to service_role;

-- The list projection must distinguish the tombstone actor column from the
-- function's authenticated actor argument.
do $$
declare definition text; original text;
begin
  definition:=pg_get_functiondef('edupi.cloud_entity_transition(uuid,uuid,jsonb)'::regprocedure);
  original:='select kind,target_id,revision,target_fingerprint,label,deleted_at,actor_id
          from edupi.cloud_entity_tombstones where workspace_id=target_workspace';
  if position(original in definition)=0 then raise exception 'entity_list_patch_source_changed'; end if;
  definition:=replace(definition,original,
    'select tombstone.kind,tombstone.target_id,tombstone.revision,tombstone.target_fingerprint,
            tombstone.label,tombstone.deleted_at,tombstone.actor_id
          from edupi.cloud_entity_tombstones tombstone where workspace_id=target_workspace');
  execute definition;
end $$;
