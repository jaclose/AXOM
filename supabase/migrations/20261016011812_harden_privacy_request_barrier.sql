-- Privacy export and account deletion both cross the Postgres/Storage/Auth
-- boundary. Keep their account-level ordering in Postgres instead of relying
-- on two independent service-role lookups around external I/O.

-- Supabase's migration runner sends statements without a transaction block,
-- where Postgres refuses LOCK TABLE. One explicit transaction keeps the lock
-- and every change below atomic however the file is applied.
begin;

-- Older releases allowed failed requests beside one active row. Freeze this
-- table while selecting one canonical barrier. A duplicate processing row may
-- already have crossed an external boundary, so abort rather than guess.
lock table public.privacy_requests in share row exclusive mode;

do $$
begin
  if exists (
    select 1
    from public.privacy_requests p
    where p.user_id is not null
      and p.status = 'processing'
    group by p.user_id
    having count(distinct p.kind) > 1
  ) then
    raise exception 'privacy migration requires manual reconciliation of conflicting processing request kinds';
  end if;

  if exists (
    select 1
    from public.privacy_requests p
    where p.user_id is not null and (
      p.status in ('requested', 'processing', 'scheduled')
      or (p.kind = 'deletion' and p.status = 'failed')
      or (
        p.kind = 'export'
        and p.status = 'failed'
        and p.failure_code in (
          'export-reconciliation-required',
          'export-deletion-reconciliation-required'
        )
      )
    )
    group by p.user_id, p.kind
    having count(*) > 1 and pg_catalog.bool_or(p.status = 'processing')
  ) then
    raise exception 'privacy migration requires manual reconciliation of duplicate processing requests';
  end if;
end;
$$;

with candidates as (
  select p.*
  from public.privacy_requests p
  where p.user_id is not null and (
    p.status in ('requested', 'scheduled')
    or (p.kind = 'deletion' and p.status = 'failed')
    or (
      p.kind = 'export'
      and p.status = 'failed'
      and p.failure_code in (
        'export-reconciliation-required',
        'export-deletion-reconciliation-required'
      )
    )
  )
), ranked as (
  select c.id,
         first_value(c.id) over (
           partition by c.user_id, c.kind
           order by
             case
               when c.status = 'failed'
                 and c.failure_code like '%reconciliation-required' then 0
               when c.status = 'failed' then 1
               when c.status = 'scheduled' then 2
               else 3
             end,
             c.created_at desc,
             c.id desc
         ) as canonical_id,
         row_number() over (
           partition by c.user_id, c.kind
           order by
             case
               when c.status = 'failed'
                 and c.failure_code like '%reconciliation-required' then 0
               when c.status = 'failed' then 1
               when c.status = 'scheduled' then 2
               else 3
             end,
             c.created_at desc,
             c.id desc
         ) as position
  from candidates c
)
update public.privacy_requests p
set status = 'cancelled',
    failure_code = 'legacy-single-flight-duplicate',
    completion_payload = pg_catalog.jsonb_build_object(
      '_axom_privacy_migration', pg_catalog.jsonb_build_object(
        'migration', '20261016011812',
        'reason', 'legacy-single-flight-duplicate',
        'canonical_request_id', r.canonical_id,
        'original_status', p.status,
        'original_failure_code', p.failure_code,
        'normalized_at', now()
      ),
      'prior_completion_payload', p.completion_payload
    )
from ranked r
where r.id = p.id and r.position > 1;

drop index if exists public.privacy_one_active;
create unique index privacy_one_active on public.privacy_requests(user_id, kind)
where user_id is not null and (
  status in ('requested', 'processing', 'scheduled')
  or (kind = 'deletion' and status = 'failed')
  or (
    kind = 'export'
    and status = 'failed'
    and failure_code in (
      'export-reconciliation-required',
      'export-deletion-reconciliation-required'
    )
  )
);

-- Admission uses the same account lock as worker claims. Checking in the
-- service before inserting would race deletion; checking only at claim time
-- accepts a request that cannot run and emits a misleading receipt.
create function public.guard_privacy_export_admission() returns trigger
language plpgsql
security invoker
set search_path = ''
as $$
begin
  perform pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended(new.user_id::text, 0)
  );
  if exists (
    select 1 from public.privacy_requests p
    where p.user_id = new.user_id
      and p.kind = 'deletion'
      and (
        p.status = 'processing'
        or (
          p.status = 'failed'
          and p.failure_code is distinct from 'deletion-preflight-failed'
        )
      )
  ) then
    raise exception 'Export is unavailable while account deletion is processing or needs manual reconciliation.'
      using errcode = 'PT409';
  end if;
  return new;
end;
$$;
revoke all on function public.guard_privacy_export_admission()
  from public, anon, authenticated;
grant execute on function public.guard_privacy_export_admission()
  to service_role;
create trigger guard_privacy_export_admission
before insert on public.privacy_requests
for each row
when (new.user_id is not null and new.kind = 'export' and new.status = 'requested')
execute function public.guard_privacy_export_admission();

