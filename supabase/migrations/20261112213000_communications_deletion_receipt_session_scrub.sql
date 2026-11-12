-- Follow-on migration: environments that already recorded 20261112080000
-- must still install the terminal/orphan deletion-session scrub.
-- Keep the earlier migration immutable. Deletion remains disabled pending
-- independent security, hosted schema and rollback acceptance.
begin;

create or replace function public.scrub_terminal_deletion_actor_session()
returns trigger language plpgsql security invoker set search_path = pg_catalog as $$
begin
  if new.kind = 'deletion' and (new.user_id is null or new.status = 'completed') then
    new.actor_session_id := null;
  end if;
  return new;
end;
$$;

-- An earlier R64 preview may already have installed this trigger.
-- Reinstallation and the historical scrub are atomic in this transaction.
drop trigger if exists privacy_deletion_actor_session_scrub on public.privacy_requests;
create trigger privacy_deletion_actor_session_scrub
before insert or update on public.privacy_requests
for each row
when (new.kind = 'deletion' and (new.user_id is null or new.status = 'completed'))
execute function public.scrub_terminal_deletion_actor_session();

-- Only identifiers from already-completed or accountless deletion receipts
-- are removed; live-account cancelled/failed consent tombstones are retained.
update public.privacy_requests
set actor_session_id = null
where kind = 'deletion'
  and actor_session_id is not null
  and (user_id is null or status = 'completed');

commit;
