-- R97 regression for historical pending snapshots, no real learner data.
-- Execute with psql -v ON_ERROR_STOP=1 after R89/R94/R95/R96/R97
-- and 20261108200000_question_set_snapshot_type_guard on a disposable DB.
-- The temporary table simulates pre-gate rows without rewriting production.
begin;

do $gate_exists$
begin
  if not exists (
    select 1 from pg_catalog.pg_trigger
    where tgrelid = 'public.question_set_library_entries'::pg_catalog.regclass
      and tgname = 'question_set_library_approval_snapshot_type_gate'
      and not tgisinternal
  ) then
    raise exception 'Missing approval snapshot type trigger';
  end if;
end $gate_exists$;

create temporary table question_set_approval_type_fixture (
  id bigint generated always as identity primary key,
  snapshot_payload jsonb not null,
  status text not null default 'pending',
  review_note text not null default ''
) on commit drop;

-- Test the same canonical trigger functions as on the production table.
create trigger question_set_library_approval_citation_gate
before update of status on pg_temp.question_set_approval_type_fixture
for each row
when (new.status = 'approved' and old.status is distinct from new.status)
execute function private.question_set_library_assert_approval_citation_privacy();

create trigger question_set_library_approval_snapshot_type_gate
before update of status on pg_temp.question_set_approval_type_fixture
for each row
when (new.status = 'approved' and old.status is distinct from new.status)
execute function private.question_set_library_require_snapshot_types();

do $cases$
declare
  v_safe jsonb := '{
    "shareFormatVersion":1,
    "title":"Synthetic reviewer fixture",
    "tags":[],
    "orderedQuestionIds":["shared-q1"],
    "questions":[{
      "id":"shared-q1",
      "stem":"Which option is supported by the synthetic source?",
      "options":[{"key":"A","text":"Supported"},{"key":"B","text":"Unsupported"}],
      "correctKey":"A",
      "tags":[],
      "citation":"PMID: 123456"
    }],
    "createdAt":"2026-11-13T00:00:00.000Z",
    "copyrightNotice":"Synthetic test content"
  }'::jsonb;
  v_invalid jsonb;
  v_id bigint;
begin
  -- A valid legacy pending snapshot is still approvable without rewriting.
  insert into pg_temp.question_set_approval_type_fixture(snapshot_payload)
    values (v_safe) returning id into v_id;
  update pg_temp.question_set_approval_type_fixture
    set status='approved' where id=v_id;
  if (select status from pg_temp.question_set_approval_type_fixture where id=v_id)
      is distinct from 'approved' then
    raise exception 'Valid historical snapshot was not approved';
  end if;

  -- Each bad snapshot bypasses the modern INSERT gate to simulate history,
  -- but MUST be rejected on the status-only path. All citations are public
  -- except unsupported private metadata, so citation screening alone misses it.
  foreach v_invalid in array array[
    pg_catalog.jsonb_set(v_safe, '{questions,0,sourcePdfPath}',
      '"/Users/synthetic/private-study.pdf"'::jsonb, true),
    pg_catalog.jsonb_set(v_safe, '{questions,0}', '42'::jsonb, true),
    pg_catalog.jsonb_set(v_safe, '{questions,0,citation}', '123'::jsonb, true),
    pg_catalog.jsonb_set(v_safe, '{questions,0}',
      (v_safe #> '{questions,0}') - 'correctKey', true),
    pg_catalog.jsonb_set(v_safe, '{questions,0,correctKey}', '"Z"'::jsonb, true),
    (v_safe || '{"privateWorkspace":{"accessToken":"synthetic"}}'::jsonb),
    pg_catalog.jsonb_set(v_safe, '{questions,0,options,1,key}', '"A"'::jsonb, true)
  ] loop
    insert into pg_temp.question_set_approval_type_fixture(snapshot_payload)
      values (v_invalid) returning id into v_id;
    begin
      update pg_temp.question_set_approval_type_fixture
        set status='approved' where id=v_id;
      raise exception 'Malformed legacy snapshot was approved (id=%)', v_id;
    exception when sqlstate '22023' then null;
    end;
    if (select status from pg_temp.question_set_approval_type_fixture where id=v_id)
        is distinct from 'pending' then
      raise exception 'Blocked approval changed status (id=%)', v_id;
    end if;

    -- Rejection/withdrawal must remain possible, with no payload mutation.
    update pg_temp.question_set_approval_type_fixture
      set status='rejected' where id=v_id;
    if (select snapshot_payload from pg_temp.question_set_approval_type_fixture where id=v_id)
        is distinct from v_invalid then
      raise exception 'Rejected legacy snapshot was altered (id=%)', v_id;
    end if;
    begin
      update pg_temp.question_set_approval_type_fixture
        set status='approved' where id=v_id;
      raise exception 'Rejected malformed snapshot was reapproved (id=%)', v_id;
    exception when sqlstate '22023' then null;
    end;
    update pg_temp.question_set_approval_type_fixture
      set status='withdrawn' where id=v_id;
    if (select status from pg_temp.question_set_approval_type_fixture where id=v_id)
        is distinct from 'withdrawn' then
      raise exception 'Legacy withdrawal blocked (id=%)', v_id;
    end if;
  end loop;

  -- Previously approved nonconforming history is not retroactively mutated.
  v_invalid := pg_catalog.jsonb_set(v_safe, '{questions,0,sourcePdfPath}',
    '"/Users/synthetic/historical.pdf"'::jsonb, true);
  insert into pg_temp.question_set_approval_type_fixture(snapshot_payload,status)
    values (v_invalid,'approved') returning id into v_id;
  update pg_temp.question_set_approval_type_fixture
    set review_note='History preserved' where id=v_id;
  update pg_temp.question_set_approval_type_fixture
    set status='approved' where id=v_id;
  update pg_temp.question_set_approval_type_fixture
    set status='rejected' where id=v_id;
  if (select snapshot_payload from pg_temp.question_set_approval_type_fixture where id=v_id)
      is distinct from v_invalid then
    raise exception 'Previously approved snapshot was modified';
  end if;
end $cases$;

rollback;
