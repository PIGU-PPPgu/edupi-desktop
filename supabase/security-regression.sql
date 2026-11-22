-- Apply migrations first. Run only on the database coordinated by the main agent:
--   psql -X -v ON_ERROR_STOP=1 -f supabase/security-regression.sql
-- All fixtures use fresh UUIDs, and every write is rolled back.
begin;
set local lock_timeout = '5s';
set local statement_timeout = '30s';

create temporary table edupi_security_fixture on commit drop as
select gen_random_uuid() as workspace_id, gen_random_uuid() as other_workspace_id,
  gen_random_uuid() as owner_id, gen_random_uuid() as admin_id,
  gen_random_uuid() as teacher_id, gen_random_uuid() as revoked_id,
  gen_random_uuid() as outsider_id, gen_random_uuid() as target_id;

insert into auth.users (id)
select account_id
from edupi_security_fixture fixture
cross join lateral unnest(array[
  fixture.owner_id, fixture.admin_id, fixture.teacher_id,
  fixture.revoked_id, fixture.outsider_id, fixture.target_id
]) account_id;

insert into edupi.workspaces (id, owner_account_id, mode)
select workspace_id, owner_id, 'cloud' from edupi_security_fixture
union all
select other_workspace_id, outsider_id, 'cloud' from edupi_security_fixture;

insert into edupi.workspace_members (workspace_id, account_id, role, revoked_at)
select fixture.workspace_id, member.account_id, member.role, member.revoked_at
from edupi_security_fixture fixture
cross join lateral (values
  (fixture.owner_id, 'owner', null::timestamptz),
  (fixture.admin_id, 'admin', null::timestamptz),
  (fixture.teacher_id, 'teacher', null::timestamptz),
  (fixture.revoked_id, 'admin', now()),
  (fixture.target_id, 'teacher', null::timestamptz)
) member(account_id, role, revoked_at)
union all
select other_workspace_id, outsider_id, 'owner', null from edupi_security_fixture;

create function pg_temp.security_assert(value boolean, label text)
returns void language plpgsql as $$
begin
  if value is distinct from true then
    raise exception 'security regression: %', label;
  end if;
end;
$$;

create function pg_temp.security_raises(command text, expected_state text, expected_message text)
returns void language plpgsql as $$
begin
  begin
    execute command;
  exception when others then
    if sqlstate = expected_state and sqlerrm = expected_message then return; end if;
    raise;
  end;
  raise exception 'security regression: expected % (%)', expected_message, expected_state;
end;
$$;

create function pg_temp.runtime_state(target_workspace uuid)
returns jsonb language sql as $$
  select jsonb_build_object(
    'instances', (select jsonb_agg(to_jsonb(item) order by item.instance_id)
      from edupi.core_runtime_instances item where workspace_id = target_workspace),
    'leases', (select jsonb_agg(to_jsonb(item) order by item.lease_name)
      from edupi.core_runtime_leases item where workspace_id = target_workspace),
    'events', (select jsonb_agg(to_jsonb(item) order by item.event_id)
      from edupi.core_runtime_events item where workspace_id = target_workspace)
  );
$$;

create function pg_temp.runtime_rejected(
  target_workspace uuid, actor_id uuid, request jsonb,
  expected_message text default 'lease_invalid',
  expected_state text default 'P0001'
)
returns void language plpgsql as $$
declare
  before_state jsonb := pg_temp.runtime_state(target_workspace);
begin
  perform pg_temp.security_raises(format(
    'select edupi.runtime_transition(%L::uuid, %L::uuid, %L::jsonb)',
    target_workspace, actor_id, request
  ), expected_state, expected_message);
  perform pg_temp.security_assert(
    before_state = pg_temp.runtime_state(target_workspace),
    'rejected runtime request changed instance, lease, or events'
  );
end;
$$;

-- Missing, revoked, and ordinary teacher roles must fail; owner/admin semantics
-- (self rejection, repeated revocation generation, audit, missing target) remain.
do $$
declare
  fixture edupi_security_fixture%rowtype;
  actor uuid;
  response jsonb;
  first_revoked_at timestamptz;
