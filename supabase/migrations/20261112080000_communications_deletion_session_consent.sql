-- One deletion consent per authenticated sign-in, including cancelled consents.
-- Historical privacy/export receipts retain their existing null actor session.
-- This is additive. Never activate deletion until this migration is applied and reviewed.
alter table public.privacy_requests
  add column if not exists actor_session_id uuid;

alter table public.privacy_requests
  add constraint privacy_deletion_session_only
  check (kind = 'deletion' or actor_session_id is null);

-- Cancellation cannot free the same-session consent for another scheduling.
-- Active-request admission remains governed by privacy_one_active.
create unique index if not exists privacy_deletion_consent_once
  on public.privacy_requests(user_id, actor_session_id)
  where user_id is not null and kind = 'deletion' and actor_session_id is not null;

-- A privacy receipt can survive Auth deletion (user_id ON DELETE SET NULL).
-- Retain cancelled session tombstones only for an existing account; erase the
-- sign-in UUID at terminal completion or when the owning account disappears.
-- Enforce this in Postgres as well as future Edge implementations, so an older
-- handler cannot accidentally leave a live session identifier in an orphan.
create function public.scrub_terminal_deletion_actor_session()
returns trigger language plpgsql security invoker set search_path = pg_catalog as $$
begin
  if new.kind = 'deletion' and (new.user_id is null or new.status = 'completed') then
    new.actor_session_id := null;
  end if;
  return new;
end;
$$;

create trigger privacy_deletion_actor_session_scrub
before insert or update on public.privacy_requests
for each row
when (new.kind = 'deletion' and (new.user_id is null or new.status = 'completed'))
execute function public.scrub_terminal_deletion_actor_session();
