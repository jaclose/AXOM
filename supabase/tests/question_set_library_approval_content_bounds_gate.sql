-- R98 isolated PostgreSQL regression, synthetic data only.
-- Apply R89/R94/R95/R96/R97/R98 migrations to a disposable database.
-- Execute with psql -v ON_ERROR_STOP=1; never against production.
begin;
do $exists$
begin
  if not exists (select 1 from pg_catalog.pg_trigger
    where tgrelid='public.question_set_library_entries'::pg_catalog.regclass
      and tgname='question_set_library_approval_z_content_bounds_gate'
      and not tgisinternal) then raise exception 'Missing R98 trigger'; end if;
end $exists$;
create temporary table qbank_r98_fixture (
  id bigint generated always as identity primary key,
  snapshot_payload jsonb not null,
  status text not null default 'pending',
  review_note text not null default ''
) on commit drop;
create trigger question_set_library_approval_citation_gate
before update of status on pg_temp.qbank_r98_fixture
for each row when (new.status='approved' and old.status is distinct from new.status)
execute function private.question_set_library_assert_approval_citation_privacy();
create trigger question_set_library_approval_snapshot_type_gate
before update of status on pg_temp.qbank_r98_fixture
for each row when (new.status='approved' and old.status is distinct from new.status)
execute function private.question_set_library_require_snapshot_types();
create trigger question_set_library_approval_z_content_bounds_gate
before update of status on pg_temp.qbank_r98_fixture
for each row when (new.status='approved' and old.status is distinct from new.status)
execute function private.question_set_library_require_approval_content_bounds();

do $cases$
declare
  v_safe jsonb := '{"shareFormatVersion":1,"title":"Synthetic Question Set",
    "tags":[],"orderedQuestionIds":["q1"],
    "questions":[{"id":"q1","stem":"Which option?","options":[{"key":"A","text":"Yes"},{"key":"B","text":"No"}],
      "correctKey":"A","tags":[],"citation":"PMID: 123456"}],
    "createdAt":"2026-11-13T00:00:00Z","copyrightNotice":"Synthetic source"}'::jsonb;
  v_invalid jsonb; v_bound jsonb; v_field text; v_id bigint; v_test integer := 0;
