-- Published course/question content is shared. Learner workspaces remain private.
-- No content or publisher credentials are seeded by this migration.
begin;
create table public.academic_catalog_releases (
  id uuid primary key,
  catalog_key text not null check (catalog_key ~ '^[a-zA-Z0-9_-]{1,100}$'),
  version text not null check (length(version) between 1 and 100),
  manifest_sha256 text not null check (manifest_sha256 ~ '^[a-f0-9]{64}$'),
  title text not null check (length(title) between 1 and 240),
  status text not null default 'staging' check (status in ('staging','published','withdrawn')),
  audience text not null default 'restricted' check (audience in ('public','authenticated','restricted')),
  rights_reference text not null check (length(trim(rights_reference)) between 1 and 1000),
  created_at timestamptz not null default now(),
  published_at timestamptz,
  unique (catalog_key, version),
  check (status <> 'published' or published_at is not null)
);
create table public.academic_catalog_grants (
  release_id uuid not null references public.academic_catalog_releases(id),
  user_id uuid not null references auth.users(id) on delete cascade,
  primary key (release_id, user_id)
);
create index academic_catalog_grants_user on public.academic_catalog_grants(user_id, release_id);
create table public.academic_catalog_files (
  release_id uuid not null references public.academic_catalog_releases(id),
  path text not null check (length(path) between 1 and 500 and path !~ '(^/|(^|/)\.\.?(/|$)|//|\\|[%?#]|[[:cntrl:]])'),
  storage_path text not null unique,
  sha256 text not null check (sha256 ~ '^[a-f0-9]{64}$'),
  byte_size bigint not null check (byte_size between 1 and 16777216),
  mime_type text not null check (mime_type in ('application/json','text/plain','image/png','image/jpeg','image/webp','image/gif')),
  primary key (release_id, path),
  check (storage_path = release_id::text || '/' || path)
);
create table public.academic_catalog_entries (
  release_id uuid not null references public.academic_catalog_releases(id),
  id text not null check (id ~ '^[a-zA-Z0-9_-]{1,150}$'),
  kind text not null check (kind in ('template','bank')),
  title text not null check (length(title) between 1 and 300),
  module text not null check (length(module) between 1 and 100),
  term text not null check (length(term) between 1 and 100),
  week integer check (week between 1 and 104),
  question_count integer not null default 0 check (question_count between 0 and 10000),
  image_question_count integer not null default 0 check (image_question_count between 0 and question_count),
  activity_count integer not null default 0 check (activity_count between 0 and 10000),
  payload_path text not null,
  source_label text not null check (length(source_label) between 1 and 500),
  primary key (release_id, id),
  foreign key (release_id, payload_path) references public.academic_catalog_files(release_id, path),
  check ((kind = 'template' and activity_count > 0 and question_count = 0)
      or (kind = 'bank' and question_count > 0 and activity_count = 0))
);
create index academic_catalog_entries_scope on public.academic_catalog_entries(release_id, term, module, kind);
alter table public.academic_catalog_releases enable row level security;
alter table public.academic_catalog_grants enable row level security;
alter table public.academic_catalog_files enable row level security;
alter table public.academic_catalog_entries enable row level security;

-- Fixed search path, explicit ownership checks, and no default PUBLIC execute.
create function public.can_read_academic_release(wanted uuid)
returns boolean language sql stable security definer set search_path = '' as $$
  select exists (
    select 1 from public.academic_catalog_releases r
    where r.id = wanted and r.status = 'published' and (
      r.audience = 'public'
      or (r.audience = 'authenticated' and (select auth.uid()) is not null)
      or (r.audience = 'restricted' and exists (
        select 1 from public.academic_catalog_grants g
        where g.release_id = r.id and g.user_id = (select auth.uid())
      ))
    )
  );
$$;
revoke all on function public.can_read_academic_release(uuid) from public, anon, authenticated;
grant execute on function public.can_read_academic_release(uuid) to anon, authenticated, service_role;
create policy academic_release_read on public.academic_catalog_releases for select to anon, authenticated
  using (public.can_read_academic_release(id));
create policy academic_entry_read on public.academic_catalog_entries for select to anon, authenticated
  using (public.can_read_academic_release(release_id));
create policy academic_file_read on public.academic_catalog_files for select to anon, authenticated
  using (public.can_read_academic_release(release_id));
create policy academic_grant_self on public.academic_catalog_grants for select to authenticated
  using (user_id = (select auth.uid()));
revoke all on public.academic_catalog_releases, public.academic_catalog_entries,
  public.academic_catalog_files, public.academic_catalog_grants from anon, authenticated;
grant select on public.academic_catalog_releases, public.academic_catalog_entries,
  public.academic_catalog_files to anon, authenticated;
grant select on public.academic_catalog_grants to authenticated;
grant all on public.academic_catalog_releases, public.academic_catalog_entries,
  public.academic_catalog_files, public.academic_catalog_grants to service_role;

