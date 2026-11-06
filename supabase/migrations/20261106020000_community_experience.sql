-- Account-scoped consent, revocable automatic progress and social conversations.
-- Existing unmarked posts remain manual: their provenance cannot be inferred.
begin;

-- A trusted Auth deletion can retain a request-sub GUC while cascading. Check
-- the actual request role, which remains authenticated inside definer RPCs,
-- rather than treating a stale subject on a trusted connection as a new write.
create or replace function private.social_write_guard() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  if current_setting('role',true)='authenticated' then
    perform private.require_account_write_access();
  end if;
  if tg_op='DELETE' then return old; end if;
  return new;
end $$;

create table public.social_preferences (
  user_id uuid primary key references auth.users(id) on delete cascade,
  discoverable boolean not null default false,
  share_mode text not null default 'off' check (share_mode in ('off','friends','community')),
  revision bigint not null default 1 check (revision > 0),
  updated_at timestamptz not null default now()
);
alter table public.social_preferences enable row level security;
revoke all on public.social_preferences from public, anon, authenticated;
grant select on public.social_preferences to authenticated;
grant all on public.social_preferences to service_role;
create policy social_preferences_own on public.social_preferences for select to authenticated
using (user_id = (select auth.uid()));
create trigger social_preferences_privacy_barrier before insert or update or delete on public.social_preferences
for each row execute function private.social_write_guard();

-- Preserve existing discovery choices, but do not invent consent for automatic
-- publishing from older metadata. A saved setup choice seeds only new accounts.
insert into public.social_preferences(user_id, discoverable)
select u.id, coalesce(p.discoverable, false)
from auth.users u left join public.social_profiles p on p.user_id = u.id;

create function private.seed_community_preferences() returns trigger
language plpgsql security definer set search_path = '' as $$
declare choices jsonb := new.raw_user_meta_data -> 'axom_community_preferences';
begin
  insert into public.social_preferences(user_id, discoverable, share_mode)
  values (new.id,
    coalesce(choices -> 'discoverable' = 'true'::jsonb, false),
    case when choices ->> 'shareMode' in ('friends','community')
      then choices ->> 'shareMode' else 'off' end);
  return new;
end $$;
revoke all on function private.seed_community_preferences() from public, anon, authenticated;
create trigger axom_new_account_community_preferences after insert on auth.users
for each row execute function private.seed_community_preferences();

-- Profile membership/discovery must use the account-scoped RPCs as well. An old
-- client cannot create a visible profile over a hidden setup choice or leave a
-- profile while automatic-sharing consent remains enabled.
revoke insert,update,delete on public.social_profiles from authenticated;
grant update(handle,display_name,bio) on public.social_profiles to authenticated;
create function private.social_profile_updated() returns trigger
language plpgsql set search_path = '' as $$
begin
  new.updated_at := now();
  return new;
end $$;
revoke all on function private.social_profile_updated() from public,anon,authenticated;
create trigger social_profile_updated before update on public.social_profiles
for each row execute function private.social_profile_updated();

alter table public.social_posts
  add column share_source text not null default 'manual'
    check (share_source in ('manual','automatic','withdrawn')),
  add column revision bigint not null default 1 check (revision > 0);
alter table public.social_posts drop constraint social_posts_kind_check;
alter table public.social_posts add constraint social_posts_kind_check
  check (kind in ('progress','question_set','update','study_invite'));
-- Study-day keys are the author's local calendar labels. UTC+14 is the latest
-- civil date anywhere on Earth; an ahead-of-UTC learner may already be studying
-- that day. Dates beyond this bound remain invalid on every write path.
alter table public.social_posts drop constraint social_posts_activity_day_check;
alter table public.social_posts add constraint social_posts_activity_day_check
  check (activity_day is null or activity_day between date '2020-01-01'
    and ((now() at time zone 'UTC') + interval '14 hours')::date);
alter table public.social_posts drop constraint social_posts_check;
alter table public.social_posts add constraint social_posts_shape_check check (
  (kind = 'progress' and activity_day is not null and set_title is null)
  or (kind = 'question_set' and activity_day is null and set_title is not null
    and minutes = 0 and cards = 0 and questions = 0 and share_source = 'manual')
  or (kind in ('update','study_invite') and activity_day is null and set_title is null
    and minutes = 0 and cards = 0 and questions = 0 and length(trim(caption)) > 0
    and share_source = 'manual')
);

-- Older clients used REST to automatically insert/update progress. Deny those
-- paths so they cannot bypass revoked consent or removed-day suppression. All
-- progress creation/stat changes now require the scoped version-checked RPCs.
revoke insert, update on public.social_posts from authenticated;
grant insert(user_id,kind,visibility,activity_day,minutes,cards,questions,set_title,caption)
  on public.social_posts to authenticated;
