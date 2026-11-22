-- Preserve the canonical implementation and every historical migration byte.
-- Cloud conflict replacement has no supported resolution contract yet.
alter table edupi.fact_reviews add column mutation_request_hash text;

alter function edupi.mutate_education_fact(uuid, uuid, jsonb)
  rename to mutate_education_fact_canonical;
revoke all on function edupi.mutate_education_fact_canonical(uuid, uuid, jsonb)
  from public, anon, authenticated, service_role;

create function edupi.mutate_education_fact(
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
  request_hash text;
  current_fact edupi.facts%rowtype;
  existing_review edupi.fact_reviews%rowtype;
  response_payload jsonb;
begin
  -- Lock the membership so concurrent revocation cannot pass this check halfway
  -- through a write. The broker supplies actor_id from its verified user session.
  perform 1 from edupi.workspace_members
   where workspace_id = target_workspace and account_id = actor_id
     and revoked_at is null
   for share;
  if not found then
    raise exception using errcode = '42501', message = 'workspace_forbidden';
  end if;
  if jsonb_typeof(fact_request) is distinct from 'object'
    or request_id_value is null or fact_id_value is null or action_value is null
    or action_value not in ('review', 'modify', 'delete', 'restore') then
    raise exception using errcode = '22023', message = 'invalid_fact_request';
  end if;
  if jsonb_typeof(fact_request->'expected_revision') is distinct from 'number'
    or fact_request->>'expected_revision' !~ '^(0|[1-9][0-9]*)$' then
    raise exception using errcode = '22023', message = 'invalid_fact_request';
  end if;
  if (fact_request->>'expected_revision')::numeric > 2147483646 then
    raise exception using errcode = '22023', message = 'invalid_fact_request';
  end if;

  -- All mutations, including different facts with the same entity/predicate,
  -- share this lock with replace_fact_spine. A second accept sees the first.
  perform 1 from edupi.workspaces where id = target_workspace for update;
  request_hash := edupi.json_sha256(jsonb_build_object(
    'actor_id', actor_id, 'request', fact_request
  ));
  select * into existing_review from edupi.fact_reviews
   where workspace_id = target_workspace and request_id = request_id_value;
  if found then
    if existing_review.mutation_request_hash is not null then
      if existing_review.mutation_request_hash is distinct from request_hash then
        raise exception using errcode = 'P0001', message = 'idempotency_conflict';
      end if;
    else
      -- Pre-admission receipts did not retain the request. Compare every
      -- recoverable mutation field, and reject extra/unverifiable fields.
      if existing_review.fact_id is distinct from fact_id_value
        or existing_review.action is distinct from action_value
        or existing_review.before_payload->>'revision'
          is distinct from fact_request->>'expected_revision'
        or existing_review.decision is distinct from fact_request->>'decision'
        or existing_review.reviewer is distinct from coalesce(fact_request->>'reviewer', 'teacher')
        or existing_review.note is distinct from fact_request->>'note'
        or existing_review.superseded_fact_id is distinct from fact_request->>'supersedes_fact_id'
        or (action_value = 'modify'
          and existing_review.after_payload->>'value' is distinct from fact_request->>'replacement_value')
        or (action_value <> 'modify' and fact_request->>'replacement_value' is not null)
        or fact_request->>'supersedes_fact_revision' is not null
        or coalesce(fact_request->>'operation', 'education-facts') <> 'education-facts'
        or coalesce(fact_request->>'external_send', 'false') <> 'false'
        or fact_request - array[
          'request_id', 'fact_id', 'action', 'expected_revision', 'decision',
          'reviewer', 'note', 'replacement_value', 'supersedes_fact_id',
          'supersedes_fact_revision', 'operation', 'external_send'
        ] <> '{}'::jsonb then
        raise exception using errcode = 'P0001', message = 'idempotency_conflict';
      end if;
    end if;
    -- A completed request does not write again. Later conflicts, revisions, or
    -- deletion must not change its receipt or turn a valid retry into a failure.
    return edupi.mutate_education_fact_canonical(target_workspace, actor_id, fact_request);
  end if;

  if fact_request->>'supersedes_fact_id' is not null
    or fact_request->>'supersedes_fact_revision' is not null
    or fact_request->>'supersedesFactId' is not null
    or fact_request->>'supersedesFactRevision' is not null then
    raise exception using errcode = 'P0001', message = 'fact_conflict';
  end if;

  select * into current_fact from edupi.facts
   where workspace_id = target_workspace and fact_id = fact_id_value
   for update;
  if not found then
    raise exception using errcode = 'P0002', message = 'fact_not_found';
  end if;

  -- Modify also promotes a fact to accepted in the canonical contract; it must
  -- not provide an alternate path around the accept/restore admission check.
  if action_value in ('modify', 'restore')
    or (action_value = 'review' and fact_request->>'decision' = 'accept') then
    if cardinality(current_fact.conflict_ids) > 0
      or exists (
        select 1 from edupi.fact_conflicts conflict
         where conflict.workspace_id = target_workspace
           and fact_id_value = any(conflict.fact_ids)
      )
      or exists (
        select 1 from edupi.facts other
         where other.workspace_id = target_workspace
           and other.entity_id = current_fact.entity_id
           and other.predicate = current_fact.predicate
           and other.fact_id <> fact_id_value
           and other.status = 'accepted' and other.deleted_at is null
      ) then
      raise exception using errcode = 'P0001', message = 'fact_conflict';
    end if;
  end if;

  response_payload := edupi.mutate_education_fact_canonical(target_workspace, actor_id, fact_request);
  update edupi.fact_reviews set mutation_request_hash = request_hash
   where workspace_id = target_workspace and request_id = request_id_value;
  return response_payload;
end;
$$;

revoke all on function edupi.mutate_education_fact(uuid, uuid, jsonb)
  from public, anon, authenticated;
grant execute on function edupi.mutate_education_fact(uuid, uuid, jsonb) to service_role;

comment on function edupi.mutate_education_fact_canonical(uuid, uuid, jsonb) is
  'Internal canonical body; no direct anon, authenticated, or service_role EXECUTE. Use mutate_education_fact admission.';
comment on function edupi.mutate_education_fact(uuid, uuid, jsonb) is
  'Broker-only admission. service_role may call this wrapper with a verified active actor; privileged direct table writes remain outside this RPC boundary.';
