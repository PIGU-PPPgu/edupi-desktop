-- Apply migrations first; run with psql -X -v ON_ERROR_STOP=1 -f this-file.
-- Fresh UUID accounts/workspaces only. No user data or credentials are printed.
-- Every fixture, receipt, and projection is rolled back.
begin;
set local lock_timeout = '5s';
set local statement_timeout = '30s';

create temporary table edupi_fact_conflict_fixture on commit drop as
select gen_random_uuid() as workspace_id, gen_random_uuid() as other_workspace_id,
  gen_random_uuid() as owner_id, gen_random_uuid() as teacher_id,
  gen_random_uuid() as revoked_id, gen_random_uuid() as outsider_id;

insert into auth.users (id)
select account_id from edupi_fact_conflict_fixture fixture
cross join lateral unnest(array[
  fixture.owner_id, fixture.teacher_id, fixture.revoked_id, fixture.outsider_id
]) account_id;
insert into edupi.workspaces (id, owner_account_id, mode)
select workspace_id, owner_id, 'cloud' from edupi_fact_conflict_fixture
union all
select other_workspace_id, outsider_id, 'cloud' from edupi_fact_conflict_fixture;
insert into edupi.workspace_members (workspace_id, account_id, role, revoked_at)
select fixture.workspace_id, member.account_id, member.role, member.revoked_at
from edupi_fact_conflict_fixture fixture
cross join lateral (values
  (fixture.owner_id, 'owner', null::timestamptz),
  (fixture.teacher_id, 'teacher', null::timestamptz),
  (fixture.revoked_id, 'teacher', now())
) member(account_id, role, revoked_at)
union all
select other_workspace_id, outsider_id, 'owner', null from edupi_fact_conflict_fixture;

create function pg_temp.fact_assert(value boolean, label text)
returns void language plpgsql as $$
begin
  if value is distinct from true then
    raise exception 'fact admission regression: %', label;
  end if;
end;
$$;

create function pg_temp.fact_state(target_workspace uuid)
returns jsonb language sql as $$
  select jsonb_build_object(
    'facts', (select jsonb_agg(to_jsonb(item) order by item.fact_id)
      from edupi.facts item where workspace_id = target_workspace),
    'reviews', (select jsonb_agg(to_jsonb(item) order by item.request_id)
      from edupi.fact_reviews item where workspace_id = target_workspace),
    'conflicts', (select jsonb_agg(to_jsonb(item) order by item.conflict_id)
      from edupi.fact_conflicts item where workspace_id = target_workspace),
    'spines', (select jsonb_agg(to_jsonb(item) order by item.revision)
      from edupi.fact_spine_snapshots item where workspace_id = target_workspace)
  );
$$;

create function pg_temp.fact_rejected(
  target_workspace uuid, actor_id uuid, request jsonb,
  expected_message text default 'fact_conflict',
  expected_state text default 'P0001'
)
returns void language plpgsql as $$
declare
  before_state jsonb := pg_temp.fact_state(target_workspace);
  rejected boolean := false;
begin
  begin
    perform edupi.mutate_education_fact(target_workspace, actor_id, request);
  exception when others then
    if sqlstate <> expected_state or sqlerrm <> expected_message then raise; end if;
    rejected := true;
  end;
  perform pg_temp.fact_assert(rejected, 'request unexpectedly succeeded');
  perform pg_temp.fact_assert(
    before_state is not distinct from pg_temp.fact_state(target_workspace),
    'rejected request changed facts, reviews, conflicts, or spine'
  );
end;
$$;

create function pg_temp.fact_request(
  request_id text, fact_id text, action text, expected_revision integer,
  extra jsonb default '{}'::jsonb
)
returns jsonb language sql as $$
  select jsonb_build_object(
    'operation', 'education-facts', 'request_id', request_id, 'fact_id', fact_id,
    'action', action, 'expected_revision', expected_revision, 'external_send', false
  ) || extra;
$$;

insert into edupi.facts (
  workspace_id, fact_id, entity_id, fact_kind, predicate, value,
  status, conflict_ids, deleted_previous_status, deleted_at
)
select fixture.workspace_id, fact.id, fact.entity, 'general', fact.predicate,
  fact.id || '-value', fact.status, fact.conflicts,
  case when fact.status = 'deleted' then 'accepted' end,
  case when fact.status = 'deleted' then now() end
