-- Preserve both deletion consent notices as one durable transaction.
-- R63 Edge admission currently writes privacy_requests before two separate enqueue calls.
-- A network/queue failure between those writes must not strand an active consent.
-- The existing Edge enqueues use the same idempotency keys and are safe duplicates.
-- No email is sent here; the independent consent/suppression worker remains responsible.
-- Requires the R63 session-consent and R65 terminal-session-scrub migrations.
begin;

create or replace function public.queue_deletion_consent_notices()
returns trigger language plpgsql security invoker set search_path = pg_catalog as $$
begin
  insert into public.email_jobs
    (user_id, type, category, idempotency_key, variables, status, scheduled_for)
  values
    (new.user_id, 'deletion_requested', 'account_deletion',
     new.id::text || ':requested', pg_catalog.jsonb_build_object('requestId', new.id::text),
     'queued', pg_catalog.now()),
    (new.user_id, 'deletion_scheduled', 'account_deletion',
     new.id::text || ':scheduled', pg_catalog.jsonb_build_object('date', new.scheduled_for),
     'queued', pg_catalog.now())
  on conflict (idempotency_key) do nothing;
  return new;
end;
$$;

drop trigger if exists privacy_deletion_consent_notices on public.privacy_requests;
create trigger privacy_deletion_consent_notices
after insert on public.privacy_requests
for each row
when (new.kind = 'deletion' and new.status = 'scheduled'
  and new.user_id is not null and new.actor_session_id is not null
  and new.scheduled_for is not null)
execute function public.queue_deletion_consent_notices();

-- Reconcile previously admitted future consents that may have received only
-- one notification before a process/network failure. Existing keys are retained.
-- Never requeue cancelled, failed, completed, expired or legacy unbound consents.
insert into public.email_jobs
  (user_id, type, category, idempotency_key, variables, status, scheduled_for)
select r.user_id, 'deletion_requested', 'account_deletion',
  r.id::text || ':requested', pg_catalog.jsonb_build_object('requestId', r.id::text),
  'queued', pg_catalog.now()
from public.privacy_requests as r
where r.kind = 'deletion' and r.status = 'scheduled'
  and r.user_id is not null and r.actor_session_id is not null
  and r.scheduled_for > pg_catalog.now()
on conflict (idempotency_key) do nothing;

insert into public.email_jobs
  (user_id, type, category, idempotency_key, variables, status, scheduled_for)
select r.user_id, 'deletion_scheduled', 'account_deletion',
  r.id::text || ':scheduled', pg_catalog.jsonb_build_object('date', r.scheduled_for),
  'queued', pg_catalog.now()
from public.privacy_requests as r
where r.kind = 'deletion' and r.status = 'scheduled'
  and r.user_id is not null and r.actor_session_id is not null
  and r.scheduled_for > pg_catalog.now()
on conflict (idempotency_key) do nothing;

commit;
