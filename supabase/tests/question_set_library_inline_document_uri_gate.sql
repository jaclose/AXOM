-- Isolated transaction suite for forward-only inline-document citation gate.
-- Run only on a non-production database after the 02:00 migration. No writes persist.
begin;

create temporary table question_set_inline_citation_fixture (
  id bigint generated always as identity primary key,
  snapshot_payload jsonb not null,
  status text not null default 'pending'
) on commit drop;

create trigger question_set_library_inline_document_uri_gate
before insert or update of snapshot_payload
on pg_temp.question_set_inline_citation_fixture
for each row execute function private.question_set_library_assert_inline_document_uri();

do $grants$
begin
  if has_function_privilege('anon',
       'private.question_set_library_has_inline_document_uri(text)', 'EXECUTE')
    or has_function_privilege('authenticated',
       'private.question_set_library_has_inline_document_uri(text)', 'EXECUTE')
    or has_function_privilege('anon',
       'private.question_set_library_assert_inline_document_uri()', 'EXECUTE')
    or has_function_privilege('authenticated',
       'private.question_set_library_assert_inline_document_uri()', 'EXECUTE') then
    raise exception 'Inline document guard functions are callable by client roles';
  end if;
end $grants$;

do $test$
declare
  v_citation text;
  v_blocked text[] := array[
    'data:application/pdf;base64,JVBERi0x',
    'data:text/plain;charset=utf-8;base64,YWJj',
    'data:,private%20notes',
    'blob:https://example.edu/aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee',
    'blob:null/aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee',
    'https://example.edu/view?src=data%3Aapplication%2Fpdf%3Bbase64%2CJVBERi0x',
    'https://example.edu/view?src=blob%253Ahttps%253A%252F%252Fexample.edu%252Fprivate'
  ];
  v_allowed text[] := array[
    'PMID: 123456; DOI: 10.1000/example',
    'Data: available upon request',
    'https://example.edu/paper?format=data',
    'https://example.edu/lecture?source=/home/public.pdf',
    'https://example.edu/path/%C3%A9tude'
  ];
begin
  insert into pg_temp.question_set_inline_citation_fixture(snapshot_payload)
  values ('{"questions":[{"citation":"PMID: synthetic safe control"}]}'::jsonb);
  foreach v_citation in array v_blocked loop
    if private.question_set_library_has_inline_document_uri(v_citation) is not true then
      raise exception 'Expected inline URI rejection: %', v_citation;
    end if;
    begin
      insert into pg_temp.question_set_inline_citation_fixture(snapshot_payload)
      values (jsonb_build_object('questions', jsonb_build_array(jsonb_build_object('citation', v_citation))));
      raise exception 'INSERT accepted prohibited inline URI: %', v_citation;
    exception when sqlstate '22023' then null;
    end;
    begin
      update pg_temp.question_set_inline_citation_fixture
      set snapshot_payload = jsonb_build_object('questions', jsonb_build_array(jsonb_build_object('citation', v_citation)))
      where id = 1;
      raise exception 'UPDATE accepted prohibited inline URI: %', v_citation;
    exception when sqlstate '22023' then null;
    end;
    if (select snapshot_payload->'questions'->0->>'citation'
        from pg_temp.question_set_inline_citation_fixture where id = 1)
       <> 'PMID: synthetic safe control' then
      raise exception 'Rejected inline URI modified existing snapshot';
    end if;
  end loop;
  foreach v_citation in array v_allowed loop
    if private.question_set_library_has_inline_document_uri(v_citation) is not false then
      raise exception 'Rejected ordinary citation: %', v_citation;
    end if;
    insert into pg_temp.question_set_inline_citation_fixture(snapshot_payload)
    values (jsonb_build_object('questions', jsonb_build_array(jsonb_build_object('citation', v_citation))));
  end loop;
end $test$;

-- Historical content is not rewritten or retroactively reclassified.
alter table pg_temp.question_set_inline_citation_fixture
  disable trigger question_set_library_inline_document_uri_gate;
insert into pg_temp.question_set_inline_citation_fixture(snapshot_payload)
values ('{"questions":[{"citation":"data:text/plain,old-publication"}]}'::jsonb);
alter table pg_temp.question_set_inline_citation_fixture
  enable trigger question_set_library_inline_document_uri_gate;
update pg_temp.question_set_inline_citation_fixture set status = 'approved'
where snapshot_payload->'questions'->0->>'citation' = 'data:text/plain,old-publication';

do $history$
begin
  if (select status from pg_temp.question_set_inline_citation_fixture
      where snapshot_payload->'questions'->0->>'citation' = 'data:text/plain,old-publication')
       is distinct from 'approved' then
    raise exception 'Historical moderation status-only transition failed';
  end if;
end $history$;

rollback;
