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
  v_tag jsonb;
  v_rationale_key text;
  v_rationale jsonb;
  v_question_index integer := 0;
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

  -- The submission RPC strips unapproved fields before persistence, but a
  -- service-role snapshot replacement must also fail closed. Otherwise a
  -- future importer could expose private workspace or source-media metadata.
  if exists (select 1 from pg_catalog.jsonb_object_keys(new.snapshot_payload) k
      where k not in (
        'shareFormatVersion','title','tags','orderedQuestionIds','questions',
        'createdAt','copyrightNotice'
      )) then
    raise exception 'Question Set snapshot contains private or unsupported fields' using errcode='22023';
  end if;

  -- Tags include future AXOM visual-intent labels; neither nested objects nor
  -- numeric values may be laundered into public text by maintenance writes.
  if pg_catalog.jsonb_typeof(new.snapshot_payload->'tags') is distinct from 'array' then
    raise exception 'Question Set tags contain invalid scalar types' using errcode='22023';
  end if;
  if pg_catalog.jsonb_array_length(new.snapshot_payload->'tags') > 100 then
    raise exception 'Question Set tags contain invalid scalar types' using errcode='22023';
  end if;
  for v_tag in select value from pg_catalog.jsonb_array_elements(new.snapshot_payload->'tags') loop
    if pg_catalog.jsonb_typeof(v_tag) is distinct from 'string'
      or length(v_tag #>> '{}') > 64 or length(pg_catalog.btrim(v_tag #>> '{}')) = 0 then
      raise exception 'Question Set tags contain invalid scalar types' using errcode='22023';
    end if;
  end loop;

  for v_member in select value from pg_catalog.jsonb_array_elements(new.snapshot_payload->'orderedQuestionIds') loop
    if pg_catalog.jsonb_typeof(v_member) is distinct from 'string' then
      raise exception 'Question Set membership IDs must be strings' using errcode='22023';
    end if;
  end loop;

  -- Maintenance writes must preserve the same ordered, unique membership as
  -- authenticated submissions. Typed IDs alone are not source evidence.
  if pg_catalog.jsonb_array_length(new.snapshot_payload->'questions') not between 1 and 1000
    or pg_catalog.jsonb_array_length(new.snapshot_payload->'orderedQuestionIds')
        <> pg_catalog.jsonb_array_length(new.snapshot_payload->'questions')
    or (select count(distinct value #>> '{}')
        from pg_catalog.jsonb_array_elements(new.snapshot_payload->'orderedQuestionIds'))
        <> pg_catalog.jsonb_array_length(new.snapshot_payload->'orderedQuestionIds') then
    raise exception 'Question Set snapshot has inconsistent membership or answer evidence' using errcode='22023';
  end if;

  for v_question in select value from pg_catalog.jsonb_array_elements(new.snapshot_payload->'questions') loop
    if pg_catalog.jsonb_typeof(v_question) is distinct from 'object'
      or pg_catalog.jsonb_typeof(v_question->'id') is distinct from 'string'
      or pg_catalog.jsonb_typeof(v_question->'stem') is distinct from 'string'
      or pg_catalog.jsonb_typeof(v_question->'correctKey') is distinct from 'string'
      or pg_catalog.jsonb_typeof(v_question->'options') is distinct from 'array'
      or pg_catalog.jsonb_typeof(v_question->'tags') is distinct from 'array' then
      raise exception 'Question Set question or answer key has invalid scalar types' using errcode='22023';
    end if;
    if exists (select 1 from pg_catalog.jsonb_object_keys(v_question) k
        where k not in (
          'id','stem','options','correctKey','correctAnswerText','explanation',
          'choiceRationales','system','topic','objective','category',
          'subcategory','tags','citation'
        )) then
      raise exception 'Question Set question contains private or unsupported fields' using errcode='22023';
    end if;
    if length(pg_catalog.btrim(v_question->>'id')) not between 1 and 200
      or new.snapshot_payload->'orderedQuestionIds'->>v_question_index is distinct from v_question->>'id'
      or length(pg_catalog.btrim(v_question->>'correctKey')) not between 1 and 16
      or pg_catalog.jsonb_array_length(v_question->'options') not between 2 and 26 then
      raise exception 'Question Set snapshot has inconsistent membership or answer evidence' using errcode='22023';
    end if;
    if pg_catalog.jsonb_array_length(v_question->'tags') > 100 then
      raise exception 'Question Set question tags contain invalid scalar types' using errcode='22023';
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
        or pg_catalog.jsonb_typeof(v_option->'text') is distinct from 'string'
        or length(pg_catalog.btrim(v_option->>'key')) not between 1 and 16
        or length(pg_catalog.btrim(v_option->>'text')) not between 1 and 4000 then
        raise exception 'Question Set answer choices must contain string keys and text' using errcode='22023';
      end if;
      if exists (select 1 from pg_catalog.jsonb_object_keys(v_option) k
          where k not in ('key','text')) then
        raise exception 'Question Set choice contains private or unsupported fields' using errcode='22023';
      end if;
    end loop;
    -- A privileged replacement must not leave a well-typed but unsupported
    -- key, duplicate choice key, or contradictory correct-answer text behind.
    if (select count(distinct choice->>'key')
          from pg_catalog.jsonb_array_elements(v_question->'options') choice)
         <> pg_catalog.jsonb_array_length(v_question->'options')
      or not exists (
        select 1 from pg_catalog.jsonb_array_elements(v_question->'options') choice
        where choice->>'key' = v_question->>'correctKey'
      )
      or (v_question ? 'correctAnswerText'
        and pg_catalog.btrim(v_question->>'correctAnswerText') is distinct from (
          select pg_catalog.btrim(choice->>'text')
          from pg_catalog.jsonb_array_elements(v_question->'options') choice
          where choice->>'key' = v_question->>'correctKey' limit 1
        )) then
      raise exception 'Question Set snapshot has inconsistent membership or answer evidence' using errcode='22023';
    end if;
    for v_tag in select value from pg_catalog.jsonb_array_elements(v_question->'tags') loop
      if pg_catalog.jsonb_typeof(v_tag) is distinct from 'string'
        or length(v_tag #>> '{}') > 64 or length(pg_catalog.btrim(v_tag #>> '{}')) = 0 then
        raise exception 'Question Set question tags contain invalid scalar types' using errcode='22023';
      end if;
    end loop;
    -- AI teaching explanations can contain per-choice rationale maps. Do not
    -- allow non-text rationale values or unknown distractor keys on any write.
    if v_question ? 'choiceRationales' then
      if pg_catalog.jsonb_typeof(v_question->'choiceRationales') is distinct from 'object' then
        raise exception 'Question Set choice rationales contain invalid scalar types' using errcode='22023';
      end if;
      if (select count(*) from pg_catalog.jsonb_each(v_question->'choiceRationales'))
          > pg_catalog.jsonb_array_length(v_question->'options') then
        raise exception 'Question Set choice rationales contain invalid scalar types' using errcode='22023';
      end if;
      for v_rationale_key, v_rationale in
        select key, value from pg_catalog.jsonb_each(v_question->'choiceRationales')
      loop
        if pg_catalog.jsonb_typeof(v_rationale) is distinct from 'string'
          or length(v_rationale #>> '{}') > 10000
          or length(pg_catalog.btrim(v_rationale #>> '{}')) = 0
          or length(v_rationale_key) not between 1 and 16
          or not exists (
            select 1 from pg_catalog.jsonb_array_elements(v_question->'options') choice
            where choice->>'key' = v_rationale_key
          ) then
          raise exception 'Question Set choice rationales contain invalid scalar types' using errcode='22023';
        end if;
      end loop;
    end if;
    v_question_index := v_question_index + 1;
  end loop;
  return new;
end $$;

create trigger question_set_library_snapshot_types
before insert or update of snapshot_payload on public.question_set_library_entries
for each row execute function private.question_set_library_require_snapshot_types();

commit;
