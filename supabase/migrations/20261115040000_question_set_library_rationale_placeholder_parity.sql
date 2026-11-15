-- R146: Align the Community Question Set SQL admission presence gate with
-- existing TypeScript hasExplanationProse/hasCommunityTeachingRationale.
-- This is not a review of clinical truth, citations, sources, or licensing.
-- Forward-only: replace the helper used by the existing trigger without
-- rewriting historical approved entries, approvals, IDs, likes, or provenance.
begin;

create or replace function private.question_set_library_has_teaching_rationale(p_explanation jsonb)
returns boolean language plpgsql immutable set search_path = '' as $$
declare v_line text;
begin
  if pg_catalog.jsonb_typeof(p_explanation) is distinct from 'string'
    or pg_catalog.length(p_explanation #>> '{}') > 30000 then return false; end if;
  for v_line in
    select pg_catalog.btrim(pg_catalog.regexp_replace(raw_line, '^[[:space:]]*[-*][[:space:]]+', ''))
      from pg_catalog.regexp_split_to_table(p_explanation #>> '{}', E'\\r?\\n') raw_line
  loop
    if pg_catalog.length(v_line) < 12
      or v_line ~* '^(source|reference|citation)[[:space:]]*:'
      or v_line ~* '^(answer|ans|key)[[:space:]]*(:|is)?[[:space:]]*\\(?[A-J]\\)?[[:punct:]]*$'
      or v_line ~* '^(the[[:space:]]+)?(correct|right)[[:space:]]+(option|choice)[[:space:]]*(is|:)?[[:space:]]*\\(?[A-J]\\)?[[:punct:]]*$'
      or v_line ~* '^(option|choice)[[:space:]]*(is|:)?[[:space:]]*\\(?[A-J]\\)?([[:space:]]+is[[:space:]]+(correct|right))?[[:punct:]]*$'
      or v_line ~* '^it[[:space:]]+is[[:space:]]+\\(?[A-J]\\)?[[:punct:]]*$'
      or v_line ~* '^(tbd|todo|n/a)[[:punct:]]*$'
      or v_line ~* '^(explanation|rationale)[[:space:]]*[:=]?[[:space:]]*(is[[:space:]]+)?(pending|missing|tbd|todo|under[[:space:]]+review|to[[:space:]]+be[[:space:]]+(added|written|provided)|will[[:space:]]+be[[:space:]]+added|coming[[:space:]]+soon)[[:punct:]]*$'
      or v_line ~* '^(source|answer)[[:space:]]+verification[[:space:]]+(pending|required)[[:punct:]]*$'
      or v_line ~* '^(needs|awaiting)[[:space:]]+(review|verification)[[:punct:]]*$'
      or v_line ~* '^no[[:space:]]+(teaching[[:space:]]+)?(explanation|rationale)([[:space:]]+(has[[:space:]]+been|was|is))?[[:space:]]+(provided|supplied|recorded|available)[[:punct:]]*$'
      or v_line ~* '^(see|refer[[:space:]]+to)[[:space:]]+(lecture[[:space:]]+)?(slide|page)[[:space:]]*#?[0-9]+[[:punct:]]*$'
      or v_line ~* '^powerpoint[[:space:]]+slide[[:space:]]+note[[:space:]]+[0-9]+[[:space:]]+explicitly[[:space:]]+marks[[:space:]]+\\(?[A-J]\\)?[[:punct:]]*$'
      -- The TypeScript coverage predicate also excludes bare answer-label prose
      -- and the exact incomplete-source notice; these were previously accepted
      -- by SQL's >=12-character heuristic.
      or v_line ~* '^(the[[:space:]]+)?(correct|right)[[:space:]]+(answer|ans|key)[[:space:]]*(is|:)?[[:space:]]*\\(?[A-J]\\)?[[:punct:]]*$'
      or v_line ~* '^the[[:space:]]+supplied[[:space:]]+notes[[:space:]]+do[[:space:]]+not[[:space:]]+provide[[:space:]]+a[[:space:]]+teaching[[:space:]]+rationale[[:punct:]]*$'
    then continue; end if;
    return true;
  end loop;
  return false;
end $$;

-- The existing admission trigger calls this helper at new submission,
-- revision replacement and pending->approved, with no historical rewrite.
revoke all on function private.question_set_library_has_teaching_rationale(jsonb)
  from public, anon, authenticated;

commit;
