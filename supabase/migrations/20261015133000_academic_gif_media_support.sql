-- Academic collection figure format parity with the existing private
-- question-bank installer. INSTALL THIS MIGRATION BEFORE deploying the new
-- GIF-enabled academic uploader. Agent 0 owns production migration approval.
-- Preserve all existing academic revisions, ownership, and RLS policies.
--
-- This makes exactly one additional MIME type eligible; no bucket is made
-- public, no content changes owners, and no question readiness is promoted.
-- Fail closed if this is not the expected PRIVATE Supabase bucket. Never
-- silently turn a missing/misconfigured bucket into GIF-only storage.
do $$
begin
  if not exists (
    select 1 from storage.buckets
    where id = 'academic-content' and public = false
      and allowed_mime_types @> array[
        'application/json','image/png','image/jpeg','image/webp'
      ]::text[]
  ) then
    raise exception 'Private academic-content bucket and existing MIME formats are required before enabling GIF';
  end if;
end $$;

alter table public.academic_files
  drop constraint if exists academic_files_mime_type_check;

alter table public.academic_files
  add constraint academic_files_mime_type_check
  check (mime_type in (
    'application/json',
    'text/plain',
    'application/pdf',
    'image/png',
    'image/jpeg',
    'image/webp',
    'image/gif',
    'application/vnd.openxmlformats-officedocument.wordprocessingml.document'
  ));

update storage.buckets
  set allowed_mime_types = array_append(coalesce(allowed_mime_types, array[]::text[]), 'image/gif')
where id = 'academic-content'
  and not ('image/gif' = any(coalesce(allowed_mime_types, array[]::text[])));
