-- Publication is a separate, immutable projection of a private academic
-- revision. Source/audit files remain in the owner's private revision and are
-- never made readable merely because a release exists.

alter table public.academic_collections
  add column collection_mode text not null default 'standard'
    check (collection_mode in ('standard', 'moderation'));

alter table public.academic_collections
  add constraint academic_moderation_stays_unfiled_private
  check (collection_mode <> 'moderation' or (
    visibility = 'private' and group_id is null
    and term = 'Term 0' and module = 'Unfiled'
  ));

create table public.academic_release_attestations (
  revision_id uuid primary key references public.academic_revisions on delete cascade,
  owner_id uuid not null references auth.users on delete cascade,
  profile_key text not null check (profile_key ~ '^[a-z0-9][a-z0-9._-]{0,63}$'),
  content_kind text not null check (content_kind in ('course','question-bank','mixed')),
  classification jsonb not null default '{}'::jsonb
    check (jsonb_typeof(classification) = 'object' and octet_length(classification::text) <= 4096),
  rights_status text not null check (rights_status in ('pending','verified','rejected')),
  license_evidence_sha256 text check (license_evidence_sha256 ~ '^[a-f0-9]{64}$'),
  publisher_opt_in boolean not null default false,
  held_questions integer not null default 0 check (held_questions between 0 and 100000),
  projection_hash text not null check (projection_hash ~ '^[a-f0-9]{64}$'),
  status text not null default 'staging' check (status in ('staging','ready')),
  attested_at timestamptz not null default now()
);

create table public.academic_release_candidate_files (
  revision_id uuid not null references public.academic_release_attestations on delete cascade,
  path text not null check (
    length(path) between 1 and 500
    and path !~ '(^/|\\|(^|/)\.\.(/|$)|(^|/)\.(/|$))'
    and (path = 'catalog.json' or path ~ '^(templates|banks)/')
    and path !~* '(^|/)(audit|audits|original|originals|private|recovery|reference|references|source|sources)(/|$)'
  ),
  object_path text not null,
  sha256 text not null check (sha256 ~ '^[a-f0-9]{64}$'),
  byte_size bigint not null check (byte_size between 1 and 52428800),
  mime_type text not null check (mime_type in (
    'application/json','text/plain','image/png','image/jpeg','image/webp','image/gif'
  )),
  primary key(revision_id, path)
);

create table public.academic_releases (
  id uuid primary key default gen_random_uuid(),
  collection_id uuid not null references public.academic_collections on delete cascade,
  source_revision_id uuid not null references public.academic_revisions on delete cascade,
  profile_key text not null check (profile_key ~ '^[a-z0-9][a-z0-9._-]{0,63}$'),
  content_kind text not null check (content_kind in ('course','question-bank','mixed')),
  classification jsonb not null
    check (jsonb_typeof(classification) = 'object' and octet_length(classification::text) <= 4096),
  title text not null check (length(title) between 1 and 180),
  module text not null check (length(module) between 1 and 80),
  term text not null check (length(term) between 1 and 80),
  academic_term text check (length(academic_term) <= 80),
  cohort text check (length(cohort) <= 80),
  template_text text not null check (octet_length(template_text) <= 262144),
  ready_questions integer not null check (ready_questions between 0 and 100000),
  review_questions integer not null check (review_questions = 0),
  held_questions integer not null check (held_questions = 0),
  rights_status text not null check (rights_status = 'verified'),
  license_evidence_sha256 text not null check (license_evidence_sha256 ~ '^[a-f0-9]{64}$'),
  publisher_opt_in boolean not null check (publisher_opt_in),
  projection_hash text not null check (projection_hash ~ '^[a-f0-9]{64}$'),
  approved_at timestamptz not null,
  published_at timestamptz not null default now(),
  unique(source_revision_id)
);

create index academic_release_catalog_page
  on public.academic_releases(profile_key, term, collection_id, published_at desc);

