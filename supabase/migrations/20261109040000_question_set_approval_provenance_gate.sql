-- Fail closed when a privileged maintenance update attempts to make a pending
-- Question Set public without the authenticated academic decision boundary.
-- Historic approved rows are not rewritten; revoked/withdrawn rows remain
-- removable. Reviewer-account deletion can still redact reviewer identity.
begin;

create function private.question_set_library_require_approval_provenance()
returns trigger language plpgsql set search_path = '' as $$
begin
  -- The submission RPC only inserts pending rows. Inserting an already
  -- approved row directly would otherwise bypass an UPDATE-only guard.
  if tg_op = 'INSERT' then
    if new.status is distinct from 'pending' then
      raise exception 'Question Set entries must be submitted pending academic review'
        using errcode = '42501';
    end if;
    return new;
  end if;
  if new.status = 'approved' and old.status is distinct from 'approved' then
    -- Only an authenticated academic reviewer may advance a pending
    -- publication. A bare service-role status UPDATE has no reviewer JWT.
    -- This is a defense against bypassing the application review workflow,
    -- not a guarantee against a malicious database owner who can disable
    -- triggers or forge JWT session settings.
    if old.status is distinct from 'pending'
      or auth.uid() is null
      or new.reviewed_by is distinct from auth.uid()
      or not public.academic_is_reviewer()
      or length(pg_catalog.btrim(new.review_note)) not between 8 and 500
      or new.reviewed_at is null
      or new.approved_at is null then
      raise exception 'Academic review provenance is required for Question Set approval'
        using errcode = '42501';
    end if;

    -- The projection trigger intentionally does not fire on a status-only
    -- decision. Refuse preexisting pending rows with inconsistent public
    -- search metadata before they become discoverable.
    if pg_catalog.jsonb_typeof(new.snapshot_payload) is distinct from 'object'
      or pg_catalog.jsonb_typeof(new.snapshot_payload->'tags') is distinct from 'array'
      or pg_catalog.jsonb_typeof(new.snapshot_payload->'questions') is distinct from 'array' then
      raise exception 'Question Set approval requires consistent snapshot metadata'
        using errcode = '22023';
    end if;
    if new.title is distinct from new.snapshot_payload->>'title'
      or new.question_count is distinct from
        pg_catalog.jsonb_array_length(new.snapshot_payload->'questions')
      or new.tags is distinct from array(
        select tag #>> '{}'
        from pg_catalog.jsonb_array_elements(new.snapshot_payload->'tags')
          with ordinality as snapshot_tag(tag, ordinal)
        order by ordinal
      ) then
      raise exception 'Question Set approval requires consistent snapshot metadata'
        using errcode = '22023';
    end if;
  end if;
  return new;
end $$;

create trigger zz_question_set_library_approval_provenance
before insert or update of status on public.question_set_library_entries
for each row execute function private.question_set_library_require_approval_provenance();

-- Post-review importer must also refuse historically forged approved rows,
-- while allowing genuine reviewed publications whose reviewer account was
-- later deleted (the FK legitimately sets reviewed_by to NULL).
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