begin
  select * into fixture from edupi_security_fixture;
  foreach actor in array array[
    null::uuid, fixture.outsider_id, fixture.teacher_id, fixture.revoked_id
  ] loop
    perform set_config('request.jwt.claim.sub', coalesce(actor::text, ''), true);
    perform pg_temp.security_raises(format(
      'select edupi.revoke_workspace_member(%L::uuid, %L::uuid, %L)',
      fixture.workspace_id, fixture.target_id, 'security-denied'
    ), '42501', 'workspace_forbidden');
  end loop;
  perform pg_temp.security_assert((
    select revoked_at is null and revocation_generation = 0
    from edupi.workspace_members
    where workspace_id = fixture.workspace_id and account_id = fixture.target_id
  ), 'rejected revocations changed the target member');
  perform pg_temp.security_assert(not exists (
    select 1 from edupi.audit_events where workspace_id = fixture.workspace_id
  ), 'rejected revocation wrote an audit event');

  perform set_config('request.jwt.claim.sub', fixture.owner_id::text, true);
  perform pg_temp.security_raises(format(
    'select edupi.revoke_workspace_member(%L::uuid, %L::uuid, %L)',
    fixture.workspace_id, fixture.owner_id, 'security-self'
  ), '22023', 'cannot_revoke_self');
  perform pg_temp.security_raises(format(
    'select edupi.revoke_workspace_member(%L::uuid, %L::uuid, %L)',
    fixture.workspace_id, gen_random_uuid(), 'security-missing'
  ), 'P0002', 'member_not_found');
  response := edupi.revoke_workspace_member(
    fixture.workspace_id, fixture.target_id, 'security-owner-revoke'
  );
  perform pg_temp.security_assert(
    response->>'ok' = 'true' and response->>'revocation_generation' = '1'
      and response->>'external_send' = 'false',
    'owner revocation response changed'
  );
  select revoked_at into first_revoked_at from edupi.workspace_members
  where workspace_id = fixture.workspace_id and account_id = fixture.target_id;
  perform set_config('request.jwt.claim.sub', fixture.admin_id::text, true);
  response := edupi.revoke_workspace_member(
    fixture.workspace_id, fixture.target_id, 'security-admin-revoke'
  );
  perform pg_temp.security_assert((
    select revoked_at = first_revoked_at and revocation_generation = 2
    from edupi.workspace_members
    where workspace_id = fixture.workspace_id and account_id = fixture.target_id
  ) and response->>'revocation_generation' = '2', 'repeat admin revocation changed semantics');
  perform pg_temp.security_assert((
    select count(*) = 2 from edupi.audit_events
    where workspace_id = fixture.workspace_id and event_kind = 'workspace_member_revoked'
  ), 'valid revocations did not create two audit events');
  raise notice 'PASS revoke roles, unchanged target on rejection, owner/admin, self, missing target, audit';
end;
$$;

-- Evaluate every installed USING/WITH CHECK expression with real membership
-- fixtures. This isolates each of the five predicates, including both UPDATE
-- clauses. Full Storage HTTP/RLS integration is a separate external check.
do $$
declare
  fixture edupi_security_fixture%rowtype;
  policy record;
  clause text;
  allowed boolean;
  policy_count integer := 0;
  clause_count integer := 0;