create table public.academic_release_files (
  release_id uuid not null references public.academic_releases on delete cascade,
  path text not null check (
    length(path) between 1 and 500
    and path !~ '(^/|\\|(^|/)\.\.(/|$)|(^|/)\.(/|$))'
    and (path = 'catalog.json' or path ~ '^(templates|banks)/')
    and path !~* '(^|/)(audit|audits|original|originals|private|recovery|reference|references|source|sources)(/|$)'
  ),
  object_path text not null,
  sha256 text not null check (sha256 ~ '^[a-f0-9]{64}$'),
  byte_size bigint not null check (byte_size between 1 and 52428800),
  mime_type text not null check (mime_type in (
    'application/json','text/plain','image/png','image/jpeg','image/webp','image/gif'
  )),
  primary key(release_id, path)
);

create index academic_release_candidate_object
  on public.academic_release_candidate_files(object_path);
create index academic_release_file_object
  on public.academic_release_files(object_path);

alter table public.academic_release_attestations enable row level security;
alter table public.academic_release_candidate_files enable row level security;
alter table public.academic_releases enable row level security;
alter table public.academic_release_files enable row level security;

revoke all on public.academic_release_attestations, public.academic_release_candidate_files, public.academic_releases,
  public.academic_release_files from anon, authenticated;
grant all on public.academic_release_attestations, public.academic_release_candidate_files, public.academic_releases,
  public.academic_release_files to service_role;

create function axom_private.reject_academic_release_mutation() returns trigger
language plpgsql set search_path = '' as $$
begin
  -- Cascading owner/account deletion is the final privacy boundary. Direct
  -- operator/client mutation remains forbidden.
  if tg_op = 'DELETE' and pg_trigger_depth() > 1 then return old; end if;
  raise exception 'Published academic releases are immutable' using errcode = '55000';
end;
$$;
revoke all on function axom_private.reject_academic_release_mutation() from public, anon, authenticated;

create trigger academic_release_immutable
before update or delete on public.academic_releases
for each row execute function axom_private.reject_academic_release_mutation();
create trigger academic_release_file_immutable
before update or delete on public.academic_release_files
for each row execute function axom_private.reject_academic_release_mutation();

create function public.academic_attest_release(
  revision uuid,
  profile_key text,
  content_kind text,
  classification jsonb,
  rights_status text,
  license_evidence_sha256 text,
  publisher_opt_in boolean,
  held_questions integer,
  projection_hash text,
  files jsonb
) returns void
language plpgsql security definer set search_path = '' as $$
declare owner uuid; cid uuid; file jsonb; total bigint; existing public.academic_release_attestations%rowtype;
begin
  if auth.uid() is null then
    raise exception 'Sign in to attest a release' using errcode = '42501';
  end if;
  if profile_key is null or profile_key !~ '^[a-z0-9][a-z0-9._-]{0,63}$'
    or content_kind is null or content_kind not in ('course','question-bank','mixed')
    or classification is null or jsonb_typeof(classification) <> 'object'
    or octet_length(classification::text) > 4096
    or rights_status is null or rights_status not in ('pending','verified','rejected')
    or (license_evidence_sha256 is not null and license_evidence_sha256 !~ '^[a-f0-9]{64}$')
    or held_questions is null or held_questions not between 0 and 100000
    or projection_hash is null or projection_hash !~ '^[a-f0-9]{64}$'
    or files is null or jsonb_typeof(files) <> 'array'
    or jsonb_array_length(files) not between 1 and 1500 then
    raise exception 'Invalid academic release attestation';
  end if;
  select c.owner_id,c.id into owner,cid
  from public.academic_collections c
  join public.academic_revisions r on r.collection_id = c.id
  where r.id = revision and c.current_revision_id = r.id
    and r.status = 'ready' and c.collection_mode = 'standard'
  for update of c;
  if owner is distinct from auth.uid() then
    raise exception 'Current private revision unavailable' using errcode = '42501';
  end if;
  if exists(select 1 from public.academic_releases where source_revision_id = revision) then
    raise exception 'A published release cannot be re-attested' using errcode = '55000';
  end if;
  select * into existing from public.academic_release_attestations where revision_id = revision;
  if existing.revision_id is not null then
    if existing.owner_id = auth.uid() and existing.profile_key = profile_key
      and existing.content_kind = content_kind and existing.classification = classification
      and existing.rights_status = rights_status
      and existing.license_evidence_sha256 is not distinct from license_evidence_sha256
      and existing.publisher_opt_in = publisher_opt_in
      and existing.held_questions = held_questions
      and existing.projection_hash = projection_hash then
      return;
    end if;
    raise exception 'Release projection already attested; create a new private revision to replace it'
      using errcode = '55000';
  end if;
  select sum((entry->>'byte_size')::bigint) into total from jsonb_array_elements(files) entry;
  if total is null or total > 536870912 then raise exception 'Release projection exceeds 512 MiB'; end if;
  insert into public.academic_release_attestations(
    revision_id, owner_id, profile_key, content_kind, classification,
    rights_status, license_evidence_sha256, publisher_opt_in, held_questions,
    projection_hash, status, attested_at
  ) values (
    revision, auth.uid(), profile_key, content_kind, classification,
    rights_status, license_evidence_sha256, publisher_opt_in, held_questions,
    projection_hash, 'staging', now()
  );
  for file in select * from jsonb_array_elements(files) loop
    if file->>'path' is null or file->>'sha256' !~ '^[a-f0-9]{64}$'
      or (file->>'byte_size')::bigint not between 1 and 52428800
      or file->>'mime_type' not in ('application/json','text/plain','image/png','image/jpeg','image/webp','image/gif') then
      raise exception 'Invalid academic release file manifest';
    end if;
    insert into public.academic_release_candidate_files(
      revision_id,path,object_path,sha256,byte_size,mime_type
    ) values (
      revision,file->>'path',cid::text||'/release/'||(file->>'sha256'),
      file->>'sha256',(file->>'byte_size')::bigint,file->>'mime_type'
    );
  end loop;
  if not exists(select 1 from public.academic_release_candidate_files where revision_id=revision and path='catalog.json') then
    raise exception 'Release catalog missing';
  end if;
