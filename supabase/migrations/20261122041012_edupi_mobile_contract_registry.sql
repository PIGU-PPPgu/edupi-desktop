insert into edupi.contract_versions (
  contract_id,
  contract_version,
  schema_hash,
  core_commit,
  supported_commands,
  supported_projections
)
values (
  'edupi-mobile-dashboard-v1',
  '1.0',
  'sha256:454a9b7b092faffd480b5e4c8380553279fe5d7102e9ca4b44cf9d599cd282d8',
  '3ce22b1e08804aa36dccf59d76a8e61b15f2c462',
  '[]'::jsonb,
  '["mobile_dashboard"]'::jsonb
)
on conflict (contract_id) do update set
  contract_version = excluded.contract_version,
  schema_hash = excluded.schema_hash,
  core_commit = excluded.core_commit,
  supported_commands = excluded.supported_commands,
  supported_projections = excluded.supported_projections,
  captured_at = now();
