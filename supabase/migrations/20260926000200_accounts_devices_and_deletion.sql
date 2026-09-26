-- AXOM Accounts v1.1 — device registry and learner-initiated cloud deletion.
-- Applied after 20260926000100_accounts_sync_sharing_v1.sql by the Supabase CLI/GitHub integration.
-- Every table stays behind row-level security; functions run as the caller's
-- auth.uid() and refuse anonymous callers.

create table if not exists public.account_devices (
  user_id uuid not null references auth.users(id) on delete cascade,
  device_id uuid not null,
  label text not null default 'Device' check (char_length(label) between 1 and 80),
  platform text not null default '' check (char_length(platform) <= 40),
  last_seen_at timestamptz not null default now(),
  last_protected_revision bigint,
  created_at timestamptz not null default now(),
  primary key (user_id, device_id)
);
create index if not exists account_devices_recent on public.account_devices(user_id, last_seen_at desc);

alter table public.account_devices enable row level security;
drop policy if exists "devices own rows read" on public.account_devices;
drop policy if exists "devices own rows delete" on public.account_devices;
create policy "devices own rows read" on public.account_devices for select using (auth.uid() = user_id);
create policy "devices own rows delete" on public.account_devices for delete using (auth.uid() = user_id);

-- Register or refresh this device. Bounded to the 20 most recent devices.
create or replace function public.touch_account_device(
  p_device_id uuid, p_label text, p_platform text, p_revision bigint default null
) returns void language plpgsql security definer set search_path = public as $$
begin
  if auth.uid() is null then raise exception 'authentication required' using errcode = '42501'; end if;
  insert into account_devices(user_id, device_id, label, platform, last_seen_at, last_protected_revision)
  values (
    auth.uid(), p_device_id,
    left(coalesce(nullif(trim(p_label), ''), 'Device'), 80),
    left(coalesce(p_platform, ''), 40),
    now(), p_revision
  )
  on conflict (user_id, device_id) do update set
    label = excluded.label,
    platform = excluded.platform,
    last_seen_at = now(),
    last_protected_revision = coalesce(excluded.last_protected_revision, account_devices.last_protected_revision);
  delete from account_devices
  where user_id = auth.uid()
    and device_id in (
      select device_id from account_devices where user_id = auth.uid()
      order by last_seen_at desc offset 20
    );
end $$;
revoke all on function public.touch_account_device(uuid, text, text, bigint) from public;
grant execute on function public.touch_account_device(uuid, text, text, bigint) to authenticated;

-- Delete every server copy that belongs to the caller. Local data on the
-- learner's devices is never touched; the auth user itself remains so they
-- can protect a workspace again later.
create or replace function public.delete_my_cloud_data() returns void
language plpgsql security definer set search_path = public as $$
begin
  if auth.uid() is null then raise exception 'authentication required' using errcode = '42501'; end if;
  delete from question_set_shares where owner_user_id = auth.uid();
  delete from sync_conflicts where user_id = auth.uid();
  delete from workspace_revisions where user_id = auth.uid();
  delete from workspaces where user_id = auth.uid();
  delete from account_devices where user_id = auth.uid();
end $$;
revoke all on function public.delete_my_cloud_data() from public;
grant execute on function public.delete_my_cloud_data() to authenticated;
