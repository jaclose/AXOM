-- Unlisted Question Set links are bearer capabilities. Bound every existing
-- active link and every future link to seven days so a lost browser response
-- cannot leave a permanent, owner-unmanageable capability behind.
update public.question_set_shares
set expires_at = least(
  coalesce(expires_at, created_at + interval '7 days'),
  created_at + interval '7 days'
)
where expires_at is null
  or expires_at > created_at + interval '7 days';

alter table public.question_set_shares
  alter column expires_at set default (now() + interval '7 days'),
  alter column expires_at set not null;

alter table public.question_set_shares
  add constraint question_set_shares_bounded_expiry
  check (expires_at <= created_at + interval '7 days');

create or replace function public.resolve_question_set_share(p_token text)
returns table(
  id uuid,
  title text,
  question_count integer,
  share_format_version integer,
  snapshot_payload jsonb
)
language sql
security definer
set search_path = ''
as $$
  select share.id, share.title, share.question_count,
    share.share_format_version, share.snapshot_payload
  from public.question_set_shares as share
  where share.share_token = p_token
    and share.revoked_at is null
    and share.expires_at > now()
  limit 1
$$;

revoke all on function public.resolve_question_set_share(text) from public;
grant execute on function public.resolve_question_set_share(text) to anon, authenticated;

-- The client lists only these management fields. RLS still limits every read
-- to owner_user_id = auth.uid(); anon receives no table read privilege.
revoke select on table public.question_set_shares from anon, authenticated;
grant select (
  id,
  source_question_set_id,
  share_token,
  title,
  question_count,
  created_at,
  expires_at,
  revoked_at
) on table public.question_set_shares to authenticated;

-- Serialize publication per owner. Repeating the same source snapshot returns
-- its existing active capability, even when the retry has a new createdAt.
-- This makes a retry safe after the server committed but the response was lost.
create or replace function public.create_question_set_share(
  p_source_id text,
  p_snapshot jsonb
) returns jsonb
language plpgsql
security definer
set search_path = pg_catalog, public, pg_temp
as $$
declare
  row public.question_set_shares;
  v_count bigint;
  v_bytes bigint;
begin
  if auth.uid() is null then
    raise exception 'authentication required' using errcode = '42501';
  end if;
  if p_source_id is null
    or btrim(p_source_id) = ''
    or p_source_id <> btrim(p_source_id)
    or char_length(p_source_id) > 200 then
    raise exception 'invalid question set identity';
  end if;
  if octet_length(p_snapshot::text) > 5000000 then
    raise exception 'share payload too large';
  end if;
  if coalesce((p_snapshot->>'shareFormatVersion')::integer, 0) <> 1
    or jsonb_typeof(p_snapshot->'questions') <> 'array' then
    raise exception 'invalid share format';
  end if;

  perform pg_advisory_xact_lock(hashtextextended(auth.uid()::text, 0));

  select share.* into row
  from public.question_set_shares as share
  where share.owner_user_id = auth.uid()
    and share.source_question_set_id = p_source_id
    and share.revoked_at is null
    and share.expires_at > now()
    and share.snapshot_payload - 'createdAt' = p_snapshot - 'createdAt'
  order by share.created_at desc
  limit 1;

  if found then
    return jsonb_build_object(
      'id', row.id,
      'source_question_set_id', row.source_question_set_id,
      'share_token', row.share_token,
      'title', row.title,
      'question_count', row.question_count,
      'created_at', row.created_at,
      'expires_at', row.expires_at,
      'idempotent', true
    );
  end if;

  select count(*), coalesce(sum(octet_length(snapshot_payload::text)), 0)
  into v_count, v_bytes
  from public.question_set_shares
  where owner_user_id = auth.uid()
    and revoked_at is null
    and expires_at > now();

  if v_count >= 20 or v_bytes + octet_length(p_snapshot::text) > 25000000 then
    raise exception 'share storage limit reached; revoke unused shares before creating another'
      using errcode = '54000';
  end if;

  insert into public.question_set_shares (
    owner_user_id,
    source_question_set_id,
    title,
    question_count,
    share_format_version,
    snapshot_payload,
    expires_at
  ) values (
    auth.uid(),
    p_source_id,
    left(p_snapshot->>'title', 200),
    jsonb_array_length(p_snapshot->'questions'),
    1,
    p_snapshot,
    now() + interval '7 days'
  ) returning * into row;

  return jsonb_build_object(
    'id', row.id,
    'source_question_set_id', row.source_question_set_id,
    'share_token', row.share_token,
    'title', row.title,
    'question_count', row.question_count,
    'created_at', row.created_at,
    'expires_at', row.expires_at,
    'idempotent', false
  );
end
$$;

revoke all on function public.create_question_set_share(text, jsonb) from public, anon;
grant execute on function public.create_question_set_share(text, jsonb) to authenticated;
