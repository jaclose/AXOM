-- Forward-only correction for installations that already recorded migration
-- 20261109040000 before revision-bound public-tag import checks existed.
-- Do not rewrite migration history: both clean installs and upgrades must run
-- this exact reviewed import authorization, without changing approved content.
-- Security definer retains a fixed search_path; callers require auth.uid().
begin;

create or replace function public.authorize_question_set_library_import(
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
    or pg_catalog.jsonb_typeof(p_expected_snapshot->'tags') is distinct from 'array'
    or pg_catalog.octet_length(p_expected_snapshot::text) > 5000000 then
    raise exception 'Reopen the exact reviewed Question Set before importing'
      using errcode = '22023';
  end if;

  -- Legacy publications can predate the projection trigger. Reject malformed
  -- tag evidence before comparing it with the indexed discovery projection.
  -- This read-only check does not rewrite historical published content.
  if pg_catalog.jsonb_array_length(p_expected_snapshot->'tags') > 100
    or exists (
      select 1 from pg_catalog.jsonb_array_elements(p_expected_snapshot->'tags') t(tag)
      where pg_catalog.jsonb_typeof(t.tag) is distinct from 'string'
        or pg_catalog.length(t.tag #>> '{}') > 64
        or pg_catalog.length(pg_catalog.btrim(t.tag #>> '{}')) = 0
    ) then
    raise exception 'Reopen the exact reviewed Question Set before importing'
      using errcode = '22023';
  end if;

  select * into v_entry from public.question_set_library_entries
  where id = p_id and status = 'approved'
  for share;
  if not found
    or v_entry.review_revision is distinct from p_expected_revision
    or v_entry.snapshot_payload is distinct from p_expected_snapshot
    or v_entry.title is distinct from p_expected_snapshot->>'title'
    or v_entry.question_count is distinct from
       pg_catalog.jsonb_array_length(p_expected_snapshot->'questions')
    or v_entry.tags is distinct from array(
      select tag #>> '{}'
      from pg_catalog.jsonb_array_elements(p_expected_snapshot->'tags')
        with ordinality as snapshot_tag(tag, ordinal)
      order by ordinal
    )
    or v_entry.reviewed_at is null
    or v_entry.approved_at is null
    or pg_catalog.length(pg_catalog.btrim(v_entry.review_note)) not between 8 and 500 then
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
