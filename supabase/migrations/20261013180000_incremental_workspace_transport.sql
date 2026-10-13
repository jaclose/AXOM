-- Add a bounded wire adapter. The established revision writer still owns
-- locking, conflicts, retention and acknowledgement. No learner data is reset.
create function public.push_workspace_delta_v2(
  p_base_revision bigint, p_base_hash text, p_schema_version integer, p_content_hash text,
  p_changes jsonb, p_device_id uuid, p_idempotency_key uuid, p_reason text default 'automatic'
) returns jsonb language plpgsql security invoker set search_path = '' as $$
declare
  original public.workspace_revisions;
  replay public.workspace_revisions;
  packed jsonb;
  body jsonb;
  item jsonb;
  path text[];
  parent jsonb;
  parent_path text[];
  leaf text;
  text_content text;
begin
  if auth.uid() is null then raise exception 'authentication required' using errcode='42501'; end if;
  if p_changes is null or jsonb_typeof(p_changes) <> 'array' then raise exception 'invalid changes' using errcode='PT400'; end if;
  if jsonb_array_length(p_changes)>1000 or octet_length(p_changes::text)>1000000 then
    raise exception 'changes exceed the bounded transfer limit' using errcode='PT413';
  end if;
  -- A lost acknowledgement may outlive the original base's retention window.
  -- Resolve that exact key before attempting to reconstruct anything.
  select * into replay from public.workspace_revisions where user_id=auth.uid() and idempotency_key=p_idempotency_key;
  if found then
    if replay.reason='conflict' then
      return jsonb_build_object('status','conflict','server_revision',
        (select current_revision from public.workspaces where user_id=auth.uid()),'preserved_revision_id',replay.id);
    end if;
    return jsonb_build_object('status','accepted','revision',replay.revision,'revision_id',replay.id,
      'idempotent',true,'content_hash',replay.content_hash);
  end if;
  select * into original from public.workspace_revisions
    where user_id=auth.uid() and revision=p_base_revision and reason<>'conflict';
  if not found or original.content_hash is distinct from p_base_hash
    or original.snapshot_payload->>'_axomDeltaFormat' is distinct from '1' then
    raise exception 'acknowledged base unavailable; send a full protected version' using errcode='PT428';
  end if;
  packed := original.snapshot_payload;
  body := jsonb_build_object('workspace',(packed->>'content')::jsonb,'sources',packed->'sources','media',packed->'media');
  for item in select value from jsonb_array_elements(p_changes) loop
    if jsonb_typeof(item) is distinct from 'object' or item->>'op' not in ('set','remove','append')
      or item->>'op' is null or jsonb_typeof(item->'path') is distinct from 'array' then
      raise exception 'invalid change operation' using errcode='PT400';
    end if;
    if jsonb_array_length(item->'path') not between 1 and 16 or exists (
      select 1 from jsonb_array_elements(item->'path') token
      where jsonb_typeof(token) <> 'string' or octet_length(token#>>'{}') not between 1 and 256
    ) then raise exception 'invalid change path' using errcode='PT400'; end if;
    select array_agg(value order by ord) into path from jsonb_array_elements_text(item->'path') with ordinality as tokens(value,ord);
    if path[1] not in ('workspace','sources','media') then raise exception 'unknown change root' using errcode='PT400'; end if;
    parent_path := path[1:cardinality(path)-1];
    parent := case when cardinality(path)=1 then body else body#>parent_path end;
    leaf := path[cardinality(path)];
    if parent is null or jsonb_typeof(parent) not in ('object','array') then raise exception 'missing change parent' using errcode='PT400'; end if;
    if jsonb_typeof(parent)='array' then
      if leaf !~ '^(0|[1-9][0-9]{0,7})$' then raise exception 'invalid array position' using errcode='PT400'; end if;
      if leaf::integer >= jsonb_array_length(parent) then raise exception 'array position outside base' using errcode='PT400'; end if;
    end if;
    if item->>'op'='remove' then
      if cardinality(path)=1 or body#>path is null then raise exception 'cannot remove this path' using errcode='PT400'; end if;
      body := body#-path;
    elsif item->>'op'='append' then
      if jsonb_typeof(body#>path) is distinct from 'array' or jsonb_typeof(item->'value') is distinct from 'array' then
        raise exception 'append requires arrays' using errcode='PT400';
      end if;
      body := jsonb_set(body,path,(body#>path)||(item->'value'),false);
    else
      if not (item ? 'value') then raise exception 'set requires a value' using errcode='PT400'; end if;
      body := jsonb_set(body,path,item->'value',true);
    end if;
    if octet_length(body::text)>15000000 then raise exception 'snapshot too large' using errcode='PT413'; end if;
  end loop;
  if jsonb_typeof(body->'workspace') is distinct from 'object' then raise exception 'invalid workspace' using errcode='PT400'; end if;
  text_content := (body->'workspace')::text;
  packed := packed || jsonb_build_object('content',text_content,'expandedBytes',octet_length(text_content),
    'sources',body->'sources','media',body->'media');
  -- Revalidate every referenced object under the caller's own RLS. Reuse all
  -- existing conflict preservation and retention rules, including stale bases.
  return public.push_workspace_revision_v2(p_base_revision,p_schema_version,p_content_hash,packed,p_device_id,p_idempotency_key,p_reason);
end $$;
revoke all on function public.push_workspace_delta_v2(bigint,text,integer,text,jsonb,uuid,uuid,text) from public, anon;
grant execute on function public.push_workspace_delta_v2(bigint,text,integer,text,jsonb,uuid,uuid,text) to authenticated, service_role;