grant update(visibility,caption) on public.social_posts to authenticated;
drop policy social_posts_publish on public.social_posts;
create policy social_posts_publish on public.social_posts for insert to authenticated
with check (user_id=(select auth.uid()) and kind <> 'progress' and share_source='manual');

create or replace function public.social_post_guard() returns trigger
language plpgsql set search_path = '' as $$
begin
  if old.id is distinct from new.id or old.user_id is distinct from new.user_id
    or old.kind is distinct from new.kind or old.created_at is distinct from new.created_at
    or old.activity_day is distinct from new.activity_day then
    raise exception 'Post ownership and identity cannot change' using errcode = '42501';
  end if;
  -- A direct owner edit is an explicit manual choice, protected from later sync.
  if current_user = 'authenticated' then new.share_source := 'manual'; end if;
  new.revision := old.revision + 1;
  new.updated_at := now();
  return new;
end $$;

-- Removing any progress post is a durable choice, including manual/private days
-- and after a browser reload. The row contains no study amounts or content.
create table public.social_progress_blocks (
  user_id uuid not null references public.social_profiles(user_id) on delete cascade,
  activity_day date not null,
  created_at timestamptz not null default now(),
  primary key(user_id,activity_day)
);
alter table public.social_progress_blocks enable row level security;
revoke all on public.social_progress_blocks from public,anon,authenticated;
grant select on public.social_progress_blocks to authenticated;
grant all on public.social_progress_blocks to service_role;
create policy social_progress_blocks_own on public.social_progress_blocks for select to authenticated
using (user_id=(select auth.uid()));
create function private.keep_removed_community_day() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  if old.kind='progress'
    and exists(select 1 from public.social_profiles where user_id=old.user_id) then
    insert into public.social_progress_blocks(user_id,activity_day) values(old.user_id,old.activity_day)
    on conflict(user_id,activity_day) do nothing;
  end if;
  return old;
end $$;
revoke all on function private.keep_removed_community_day() from public,anon,authenticated;
create trigger social_post_removal_choice after delete on public.social_posts
for each row execute function private.keep_removed_community_day();

create function public.axom_community_preferences() returns jsonb
language plpgsql stable security definer set search_path = '' as $$
declare actor uuid := auth.uid(); result jsonb;
begin
  if actor is null then raise exception 'Sign in to continue' using errcode = '42501'; end if;
  select jsonb_build_object('discoverable',coalesce(p.discoverable,s.discoverable),
    'shareMode',s.share_mode,'revision',s.revision) into result
  from public.social_preferences s left join public.social_profiles p on p.user_id=s.user_id
  where s.user_id=actor;
  return coalesce(result,jsonb_build_object('discoverable',false,'shareMode','off','revision',0));
end $$;
revoke all on function public.axom_community_preferences() from public, anon;
grant execute on function public.axom_community_preferences() to authenticated;

create function public.axom_save_community_preferences(p_discoverable boolean, p_share_mode text)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare actor uuid := auth.uid();
begin
  perform private.require_account_write_access();
  if p_discoverable is null or p_share_mode is null or p_share_mode not in ('off','friends','community') then
    raise exception 'Choose valid community preferences' using errcode = '22023';
  end if;
  insert into public.social_preferences(user_id,discoverable,share_mode)
  values(actor,p_discoverable,p_share_mode)
  on conflict(user_id) do update set discoverable=excluded.discoverable,share_mode=excluded.share_mode,
    revision=social_preferences.revision+1,updated_at=now();
  update public.social_profiles set discoverable=p_discoverable,updated_at=now() where user_id=actor;
  if p_share_mode='off' then
    update public.social_posts set visibility='private',share_source='withdrawn'
    where user_id=actor and share_source='automatic';
  elsif p_share_mode='friends' then
    update public.social_posts set visibility='friends'
    where user_id=actor and share_source='automatic' and visibility='community';
  end if;
  -- Widening consent never republishes a withdrawn day or widens old friends posts.
  return public.axom_community_preferences();
end $$;
revoke all on function public.axom_save_community_preferences(boolean,text) from public, anon;
grant execute on function public.axom_save_community_preferences(boolean,text) to authenticated;