from edupi_fact_conflict_fixture fixture
cross join lateral (values
  ('ordinary', 'ordinary-entity', 'ordinary-predicate', 'candidate', '{}'::text[]),
  ('duplicate-old', 'duplicate-entity', 'duplicate-predicate', 'accepted', '{}'::text[]),
  ('duplicate-new', 'duplicate-entity', 'duplicate-predicate', 'candidate', '{}'::text[]),
  ('duplicate-deleted', 'duplicate-entity', 'duplicate-predicate', 'deleted', '{}'::text[]),
  ('ids-candidate', 'ids-entity', 'ids-predicate', 'candidate', array['unresolved-id']),
  ('ids-deleted', 'ids-deleted-entity', 'ids-predicate', 'deleted', array['missing-conflict-row']),
  ('table-candidate', 'table-entity', 'table-predicate', 'candidate', '{}'::text[]),
  ('table-deleted', 'table-entity', 'table-predicate', 'deleted', '{}'::text[]),
  ('legacy', 'legacy-entity', 'legacy-predicate', 'candidate', '{}'::text[]),
  ('scope', 'scope-entity', 'scope-predicate', 'deleted', '{}'::text[]),
  ('deleted-other', 'scope-entity', 'scope-predicate', 'deleted', '{}'::text[])
) fact(id, entity, predicate, status, conflicts)
union all
select other_workspace_id, 'scope-other-workspace', 'scope-entity', 'general',
  'scope-predicate', 'other-workspace-value', 'accepted', '{}'::text[], null, null
from edupi_fact_conflict_fixture;

insert into edupi.fact_conflicts (workspace_id, conflict_id, entity_id, predicate, fact_ids)
select workspace_id, 'table-conflict', 'table-entity', 'table-predicate',
  array['table-candidate', 'table-deleted']
from edupi_fact_conflict_fixture;

do $$
declare
  fixture edupi_fact_conflict_fixture%rowtype;
  base_request jsonb := pg_temp.fact_request('invalid-cas', 'ordinary', 'review', 0, '{"decision":"accept"}');
  invalid_revision jsonb;
begin
  select * into fixture from edupi_fact_conflict_fixture;
  perform pg_temp.fact_rejected(fixture.workspace_id, fixture.owner_id,
    base_request - 'expected_revision', 'invalid_fact_request', '22023');
  foreach invalid_revision in array array['null'::jsonb, '"0"'::jsonb, '-1'::jsonb, '1.5'::jsonb, '2147483647'::jsonb] loop
    perform pg_temp.fact_rejected(fixture.workspace_id, fixture.owner_id,
      base_request || jsonb_build_object('expected_revision', invalid_revision),
      'invalid_fact_request', '22023');
  end loop;
  raise notice 'PASS missing, null, string, negative, fractional and oversized expected revision reject without writes';
end;
$$;

do $$
declare
  fixture edupi_fact_conflict_fixture%rowtype;
  actor uuid;
begin
  select * into fixture from edupi_fact_conflict_fixture;
  foreach actor in array array[null::uuid, fixture.revoked_id, fixture.outsider_id] loop
    perform pg_temp.fact_rejected(
      fixture.workspace_id, actor,
      pg_temp.fact_request('membership-denied', 'ordinary', 'review', 0, '{"decision":"accept"}'),
      'workspace_forbidden', '42501'
    );
  end loop;
  raise notice 'PASS missing, nonmember, and revoked actors denied without writes';
end;
$$;

do $$
declare
  fixture edupi_fact_conflict_fixture%rowtype;
  fact_id text;
  action_name text;
  field_name text;
  extra jsonb;