insert into storage.buckets(id, name, public, file_size_limit, allowed_mime_types)
values ('academic-catalog', 'academic-catalog', false, 16777216,
  array['application/json','text/plain','image/png','image/jpeg','image/webp','image/gif']);
-- Manifest membership and release authorization protect both metadata and bytes.
create policy academic_object_read on storage.objects for select to anon, authenticated
using (bucket_id = 'academic-catalog' and exists (
  select 1 from public.academic_catalog_files f
  where f.storage_path = storage.objects.name and public.can_read_academic_release(f.release_id)
));

create function public.guard_academic_catalog_mutation()
returns trigger language plpgsql set search_path = '' as $$
declare parent_id uuid;
begin
  parent_id := case when TG_OP = 'DELETE' then OLD.release_id else NEW.release_id end;
  if TG_OP = 'UPDATE' and NEW.release_id is distinct from OLD.release_id then
    raise exception 'A catalog record cannot move between releases';
  end if;
  perform 1 from public.academic_catalog_releases where id = parent_id and status = 'staging' for update;
  if not found then raise exception 'Published catalog content is immutable; create a new release'; end if;
  if TG_OP = 'DELETE' then return OLD; end if;
  return NEW;
end;
$$;
revoke all on function public.guard_academic_catalog_mutation() from public, anon, authenticated;
create trigger immutable_academic_entries before insert or update or delete on public.academic_catalog_entries
for each row execute function public.guard_academic_catalog_mutation();
create trigger immutable_academic_files before insert or update or delete on public.academic_catalog_files
for each row execute function public.guard_academic_catalog_mutation();

create function public.guard_academic_release_mutation()
returns trigger language plpgsql set search_path = '' as $$
begin
  if TG_OP = 'INSERT' then
    if NEW.status <> 'staging' or NEW.published_at is not null then raise exception 'New releases must start in staging'; end if;
    return NEW;
  end if;
  if TG_OP = 'DELETE' then
    if OLD.status <> 'staging' then raise exception 'Retain published history; withdraw the release instead'; end if;
    return OLD;
  end if;
  if NEW.id <> OLD.id or NEW.catalog_key <> OLD.catalog_key or NEW.version <> OLD.version
     or NEW.manifest_sha256 <> OLD.manifest_sha256 or NEW.title <> OLD.title
     or NEW.audience <> OLD.audience or NEW.rights_reference <> OLD.rights_reference
     or NEW.created_at <> OLD.created_at then
    raise exception 'Release identity and audience are immutable';
  end if;
  if OLD.status = 'withdrawn' and NEW is distinct from OLD then raise exception 'Withdrawn releases cannot be reopened'; end if;
  if OLD.status = 'published' and (NEW.status not in ('published','withdrawn') or NEW.published_at is distinct from OLD.published_at) then
    raise exception 'Published releases can only be withdrawn';
  end if;
  return NEW;
end;
$$;
revoke all on function public.guard_academic_release_mutation() from public, anon, authenticated;
create trigger immutable_academic_release before insert or update or delete on public.academic_catalog_releases
for each row execute function public.guard_academic_release_mutation();

create function public.publish_academic_release(wanted uuid, expected_entries integer, expected_files integer)
returns void language plpgsql security invoker set search_path = '' as $$
declare r public.academic_catalog_releases;
begin
  select * into r from public.academic_catalog_releases where id = wanted for update;
  if not found then raise exception 'Release not found'; end if;
  if r.status = 'published' then return; end if;
  if r.status <> 'staging' then raise exception 'Withdrawn releases cannot be republished'; end if;
  if expected_entries < 1 or expected_files < 1
     or (select count(*) from public.academic_catalog_entries where release_id = wanted) <> expected_entries
     or (select count(*) from public.academic_catalog_files where release_id = wanted) <> expected_files then
    raise exception 'Incomplete catalog: entries or files are missing';
  end if;
  if r.audience = 'restricted' and not exists (select 1 from public.academic_catalog_grants where release_id = wanted) then
    raise exception 'A restricted release needs an authorized reader';
  end if;
  if exists (
    select 1 from public.academic_catalog_files f
    left join storage.objects o on o.bucket_id = 'academic-catalog' and o.name = f.storage_path
    where f.release_id = wanted and (o.id is null or coalesce((o.metadata->>'size')::bigint, -1) <> f.byte_size)
  ) then raise exception 'Storage upload is missing or has the wrong size'; end if;
  if not exists (select 1 from storage.buckets where id = 'academic-catalog' and not public) then
    raise exception 'Academic content bucket must remain private';
  end if;
  update public.academic_catalog_releases set status = 'published', published_at = now() where id = wanted;
end;
$$;
revoke all on function public.publish_academic_release(uuid, integer, integer) from public, anon, authenticated;
grant execute on function public.publish_academic_release(uuid, integer, integer) to service_role;
commit;
