-- Keep catalog and application objects ahead of caller-controlled temporary objects.
-- The functions use unqualified public table names, so pg_temp must be explicit
-- and last to prevent a caller's temporary table from shadowing those relations.
alter function public.push_workspace_revision(
  bigint, integer, text, jsonb, uuid, uuid, text
) set search_path = pg_catalog, public, pg_temp;

alter function public.resolve_question_set_share(text)
set search_path = pg_catalog, public, pg_temp;

alter function public.handle_new_account()
set search_path = pg_catalog, public, pg_temp;

alter function public.create_question_set_share(text, jsonb)
set search_path = pg_catalog, public, pg_temp;

alter function public.touch_account_device(uuid, text, text, bigint)
set search_path = pg_catalog, public, pg_temp;

alter function public.delete_my_cloud_data()
set search_path = pg_catalog, public, pg_temp;

alter function public.consume_ai_quota()
set search_path = pg_catalog, public, pg_temp;
