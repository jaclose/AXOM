-- A community submission is an explicit, revision-bound invitation to inspect
-- unreviewed material. It never enters the approved course catalog by itself.
create table public.academic_community_submissions (
  collection_id uuid not null references public.academic_collections(id) on delete cascade,
  revision_id uuid not null references public.academic_revisions(id) on delete cascade,
  status text not null default 'pending' check (status in ('pending','approved','rejected','withdrawn')),
  submitted_at timestamptz not null default now(),
  rights_attested_at timestamptz not null,
  reviewed_at timestamptz,
  reviewer_id uuid references auth.users(id) on delete set null,
  primary key (collection_id, revision_id)
);
create index academic_community_pending_page
  on public.academic_community_submissions(submitted_at desc, collection_id desc)
  where status = 'pending';
alter table public.academic_community_submissions enable row level security;
revoke all on public.academic_community_submissions from public, anon, authenticated;
grant all on public.academic_community_submissions to service_role;

-- Keep academic_can_read(), enrollment, and the official catalog restricted to
-- approved revisions. This separate permission opens only the submitted
-- current revision to signed-in community readers and reviewers.
create function public.academic_community_can_read(revision uuid) returns boolean
language sql stable security definer set search_path = '' as $$
  select auth.uid() is not null and exists (
    select 1 from public.academic_collections c
    join public.academic_revisions r on r.id = c.current_revision_id and r.collection_id = c.id
    join public.academic_community_submissions s on s.collection_id = c.id and s.revision_id = r.id
    where r.id = revision and r.status = 'ready' and c.review_status = 'pending'
      and s.status = 'pending' and not c.withdrawn
  );
$$;
revoke all on function public.academic_community_can_read(uuid) from public, anon;
grant execute on function public.academic_community_can_read(uuid) to authenticated;

create policy academic_community_collection_read on public.academic_collections
  for select to authenticated using (public.academic_community_can_read(current_revision_id));
-- Revision rows contain full provenance. Keep them private until approval;
-- community readers receive a bounded preview below and only the explicit
-- file manifest needed for a checksum-verified download.
create policy academic_community_file_read on public.academic_files
  for select to authenticated using (public.academic_community_can_read(revision_id));
-- The restrictive academic-content Storage policy already requires a visible
-- file-manifest row, so this permission opens only submitted content objects.

create function public.academic_community_preview(collection uuid, revision uuid) returns jsonb
language sql stable security definer set search_path = '' as $$
  select jsonb_build_object(
    'id', r.id, 'collection_id', c.id, 'source_revision', r.source_revision,
    'template_text', r.template_text, 'ready_questions', r.ready_questions,
    'review_questions', r.review_questions
  )
  from public.academic_collections c
  join public.academic_revisions r on r.id = c.current_revision_id and r.collection_id = c.id
  where c.id = collection and r.id = revision and public.academic_community_can_read(r.id);
$$;
revoke all on function public.academic_community_preview(uuid,uuid) from public, anon;
grant execute on function public.academic_community_preview(uuid,uuid) to authenticated;

create function public.academic_community_catalog(
  search text default '', term_filter text default '',
  after_submitted_at timestamptz default null, after_id uuid default null
) returns jsonb
language sql stable security definer set search_path = '' as $$
  with page as (
    select c.id, s.submitted_at,
      jsonb_build_object(
        'id', c.id, 'title', c.title, 'module', c.module, 'term', c.term,
        'current_revision_id', r.id, 'ready_questions', r.ready_questions,
        'review_questions', r.review_questions, 'submitted_at', s.submitted_at,
        'owned', c.owner_id = auth.uid(), 'status', 'unreviewed'
      ) as item
    from public.academic_community_submissions s
    join public.academic_collections c on c.id = s.collection_id
    join public.academic_revisions r on r.id = s.revision_id and r.collection_id = c.id
    where auth.uid() is not null and s.status = 'pending' and r.status = 'ready'
      and c.current_revision_id = r.id and c.review_status = 'pending' and not c.withdrawn
      and (coalesce(term_filter, '') = '' or c.term = term_filter)
      and (coalesce(search, '') = '' or (c.title || ' ' || c.module) ilike '%' || left(search, 120) || '%')
      and ((after_submitted_at is null and after_id is null)
        or (after_submitted_at is not null and after_id is not null
          and (s.submitted_at, c.id) < (after_submitted_at, after_id)))
    order by s.submitted_at desc, c.id desc limit 24
  )
  select coalesce(jsonb_agg(page.item order by page.submitted_at desc, page.id desc), '[]'::jsonb)
  from page;
$$;
revoke all on function public.academic_community_catalog(text,text,timestamptz,uuid) from public, anon;
grant execute on function public.academic_community_catalog(text,text,timestamptz,uuid) to authenticated;

