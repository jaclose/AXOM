-- Reject JSON type coercions that can turn a numeric/boolean option or
-- answer key into text in the older submission RPC. Answer evidence must
-- preserve the v1 snapshot's source types, not merely its displayed values.
-- Only new inserts and snapshot replacements are checked. Existing approved
-- publications, reviewer permissions, and RLS are not rewritten.
begin;

create function private.question_set_library_require_snapshot_types()
returns trigger language plpgsql set search_path = '' as $$
declare
  v_question jsonb;
  v_option jsonb;
  v_member jsonb;
  v_field text;
begin
  if pg_catalog.jsonb_typeof(new.snapshot_payload) is distinct from 'object'
    or new.snapshot_payload->'shareFormatVersion' is distinct from '1'::jsonb
    or pg_catalog.jsonb_typeof(new.snapshot_payload->'title') is distinct from 'string'
    or pg_catalog.jsonb_typeof(new.snapshot_payload->'createdAt') is distinct from 'string'
    or pg_catalog.jsonb_typeof(new.snapshot_payload->'copyrightNotice') is distinct from 'string'
    or pg_catalog.jsonb_typeof(new.snapshot_payload->'orderedQuestionIds') is distinct from 'array'
    or pg_catalog.jsonb_typeof(new.snapshot_payload->'questions') is distinct from 'array' then
    raise exception 'Question Set snapshot contains invalid scalar types' using errcode='22023';
  end if;

  for v_member in select value from pg_catalog.jsonb_array_elements(new.snapshot_payload->'orderedQuestionIds') loop
    if pg_catalog.jsonb_typeof(v_member) is distinct from 'string' then
      raise exception 'Question Set membership IDs must be strings' using errcode='22023';
    end if;
  end loop;

  for v_question in select value from pg_catalog.jsonb_array_elements(new.snapshot_payload->'questions') loop
    if pg_catalog.jsonb_typeof(v_question) is distinct from 'object'
      or pg_catalog.jsonb_typeof(v_question->'id') is distinct from 'string'
      or pg_catalog.jsonb_typeof(v_question->'stem') is distinct from 'string'
      or pg_catalog.jsonb_typeof(v_question->'correctKey') is distinct from 'string'
      or pg_catalog.jsonb_typeof(v_question->'options') is distinct from 'array' then
      raise exception 'Question Set question or answer key has invalid scalar types' using errcode='22023';
    end if;
    for v_field in select pg_catalog.unnest(array[
      'correctAnswerText','explanation','system','topic','objective',
      'category','subcategory','citation'
    ]) loop
      if v_question ? v_field
        and pg_catalog.jsonb_typeof(v_question->v_field) is distinct from 'string' then
        raise exception 'Question Set answer metadata has invalid scalar types' using errcode='22023';
      end if;
    end loop;
    for v_option in select value from pg_catalog.jsonb_array_elements(v_question->'options') loop
      if pg_catalog.jsonb_typeof(v_option) is distinct from 'object'
        or pg_catalog.jsonb_typeof(v_option->'key') is distinct from 'string'
        or pg_catalog.jsonb_typeof(v_option->'text') is distinct from 'string' then
        raise exception 'Question Set answer choices must contain string keys and text' using errcode='22023';
      end if;
    end loop;
  end loop;
  return new;
end $$;

create trigger question_set_library_snapshot_types
before insert or update of snapshot_payload on public.question_set_library_entries
for each row execute function private.question_set_library_require_snapshot_types();

commit;