end;
$$;

create function public.academic_finish_release_candidate(revision uuid) returns void
language plpgsql security definer set search_path = '' as $$
begin
  if not exists(
    select 1 from public.academic_release_attestations a
    join public.academic_revisions r on r.id=a.revision_id
    join public.academic_collections c on c.id=r.collection_id
    where a.revision_id=revision and a.owner_id=auth.uid()
      and c.current_revision_id=r.id and c.collection_mode='standard'
  ) then
    raise exception 'Current release candidate unavailable' using errcode='42501';
  end if;
  if exists(
    select 1 from public.academic_release_candidate_files f
    where f.revision_id=revision and not exists(
      select 1 from storage.objects o
      where o.bucket_id='academic-content' and o.name=f.object_path
        and (o.metadata->>'size')::bigint=f.byte_size
    )
  ) then
    raise exception 'Release projection upload incomplete; keep the private source and retry';
  end if;
  update public.academic_release_attestations set status='ready'
  where revision_id=revision and owner_id=auth.uid();
end;
$$;

create function public.academic_publish_release(revision uuid) returns uuid
language plpgsql security definer set search_path = '' as $$
declare release uuid; att public.academic_release_attestations%rowtype;
begin
  if auth.uid() is null or not exists(
    select 1 from public.academic_reviewers where user_id = auth.uid()
  ) then
    raise exception 'Reviewer access required' using errcode = '42501';
  end if;
  select id into release from public.academic_releases
  where source_revision_id = revision
  order by published_at, id limit 1;
  if release is not null then return release; end if;
  select a.* into att
  from public.academic_release_attestations a
  join public.academic_revisions r on r.id = a.revision_id
  join public.academic_collections c on c.id = r.collection_id
  where a.revision_id = revision
    and c.current_revision_id = r.id
    and c.collection_mode = 'standard'
    and not c.withdrawn
    and c.review_status = 'approved'
    and r.status = 'ready'
    and r.approved_at is not null
    and r.review_questions = 0
    and a.held_questions = 0
    and a.rights_status = 'verified'
    and a.license_evidence_sha256 is not null
    and a.publisher_opt_in
    and a.status = 'ready'
  for update of c;
  if att.revision_id is null then
    raise exception 'Release requires verified rights, license evidence, publisher opt-in, current approval, and zero held/review questions';
  end if;
  -- Recheck after the collection lock so concurrent reviewer calls converge on
  -- the first immutable release instead of attempting a duplicate insert.
  select id into release from public.academic_releases
  where source_revision_id = revision;
  if release is not null then return release; end if;
  if not exists (
    select 1 from public.academic_release_candidate_files f
    where f.revision_id = revision and f.path = 'catalog.json'
  ) then
    raise exception 'Release catalog missing';
  end if;
  if exists (
    select 1
    from public.academic_release_candidate_files f
    join public.academic_revisions r on r.id = f.revision_id
    join public.academic_collections c on c.id = r.collection_id
    where f.revision_id = revision and (
      f.object_path <> c.id::text||'/release/'||f.sha256
      or not exists(
        select 1 from storage.objects o
        where o.bucket_id = 'academic-content' and o.name = f.object_path
          and (o.metadata->>'size')::bigint = f.byte_size
      )
    )
  ) then
    raise exception 'Release projection objects are missing or no longer match the attested manifest';
  end if;
  insert into public.academic_releases(
    collection_id, source_revision_id, profile_key, content_kind, classification,
    title, module, term, academic_term, cohort, template_text,
    ready_questions, review_questions, held_questions, rights_status,
    license_evidence_sha256, publisher_opt_in, projection_hash, approved_at
  )
  select c.id, r.id, att.profile_key, att.content_kind, att.classification,
    c.title, c.module, c.term, c.academic_term, c.cohort, r.template_text,
    r.ready_questions, 0, 0, att.rights_status,
    att.license_evidence_sha256, att.publisher_opt_in, att.projection_hash, r.approved_at
  from public.academic_revisions r
  join public.academic_collections c on c.id = r.collection_id
  where r.id = revision
  returning id into release;

  insert into public.academic_release_files(release_id,path,object_path,sha256,byte_size,mime_type)
  select release,f.path,f.object_path,f.sha256,f.byte_size,f.mime_type
  from public.academic_release_candidate_files f
  where f.revision_id = revision;
  if not exists(select 1 from public.academic_release_files where release_id = release and path = 'catalog.json') then
    raise exception 'Release catalog missing';
  end if;
  return release;
