-- The authenticated PostgREST role has an 8-second statement budget. A full
-- workspace with many image references can spend longer validating their
-- storage objects, rolling back the entire protected revision. The legacy
-- writer already has this 60-second bound; carry it to the current full and
-- delta RPCs without changing validation, ownership, quotas or retention.
alter function public.push_workspace_revision_v2(bigint, integer, text, jsonb, uuid, uuid, text)
  set statement_timeout = '60s';

alter function public.push_workspace_delta_v2(bigint, text, integer, text, jsonb, uuid, uuid, text)
  set statement_timeout = '60s';

-- PostgREST caches function settings when preparing RPC calls.
notify pgrst, 'reload schema';
