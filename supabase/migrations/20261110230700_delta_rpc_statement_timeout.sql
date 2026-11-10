-- The exposed delta transport has no function-level statement timeout even
-- though its full-snapshot counterpart has a 60-second allowance.
-- PostgREST hoists settings from the exposed RPC, not its nested writer.
-- The authenticated role's shorter default can cancel reconstruction before
-- the existing, protected revision writer handles a legitimate bounded delta.
--
-- This changes only the timeout of the existing INVOKER function. It neither
-- modifies SQL bodies, grants, RLS, ownership, retention nor learner data.
alter function public.push_workspace_delta_v2(bigint, text, integer, text, jsonb, uuid, uuid, text)
  set statement_timeout = '60s';

-- PostgREST must learn the exposed RPC's setting without a service restart.
-- See https://docs.postgrest.org/en/stable/references/transactions.html#hoisted-function-settings
notify pgrst, 'reload schema';