end;
$$;

create function public.academic_release_catalog(
  search text default '',
  term_filter text default '',
  after_id uuid default null,
  profile_key text default 'universal'
) returns jsonb
language sql stable security definer set search_path = '' as $$
  with eligible as (
    select r.*,
      row_number() over (
        partition by r.collection_id
        order by (r.profile_key = academic_release_catalog.profile_key) desc, r.published_at desc, r.id
      ) as preference
    from public.academic_releases r
    join public.academic_collections c on c.id = r.collection_id
    where auth.uid() is not null and not c.withdrawn
      and academic_release_catalog.profile_key ~ '^[a-z0-9][a-z0-9._-]{0,63}$'
      and (r.profile_key = 'universal' or r.profile_key = academic_release_catalog.profile_key)
  ), rows as (
    select c.id,
      jsonb_build_object(
        'id',c.id,'title',c.title,'module',c.module,'term',c.term,
        'academic_term',c.academic_term,'cohort',c.cohort,
        'visibility','private','review_status',c.review_status,
        'current_revision_id',c.current_revision_id,'owned',true,
        'ready_questions',r.ready_questions,'review_questions',r.review_questions,
        'release_id',null,'profile_key',null,'content_kind',null,'classification','{}'::jsonb
      ) item
    from public.academic_collections c
    join public.academic_revisions r on r.id = c.current_revision_id
    where c.owner_id = auth.uid() and c.collection_mode = 'standard' and not c.withdrawn
    union all
    select c.id,
      jsonb_build_object(
        'id',c.id,'title',e.title,'module',e.module,'term',e.term,
        'academic_term',e.academic_term,'cohort',e.cohort,
        'visibility','shared','review_status','approved',
        'current_revision_id',e.source_revision_id,'owned',false,
        'ready_questions',e.ready_questions,'review_questions',0,
        'release_id',e.id,'profile_key',e.profile_key,
        'content_kind',e.content_kind,'classification',e.classification
      ) item
    from eligible e
    join public.academic_collections c on c.id = e.collection_id
    where e.preference = 1 and c.owner_id <> auth.uid()
  ), page as (
    select rows.* from rows
    where (after_id is null or rows.id > after_id)
      and (term_filter = '' or rows.item->>'term' = term_filter)
      and (search = '' or ((rows.item->>'title')||' '||(rows.item->>'module')) ilike '%'||left(search,120)||'%')
    order by rows.id limit 24
  )
  select coalesce(jsonb_agg(page.item order by page.id), '[]'::jsonb) from page;
