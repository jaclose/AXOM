-- Close the NULL-reviewer gap in the independent academic approval trigger.
-- Supersedes the function from 20261113100500 without rewriting approved rows,
-- changing the trigger, or interfering with reviewer-account deletion.
-- The separate authenticated-review provenance gate continues to apply.
begin;

create or replace function private.question_set_library_require_independent_reviewer()
returns trigger language plpgsql set search_path = '' as $$
begin
  if new.status = 'approved' and old.status is distinct from 'approved'
    and (new.reviewed_by is null or new.reviewed_by is not distinct from new.owner_id) then
    raise exception 'Question Set approval requires an independent academic reviewer'
      using errcode = '42501';
  end if;
  return new;
end $$;

commit;
