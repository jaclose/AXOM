-- Host account directory repair. Supabase stores auth.users.email as
-- varchar(255), and PL/pgSQL RETURN QUERY rejects it for the declared text
-- column (SQLSTATE 42804), so the owner's Host dashboard and account search
-- failed on every load. Same signature, privileges and behaviour; only the
-- email column is cast to text.
begin;

create or replace function public.axom_operator_accounts(query_text text default '')
returns table (user_id uuid, email text, display_name text, role text, created_at timestamptz,
  last_sign_in_at timestamptz, ai_enabled boolean, ai_daily_limit integer, ai_used_today integer)
language plpgsql stable security definer set search_path = '' as $$
begin
  if coalesce(public.axom_operator_role(),'none') not in ('owner','admin') then
    raise exception 'Account management access required' using errcode = '42501';
  end if;
  if length(query_text) > 100 then raise exception 'Search is too long'; end if;
  return query
    select u.id,u.email::text,p.display_name,r.role,u.created_at,u.last_sign_in_at,
      coalesce(e.enabled,true),coalesce(e.daily_limit,60),
      coalesce(a.requests,0)
    from auth.users u
    left join public.account_profiles p on p.user_id = u.id
    left join public.axom_operator_roles r on r.user_id = u.id
    left join public.axom_ai_entitlements e on e.user_id = u.id
    left join public.ai_usage a on a.user_id = u.id and a.day = (now() at time zone 'utc')::date
    where coalesce(query_text,'') = ''
      or u.email ilike '%' || query_text || '%'
      or p.display_name ilike '%' || query_text || '%'
    order by u.created_at desc limit 100;
end $$;
revoke all on function public.axom_operator_accounts(text) from public,anon,authenticated;
grant execute on function public.axom_operator_accounts(text) to authenticated;

commit;