$$;

create function public.academic_release_course(collection uuid, profile_key text default 'universal') returns jsonb
language sql stable security definer set search_path = '' as $$
  with owned as (
    select jsonb_build_object(
      'id',c.id,'title',c.title,'module',c.module,'term',c.term,
      'academic_term',c.academic_term,'cohort',c.cohort,
      'visibility','private','review_status',c.review_status,
      'current_revision_id',c.current_revision_id,'owned',true,
      'ready_questions',r.ready_questions,'review_questions',r.review_questions,
      'release_id',null,'profile_key',null,'content_kind',null,'classification','{}'::jsonb
    ) item
    from public.academic_collections c
    join public.academic_revisions r on r.id = c.current_revision_id
    where c.id = collection and c.owner_id = auth.uid()
      and c.collection_mode = 'standard' and not c.withdrawn
  ), released as (
    select jsonb_build_object(
      'id',c.id,'title',rel.title,'module',rel.module,'term',rel.term,
      'academic_term',rel.academic_term,'cohort',rel.cohort,
      'visibility','shared','review_status','approved',
      'current_revision_id',rel.source_revision_id,'owned',false,
      'ready_questions',rel.ready_questions,'review_questions',0,
      'release_id',rel.id,'profile_key',rel.profile_key,
      'content_kind',rel.content_kind,'classification',rel.classification
    ) item
    from public.academic_releases rel
    join public.academic_collections c on c.id = rel.collection_id
    where auth.uid() is not null and c.id = collection and c.owner_id <> auth.uid()
      and not c.withdrawn
      and academic_release_course.profile_key ~ '^[a-z0-9][a-z0-9._-]{0,63}$'
      and (rel.profile_key = 'universal' or rel.profile_key = academic_release_course.profile_key)
    order by (rel.profile_key = academic_release_course.profile_key) desc,
      rel.published_at desc, rel.id
    limit 1
  )
  select item from owned union all select item from released limit 1;
$$;

create function public.academic_release_preview(revision uuid) returns jsonb
language sql stable security definer set search_path = '' as $$
  select jsonb_build_object(
    'id',r.source_revision_id,'collection_id',r.collection_id,
    'source_revision',null,'template_text',r.template_text,
    'ready_questions',r.ready_questions,'review_questions',0
  )
  from public.academic_releases r
  join public.academic_collections c on c.id = r.collection_id
  where auth.uid() is not null and r.source_revision_id = revision and not c.withdrawn
  order by (r.profile_key = 'universal') desc, r.published_at desc
  limit 1;
$$;

create function public.academic_release_files_for_revision(revision uuid) returns jsonb
language sql stable security definer set search_path = '' as $$
  select coalesce(jsonb_agg(jsonb_build_object(
    'path',f.path,'object_path',f.object_path,'sha256',f.sha256,
    'byte_size',f.byte_size,'mime_type',f.mime_type
  ) order by f.path), '[]'::jsonb)
  from public.academic_releases r
  join public.academic_release_files f on f.release_id = r.id
  join public.academic_collections c on c.id = r.collection_id
  where auth.uid() is not null and r.source_revision_id = revision and not c.withdrawn;
$$;

create function public.academic_release_can_read_object(object_name text) returns boolean
language sql stable security definer set search_path = '' as $$
  select auth.uid() is not null and exists(
    select 1 from public.academic_release_files f
    join public.academic_releases r on r.id = f.release_id
    join public.academic_collections c on c.id = r.collection_id
    where f.object_path = object_name and not c.withdrawn
  );
$$;

create function public.academic_release_candidate_can_read_object(object_name text) returns boolean
language sql stable security definer set search_path = '' as $$
  select auth.uid() is not null and exists(
    select 1 from public.academic_release_candidate_files f
    join public.academic_release_attestations a on a.revision_id=f.revision_id
    where f.object_path=object_name and a.owner_id=auth.uid()
  );
