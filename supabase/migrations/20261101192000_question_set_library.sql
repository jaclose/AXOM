-- Searchable, reviewed Question Sets. A submission is a deliberate copy of the
-- existing privacy-stripped share snapshot, independent of seven-day bearer links.
-- Approval is reserved for academic reviewers; operator roles alone cannot
-- certify medical answers or distribution rights.
begin;

create table public.question_set_library_entries (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null references auth.users(id) on delete cascade,
  source_id text not null check (length(source_id) between 1 and 200),
  title text not null check (length(title) between 1 and 200),
  credit text not null default '' check (length(credit) <= 80),
  tags text[] not null default '{}',
  question_count integer not null check (question_count between 1 and 1000),
  snapshot_payload jsonb not null,
  status text not null default 'pending' check (status in ('pending','approved','rejected')),
  review_note text not null default '',
  reviewed_by uuid references auth.users(id) on delete set null,
  reviewed_at timestamptz,
  created_at timestamptz not null default now(),
  approved_at timestamptz,
  unique (owner_id, source_id),
  check (octet_length(snapshot_payload::text) <= 5000000)
);
create index question_set_library_search on public.question_set_library_entries(status, approved_at desc, id);
create index question_set_library_owner on public.question_set_library_entries(owner_id, created_at desc);

