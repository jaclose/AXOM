-- R67: cancellation must invalidate undelivered deletion-consent notices.
-- An attempted provider delivery cannot be recalled: retain its processing
-- state for reconciliation rather than claiming that it was never sent.
-- Requires R63 session consent and R66 atomic notice queue migrations.
begin;

create or replace function public.cancel_unattempted_deletion_notices()
returns trigger language plpgsql security invoker set search_path = pg_catalog as $$
begin
  update public.email_jobs as j
     set status = 'cancelled', failure_code = 'deletion-consent-cancelled'
   where j.user_id = new.user_id
     and ((j.type = 'deletion_requested' and j.idempotency_key = new.id::text || ':requested')
       or (j.type = 'deletion_scheduled' and j.idempotency_key = new.id::text || ':scheduled'))
     and (j.status in ('queued', 'scheduled')
       or (j.status = 'processing' and j.first_attempt_at is null))
     and j.provider_id is null
     and j.sent_at is null;
  return new;
end;
$$;

drop trigger if exists privacy_deletion_cancel_notices on public.privacy_requests;
create trigger privacy_deletion_cancel_notices
after update of status on public.privacy_requests
for each row
when (new.kind = 'deletion' and new.status = 'cancelled'
  and old.status is distinct from new.status
  and new.user_id is not null and new.actor_session_id is not null)
execute function public.cancel_unattempted_deletion_notices();

-- Upgrade already-cancelled, actor-bound consents without touching dispatched
-- attempts, receipts, completed records or cancellation-notice jobs.
update public.email_jobs as j
   set status = 'cancelled', failure_code = 'deletion-consent-cancelled'
  from public.privacy_requests as r
 where r.kind = 'deletion' and r.status = 'cancelled'
   and r.user_id is not null and r.actor_session_id is not null
   and j.user_id = r.user_id
   and ((j.type = 'deletion_requested' and j.idempotency_key = r.id::text || ':requested')
     or (j.type = 'deletion_scheduled' and j.idempotency_key = r.id::text || ':scheduled'))
   and (j.status in ('queued', 'scheduled')
     or (j.status = 'processing' and j.first_attempt_at is null))
   and j.provider_id is null and j.sent_at is null;

commit;