-- The write gate is used by RLS, triggers and the share publisher. Unknown
-- failed deletion states are treated as destructive until explicitly proven
-- to be the reversible preflight failure.
create or replace function public.axom_account_accepts_cloud_writes() returns boolean
language sql volatile security definer set search_path = '' as $$
  select auth.uid() is not null
  and exists (
    select 1 from auth.users u where u.id = auth.uid()
  )
  and not exists (
    select 1
    from public.privacy_requests p
    where p.user_id = auth.uid()
      and p.kind = 'deletion'
      and (
        p.status = 'processing'
        or (
          p.status = 'failed'
          and p.failure_code is distinct from 'deletion-preflight-failed'
        )
      )
  );
$$;
revoke all on function public.axom_account_accepts_cloud_writes()
  from public, anon;
grant execute on function public.axom_account_accepts_cloud_writes()
  to authenticated, service_role;

-- The older wrapper checked the account barrier before the private publisher
-- acquired its owner lock. Lock first and recheck inside the same transaction,
-- so cleanup either withdraws everything first or publication finishes first.
create or replace function public.create_question_set_share(
  p_source_id text,
  p_snapshot jsonb
) returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  owner_id uuid := auth.uid();
begin
  if owner_id is null then
    raise exception 'authentication required' using errcode = '42501';
  end if;
  perform pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended(owner_id::text, 0)
  );
  if not public.axom_account_accepts_cloud_writes() then
    raise exception 'Account is unavailable or deletion cleanup is in progress'
      using errcode = 'PT409';
  end if;
  return axom_private.create_question_set_share_without_account_gate(
    p_source_id,
    p_snapshot
  );
end;
$$;
revoke all on function public.create_question_set_share(text, jsonb)
  from public, anon;
grant execute on function public.create_question_set_share(text, jsonb)
  to authenticated, service_role;

-- A worker that disappears after beginning external I/O is not safe to replay
-- automatically. Quarantine it until an operator has verified Storage and the
-- dead worker. The failed row remains part of the unique single-flight guard.
create function public.quarantine_stale_privacy_requests(
  p_stale_before timestamptz
) returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare
  affected integer;
  total integer := 0;
begin
  update public.privacy_requests
  set status = 'failed', failure_code = 'export-reconciliation-required'
  where kind = 'export'
    and status = 'processing'
    and processing_at < p_stale_before;
  get diagnostics affected = row_count;
  total := total + affected;

  update public.privacy_requests
  set status = 'failed', failure_code = 'deletion-reconciliation-required'
  where kind = 'deletion'
    and status = 'processing'
    and processing_at < p_stale_before;
  get diagnostics affected = row_count;
  return total + affected;
end;
$$;
revoke all on function public.quarantine_stale_privacy_requests(timestamptz)
  from public, anon, authenticated;
grant execute on function public.quarantine_stale_privacy_requests(timestamptz)
  to service_role;

-- The advisory lock serializes claims for the same account inside Postgres.
-- The claimed row then remains a durable barrier for the entire external job.
create function public.claim_privacy_request(
  p_request_id uuid,
  p_now timestamptz default now()
) returns boolean
language plpgsql
security definer
set search_path = ''
as $$
declare
  account_id uuid;
  request public.privacy_requests;
begin
  select p.user_id into account_id
  from public.privacy_requests p
  where p.id = p_request_id;
  if account_id is null then return false; end if;

  perform pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended(account_id::text, 0)
  );
  select p.* into request
  from public.privacy_requests p
  where p.id = p_request_id
  for update;
  if request.user_id is distinct from account_id then return false; end if;
  if request.status not in ('requested', 'scheduled') then return false; end if;

  if request.kind = 'export' then
    if request.status <> 'requested' or exists (
      select 1 from public.privacy_requests p
      where p.user_id = account_id
        and p.kind = 'deletion'
        and (
          p.status = 'processing'
          or (
            p.status = 'failed'
            and p.failure_code is distinct from 'deletion-preflight-failed'
          )
        )
    ) then return false; end if;
  elsif request.kind = 'deletion' then
    if request.status <> 'scheduled'
      or request.scheduled_for is null
      or request.scheduled_for > p_now
      or exists (
        select 1 from public.privacy_requests p
        where p.user_id = account_id
          and p.kind = 'export'
          and (
            -- An export admitted before this claim owns the next turn even
            -- when no worker has picked it up yet.
            p.status in ('requested', 'processing')
            or (
              p.status = 'failed'
              and p.failure_code in (
                'export-reconciliation-required',
                'export-deletion-reconciliation-required'
              )
            )
          )
      )
    then return false; end if;
  else
    return false;
  end if;

  update public.privacy_requests
  set status = 'processing',
      processing_at = p_now,
      failure_code = case
        when request.kind = 'deletion' then 'deletion-preflight'
        else null
      end
  where id = request.id;
  return true;
end;
$$;
revoke all on function public.claim_privacy_request(uuid, timestamptz)
  from public, anon, authenticated;
