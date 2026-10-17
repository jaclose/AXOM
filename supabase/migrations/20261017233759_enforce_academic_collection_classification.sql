-- A stable collection identity also binds its academic classification. Check
-- under the owner row lock before reserving sources or replaying a content hash.
create or replace function public.academic_create_revision(
  metadata jsonb,
  template text,
  provenance jsonb,
  files jsonb,
  content_hash text,
  collection uuid default null
) returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  cid uuid;
  rid uuid;
  file jsonb;
  total bigint;
  source_sha text;
  source_total integer;
  source_distinct integer;
  reserved_collection uuid;
  classification_matches boolean;
begin
  if auth.uid() is null then
    raise exception 'Sign in to upload material' using errcode = '42501';
  end if;
  if jsonb_typeof(files) <> 'array' or jsonb_array_length(files) not between 1 and 1500 then
    raise exception 'Invalid file manifest';
  end if;
  select sum((f->>'byte_size')::bigint) into total from jsonb_array_elements(files) f;
  if total > 536870912 then raise exception 'Collection exceeds 512 MiB'; end if;
  if collection is null then raise exception 'A stable upload identity is required'; end if;
  if jsonb_typeof(provenance->'sourceChecksums') <> 'array' then
    raise exception 'Verified source checksums are required';
  end if;
  if exists (
    select 1
    from jsonb_array_elements_text(provenance->'sourceChecksums') as source(value)
    where source.value !~ '^[a-f0-9]{64}$'
  ) then
    raise exception 'Invalid academic source checksum';
  end if;
  select count(*), count(distinct source.value)
  into source_total, source_distinct
  from jsonb_array_elements_text(provenance->'sourceChecksums') as source(value);
  if source_total <> source_distinct then
    raise exception 'Duplicate academic source checksum';
  end if;

  if not exists(select 1 from public.academic_collections where id = collection) then
    insert into public.academic_collections(id, owner_id, title, module, term, academic_term, cohort)
    values(collection, auth.uid(), metadata->>'title', metadata->>'module', metadata->>'term', metadata->>'academic_term', metadata->>'cohort')
    returning id into cid;
  else
    select id,
      term is not distinct from (metadata->>'term')
      and module is not distinct from (metadata->>'module')
      and academic_term is not distinct from (metadata->>'academic_term')
      and cohort is not distinct from (metadata->>'cohort')
    into cid, classification_matches
    from public.academic_collections
    where id = collection and owner_id = auth.uid()
    for update;
    if cid is null then
      raise exception 'Collection unavailable' using errcode = '42501';
    end if;
    if not classification_matches then
      raise exception 'Academic collection classification does not match';
    end if;
  end if;

  for source_sha in
    select source.value
    from jsonb_array_elements_text(provenance->'sourceChecksums') as source(value)
  loop
    reserved_collection := null;
    insert into public.academic_source_identities(owner_id, source_sha256, collection_id)
    values(auth.uid(), source_sha, cid)
    on conflict (owner_id, source_sha256) do update
      set collection_id = excluded.collection_id
      where academic_source_identities.collection_id = excluded.collection_id
    returning collection_id into reserved_collection;
    if reserved_collection is null then
      raise exception 'Academic source is already registered under another collection'
        using errcode = '23505', constraint = 'academic_source_identities_pkey';
    end if;
  end loop;

  select id into rid
  from public.academic_revisions as revision
  where revision.collection_id = cid
    and revision.content_hash = academic_create_revision.content_hash;
  if rid is not null then
    return jsonb_build_object('collection_id', cid, 'revision_id', rid);
  end if;

  insert into public.academic_revisions(
    collection_id,
    content_hash,
    source_revision,
    template_text,
    provenance,
    ready_questions,
    review_questions
  ) values (
    cid,
    content_hash,
    metadata->>'source_revision',
    template,
    provenance,
    coalesce((metadata->>'ready_questions')::integer, 0),
    coalesce((metadata->>'review_questions')::integer, 0)
  ) returning id into rid;

  for file in select * from jsonb_array_elements(files) loop
    insert into public.academic_files(revision_id, path, object_path, sha256, byte_size, mime_type)
    values(
      rid,
      file->>'path',
      cid::text || '/' || (file->>'sha256'),
      file->>'sha256',
      (file->>'byte_size')::bigint,
      file->>'mime_type'
    );
  end loop;
  if not exists(select 1 from public.academic_files where revision_id = rid and path = 'catalog.json') then
    raise exception 'Catalog missing';
  end if;
  return jsonb_build_object('collection_id', cid, 'revision_id', rid);
end;
$$;

revoke all on function public.academic_create_revision(jsonb, text, jsonb, jsonb, text, uuid)
from public, anon;
grant execute on function public.academic_create_revision(jsonb, text, jsonb, jsonb, text, uuid)
to authenticated;
