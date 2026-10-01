-- Keep account protection working for large workspaces.
--
-- 20260928130000 bounded canonical history at 50 MB by refusing every new
-- revision once the newest 59 passed the cap. The refusal was raised as
-- SQLSTATE 54000, which PostgREST reports as HTTP 500, and the cap was measured
-- by converting every retained snapshot to text on each call. A workspace of
-- about 8 MB reached the cap after six revisions and could never be protected
-- again, while clients kept re-uploading the same snapshot.
--
-- The bound stays; how it is enforced changes:
--   * Canonical history is pruned oldest-first to fit the budget (the original
--     retention behaviour) instead of refusing the newest snapshot. The newest
--     three revisions are always kept.
--   * Size is read from the stored value (pg_column_size on the column reads
--     the TOAST pointer), so no retained snapshot is detoasted or converted.
--   * At the conflict limit the caller still learns it is in conflict; the
--     server simply does not store another copy (the device keeps its own).
--   * An oversized snapshot is refused with HTTP 413 rather than 400.
--   * A retry whose first attempt was preserved as a conflict is reported as a
--     conflict, not as accepted, and an idempotent replay returns the stored
--     hash so a client can tell when its newer content still needs uploading.
--
-- Result shapes stay 'accepted' | 'conflict', so already-deployed clients keep
-- working. Safe to run more than once.
create or replace function public.push_workspace_revision(
  p_base_revision bigint,p_schema_version integer,p_content_hash text,p_snapshot_payload jsonb,p_device_id uuid,p_idempotency_key uuid,p_reason text default 'automatic'
) returns jsonb language plpgsql security definer set search_path=pg_catalog, public, pg_temp as $$
declare
  c_history_budget constant bigint := 50000000; -- stored bytes of canonical history per account
  c_conflict_budget constant bigint := 50000000; -- stored bytes of unresolved conflict copies per account
  c_conflict_limit constant integer := 20;
  c_keep_max constant integer := 60;
  c_keep_min constant integer := 3;
  w public.workspaces;
  v_id uuid; v_revision bigint; v_reason text; v_hash text;
  v_conflicts bigint; v_conflict_bytes bigint; v_resolved_ids uuid[];
begin
  if auth.uid() is null then raise exception 'authentication required' using errcode='42501'; end if;
  if p_base_revision is null or p_base_revision<0 or p_device_id is null or p_idempotency_key is null or p_snapshot_payload is null
    or p_schema_version is null or p_schema_version<1 or p_schema_version>10000
    or p_content_hash is null or p_content_hash !~ '^[0-9a-f]{64}$' then
    raise exception 'invalid snapshot metadata';
  end if;
  if octet_length(p_snapshot_payload::text)>15000000 then raise exception 'snapshot payload too large' using errcode='PT413'; end if;
  if p_reason is null or p_reason not in ('foundation','automatic','manual','pre_restore','restore') then raise exception 'invalid revision reason'; end if;
  insert into public.workspaces(user_id) values(auth.uid()) on conflict(user_id) do nothing;
  select * into w from public.workspaces where user_id=auth.uid() for update;
  select id,revision,reason,content_hash into v_id,v_revision,v_reason,v_hash
    from public.workspace_revisions where user_id=auth.uid() and idempotency_key=p_idempotency_key;
  if found then
    if v_reason='conflict' then
      return jsonb_build_object('status','conflict','server_revision',w.current_revision,'preserved_revision_id',v_id,'preserved',true);
    end if;
    return jsonb_build_object('status','accepted','revision',v_revision,'revision_id',v_id,'idempotent',true,'content_hash',v_hash);
  end if;
  if w.current_revision<>p_base_revision then
    select count(*),coalesce(sum(pg_column_size(revision_row.snapshot_payload)),0)
      into v_conflicts,v_conflict_bytes
      from public.workspace_revisions revision_row
      join public.sync_conflicts conflict_row on conflict_row.preserved_revision_id=revision_row.id
      where revision_row.user_id=auth.uid() and revision_row.reason='conflict' and conflict_row.resolved_at is null;
    if v_conflicts>=c_conflict_limit or v_conflict_bytes+pg_column_size(p_snapshot_payload)>c_conflict_budget then
      return jsonb_build_object('status','conflict','server_revision',w.current_revision,'preserved_revision_id',null,'preserved',false);
    end if;
    insert into public.workspace_revisions(workspace_id,user_id,revision,base_revision,schema_version,content_hash,snapshot_payload,device_id,idempotency_key,reason)
      values(w.id,auth.uid(),p_base_revision,p_base_revision,p_schema_version,p_content_hash,p_snapshot_payload,p_device_id,p_idempotency_key,'conflict') returning id into v_id;
    insert into public.sync_conflicts(workspace_id,user_id,attempted_base_revision,server_revision,preserved_revision_id) values(w.id,auth.uid(),p_base_revision,w.current_revision,v_id);
    return jsonb_build_object('status','conflict','server_revision',w.current_revision,'preserved_revision_id',v_id,'preserved',true);
  end if;
  if p_reason in ('manual','restore') then
    select array_agg(preserved_revision_id) into v_resolved_ids
      from public.sync_conflicts
      where user_id=auth.uid() and resolved_at is null and server_revision<=w.current_revision;
    update public.sync_conflicts
      set resolved_at=now(),preserved_revision_id=null
      where user_id=auth.uid() and resolved_at is null and server_revision<=w.current_revision;
    delete from public.workspace_revisions
      where id=any(coalesce(v_resolved_ids, array[]::uuid[])) and reason='conflict' and user_id=auth.uid();
  end if;
  insert into public.workspace_revisions(workspace_id,user_id,revision,base_revision,schema_version,content_hash,snapshot_payload,device_id,idempotency_key,reason)
    values(w.id,auth.uid(),w.current_revision+1,p_base_revision,p_schema_version,p_content_hash,p_snapshot_payload,p_device_id,p_idempotency_key,p_reason)
    returning id,revision into v_id,v_revision;
  update public.workspaces set current_revision=v_revision,current_hash=p_content_hash,updated_at=now() where id=w.id;
  delete from public.workspace_revisions where id in (
    select history.id from (
      select revision_row.id,
        row_number() over newest_first as position,
        sum(pg_column_size(revision_row.snapshot_payload)) over newest_first as stored_bytes
      from public.workspace_revisions revision_row
      where revision_row.workspace_id=w.id and revision_row.reason<>'conflict'
      window newest_first as (order by revision_row.revision desc)
    ) history
    where history.position>c_keep_max or (history.position>c_keep_min and history.stored_bytes>c_history_budget)
  );
  return jsonb_build_object('status','accepted','revision',v_revision,'revision_id',v_id,'idempotent',false);
end $$;
revoke all on function public.push_workspace_revision(bigint,integer,text,jsonb,uuid,uuid,text) from public, anon;
grant execute on function public.push_workspace_revision(bigint,integer,text,jsonb,uuid,uuid,text) to authenticated;
