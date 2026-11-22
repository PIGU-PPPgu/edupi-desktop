do $$
declare definition text; original text;
begin
  definition:=pg_get_functiondef('edupi.cloud_entity_transition(uuid,uuid,jsonb)'::regprocedure);
  original:='from (select response,created_at from edupi.cloud_entity_receipts';
  if position(original in definition)=0 then raise exception 'entity_history_patch_source_changed'; end if;
  definition:=replace(definition,original,
    'from (select receipt.response,receipt.created_at from edupi.cloud_entity_receipts receipt');
  execute definition;
end $$;
