-- Workspace revision metadata is mutated only by push_workspace_revision().
-- Authenticated clients need reads for sync status, but direct writes can
-- bypass the revision protocol and corrupt a workspace's current revision.
drop policy if exists "workspaces own rows" on public.workspaces;
create policy "workspaces own rows read" on public.workspaces
  for select to authenticated using (auth.uid() = user_id);

revoke insert, update, delete on table public.workspaces from anon, authenticated;
grant select on table public.workspaces to authenticated;
