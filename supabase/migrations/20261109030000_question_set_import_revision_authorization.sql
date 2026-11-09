-- Authorize a learner's import against the exact *current* approved
-- publication, rather than trusting a previously fetched public preview.
-- The statement-level row lock establishes a server-authorized instant,
-- not a lease across the caller's later private/local vault write.
-- Do not expose pending/rejected content, change RLS, or issue credentials.
begin;

create function public.authorize_question_set_library_import(
  p_id uuid, p_expected_revision bigint, p_expected_snapshot jsonb
) returns jsonb
language plpgsql volatile security definer set search_path = '' as $$
declare v_entry public.question_set_library_entries;
begin
  if auth.uid() is null then
    raise exception 'Sign in to import this Question Set' using errcode = '42501';
  end if;
  if p_expected_revision is null or p_expected_revision < 1
    or pg_catalog.jsonb_typeof(p_expected_snapshot) is distinct from 'object'
    or pg_catalog.jsonb_typeof(p_expected_snapshot->'questions') is distinct from 'array'
    or pg_catalog.octet_length(p_expected_snapshot::text) > 5000000 then
    raise exception 'Reopen the exact reviewed Question Set before importing'
      using errcode = '22023';
  end if;

  -- A single locked read checks published status, review revision and exact
  -- JSON answer evidence. A withdrawal or revision completed before this
  -- statement is rejected, including same-content reject/resubmit cycles.
  select * into v_entry from public.question_set_library_entries
  where id = p_id and status = 'approved'
  for share;
  if not found
    or v_entry.review_revision is distinct from p_expected_revision
    or v_entry.snapshot_payload is distinct from p_expected_snapshot
    or v_entry.title is distinct from p_expected_snapshot->>'title'
    or v_entry.question_count is distinct from
       pg_catalog.jsonb_array_length(p_expected_snapshot->'questions') then
    raise exception 'This reviewed Question Set changed or was withdrawn. Reopen its listing'
      using errcode = '42501';
  end if;

  return pg_catalog.jsonb_build_object(
    'id',v_entry.id,'title',v_entry.title,
    'question_count',v_entry.question_count,
    'snapshot_payload',v_entry.snapshot_payload,
    'status',v_entry.status,'review_revision',v_entry.review_revision
  );
end $$;

revoke all on function public.authorize_question_set_library_import(uuid,bigint,jsonb) from public,anon;
grant execute on function public.authorize_question_set_library_import(uuid,bigint,jsonb) to authenticated;

commit;
