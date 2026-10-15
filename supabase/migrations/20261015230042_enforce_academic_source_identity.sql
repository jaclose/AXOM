-- One owner must not register the same source bytes under several catalog IDs.
-- The unique owner + SHA reservation is acquired inside revision creation, so
-- separate browser batches and concurrent requests share the same truth.
create table public.academic_source_identities (
  owner_id uuid not null references auth.users(id) on delete cascade,
  source_sha256 text not null check (source_sha256 ~ '^[a-f0-9]{64}$'),
  collection_id uuid not null references public.academic_collections(id) on delete cascade,
  first_seen_at timestamptz not null default now(),
  primary key (owner_id, source_sha256)
);

alter table public.academic_source_identities enable row level security;
revoke all on table public.academic_source_identities from public, anon, authenticated;
grant all on table public.academic_source_identities to service_role;

-- Refuse to hide an already-duplicated owner corpus behind a lossy backfill.
-- Such a project must reconcile the conflicting collections before applying
-- this migration.
do $$
begin
  if exists (
    select c.owner_id, source.value
    from public.academic_revisions as revision
    join public.academic_collections as c on c.id = revision.collection_id
    cross join lateral jsonb_array_elements_text(
      case
        when jsonb_typeof(revision.provenance->'sourceChecksums') = 'array'
          then revision.provenance->'sourceChecksums'
        else '[]'::jsonb
      end
    ) as source(value)
    where source.value ~ '^[a-f0-9]{64}$'
    group by c.owner_id, source.value
    having count(distinct revision.collection_id) > 1
  ) then
    raise exception 'Existing academic source identity is assigned to multiple owner collections';
  end if;
end
$$;

insert into public.academic_source_identities (owner_id, source_sha256, collection_id)
select distinct c.owner_id, source.value, revision.collection_id
from public.academic_revisions as revision
join public.academic_collections as c on c.id = revision.collection_id
cross join lateral jsonb_array_elements_text(
  case
    when jsonb_typeof(revision.provenance->'sourceChecksums') = 'array'
      then revision.provenance->'sourceChecksums'
    else '[]'::jsonb
  end
) as source(value)
where source.value ~ '^[a-f0-9]{64}$';

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
    select id into cid
    from public.academic_collections
    where id = collection and owner_id = auth.uid()
    for update;
    if cid is null then
      raise exception 'Collection unavailable' using errcode = '42501';
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
