-- Academic content has a collection identity. Learner enrollment never copies it.
-- The private workspace recovery buckets and snapshot format remain independent.
create table public.academic_groups (
  id uuid primary key default gen_random_uuid(),
  name text not null check (length(name) between 1 and 120)
);
create table public.academic_group_members (
  group_id uuid not null references public.academic_groups on delete cascade,
  user_id uuid not null references auth.users on delete cascade,
  primary key (group_id, user_id)
);
create table public.academic_reviewers (
  user_id uuid primary key references auth.users on delete cascade
);
create table public.academic_collections (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null references auth.users,
  title text not null check (length(title) between 1 and 180),
  module text not null check (length(module) between 1 and 80),
  term text not null check (length(term) between 1 and 80),
  academic_term text check (length(academic_term) <= 80),
  cohort text check (length(cohort) <= 80),
  visibility text not null default 'private' check (visibility in ('private','group','shared')),
  group_id uuid references public.academic_groups,
  review_status text not null default 'pending' check (review_status in ('pending','approved','rejected')),
  withdrawn boolean not null default false,
  current_revision_id uuid,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check ((visibility = 'group') = (group_id is not null))
);
create index academic_collection_discovery on public.academic_collections(module, term, id) where not withdrawn;
create table public.academic_revisions (
  id uuid primary key default gen_random_uuid(),
  collection_id uuid not null references public.academic_collections,
  content_hash text not null check (content_hash ~ '^[a-f0-9]{64}$'),
  source_revision text check (length(source_revision) <= 80),
  template_text text not null check (octet_length(template_text) <= 262144),
  provenance jsonb not null default '{}' check (jsonb_typeof(provenance) = 'object' and octet_length(provenance::text) <= 32768),
  ready_questions integer not null default 0 check (ready_questions between 0 and 100000),
  review_questions integer not null default 0 check (review_questions between 0 and 100000),
  status text not null default 'uploading' check (status in ('uploading','ready')),
  approved_at timestamptz,
  created_at timestamptz not null default now(),
  unique(collection_id, content_hash)
);
alter table public.academic_collections add constraint academic_current_revision_fk foreign key(current_revision_id) references public.academic_revisions;
create table public.academic_files (
  revision_id uuid not null references public.academic_revisions,
  path text not null check (length(path) between 1 and 500 and path !~ '(^/|\\|(^|/)\.\.(/|$)|(^|/)\.(/|$))'),
  object_path text not null,
  sha256 text not null check (sha256 ~ '^[a-f0-9]{64}$'),
  byte_size bigint not null check (byte_size between 1 and 52428800),
  mime_type text not null check (mime_type in ('application/json','text/plain','application/pdf','image/png','image/jpeg','image/webp','application/vnd.openxmlformats-officedocument.wordprocessingml.document')),
  primary key(revision_id, path)
);
create index academic_file_object on public.academic_files(object_path);
create table public.academic_enrollments (
  user_id uuid not null references auth.users on delete cascade,
  collection_id uuid not null references public.academic_collections,
  revision_id uuid not null references public.academic_revisions,
  weeks integer[] not null default '{}' check (cardinality(weeks) <= 60),
  updated_at timestamptz not null default now(),
  primary key(user_id, collection_id)
);

create function public.academic_can_read(collection uuid) returns boolean
language sql stable security definer set search_path = '' as $$
  select exists(select 1 from public.academic_collections c where c.id = collection and
    ((c.owner_id = auth.uid()) or (not c.withdrawn and exists(select 1 from public.academic_revisions r where r.collection_id=c.id and r.status='ready' and r.approved_at is not null) and
      (c.visibility = 'shared' or (c.visibility = 'group' and exists
        (select 1 from public.academic_group_members m where m.group_id=c.group_id and m.user_id=auth.uid()))))));
$$;
revoke all on function public.academic_can_read(uuid) from public, anon;
grant execute on function public.academic_can_read(uuid) to authenticated;
create function public.academic_is_owner(collection uuid) returns boolean
language sql stable security definer set search_path = '' as $$
  select exists(select 1 from public.academic_collections where id=collection and owner_id=auth.uid());
$$;
revoke all on function public.academic_is_owner(uuid) from public, anon;
grant execute on function public.academic_is_owner(uuid) to authenticated;

alter table public.academic_groups enable row level security;
alter table public.academic_group_members enable row level security;
alter table public.academic_reviewers enable row level security;
alter table public.academic_collections enable row level security;
alter table public.academic_revisions enable row level security;
alter table public.academic_files enable row level security;
alter table public.academic_enrollments enable row level security;
revoke all on public.academic_groups, public.academic_group_members, public.academic_reviewers,
  public.academic_collections, public.academic_revisions, public.academic_files, public.academic_enrollments from anon, authenticated;
grant select on public.academic_groups, public.academic_group_members,
  public.academic_revisions, public.academic_files, public.academic_enrollments to authenticated;
grant select(id,title,module,term,academic_term,cohort,visibility,review_status,withdrawn,current_revision_id,created_at,updated_at)
  on public.academic_collections to authenticated;
