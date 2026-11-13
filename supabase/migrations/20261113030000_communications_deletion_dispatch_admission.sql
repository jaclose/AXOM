-- R68: linearize dispatch admission with consent cancellation.
-- A provider request cannot be recalled after dispatch admission. Cancellation
-- reports this uncertainty durably; it does not promise recall of in-flight I/O.
-- Requires R67 cancellation suppression and R66 atomic queue migrations.
begin;

alter table public.email_jobs
  add column if not exists deletion_dispatch_admitted_at timestamptz;
alter table public.privacy_requests
  add column if not exists notice_delivery_uncertain boolean not null default false;

-- The worker and cancellation serialize on the SAME privacy request row.
-- An admission that loses to cancellation cannot dispatch. If admission wins,
-- cancellation can still succeed, but must disclose possible in-flight email.
create or replace function public.admit_deletion_notice_dispatch(
  p_job_id uuid, p_user_id uuid
) returns boolean
language plpgsql security invoker set search_path = pg_catalog
as $$
declare
  v_key text;
  v_type text;
  v_request_id uuid;
begin
  select j.idempotency_key, j.type into v_key, v_type
    from public.email_jobs as j
   where j.id = p_job_id and j.user_id = p_user_id;
  if v_key is null
    or v_key !~* '^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}:(requested|scheduled)$'
    or (v_type = 'deletion_requested' and v_key !~ ':requested$')
    or (v_type = 'deletion_scheduled' and v_key !~ ':scheduled$')
    or v_type not in ('deletion_requested','deletion_scheduled')
  then return false;
  end if;
  v_request_id := pg_catalog.split_part(v_key, ':', 1)::uuid;

  -- FOR UPDATE locks against the concurrent cancellation UPDATE. There is no
  -- external network call inside this transaction.
  perform 1 from public.privacy_requests as r
   where r.id = v_request_id and r.user_id = p_user_id
     and r.kind = 'deletion' and r.status = 'scheduled'
     and r.actor_session_id is not null
   for update;
  if not found then return false; end if;

  update public.email_jobs as j
     set deletion_dispatch_admitted_at = coalesce(j.deletion_dispatch_admitted_at, pg_catalog.now()),
         first_attempt_at = coalesce(j.first_attempt_at, pg_catalog.now())
   where j.id = p_job_id and j.user_id = p_user_id
     and j.type = v_type and j.idempotency_key = v_key
     and j.status = 'processing'
     and j.provider_id is null and j.sent_at is null;
  return found;
end;
$$;

-- Do not expose worker-only admission to browser/client roles.
revoke all on function public.admit_deletion_notice_dispatch(uuid,uuid)
  from public, anon, authenticated;
grant execute on function public.admit_deletion_notice_dispatch(uuid,uuid)
  to service_role;

-- This BEFORE trigger captures attempted/in-flight notices in the same
-- transaction as a successful cancellation. R67's AFTER trigger continues to
-- cancel never-attempted jobs. Old workers may have first_attempt_at without
-- an R68 admission marker, so treat those as possibly sent, conservatively.
create or replace function public.record_deletion_notice_uncertainty()
returns trigger language plpgsql security invoker set search_path = pg_catalog as $$
begin
  if new.kind = 'deletion' and new.status = 'cancelled'
     and old.status is distinct from new.status and new.user_id is not null
  then
    new.notice_delivery_uncertain := new.notice_delivery_uncertain or exists (
      select 1 from public.email_jobs as j
       where j.user_id = new.user_id
         and ((j.type = 'deletion_requested' and j.idempotency_key = new.id::text || ':requested')
           or (j.type = 'deletion_scheduled' and j.idempotency_key = new.id::text || ':scheduled'))
         and (j.deletion_dispatch_admitted_at is not null or j.first_attempt_at is not null)
         and j.provider_id is null and j.sent_at is null
         and j.status in ('queued','processing','failed')
    );
  end if;
  return new;
end;
$$;

drop trigger if exists privacy_deletion_notice_uncertainty on public.privacy_requests;
create trigger privacy_deletion_notice_uncertainty
before update of status on public.privacy_requests
for each row
when (new.kind = 'deletion' and new.status = 'cancelled'
  and old.status is distinct from new.status)
execute function public.record_deletion_notice_uncertainty();

-- Legacy cancellations that preceded this forward migration may already
-- carry attempted notices. Mark uncertainty without requeueing, sending or
-- reviving a cancelled consent. Only update rows with actual unresolved work.
update public.privacy_requests as r
   set notice_delivery_uncertain = true
 where r.kind = 'deletion' and r.status = 'cancelled'
   and r.user_id is not null and not r.notice_delivery_uncertain
   and exists (
     select 1 from public.email_jobs as j
      where j.user_id = r.user_id
        and ((j.type = 'deletion_requested' and j.idempotency_key = r.id::text || ':requested')
          or (j.type = 'deletion_scheduled' and j.idempotency_key = r.id::text || ':scheduled'))
        and (j.deletion_dispatch_admitted_at is not null or j.first_attempt_at is not null)
        and j.provider_id is null and j.sent_at is null
        and j.status in ('queued','processing','failed')
   );

commit;
