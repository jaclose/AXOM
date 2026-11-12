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
