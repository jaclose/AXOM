-- R89: reject device-local citation provenance in NEW Community Question Set
-- publication snapshots, including direct authenticated RPC submissions.
-- Existing approved/rejected/pending rows are not rewritten or rescanned.
-- Status/reviewer/like changes do not fire this trigger.
begin;

-- Called by a SECURITY DEFINER trigger only. Keep the predicate private
-- so clients cannot use it to bypass the existing publication RPC checks.
create function private.question_set_library_has_private_citation(p_citation text)
returns boolean
language plpgsql immutable strict set search_path = '' as $$
declare
  v_value text := pg_catalog.btrim(p_citation);
  v_decoded text;
  v_match text[];
  v_token text;
  v_at integer;
  v_cursor integer;
  v_byte integer;
  v_replacements integer := 0;
  v_pass integer;
begin
  -- Match only token-boundary paths, not /home/ or /Volumes/ appearing
  -- inside ordinary HTTPS URLs. Also recognize Windows UNC shares.
  for v_pass in 0..3 loop
    if v_value ~* $path$(^|[^a-z0-9/@])(file:/+|content://|/(users|home|private|volumes|mnt|media)/|~/|[a-z]:[/\\])$path$
       or pg_catalog.strpos(v_value, E'\\\\') > 0 then
      return true;
    end if;
    exit when v_pass = 3;

    -- Bounded percent decoding mirrors the publishing client. Decode
    -- individually rather than rejecting or skipping a malformed escape;
    -- otherwise an unrelated %GG could hide an encoded file:// prefix.
    v_decoded := '';
    v_cursor := 1;
    loop
      v_match := pg_catalog.regexp_match(pg_catalog.substr(v_value, v_cursor), '%([a-fA-F0-9]{2})');
      exit when v_match is null;
      v_replacements := v_replacements + 1;
      -- Fail closed on pathologically encoded citations; each citation
      -- is already constrained to 2,000 characters in the submission RPC.
      if v_replacements > 512 then return true; end if;
      v_token := '%' || v_match[1];
      v_at := pg_catalog.strpos(pg_catalog.substr(v_value, v_cursor), v_token);
      v_byte := pg_catalog.get_byte(pg_catalog.decode(v_match[1], 'hex'), 0);
      if v_byte < 32 or v_byte = 127 then return true; end if;
      v_decoded := v_decoded || pg_catalog.substr(v_value, v_cursor, v_at - 1)
        || pg_catalog.chr(v_byte);
      v_cursor := v_cursor + v_at + 2;
    end loop;
    v_decoded := v_decoded || pg_catalog.substr(v_value, v_cursor);
    exit when v_decoded = v_value;
    v_value := v_decoded;
  end loop;
  return false;
end $$;

revoke all on function private.question_set_library_has_private_citation(text)
  from public, anon, authenticated;

-- Trigger on the stored publication boundary rather than replacing
-- submit_question_set_library: the existing auth, attestation, exact
-- snapshot, review and RLS contracts remain unchanged.
create function private.question_set_library_assert_citation_privacy()
returns trigger
language plpgsql security definer set search_path = '' as $$
declare
  v_question jsonb;
begin
  if pg_catalog.jsonb_typeof(new.snapshot_payload->'questions') = 'array' then
    for v_question in
      select value from pg_catalog.jsonb_array_elements(new.snapshot_payload->'questions')
    loop
      if pg_catalog.jsonb_typeof(v_question->'citation') = 'string'
         and private.question_set_library_has_private_citation(v_question->>'citation') then
        raise exception 'Question Set citation contains a private local file path'
          using errcode = '22023';
      end if;
    end loop;
  end if;
  return new;
end $$;

revoke all on function private.question_set_library_assert_citation_privacy()
  from public, anon, authenticated;

create trigger question_set_library_private_citation_gate
before insert or update of snapshot_payload
on public.question_set_library_entries
for each row execute function private.question_set_library_assert_citation_privacy();

commit;
