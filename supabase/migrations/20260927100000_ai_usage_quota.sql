-- AXOM Cloud AI: per-user daily request quota for the ai-proxy Edge Function.
-- The function calls consume_ai_quota() with the caller's own JWT, so the
-- quota can only ever be spent by (and counted against) the signed-in user.

create table if not exists public.ai_usage (
  user_id uuid not null references auth.users (id) on delete cascade,
  day date not null default (now() at time zone 'utc')::date,
  requests integer not null default 0 check (requests >= 0),
  primary key (user_id, day)
);

alter table public.ai_usage enable row level security;

drop policy if exists "ai_usage: read own" on public.ai_usage;
create policy "ai_usage: read own" on public.ai_usage
  for select to authenticated using (user_id = auth.uid());

revoke insert, update, delete on public.ai_usage from anon, authenticated;
revoke all on public.ai_usage from anon;

-- Returns the requests left today after this one, or -1 when the quota is spent.
create or replace function public.consume_ai_quota(p_daily_limit integer default 60)
returns integer
language plpgsql
security definer
set search_path = public
as $$
declare
  v_user uuid := auth.uid();
  v_limit integer := least(greatest(coalesce(p_daily_limit, 60), 1), 500);
  v_used integer;
begin
  if v_user is null then
    raise exception 'not authenticated' using errcode = '28000';
  end if;
  insert into public.ai_usage as u (user_id, day, requests)
  values (v_user, (now() at time zone 'utc')::date, 1)
  on conflict (user_id, day) do update set requests = u.requests + 1
  where u.requests < v_limit
  returning requests into v_used;
  if v_used is null then
    return -1;
  end if;
  return v_limit - v_used;
end;
$$;

revoke execute on function public.consume_ai_quota(integer) from public, anon;
grant execute on function public.consume_ai_quota(integer) to authenticated;
