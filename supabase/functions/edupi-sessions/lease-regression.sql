-- Apply the new migrations in a rollback transaction before this regression.
create function pg_temp.chat_lease(w uuid,a uuid,i text,l text)
returns jsonb language plpgsql as $$
declare r jsonb; p jsonb; acquired jsonb;
begin
  r:=edupi.runtime_transition(w,a,jsonb_build_object('action','register','instance_id',i,'instance_nonce',i||'-nonce'));
  p:=jsonb_build_object('instance_id',i,'instance_nonce',i||'-nonce',
    'fencing_generation',r->'fencing_generation','lease_name',l);
  acquired:=edupi.runtime_transition(w,a,p||'{"action":"lease_acquire","ttl_seconds":60}'::jsonb);
  return p||jsonb_build_object('lease_token',acquired->>'lease_token');
end $$;
do $$
declare
  w uuid:=gen_random_uuid(); a uuid:=gen_random_uuid();
  first jsonb; other jsonb; rejected boolean:=false; signature text;
begin
  insert into auth.users(id) values(a);
  insert into edupi.workspaces(id,owner_account_id,mode) values(w,a,'cloud');
  insert into edupi.workspace_members(workspace_id,account_id,role) values(w,a,'owner');
  perform edupi.cloud_chat_transition(w,a,'{"action":"create","session_id":"s","request_id":"create"}');
  perform edupi.cloud_chat_transition(w,a,'{"action":"enqueue","session_id":"s","request_id":"first","command":{"type":"prompt","message":"first"}}');
  perform edupi.cloud_chat_transition(w,a,'{"action":"enqueue","session_id":"s","request_id":"second","command":{"type":"prompt","message":"second"}}');
  first:=pg_temp.chat_lease(w,a,'first-runtime','cloud-chat');
  perform edupi.cloud_chat_transition(w,a,jsonb_build_object('action','claim','runtime',first));
  other:=pg_temp.chat_lease(w,a,'other-runtime','unrelated-job');
  begin
    perform edupi.cloud_chat_transition(w,a,jsonb_build_object('action','claim','runtime',other));
  exception when others then
    if sqlerrm<>'runtime_fenced' then raise; end if;
    rejected:=true;
  end;
  if not rejected then raise exception 'unrelated lease accepted'; end if;
  if (select status from edupi.cloud_chat_requests where workspace_id=w and request_id='first')<>'claimed'
    or (select status from edupi.cloud_chat_requests where workspace_id=w and request_id='second')<>'queued'
    then raise exception 'unrelated lease changed chat state'; end if;
  foreach signature in array array[
    'edupi.cloud_chat_transition_before_lease_serialization(uuid,uuid,jsonb)',
    'edupi.runtime_transition_before_lease_serialization(uuid,uuid,jsonb)',
    'edupi.runtime_transition_before_cloud_queue(uuid,uuid,jsonb)'
  ] loop
    if has_function_privilege('service_role',signature,'execute')
      or has_function_privilege('authenticated',signature,'execute')
      then raise exception 'old function callable: %',signature; end if;
  end loop;
  -- The complete entity index must run, not merely parse successfully.
  if edupi.cloud_entity_transition(w,a,'{"action":"list"}')->>'ok'<>'true'
    then raise exception 'entity list failed'; end if;
end $$;