begin
  select * into fixture from edupi_fact_conflict_fixture;
  foreach fact_id in array array['duplicate-new', 'ids-candidate', 'table-candidate'] loop
    perform pg_temp.fact_rejected(
      fixture.workspace_id, fixture.owner_id,
      pg_temp.fact_request('accept-' || fact_id, fact_id, 'review', 0, '{"decision":"accept"}')
    );
    perform pg_temp.fact_rejected(
      fixture.workspace_id, fixture.owner_id,
      pg_temp.fact_request('modify-' || fact_id, fact_id, 'modify', 0, '{"replacement_value":"changed"}')
    );
  end loop;
  foreach fact_id in array array['duplicate-deleted', 'ids-deleted', 'table-deleted'] loop
    perform pg_temp.fact_rejected(
      fixture.workspace_id, fixture.owner_id,
      pg_temp.fact_request('restore-' || fact_id, fact_id, 'restore', 0)
    );
  end loop;
  foreach action_name in array array['review', 'modify', 'delete', 'restore'] loop
    extra := case action_name
      when 'review' then '{"decision":"accept"}'::jsonb
      when 'modify' then '{"replacement_value":"changed"}'::jsonb
      else '{}'::jsonb end;
    foreach field_name in array array[
      'supersedes_fact_id', 'supersedesFactId', 'supersedes_fact_revision', 'supersedesFactRevision'
    ] loop
      perform pg_temp.fact_rejected(
        fixture.workspace_id, fixture.owner_id,
        pg_temp.fact_request('supersedes-' || action_name || '-' || field_name,
          'ordinary', action_name, 0, extra || jsonb_build_object(field_name, 'duplicate-old'))
      );
    end loop;
  end loop;
  raise notice 'PASS conflict rows, conflict IDs, accepted peers, and all supersedes actions leave data intact';
end;
$$;

do $$
declare
  fixture edupi_fact_conflict_fixture%rowtype;
  response jsonb;
  accepted_request jsonb;
  modify_request jsonb;
  delete_request jsonb;
  restore_request jsonb;
  replay_request jsonb;
  before_state jsonb;
  changed_request jsonb;
begin
  select * into fixture from edupi_fact_conflict_fixture;
  accepted_request := pg_temp.fact_request('ordinary-accept', 'ordinary', 'review', 0,
    '{"decision":"accept","reviewer":"teacher","note":"fixture","supersedes_fact_id":null}');
  response := edupi.mutate_education_fact(fixture.workspace_id, fixture.teacher_id, accepted_request);
  perform pg_temp.fact_assert(
    response->>'status' = 'accepted' and response->>'revision' = '1'
      and response->>'replayed' = 'false' and response->>'external_send' = 'false'
      and response->'fact_spine'->'spine'->'acceptedFacts' @> '[{"id":"ordinary","value":"ordinary-value"}]',
    'ordinary accept receipt or projection changed'
  );
  modify_request := pg_temp.fact_request('ordinary-modify', 'ordinary', 'modify', 1,
    '{"replacement_value":"edited"}');
  response := edupi.mutate_education_fact(fixture.workspace_id, fixture.teacher_id, modify_request);
  perform pg_temp.fact_assert(
    response->>'status' = 'accepted' and response->>'revision' = '2'
      and (select value = 'edited' from edupi.facts
        where workspace_id = fixture.workspace_id and fact_id = 'ordinary'),
    'ordinary modify failed to persist'
  );
  delete_request := pg_temp.fact_request('ordinary-delete', 'ordinary', 'delete', 2);
  response := edupi.mutate_education_fact(fixture.workspace_id, fixture.teacher_id, delete_request);
  perform pg_temp.fact_assert(
    response->>'status' = 'deleted' and response->>'revision' = '3'
      and (select deleted_at is not null and deleted_previous_status = 'accepted'
        from edupi.facts where workspace_id = fixture.workspace_id and fact_id = 'ordinary'),
    'ordinary delete lost restoration state'
  );
  restore_request := pg_temp.fact_request('ordinary-restore', 'ordinary', 'restore', 3);
  response := edupi.mutate_education_fact(fixture.workspace_id, fixture.teacher_id, restore_request);
  perform pg_temp.fact_assert(
    response->>'status' = 'accepted' and response->>'revision' = '4'
      and (select value = 'edited' and deleted_at is null and deleted_previous_status is null
        from edupi.facts where workspace_id = fixture.workspace_id and fact_id = 'ordinary')
      and response->'fact_spine'->'spine'->'acceptedFacts' @> '[{"id":"ordinary","value":"edited"}]',
    'ordinary restore did not persist and refresh the spine'
  );
  perform pg_temp.fact_rejected(
    fixture.workspace_id, fixture.teacher_id,
    pg_temp.fact_request('ordinary-stale', 'ordinary', 'delete', 0), 'stale_fact'
  );
  perform pg_temp.fact_rejected(
    fixture.workspace_id, fixture.teacher_id,
    pg_temp.fact_request('ordinary-not-deleted', 'ordinary', 'restore', 4), 'invalid_fact_state'
  );
  -- Introduce later conflict/revision state only after the original request
  -- completed. Replaying it must return its revision-1 receipt without writing.
  update edupi.facts set conflict_ids = array['later-conflict']
   where workspace_id = fixture.workspace_id and fact_id = 'ordinary';
  before_state := pg_temp.fact_state(fixture.workspace_id);
  foreach replay_request in array array[accepted_request, modify_request, delete_request, restore_request] loop
    response := edupi.mutate_education_fact(fixture.workspace_id, fixture.teacher_id, replay_request);
    perform pg_temp.fact_assert(
      response->>'replayed' = 'true'
        and (response->>'revision')::integer = (replay_request->>'expected_revision')::integer + 1
        and response->>'status' = case replay_request->>'action' when 'delete' then 'deleted' else 'accepted' end
        and before_state = pg_temp.fact_state(fixture.workspace_id),
      'completed request replay depends on later fact state'
    );
  end loop;
  foreach changed_request in array array[
    accepted_request || '{"fact_id":"duplicate-new"}',
    accepted_request || '{"action":"delete"}',
    accepted_request || '{"decision":"reject"}',
    accepted_request || '{"expected_revision":4}',
    accepted_request || '{"note":"different"}',
    accepted_request || '{"reviewer":"another"}',
    accepted_request || '{"supersedes_fact_id":"duplicate-old"}',
    accepted_request || '{"extra":"unrecorded"}'
  ] loop
    perform pg_temp.fact_rejected(
      fixture.workspace_id, fixture.teacher_id, changed_request, 'idempotency_conflict'
    );
  end loop;
  perform pg_temp.fact_rejected(
    fixture.workspace_id, fixture.owner_id, accepted_request, 'idempotency_conflict'
  );
  update edupi.workspace_members set revoked_at = now()
   where workspace_id = fixture.workspace_id and account_id = fixture.teacher_id;
  perform pg_temp.fact_rejected(
    fixture.workspace_id, fixture.teacher_id, accepted_request, 'workspace_forbidden', '42501'
  );
  raise notice 'PASS accept/modify/delete/restore, persistence, spine, stale/state guards, and payload-bound replay';
