-- The shared academic catalog pages in curriculum order: Term 1 to Term 5,
-- then module, then title. Ordering by collection UUID scattered one term's
-- modules across pages once a library held more than 24 courses.
--
-- The signature and the after_id cursor are unchanged, so existing clients keep
-- working: the server resolves the cursor row's sort key. A cursor that no
-- longer exists yields an empty page instead of restarting from the top.
-- Visibility, review and withdrawal rules are exactly those of the previous
-- definition; only the order of an already permitted page changes.
create or replace function public.academic_catalog(search text default '', term_filter text default '', after_id uuid default null) returns jsonb
language sql stable security definer set search_path = '' as $$
  with cursor_row as (
    select coalesce(substring(c.term from '^Term ([0-9]{1,2})$')::integer, 1000) as term_rank,
      lower(c.module) as module_key, lower(c.title) as title_key, c.id
    from public.academic_collections c
    where c.id = after_id
  ), page as (
    select c.id,
      coalesce(substring(c.term from '^Term ([0-9]{1,2})$')::integer, 1000) as term_rank,
      lower(c.module) as module_key, lower(c.title) as title_key,
      jsonb_build_object('id',c.id,'title',c.title,'module',c.module,'term',c.term,
        'academic_term',c.academic_term,'cohort',c.cohort,'visibility',c.visibility,'review_status',c.review_status,
        'current_revision_id',c.current_revision_id,'owned',c.owner_id=auth.uid(),
        'ready_questions',r.ready_questions,'review_questions',r.review_questions) as item
    from public.academic_collections c join public.academic_revisions r on r.id=c.current_revision_id
    where auth.uid() is not null and public.academic_can_read(c.id) and not c.withdrawn
      and (c.owner_id=auth.uid() or r.approved_at is not null)
      and (term_filter='' or c.term=term_filter)
      and (search='' or (c.title||' '||c.module) ilike '%'||left(search,120)||'%')
      and (after_id is null or (
        coalesce(substring(c.term from '^Term ([0-9]{1,2})$')::integer, 1000), lower(c.module), lower(c.title), c.id
      ) > (select term_rank, module_key, title_key, id from cursor_row))
    order by term_rank, module_key, title_key, c.id
    limit 24
  )
  select coalesce(jsonb_agg(page.item order by page.term_rank, page.module_key, page.title_key, page.id), '[]'::jsonb)
  from page;
$$;
revoke all on function public.academic_catalog(text,text,uuid) from public, anon;
grant execute on function public.academic_catalog(text,text,uuid) to authenticated;

-- A signed-in account may ask whether it is an academic reviewer, so the app
-- offers review controls only to reviewers. Membership itself stays a
-- service-role decision; academic_review() remains the enforcement point.
create function public.academic_is_reviewer() returns boolean
language sql stable security definer set search_path = '' as $$
  select auth.uid() is not null
    and exists(select 1 from public.academic_reviewers where user_id = auth.uid());
$$;
revoke all on function public.academic_is_reviewer() from public, anon;
grant execute on function public.academic_is_reviewer() to authenticated;
