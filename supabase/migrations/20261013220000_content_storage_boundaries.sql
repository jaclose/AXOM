-- Permissive Storage policies combine with OR. Protect these buckets even if
-- another feature installs a broad policy for an unrelated object collection.
create policy academic_content_anonymous_boundary on storage.objects as restrictive
for all to anon using (bucket_id <> 'academic-content') with check (bucket_id <> 'academic-content');
create policy academic_content_read_boundary on storage.objects as restrictive
for select to authenticated using (
  bucket_id <> 'academic-content' or exists(select 1 from public.academic_files f where f.object_path=name)
);
create policy academic_content_insert_boundary on storage.objects as restrictive
for insert to authenticated with check (
  bucket_id <> 'academic-content' or exists(select 1 from public.academic_files f join public.academic_revisions r on r.id=f.revision_id
    where f.object_path=name and public.academic_is_owner(r.collection_id) and r.status='uploading')
);
create policy academic_content_update_boundary on storage.objects as restrictive
for update to authenticated using(bucket_id <> 'academic-content') with check(bucket_id <> 'academic-content');
create policy academic_content_delete_boundary on storage.objects as restrictive
for delete to authenticated using(bucket_id <> 'academic-content');

create policy workspace_content_owner_boundary on storage.objects as restrictive
for all to anon,authenticated
using(bucket_id not in ('workspace-media','workspace-content') or
  (auth.uid() is not null and name ~ ('^' || auth.uid()::text || '/[a-f0-9]{64}$')))
with check(bucket_id not in ('workspace-media','workspace-content') or
  (auth.uid() is not null and name ~ ('^' || auth.uid()::text || '/[a-f0-9]{64}$')));
create policy workspace_content_immutable_boundary on storage.objects as restrictive
for update to anon,authenticated using(bucket_id not in ('workspace-media','workspace-content'))
with check(bucket_id not in ('workspace-media','workspace-content'));
