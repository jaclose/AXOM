-- Lock privileged AXOM RPCs to their intended roles.
--
-- Supabase's default privileges grant EXECUTE on new public functions to
-- anon explicitly, so the earlier `revoke ... from public` did not remove it.
-- Every function below also refuses a null auth.uid(); this is defense in depth.

revoke execute on function public.push_workspace_revision(
  bigint, integer, text, jsonb, uuid, uuid, text
) from anon;

revoke execute on function public.create_question_set_share(
  text, jsonb
) from anon;

revoke execute on function public.touch_account_device(
  uuid, text, text, bigint
) from anon;

revoke execute on function public.delete_my_cloud_data()
from anon;

-- Internal/trigger functions should not be directly callable by clients.
revoke execute on function public.handle_new_account()
from anon, authenticated;

-- rls_auto_enable() exists only on projects created with the dashboard's
-- "automatically enable RLS" option. Guard it so fresh local databases and
-- preview branches can replay this migration.
do $$
begin
  if to_regprocedure('public.rls_auto_enable()') is not null then
    revoke execute on function public.rls_auto_enable() from anon, authenticated;
  end if;
end
$$;

-- Deliberately left available:
-- resolve_question_set_share(text)
-- remains executable by anon + authenticated because the share token
-- itself is the access capability.
