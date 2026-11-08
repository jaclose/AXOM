-- Preserve academically approved Question Set evidence after review.
-- A service-role maintenance write must not silently change reviewed questions,
-- source identity, search metadata, or the approval receipt while the entry
-- remains publicly discoverable. Existing rows are not rewritten.
-- Withdrawal is DELETE; an administrative safety takedown may set rejected.
begin;

create function private.question_set_library_protect_approved_evidence()
returns trigger language plpgsql set search_path = '' as $$
begin
  if old.status = 'approved' and (
    new.snapshot_payload is distinct from old.snapshot_payload
    or new.owner_id is distinct from old.owner_id
    or new.source_id is distinct from old.source_id
    or new.title is distinct from old.title
    or new.credit is distinct from old.credit
    or new.tags is distinct from old.tags
    or new.question_count is distinct from old.question_count
    or new.created_at is distinct from old.created_at
    or new.review_note is distinct from old.review_note
    or new.reviewed_at is distinct from old.reviewed_at
    or new.approved_at is distinct from old.approved_at
    -- Allow only administrative removal from public discovery, never an
    -- unreviewed transition back to pending.
    or new.status not in ('approved', 'rejected')
    -- An FK ON DELETE SET NULL must remain usable for reviewer account
    -- erasure; assigning a different reviewer to old evidence is forbidden.
    or (new.reviewed_by is distinct from old.reviewed_by and new.reviewed_by is not null)
  ) then
    raise exception 'Approved Question Set evidence is immutable; withdraw or revoke before resubmission'
      using errcode = '22023';
  end if;
  return new;
end $$;

create trigger question_set_library_approved_evidence
before update on public.question_set_library_entries
for each row execute function private.question_set_library_protect_approved_evidence();

commit;
