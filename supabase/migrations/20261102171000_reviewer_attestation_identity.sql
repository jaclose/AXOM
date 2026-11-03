-- The approving academic reviewer must be the reviewer who inspected and
-- attested to this exact revision. A second reviewer can reject, but cannot
-- approve on another reviewer's attestation. Keep the prior gate and grants.
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
    where a.reviewer_id = auth.uid()
      and a.collection_id = collection and a.revision_id = current_revision.id
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
    where a.reviewer_id = auth.uid()
      and a.collection_id = collection and a.revision_id = revision
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
