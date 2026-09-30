-- The daily allowance must not be selected by an authenticated client calling
-- the RPC directly. Keep the quota policy inside Postgres and expose no limit
-- parameter to callers.
drop function if exists public.consume_ai_quota(integer);

create function public.consume_ai_quota()
returns integer
language plpgsql
security definer
set search_path = pg_catalog, public, pg_temp
as $$
declare
  v_user uuid := auth.uid();
  v_limit constant integer := 60;
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

revoke execute on function public.consume_ai_quota() from public, anon;
grant execute on function public.consume_ai_quota() to authenticated;