create function public.axom_create_community_profile(p_handle text,p_display_name text,p_bio text default '')
returns void language plpgsql security definer set search_path = '' as $$
declare actor uuid := auth.uid(); visible boolean;
begin
  perform private.require_account_write_access();
  if p_handle is null or p_handle !~ '^[a-z0-9][a-z0-9_]{2,29}$'
    or p_display_name is null or length(trim(p_display_name)) not between 1 and 80
    or p_bio is null or length(p_bio)>240 then
    raise exception 'Check your handle, name and bio' using errcode='22023';
  end if;
  select discoverable into visible from public.social_preferences where user_id=actor;
  insert into public.social_profiles(user_id,handle,display_name,bio,discoverable)
  values(actor,p_handle,trim(p_display_name),trim(p_bio),coalesce(visible,false));
end $$;
revoke all on function public.axom_create_community_profile(text,text,text) from public,anon;
grant execute on function public.axom_create_community_profile(text,text,text) to authenticated;

create function public.axom_leave_community() returns void
language plpgsql security definer set search_path = '' as $$
begin
  perform public.axom_save_community_preferences(false,'off');
  delete from public.social_profiles where user_id=auth.uid();
end $$;
revoke all on function public.axom_leave_community() from public, anon;
grant execute on function public.axom_leave_community() to authenticated;

-- Both preference changes and automatic writes acquire the same account lock.
-- A delayed write either lands before revocation (and is withdrawn), or sees a
-- changed consent revision and is rejected. No browser cancellation is trusted.
create function public.axom_sync_community_day(
  p_day date,p_minutes integer,p_cards integer,p_questions integer,
  p_consent_revision bigint,p_expected_revision bigint
) returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  actor uuid := auth.uid(); prefs public.social_preferences; current_post public.social_posts;
  next_visibility text;
begin
  perform private.require_account_write_access();
  select * into prefs from public.social_preferences where user_id=actor;
  if prefs.user_id is null or prefs.share_mode='off' or p_consent_revision is distinct from prefs.revision then
    raise exception 'Community sharing permission changed. Refresh your sharing settings.' using errcode = 'PT409';
  end if;
  if not exists(select 1 from public.social_profiles where user_id=actor) then
    raise exception 'Create your Community profile before sharing daily totals.' using errcode = 'PT412';
  end if;
  if p_day is null or p_day < date '2020-01-01' or p_day > ((now() at time zone 'UTC') + interval '14 hours')::date
    or p_minutes is null or p_minutes not between 0 and 1440
    or p_cards is null or p_cards not between 0 and 20000
    or p_questions is null or p_questions not between 0 and 20000 then
    raise exception 'Invalid study day or totals' using errcode = '22023';
  end if;
  if exists(select 1 from public.social_progress_blocks where user_id=actor and activity_day=p_day) then
    return jsonb_build_object('action','kept-private','revision',0);
  end if;
  select * into current_post from public.social_posts
  where user_id=actor and kind='progress' and activity_day=p_day for update;
  if current_post.id is not null and current_post.share_source <> 'automatic' then
    return jsonb_build_object('action','kept-private','revision',current_post.revision);
  end if;
  if current_post.id is null then
    if p_expected_revision is not null and p_expected_revision <> 0 then
      return jsonb_build_object('action','conflict','revision',0);
    end if;
    if p_minutes+p_cards+p_questions=0 then return jsonb_build_object('action','skipped','revision',0); end if;
    insert into public.social_posts(user_id,kind,visibility,activity_day,minutes,cards,questions,share_source)
    values(actor,'progress',prefs.share_mode,p_day,p_minutes,p_cards,p_questions,'automatic') returning * into current_post;
    return jsonb_build_object('action','inserted','revision',current_post.revision);
  end if;
  next_visibility := case when current_post.visibility='friends' or prefs.share_mode='friends'
    then 'friends' else current_post.visibility end;
  if current_post.minutes=p_minutes and current_post.cards=p_cards and current_post.questions=p_questions then
    return jsonb_build_object('action','unchanged','revision',current_post.revision);
  end if;
  if p_expected_revision is distinct from current_post.revision then
    return jsonb_build_object('action','conflict','revision',current_post.revision);
  end if;
  update public.social_posts set minutes=p_minutes,cards=p_cards,questions=p_questions,visibility=next_visibility
  where id=current_post.id returning * into current_post;
  return jsonb_build_object('action','updated','revision',current_post.revision);
end $$;
revoke all on function public.axom_sync_community_day(date,integer,integer,integer,bigint,bigint) from public, anon;
grant execute on function public.axom_sync_community_day(date,integer,integer,integer,bigint,bigint) to authenticated;

