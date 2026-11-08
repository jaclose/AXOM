-- Require the exact inspected public snapshot in the same row update as
-- academic approval/rejection. Client-side readback cannot close this race.
-- Existing publication rows, reviewer roles, and RLS remain untouched.
-- Release alongside the four-argument client; old clients fail closed.
begin;

-- A same-payload rejected/resubmitted entry must not reauthorize an older
-- inspection. Increment a durable revision on every entry UPDATE, including
-- status changes and public credit changes.
alter table public.question_set_library_entries
  add column review_revision bigint not null default 1 check (review_revision > 0);

create function private.question_set_library_increment_review_revision()
returns trigger language plpgsql set search_path = '' as $
begin
  new.review_revision := old.review_revision + 1;
  return new;
end $;
create trigger question_set_library_review_revision
before update on public.question_set_library_entries
for each row execute function private.question_set_library_increment_review_revision();

-- The protected reader returns a revision token, not an editable row.
create or replace function public.get_question_set_library(p_id uuid) returns jsonb
language plpgsql stable security definer set search_path = '' as $
declare v_entry public.question_set_library_entries;
begin
  if auth.uid() is null then raise exception 'Sign in to open this Question Set' using errcode='42501'; end if;
  select * into v_entry from public.question_set_library_entries where id=p_id;
  if not found or (v_entry.status <> 'approved' and v_entry.owner_id <> auth.uid()
    and not public.academic_is_reviewer()) then
    raise exception 'This Question Set is unavailable' using errcode='42501';
  end if;
  return pg_catalog.jsonb_build_object('id',v_entry.id,'title',v_entry.title,
    'question_count',v_entry.question_count,'snapshot_payload',v_entry.snapshot_payload,
    'status',v_entry.status,'review_revision',v_entry.review_revision);
end $;
revoke all on function public.get_question_set_library(uuid) from public,anon;
grant execute on function public.get_question_set_library(uuid) to authenticated;

-- Retire the unsafe three-argument decision without silently allowing legacy
-- clients to approve a revision they have not bound to their inspection.
create or replace function public.review_question_set_library(
  p_id uuid, p_approved boolean, p_reason text
) returns void
language plpgsql security definer set search_path = '' as $$
begin
  raise exception 'Refresh AXOM to review the exact Question Set revision' using errcode='22023';
end $$;
revoke all on function public.review_question_set_library(uuid,boolean,text) from public,anon;
grant execute on function public.review_question_set_library(uuid,boolean,text) to authenticated;

-- jsonb equality is structural, not a client-supplied digest claim: the
-- reviewed snapshot and stored snapshot must match under the row lock.
create function public.review_question_set_library(
  p_id uuid, p_approved boolean, p_reason text, p_expected_snapshot jsonb,
  p_expected_revision bigint
) returns void
language plpgsql security definer set search_path = '' as $$
begin
  if not public.academic_is_reviewer() then
    raise exception 'Academic reviewer access required' using errcode='42501';
  end if;
  perform private.require_account_write_access();
  if p_approved is null or length(btrim(coalesce(p_reason,''))) not between 8 and 500 then
    raise exception 'Give a review reason of 8 to 500 characters' using errcode='22023';
  end if;
  if p_expected_revision is null or p_expected_revision < 1 then
    raise exception 'Reopen the inspected Question Set before reviewing it' using errcode='22023';
  end if;
  if pg_catalog.jsonb_typeof(p_expected_snapshot) is distinct from 'object'
    or pg_catalog.jsonb_typeof(p_expected_snapshot->'questions') is distinct from 'array'
    or pg_catalog.octet_length(p_expected_snapshot::text) > 5000000 then
    raise exception 'Reopen the inspected Question Set before reviewing it' using errcode='22023';
  end if;

  update public.question_set_library_entries
  set status = case when p_approved then 'approved' else 'rejected' end,
      review_note = btrim(p_reason), reviewed_by = auth.uid(), reviewed_at = now(),
      approved_at = case when p_approved then now() else null end
  where id = p_id and status = 'pending'
    and review_revision = p_expected_revision
    and snapshot_payload = p_expected_snapshot
    and title = p_expected_snapshot->>'title'
    and question_count = pg_catalog.jsonb_array_length(p_expected_snapshot->'questions');

  if not found then
    if exists (select 1 from public.question_set_library_entries
               where id = p_id and status = 'pending') then
      raise exception 'The pending Question Set changed since inspection. Reopen and review the current answers'
        using errcode='P0001';
    end if;
    raise exception 'This submission is no longer pending' using errcode='P0002';
  end if;
end $$;
revoke all on function public.review_question_set_library(uuid,boolean,text,jsonb,bigint) from public,anon;
grant execute on function public.review_question_set_library(uuid,boolean,text,jsonb,bigint) to authenticated;

commit;
