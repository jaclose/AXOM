-- R96: hold newly approved Community Question Sets with historical private
-- citations. Snapshot writes are already guarded by R89/R94; this closes the
-- pending/rejected -> approved status-only route in the reviewer RPC.
-- Requires the R89 and R94/R95 private predicates. No existing rows are
-- rewritten and no existing approved status is retroactively changed.
begin;

create function private.question_set_library_assert_approval_citation_privacy()
returns trigger
language plpgsql security definer set search_path = '' as $$
declare
  v_question jsonb;
begin
  -- Approvals must have an inspectable snapshot. Existing approved rows are
  -- not rescanned on reviewer notes, likes, withdrawal or status updates.
  if pg_catalog.jsonb_typeof(new.snapshot_payload->'questions') is distinct from 'array' then
    raise exception 'Question Set approval requires an inspectable question snapshot'
      using errcode = '22023';
  end if;
  if pg_catalog.jsonb_array_length(new.snapshot_payload->'questions') = 0 then
    raise exception 'Question Set approval requires at least one question'
      using errcode = '22023';
  end if;
  for v_question in
    select value from pg_catalog.jsonb_array_elements(new.snapshot_payload->'questions')
  loop
    if pg_catalog.jsonb_typeof(v_question->'citation') = 'string'
       and (
         private.question_set_library_has_private_citation(v_question->>'citation')
         or private.question_set_library_has_inline_document_uri(v_question->>'citation')
       ) then
      -- Do not echo potentially sensitive paths or document bytes to clients.
      raise exception 'Question Set citation requires privacy review before approval'
        using errcode = '22023';
    end if;
  end loop;
  return new;
end $$;

revoke all on function private.question_set_library_assert_approval_citation_privacy()
  from public, anon, authenticated;

-- Check only transitions INTO approval. Reviewers may still reject/withdraw
-- a historical pending entry; historical approved records remain untouched.
-- Direct SQL calls and SECURITY DEFINER review RPCs pass through this trigger.
create trigger question_set_library_approval_citation_gate
before update of status
on public.question_set_library_entries
for each row
when (new.status = 'approved' and old.status is distinct from new.status)
execute function private.question_set_library_assert_approval_citation_privacy();

commit;
