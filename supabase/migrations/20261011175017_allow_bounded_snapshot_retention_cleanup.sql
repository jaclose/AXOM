-- Legacy accounts can hold sixty multi-megabyte revisions. Removing the
-- accumulated TOAST rows during the first budget-enforcing upload exceeded
-- PostgREST's authenticated-role timeout (8s), rolling back both pruning and
-- the new revision on every retry. Keep the existing atomic retention policy,
-- quotas and authorization; allow this RPC a bounded cleanup window only.
-- Supabase/PostgREST honors per-function statement_timeout for RPC calls.
alter function public.push_workspace_revision(bigint, integer, text, jsonb, uuid, uuid, text)
  set statement_timeout = '60s';

-- PostgREST reads function settings from its schema cache before starting the RPC.
notify pgrst, 'reload schema';