-- Explicit publishing can correct an existing day (including downward or zero
-- corrections). Compare-and-swap prevents a simultaneous edit from being lost.
create function public.axom_publish_community_day(
  p_day date,p_minutes integer,p_cards integer,p_questions integer,
  p_caption text,p_visibility text,p_expected_revision bigint
) returns void language plpgsql security definer set search_path = '' as $$
declare actor uuid := auth.uid(); current_post public.social_posts;
begin
  perform private.require_account_write_access();
  if p_day is null or p_day < date '2020-01-01' or p_day > ((now() at time zone 'UTC') + interval '14 hours')::date
    or p_minutes is null or p_minutes not between 0 and 1440
    or p_cards is null or p_cards not between 0 and 20000
    or p_questions is null or p_questions not between 0 and 20000
    or p_caption is null or length(p_caption)>500
    or p_visibility is null or p_visibility not in ('private','friends','community') then
    raise exception 'Invalid progress post' using errcode = '22023';
  end if;
  select * into current_post from public.social_posts
  where user_id=actor and kind='progress' and activity_day=p_day for update;
  if p_expected_revision is distinct from coalesce(current_post.revision,0) then
    raise exception 'This day changed on another device. Refresh before posting again.' using errcode = 'PT409';
  end if;
  delete from public.social_progress_blocks where user_id=actor and activity_day=p_day;
  if current_post.id is null then
    insert into public.social_posts(user_id,kind,visibility,activity_day,minutes,cards,questions,caption)
    values(actor,'progress',p_visibility,p_day,p_minutes,p_cards,p_questions,trim(p_caption));
  else
    update public.social_posts set minutes=p_minutes,cards=p_cards,questions=p_questions,
      caption=trim(p_caption),visibility=p_visibility,share_source='manual'
    where id=current_post.id;
  end if;
end $$;
revoke all on function public.axom_publish_community_day(date,integer,integer,integer,text,text,bigint) from public, anon;
grant execute on function public.axom_publish_community_day(date,integer,integer,integer,text,text,bigint) to authenticated;

-- A hidden learner who deliberately sends a request must be identifiable to its
-- recipient. This does not expose that learner's study posts before acceptance.
create function private.social_request_from(profile_owner uuid) returns boolean
language sql stable security definer set search_path = '' as $$
  select exists(select 1 from public.social_connections c
    where c.requester_id=profile_owner and c.addressee_id=(select auth.uid()) and c.status='pending');
$$;
revoke all on function private.social_request_from(uuid) from public, anon;
grant execute on function private.social_request_from(uuid) to authenticated;
drop policy social_profiles_view on public.social_profiles;
create policy social_profiles_view on public.social_profiles for select to authenticated
using (user_id=(select auth.uid()) or discoverable or private.social_connected_to(user_id) or private.social_request_from(user_id));

create table public.social_comments (
  id uuid primary key default gen_random_uuid(),
  post_id uuid not null references public.social_posts(id) on delete cascade,
  user_id uuid not null references public.social_profiles(user_id) on delete cascade,
  body text not null check (length(trim(body)) between 1 and 500),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index social_comments_post on public.social_comments(post_id,created_at,id);
alter table public.social_comments enable row level security;
revoke all on public.social_comments from public, anon, authenticated;
grant select,delete on public.social_comments to authenticated;
grant insert(post_id,user_id,body),update(body) on public.social_comments to authenticated;
grant all on public.social_comments to service_role;
create policy social_comments_read on public.social_comments for select to authenticated
using (exists(select 1 from public.social_posts p where p.id=post_id));
create policy social_comments_create on public.social_comments for insert to authenticated
with check (user_id=(select auth.uid()) and exists(select 1 from public.social_posts p where p.id=post_id));
create policy social_comments_edit on public.social_comments for update to authenticated
using (user_id=(select auth.uid()) and exists(select 1 from public.social_posts p where p.id=post_id))
with check (user_id=(select auth.uid()) and exists(select 1 from public.social_posts p where p.id=post_id));
create policy social_comments_remove on public.social_comments for delete to authenticated
using (user_id=(select auth.uid()) or exists(select 1 from public.social_posts p where p.id=post_id and p.user_id=(select auth.uid())));
create trigger social_comment_privacy_barrier before insert or update or delete on public.social_comments
for each row execute function private.social_write_guard();
create function public.social_comment_guard() returns trigger
language plpgsql set search_path = '' as $$
begin
  if old.id is distinct from new.id or old.user_id is distinct from new.user_id
    or old.post_id is distinct from new.post_id or old.created_at is distinct from new.created_at then
    raise exception 'Reply ownership and identity cannot change' using errcode='42501';
  end if;
  new.updated_at:=now();
  return new;
end $$;
revoke all on function public.social_comment_guard() from public, anon, authenticated;
create trigger social_comment_immutable before update on public.social_comments
for each row execute function public.social_comment_guard();

commit;
