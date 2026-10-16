-- Auth account deletion is the final privacy boundary. An owner with an
-- academic collection must not be made undeletable by the library's foreign
-- keys, and deleting that owner must revoke the shared collection, challenges,
-- enrollments and immutable manifests together.
--
-- Storage bytes are removed and verified through the Storage API before the
-- Auth user is deleted. These cascades cover relational state only.

-- The deletion worker moves a request to processing before enumerating any
-- owner namespace. Authenticated uploads and manifest writes stop at that
-- durable barrier; a reconciliation-required failure keeps the barrier closed
-- until an operator resolves the partially destructive attempt.
create function public.axom_account_accepts_cloud_writes() returns boolean
language sql stable security definer set search_path = '' as $$
  select auth.uid() is not null
  and exists (
    select 1
    from auth.users u
    where u.id = auth.uid()
  )
  and not exists (
    select 1
    from public.privacy_requests p
    where p.user_id = auth.uid()
      and p.kind = 'deletion'
      and (
        p.status = 'processing'
        or (p.status = 'failed' and p.failure_code = 'deletion-reconciliation-required')
      )
  );
$$;
revoke all on function public.axom_account_accepts_cloud_writes() from public, anon;
grant execute on function public.axom_account_accepts_cloud_writes() to authenticated, service_role;

-- The existing share publisher is SECURITY DEFINER, so it bypasses table RLS
-- and can return an existing bearer token without writing a row. Keep its
-- validated/idempotent implementation private and put the account lifecycle
-- gate in a public wrapper that always runs before either return or insertion.
alter function public.create_question_set_share(text, jsonb) set schema axom_private;
alter function axom_private.create_question_set_share(text, jsonb)
  rename to create_question_set_share_without_account_gate;
revoke all on function axom_private.create_question_set_share_without_account_gate(text, jsonb)
  from public, anon, authenticated, service_role;

create function public.create_question_set_share(
  p_source_id text,
  p_snapshot jsonb
) returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
begin
  if not public.axom_account_accepts_cloud_writes() then
    raise exception 'Account is unavailable or deletion cleanup is in progress'
      using errcode = 'PT409';
  end if;
  return axom_private.create_question_set_share_without_account_gate(p_source_id, p_snapshot);
end
$$;

revoke all on function public.create_question_set_share(text, jsonb) from public, anon;
grant execute on function public.create_question_set_share(text, jsonb) to authenticated, service_role;

create policy account_deletion_storage_write_barrier on storage.objects as restrictive
for insert to authenticated with check (
  bucket_id not in ('workspace-media', 'workspace-content', 'workspace-originals', 'academic-content')
  or public.axom_account_accepts_cloud_writes()
);
create policy account_deletion_storage_update_barrier on storage.objects as restrictive
for update to authenticated
using (
  bucket_id not in ('workspace-media', 'workspace-content', 'workspace-originals', 'academic-content')
  or public.axom_account_accepts_cloud_writes()
)
with check (
  bucket_id not in ('workspace-media', 'workspace-content', 'workspace-originals', 'academic-content')
  or public.axom_account_accepts_cloud_writes()
);

create function axom_private.reject_account_cloud_write_during_deletion() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  if auth.uid() is not null and not public.axom_account_accepts_cloud_writes() then
    raise exception 'Account deletion cleanup is in progress' using errcode = 'PT409';
  end if;
  return new;
end;
$$;
revoke all on function axom_private.reject_account_cloud_write_during_deletion() from public, anon, authenticated;
grant execute on function axom_private.reject_account_cloud_write_during_deletion() to service_role;

create trigger account_deletion_workspace_barrier
before insert or update on public.workspaces
for each row execute function axom_private.reject_account_cloud_write_during_deletion();
create trigger account_deletion_workspace_revision_barrier
before insert or update on public.workspace_revisions
for each row execute function axom_private.reject_account_cloud_write_during_deletion();
create trigger account_deletion_sync_conflict_barrier
before insert or update on public.sync_conflicts
for each row execute function axom_private.reject_account_cloud_write_during_deletion();
create trigger account_deletion_academic_collection_barrier
before insert or update on public.academic_collections
for each row execute function axom_private.reject_account_cloud_write_during_deletion();
create trigger account_deletion_academic_revision_barrier
before insert or update on public.academic_revisions
for each row execute function axom_private.reject_account_cloud_write_during_deletion();
create trigger account_deletion_academic_file_barrier
before insert or update on public.academic_files
for each row execute function axom_private.reject_account_cloud_write_during_deletion();

alter table public.academic_collections
  drop constraint academic_collections_owner_id_fkey,
  add constraint academic_collections_owner_id_fkey
    foreign key (owner_id) references auth.users(id) on delete cascade;

alter table public.academic_collections
  drop constraint academic_current_revision_fk,
  add constraint academic_current_revision_fk
    foreign key (current_revision_id) references public.academic_revisions(id) on delete set null;

alter table public.academic_revisions
  drop constraint academic_revisions_collection_id_fkey,
  add constraint academic_revisions_collection_id_fkey
    foreign key (collection_id) references public.academic_collections(id) on delete cascade;

alter table public.academic_files
  drop constraint academic_files_revision_id_fkey,
  add constraint academic_files_revision_id_fkey
    foreign key (revision_id) references public.academic_revisions(id) on delete cascade;

alter table public.academic_enrollments
  drop constraint academic_enrollments_collection_id_fkey,
  add constraint academic_enrollments_collection_id_fkey
    foreign key (collection_id) references public.academic_collections(id) on delete cascade,
  drop constraint academic_enrollments_revision_id_fkey,
  add constraint academic_enrollments_revision_id_fkey
    foreign key (revision_id) references public.academic_revisions(id) on delete cascade;

alter table public.academic_challenges
  drop constraint academic_challenges_collection_id_fkey,
  add constraint academic_challenges_collection_id_fkey
    foreign key (collection_id) references public.academic_collections(id) on delete cascade,
  drop constraint academic_challenges_revision_id_fkey,
  add constraint academic_challenges_revision_id_fkey
    foreign key (revision_id) references public.academic_revisions(id) on delete cascade;

alter table public.academic_challenge_participants
  drop constraint academic_challenge_participants_challenge_id_fkey,
  add constraint academic_challenge_participants_challenge_id_fkey
    foreign key (challenge_id) references public.academic_challenges(id) on delete cascade;

alter table public.academic_challenge_attempts
  drop constraint academic_challenge_attempts_challenge_id_fkey,
  add constraint academic_challenge_attempts_challenge_id_fkey
    foreign key (challenge_id) references public.academic_challenges(id) on delete cascade,
  drop constraint academic_challenge_attempts_challenge_id_user_id_fkey,
  add constraint academic_challenge_attempts_challenge_id_user_id_fkey
    foreign key (challenge_id, user_id)
    references public.academic_challenge_participants(challenge_id, user_id) on delete cascade;
