-- AXOM Host: bounded, cursor-paginated owner audit history.
-- Forward-only: no role, learner record, existing audit receipt or RLS policy changes.
begin;

create function public.axom_operator_audit_page(
  max_rows integer default 31,
  before_created_at timestamptz default null,
  before_id uuid default null
)
returns table (
  id uuid,
  actor_id uuid,
  action text,
  target_id uuid,
  metadata jsonb,
  created_at timestamptz
)
language plpgsql stable security definer set search_path = '' as $$
begin
  if public.axom_operator_role() is distinct from 'owner' then
    raise exception 'Only the verified owner may inspect the full audit history'
      using errcode = '42501';
  end if;
  if max_rows is null or max_rows not between 1 and 100 then
    raise exception 'Invalid audit page size' using errcode = '22023';
  end if;
  if (before_created_at is null) <> (before_id is null) then
    raise exception 'Both audit cursor fields are required' using errcode = '22023';
  end if;
  return query
    select a.id, a.actor_id, a.action, a.target_id, a.metadata, a.created_at
      from public.axom_operator_audit a
     where before_created_at is null
        or (a.created_at, a.id) < (before_created_at, before_id)
     order by a.created_at desc, a.id desc
     limit max_rows;
end $$;

revoke all on function public.axom_operator_audit_page(integer,timestamptz,uuid)
  from public,anon,authenticated;
grant execute on function public.axom_operator_audit_page(integer,timestamptz,uuid)
  to authenticated;

commit;
