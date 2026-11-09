-- Keep searchable public Question Set projections tied to the exact reviewed
-- snapshot. A privileged maintenance update must not leave valid public JSON
-- indexed under a different title, tags or question count.
--
-- This is an additive write guard: existing publications and RLS are untouched.
-- A legitimate rejected-set resubmission changes the snapshot and projections
-- together in the existing submission RPC.
begin;

create function private.question_set_library_require_projection_consistency()
returns trigger language plpgsql set search_path = '' as $$
begin
  -- Defensive shape check for direct privileged writes. The preceding
  -- snapshot-types trigger enforces deeper schema, reviewed keys and privacy.
  if pg_catalog.jsonb_typeof(new.snapshot_payload) is distinct from 'object'
    or pg_catalog.jsonb_typeof(new.snapshot_payload->'title') is distinct from 'string'
    or pg_catalog.jsonb_typeof(new.snapshot_payload->'tags') is distinct from 'array'
    or pg_catalog.jsonb_typeof(new.snapshot_payload->'questions') is distinct from 'array' then
    raise exception 'Question Set public projection differs from its snapshot'
      using errcode = '22023';
  end if;

  if new.title is distinct from new.snapshot_payload->>'title'
    or new.question_count is distinct from pg_catalog.jsonb_array_length(new.snapshot_payload->'questions')
    or new.tags is distinct from array(
      select tag #>> '{}'
      from pg_catalog.jsonb_array_elements(new.snapshot_payload->'tags')
        with ordinality as snapshot_tag(tag, ordinal)
      order by ordinal
    ) then
    raise exception 'Question Set public projection differs from its snapshot'
      using errcode = '22023';
  end if;

  return new;
end $$;

-- Runs after the more detailed type guard. Status-only moderation, reviewer
-- deletion, owner withdrawal and likes do not require reprojection.
create trigger zz_question_set_library_projection_consistency
before insert or update of snapshot_payload, title, tags, question_count
on public.question_set_library_entries
for each row execute function private.question_set_library_require_projection_consistency();

commit;