begin
  select * into fixture from edupi_security_fixture;
  for policy in
    select polname, polcmd, polroles,
      pg_get_expr(polqual, polrelid) as using_clause,
      pg_get_expr(polwithcheck, polrelid) as check_clause
    from pg_policy
    where polrelid = 'storage.objects'::regclass
      and polname in (
        'edupi_material_objects_select', 'edupi_material_objects_insert',
        'edupi_material_objects_update', 'edupi_material_objects_delete'
      )
  loop
    policy_count := policy_count + 1;
    perform pg_temp.security_assert(
      policy.polroles = array[(select oid from pg_roles where rolname = 'authenticated')],
      'material policy is not restricted to authenticated'
    );
    perform pg_temp.security_assert(
      (policy.polname = 'edupi_material_objects_select' and policy.polcmd = 'r' and policy.using_clause is not null)
      or (policy.polname = 'edupi_material_objects_insert' and policy.polcmd = 'a' and policy.check_clause is not null)
      or (policy.polname = 'edupi_material_objects_update' and policy.polcmd = 'w'
        and policy.using_clause is not null and policy.check_clause is not null)
      or (policy.polname = 'edupi_material_objects_delete' and policy.polcmd = 'd' and policy.using_clause is not null),
      'material policy command or required predicate is missing'
    );
    foreach clause in array array[policy.using_clause, policy.check_clause] loop
      if clause is null then continue; end if;
      clause_count := clause_count + 1;
      perform set_config('request.jwt.claim.sub', fixture.teacher_id::text, true);
      execute format('select %s from (select $1::text bucket_id, $2::text name) objects', clause)
        into allowed using 'edupi-materials', fixture.workspace_id || '/material/file.pdf';
      perform pg_temp.security_assert(allowed, 'active teacher cannot access own material');
      execute format('select %s from (select $1::text bucket_id, $2::text name) objects', clause)
        into allowed using 'edupi-materials', fixture.other_workspace_id || '/material/file.pdf';
      perform pg_temp.security_assert(not allowed, 'material policy allows another workspace');
      execute format('select %s from (select $1::text bucket_id, $2::text name) objects', clause)
        into allowed using 'another-bucket', fixture.workspace_id || '/material/file.pdf';
      perform pg_temp.security_assert(not allowed, 'material policy allows another bucket');
      perform set_config('request.jwt.claim.sub', fixture.revoked_id::text, true);
      execute format('select %s from (select $1::text bucket_id, $2::text name) objects', clause)
        into allowed using 'edupi-materials', fixture.workspace_id || '/material/file.pdf';
      perform pg_temp.security_assert(not allowed, 'revoked member still passes material policy');
      perform set_config('request.jwt.claim.sub', fixture.outsider_id::text, true);
      execute format('select %s from (select $1::text bucket_id, $2::text name) objects', clause)
        into allowed using 'edupi-materials', fixture.workspace_id || '/material/file.pdf';
      perform pg_temp.security_assert(not allowed, 'nonmember passes material policy');
      perform set_config('request.jwt.claim.sub', '', true);
      execute format('select %s from (select $1::text bucket_id, $2::text name) objects', clause)
        into allowed using 'edupi-materials', fixture.workspace_id || '/material/file.pdf';
      perform pg_temp.security_assert(not allowed, 'unauthenticated caller passes material policy');
    end loop;
  end loop;
  perform pg_temp.security_assert(policy_count = 4 and clause_count = 5, 'missing material policies or predicates');
  raise notice 'PASS all four material policies / five predicates: active, revoked, missing, cross-workspace, bucket';
end;
$$;

do $$
declare
  fixture edupi_security_fixture%rowtype;
  registration jsonb := jsonb_build_object(
    'action', 'register', 'instance_id', 'security-runtime-a', 'instance_nonce', 'security-nonce-a',
    'core_commit', 'security-test', 'capabilities', jsonb_build_object('writer', true)
  );
  base_request jsonb;
  response jsonb;
  original_token text;
  action_name text;
