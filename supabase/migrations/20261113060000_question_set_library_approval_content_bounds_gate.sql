-- R98: historical pending sets must meet v1 submission bounds before approval.
-- R96 enforces citation privacy and R97 enforces types, keys and membership.
-- Forward-only admission guard; does not rewrite published records.
begin;

create function private.question_set_library_require_approval_content_bounds()
returns trigger language plpgsql set search_path = '' as $$
declare v_question jsonb; v_field text;
begin
  if pg_catalog.jsonb_typeof(new.snapshot_payload) is distinct from 'object'
    or pg_catalog.octet_length(new.snapshot_payload::text) > 5000000
    or pg_catalog.length(coalesce(new.snapshot_payload->>'title','')) not between 1 and 200
    or pg_catalog.length(coalesce(new.snapshot_payload->>'copyrightNotice','')) not between 1 and 500
    or pg_catalog.length(coalesce(new.snapshot_payload->>'createdAt','')) < 10
    or pg_catalog.jsonb_typeof(new.snapshot_payload->'questions') is distinct from 'array' then
    raise exception 'Question Set approval requires valid snapshot content bounds' using errcode='22023';
  end if;

  for v_question in select value from pg_catalog.jsonb_array_elements(new.snapshot_payload->'questions') loop
    if pg_catalog.jsonb_typeof(v_question) is distinct from 'object'
      or pg_catalog.length(coalesce(v_question->>'stem','')) not between 1 and 8000
      or pg_catalog.length(coalesce(v_question->>'explanation','')) > 30000
      or pg_catalog.length(coalesce(v_question->>'citation','')) > 2000 then
      raise exception 'Question Set approval requires valid question content bounds' using errcode='22023';
    end if;
    foreach v_field in array array['system','topic','objective','category','subcategory'] loop
      if pg_catalog.length(coalesce(v_question->>v_field,'')) > 500 then
        raise exception 'Question Set approval requires valid metadata content bounds' using errcode='22023';
      end if;
    end loop;
  end loop;
  return new;
end $$;
revoke all on function private.question_set_library_require_approval_content_bounds()
  from public,anon,authenticated;

-- Ordered after citation and schema guards by PostgreSQL trigger name.
-- Existing approved/no-op updates and rejection/deletion are unchanged.
create trigger question_set_library_approval_z_content_bounds_gate
before update of status on public.question_set_library_entries
for each row
when (new.status='approved' and old.status is distinct from new.status)
execute function private.question_set_library_require_approval_content_bounds();

commit;
