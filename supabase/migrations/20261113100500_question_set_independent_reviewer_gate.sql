-- Community Question Set review must be a second-person academic decision.
-- An academic reviewer who authored a Question Set may submit it, but may not
-- approve their own entry. Keep all historical approved snapshots untouched.
-- This gate covers both the review RPC and direct privileged status updates.
begin;

create function private.question_set_library_require_independent_reviewer()
returns trigger language plpgsql set search_path = '' as $$
begin
  if new.status = 'approved' and old.status is distinct from 'approved'
    and new.reviewed_by is not distinct from new.owner_id then
    raise exception 'Question Set approval requires an independent academic reviewer'
      using errcode = '42501';
  end if;
  return new;
end $$;

create trigger zzzz_question_set_library_independent_reviewer
before update of status on public.question_set_library_entries
for each row execute function private.question_set_library_require_independent_reviewer();

commit;
