-- Review discovery returns bounded metadata only. Reviewer membership does not
-- widen academic table RLS or access to question files and Storage objects.
create function public.academic_review_queue(after_submitted_at timestamptz default null, after_id uuid default null) returns jsonb
language sql stable security definer set search_path = '' as $$
  with page as (
    select c.id, c.updated_at as submitted_at,
      jsonb_build_object('id', c.id, 'title', c.title, 'module', c.module, 'term', c.term,
        'current_revision_id', r.id, 'owner_display_name', coalesce(nullif(btrim(p.display_name), ''), 'Account owner'),
        'ready_questions', r.ready_questions, 'review_questions', r.review_questions,
        'submitted_at', c.updated_at) as item
    from public.academic_collections c
    join public.academic_revisions r on r.id = c.current_revision_id and r.collection_id = c.id
    left join public.account_profiles p on p.user_id = c.owner_id
    where auth.uid() is not null
      and exists(select 1 from public.academic_reviewers where user_id = auth.uid())
      and c.visibility = 'shared' and c.review_status = 'pending' and not c.withdrawn and r.status = 'ready'
      and ((after_submitted_at is null and after_id is null)
        or (after_submitted_at is not null and after_id is not null
          and (c.updated_at, c.id) > (after_submitted_at, after_id)))
    order by c.updated_at, c.id
    limit 24
  )
  select coalesce(jsonb_agg(page.item order by page.submitted_at, page.id), '[]'::jsonb) from page;
$$;
-- Existing finish, sharing and withdrawal RPCs update this timestamp. It is the
-- latest submission-state update, not a reconstructed original submission date.
comment on function public.academic_review_queue(timestamptz, uuid) is
  'Reviewer metadata queue. submitted_at is the latest existing collection update from upload completion, sharing or withdrawal state; no original submission timestamp is inferred.';
revoke all on function public.academic_review_queue(timestamptz, uuid) from public, anon;
grant execute on function public.academic_review_queue(timestamptz, uuid) to authenticated;

-- Direct revision SELECT also gates academic_files and Storage reads. A narrow
-- template-only RPC allows review preview without opening those content paths.
create function public.academic_review_preview(collection uuid, revision uuid) returns jsonb
language sql stable security definer set search_path = '' as $$
  select jsonb_build_object('id', r.id, 'collection_id', c.id, 'source_revision', r.source_revision,
    'template_text', r.template_text, 'ready_questions', r.ready_questions, 'review_questions', r.review_questions)
  from public.academic_collections c
  join public.academic_revisions r on r.id = c.current_revision_id and r.collection_id = c.id
  where auth.uid() is not null
    and exists(select 1 from public.academic_reviewers where user_id = auth.uid())
    and c.id = collection and r.id = revision
    and c.visibility = 'shared' and c.review_status = 'pending' and not c.withdrawn and r.status = 'ready';
$$;
revoke all on function public.academic_review_preview(uuid, uuid) from public, anon;
grant execute on function public.academic_review_preview(uuid, uuid) to authenticated;

-- Existing two-argument callers retain their contract. The queue names the
-- previewed revision and holds the collection lock across the existing review
-- operation so a replacement upload cannot receive an unseen approval.
create function public.academic_review(collection uuid, approved boolean, expected_revision uuid) returns void
language plpgsql security definer set search_path = '' as $$
declare current_revision uuid;
begin
  if auth.uid() is null or not exists(select 1 from public.academic_reviewers where user_id = auth.uid()) then
    raise exception 'Reviewer access required' using errcode = '42501';
  end if;
  if approved is null then raise exception 'Review decision required' using errcode = '22004'; end if;
  select c.current_revision_id into current_revision
    from public.academic_collections c
    join public.academic_revisions r on r.id = c.current_revision_id and r.collection_id = c.id
    where c.id = collection and c.visibility = 'shared' and c.review_status = 'pending'
      and not c.withdrawn and r.status = 'ready'
    for update of c;
  if current_revision is null or expected_revision is null or current_revision <> expected_revision then
    raise exception 'The submission changed. Open its current preview before reviewing.' using errcode = '40001';
  end if;
  perform public.academic_review(collection, approved);
end;
$$;
revoke all on function public.academic_review(uuid, boolean, uuid) from public, anon;
grant execute on function public.academic_review(uuid, boolean, uuid) to authenticated;
