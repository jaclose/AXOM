-- Validate reference sets in a bounded number of statements. The previous
-- wrapper issued an RLS-protected Storage query for every source and image,
-- exhausting the request timeout for otherwise complete large workspaces.
-- Keep the invoker boundary, acknowledged-history exceptions and atomic writer.
create or replace function public.push_workspace_revision_v2(
  p_base_revision bigint, p_schema_version integer, p_content_hash text, p_snapshot_payload jsonb,
  p_device_id uuid, p_idempotency_key uuid, p_reason text default 'automatic'
) returns jsonb language plpgsql security invoker set search_path = pg_catalog, public, pg_temp as $$
declare
  account_id uuid := auth.uid();
  prior jsonb;
  total_media numeric;
  expanded numeric;
begin
  if account_id is null then raise exception 'authentication required' using errcode='42501'; end if;
  if p_snapshot_payload is null or p_snapshot_payload->>'_axomCloudFormat' is distinct from '2'
     or jsonb_typeof(p_snapshot_payload->'content') is distinct from 'string'
     or jsonb_typeof(p_snapshot_payload->'media') is distinct from 'array'
     or jsonb_typeof(p_snapshot_payload->'sources') is distinct from 'array'
     or (case when jsonb_typeof(p_snapshot_payload->'expandedBytes') = 'number'
       then (p_snapshot_payload->>'expandedBytes')::numeric not between 0 and 268435456 else true end)
  then raise exception 'invalid cloud snapshot' using errcode='PT400'; end if;
  if octet_length(p_snapshot_payload::text)>15000000 or jsonb_array_length(p_snapshot_payload->'media')>20000
     or jsonb_array_length(p_snapshot_payload->'sources')>30000 then
    raise exception 'snapshot payload too large' using errcode='PT413';
  end if;

  -- An acknowledged retry remains valid after base retention or academic
  -- withdrawal. Only the existing atomic writer may resolve that receipt.
  if exists(select 1 from public.workspace_revisions where user_id=account_id and idempotency_key=p_idempotency_key) then
    return axom_private.push_workspace_revision(p_base_revision,p_schema_version,p_content_hash,p_snapshot_payload,p_device_id,p_idempotency_key,p_reason);
  end if;
  select snapshot_payload into prior from public.workspace_revisions
    where user_id=account_id and revision=p_base_revision and reason<>'conflict';

  if exists (
    select 1 from jsonb_array_elements(p_snapshot_payload->'media') as refs(entry)
    where entry->>'blobKey' is null or length(entry->>'blobKey') not between 1 and 1024
      or coalesce(entry->>'hash','') !~ '^[a-f0-9]{64}$'
      or case when jsonb_typeof(entry->'byteSize') = 'number'
        then (entry->>'byteSize')::numeric not between 1 and 8388608 else true end
      or entry->>'updatedAt' is null
  ) or exists (
    select 1 from jsonb_array_elements(p_snapshot_payload->'media') as refs(entry)
    group by entry->>'blobKey' having count(*)>1
  ) then raise exception 'invalid image reference' using errcode='PT400'; end if;

  if exists (
    select 1 from jsonb_array_elements(p_snapshot_payload->'media') as refs(entry)
    where entry ? 'academic' and (
      coalesce(entry->'academic'->>'revisionId','') !~* '^[a-f0-9-]{36}$'
      or entry->'academic'->>'sha256' is distinct from entry->>'hash'
      or coalesce(entry->'academic'->>'path','')=''
    )
  ) then raise exception 'invalid academic image reference' using errcode='PT400'; end if;

  -- Deduplicate identical object requirements, never conflicting byte claims.
  -- Joining by the authenticated owner path keeps every check under normal RLS.
  -- RLS can underestimate visible rows. Bound each path lookup to the existing
  -- unique index instead of allowing a nested rescan of the whole bucket.
  -- Materialize raw matched metadata before casting any size claims.
  if exists (
    with required as materialized (
      select distinct entry->>'hash' as hash, (entry->>'byteSize')::bigint as bytes
      from jsonb_array_elements(p_snapshot_payload->'media') as refs(entry)
      where not (entry ? 'academic')
    ), resolved as materialized (
      select r.bytes,o.id,o.metadata from required r left join lateral (
        select id,metadata from storage.objects
        where bucket_id='workspace-media' and name=account_id::text||'/'||r.hash limit 1
      ) o on true
    )
    select 1 from resolved where id is null or (metadata->>'size')::bigint is distinct from bytes
  ) then raise exception 'question image upload is incomplete' using errcode='PT409'; end if;

  if exists (
    with acknowledged as materialized (
      select entry from jsonb_array_elements(case when jsonb_typeof(prior->'media')='array' then prior->'media' else '[]'::jsonb end) as refs(entry)
    ), required as materialized (
      select distinct (r.entry->'academic'->>'revisionId')::uuid as revision_id,
        r.entry->'academic'->>'path' as path, r.entry->>'hash' as hash,
        (r.entry->>'byteSize')::bigint as bytes
      from jsonb_array_elements(p_snapshot_payload->'media') as r(entry)
      left join acknowledged a on a.entry->>'blobKey'=r.entry->>'blobKey' and a.entry @> r.entry
      where r.entry ? 'academic' and a.entry is null
    ), resolved as materialized (
      select f.revision_id as file_revision,v.id as ready_revision,f.byte_size,o.id as object_id,o.metadata
      from required r left join public.academic_files f on f.revision_id=r.revision_id
        and f.path=r.path and f.sha256=r.hash and f.byte_size=r.bytes and f.mime_type like 'image/%'
      left join public.academic_revisions v on v.id=f.revision_id and v.status='ready'
      left join storage.objects o on v.id is not null and o.bucket_id='academic-content' and o.name=f.object_path
    )
    select 1 from resolved where file_revision is null or ready_revision is null or object_id is null
      or (metadata->>'size')::bigint is distinct from byte_size
  ) then raise exception 'academic image is unavailable or incomplete' using errcode='PT409'; end if;

  -- Quota counts unique bytes by hash in first-reference order, as before.
  select coalesce(sum(bytes),0) into total_media from (
    select distinct on (entry->>'hash') (entry->>'byteSize')::bigint as bytes
    from jsonb_array_elements(p_snapshot_payload->'media') with ordinality as refs(entry,ordinal)
    order by entry->>'hash',ordinal
  ) as unique_objects;
  if total_media>2147483648 then raise exception 'image library exceeds limit' using errcode='PT413'; end if;

  if exists (
    select 1 from jsonb_array_elements(p_snapshot_payload->'sources') as refs(entry)
    where (entry->>'collection')||':'||(entry->>'id') is null
      or length((entry->>'collection')||':'||(entry->>'id')) not between 1 and 1024
      or coalesce(entry->>'collection','') not in ('documents','questions')
      or coalesce(entry->>'hash','') !~ '^[a-f0-9]{64}$'
      or case when jsonb_typeof(entry->'byteSize') = 'number'
        then (entry->>'byteSize')::numeric not between 1 and 8388608 else true end
      or case when jsonb_typeof(entry->'expandedBytes') = 'number'
        then (entry->>'expandedBytes')::numeric not between 0 and 268435456 else true end
  ) or exists (
    select 1 from jsonb_array_elements(p_snapshot_payload->'sources') as refs(entry)
    group by (entry->>'collection')||':'||(entry->>'id') having count(*)>1
  ) then raise exception 'invalid source reference' using errcode='PT400'; end if;

  if exists (
    select 1 from jsonb_array_elements(p_snapshot_payload->'sources') as refs(entry)
    where entry ? 'academic' and (
      coalesce(entry->'academic'->>'revisionId','') !~* '^[a-f0-9-]{36}$'
      or coalesce(entry->'academic'->>'sha256','') !~ '^[a-f0-9]{64}$'
      or entry->'academic'->>'adapterVersion' is distinct from '1'
      or coalesce(entry->'academic'->>'kind','') not in ('question','document','review')
      or coalesce(entry->'academic'->>'path','')=''
    )
  ) then raise exception 'invalid academic source reference' using errcode='PT400'; end if;

  if exists (
    with required as materialized (
      select distinct entry->>'hash' as hash, (entry->>'byteSize')::bigint as bytes
      from jsonb_array_elements(p_snapshot_payload->'sources') as refs(entry)
      where not (entry ? 'academic')
    ), resolved as materialized (
      select r.bytes,o.id,o.metadata from required r left join lateral (
        select id,metadata from storage.objects
        where bucket_id='workspace-content' and name=account_id::text||'/'||r.hash limit 1
      ) o on true
    )
    select 1 from resolved where id is null or (metadata->>'size')::bigint is distinct from bytes
  ) then raise exception 'source upload is incomplete' using errcode='PT409'; end if;

  if exists (
    with acknowledged as materialized (
      select entry from jsonb_array_elements(case when jsonb_typeof(prior->'sources')='array' then prior->'sources' else '[]'::jsonb end) as refs(entry)
    ), required as materialized (
      select distinct (r.entry->'academic'->>'revisionId')::uuid as revision_id,
        r.entry->'academic'->>'path' as path, r.entry->'academic'->>'sha256' as hash
      from jsonb_array_elements(p_snapshot_payload->'sources') as r(entry)
      left join acknowledged a on a.entry->>'collection'=r.entry->>'collection'
        and a.entry->>'id'=r.entry->>'id' and a.entry @> r.entry
      where r.entry ? 'academic' and a.entry is null
    ), resolved as materialized (
      select f.revision_id as file_revision,v.id as ready_revision,f.byte_size,o.id as object_id,o.metadata
      from required r left join public.academic_files f on f.revision_id=r.revision_id and f.path=r.path and f.sha256=r.hash
      left join public.academic_revisions v on v.id=f.revision_id and v.status='ready'
      left join storage.objects o on v.id is not null and o.bucket_id='academic-content' and o.name=f.object_path
    )
    select 1 from resolved where file_revision is null or ready_revision is null or object_id is null
      or (metadata->>'size')::bigint is distinct from byte_size
  ) then raise exception 'academic source is unavailable or incomplete' using errcode='PT409'; end if;

  select coalesce(sum((entry->>'expandedBytes')::bigint),0) into expanded
    from jsonb_array_elements(p_snapshot_payload->'sources') as refs(entry);
  if expanded>268435456 then raise exception 'source library exceeds restore limit' using errcode='PT413'; end if;
  return axom_private.push_workspace_revision(p_base_revision,p_schema_version,p_content_hash,p_snapshot_payload,p_device_id,p_idempotency_key,p_reason);
end $$;
revoke all on function public.push_workspace_revision_v2(bigint,integer,text,jsonb,uuid,uuid,text) from public, anon;
grant execute on function public.push_workspace_revision_v2(bigint,integer,text,jsonb,uuid,uuid,text) to authenticated, service_role;
