-- Community endorsements belong to the academically reviewed publication,
-- not to a reusable entry ID after a safety takedown and resubmission.
-- Preserve likes for continuously approved publications and never touch the
-- protected question snapshot, academic review record, or existing RLS grants.
begin;

create function private.question_set_library_clear_revoked_likes()
returns trigger language plpgsql security definer set search_path = '' as $$
begin
  -- Delete in the same transaction as the status transition. If the
  -- transition rolls back, its endorsements remain intact.
  delete from public.question_set_library_likes where entry_id = old.id;
  return new;
end $$;
revoke all on function private.question_set_library_clear_revoked_likes() from public;

create trigger question_set_library_clear_revoked_likes
after update of status on public.question_set_library_entries
for each row
when (old.status = 'approved' and new.status <> 'approved')
execute function private.question_set_library_clear_revoked_likes();

-- Prevent the like RPC's prior check-then-insert race with a takedown:
-- hold a shared row lock until its insert/delete completes. A takedown
-- either clears the prior endorsement or wins first and blocks the like.
create or replace function public.set_question_set_library_like(p_id uuid, p_liked boolean)
returns void language plpgsql security definer set search_path = '' as $$
declare v_entry uuid;
begin
  if auth.uid() is null then
    raise exception 'Sign in to like a Question Set' using errcode='42501';
  end if;
  perform private.require_account_write_access();
  if p_liked is null then
    raise exception 'This Question Set is unavailable' using errcode='42501';
  end if;
  select id into v_entry from public.question_set_library_entries
    where id = p_id and status = 'approved' for share;
  if not found then
    raise exception 'This Question Set is unavailable' using errcode='42501';
  end if;
  if p_liked then
    insert into public.question_set_library_likes(entry_id,user_id)
      values (v_entry,auth.uid()) on conflict do nothing;
  else
    delete from public.question_set_library_likes
      where entry_id = v_entry and user_id = auth.uid();
  end if;
end $$;
revoke all on function public.set_question_set_library_like(uuid,boolean) from public,anon;
grant execute on function public.set_question_set_library_like(uuid,boolean) to authenticated;

commit;
