-- Internal-only functions must not be callable through the Data API.

revoke execute on function public.handle_new_account()
from public, anon, authenticated;

-- Present only on projects created with automatic RLS enabled (see 183102).
do $$
begin
  if to_regprocedure('public.rls_auto_enable()') is not null then
    revoke execute on function public.rls_auto_enable() from public, anon, authenticated;
  end if;
end
$$;
