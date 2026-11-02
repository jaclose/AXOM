-- Forward-only hardening for the already-applied operator console.
-- Host review data comes only from explicit, current community submissions.
begin;

do $$
begin
  if (select count(*) from public.axom_operator_roles where role = 'owner') > 1 then
    raise exception 'Resolve duplicate operator owners before applying this migration';
  end if;
end $$;
create unique index axom_operator_one_owner
  on public.axom_operator_roles ((role)) where role = 'owner';

drop policy social_reports_create on public.social_post_reports;
create policy social_reports_create on public.social_post_reports for insert to authenticated
with check (reporter_id = (select auth.uid())
  and exists (select 1 from public.social_posts p
    where p.id = post_id and p.visibility <> 'private'));

create or replace function public.axom_operator_overview() returns jsonb
language plpgsql stable security definer set search_path = '' as $$
declare v_role text := public.axom_operator_role();
begin
  if v_role is null then raise exception 'Operator access required' using errcode = '42501'; end if;
  return jsonb_build_object(
    'role',v_role,
    'registered_accounts',case when v_role in ('owner','admin') then (select count(*) from auth.users) else null end,
    'shared_profiles',(select count(*) from public.social_profiles where discoverable),
    'shared_posts',(select count(*) from public.social_posts p
      join public.social_profiles profile on profile.user_id = p.user_id
      where p.visibility = 'community' and profile.discoverable),
    'reports_pending',(select count(*) from public.social_post_reports report
      join public.social_posts post on post.id = report.post_id
      where post.visibility <> 'private'),
    'academic_review_pending',(select count(*) from public.academic_community_submissions submission
      join public.academic_collections collection on collection.id = submission.collection_id
      join public.academic_revisions revision on revision.id = submission.revision_id
        and revision.collection_id = collection.id
      where submission.status = 'pending' and revision.status = 'ready'
        and collection.current_revision_id = revision.id
        and collection.review_status = 'pending' and not collection.withdrawn),
    'academic_approved',(select count(*) from public.academic_community_submissions submission
      join public.academic_collections collection on collection.id = submission.collection_id
      where submission.status = 'approved'
        and collection.current_revision_id = submission.revision_id
        and collection.review_status = 'approved' and collection.visibility = 'shared'
        and not collection.withdrawn),
    'ai_requests_7d',case when v_role in ('owner','admin') then
      (select coalesce(sum(requests),0) from public.ai_usage
        where day >= (now() at time zone 'utc')::date - 6)
      else null end
  );
end $$;

create or replace function public.axom_operator_review_queue()
returns table(collection_id uuid, title text, module text, term text, owner_id uuid, visibility text,
  ready_questions integer, review_questions integer, updated_at timestamptz)
language plpgsql stable security definer set search_path = '' as $$
begin
  if public.axom_operator_role() is null then
    raise exception 'Operator access required' using errcode = '42501';
  end if;
  return query
    select collection.id,collection.title,collection.module,collection.term,
      collection.owner_id,collection.visibility,revision.ready_questions,
      revision.review_questions,collection.updated_at
    from public.academic_community_submissions submission
    join public.academic_collections collection on collection.id = submission.collection_id
    join public.academic_revisions revision on revision.id = submission.revision_id
      and revision.collection_id = collection.id
    where submission.status = 'pending' and revision.status = 'ready'
      and collection.current_revision_id = revision.id
      and collection.review_status = 'pending' and not collection.withdrawn
    order by submission.submitted_at desc, collection.id desc limit 100;
end $$;

create or replace function public.axom_operator_reports()
returns table(post_id uuid, author_handle text, post_kind text, reason text, note text, reports bigint, latest_at timestamptz)
language plpgsql stable security definer set search_path = '' as $$
begin
  if public.axom_operator_role() is null then
    raise exception 'Operator access required' using errcode = '42501';
  end if;
  return query
    select post.id,profile.handle,post.kind,min(report.reason),
      left(string_agg(report.note,'; '),240),count(*),max(report.created_at)
    from public.social_post_reports report
    join public.social_posts post on post.id = report.post_id
    join public.social_profiles profile on profile.user_id = post.user_id
    where post.visibility <> 'private'
    group by post.id,profile.handle,post.kind
    order by max(report.created_at) desc limit 100;
end $$;

-- The old two-argument RPC cannot capture a reason and must not remain callable.
drop function public.axom_operator_resolve_report(uuid,text);
create function public.axom_operator_resolve_report(target uuid, resolution text, reason text)
returns void language plpgsql security definer set search_path = '' as $$
declare actor uuid := auth.uid(); affected integer;
begin
  if public.axom_operator_role() is null then
    raise exception 'Operator access required' using errcode = '42501';
  end if;
  perform private.require_account_write_access();
  if resolution is null or resolution not in ('dismiss','remove') then
    raise exception 'Invalid resolution' using errcode = '22023';
  end if;
  if reason is null or length(trim(reason)) not between 8 and 500 then
    raise exception 'Give a reason of 8 to 500 characters' using errcode = '22023';
  end if;
  perform 1 from public.social_post_reports report
    join public.social_posts post on post.id = report.post_id
    where report.post_id = target and post.visibility <> 'private'
    for update of report, post;
  if not found then raise exception 'Report no longer available' using errcode = '42501'; end if;
  if resolution = 'remove' then
    delete from public.social_posts where id = target;
    get diagnostics affected = row_count;
  else
    delete from public.social_post_reports where post_id = target;
    get diagnostics affected = row_count;
  end if;
  if affected < 1 then raise exception 'No report changed'; end if;
  insert into public.axom_operator_audit(actor_id,action,target_id,metadata)
    values(actor,'social.report.' || resolution,target,
      jsonb_build_object('affected',affected,'reason',trim(reason)));
end $$;
revoke all on function public.axom_operator_resolve_report(uuid,text,text) from public,anon,authenticated;
grant execute on function public.axom_operator_resolve_report(uuid,text,text) to authenticated;

commit;