$$;

create function public.academic_release_candidate_can_write_object(object_name text) returns boolean
language sql stable security definer set search_path = '' as $$
  select auth.uid() is not null and exists(
    select 1 from public.academic_release_candidate_files f
    join public.academic_release_attestations a on a.revision_id=f.revision_id
    where f.object_path=object_name and a.owner_id=auth.uid() and a.status='staging'
  );
$$;

-- A visibility flag on the private source collection is no longer a
-- publication mechanism. Learners receive only an immutable release
-- projection; owners retain direct recovery access to every source revision.
create or replace function public.academic_can_read(collection uuid) returns boolean
language sql stable security definer set search_path = '' as $$
  select auth.uid() is not null and exists(
    select 1 from public.academic_collections c
    where c.id = collection and c.owner_id = auth.uid()
  );
$$;

drop policy if exists academic_revision_read on public.academic_revisions;
create policy academic_revision_read on public.academic_revisions
for select to authenticated using(public.academic_is_owner(collection_id));
drop policy if exists academic_file_read on public.academic_files;
create policy academic_file_read on public.academic_files
for select to authenticated using(exists(
  select 1 from public.academic_revisions r
  where r.id = revision_id and public.academic_is_owner(r.collection_id)
));

create or replace function public.academic_set_visibility(
  collection uuid, visibility text, group_id uuid default null
) returns void
language plpgsql security definer set search_path = '' as $$
begin
  if visibility <> 'private' or group_id is not null then
    raise exception 'Use the reviewed academic release workflow to publish content'
      using errcode = '42501';
  end if;
  update public.academic_collections c
    set visibility='private',group_id=null,updated_at=now()
    where c.id=collection and c.owner_id=auth.uid();
  if not found then raise exception 'Collection unavailable' using errcode='42501'; end if;
end;
$$;

drop policy if exists academic_content_read_boundary on storage.objects;
create policy academic_content_read_boundary on storage.objects as restrictive
for select to authenticated using (
  bucket_id <> 'academic-content'
  or exists(select 1 from public.academic_files f where f.object_path = name)
  or public.academic_release_can_read_object(name)
  or public.academic_release_candidate_can_read_object(name)
);
create policy academic_release_content_object_read on storage.objects
for select to authenticated using (
  bucket_id = 'academic-content' and public.academic_release_can_read_object(name)
);
create policy academic_release_candidate_object_read on storage.objects
for select to authenticated using (
  bucket_id='academic-content' and public.academic_release_candidate_can_read_object(name)
);

drop policy if exists academic_content_insert_boundary on storage.objects;
create policy academic_content_insert_boundary on storage.objects as restrictive
for insert to authenticated with check (
  bucket_id <> 'academic-content'
  or exists(select 1 from public.academic_files f join public.academic_revisions r on r.id=f.revision_id
    where f.object_path=name and public.academic_is_owner(r.collection_id) and r.status='uploading')
  or public.academic_release_candidate_can_write_object(name)
);
create policy academic_release_candidate_object_insert on storage.objects
for insert to authenticated with check (
  bucket_id='academic-content' and public.academic_release_candidate_can_write_object(name)
);

create function public.academic_enroll_release(
  collection uuid,
  revision uuid,
  weeks integer[],
  profile_key text default 'universal'
) returns void
language plpgsql security definer set search_path = '' as $$
begin
  if auth.uid() is null or profile_key !~ '^[a-z0-9][a-z0-9._-]{0,63}$'
    or not exists(
      select 1 from public.academic_releases rel
      join public.academic_collections c on c.id = rel.collection_id
      where rel.collection_id = collection and rel.source_revision_id = revision
        and (rel.profile_key = 'universal' or rel.profile_key = academic_enroll_release.profile_key)
        and c.collection_mode = 'standard' and not c.withdrawn
    ) then
    raise exception 'Course unavailable' using errcode = '42501';
  end if;
  if weeks is null or cardinality(weeks) not between 1 and 60
    or exists(select 1 from unnest(weeks) w where w is null or w < 1 or w > 60) then
    raise exception 'Invalid week';
  end if;
  insert into public.academic_enrollments(user_id,collection_id,revision_id,weeks)
  values(auth.uid(),collection,revision,array(select distinct w from unnest(weeks) w order by w))
  on conflict(user_id,collection_id) do update set
    revision_id=excluded.revision_id,
    weeks=array(select distinct w from unnest(
      case when academic_enrollments.revision_id=excluded.revision_id
        then academic_enrollments.weeks||excluded.weeks else excluded.weeks end
    ) w order by w),updated_at=now();