create table public.question_set_library_likes (
  entry_id uuid not null references public.question_set_library_entries(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  created_at timestamptz not null default now(),
  primary key (entry_id, user_id)
);

alter table public.question_set_library_entries enable row level security;
alter table public.question_set_library_likes enable row level security;
revoke all on public.question_set_library_entries, public.question_set_library_likes from public, anon, authenticated;
grant all on public.question_set_library_entries, public.question_set_library_likes to service_role;

-- RLS defaults to deny every direct learner table access. The narrowly scoped
-- functions below project approved search data, owner status and reviewer work.

-- No direct learner writes to submissions. Check the exact projected share
-- schema again on the server so a custom client cannot add private workspace
-- fields or call an unanswered set a publishable Question Set.
create function public.submit_question_set_library(
  p_source_id text, p_snapshot jsonb, p_credit text, p_rights_confirmed boolean, p_answers_confirmed boolean
) returns uuid
language plpgsql security definer set search_path = '' as $$
declare
  v_owner uuid := auth.uid();
  v_question jsonb;
  v_option jsonb;
  v_key text;
  v_index integer := 0;
  v_existing public.question_set_library_entries;
  v_id uuid;
begin
  if v_owner is null then raise exception 'Sign in to submit a Question Set' using errcode='42501'; end if;
  perform private.require_account_write_access();
  if p_rights_confirmed is distinct from true or p_answers_confirmed is distinct from true then
    raise exception 'Confirm distribution rights and answer review before submitting' using errcode='22023';
  end if;
  if p_source_id is null or p_source_id <> btrim(p_source_id) or length(p_source_id) not between 1 and 200
    or p_credit is null or length(p_credit) > 80 then
    raise exception 'Invalid Question Set identity or credit' using errcode='22023';
  end if;
  if jsonb_typeof(p_snapshot) is distinct from 'object' or octet_length(p_snapshot::text) > 5000000
    or p_snapshot->>'shareFormatVersion' is distinct from '1'
    or length(coalesce(p_snapshot->>'title','')) not between 1 and 200
    or length(coalesce(p_snapshot->>'copyrightNotice','')) not between 1 and 500
    or length(coalesce(p_snapshot->>'createdAt','')) < 10
    or jsonb_typeof(p_snapshot->'tags') is distinct from 'array'
    or jsonb_array_length(p_snapshot->'tags') > 100
    or jsonb_typeof(p_snapshot->'questions') is distinct from 'array'
    or jsonb_array_length(p_snapshot->'questions') not between 1 and 1000
    or jsonb_typeof(p_snapshot->'orderedQuestionIds') is distinct from 'array'
    or jsonb_array_length(p_snapshot->'orderedQuestionIds') <> jsonb_array_length(p_snapshot->'questions')
    or exists (select 1 from pg_catalog.jsonb_object_keys(p_snapshot) k
      where k not in ('shareFormatVersion','title','tags','orderedQuestionIds','questions','createdAt','copyrightNotice')) then
    raise exception 'Invalid Question Set snapshot' using errcode='22023';
  end if;
  if exists (select 1 from pg_catalog.jsonb_array_elements(p_snapshot->'tags') t
      where jsonb_typeof(t) <> 'string' or length(t #>> '{}') > 64)
    or (select count(distinct value #>> '{}') from pg_catalog.jsonb_array_elements(p_snapshot->'orderedQuestionIds'))
      <> jsonb_array_length(p_snapshot->'orderedQuestionIds') then
    raise exception 'Invalid Question Set tags or membership' using errcode='22023';
  end if;
  for v_question in select value from pg_catalog.jsonb_array_elements(p_snapshot->'questions') loop
    v_key := v_question->>'correctKey';
    if jsonb_typeof(v_question) is distinct from 'object'
      or length(coalesce(v_question->>'stem','')) < 1
      or length(coalesce(v_question->>'stem','')) > 8000
      or length(coalesce(v_question->>'id','')) not between 1 and 200
      or p_snapshot->'orderedQuestionIds'->>v_index is distinct from v_question->>'id'
      or length(coalesce(v_question->>'explanation','')) > 30000
      or length(coalesce(v_question->>'citation','')) > 2000
      or length(coalesce(v_question->>'system','')) > 500
      or length(coalesce(v_question->>'topic','')) > 500
      or length(coalesce(v_question->>'objective','')) > 500
      or length(coalesce(v_question->>'category','')) > 500
      or length(coalesce(v_question->>'subcategory','')) > 500
      or jsonb_typeof(v_question->'tags') is distinct from 'array'
      or jsonb_array_length(v_question->'tags') > 100
      or jsonb_typeof(v_question->'options') is distinct from 'array'
      or jsonb_array_length(v_question->'options') not between 2 and 26
      or v_key is null
      or exists (select 1 from pg_catalog.jsonb_object_keys(v_question) k where k not in
        ('id','stem','options','correctKey','correctAnswerText','explanation','choiceRationales',
         'system','topic','objective','category','subcategory','tags','citation')) then
      raise exception 'Each submitted question needs a reviewed answer and safe fields' using errcode='22023';
    end if;
    if not exists (select 1 from pg_catalog.jsonb_array_elements(v_question->'options') o
      where o->>'key' = v_key) then
      raise exception 'A submitted answer does not match its choices' using errcode='22023';
    end if;
    if (select count(distinct o->>'key') from pg_catalog.jsonb_array_elements(v_question->'options') o)
      <> jsonb_array_length(v_question->'options')
      or exists (select 1 from pg_catalog.jsonb_array_elements(v_question->'tags') t
        where jsonb_typeof(t) <> 'string' or length(t #>> '{}') > 64)
      or (v_question ? 'correctAnswerText' and btrim(coalesce(v_question->>'correctAnswerText',''))
        is distinct from (select btrim(o->>'text') from pg_catalog.jsonb_array_elements(v_question->'options') o
          where o->>'key' = v_key limit 1)) then
      raise exception 'A submitted answer or tag is inconsistent' using errcode='22023';
    end if;
    if v_question ? 'choiceRationales' and (jsonb_typeof(v_question->'choiceRationales') <> 'object'
      or (select count(*) from pg_catalog.jsonb_each(v_question->'choiceRationales'))
        > jsonb_array_length(v_question->'options')
      or exists (select 1 from pg_catalog.jsonb_each(v_question->'choiceRationales') r
        where jsonb_typeof(r.value) <> 'string' or length(r.value #>> '{}') > 10000
          or not exists (select 1 from pg_catalog.jsonb_array_elements(v_question->'options') o
            where o->>'key' = r.key))) then
      raise exception 'A submitted answer rationale is invalid' using errcode='22023';
    end if;
    for v_option in select value from pg_catalog.jsonb_array_elements(v_question->'options') loop
      if jsonb_typeof(v_option) is distinct from 'object'
        or length(coalesce(v_option->>'key','')) < 1
        or length(coalesce(v_option->>'key','')) > 16
        or length(coalesce(v_option->>'text','')) < 1
        or length(coalesce(v_option->>'text','')) > 4000
        or exists (select 1 from pg_catalog.jsonb_object_keys(v_option) k where k not in ('key','text')) then
        raise exception 'A submitted answer choice is incomplete' using errcode='22023';
      end if;
    end loop;
    v_index := v_index + 1;
  end loop;
  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended(v_owner::text, 0));
  select * into v_existing from public.question_set_library_entries
    where owner_id = v_owner and source_id = p_source_id for update;
  if found then
    if v_existing.snapshot_payload = p_snapshot and v_existing.credit = btrim(p_credit) then return v_existing.id; end if;
    if v_existing.status = 'rejected' then
      update public.question_set_library_entries set snapshot_payload = p_snapshot,
        title = p_snapshot->>'title', tags = array(select value #>> '{}' from pg_catalog.jsonb_array_elements(p_snapshot->'tags')),
        question_count = jsonb_array_length(p_snapshot->'questions'), credit = btrim(p_credit),
        status = 'pending', review_note = '', reviewed_by = null, reviewed_at = null, approved_at = null
        where id = v_existing.id returning id into v_id;
      return v_id;
    end if;
    raise exception 'Withdraw this submission before replacing its content' using errcode='23505';
  end if;
  if (select count(*) from public.question_set_library_entries where owner_id = v_owner) >= 50 then
    raise exception 'You have reached the 50 Question Set submission limit' using errcode='54000';
  end if;
  insert into public.question_set_library_entries
    (owner_id, source_id, title, credit, tags, question_count, snapshot_payload)
  values (v_owner, p_source_id, p_snapshot->>'title', btrim(p_credit),
    array(select value #>> '{}' from pg_catalog.jsonb_array_elements(p_snapshot->'tags')),
    jsonb_array_length(p_snapshot->'questions'), p_snapshot)
  returning id into v_id;
  return v_id;
end $$;
revoke all on function public.submit_question_set_library(text,jsonb,text,boolean,boolean) from public,anon;
grant execute on function public.submit_question_set_library(text,jsonb,text,boolean,boolean) to authenticated;

create function public.withdraw_question_set_library(p_id uuid) returns void
language plpgsql security definer set search_path = '' as $$
begin
  if auth.uid() is null then raise exception 'Sign in to withdraw a Question Set' using errcode='42501'; end if;
  perform private.require_account_write_access();
  delete from public.question_set_library_entries where id = p_id and owner_id = auth.uid();
end $$;
revoke all on function public.withdraw_question_set_library(uuid) from public,anon;
grant execute on function public.withdraw_question_set_library(uuid) to authenticated;

create function public.review_question_set_library(p_id uuid, p_approved boolean, p_reason text) returns void
language plpgsql security definer set search_path = '' as $$
begin
  if not public.academic_is_reviewer() then
    raise exception 'Academic reviewer access required' using errcode='42501';
  end if;
  perform private.require_account_write_access();
  if p_approved is null or length(btrim(coalesce(p_reason,''))) not between 8 and 500 then
    raise exception 'Give a review reason of 8 to 500 characters' using errcode='22023';
  end if;
  update public.question_set_library_entries set status = case when p_approved then 'approved' else 'rejected' end,
    review_note = btrim(p_reason), reviewed_by = auth.uid(), reviewed_at = now(),
    approved_at = case when p_approved then now() else null end
    where id = p_id and status = 'pending';
  if not found then raise exception 'This submission is no longer pending' using errcode='P0002'; end if;
end $$;
revoke all on function public.review_question_set_library(uuid,boolean,text) from public,anon;
grant execute on function public.review_question_set_library(uuid,boolean,text) to authenticated;

create function public.my_question_set_library()
returns table(id uuid, source_id text, title text, credit text, question_count integer,
  status text, review_note text, created_at timestamptz)
language plpgsql stable security definer set search_path = '' as $$
begin
  if auth.uid() is null then raise exception 'Sign in to see your submissions' using errcode='42501'; end if;
  return query select e.id,e.source_id,e.title,e.credit,e.question_count,e.status,e.review_note,e.created_at
    from public.question_set_library_entries e where e.owner_id=auth.uid()
    order by e.created_at desc limit 50;
end $$;
revoke all on function public.my_question_set_library() from public,anon;
grant execute on function public.my_question_set_library() to authenticated;

create function public.pending_question_set_library()
returns table(id uuid, source_id text, title text, credit text, question_count integer,
  status text, review_note text, created_at timestamptz)
language plpgsql stable security definer set search_path = '' as $$
begin
  if not public.academic_is_reviewer() then raise exception 'Academic reviewer access required' using errcode='42501'; end if;
  return query select e.id,e.source_id,e.title,e.credit,e.question_count,e.status,e.review_note,e.created_at
    from public.question_set_library_entries e where e.status='pending'
    order by e.created_at asc limit 100;
end $$;
revoke all on function public.pending_question_set_library() from public,anon;
grant execute on function public.pending_question_set_library() to authenticated;

create function public.set_question_set_library_like(p_id uuid, p_liked boolean) returns void
language plpgsql security definer set search_path = '' as $$
begin
  if auth.uid() is null then raise exception 'Sign in to like a Question Set' using errcode='42501'; end if;
  perform private.require_account_write_access();
  if p_liked is null or not exists (select 1 from public.question_set_library_entries
    where id=p_id and status='approved') then
    raise exception 'This Question Set is unavailable' using errcode='42501';
  end if;
  if p_liked then
    insert into public.question_set_library_likes(entry_id,user_id) values(p_id,auth.uid()) on conflict do nothing;
  else
    delete from public.question_set_library_likes where entry_id=p_id and user_id=auth.uid();
  end if;
end $$;
revoke all on function public.set_question_set_library_like(uuid,boolean) from public,anon;
grant execute on function public.set_question_set_library_like(uuid,boolean) to authenticated;

create function public.list_question_set_library(p_search text default '', p_offset integer default 0)
returns table(id uuid, title text, credit text, tags text[], question_count integer,
  approved_at timestamptz, likes bigint, liked boolean)
language plpgsql stable security definer set search_path = '' as $$
begin
  if auth.uid() is null then raise exception 'Sign in to search the library' using errcode='42501'; end if;
  if length(coalesce(p_search,'')) > 100 or p_offset is null or p_offset < 0 or p_offset > 1000 then
    raise exception 'Invalid library search' using errcode='22023';
  end if;
  return query select e.id,e.title,e.credit,e.tags,e.question_count,e.approved_at,
    (select count(*) from public.question_set_library_likes l where l.entry_id=e.id),
    exists (select 1 from public.question_set_library_likes l where l.entry_id=e.id and l.user_id=auth.uid())
  from public.question_set_library_entries e
  where e.status='approved' and (btrim(coalesce(p_search,'')) = ''
    or position(lower(btrim(p_search)) in lower(e.title || ' ' || e.credit || ' ' || array_to_string(e.tags,' '))) > 0)
  order by e.approved_at desc,e.id desc limit 24 offset p_offset;
end $$;
revoke all on function public.list_question_set_library(text,integer) from public,anon;
grant execute on function public.list_question_set_library(text,integer) to authenticated;

create function public.get_question_set_library(p_id uuid) returns jsonb
language plpgsql stable security definer set search_path = '' as $$
declare v_entry public.question_set_library_entries;
begin
  if auth.uid() is null then raise exception 'Sign in to open this Question Set' using errcode='42501'; end if;
  select * into v_entry from public.question_set_library_entries where id=p_id;
  if not found or (v_entry.status <> 'approved' and v_entry.owner_id <> auth.uid()
    and not public.academic_is_reviewer()) then
    raise exception 'This Question Set is unavailable' using errcode='42501';
  end if;
  return pg_catalog.jsonb_build_object('id',v_entry.id,'title',v_entry.title,
    'question_count',v_entry.question_count,'snapshot_payload',v_entry.snapshot_payload,'status',v_entry.status);
end $$;
revoke all on function public.get_question_set_library(uuid) from public,anon;
grant execute on function public.get_question_set_library(uuid) to authenticated;

commit;
