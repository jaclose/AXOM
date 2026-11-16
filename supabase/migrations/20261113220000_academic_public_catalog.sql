-- Visitors without an account may browse the reviewed course catalog.
--
-- One store and one review path. A course becomes visible to signed-out
-- visitors only when an academic reviewer offers one exact approved, shared
-- revision of their own upload. A later revision is not offered until a
-- reviewer offers it again, and losing approval, sharing or availability ends
-- the offer. Visitors receive bounded catalog metadata and the course plan
-- text. Question files and every Storage object stay behind the existing
-- account rules; no Storage policy changes here.
-- Additive: one nullable column, one log table, one guard trigger and four
-- functions. No existing row, policy, grant or function is rewritten.

alter table public.academic_collections
  add column public_revision_id uuid references public.academic_revisions on delete set null;
create index academic_collection_public on public.academic_collections(module, term, id)
  where public_revision_id is not null and not withdrawn;

-- Append-only record of every offer and withdrawal. Read through a trusted
-- session only; no client role receives access.
create table public.academic_public_offer_log (
  id bigint generated always as identity primary key,
  collection_id uuid not null references public.academic_collections on delete cascade,
  revision_id uuid,
  actor_id uuid references auth.users on delete set null,
  offered boolean not null,
  created_at timestamptz not null default now()
);
create index academic_public_offer_log_collection on public.academic_public_offer_log(collection_id, created_at desc);
alter table public.academic_public_offer_log enable row level security;
revoke all on public.academic_public_offer_log from public, anon, authenticated;
grant all on public.academic_public_offer_log to service_role;

-- The single rule for visitor visibility. Every visitor-facing reader uses it.
create function public.academic_is_public(collection uuid) returns boolean
language sql stable security definer set search_path = '' as $$
  select exists(
    select 1
      from public.academic_collections c
      join public.academic_revisions r on r.id = c.current_revision_id and r.collection_id = c.id
     where c.id = collection
       and not c.withdrawn
       and c.visibility = 'shared'
       and c.review_status = 'approved'
       and c.public_revision_id = c.current_revision_id
       and r.status = 'ready'
       and r.approved_at is not null
  );
$$;
revoke all on function public.academic_is_public(uuid) from public, anon, authenticated;
grant execute on function public.academic_is_public(uuid) to anon, authenticated;

-- An offer never outlives the state it was granted for. Any update that
-- withdraws the course, stops sharing it, removes its approval or makes
-- another revision current clears the offer in the same statement.
create function public.academic_guard_public_offer() returns trigger
language plpgsql set search_path = '' as $$
begin
  if new.public_revision_id is not null and (
    new.withdrawn
    or new.visibility <> 'shared'
    or new.review_status <> 'approved'
    or new.current_revision_id is distinct from new.public_revision_id
  ) then
    new.public_revision_id := null;
  end if;
  return new;
end;
$$;
revoke all on function public.academic_guard_public_offer() from public, anon, authenticated;
create trigger academic_public_offer_guard before update on public.academic_collections
  for each row execute function public.academic_guard_public_offer();

-- Offering is a reviewer's decision about their own reviewed upload, bound to
-- the exact revision they inspected. A contributor's course cannot be offered:
-- there is no record of that contributor's consent to an audience without
-- accounts. The owner or any reviewer can always end an offer.
create function public.academic_offer_publicly(collection uuid, offered boolean, expected_revision uuid) returns void
language plpgsql security definer set search_path = '' as $$
declare
  target public.academic_collections%rowtype;
  reviewer boolean;
