-- Require the exact inspected public snapshot in the same row update as
-- academic approval/rejection. Client-side readback cannot close this race.
-- Existing publication rows, reviewer roles, and RLS remain untouched.
-- Release alongside the four-argument client; old clients fail closed.
begin;

-- Retire the unsafe three-argument decision without silently allowing legacy
-- clients to approve a revision they have not bound to their inspection.
create or replace function public.review_question_set_library(
  p_id uuid, p_approved boolean, p_reason text
) returns void
language plpgsql security definer set search_path = '' as $$
begin
  raise exception 'Refresh AXOM to review the exact Question Set revision' using errcode='22023';
end $$;
revoke all on function public.review_question_set_library(uuid,boolean,text) from public,anon;
grant execute on function public.review_question_set_library(uuid,boolean,text) to authenticated;

-- jsonb equality is structural, not a client-supplied digest claim: the
-- reviewed snapshot and stored snapshot must match under the row lock.
create function public.review_question_set_library(
  p_id uuid, p_approved boolean, p_reason text, p_expected_snapshot jsonb
) returns void
language plpgsql security definer set search_path = '' as $$
begin
  if not public.academic_is_reviewer() then
    raise exception 'Academic reviewer access required' using errcode='42501';
  end if;
  perform private.require_account_write_access();
  if p_approved is null or length(btrim(coalesce(p_reason,''))) not between 8 and 500 then
    raise exception 'Give a review reason of 8 to 500 characters' using errcode='22023';
  end if;
  if pg_catalog.jsonb_typeof(p_expected_snapshot) is distinct from 'object'
    or pg_catalog.jsonb_typeof(p_expected_snapshot->'questions') is distinct from 'array'
    or pg_catalog.octet_length(p_expected_snapshot::text) > 5000000 then
    raise exception 'Reopen the inspected Question Set before reviewing it' using errcode='22023';
  end if;

  update public.question_set_library_entries
  set status = case when p_approved then 'approved' else 'rejected' end,
      review_note = btrim(p_reason), reviewed_by = auth.uid(), reviewed_at = now(),
      approved_at = case when p_approved then now() else null end
  where id = p_id and status = 'pending'
    and snapshot_payload = p_expected_snapshot
    and title = p_expected_snapshot->>'title'
    and question_count = pg_catalog.jsonb_array_length(p_expected_snapshot->'questions');

  if not found then
    if exists (select 1 from public.question_set_library_entries
               where id = p_id and status = 'pending') then
      raise exception 'The pending Question Set changed since inspection. Reopen and review the current answers'
        using errcode='P0001';
    end if;
    raise exception 'This submission is no longer pending' using errcode='P0002';
  end if;
end $$;
revoke all on function public.review_question_set_library(uuid,boolean,text,jsonb) from public,anon;
grant execute on function public.review_question_set_library(uuid,boolean,text,jsonb) to authenticated;

commit;
