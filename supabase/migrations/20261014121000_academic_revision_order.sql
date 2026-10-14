-- A completed older upload must never replace a newer current collection
-- revision when its final network acknowledgement arrives out of order.
-- Both revision objects remain immutable and ready; user enrollment remains.
create function axom_private.guard_academic_current_revision() returns trigger
language plpgsql security definer set search_path = '' as $$
declare
  former timestamptz;
  candidate timestamptz;
begin
  if new.current_revision_id is not distinct from old.current_revision_id
     or old.current_revision_id is null or new.current_revision_id is null then
    return new;
  end if;
  select created_at into former from public.academic_revisions where id=old.current_revision_id and collection_id=old.id;
  select created_at into candidate from public.academic_revisions where id=new.current_revision_id and collection_id=new.id;
  if former is null or candidate is null then
    raise exception 'Invalid academic revision relationship' using errcode='PT400';
  end if;
  -- Equal commit-time timestamps do not prove ordering. Fail closed.
  if candidate <= former then
    -- Do not reset review status or updated_at when a stale pending upload
    -- becomes ready; preserve the newer active revision and its approvals.
    return null;
  end if;
  return new;
end $$;
revoke all on function axom_private.guard_academic_current_revision() from public, anon, authenticated;
create trigger guard_academic_current_revision_before_update
before update of current_revision_id on public.academic_collections
for each row execute function axom_private.guard_academic_current_revision();