begin
  if auth.uid() is null then raise exception 'Sign in required' using errcode = '42501'; end if;
  if offered is null then raise exception 'Decision required' using errcode = '22004'; end if;
  select c.* into target from public.academic_collections c where c.id = collection for update;
  if not found then raise exception 'Collection unavailable' using errcode = '42501'; end if;
  reviewer := exists(select 1 from public.academic_reviewers where user_id = auth.uid());
  if offered then
    if not reviewer then raise exception 'Reviewer access required' using errcode = '42501'; end if;
    if target.owner_id <> auth.uid() then
      raise exception 'Only the reviewer who owns this course can offer it to visitors' using errcode = '42501';
    end if;
    if expected_revision is null or target.current_revision_id is distinct from expected_revision then
      raise exception 'The course changed. Open its current revision before offering it.' using errcode = '40001';
    end if;
    if target.withdrawn or target.visibility <> 'shared' or target.review_status <> 'approved'
      or not exists(
        select 1 from public.academic_revisions r
         where r.id = target.current_revision_id and r.collection_id = target.id
           and r.status = 'ready' and r.approved_at is not null
      ) then
      raise exception 'Only an approved, shared course can be offered to visitors' using errcode = '42501';
    end if;
    update public.academic_collections set public_revision_id = target.current_revision_id, updated_at = now()
      where id = collection;
  else
    if target.owner_id <> auth.uid() and not reviewer then
      raise exception 'Collection unavailable' using errcode = '42501';
    end if;
    update public.academic_collections set public_revision_id = null, updated_at = now()
      where id = collection;
  end if;
  insert into public.academic_public_offer_log(collection_id, revision_id, actor_id, offered)
  values (collection, case when offered then target.current_revision_id else target.public_revision_id end, auth.uid(), offered);
end;
$$;
revoke all on function public.academic_offer_publicly(uuid, boolean, uuid) from public, anon;
grant execute on function public.academic_offer_publicly(uuid, boolean, uuid) to authenticated;

-- The visitor catalog pages in the same curriculum order and with the same
-- keyset cursor as academic_catalog. It carries no owner, reviewer, sharing or
-- pending-review detail.
create function public.academic_public_catalog(search text default '', term_filter text default '', after_id uuid default null) returns jsonb
language sql stable security definer set search_path = '' as $$
  with cursor_row as (
    select coalesce(substring(c.term from '^Term ([0-9]{1,2})$')::integer, 1000) as term_rank,
      lower(c.module) as module_key, lower(c.title) as title_key, c.id
    from public.academic_collections c
    where c.id = after_id and public.academic_is_public(c.id)
  ), page as (
    select c.id,
      coalesce(substring(c.term from '^Term ([0-9]{1,2})$')::integer, 1000) as term_rank,
      lower(c.module) as module_key, lower(c.title) as title_key,
      jsonb_build_object('id',c.id,'title',c.title,'module',c.module,'term',c.term,
        'academic_term',c.academic_term,'cohort',c.cohort,
        'current_revision_id',c.current_revision_id,
        'ready_questions',r.ready_questions,
        'has_plan',length(btrim(r.template_text)) > 0) as item
    from public.academic_collections c join public.academic_revisions r on r.id = c.current_revision_id
    where c.public_revision_id is not null and public.academic_is_public(c.id)
      and (term_filter = '' or c.term = term_filter)
      and (search = '' or (c.title||' '||c.module) ilike '%'||left(search,120)||'%')
      and (after_id is null or (
        coalesce(substring(c.term from '^Term ([0-9]{1,2})$')::integer, 1000), lower(c.module), lower(c.title), c.id
      ) > (select term_rank, module_key, title_key, id from cursor_row))
    order by term_rank, module_key, title_key, c.id
    limit 24
  )
  select coalesce(jsonb_agg(page.item order by page.term_rank, page.module_key, page.title_key, page.id), '[]'::jsonb)
  from page;
$$;
revoke all on function public.academic_public_catalog(text, text, uuid) from public, anon, authenticated;
grant execute on function public.academic_public_catalog(text, text, uuid) to anon, authenticated;

-- One offered course with its plan text, for a visitor's weekly preview.
create function public.academic_public_course(collection uuid) returns jsonb
language sql stable security definer set search_path = '' as $$
  select jsonb_build_object('id',c.id,'title',c.title,'module',c.module,'term',c.term,
    'academic_term',c.academic_term,'cohort',c.cohort,
    'current_revision_id',c.current_revision_id,
    'ready_questions',r.ready_questions,
    'source_revision',r.source_revision,
    'template_text',r.template_text)
  from public.academic_collections c join public.academic_revisions r on r.id = c.current_revision_id
  where c.id = collection and public.academic_is_public(c.id);
$$;
revoke all on function public.academic_public_course(uuid) from public, anon, authenticated;
grant execute on function public.academic_public_course(uuid) to anon, authenticated;

notify pgrst, 'reload schema';
