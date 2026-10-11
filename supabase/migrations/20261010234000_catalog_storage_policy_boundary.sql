-- Existing permissive policies must not accidentally expose this new bucket.
-- Restrictive policies intersect with permissive ones; other buckets are unchanged.
begin;
create policy academic_object_read_boundary on storage.objects as restrictive
for select to anon, authenticated using (
  bucket_id <> 'academic-catalog' or exists (
    select 1 from public.academic_catalog_files f
    where f.storage_path = storage.objects.name
      and public.can_read_academic_release(f.release_id)
  )
);
create policy academic_object_insert_boundary on storage.objects as restrictive
for insert to anon, authenticated with check (bucket_id <> 'academic-catalog');
create policy academic_object_update_boundary on storage.objects as restrictive
for update to anon, authenticated
using (bucket_id <> 'academic-catalog') with check (bucket_id <> 'academic-catalog');
create policy academic_object_delete_boundary on storage.objects as restrictive
for delete to anon, authenticated using (bucket_id <> 'academic-catalog');
commit;