end;
$$;

create function public.academic_create_moderation_revision(
  metadata jsonb,
  provenance jsonb,
  files jsonb,
  content_hash text,
  collection uuid
) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare result jsonb;
begin
  if auth.uid() is null or collection is null
    or metadata->>'term' <> 'Term 0' or metadata->>'module' <> 'Unfiled'
    or metadata->>'collection_mode' <> 'moderation'
    or metadata->>'content_kind' <> 'mixed' then
    raise exception 'Moderation collections require Term 0, Unfiled, and mixed classification';
  end if;
  if exists(
    select 1 from public.academic_collections
    where id = collection and (owner_id <> auth.uid() or collection_mode <> 'moderation')
  ) then
    raise exception 'Collection unavailable' using errcode = '42501';
  end if;
  result := public.academic_create_revision(metadata, '', provenance, files, content_hash, collection);
  update public.academic_collections
    set collection_mode = 'moderation', visibility = 'private', group_id = null
    where id = collection and owner_id = auth.uid();
  return result;
end;
$$;

create or replace function public.academic_enroll(collection uuid, revision uuid, weeks integer[]) returns void
language plpgsql security definer set search_path = '' as $$
begin
  if auth.uid() is null or not public.academic_is_owner(collection)
    or exists(select 1 from public.academic_collections where id=collection and collection_mode='moderation')
    or not exists(select 1 from public.academic_revisions r where r.id=revision and r.collection_id=collection
      and r.status='ready') then
    raise exception 'Course unavailable' using errcode='42501';
  end if;
  if weeks is null or cardinality(weeks) not between 1 and 60
    or exists(select 1 from unnest(weeks) w where w is null or w < 1 or w > 60) then
    raise exception 'Invalid week';
  end if;
  insert into public.academic_enrollments(user_id,collection_id,revision_id,weeks)
  values(auth.uid(),collection,revision,array(select distinct w from unnest(weeks) w order by w))
  on conflict(user_id,collection_id) do update set revision_id=excluded.revision_id,
    weeks=array(select distinct w from unnest(case when academic_enrollments.revision_id=excluded.revision_id
      then academic_enrollments.weeks||excluded.weeks else excluded.weeks end) w order by w),updated_at=now();
end;
$$;

revoke all on function public.academic_attest_release(uuid,text,text,jsonb,text,text,boolean,integer,text,jsonb),
  public.academic_finish_release_candidate(uuid),
  public.academic_publish_release(uuid),
  public.academic_release_catalog(text,text,uuid,text),
  public.academic_release_course(uuid,text),
  public.academic_release_preview(uuid),
  public.academic_release_files_for_revision(uuid),
  public.academic_release_can_read_object(text),
  public.academic_release_candidate_can_read_object(text),
  public.academic_release_candidate_can_write_object(text),
  public.academic_enroll_release(uuid,uuid,integer[],text),
  public.academic_create_moderation_revision(jsonb,jsonb,jsonb,text,uuid)
from public, anon, authenticated;

grant execute on function public.academic_attest_release(uuid,text,text,jsonb,text,text,boolean,integer,text,jsonb),
  public.academic_finish_release_candidate(uuid),
  public.academic_release_catalog(text,text,uuid,text),
  public.academic_release_course(uuid,text),
  public.academic_release_preview(uuid),
  public.academic_release_files_for_revision(uuid),
  public.academic_release_can_read_object(text),
  public.academic_release_candidate_can_read_object(text),
  public.academic_release_candidate_can_write_object(text),
  public.academic_enroll_release(uuid,uuid,integer[],text),
  public.academic_create_moderation_revision(jsonb,jsonb,jsonb,text,uuid)
to authenticated;

grant execute on function public.academic_publish_release(uuid) to authenticated;