grant all on public.academic_groups, public.academic_group_members, public.academic_reviewers,
  public.academic_collections, public.academic_revisions, public.academic_files, public.academic_enrollments to service_role;
create policy academic_members_self on public.academic_group_members for select to authenticated using(user_id=(select auth.uid()));
create policy academic_groups_member on public.academic_groups for select to authenticated using(exists(select 1 from public.academic_group_members m where m.group_id=id and m.user_id=(select auth.uid())));
create policy academic_collection_read on public.academic_collections for select to authenticated using(public.academic_can_read(id));
create policy academic_revision_read on public.academic_revisions for select to authenticated using(public.academic_is_owner(collection_id) or (public.academic_can_read(collection_id) and status='ready' and approved_at is not null));
create policy academic_file_read on public.academic_files for select to authenticated using(exists(select 1 from public.academic_revisions r where r.id=revision_id));
create policy academic_enrollment_self on public.academic_enrollments for select to authenticated using(user_id=(select auth.uid()));

insert into storage.buckets(id,name,public,file_size_limit,allowed_mime_types)
values ('academic-content','academic-content',false,52428800,array['application/json','text/plain','application/pdf','image/png','image/jpeg','image/webp','application/vnd.openxmlformats-officedocument.wordprocessingml.document'])
on conflict(id) do nothing;
create policy academic_object_read on storage.objects for select to authenticated using(
  bucket_id='academic-content' and exists(select 1 from public.academic_files f where f.object_path=name));
create policy academic_object_insert on storage.objects for insert to authenticated with check(
  bucket_id='academic-content' and exists(select 1 from public.academic_files f join public.academic_revisions r on r.id=f.revision_id
    where f.object_path=name and public.academic_is_owner(r.collection_id) and r.status='uploading'));
-- No client update/delete policies: published content bytes are immutable.

create function public.academic_create_revision(metadata jsonb, template text, provenance jsonb, files jsonb,
  content_hash text, collection uuid default null) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare cid uuid; rid uuid; file jsonb; total bigint;
begin
  if auth.uid() is null then raise exception 'Sign in to upload material' using errcode='42501'; end if;
  if jsonb_typeof(files) <> 'array' or jsonb_array_length(files) not between 1 and 1500 then raise exception 'Invalid file manifest'; end if;
  select sum((f->>'byte_size')::bigint) into total from jsonb_array_elements(files) f;
  if total > 536870912 then raise exception 'Collection exceeds 512 MiB'; end if;
  if collection is null then raise exception 'A stable upload identity is required'; end if;
  if not exists(select 1 from public.academic_collections where id=collection) then
    insert into public.academic_collections(id,owner_id,title,module,term,academic_term,cohort)
    values(collection,auth.uid(),metadata->>'title',metadata->>'module',metadata->>'term',metadata->>'academic_term',metadata->>'cohort') returning id into cid;
  else
    select id into cid from public.academic_collections where id=collection and owner_id=auth.uid() for update;
    if cid is null then raise exception 'Collection unavailable' using errcode='42501'; end if;
  end if;
  select id into rid from public.academic_revisions r where r.collection_id=cid and r.content_hash=academic_create_revision.content_hash;
  if rid is not null then return jsonb_build_object('collection_id',cid,'revision_id',rid); end if;
  insert into public.academic_revisions(collection_id,content_hash,source_revision,template_text,provenance,ready_questions,review_questions)
  values(cid,content_hash,metadata->>'source_revision',template,provenance,coalesce((metadata->>'ready_questions')::integer,0),coalesce((metadata->>'review_questions')::integer,0)) returning id into rid;
  for file in select * from jsonb_array_elements(files) loop
    insert into public.academic_files(revision_id,path,object_path,sha256,byte_size,mime_type)
    values(rid,file->>'path',cid::text||'/'||(file->>'sha256'),file->>'sha256',(file->>'byte_size')::bigint,file->>'mime_type');
  end loop;
  if not exists(select 1 from public.academic_files where revision_id=rid and path='catalog.json') then raise exception 'Catalog missing'; end if;
  return jsonb_build_object('collection_id',cid,'revision_id',rid);
end;
$$;

create function public.academic_finish_revision(revision uuid) returns void
language plpgsql security definer set search_path = '' as $$
declare cid uuid;
begin
  select c.id into cid from public.academic_collections c join public.academic_revisions r on r.collection_id=c.id
    where r.id=revision and c.owner_id=auth.uid() for update of c;
  if cid is null then raise exception 'Collection unavailable' using errcode='42501'; end if;
  -- A delayed acknowledgement for an older revision must never roll the
  -- collection back after a newer revision became current.
  if exists(select 1 from public.academic_revisions where id=revision and status='ready') then return; end if;
  if exists(select 1 from public.academic_files f where f.revision_id=revision and not exists
    (select 1 from storage.objects o where o.bucket_id='academic-content' and o.name=f.object_path and (o.metadata->>'size')::bigint=f.byte_size)) then
    raise exception 'Upload incomplete; keep local originals and retry';
  end if;
  update public.academic_revisions set status='ready' where id=revision;
  update public.academic_collections set current_revision_id=revision, review_status='pending',updated_at=now() where id=cid and current_revision_id is distinct from revision;