create function public.academic_submit_community(
  collection uuid, revision uuid, rights_attested boolean
) returns void
language plpgsql security definer set search_path = '' as $$
declare existing_status text;
begin
  if auth.uid() is null then raise exception 'Sign in to submit a community upload' using errcode = '42501'; end if;
  if rights_attested is distinct from true then raise exception 'Sharing rights must be confirmed' using errcode = '22023'; end if;
  perform 1 from public.academic_collections c
    join public.academic_revisions r on r.id = c.current_revision_id and r.collection_id = c.id
    where c.id = collection and c.owner_id = auth.uid() and r.id = revision
      and r.status = 'ready' and r.ready_questions + r.review_questions > 0
      and c.review_status = 'pending' and not c.withdrawn
    for update of c;
  if not found then raise exception 'Current ready question revision required' using errcode = '42501'; end if;
  select s.status into existing_status from public.academic_community_submissions s
    where s.collection_id = collection and s.revision_id = revision;
  if existing_status = 'pending' then return; end if;
  if existing_status is not null then raise exception 'Submit a new revision after a completed review'; end if;
  insert into public.academic_community_submissions(collection_id, revision_id, rights_attested_at)
    values (collection, revision, now());
end;
$$;
revoke all on function public.academic_submit_community(uuid,uuid,boolean) from public, anon;
grant execute on function public.academic_submit_community(uuid,uuid,boolean) to authenticated;

create function public.academic_community_withdraw(collection uuid, revision uuid) returns void
language plpgsql security definer set search_path = '' as $$
begin
  if auth.uid() is null then raise exception 'Sign in to withdraw a community upload' using errcode = '42501'; end if;
  perform 1 from public.academic_collections c where c.id = collection and c.owner_id = auth.uid() for update;
  if not found then raise exception 'Community upload unavailable' using errcode = '42501'; end if;
  update public.academic_community_submissions s set status = 'withdrawn'
    where s.collection_id = collection and s.revision_id = revision and s.status = 'pending';
  if not found then raise exception 'Pending community upload unavailable' using errcode = '42501'; end if;
end;
$$;
revoke all on function public.academic_community_withdraw(uuid,uuid) from public, anon;
grant execute on function public.academic_community_withdraw(uuid,uuid) to authenticated;

create function public.academic_community_review(
  collection uuid, revision uuid, approved boolean
) returns void
language plpgsql security definer set search_path = '' as $$
declare prior_status text;
begin
  if auth.uid() is null or not exists (
    select 1 from public.academic_reviewers where user_id = auth.uid()
  ) then raise exception 'Reviewer access required' using errcode = '42501'; end if;
  if approved is null then raise exception 'Review decision required' using errcode = '22004'; end if;
  select s.status into prior_status from public.academic_collections c
    join public.academic_revisions r on r.id = c.current_revision_id and r.collection_id = c.id
    join public.academic_community_submissions s on s.collection_id = c.id and s.revision_id = r.id
    where c.id = collection and r.id = revision and r.status = 'ready' and not c.withdrawn
    for update of c, s;
  if prior_status is null or (prior_status <> 'pending' and not (prior_status = 'approved' and not approved)) then
    raise exception 'The submission changed. Open its current revision before reviewing.' using errcode = '40001';
  end if;
  update public.academic_community_submissions s
    set status = case when approved then 'approved' else 'rejected' end,
      reviewed_at = now(), reviewer_id = auth.uid()
    where s.collection_id = collection and s.revision_id = revision;
  update public.academic_revisions r set approved_at = case when approved then now() else null end
    where r.id = revision;
  update public.academic_collections c
    set visibility = case when approved then 'shared' else c.visibility end,
      group_id = case when approved then null else c.group_id end,
      review_status = case when approved then 'approved' else 'rejected' end,
      updated_at = now()
    where c.id = collection;
end;
$$;
revoke all on function public.academic_community_review(uuid,uuid,boolean) from public, anon;
grant execute on function public.academic_community_review(uuid,uuid,boolean) to authenticated;

-- The older two-argument review remains for ordinary owned-course sharing.
-- A community submission always requires the exact revision named above.
create or replace function public.academic_review(collection uuid, approved boolean) returns void
language plpgsql security definer set search_path = '' as $$
declare current_revision uuid;
begin
  if not exists(select 1 from public.academic_reviewers where user_id = auth.uid()) then
    raise exception 'Reviewer access required' using errcode='42501';
  end if;
  select c.current_revision_id into current_revision from public.academic_collections c
    where c.id = collection for update;
  if current_revision is null then raise exception 'Ready revision required'; end if;
  if exists(select 1 from public.academic_community_submissions s
    where s.collection_id = collection and s.revision_id = current_revision) then
    raise exception 'Use exact community revision review' using errcode = '42501';
  end if;
  update public.academic_collections set review_status=case when approved then 'approved' else 'rejected' end,updated_at=now()
    where id=collection and current_revision_id is not null;
  update public.academic_revisions set approved_at=case when approved then now() else null end
    where id=current_revision;
end;
$$;
