create table edupi.student_event_write_receipts (
  workspace_id uuid not null references edupi.workspaces(id) on delete cascade,
  request_id text not null,
  actor_id uuid not null references auth.users(id),
  request_hash text not null,
  response jsonb not null,
  created_at timestamptz not null default now(),
  primary key(workspace_id,request_id)
);
alter table edupi.student_event_write_receipts enable row level security;
revoke all on edupi.student_event_write_receipts from public,anon,authenticated;
grant all on edupi.student_event_write_receipts to service_role;
revoke insert,update,delete on edupi.student_events,edupi.student_event_revisions from authenticated;

alter function edupi.mutate_student_event(uuid,text,integer,text,text,text,date,text)
  rename to mutate_student_event_before_outbox;
revoke all on function edupi.mutate_student_event_before_outbox(uuid,text,integer,text,text,text,date,text)
  from public,anon,authenticated,service_role;

create function edupi.mutate_student_event(
  target_workspace uuid,p_event_id text,p_expected_revision integer,p_action text,
  p_summary text default null,p_topic text default null,p_observed_on date default null,
  p_request_id text default gen_random_uuid()::text
) returns jsonb language plpgsql security definer
set search_path=pg_catalog,edupi,extensions as $$
declare
  actor uuid:=auth.uid();
  fingerprint text;
  previous edupi.student_event_write_receipts%rowtype;
  response jsonb;
begin
  if actor is null or not edupi.is_workspace_member(target_workspace) then raise exception 'workspace_forbidden'; end if;
  if p_request_id is null or length(p_request_id) not between 1 and 160
    or p_request_id ~ '[[:cntrl:]]' then raise exception 'invalid_event_request'; end if;
  fingerprint:=edupi.json_sha256(jsonb_build_object('event_id',p_event_id,'expected_revision',p_expected_revision,
    'action',p_action,'summary',p_summary,'topic',p_topic,'observed_on',p_observed_on));
  perform pg_advisory_xact_lock(hashtextextended('edupi-event-request:'||target_workspace::text||':'||p_request_id,0));
  select * into previous from edupi.student_event_write_receipts where workspace_id=target_workspace and request_id=p_request_id;
  if found then
    if previous.actor_id<>actor or previous.request_hash<>fingerprint then raise exception 'idempotency_conflict'; end if;
    return previous.response||'{"replayed":true}'::jsonb;
  end if;
  response:=edupi.mutate_student_event_before_outbox(target_workspace,p_event_id,p_expected_revision,p_action,
    p_summary,p_topic,p_observed_on,p_request_id);
  insert into edupi.student_event_write_receipts values(target_workspace,p_request_id,actor,fingerprint,response,now());
  return response;
end $$;
revoke all on function edupi.mutate_student_event(uuid,text,integer,text,text,text,date,text) from public,anon;
grant execute on function edupi.mutate_student_event(uuid,text,integer,text,text,text,date,text) to authenticated;
