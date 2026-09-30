-- Preserve conflict payloads, but bound aggregate storage. The workspace row
-- is already locked for this user inside push_workspace_revision, so concurrent
-- uploads cannot race the quota check.
create or replace function public.push_workspace_revision(
  p_base_revision bigint,p_schema_version integer,p_content_hash text,p_snapshot_payload jsonb,p_device_id uuid,p_idempotency_key uuid,p_reason text default 'automatic'
) returns jsonb language plpgsql security definer set search_path=pg_catalog, public, pg_temp as $$
declare w public.workspaces; r public.workspace_revisions; v_conflicts bigint; v_conflict_bytes bigint; v_canonical_bytes bigint; v_resolved_ids uuid[];
begin
  if auth.uid() is null then raise exception 'authentication required' using errcode='42501'; end if;
  if p_schema_version<1 or p_schema_version>10000 or p_content_hash !~ '^[0-9a-f]{64}$' then raise exception 'invalid snapshot metadata'; end if;
  if octet_length(p_snapshot_payload::text)>15000000 then raise exception 'snapshot payload too large'; end if;
  if p_reason not in ('foundation','automatic','manual','pre_restore','restore') then raise exception 'invalid revision reason'; end if;
  insert into public.workspaces(user_id) values(auth.uid()) on conflict(user_id) do nothing;
  select * into w from public.workspaces where user_id=auth.uid() for update;
  select * into r from public.workspace_revisions where user_id=auth.uid() and idempotency_key=p_idempotency_key;
  if found then return jsonb_build_object('status','accepted','revision',r.revision,'revision_id',r.id,'idempotent',true); end if;
  if w.current_revision<>p_base_revision then
    select count(*),coalesce(sum(octet_length(revision_row.snapshot_payload::text)),0)
      into v_conflicts,v_conflict_bytes
      from public.workspace_revisions revision_row
      join public.sync_conflicts conflict_row on conflict_row.preserved_revision_id=revision_row.id
      where revision_row.user_id=auth.uid() and revision_row.reason='conflict' and conflict_row.resolved_at is null;
    if v_conflicts>=20 or v_conflict_bytes+octet_length(p_snapshot_payload::text)>50000000 then
      raise exception 'conflict storage limit reached; resolve existing conflicts before syncing' using errcode='54000';
    end if;
    insert into public.workspace_revisions(workspace_id,user_id,revision,base_revision,schema_version,content_hash,snapshot_payload,device_id,idempotency_key,reason)
      values(w.id,auth.uid(),p_base_revision,p_base_revision,p_schema_version,p_content_hash,p_snapshot_payload,p_device_id,p_idempotency_key,'conflict') returning * into r;
    insert into public.sync_conflicts(workspace_id,user_id,attempted_base_revision,server_revision,preserved_revision_id) values(w.id,auth.uid(),p_base_revision,w.current_revision,r.id);
    return jsonb_build_object('status','conflict','server_revision',w.current_revision,'preserved_revision_id',r.id);
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
  select coalesce(sum(octet_length(retained.snapshot_payload::text)),0)
    into v_canonical_bytes
    from (
      select snapshot_payload
      from public.workspace_revisions
      where workspace_id=w.id and reason<>'conflict'
      order by revision desc
      limit 59
    ) retained;
  if v_canonical_bytes+octet_length(p_snapshot_payload::text)>50000000 then
    raise exception 'workspace snapshot storage limit reached; reduce the snapshot size before syncing' using errcode='54000';
  end if;
  insert into public.workspace_revisions(workspace_id,user_id,revision,base_revision,schema_version,content_hash,snapshot_payload,device_id,idempotency_key,reason)
    values(w.id,auth.uid(),w.current_revision+1,p_base_revision,p_schema_version,p_content_hash,p_snapshot_payload,p_device_id,p_idempotency_key,p_reason) returning * into r;
  update public.workspaces set current_revision=r.revision,current_hash=p_content_hash,updated_at=now() where id=w.id;
  delete from public.workspace_revisions where id in (select id from public.workspace_revisions where workspace_id=w.id and reason<>'conflict' order by revision desc offset 60);
  return jsonb_build_object('status','accepted','revision',r.revision,'revision_id',r.id,'idempotent',false);
end $$;
revoke all on function public.push_workspace_revision(bigint,integer,text,jsonb,uuid,uuid,text) from public, anon;
grant execute on function public.push_workspace_revision(bigint,integer,text,jsonb,uuid,uuid,text) to authenticated;

-- Serialize share creation per owner and enforce both count and aggregate
-- payload limits. Existing shares are not silently deleted.
create or replace function public.create_question_set_share(p_source_id text,p_snapshot jsonb) returns jsonb
language plpgsql security definer set search_path=pg_catalog, public, pg_temp as $$
declare row public.question_set_shares; v_count bigint; v_bytes bigint;
begin
 if auth.uid() is null then raise exception 'authentication required' using errcode='42501'; end if;
 if octet_length(p_snapshot::text)>5000000 then raise exception 'share payload too large'; end if;
 if coalesce((p_snapshot->>'shareFormatVersion')::integer,0)<>1 or jsonb_typeof(p_snapshot->'questions')<>'array' then raise exception 'invalid share format'; end if;
 perform pg_advisory_xact_lock(hashtextextended(auth.uid()::text,0));
 select count(*),coalesce(sum(octet_length(snapshot_payload::text)),0) into v_count,v_bytes
  from public.question_set_shares where owner_user_id=auth.uid() and revoked_at is null;
 if v_count>=20 or v_bytes+octet_length(p_snapshot::text)>25000000 then
   raise exception 'share storage limit reached; revoke unused shares before creating another' using errcode='54000';
 end if;
 insert into public.question_set_shares(owner_user_id,source_question_set_id,title,question_count,share_format_version,snapshot_payload)
 values(auth.uid(),left(p_source_id,200),left(p_snapshot->>'title',200),jsonb_array_length(p_snapshot->'questions'),1,p_snapshot) returning * into row;
 return jsonb_build_object('id',row.id,'share_token',row.share_token);
end $$;
revoke all on function public.create_question_set_share(text,jsonb) from public, anon;
grant execute on function public.create_question_set_share(text,jsonb) to authenticated;

create or replace function public.revoke_question_set_share(p_share_id uuid) returns void
language plpgsql security definer set search_path=pg_catalog, public, pg_temp as $$
begin
 if auth.uid() is null then raise exception 'authentication required' using errcode='42501'; end if;
 update public.question_set_shares
 set revoked_at=coalesce(revoked_at,now()),title='Revoked',question_count=0,
   snapshot_payload='{"shareFormatVersion":1,"title":"Revoked","questions":[]}'::jsonb
 where id=p_share_id and owner_user_id=auth.uid();
 if not found then raise exception 'share not found' using errcode='P0002'; end if;
end $$;
revoke all on function public.revoke_question_set_share(uuid) from public, anon;
grant execute on function public.revoke_question_set_share(uuid) to authenticated;

revoke update on table public.question_set_shares from anon, authenticated;
