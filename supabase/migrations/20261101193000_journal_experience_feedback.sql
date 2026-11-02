-- Journal experience feedback is an explicit, separate submission. Private
-- journal pages, day summaries and attachments are never copied into it.
begin;

create table public.journal_experience_feedback (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  rating smallint not null check (rating between 1 and 5),
  liked text not null default '' check (length(liked) <= 1000),
  want_more text not null default '' check (length(want_more) <= 1000),
  missing text not null default '' check (length(missing) <= 1000),
  pain_points text not null default '' check (length(pain_points) <= 1000),
  comment text not null default '' check (length(comment) <= 2000),
  created_at timestamptz not null default now()
);
create index journal_experience_feedback_recent on public.journal_experience_feedback(created_at desc);
create index journal_experience_feedback_owner on public.journal_experience_feedback(user_id, created_at desc);

alter table public.journal_experience_feedback enable row level security;
revoke all on public.journal_experience_feedback from public, anon, authenticated;
grant all on public.journal_experience_feedback to service_role;
grant select on public.journal_experience_feedback to authenticated;

create policy journal_feedback_read on public.journal_experience_feedback
for select to authenticated using (
  user_id = (select auth.uid()) or public.axom_operator_role() in ('owner', 'admin')
);

create function public.submit_journal_experience_feedback(
  p_rating integer, p_liked text default '', p_want_more text default '',
  p_missing text default '', p_pain_points text default '', p_comment text default ''
) returns uuid
language plpgsql security definer set search_path = '' as $$
declare
  v_user uuid := auth.uid();
  v_id uuid;
begin
  if v_user is null then raise exception 'Sign in to send journal feedback' using errcode = '42501'; end if;
  perform private.require_account_write_access();
  if p_rating is null or p_rating not between 1 and 5 or p_liked is null or p_want_more is null
    or p_missing is null or p_pain_points is null or p_comment is null
    or length(p_liked) > 1000 or length(p_want_more) > 1000
    or length(p_missing) > 1000 or length(p_pain_points) > 1000
    or length(p_comment) > 2000 then
    raise exception 'Check the feedback fields and rating' using errcode = '22023';
  end if;
  if (select count(*) from public.journal_experience_feedback
      where user_id = v_user and created_at > now() - interval '1 day') >= 5 then
    raise exception 'Feedback limit reached; try again tomorrow' using errcode = '22023';
  end if;
  insert into public.journal_experience_feedback (
    user_id, rating, liked, want_more, missing, pain_points, comment
  ) values (
    v_user, p_rating, btrim(p_liked), btrim(p_want_more),
    btrim(p_missing), btrim(p_pain_points), btrim(p_comment)
  ) returning id into v_id;
  return v_id;
end;
$$;
revoke all on function public.submit_journal_experience_feedback(integer, text, text, text, text, text)
from public, anon, authenticated;
grant execute on function public.submit_journal_experience_feedback(integer, text, text, text, text, text)
to authenticated;

commit;
