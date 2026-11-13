-- Forward-only R95 patch for the R94 inline-citation validator.
-- Replaces the existing private function (and preserves its trigger, permissions,
-- stored snapshots and approval state). Requires the earlier R94 migration.
-- Release must remain held pending SQL staging and migration-ledger verification.
begin;

create or replace function private.question_set_library_has_inline_document_uri(p_citation text)
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
    -- A fourth percent layer must not hide inline data/blob references.
    -- Reject residual encoded URI delimiters at any depth; hold 4+ nested
    -- escapes when the scheme letters themselves were encoded.
    if v_value ~* $residual$(^|[^a-z0-9])(file|content|data|blob)%(25)*3a$residual$
       or v_value ~* $deep$%(25){3,}[0-9a-f]{2}$deep$ then
      return true;
    end if;
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

commit;
