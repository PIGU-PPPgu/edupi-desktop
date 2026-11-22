do $$
begin
  if to_regprocedure('edupi.workspace_snapshot_payload(uuid)') is not null
    and to_regprocedure('edupi.workspace_snapshot_canonical_payload(uuid)') is null then
    alter function edupi.workspace_snapshot_payload(uuid)
      rename to workspace_snapshot_canonical_payload;
  end if;
end;
$$;

create or replace function edupi.mobile_dashboard_payload(target_workspace uuid)
returns jsonb
language sql
stable
security definer
set search_path = pg_catalog, edupi, extensions
as $$
  select jsonb_build_object(
    'workspace_id', target_workspace,
    'students', coalesce((
      select jsonb_agg(to_jsonb(item) order by item.student_id)
      from (
        select student_id, name, class_name, profile, revision
        from edupi.student_profiles
        where workspace_id = target_workspace and deleted_at is null
      ) item
    ), '[]'::jsonb),
    'tasks', coalesce((
      select jsonb_agg(to_jsonb(item) order by item.updated_at desc)
      from (
        select task_id, title, due_date, note, stage, status, revision, updated_at
        from edupi.tasks
        where workspace_id = target_workspace and deleted_at is null
      ) item
    ), '[]'::jsonb),
    'calendar', coalesce((
      select jsonb_agg(
        event || jsonb_build_object('id', coalesce(event->>'id', event->>'event_id', item.input_id))
        order by event->>'date', event->>'id', item.input_id
      )
      from edupi.education_inputs item
      cross join lateral jsonb_array_elements(
        case
          when jsonb_typeof(item.payload->'events') = 'array' then item.payload->'events'
          else jsonb_build_array(item.payload)
        end
      ) event
      where item.workspace_id = target_workspace
        and item.input_kind = 'calendar'
        and item.deleted_at is null
    ), '[]'::jsonb),
    'timetable', coalesce((
      select jsonb_agg(
        slot || jsonb_build_object('id', coalesce(slot->>'id', slot->>'slot_id', item.input_id))
        order by slot->>'day_of_week', slot->>'period', slot->>'id', item.input_id
      )
      from edupi.education_inputs item
      cross join lateral jsonb_array_elements(
        case
          when jsonb_typeof(item.payload->'slots') = 'array' then item.payload->'slots'
          else jsonb_build_array(item.payload)
        end
      ) slot
      where item.workspace_id = target_workspace
        and item.input_kind = 'timetable'
        and item.deleted_at is null
    ), '[]'::jsonb),
    'external_send', false
  );
$$;

create or replace function edupi.workspace_snapshot_payload(target_workspace uuid)
returns jsonb
language sql
stable
set search_path = pg_catalog, edupi, extensions
as $$
  select edupi.workspace_snapshot_canonical_payload(target_workspace)
    || jsonb_build_object(
      'students', coalesce((
        select jsonb_agg(to_jsonb(item) order by item.student_id)
        from (
          select student_id, name, class_name, profile, revision
          from edupi.student_profiles
          where workspace_id = target_workspace and deleted_at is null
        ) item
      ), '[]'::jsonb),
      'student_events', coalesce((
        select jsonb_agg(to_jsonb(item) order by item.event_id)
        from (
          select event_id, kind, student_ids, student_labels, class_name,
            canonical_topic, topic, summary, observed_on, recorded_at,
            updated_at, revision, source, history
          from edupi.student_events
          where workspace_id = target_workspace and deleted_at is null
        ) item
      ), '[]'::jsonb),
      'calendar', coalesce((
        select jsonb_agg(
          event || jsonb_build_object('id', coalesce(event->>'id', event->>'event_id', item.input_id))
          order by event->>'date', event->>'id', item.input_id
        )
        from edupi.education_inputs item
        cross join lateral jsonb_array_elements(
          case
            when jsonb_typeof(item.payload->'events') = 'array' then item.payload->'events'
            else jsonb_build_array(item.payload)
          end
        ) event
        where item.workspace_id = target_workspace
          and item.input_kind = 'calendar'
          and item.deleted_at is null
      ), '[]'::jsonb),
      'timetable', coalesce((
        select jsonb_agg(
          slot || jsonb_build_object('id', coalesce(slot->>'id', slot->>'slot_id', item.input_id))
          order by slot->>'day_of_week', slot->>'period', slot->>'id', item.input_id
        )
        from edupi.education_inputs item
        cross join lateral jsonb_array_elements(
          case
            when jsonb_typeof(item.payload->'slots') = 'array' then item.payload->'slots'
            else jsonb_build_array(item.payload)
          end
        ) slot
        where item.workspace_id = target_workspace
          and item.input_kind = 'timetable'
          and item.deleted_at is null
      ), '[]'::jsonb)
    );
$$;

revoke all on function edupi.mobile_dashboard_payload(uuid) from public, anon, authenticated;
grant execute on function edupi.mobile_dashboard_payload(uuid) to service_role;