end;
$$;

create function public.academic_set_visibility(collection uuid, visibility text, group_id uuid default null) returns void
language plpgsql security definer set search_path = '' as $$
begin
  if visibility='group' and not exists(select 1 from public.academic_group_members m where m.group_id=academic_set_visibility.group_id and m.user_id=auth.uid()) then raise exception 'Group unavailable' using errcode='42501'; end if;
  update public.academic_collections c set visibility=academic_set_visibility.visibility,group_id=academic_set_visibility.group_id,updated_at=now()
    where c.id=collection and c.owner_id=auth.uid();
  if not found then raise exception 'Collection unavailable' using errcode='42501'; end if;
end;
$$;
create function public.academic_review(collection uuid, approved boolean) returns void
language plpgsql security definer set search_path = '' as $$
begin
  if not exists(select 1 from public.academic_reviewers where user_id=auth.uid()) then raise exception 'Reviewer access required' using errcode='42501'; end if;
  update public.academic_collections set review_status=case when approved then 'approved' else 'rejected' end,updated_at=now()
    where id=collection and current_revision_id is not null;
  if not found then raise exception 'Ready revision required'; end if;
  update public.academic_revisions set approved_at=case when approved then now() else null end
    where id=(select current_revision_id from public.academic_collections where id=collection);
end;
$$;
create function public.academic_withdraw(collection uuid, withdrawn boolean) returns void
language plpgsql security definer set search_path = '' as $$
begin
  update public.academic_collections c set withdrawn=academic_withdraw.withdrawn,updated_at=now() where c.id=collection and c.owner_id=auth.uid();
  if not found then raise exception 'Collection unavailable' using errcode='42501'; end if;
end;
$$;
create function public.academic_catalog(search text default '', term_filter text default '', after_id uuid default null) returns jsonb
language sql stable security definer set search_path = '' as $$
  select coalesce(jsonb_agg(page.item order by page.id), '[]'::jsonb) from (
    select c.id, jsonb_build_object('id',c.id,'title',c.title,'module',c.module,'term',c.term,
      'academic_term',c.academic_term,'cohort',c.cohort,'visibility',c.visibility,'review_status',c.review_status,
      'current_revision_id',c.current_revision_id,'owned',c.owner_id=auth.uid(),
      'ready_questions',r.ready_questions,'review_questions',r.review_questions) item
    from public.academic_collections c join public.academic_revisions r on r.id=c.current_revision_id
    where auth.uid() is not null and public.academic_can_read(c.id) and not c.withdrawn
      and (c.owner_id=auth.uid() or r.approved_at is not null)
      and (after_id is null or c.id>after_id) and (term_filter='' or c.term=term_filter)
      and (search='' or (c.title||' '||c.module) ilike '%'||left(search,120)||'%')
    order by c.id limit 24
  ) page;
$$;
create function public.academic_enroll(collection uuid, revision uuid, weeks integer[]) returns void
language plpgsql security definer set search_path = '' as $$
begin
  if auth.uid() is null or not public.academic_can_read(collection) or not exists(select 1 from public.academic_revisions r where r.id=revision and r.collection_id=collection and r.status='ready' and (public.academic_is_owner(collection) or r.approved_at is not null)) then raise exception 'Course unavailable' using errcode='42501'; end if;
  if weeks is null or cardinality(weeks) not between 1 and 60 or exists(select 1 from unnest(weeks) w where w is null or w < 1 or w > 60) then raise exception 'Invalid week'; end if;
  insert into public.academic_enrollments(user_id,collection_id,revision_id,weeks) values(auth.uid(),collection,revision,array(select distinct w from unnest(weeks) w order by w))
  on conflict(user_id,collection_id) do update set revision_id=excluded.revision_id,
    weeks=array(select distinct w from unnest(case when academic_enrollments.revision_id=excluded.revision_id then academic_enrollments.weeks||excluded.weeks else excluded.weeks end) w order by w),updated_at=now();
end;
$$;

revoke all on function public.academic_create_revision(jsonb,text,jsonb,jsonb,text,uuid), public.academic_finish_revision(uuid),
 public.academic_set_visibility(uuid,text,uuid),public.academic_review(uuid,boolean),public.academic_enroll(uuid,uuid,integer[]),
 public.academic_withdraw(uuid,boolean),public.academic_catalog(text,text,uuid) from public, anon;
grant execute on function public.academic_create_revision(jsonb,text,jsonb,jsonb,text,uuid),public.academic_finish_revision(uuid),
 public.academic_set_visibility(uuid,text,uuid),public.academic_review(uuid,boolean),public.academic_enroll(uuid,uuid,integer[]),
 public.academic_withdraw(uuid,boolean),public.academic_catalog(text,text,uuid) to authenticated;
