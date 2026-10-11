-- Extend the preceding catalog checkpoint without replacing its identities.
-- Publication validation must also cover direct service-role updates.
alter table public.academic_catalog_releases
  add column expected_entries integer check (expected_entries between 1 and 10000),
  add column expected_files integer check (expected_files between 1 and 30000);

create or replace function public.guard_academic_release_mutation()
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
     or NEW.created_at <> OLD.created_at then raise exception 'Release identity and audience are immutable'; end if;
  if OLD.status <> 'staging' then
    if (to_jsonb(NEW) - 'status') is distinct from (to_jsonb(OLD) - 'status')
      or NEW.status not in ('published','withdrawn') or (OLD.status='withdrawn' and NEW.status<>'withdrawn') then
      raise exception 'Published release metadata is immutable; only withdrawal is allowed';
    end if;
    return NEW;
  end if;
  if NEW.status = 'staging' then
    if NEW.published_at is not null then raise exception 'Staging releases cannot claim publication'; end if;
    return NEW;
  end if;
  if NEW.status = 'withdrawn' then return NEW; end if;
  if NEW.expected_entries is null or NEW.expected_files is null
    or (select count(*) from public.academic_catalog_entries where release_id=NEW.id) <> NEW.expected_entries
    or (select count(*) from public.academic_catalog_files where release_id=NEW.id) <> NEW.expected_files then
    raise exception 'Incomplete catalog: declared entries or files are missing';
  end if;
  if NEW.audience='restricted' and not exists(select 1 from public.academic_catalog_grants where release_id=NEW.id) then raise exception 'Restricted publication needs explicitly authorized readers'; end if;
  if not exists(select 1 from storage.buckets where id='academic-catalog' and not public) then raise exception 'Academic storage must be private'; end if;
  if exists(
    select 1 from public.academic_catalog_files f left join storage.objects o
      on o.bucket_id='academic-catalog' and o.name=f.storage_path
    where f.release_id=NEW.id and (o.id is null or coalesce((o.metadata->>'size')::bigint,-1)<>f.byte_size)
  ) then raise exception 'A required storage object is absent or the wrong size'; end if;
  if exists(
    select 1 from public.academic_catalog_entries e join public.academic_catalog_files f
      on f.release_id=e.release_id and f.path=e.payload_path
    where e.release_id=NEW.id and f.mime_type<>case when e.kind='template' then 'text/plain' else 'application/json' end
  ) then raise exception 'Entry payload format is inconsistent'; end if;
  NEW.published_at := now();
  return NEW;
end;
$$;
revoke all on function public.guard_academic_release_mutation() from public, anon, authenticated;

create or replace function public.publish_academic_release(wanted uuid, expected_entries integer, expected_files integer)
returns void language plpgsql security invoker set search_path = '' as $$
declare r public.academic_catalog_releases;
begin
  select * into r from public.academic_catalog_releases where id=wanted for update;
  if not found then raise exception 'Release not found'; end if;
  if r.status='published' then return; end if;
  if r.status<>'staging' then raise exception 'Withdrawn releases cannot be republished'; end if;
  if expected_entries is null or expected_files is null or expected_entries<1 or expected_files<1 then raise exception 'Publication needs declared content counts'; end if;
  if (r.expected_entries is not null and r.expected_entries<>expected_entries)
    or (r.expected_files is not null and r.expected_files<>expected_files) then raise exception 'Publication counts differ from the staged plan'; end if;
  update public.academic_catalog_releases set expected_entries=$2,expected_files=$3,status='published',published_at=now() where id=wanted;
end;
$$;
revoke all on function public.publish_academic_release(uuid,integer,integer) from public,anon,authenticated;
grant execute on function public.publish_academic_release(uuid,integer,integer) to service_role;
create function public.publish_academic_release(wanted uuid)
returns void language plpgsql security invoker set search_path = '' as $$
declare r public.academic_catalog_releases;
begin
  select * into r from public.academic_catalog_releases where id=wanted for update;
  if not found then raise exception 'Release not found'; end if;
  perform public.publish_academic_release(wanted,r.expected_entries,r.expected_files);
end;
$$;
revoke all on function public.publish_academic_release(uuid) from public,anon,authenticated;
grant execute on function public.publish_academic_release(uuid) to service_role;