begin
  select * into fixture from edupi_security_fixture;
  response := edupi.runtime_transition(fixture.workspace_id, fixture.owner_id, registration);
  perform pg_temp.security_assert(
    response->>'fencing_generation' = '1' and response->>'status' = 'ready'
      and response->>'instance_nonce' = 'security-nonce-a',
    'first registration must work without a lease'
  );
  response := edupi.runtime_transition(fixture.workspace_id, fixture.owner_id, registration);
  perform pg_temp.security_assert(response->>'fencing_generation' = '1', 'same nonce advanced generation');
  base_request := registration || jsonb_build_object(
    'action', 'heartbeat', 'fencing_generation', 1, 'event_kind', 'security-regression'
  );
  perform pg_temp.runtime_rejected(
    fixture.workspace_id, fixture.owner_id, base_request, 'invalid_runtime_lease', '22023'
  );
  response := edupi.runtime_transition(fixture.workspace_id, fixture.owner_id, base_request
    || jsonb_build_object('action', 'lease_acquire', 'lease_name', 'security-writer', 'ttl_seconds', 60));
  original_token := response->>'lease_token';
  perform pg_temp.security_assert(length(original_token) = 64, 'acquire did not issue a lease token');
  base_request := base_request || jsonb_build_object(
    'lease_name', 'security-writer', 'lease_token', original_token
  );
  update edupi.core_runtime_instances set status = 'draining', last_seen_at = '2000-01-01'
  where workspace_id = fixture.workspace_id;

  update edupi.core_runtime_leases set expires_at = clock_timestamp() - interval '1 second'
  where workspace_id = fixture.workspace_id;
  foreach action_name in array array['heartbeat', 'event', 'lease_renew', 'lease_release'] loop
    perform pg_temp.runtime_rejected(fixture.workspace_id, fixture.owner_id,
      base_request || jsonb_build_object('action', action_name));
  end loop;
  update edupi.core_runtime_leases set expires_at = clock_timestamp() + interval '1 hour'
  where workspace_id = fixture.workspace_id;

  foreach action_name in array array['heartbeat', 'event', 'lease_renew', 'lease_release'] loop
    perform pg_temp.runtime_rejected(fixture.workspace_id, fixture.owner_id,
      (base_request - 'lease_token') || jsonb_build_object('action', action_name));
    perform pg_temp.runtime_rejected(fixture.workspace_id, fixture.owner_id,
      base_request || jsonb_build_object('action', action_name, 'lease_token', 'wrong-test-token'));
    perform pg_temp.runtime_rejected(fixture.workspace_id, fixture.owner_id,
      base_request || jsonb_build_object('action', action_name, 'instance_nonce', 'wrong-nonce'),
      'runtime_fenced');
    perform pg_temp.runtime_rejected(fixture.workspace_id, fixture.owner_id,
      (base_request - 'fencing_generation') || jsonb_build_object('action', action_name),
      'runtime_fenced');
    perform pg_temp.runtime_rejected(fixture.workspace_id, fixture.owner_id,
      base_request || jsonb_build_object('action', action_name, 'fencing_generation', null),
      'runtime_fenced');
    perform pg_temp.runtime_rejected(fixture.workspace_id, fixture.owner_id,
      base_request || jsonb_build_object('action', action_name, 'fencing_generation', 2),
      'runtime_fenced');
  end loop;

  perform edupi.runtime_transition(fixture.workspace_id, fixture.owner_id, registration
    || jsonb_build_object('instance_id', 'security-runtime-b', 'instance_nonce', 'security-nonce-b'));
  foreach action_name in array array['heartbeat', 'event', 'lease_renew', 'lease_release'] loop
    perform pg_temp.runtime_rejected(fixture.workspace_id, fixture.owner_id,
      base_request || jsonb_build_object('action', action_name,
        'instance_id', 'security-runtime-b', 'instance_nonce', 'security-nonce-b'));
  end loop;
  perform pg_temp.runtime_rejected(fixture.workspace_id, fixture.owner_id,
    base_request || jsonb_build_object('action', 'lease_acquire',
      'instance_id', 'security-runtime-b', 'instance_nonce', 'security-nonce-b'), 'lease_held');

  update edupi.core_runtime_leases set instance_nonce = 'previous-nonce'
  where workspace_id = fixture.workspace_id;
  foreach action_name in array array['heartbeat', 'event', 'lease_renew', 'lease_release'] loop
    perform pg_temp.runtime_rejected(fixture.workspace_id, fixture.owner_id,
      base_request || jsonb_build_object('action', action_name));
  end loop;
  update edupi.core_runtime_leases set instance_nonce = 'security-nonce-a', fencing_generation = 2
  where workspace_id = fixture.workspace_id;
  foreach action_name in array array['heartbeat', 'event', 'lease_renew', 'lease_release'] loop
    perform pg_temp.runtime_rejected(fixture.workspace_id, fixture.owner_id,
      base_request || jsonb_build_object('action', action_name));
  end loop;
  update edupi.core_runtime_leases set fencing_generation = 1 where workspace_id = fixture.workspace_id;
  perform pg_temp.runtime_rejected(fixture.workspace_id, fixture.owner_id,
    base_request || jsonb_build_object('lease_name', 'missing-lease'));

  response := edupi.runtime_transition(fixture.workspace_id, fixture.owner_id, base_request);
  perform pg_temp.security_assert(response->>'status' = 'ready' and (
    select status = 'ready' and last_seen_at > '2000-01-01'::timestamptz
    from edupi.core_runtime_instances
    where workspace_id = fixture.workspace_id and instance_id = 'security-runtime-a'
  ), 'valid heartbeat did not persist');
  perform edupi.runtime_transition(fixture.workspace_id, fixture.owner_id,
    base_request || jsonb_build_object('action', 'event', 'payload', jsonb_build_object('test', true)));
  perform pg_temp.security_assert((
    select count(*) = 1 from edupi.core_runtime_events
    where workspace_id = fixture.workspace_id and event_kind = 'security-regression'
      and instance_id = 'security-runtime-a' and instance_nonce = 'security-nonce-a'
      and fencing_generation = 1 and payload = '{"test":true}'::jsonb
  ), 'valid event did not persist with its lease identity');
  response := edupi.runtime_transition(fixture.workspace_id, fixture.owner_id,
    base_request || jsonb_build_object('action', 'lease_renew', 'ttl_seconds', 120));
  perform pg_temp.security_assert((
    select expires_at = (response->>'expires_at')::timestamptz and expires_at > clock_timestamp()
    from edupi.core_runtime_leases where workspace_id = fixture.workspace_id
  ), 'valid renewal expiry did not persist');

  response := edupi.runtime_transition(fixture.workspace_id, fixture.owner_id,
    base_request || jsonb_build_object('action', 'lease_acquire'));
  perform pg_temp.security_assert(
    response->>'lease_token' is distinct from original_token, 'acquire failed to rotate the token'
  );
  perform pg_temp.runtime_rejected(fixture.workspace_id, fixture.owner_id, base_request);
  base_request := base_request || jsonb_build_object('lease_token', response->>'lease_token');
  perform edupi.runtime_transition(fixture.workspace_id, fixture.owner_id, base_request);

  response := edupi.runtime_transition(fixture.workspace_id, fixture.owner_id,
    registration || jsonb_build_object('instance_nonce', 'replacement-nonce'));
  perform pg_temp.security_assert(response->>'fencing_generation' = '2', 'replacement nonce did not fence old instance');
  perform pg_temp.runtime_rejected(fixture.workspace_id, fixture.owner_id, base_request, 'runtime_fenced');
  base_request := base_request || jsonb_build_object('instance_nonce', 'replacement-nonce', 'fencing_generation', 2);
  perform pg_temp.runtime_rejected(fixture.workspace_id, fixture.owner_id, base_request);
  update edupi.core_runtime_leases set expires_at = clock_timestamp() - interval '1 second'
  where workspace_id = fixture.workspace_id;
  response := edupi.runtime_transition(fixture.workspace_id, fixture.owner_id,
    base_request || jsonb_build_object('action', 'lease_acquire'));
  base_request := base_request || jsonb_build_object('lease_token', response->>'lease_token');
  perform edupi.runtime_transition(fixture.workspace_id, fixture.owner_id, base_request);
  perform edupi.runtime_transition(fixture.workspace_id, fixture.owner_id,
    base_request || jsonb_build_object('action', 'lease_release'));
  perform pg_temp.security_assert(not exists (
    select 1 from edupi.core_runtime_leases where workspace_id = fixture.workspace_id
  ), 'valid release left the lease behind');
  perform pg_temp.runtime_rejected(fixture.workspace_id, fixture.owner_id, base_request);

  perform pg_temp.runtime_rejected(fixture.workspace_id, fixture.revoked_id, registration,
    'workspace_forbidden', '42501');
  perform pg_temp.runtime_rejected(fixture.workspace_id, fixture.outsider_id, registration,
    'workspace_forbidden', '42501');
  perform pg_temp.security_assert(
    not has_function_privilege('anon', 'edupi.revoke_workspace_member(uuid,uuid,text)', 'execute')
      and has_function_privilege('authenticated', 'edupi.revoke_workspace_member(uuid,uuid,text)', 'execute')
      and not has_function_privilege('authenticated', 'edupi.runtime_transition(uuid,uuid,jsonb)', 'execute')
      and has_function_privilege('service_role', 'edupi.runtime_transition(uuid,uuid,jsonb)', 'execute'),
    'RPC execution grants changed'
  );
  raise notice 'PASS runtime register, live leases, expiry, identity fencing, token rotation, renew/release, rejection without writes';
end;
$$;

rollback;
