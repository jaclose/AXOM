-- Account-owned, immutable original document files. Existing workspace and
-- academic library stores remain authoritative; bytes live by (owner, sha256).
-- This migration is a deployment candidate only. Agent 0 owns release approval.
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('workspace-originals', 'workspace-originals', false, 134217728,
  array['application/pdf','application/vnd.openxmlformats-officedocument.wordprocessingml.document',
        'text/plain','text/markdown','text/csv','application/json',
        'image/png','image/jpeg','image/webp','image/gif'])
on conflict (id) do nothing;

-- These permissive policies permit only exact owner/hash paths. The restrictive
-- boundary overrides unrelated permissive policies installed by other features.
create policy workspace_originals_read on storage.objects for select to authenticated
using (bucket_id='workspace-originals' and auth.uid() is not null
  and name ~ ('^' || auth.uid()::text || '/[a-f0-9]{64}$'));
create policy workspace_originals_insert on storage.objects for insert to authenticated
with check (bucket_id='workspace-originals' and auth.uid() is not null
  and name ~ ('^' || auth.uid()::text || '/[a-f0-9]{64}$'));
create policy workspace_originals_delete on storage.objects for delete to authenticated
using (bucket_id='workspace-originals' and auth.uid() is not null
  and name ~ ('^' || auth.uid()::text || '/[a-f0-9]{64}$'));

create policy workspace_originals_owner_boundary on storage.objects as restrictive
for all to anon, authenticated
using (bucket_id <> 'workspace-originals' or (auth.uid() is not null
  and name ~ ('^' || auth.uid()::text || '/[a-f0-9]{64}$')))
with check (bucket_id <> 'workspace-originals' or (auth.uid() is not null
  and name ~ ('^' || auth.uid()::text || '/[a-f0-9]{64}$')));
-- Resumable inserts are permitted; replacing already acknowledged bytes is not.
create policy workspace_originals_immutable_boundary on storage.objects as restrictive
for update to anon, authenticated
using (bucket_id <> 'workspace-originals')
with check (bucket_id <> 'workspace-originals');

-- Before a snapshot becomes an accepted server revision, ensure every claimed
-- original is present in this account's Storage namespace and size-matched.
-- The supplied SHA-256 is checked by the client against downloaded bytes; the
-- server enforces owner, path, object existence and byte count atomically.
-- All revision transports (full and delta) use workspace_revisions inserts.
create function axom_private.verify_workspace_originals() returns trigger
language plpgsql security definer set search_path = '' as $$
declare
  body jsonb;
  document jsonb;
  identity jsonb;
  hash text;
  claimed_size bigint;
  stored_size bigint;
  checksum text;
begin
  if new.snapshot_payload->>'_axomCloudFormat' is distinct from '2'
     or jsonb_typeof(new.snapshot_payload->'content') is distinct from 'string' then
    return new;
  end if;
  -- The current v2 wire format sends compact JSON. Older compressed v2
  -- snapshots have no originalFile field and remain restorable.
  if left(ltrim(new.snapshot_payload->>'content'),1) <> '{' then return new; end if;
  body := (new.snapshot_payload->>'content')::jsonb;
  if jsonb_typeof(body->'documents') is distinct from 'array' then return new; end if;
  for document in select value from jsonb_array_elements(body->'documents') loop
    identity := document->'originalFile';
    if identity is null then continue; end if;
    if jsonb_typeof(identity) is distinct from 'object'
      or identity->>'version' is distinct from '1'
      or coalesce(identity->>'sha256','') !~ '^[a-f0-9]{64}$'
      or coalesce(identity->>'mimeType','') not in
        ('application/pdf','application/vnd.openxmlformats-officedocument.wordprocessingml.document',
         'text/plain','text/markdown','text/csv','application/json',
         'image/png','image/jpeg','image/webp','image/gif')
      or coalesce(identity->>'byteSize','') !~ '^[1-9][0-9]{0,8}$'
    then raise exception 'invalid original source identity' using errcode='PT400'; end if;
    hash := identity->>'sha256';
    claimed_size := (identity->>'byteSize')::bigint;
    checksum := regexp_replace(coalesce(document->>'checksum',''),'^sha256:','');
    if claimed_size > 134217728 or claimed_size::text is distinct from document->>'sizeBytes'
       or checksum is distinct from hash then
      raise exception 'original source metadata mismatch' using errcode='PT400';
    end if;
    if new.user_id is distinct from auth.uid() then
      raise exception 'original source requires account ownership' using errcode='42501';
    end if;
    select (o.metadata->>'size')::bigint into stored_size
      from storage.objects o
      where o.bucket_id='workspace-originals'
        and o.name=new.user_id::text||'/'||hash;
    if stored_size is distinct from claimed_size then
      raise exception 'original source upload is incomplete' using errcode='PT409';
    end if;
  end loop;
  return new;
end $$;
revoke all on function axom_private.verify_workspace_originals() from public, anon, authenticated;
create trigger verify_workspace_originals_before_revision
before insert on public.workspace_revisions
for each row execute function axom_private.verify_workspace_originals();
