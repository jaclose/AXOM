-- An official approval requires a reviewer to inspect the immutable, current
-- Storage revision and attest that every answer-ready question has a rationale.
-- Postgres cannot inspect private Storage JSON. These counts are the reviewer's
-- authenticated client readback observation, not a server content audit.
create table public.academic_explanation_attestations (
  revision_id uuid primary key references public.academic_revisions(id) on delete cascade,
  collection_id uuid not null references public.academic_collections(id) on delete cascade,
  content_hash text not null check (content_hash ~ '^[a-f0-9]{64}$'),
  observed_ready_questions integer not null check (observed_ready_questions > 0),
  observed_explained_questions integer not null,
  reviewer_id uuid not null references auth.users(id),
  attested_at timestamptz not null default now(),
  check (observed_explained_questions = observed_ready_questions)
);
alter table public.academic_explanation_attestations enable row level security;
revoke all on public.academic_explanation_attestations from public, anon, authenticated;
grant all on public.academic_explanation_attestations to service_role;

-- A reviewer needs the exact current stored banks to examine the rationale.
-- Ordinary learners still need approval, except for a separately submitted
-- unreviewed community revision. The existing Storage policy follows this
-- file-manifest RLS decision, so no bucket-wide listing grant is added.
create function public.academic_reviewer_can_read_current(revision uuid) returns boolean
language sql stable security definer set search_path = '' as $$
  select auth.uid() is not null and exists (
    select 1 from public.academic_collections c
    join public.academic_revisions r on r.id = c.current_revision_id and r.collection_id = c.id
    where r.id = revision and r.status = 'ready' and c.review_status = 'pending'
      and c.visibility in ('shared', 'group') and not c.withdrawn
      and exists(select 1 from public.academic_reviewers ar where ar.user_id = auth.uid())
  );
$$;
revoke all on function public.academic_reviewer_can_read_current(uuid) from public, anon;
grant execute on function public.academic_reviewer_can_read_current(uuid) to authenticated;
create policy academic_reviewer_pending_file_read on public.academic_files
  for select to authenticated using (public.academic_reviewer_can_read_current(revision_id));

-- Only an appointed reviewer may receive the hash needed to bind a readback
-- receipt. This never exposes source provenance or question text in the RPC.
create function public.academic_explanation_review_target(collection uuid, revision uuid)
returns jsonb language sql stable security definer set search_path = '' as $$
  select jsonb_build_object('collection_id', c.id, 'revision_id', r.id,
    'content_hash', r.content_hash, 'ready_questions', r.ready_questions)
  from public.academic_collections c
  join public.academic_revisions r on r.id = c.current_revision_id and r.collection_id = c.id
  where c.id = collection and r.id = revision and r.status = 'ready'
    and c.review_status = 'pending' and not c.withdrawn
    and exists(select 1 from public.academic_reviewers ar where ar.user_id = auth.uid())
    and (c.visibility in ('shared','group')
      or exists(select 1 from public.academic_community_submissions s
        where s.collection_id = c.id and s.revision_id = r.id and s.status = 'pending'));
$$;
revoke all on function public.academic_explanation_review_target(uuid,uuid) from public, anon;
grant execute on function public.academic_explanation_review_target(uuid,uuid) to authenticated;

create function public.academic_attest_explanations(
  collection uuid, revision uuid, content_hash text,
  observed_ready_questions integer, observed_explained_questions integer,
  rationale_reviewed boolean
) returns void language plpgsql security definer set search_path = '' as $$
declare current_revision public.academic_revisions%rowtype;
begin
  if auth.uid() is null or not exists (
    select 1 from public.academic_reviewers ar where ar.user_id = auth.uid()
  ) then raise exception 'Reviewer access required' using errcode = '42501'; end if;
  if rationale_reviewed is distinct from true then
    raise exception 'Reviewer rationale attestation required' using errcode = '22023';
  end if;
  perform 1 from public.academic_collections c
    where c.id = collection and c.current_revision_id = revision
      and c.review_status = 'pending' and not c.withdrawn
      and (c.visibility in ('shared','group') or exists (
        select 1 from public.academic_community_submissions s
        where s.collection_id = c.id and s.revision_id = revision and s.status = 'pending'))
    for update;
  if not found then raise exception 'The current revision changed. Check it again.' using errcode = '40001'; end if;
  select * into current_revision from public.academic_revisions r
    where r.id = revision and r.collection_id = collection and r.status = 'ready';
  if not found or current_revision.content_hash is distinct from content_hash then
    raise exception 'The current revision changed. Check it again.' using errcode = '40001';
  end if;
  if current_revision.ready_questions = 0
    or observed_ready_questions is distinct from current_revision.ready_questions
    or observed_explained_questions is distinct from current_revision.ready_questions then
    raise exception 'Every ready question needs an explanation before approval' using errcode = '22023';
  end if;
  insert into public.academic_explanation_attestations(
    revision_id, collection_id, content_hash, observed_ready_questions,
    observed_explained_questions, reviewer_id
  ) values (
    revision, collection, content_hash, observed_ready_questions,
    observed_explained_questions, auth.uid()
  ) on conflict (revision_id) do update set
    content_hash = excluded.content_hash,
    observed_ready_questions = excluded.observed_ready_questions,
    observed_explained_questions = excluded.observed_explained_questions,
    reviewer_id = excluded.reviewer_id,
    attested_at = now();
