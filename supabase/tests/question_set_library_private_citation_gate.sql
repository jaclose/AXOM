-- Run manually with psql -v ON_ERROR_STOP=1 against an isolated/staging
-- database AFTER applying 20261113011000_question_set_library_private_citation_gate.
-- Non-production synthetic data only. Every fixture change rolls back.
begin;

create temporary table question_set_library_citation_fixture (
  id bigint generated always as identity primary key,
  snapshot_payload jsonb not null,
  status text not null default 'pending'
) on commit drop;

create trigger question_set_library_private_citation_gate
before insert or update of snapshot_payload
on pg_temp.question_set_library_citation_fixture
for each row execute function private.question_set_library_assert_citation_privacy();

do $grants$
begin
  if has_function_privilege('anon',
       'private.question_set_library_has_private_citation(text)', 'EXECUTE')
    or has_function_privilege('authenticated',
       'private.question_set_library_has_private_citation(text)', 'EXECUTE')
    or has_function_privilege('anon',
       'private.question_set_library_assert_citation_privacy()', 'EXECUTE')
    or has_function_privilege('authenticated',
       'private.question_set_library_assert_citation_privacy()', 'EXECUTE') then
    raise exception 'Private citation guard functions are callable by client roles';
  end if;
end $grants$;

do $test$
declare
  v_citation text;
  v_blocked text[] := array[
    'file:///Users/example/private.pdf',
    'source:file:///Users/example/private.pdf',
    'source:/Users/example/private.pdf',
    'source=/Users/example/private.pdf',
    'source:/root/user/private.pdf',
    'source:/tmp/lecture.pdf',
    'source:/var/mobile/lecture.pdf',
    'source:/storage/emulated/0/private.pdf',
    'source://campus-server/share/private.pdf',
    'source:/opt/study/private.pdf',
    'source:/etc/passwd',
    'https://learner:private-password@example.edu/lesson',
    'https://learner@example.edu/lesson',
    'https://learner%3Asecret%40example.edu/lesson',
    'https%3A%2F%2Flearner%40example.edu%2Flesson',
    'https://example.edu/redirect?to=https://learner:secret@other.edu/lesson',
    'https://example.edu/redirect?source=file:///Users/learner/private.pdf',
    'https://example.edu/view?source=content://private.documents/item/1',
    'https://example.edu/view?source=file%3A%2F%2F%2FUsers%2Flearner%2Fprivate.pdf',
    'https://example.edu/view?source=file%253A%252F%252F%252FUsers%252Flearner%252Fprivate.pdf',
    'source:%2Fvar%2Fmobile%2Flecture.pdf',
    'source:C:\Users\Example\private.pdf',
    'content://com.example.documents/private/42',
    '/home/example/private.pdf',
    '/Volumes/External/lecture.pdf',
    '/mnt/ssd/private.pdf',
    '/media/user/private.pdf',
    '~/Documents/private.pdf',
    'file%3A%2F%2F%2FUsers%2FExample%2Fprivate.pdf',
    'file%253A%252F%252F%252FUsers%252FExample%252Fprivate.pdf',
    'file%3A%2F%2F%2FUsers%2FExample%2Fprivate.pdf%GG',
    E'\\\\campus-server\\share\\private.pdf'
  ];
  v_allowed text[] := array[
    'PMID: 123456; DOI: 10.1000/example',
    'https://example.edu/home/overview',
    'https://example.edu/Volumes/lecture',
    'https://example.edu/resources?source=home',
    'https://example.edu/resources?source=/home/lesson.pdf',
    'https://example.edu/resources?source=//campus-server/share/lesson.pdf',
    'https://example.edu/path/%C3%A9tude?q=%C3%A9',
    'https://example.edu/paper?q=learner@example.edu',
    'https://example.edu/@editor/chapter',
    'https://example.edu/paper#author@university'
  ];
begin
  -- A valid row must remain unchanged when a later private update fails.
  insert into pg_temp.question_set_library_citation_fixture(snapshot_payload)
  values ('{"questions":[{"citation":"PMID: synthetic safe control"}]}'::jsonb);
  foreach v_citation in array v_blocked loop
    if private.question_set_library_has_private_citation(v_citation) is not true then
      raise exception 'Expected local citation rejection: %', v_citation;
    end if;
    begin
      insert into pg_temp.question_set_library_citation_fixture(snapshot_payload)
      values (jsonb_build_object('questions', jsonb_build_array(jsonb_build_object('citation', v_citation))));
      raise exception 'INSERT gate accepted prohibited citation: %', v_citation;
    exception when sqlstate '22023' then
      -- Only the trigger uses 22023; the assertion above uses P0001.
      null;
    end;
    begin
      update pg_temp.question_set_library_citation_fixture
      set snapshot_payload = jsonb_build_object('questions', jsonb_build_array(jsonb_build_object('citation', v_citation)))
      where id = 1;
      raise exception 'UPDATE gate accepted prohibited citation: %', v_citation;
    exception when sqlstate '22023' then
      null;
    end;
    if (select snapshot_payload->'questions'->0->>'citation' from pg_temp.question_set_library_citation_fixture where id = 1)
       <> 'PMID: synthetic safe control' then
      raise exception 'Rejected update mutated existing publication record';
    end if;
  end loop;

  foreach v_citation in array v_allowed loop
    if private.question_set_library_has_private_citation(v_citation) is not false then
      raise exception 'Rejected public citation: %', v_citation;
    end if;
    insert into pg_temp.question_set_library_citation_fixture(snapshot_payload)
    values (jsonb_build_object('questions', jsonb_build_array(jsonb_build_object('citation', v_citation))));
  end loop;

  -- A content replacement with a private local citation must fail as well.
  begin
    update pg_temp.question_set_library_citation_fixture
    set snapshot_payload = jsonb_build_object('questions', jsonb_build_array(
      jsonb_build_object('citation', 'source:file:///Users/Example/new.pdf')));
    raise exception 'UPDATE gate accepted prohibited replacement';
  exception when sqlstate '22023' then
    null;
  end;
end $test$;

-- Historical approved snapshots are not rewritten or rescanned on rejection;
-- pending-to-approved is now guarded separately by R96.
alter table pg_temp.question_set_library_citation_fixture
  disable trigger question_set_library_private_citation_gate;
insert into pg_temp.question_set_library_citation_fixture(snapshot_payload, status)
values ('{"questions":[{"citation":"file:///Users/historical/original.pdf"}]}'::jsonb, 'approved');
alter table pg_temp.question_set_library_citation_fixture
  enable trigger question_set_library_private_citation_gate;
update pg_temp.question_set_library_citation_fixture set status = 'rejected'
where snapshot_payload->'questions'->0->>'citation' = 'file:///Users/historical/original.pdf';

do $history$
begin
  if (select status from pg_temp.question_set_library_citation_fixture
      where snapshot_payload->'questions'->0->>'citation' =
        'file:///Users/historical/original.pdf') is distinct from 'rejected' then
    raise exception 'Historical status-only rejection did not persist';
  end if;
end $history$;

rollback;