grant execute on function public.claim_privacy_request(uuid, timestamptz)
  to service_role;

-- Finalization is in the same account-level ordering domain as deletion
-- claims. A ready export cannot be published after cleanup has started.
create function public.finalize_privacy_export(
  p_request_id uuid,
  p_object_path text,
  p_expires_at timestamptz
) returns boolean
language plpgsql
security definer
set search_path = ''
as $$
declare
  owner_id uuid;
  request public.privacy_requests;
begin
  select p.user_id into owner_id
  from public.privacy_requests p
  where p.id = p_request_id;
  if owner_id is null then return false; end if;

  perform pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended(owner_id::text, 0)
  );
  select p.* into request
  from public.privacy_requests p
  where p.id = p_request_id
  for update;
  if request.user_id is distinct from owner_id
    or request.kind <> 'export'
    or request.status <> 'processing'
    or p_object_path <> owner_id::text || '/' || request.id::text || '.json'
    or p_expires_at <= now()
    or p_expires_at > now() + interval '8 days'
    or exists (
      select 1 from public.privacy_requests p
      where p.user_id = owner_id
        and p.kind = 'deletion'
        and (
          p.status = 'processing'
          or (
            p.status = 'failed'
            and p.failure_code is distinct from 'deletion-preflight-failed'
          )
        )
    )
  then return false; end if;

  update public.privacy_requests
  set status = 'ready',
      processing_at = null,
      object_path = p_object_path,
      expires_at = p_expires_at,
      failure_code = null
  where id = request.id;
  return true;
end;
$$;
revoke all on function public.finalize_privacy_export(uuid, text, timestamptz)
  from public, anon, authenticated;
grant execute on function public.finalize_privacy_export(uuid, text, timestamptz)
  to service_role;

-- Crossing this boundary starts destructive, externally visible cleanup.
-- Revoke every existing bearer share in the same transaction that records the
-- irreversible state so no link can remain usable during partial deletion.
create function public.begin_account_deletion_cleanup(
  p_request_id uuid
) returns boolean
language plpgsql
security definer
set search_path = ''
as $$
declare
  account_id uuid;
  request public.privacy_requests;
begin
  select p.user_id into account_id
  from public.privacy_requests p
  where p.id = p_request_id;
  if account_id is null then return false; end if;

  perform pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended(account_id::text, 0)
  );
  select p.* into request
  from public.privacy_requests p
  where p.id = p_request_id
  for update;
  if request.user_id is distinct from account_id
    or request.kind <> 'deletion'
    or request.status <> 'processing'
    or request.failure_code <> 'deletion-preflight'
    or exists (
      select 1 from public.privacy_requests p
      where p.user_id = account_id
        and p.kind = 'export'
        and (
          p.status = 'processing'
          or (
            p.status = 'failed'
            and p.failure_code in (
              'export-reconciliation-required',
              'export-deletion-reconciliation-required'
            )
          )
        )
    )
  then return false; end if;

  update public.question_set_shares
  set revoked_at = coalesce(revoked_at, now())
  where owner_user_id = account_id
    and revoked_at is null;

  update public.academic_collections c
  set withdrawn = true,
      updated_at = now()
  where c.owner_id = account_id
    and not c.withdrawn;

  update public.privacy_requests
  set failure_code = 'deletion-cleanup-started'
  where id = request.id;
  return true;
end;
$$;
revoke all on function public.begin_account_deletion_cleanup(uuid)
  from public, anon, authenticated;
grant execute on function public.begin_account_deletion_cleanup(uuid)
  to service_role;

-- Record a deletion failure by inspecting the committed database phase while
-- holding the same account lock. If begin_account_deletion_cleanup committed
-- but its response was lost, cleanup-started can never be overwritten with a
-- reversible preflight result.
create function public.record_account_deletion_failure(
  p_request_id uuid,
  p_requires_reconciliation boolean default false
) returns text
language plpgsql
security definer
set search_path = ''
as $$
declare
  owner_id uuid;
  request public.privacy_requests;
  next_code text;
begin
  select p.user_id into owner_id
  from public.privacy_requests p
  where p.id = p_request_id;
  if owner_id is null then return null; end if;

  perform pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended(owner_id::text, 0)
  );
  select p.* into request
  from public.privacy_requests p
  where p.id = p_request_id
  for update;
  if request.user_id is distinct from owner_id
    or request.kind <> 'deletion'
    or request.status <> 'processing'
  then return request.failure_code; end if;

  next_code := case
    when p_requires_reconciliation
      or request.failure_code is distinct from 'deletion-preflight'
      then 'deletion-reconciliation-required'
    else 'deletion-preflight-failed'
  end;
  update public.privacy_requests
  set status = 'failed', failure_code = next_code
  where id = request.id;
  return next_code;
end;
$$;
revoke all on function public.record_account_deletion_failure(uuid, boolean)
  from public, anon, authenticated;
grant execute on function public.record_account_deletion_failure(uuid, boolean)
  to service_role;

commit;