end;
$$;

do $$
declare
  fixture edupi_fact_conflict_fixture%rowtype;
  request jsonb;
  response jsonb;
  before_state jsonb;
begin
  select * into fixture from edupi_fact_conflict_fixture;
  -- Model an already completed pre-migration receipt using the preserved body.
  request := pg_temp.fact_request('legacy-modify', 'legacy', 'modify', 0,
    '{"replacement_value":"legacy-edited","note":"legacy-note"}');
  perform edupi.mutate_education_fact_canonical(fixture.workspace_id, fixture.owner_id, request);
  update edupi.facts set status = 'deleted', deleted_previous_status = 'accepted',
    deleted_at = now(), revision = revision + 1, conflict_ids = array['later-legacy-conflict']
   where workspace_id = fixture.workspace_id and fact_id = 'legacy';
  before_state := pg_temp.fact_state(fixture.workspace_id);
  response := edupi.mutate_education_fact(fixture.workspace_id, fixture.owner_id, request);
  perform pg_temp.fact_assert(
    response->>'replayed' = 'true' and response->>'revision' = '1'
      and before_state = pg_temp.fact_state(fixture.workspace_id),
    'pre-migration receipt no longer replays after later deletion/conflict'
  );
  perform pg_temp.fact_rejected(fixture.workspace_id, fixture.owner_id,
    request || '{"replacement_value":"forged"}', 'idempotency_conflict');
  perform pg_temp.fact_rejected(fixture.workspace_id, fixture.owner_id,
    request || '{"fact_id":"ordinary"}', 'idempotency_conflict');
  perform pg_temp.fact_rejected(fixture.workspace_id, fixture.owner_id,
    request || '{"expected_revision":2}', 'idempotency_conflict');
  perform pg_temp.fact_rejected(fixture.workspace_id, fixture.owner_id,
    request || '{"note":"forged"}', 'idempotency_conflict');
  perform pg_temp.fact_rejected(fixture.workspace_id, fixture.owner_id,
    request || '{"extra":"forged"}', 'idempotency_conflict');
  response := edupi.mutate_education_fact(fixture.workspace_id, fixture.owner_id,
    pg_temp.fact_request('scope-restore', 'scope', 'restore', 0));
  perform pg_temp.fact_assert(
    response->>'status' = 'accepted' and response->>'revision' = '1',
    'another workspace or deleted peer blocked an ordinary restore'
  );
  -- A second candidate is now rejected against the newly accepted first fact.
  insert into edupi.facts (workspace_id, fact_id, entity_id, fact_kind, predicate, value)
  values (fixture.workspace_id, 'scope-second', 'scope-entity', 'general', 'scope-predicate', 'second');
  perform pg_temp.fact_rejected(fixture.workspace_id, fixture.owner_id,
    pg_temp.fact_request('scope-second-accept', 'scope-second', 'review', 0, '{"decision":"accept"}'));
  response := edupi.mutate_education_fact(fixture.workspace_id, fixture.owner_id,
    pg_temp.fact_request('conflicted-hold', 'table-candidate', 'review', 0, '{"decision":"hold"}'));
  perform pg_temp.fact_assert(
    response->>'status' = 'held' and response->>'revision' = '1',
    'conflict admission blocked a non-accepting hold decision'
  );
  response := edupi.mutate_education_fact(fixture.workspace_id, fixture.owner_id,
    pg_temp.fact_request('conflicted-reject', 'table-candidate', 'review', 1, '{"decision":"reject"}'));
  perform pg_temp.fact_assert(
    response->>'status' = 'rejected' and response->>'revision' = '2',
    'conflict admission blocked a non-accepting rejection'
  );
  raise notice 'PASS legacy replay identity, workspace/deleted-peer isolation, and sequential duplicate acceptance';
