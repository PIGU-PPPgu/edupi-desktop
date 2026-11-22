insert into storage.buckets (id, name, public, file_size_limit)
values ('edupi-materials', 'edupi-materials', false, 26214400)
on conflict (id) do update
set public = false,
    file_size_limit = excluded.file_size_limit;

alter table edupi.materials
  add column if not exists upload_verified_at timestamptz;

create table if not exists edupi.material_upload_receipts (
  workspace_id uuid not null references edupi.workspaces(id) on delete cascade,
  request_id text not null,
  material_id text not null,
  storage_bucket text not null default 'edupi-materials',
  storage_object_key text not null,
  source_hash text not null check (source_hash ~ '^sha256:[a-f0-9]{64}$'),
  size_bytes bigint not null check (size_bytes > 0 and size_bytes <= 26214400),
  verified_at timestamptz not null default now(),
  actor_id uuid not null references auth.users(id) on delete restrict,
  primary key (workspace_id, request_id),
  unique (workspace_id, storage_object_key)
);

alter table edupi.material_upload_receipts enable row level security;
revoke all on edupi.material_upload_receipts from public, anon, authenticated;
grant select on edupi.material_upload_receipts to service_role;
grant insert, update, select on edupi.material_upload_receipts to service_role;
