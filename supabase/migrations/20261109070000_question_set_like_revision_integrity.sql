-- Keep every endorsement attached to the publication it originally supported.
-- A safety takedown never deletes learner history. A newly approved publication
-- starts a new epoch; ordinary metadata edits retain the current endorsements.
begin;

alter table public.question_set_library_entries
  add column publication_epoch bigint not null default 0 check (publication_epoch >= 0);
update public.question_set_library_entries set publication_epoch = 1 where status = 'approved';
alter table public.question_set_library_likes
  add column publication_epoch bigint not null default 0 check (publication_epoch >= 0);
-- Legacy likes for a currently unavailable publication cannot establish which
-- edition was endorsed. Retain them in epoch zero without displaying a claim.
update public.question_set_library_likes l set publication_epoch = e.publication_epoch
  from public.question_set_library_entries e where e.id = l.entry_id and e.status = 'approved';
alter table public.question_set_library_likes drop constraint question_set_library_likes_pkey;
alter table public.question_set_library_likes
  add primary key (entry_id, user_id, publication_epoch);

create function private.question_set_library_publication_epoch()
returns trigger language plpgsql security definer set search_path = '' as $$
begin
  if tg_op = 'INSERT' then
    new.publication_epoch := 0;
  elsif old.status <> 'approved' and new.status = 'approved' then
    new.publication_epoch := old.publication_epoch + 1;
  else
    new.publication_epoch := old.publication_epoch;
  end if;
  return new;
end $$;
revoke all on function private.question_set_library_publication_epoch() from public;
create trigger question_set_library_publication_epoch
before insert or update on public.question_set_library_entries
for each row execute function private.question_set_library_publication_epoch();

-- Lock the publication while recording a like, so a concurrent takedown cannot
-- attach it to a different approved edition. Unlike is the user's explicit action
-- and removes only their endorsement of this edition, preserving prior history.
create or replace function public.set_question_set_library_like(p_id uuid, p_liked boolean)
returns void language plpgsql security definer set search_path = '' as $$
declare v_entry public.question_set_library_entries;
begin
  if auth.uid() is null then
    raise exception 'Sign in to like a Question Set' using errcode='42501';
  end if;
  perform private.require_account_write_access();
  if p_liked is null then
    raise exception 'This Question Set is unavailable' using errcode='42501';
  end if;
  select * into v_entry from public.question_set_library_entries
    where id = p_id and status = 'approved' for share;
  if not found then
    raise exception 'This Question Set is unavailable' using errcode='42501';
  end if;
  if p_liked then
    insert into public.question_set_library_likes(entry_id,user_id,publication_epoch)
      values (v_entry.id,auth.uid(),v_entry.publication_epoch) on conflict do nothing;
  else
    delete from public.question_set_library_likes
      where entry_id = v_entry.id and user_id = auth.uid()
        and publication_epoch = v_entry.publication_epoch;
  end if;
end $$;
revoke all on function public.set_question_set_library_like(uuid,boolean) from public,anon;
grant execute on function public.set_question_set_library_like(uuid,boolean) to authenticated;

create or replace function public.list_question_set_library(p_search text default '', p_offset integer default 0)
returns table(id uuid, title text, credit text, tags text[], question_count integer,
  approved_at timestamptz, likes bigint, liked boolean)
language plpgsql stable security definer set search_path = '' as $$
begin
  if auth.uid() is null then raise exception 'Sign in to search the library' using errcode='42501'; end if;
  if length(coalesce(p_search,'')) > 100 or p_offset is null or p_offset < 0 or p_offset > 1000 then
    raise exception 'Invalid library search' using errcode='22023';
  end if;
  return query select e.id,e.title,e.credit,e.tags,e.question_count,e.approved_at,
    (select count(*) from public.question_set_library_likes l
      where l.entry_id=e.id and l.publication_epoch=e.publication_epoch),
    exists (select 1 from public.question_set_library_likes l
      where l.entry_id=e.id and l.user_id=auth.uid() and l.publication_epoch=e.publication_epoch)
  from public.question_set_library_entries e
  where e.status='approved' and (btrim(coalesce(p_search,'')) = ''
    or position(lower(btrim(p_search)) in lower(e.title || ' ' || e.credit || ' ' || array_to_string(e.tags,' '))) > 0)
  order by e.approved_at desc,e.id desc limit 24 offset p_offset;
end $$;
revoke all on function public.list_question_set_library(text,integer) from public,anon;
grant execute on function public.list_question_set_library(text,integer) to authenticated;

commit;