end;
$$;

do $$
declare
  role_name text;
begin
  foreach role_name in array array['anon', 'authenticated', 'service_role'] loop
    perform pg_temp.fact_assert(not has_function_privilege(
      role_name, 'edupi.mutate_education_fact_canonical(uuid,uuid,jsonb)', 'EXECUTE'
    ), 'canonical implementation is directly callable');
  end loop;
  foreach role_name in array array['anon', 'authenticated'] loop
    perform pg_temp.fact_assert(not has_function_privilege(
      role_name, 'edupi.mutate_education_fact(uuid,uuid,jsonb)', 'EXECUTE'
    ), 'public mutation RPC is directly callable by a client');
  end loop;
  perform pg_temp.fact_assert(has_function_privilege(
    'service_role', 'edupi.mutate_education_fact(uuid,uuid,jsonb)', 'EXECUTE'
  ), 'broker lost admission RPC access');
  raise notice 'PASS only service_role can execute the admission RPC; no client or broker can execute canonical directly';
end;
$$;

-- Check actual calls under the application database roles as well as their ACLs.
set local role authenticated;
do $$
begin
  begin
    perform edupi.mutate_education_fact(null, null, '{}'::jsonb);
    raise exception 'authenticated called the admission RPC';
  exception when insufficient_privilege then
    if sqlerrm <> 'permission denied for function mutate_education_fact' then raise; end if;
  end;
  begin
    perform edupi.mutate_education_fact_canonical(null, null, '{}'::jsonb);
    raise exception 'authenticated bypassed admission';
  exception when insufficient_privilege then
    if sqlerrm <> 'permission denied for function mutate_education_fact_canonical' then raise; end if;
  end;
end;
$$;
reset role;
set local role service_role;
do $$
begin
  begin
    perform edupi.mutate_education_fact_canonical(null, null, '{}'::jsonb);
    raise exception 'service_role bypassed admission';
  exception when insufficient_privilege then
    if sqlerrm <> 'permission denied for function mutate_education_fact_canonical' then raise; end if;
  end;
  begin
    perform edupi.mutate_education_fact(null, null, '{}'::jsonb);
    raise exception 'admission accepted an unidentified broker actor';
  exception when insufficient_privilege then
    if sqlerrm <> 'workspace_forbidden' then raise; end if;
  end;
  raise notice 'PASS actual authenticated/service_role calls enforce the wrapper boundary';
end;
$$;
reset role;

rollback;
