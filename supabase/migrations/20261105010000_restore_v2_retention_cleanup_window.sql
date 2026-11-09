-- The legacy save RPC already has a 60-second cleanup allowance from
-- 20261011175017. Its v2 replacement did not inherit that function setting,
-- so the first save of a large legacy history can reach retention cleanup
-- and then hit the authenticated role's shorter statement timeout.
--
-- Give only the exposed v2 RPC the same bounded allowance. Its body, invoker
-- security, grants and atomic writer remain unchanged: canonical history
-- still keeps the newest three, at most sixty, within the existing 50 MB
-- budget. This migration itself neither writes nor removes workspace data.
alter function public.push_workspace_revision_v2(bigint, integer, text, jsonb, uuid, uuid, text)
  set statement_timeout = '60s';

-- PostgREST hoists statement_timeout from the exposed RPC's cached settings;
-- a setting on the nested private writer would not establish that boundary.
-- https://docs.postgrest.org/en/stable/references/transactions.html#hoisted-function-settings
notify pgrst, 'reload schema';
