-- R96 transactional approval-transition coverage, synthetic data only.
-- Execute with psql -v ON_ERROR_STOP=1 after the R89, R94, R95 and R96
-- migrations in an isolated database. This does NOT prove hosted RLS/roles.
begin;

create temporary table question_set_approval_citation_fixture (
  id bigint generated always as identity primary key,
  snapshot_payload jsonb not null,
  status text not null default 'pending',
  review_note text not null default ''
) on commit drop;

create trigger question_set_library_approval_citation_gate
before update of status
on pg_temp.question_set_approval_citation_fixture
for each row
when (new.status = 'approved' and old.status is distinct from new.status)
execute function private.question_set_library_assert_approval_citation_privacy();

do $grants$
begin
  if has_function_privilege('anon',
       'private.question_set_library_assert_approval_citation_privacy()', 'EXECUTE')
    or has_function_privilege('authenticated',
       'private.question_set_library_assert_approval_citation_privacy()', 'EXECUTE') then
    raise exception 'Approval privacy trigger is callable by client roles';
  end if;
end $grants$;

do $cases$
declare
  v_citation text;
  v_id bigint;
begin
  -- Existing pending/rejected entries from before the citation gate are
  -- representable without rewriting them. New approval must not admit them.
  foreach v_citation in array array[
    'source:file:///Users/learner/private.pdf',
    'https://example.edu/view?src=data%3Aapplication%2Fpdf%3Bbase64%2CJVBERi0x',
    'blob:https://example.edu/private-object',
    'https://learner:secret@example.edu/lecture',
    'https://example.edu/view?src=data%252525253Aapplication%252525252Fpdf%252525253Bbase64%252525252CJVBERi0x'
  ] loop
    insert into pg_temp.question_set_approval_citation_fixture(snapshot_payload)
    values (jsonb_build_object('questions', jsonb_build_array(
      jsonb_build_object('citation','PMID: safe first'),
      jsonb_build_object('citation', v_citation))))
    returning id into v_id;

    begin
      update pg_temp.question_set_approval_citation_fixture
      set status = 'approved' where id = v_id;
      raise exception 'Legacy private citation was approved: %', v_id;
    exception when sqlstate '22023' then null;
    end;
    if (select status from pg_temp.question_set_approval_citation_fixture where id = v_id)
       is distinct from 'pending' then
      raise exception 'Failed approval modified pending status: %', v_id;
    end if;

    -- Rejection must remain available so a reviewer can resolve the queue.
    update pg_temp.question_set_approval_citation_fixture
      set status = 'rejected', review_note = 'Privacy review required'
      where id = v_id;
    if (select status from pg_temp.question_set_approval_citation_fixture where id = v_id)
       is distinct from 'rejected' then
      raise exception 'Reviewer rejection failed: %', v_id;
    end if;
    begin
      update pg_temp.question_set_approval_citation_fixture
      set status = 'approved' where id = v_id;
      raise exception 'Rejected private citation was reapproved: %', v_id;
    exception when sqlstate '22023' then null;
    end;
    if (select status from pg_temp.question_set_approval_citation_fixture where id = v_id)
       is distinct from 'rejected' then
      raise exception 'Failed reapproval modified rejection: %', v_id;
    end if;
  end loop;

  insert into pg_temp.question_set_approval_citation_fixture(snapshot_payload)
  values ('{"questions":[{"citation":"PMID: 123456"},{"citation":"https://example.edu/lesson?source=/home/public.pdf"}]}'::jsonb)
  returning id into v_id;
  update pg_temp.question_set_approval_citation_fixture set status = 'approved'
    where id = v_id;
  if (select status from pg_temp.question_set_approval_citation_fixture where id = v_id)
     is distinct from 'approved' then
    raise exception 'Safe source citation failed approval';
  end if;

  -- Existing approved publications are neither rescanned nor rewritten.
  -- Their notes/likes and ordinary rejection remain available.
  insert into pg_temp.question_set_approval_citation_fixture(snapshot_payload, status)
  values ('{"questions":[{"citation":"file:///Users/historical/original.pdf"}]}'::jsonb, 'approved')
  returning id into v_id;
  update pg_temp.question_set_approval_citation_fixture
    set review_note = 'Existing decision preserved' where id = v_id;
  update pg_temp.question_set_approval_citation_fixture
    set status = 'approved' where id = v_id;
  update pg_temp.question_set_approval_citation_fixture
    set status = 'rejected' where id = v_id;
  if (select status from pg_temp.question_set_approval_citation_fixture where id = v_id)
       is distinct from 'rejected' then
    raise exception 'Historical review transition was incorrectly blocked';
  end if;
  if (select snapshot_payload->'questions'->0->>'citation'
      from pg_temp.question_set_approval_citation_fixture where id = v_id)
      is distinct from 'file:///Users/historical/original.pdf' then
    raise exception 'Historical publication snapshot was rewritten';
  end if;

  -- Malformed legacy pending content cannot bypass citation inspection.
  insert into pg_temp.question_set_approval_citation_fixture(snapshot_payload)
  values ('{"not_questions":[]}'::jsonb) returning id into v_id;
  begin
    update pg_temp.question_set_approval_citation_fixture
      set status = 'approved' where id = v_id;
    raise exception 'Uninspectable snapshot was approved';
  exception when sqlstate '22023' then null;
  end;
end $cases$;

rollback;
