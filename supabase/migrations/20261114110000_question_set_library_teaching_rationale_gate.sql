-- R128: Community Question Sets need answer evidence and teaching prose at the
-- database trust boundary. This is a bounded presence heuristic, NOT medical,
-- source or licensing verification; independent academic review is still required.
-- No historical publications are rewritten. Rejection remains available.
begin;

create function private.question_set_library_has_teaching_rationale(p_explanation jsonb)
returns boolean language plpgsql immutable set search_path = '' as $$
declare v_line text;
begin
  if pg_catalog.jsonb_typeof(p_explanation) is distinct from 'string'
    or pg_catalog.length(p_explanation #>> '{}') > 30000 then return false; end if;
  for v_line in
    select pg_catalog.btrim(pg_catalog.regexp_replace(raw_line, '^[[:space:]]*[-*][[:space:]]+', ''))
      from pg_catalog.regexp_split_to_table(p_explanation #>> '{}', E'\r?\n') raw_line
  loop
    if pg_catalog.length(v_line) < 12
      or v_line ~* '^(source|reference|citation)[[:space:]]*:'
      or v_line ~* '^(answer|ans|key)[[:space:]]*(:|is)?[[:space:]]*\(?[A-J]\)?[[:punct:]]*$'
      or v_line ~* '^(the[[:space:]]+)?(correct|right)[[:space:]]+(option|choice)[[:space:]]*(is|:)?[[:space:]]*\(?[A-J]\)?[[:punct:]]*$'
      or v_line ~* '^(option|choice)[[:space:]]*(is|:)?[[:space:]]*\(?[A-J]\)?([[:space:]]+is[[:space:]]+(correct|right))?[[:punct:]]*$'
      or v_line ~* '^it[[:space:]]+is[[:space:]]+\(?[A-J]\)?[[:punct:]]*$'
      or v_line ~* '^(tbd|todo|n/a)[[:punct:]]*$'
      or v_line ~* '^(explanation|rationale)[[:space:]]*[:=]?[[:space:]]*(is[[:space:]]+)?(pending|missing|tbd|todo|under[[:space:]]+review|to[[:space:]]+be[[:space:]]+(added|written|provided)|coming[[:space:]]+soon)[[:punct:]]*$'
      or v_line ~* '^(source|answer)[[:space:]]+verification[[:space:]]+(pending|required)[[:punct:]]*$'
      or v_line ~* '^(needs|awaiting)[[:space:]]+(review|verification)[[:punct:]]*$'
      or v_line ~* '^no[[:space:]]+(teaching[[:space:]]+)?(explanation|rationale)([[:space:]]+(has[[:space:]]+been|was|is))?[[:space:]]+(provided|supplied|recorded|available)[[:punct:]]*$'
      or v_line ~* '^(see|refer[[:space:]]+to)[[:space:]]+(lecture[[:space:]]+)?(slide|page)[[:space:]]*#?[0-9]+[[:punct:]]*$'
      or v_line ~* '^powerpoint[[:space:]]+slide[[:space:]]+note[[:space:]]+[0-9]+[[:space:]]+explicitly[[:space:]]+marks[[:space:]]+\(?[A-J]\)?[[:punct:]]*$'
    then continue; end if;
    return true;
  end loop;
  return false;
end $$;
revoke all on function private.question_set_library_has_teaching_rationale(jsonb)
  from public,anon,authenticated;

create function private.question_set_library_require_teaching_rationale()
returns trigger language plpgsql set search_path = '' as $$
declare v_question jsonb;
begin
  if tg_op = 'UPDATE' then
    if new.status = 'rejected'
      or (new.status = old.status and new.snapshot_payload is not distinct from old.snapshot_payload)
    then return new; end if;
  end if;
  if new.status not in ('pending','approved') then return new; end if;
  if pg_catalog.jsonb_typeof(new.snapshot_payload->'questions') is distinct from 'array'
    or pg_catalog.jsonb_array_length(new.snapshot_payload->'questions') < 1 then
    raise exception 'Community Question Set requires keyed questions with teaching explanations'
      using errcode='22023';
  end if;
  for v_question in select value from pg_catalog.jsonb_array_elements(new.snapshot_payload->'questions') loop
    if pg_catalog.jsonb_typeof(v_question) is distinct from 'object'
      or pg_catalog.jsonb_typeof(v_question->'correctKey') is distinct from 'string'
      or pg_catalog.btrim(coalesce(v_question->>'correctKey','')) = ''
      or not private.question_set_library_has_teaching_rationale(v_question->'explanation') then
      raise exception 'Community Question Set requires a reviewed answer and substantive teaching explanation for every question'
        using errcode='22023';
    end if;
  end loop;
  return new;
end $$;
revoke all on function private.question_set_library_require_teaching_rationale()
  from public,anon,authenticated;

-- Protect submission INSERTs, rejected->pending revision replacements, pending
-- edits, and pending->approved decisions. Existing approved/no-op rows and
-- historical rejection or withdrawal are not modified.
create trigger question_set_library_admission_teaching_rationale_gate
before insert or update of snapshot_payload,status
on public.question_set_library_entries
for each row execute function private.question_set_library_require_teaching_rationale();

commit;
