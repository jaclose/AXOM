-- R97: prevent legacy pending Question Sets with non-public fields or
-- invalid answer evidence from becoming learner-readable on approval.
-- Reuse the canonical v1 snapshot type/membership/answer-evidence trigger
-- from 20261108200000. The R96 citation approval gate remains independent.
-- No historical row is modified, and rejected/withdrawn updates remain legal.
begin;

create trigger question_set_library_approval_snapshot_type_gate
before update of status on public.question_set_library_entries
for each row
when (new.status = 'approved' and old.status is distinct from new.status)
execute function private.question_set_library_require_snapshot_types();

commit;