end;
$$;
revoke all on function public.academic_attest_explanations(uuid,uuid,text,integer,integer,boolean) from public, anon;
grant execute on function public.academic_attest_explanations(uuid,uuid,text,integer,integer,boolean) to authenticated;

-- Existing clients may still reject or withdraw approval. Approval without a
-- revision-bound attestation fails closed through both original RPC names.
create or replace function public.academic_review(collection uuid, approved boolean) returns void
language plpgsql security definer set search_path = '' as $$
declare current_revision public.academic_revisions%rowtype;
begin
  if not exists(select 1 from public.academic_reviewers where user_id = auth.uid()) then
    raise exception 'Reviewer access required' using errcode = '42501';
  end if;
  if approved is null then raise exception 'Review decision required' using errcode = '22004'; end if;
  perform 1 from public.academic_collections c where c.id = collection for update;
  select r.* into current_revision from public.academic_collections c
    join public.academic_revisions r on r.id = c.current_revision_id and r.collection_id = c.id
    where c.id = collection and r.status = 'ready' and not c.withdrawn;
  if not found then raise exception 'Ready revision required'; end if;
  if exists(select 1 from public.academic_community_submissions s
    where s.collection_id = collection and s.revision_id = current_revision.id) then
    raise exception 'Use exact community revision review' using errcode = '42501';
  end if;
  if approved and not exists(
    select 1 from public.academic_explanation_attestations a
    where a.collection_id = collection and a.revision_id = current_revision.id
      and a.content_hash = current_revision.content_hash
      and a.observed_ready_questions = current_revision.ready_questions
      and a.observed_explained_questions = current_revision.ready_questions
      and current_revision.ready_questions > 0
  ) then raise exception 'Explanation review attestation required for this revision' using errcode = '42501'; end if;
  update public.academic_collections set
    review_status = case when approved then 'approved' else 'rejected' end,
    updated_at = now() where id = collection;
  update public.academic_revisions set approved_at = case when approved then now() else null end
    where id = current_revision.id;
  if not approved then
    delete from public.academic_explanation_attestations where revision_id = current_revision.id;
  end if;
end;
$$;

create or replace function public.academic_community_review(
  collection uuid, revision uuid, approved boolean
) returns void language plpgsql security definer set search_path = '' as $$
declare prior_status text; current_revision_id uuid; current_revision public.academic_revisions%rowtype;
begin
  if auth.uid() is null or not exists (
    select 1 from public.academic_reviewers where user_id = auth.uid()
  ) then raise exception 'Reviewer access required' using errcode = '42501'; end if;
  if approved is null then raise exception 'Review decision required' using errcode = '22004'; end if;
  select s.status, r.id into prior_status, current_revision_id
    from public.academic_collections c
    join public.academic_revisions r on r.id = c.current_revision_id and r.collection_id = c.id
    join public.academic_community_submissions s on s.collection_id = c.id and s.revision_id = r.id
    where c.id = collection and r.id = revision and r.status = 'ready' and not c.withdrawn
      and (s.status <> 'pending' or c.review_status = 'pending')
      and (s.status <> 'approved' or c.review_status = 'approved')
    for update of c, s;
  if prior_status is null or (prior_status <> 'pending' and not (prior_status = 'approved' and not approved)) then
    raise exception 'The submission changed. Open its current revision before reviewing.' using errcode = '40001';
  end if;
  select * into current_revision from public.academic_revisions where id = current_revision_id;
  if approved and not exists(
    select 1 from public.academic_explanation_attestations a
    where a.collection_id = collection and a.revision_id = revision
      and a.content_hash = current_revision.content_hash
      and a.observed_ready_questions = current_revision.ready_questions
      and a.observed_explained_questions = current_revision.ready_questions
      and current_revision.ready_questions > 0
  ) then raise exception 'Explanation review attestation required for this revision' using errcode = '42501'; end if;
  update public.academic_community_submissions s
    set status = case when approved then 'approved' else 'rejected' end,
      reviewed_at = now(), reviewer_id = auth.uid()
    where s.collection_id = collection and s.revision_id = revision;
  update public.academic_revisions r set approved_at = case when approved then now() else null end
    where r.id = revision;
  if not approved then
    delete from public.academic_explanation_attestations where revision_id = revision;
  end if;
  update public.academic_collections c
    set visibility = case when approved then 'shared' else c.visibility end,
      group_id = case when approved then null else c.group_id end,
      review_status = case when approved then 'approved' else 'rejected' end,
      updated_at = now()
    where c.id = collection;
end;
$$;
