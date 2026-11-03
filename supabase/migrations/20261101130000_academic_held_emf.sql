-- Preserve verified EMF bytes used only by held academic questions. The web
-- installer still refuses EMF as a learner attachment; reviewers use the
-- original source and a verified viewable derivative before practice.
do $$
begin
  if not exists (
    select 1 from storage.buckets
    where id = 'academic-content' and public = false
      and allowed_mime_types @> array[
        'application/json', 'image/png', 'image/jpeg', 'image/webp', 'image/gif'
      ]::text[]
  ) then
    raise exception 'Private academic-content bucket with GIF support is required before preserving held EMF';
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
    'image/emf',
    'application/vnd.openxmlformats-officedocument.wordprocessingml.document'
  ));

update storage.buckets
  set allowed_mime_types = array_append(allowed_mime_types, 'image/emf')
where id = 'academic-content'
  and not ('image/emf' = any(allowed_mime_types));
