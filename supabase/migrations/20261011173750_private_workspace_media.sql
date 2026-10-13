-- Additive cloud format v2. No existing workspace, source or image is removed.
-- The old atomic revision writer remains the concurrency/idempotency authority.
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('workspace-media', 'workspace-media', false, 8388608, array['image/png','image/jpeg','image/webp','image/gif']),
       ('workspace-content', 'workspace-content', false, 8388608, array['text/plain'])
on conflict (id) do nothing;

create policy workspace_object_read on storage.objects for select to authenticated
using (bucket_id in ('workspace-media','workspace-content') and name ~ ('^' || (select auth.uid())::text || '/[a-f0-9]{64}$'));
create policy workspace_object_insert on storage.objects for insert to authenticated
with check (bucket_id in ('workspace-media','workspace-content') and name ~ ('^' || (select auth.uid())::text || '/[a-f0-9]{64}$'));
-- Immutable objects: no update/upsert. Explicit account deletion uses the Storage
-- API under this owner-only policy, so physical files are removed as well.
create policy workspace_object_delete on storage.objects for delete to authenticated
using (bucket_id in ('workspace-media','workspace-content') and name ~ ('^' || (select auth.uid())::text || '/[a-f0-9]{64}$'));

create schema if not exists axom_private;
revoke all on schema axom_private from public, anon;
grant usage on schema axom_private to authenticated, service_role;
alter function public.push_workspace_revision(bigint,integer,text,jsonb,uuid,uuid,text) set schema axom_private;
revoke all on function axom_private.push_workspace_revision(bigint,integer,text,jsonb,uuid,uuid,text) from public, anon;
grant execute on function axom_private.push_workspace_revision(bigint,integer,text,jsonb,uuid,uuid,text) to authenticated, service_role;

create function public.push_workspace_revision(
  p_base_revision bigint, p_schema_version integer, p_content_hash text, p_snapshot_payload jsonb,
  p_device_id uuid, p_idempotency_key uuid, p_reason text default 'automatic'
) returns jsonb language plpgsql security invoker set search_path = pg_catalog, public, pg_temp as $$
begin
  if auth.uid() is null then raise exception 'authentication required' using errcode='42501'; end if;
  if p_snapshot_payload ? '_axomCloudFormat' or exists (
    select 1 from public.workspace_revisions where user_id=auth.uid() and snapshot_payload->>'_axomCloudFormat'='2'
  ) then
    raise exception 'Update AXOM before syncing this account. Its source files use cloud format v2.' using errcode='PT409';
  end if;
  return axom_private.push_workspace_revision(p_base_revision,p_schema_version,p_content_hash,p_snapshot_payload,p_device_id,p_idempotency_key,p_reason);
end $$;
revoke all on function public.push_workspace_revision(bigint,integer,text,jsonb,uuid,uuid,text) from public, anon;
grant execute on function public.push_workspace_revision(bigint,integer,text,jsonb,uuid,uuid,text) to authenticated, service_role;

create function public.push_workspace_revision_v2(
  p_base_revision bigint, p_schema_version integer, p_content_hash text, p_snapshot_payload jsonb,
  p_device_id uuid, p_idempotency_key uuid, p_reason text default 'automatic'
) returns jsonb language plpgsql security invoker set search_path = pg_catalog, public, pg_temp as $$
declare
  entry jsonb;
  object_size bigint;
  byte_count bigint;
  expanded bigint := 0;
  total_media bigint := 0;
  media_keys text[] := '{}';
  source_keys text[] := '{}';
  object_hashes text[] := '{}';
  item_key text;
begin
  if auth.uid() is null then raise exception 'authentication required' using errcode='42501'; end if;
  if p_snapshot_payload is null or p_snapshot_payload->>'_axomCloudFormat' is distinct from '2'
     or jsonb_typeof(p_snapshot_payload->'content') is distinct from 'string'
     or jsonb_typeof(p_snapshot_payload->'media') is distinct from 'array'
     or jsonb_typeof(p_snapshot_payload->'sources') is distinct from 'array'
     or jsonb_typeof(p_snapshot_payload->'expandedBytes') is distinct from 'number'
     or (p_snapshot_payload->>'expandedBytes')::numeric not between 0 and 268435456
  then raise exception 'invalid cloud snapshot' using errcode='PT400'; end if;
  if octet_length(p_snapshot_payload::text)>15000000 or jsonb_array_length(p_snapshot_payload->'media')>20000
     or jsonb_array_length(p_snapshot_payload->'sources')>30000 then
    raise exception 'snapshot payload too large' using errcode='PT413';
  end if;
  for entry in select value from jsonb_array_elements(p_snapshot_payload->'media') loop
    item_key := entry->>'blobKey';
    if item_key is null or length(item_key) not between 1 and 1024 or item_key=any(media_keys)
       or coalesce(entry->>'hash','') !~ '^[a-f0-9]{64}$'
       or jsonb_typeof(entry->'byteSize') is distinct from 'number'
       or (entry->>'byteSize')::numeric not between 1 and 8388608
       or entry->>'updatedAt' is null then raise exception 'invalid image reference' using errcode='PT400'; end if;
    byte_count := (entry->>'byteSize')::bigint;
    media_keys := array_append(media_keys,item_key);
    if not (entry->>'hash'=any(object_hashes)) then
      total_media := total_media+byte_count;
      object_hashes := array_append(object_hashes,entry->>'hash');
    end if;
    select (metadata->>'size')::bigint into object_size from storage.objects
      where bucket_id='workspace-media' and name=auth.uid()::text||'/'||(entry->>'hash');
    if object_size is distinct from byte_count then raise exception 'question image upload is incomplete' using errcode='PT409'; end if;
  end loop;
  if total_media>2147483648 then raise exception 'image library exceeds limit' using errcode='PT413'; end if;
  for entry in select value from jsonb_array_elements(p_snapshot_payload->'sources') loop
    item_key := (entry->>'collection')||':'||(entry->>'id');
    if item_key is null or length(item_key) not between 1 and 1024 or item_key=any(source_keys)
       or coalesce(entry->>'collection','') not in ('documents','questions')
       or coalesce(entry->>'hash','') !~ '^[a-f0-9]{64}$'
       or jsonb_typeof(entry->'byteSize') is distinct from 'number'
       or (entry->>'byteSize')::numeric not between 1 and 8388608
       or jsonb_typeof(entry->'expandedBytes') is distinct from 'number'
       or (entry->>'expandedBytes')::numeric not between 0 and 268435456
    then raise exception 'invalid source reference' using errcode='PT400'; end if;
    source_keys := array_append(source_keys,item_key);
    expanded := expanded+(entry->>'expandedBytes')::bigint;
    select (metadata->>'size')::bigint into object_size from storage.objects
      where bucket_id='workspace-content' and name=auth.uid()::text||'/'||(entry->>'hash');
    if object_size is distinct from (entry->>'byteSize')::bigint then raise exception 'source upload is incomplete' using errcode='PT409'; end if;
  end loop;
  if expanded>268435456 then raise exception 'source library exceeds restore limit' using errcode='PT413'; end if;
  return axom_private.push_workspace_revision(p_base_revision,p_schema_version,p_content_hash,p_snapshot_payload,p_device_id,p_idempotency_key,p_reason);
end $$;
revoke all on function public.push_workspace_revision_v2(bigint,integer,text,jsonb,uuid,uuid,text) from public, anon;
grant execute on function public.push_workspace_revision_v2(bigint,integer,text,jsonb,uuid,uuid,text) to authenticated, service_role;
