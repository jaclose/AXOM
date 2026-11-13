-- Forward-only R94 gate for inline citation media. This intentionally does not
-- amend the held 01:10 private-path migration: applied ledgers may vary.
-- Data URIs can contain raw private/rights-uncleared material; blob URLs are
-- session-bound object references rather than durable public source evidence.
begin;

create function private.question_set_library_has_inline_document_uri(p_citation text)
returns boolean
language plpgsql immutable strict set search_path = '' as $$
declare
  v_value text := pg_catalog.btrim(p_citation);
  v_decoded text;
  v_match text[];
  v_token text;
  v_cursor integer;
  v_at integer;
  v_byte integer;
  v_replacements integer := 0;
  v_pass integer;
begin
  -- Enforce a bounded decoding cost even for direct database callers.
  if pg_catalog.length(v_value) > 2000 then return true; end if;
  for v_pass in 0..3 loop
    -- Check before public HTTP(S) masking. A redirect parameter can contain
    -- an embedded data: or blob: source, including percent-encoded variants.
    if v_value ~* $inline$(^|[^a-z0-9])(blob:(https?://|null/)|data:[^[:space:],;]*[,;])$inline$ then
      return true;
    end if;
    exit when v_pass = 3;
    v_decoded := '';
    v_cursor := 1;
    loop
      v_match := pg_catalog.regexp_match(pg_catalog.substr(v_value, v_cursor), '%([a-fA-F0-9]{2})');
      exit when v_match is null;
      v_replacements := v_replacements + 1;
      if v_replacements > 512 then return true; end if;
      v_token := '%' || v_match[1];
      v_at := pg_catalog.strpos(pg_catalog.substr(v_value, v_cursor), v_token);
      v_byte := pg_catalog.get_byte(pg_catalog.decode(v_match[1], 'hex'), 0);
      if v_byte < 32 or v_byte = 127 then return true; end if;
      -- Preserve high-bit octets as escapes, as the earlier privacy gate does.
      v_decoded := v_decoded || pg_catalog.substr(v_value, v_cursor, v_at - 1)
        || case when v_byte > 127 then v_token else pg_catalog.chr(v_byte) end;
      v_cursor := v_cursor + v_at + 2;
    end loop;
    v_decoded := v_decoded || pg_catalog.substr(v_value, v_cursor);
    exit when v_decoded = v_value;
    v_value := v_decoded;
  end loop;
  return false;
end $$;

revoke all on function private.question_set_library_has_inline_document_uri(text)
  from public, anon, authenticated;

create function private.question_set_library_assert_inline_document_uri()
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
         and private.question_set_library_has_inline_document_uri(v_question->>'citation') then
        raise exception 'Question Set citation contains an inline document or transient browser URI'
          using errcode = '22023';
      end if;
    end loop;
  end if;
  return new;
end $$;

revoke all on function private.question_set_library_assert_inline_document_uri()
  from public, anon, authenticated;

-- Applies only to new/replaced publication payloads. It does not rewrite
-- stored snapshots or interrupt status/reviewer/like-only transitions.
create trigger question_set_library_inline_document_uri_gate
before insert or update of snapshot_payload
on public.question_set_library_entries
for each row execute function private.question_set_library_assert_inline_document_uri();

commit;