begin
  insert into pg_temp.qbank_r98_fixture(snapshot_payload) values(v_safe) returning id into v_id;
  update pg_temp.qbank_r98_fixture set status='approved' where id=v_id;
  -- Exact inclusive limits must remain accepted.
  v_bound := pg_catalog.jsonb_set(v_safe,'{title}',pg_catalog.to_jsonb(pg_catalog.repeat('T',200)),true);
  v_bound := pg_catalog.jsonb_set(v_bound,'{copyrightNotice}',pg_catalog.to_jsonb(pg_catalog.repeat('C',500)),true);
  v_bound := pg_catalog.jsonb_set(v_bound,'{createdAt}','"2026-11-13"'::jsonb,true);
  v_bound := pg_catalog.jsonb_set(v_bound,'{questions,0,stem}',pg_catalog.to_jsonb(pg_catalog.repeat('S',8000)),true);
  v_bound := pg_catalog.jsonb_set(v_bound,'{questions,0,explanation}',pg_catalog.to_jsonb(pg_catalog.repeat('E',30000)),true);
  v_bound := pg_catalog.jsonb_set(v_bound,'{questions,0,citation}',pg_catalog.to_jsonb(pg_catalog.repeat('P',2000)),true);
  foreach v_field in array array['system','topic','objective','category','subcategory'] loop
    v_bound := pg_catalog.jsonb_set(v_bound,array['questions','0',v_field],
      pg_catalog.to_jsonb(pg_catalog.repeat('M',500)),true);
  end loop;
  insert into pg_temp.qbank_r98_fixture(snapshot_payload) values(v_bound) returning id into v_id;
  update pg_temp.qbank_r98_fixture set status='approved' where id=v_id;

  -- Older rows bypass current snapshot-write validation; approval cannot.
  foreach v_invalid in array array[
    pg_catalog.jsonb_set(v_safe,'{title}','""'::jsonb,true),
    pg_catalog.jsonb_set(v_safe,'{title}',pg_catalog.to_jsonb(pg_catalog.repeat('T',201)),true),
    pg_catalog.jsonb_set(v_safe,'{copyrightNotice}','""'::jsonb,true),
    pg_catalog.jsonb_set(v_safe,'{copyrightNotice}',pg_catalog.to_jsonb(pg_catalog.repeat('C',501)),true),
    pg_catalog.jsonb_set(v_safe,'{createdAt}','""'::jsonb,true),
    pg_catalog.jsonb_set(v_safe,'{questions,0,stem}','""'::jsonb,true),
    pg_catalog.jsonb_set(v_safe,'{questions,0,stem}',pg_catalog.to_jsonb(pg_catalog.repeat('S',8001)),true),
    pg_catalog.jsonb_set(v_safe,'{questions,0,explanation}',pg_catalog.to_jsonb(pg_catalog.repeat('E',30001)),true),
    pg_catalog.jsonb_set(v_safe,'{questions,0,citation}',pg_catalog.to_jsonb(pg_catalog.repeat('P',2001)),true),
    pg_catalog.jsonb_set(v_safe,'{questions,0,system}',pg_catalog.to_jsonb(pg_catalog.repeat('M',501)),true),
    pg_catalog.jsonb_set(v_safe,'{questions,0,topic}',pg_catalog.to_jsonb(pg_catalog.repeat('M',501)),true),
    pg_catalog.jsonb_set(v_safe,'{questions,0,objective}',pg_catalog.to_jsonb(pg_catalog.repeat('M',501)),true),
    pg_catalog.jsonb_set(v_safe,'{questions,0,category}',pg_catalog.to_jsonb(pg_catalog.repeat('M',501)),true),
    pg_catalog.jsonb_set(v_safe,'{questions,0,subcategory}',pg_catalog.to_jsonb(pg_catalog.repeat('M',501)),true)
  ] loop
    v_test := v_test+1;
    insert into pg_temp.qbank_r98_fixture(snapshot_payload) values(v_invalid) returning id into v_id;
    begin
      update pg_temp.qbank_r98_fixture set status='approved' where id=v_id;
      raise exception 'Malformed legacy snapshot approved (case %)',v_test;
    exception when sqlstate '22023' then null;
    end;
    if (select status from pg_temp.qbank_r98_fixture where id=v_id) is distinct from 'pending'
      or (select snapshot_payload from pg_temp.qbank_r98_fixture where id=v_id)
        is distinct from v_invalid then
      raise exception 'Blocked approval altered data (case %)',v_test;
    end if;
    update pg_temp.qbank_r98_fixture set status='rejected' where id=v_id;
    if (select status from pg_temp.qbank_r98_fixture where id=v_id) is distinct from 'rejected' then
      raise exception 'Safe rejection blocked (case %)',v_test;
    end if;
    delete from pg_temp.qbank_r98_fixture where id=v_id;
  end loop;
  v_invalid := pg_catalog.jsonb_set(v_safe,'{questions,0,stem}','""'::jsonb,true);
  insert into pg_temp.qbank_r98_fixture(snapshot_payload,status)
    values(v_invalid,'approved') returning id into v_id;
  update pg_temp.qbank_r98_fixture set review_note='Historical note' where id=v_id;
  update pg_temp.qbank_r98_fixture set status='approved' where id=v_id;
  if (select snapshot_payload from pg_temp.qbank_r98_fixture where id=v_id)
    is distinct from v_invalid then raise exception 'Existing approved row changed'; end if;
  raise notice 'R98 passed % negative cases, valid boundaries, and history',v_test;
end $cases$;
rollback;
