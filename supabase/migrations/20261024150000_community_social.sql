-- AXOM Community v1. Only intentionally published social data belongs here.
-- Local workspaces, academic originals and question payloads are never copied.
begin;

create table public.social_profiles (
  user_id uuid primary key references auth.users(id) on delete cascade,
  handle text not null unique check (handle ~ '^[a-z0-9][a-z0-9_]{2,29}$'),
  display_name text not null check (length(trim(display_name)) between 1 and 80),
  bio text not null default '' check (length(bio) <= 240),
  discoverable boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table public.social_connections (
  id uuid primary key default gen_random_uuid(),
  requester_id uuid not null references public.social_profiles(user_id) on delete cascade,
  addressee_id uuid not null references public.social_profiles(user_id) on delete cascade,
  status text not null default 'pending' check (status in ('pending','accepted')),
  created_at timestamptz not null default now(),
  accepted_at timestamptz,
  check (requester_id <> addressee_id),
  unique (requester_id, addressee_id),
  check ((status = 'accepted') = (accepted_at is not null))
);
-- A reverse request cannot create a second relationship.
create unique index social_connection_pair
  on public.social_connections (least(requester_id,addressee_id),greatest(requester_id,addressee_id));

create table public.social_posts (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.social_profiles(user_id) on delete cascade,
  kind text not null check (kind in ('progress','question_set')),
  visibility text not null default 'friends' check (visibility in ('friends','community')),
  activity_day date,
  minutes integer not null default 0 check (minutes between 0 and 1440),
  cards integer not null default 0 check (cards between 0 and 20000),
  questions integer not null default 0 check (questions between 0 and 20000),
  set_title text check (set_title is null or length(trim(set_title)) between 1 and 160),
  caption text not null default '' check (length(caption) <= 500),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check (
    (kind = 'progress' and activity_day is not null and set_title is null)
    or (kind = 'question_set' and activity_day is null and set_title is not null
        and minutes = 0 and cards = 0 and questions = 0)
  ),
  check (activity_day is null or activity_day between date '2020-01-01' and (now() at time zone 'UTC')::date)
);
-- Each learner has one optional daily progress summary, not a continuous telemetry feed.
create unique index social_one_progress_post_per_day on public.social_posts(user_id,activity_day) where kind = 'progress';
create index social_posts_recent on public.social_posts(created_at desc, id);
create index social_posts_owner on public.social_posts(user_id, created_at desc);

create table public.social_reactions (
  post_id uuid not null references public.social_posts(id) on delete cascade,
  user_id uuid not null references public.social_profiles(user_id) on delete cascade,
  created_at timestamptz not null default now(),
  primary key (post_id,user_id)
);

alter table public.social_profiles enable row level security;
alter table public.social_connections enable row level security;
alter table public.social_posts enable row level security;
alter table public.social_reactions enable row level security;
revoke all on public.social_profiles,public.social_connections,public.social_posts,public.social_reactions from public,anon,authenticated;
grant select,insert,update,delete on public.social_profiles,public.social_connections,public.social_posts to authenticated;
grant select,insert,delete on public.social_reactions to authenticated;

-- Profile visibility and friend-request policies otherwise form an RLS cycle:
-- profiles -> connections -> profiles. Both helpers are private, tightly
-- scoped to auth.uid(), and execute with the migration owner's privileges.
-- Never expose the private schema through Supabase Data API.
create schema if not exists private;
revoke all on schema private from public;
grant usage on schema private to authenticated;

create function private.social_connected_to(profile_owner uuid)
returns boolean language sql stable security definer set search_path = '' as $
  select (select auth.uid()) is not null
    and exists (
      select 1 from public.social_connections f
      where f.status = 'accepted' and (
        (f.requester_id = profile_owner and f.addressee_id = (select auth.uid()))
        or (f.addressee_id = profile_owner and f.requester_id = (select auth.uid()))
      )
    );
$;
revoke all on function private.social_connected_to(uuid) from public, anon, authenticated;
grant execute on function private.social_connected_to(uuid) to authenticated;

create function private.social_is_discoverable(other_user uuid)
returns boolean language sql stable security definer set search_path = '' as $
  select exists (
    select 1 from public.social_profiles p
    where p.user_id = other_user and p.discoverable
  );
$;
revoke all on function private.social_is_discoverable(uuid) from public, anon, authenticated;
grant execute on function private.social_is_discoverable(uuid) to authenticated;

create policy social_profiles_view on public.social_profiles for select to authenticated
using (user_id = (select auth.uid()) or discoverable or private.social_connected_to(user_id));
create policy social_profiles_create on public.social_profiles for insert to authenticated
with check (user_id = (select auth.uid()));
create policy social_profiles_edit on public.social_profiles for update to authenticated
using (user_id = (select auth.uid())) with check (user_id = (select auth.uid()));
create policy social_profiles_leave on public.social_profiles for delete to authenticated
using (user_id = (select auth.uid()));

create policy social_connection_parties on public.social_connections for select to authenticated
using (requester_id = (select auth.uid()) or addressee_id = (select auth.uid()));
create policy social_connection_request on public.social_connections for insert to authenticated
with check (requester_id = (select auth.uid()) and status = 'pending' and accepted_at is null
  and private.social_is_discoverable(addressee_id));
create policy social_connection_accept on public.social_connections for update to authenticated
using (addressee_id = (select auth.uid()) and status = 'pending')
with check (addressee_id = (select auth.uid()) and status = 'accepted' and accepted_at is not null);
create policy social_connection_remove on public.social_connections for delete to authenticated
using (requester_id = (select auth.uid()) or addressee_id = (select auth.uid()));

create policy social_posts_view on public.social_posts for select to authenticated
using (user_id = (select auth.uid())
  or (visibility = 'community' and exists (
    select 1 from public.social_profiles p where p.user_id = social_posts.user_id and p.discoverable))
  or (exists (select 1 from public.social_connections f where f.status = 'accepted'
    and ((f.requester_id = social_posts.user_id and f.addressee_id = (select auth.uid()))
      or (f.addressee_id = social_posts.user_id and f.requester_id = (select auth.uid()))))));
create policy social_posts_publish on public.social_posts for insert to authenticated
with check (user_id = (select auth.uid()));
create policy social_posts_edit on public.social_posts for update to authenticated
using (user_id = (select auth.uid())) with check (user_id = (select auth.uid()));
create policy social_posts_remove on public.social_posts for delete to authenticated
using (user_id = (select auth.uid()));

create policy social_reactions_view on public.social_reactions for select to authenticated
using (exists (select 1 from public.social_posts p where p.id = post_id));
create policy social_reactions_create on public.social_reactions for insert to authenticated
with check (user_id = (select auth.uid())
  and exists (select 1 from public.social_posts p where p.id = post_id));
create policy social_reactions_remove on public.social_reactions for delete to authenticated
using (user_id = (select auth.uid()));

-- INSERT/UPDATE policies alone are not enough to prevent protected-field reassignment.
create function public.social_connection_guard() returns trigger
language plpgsql set search_path = '' as $$
begin
  if old.requester_id is distinct from new.requester_id
    or old.addressee_id is distinct from new.addressee_id
    or old.id is distinct from new.id or old.created_at is distinct from new.created_at
    or old.status <> 'pending' or new.status <> 'accepted'
    or (select auth.uid()) is distinct from old.addressee_id then
    raise exception 'Only the recipient may accept an unchanged request' using errcode = '42501';
  end if;
  new.accepted_at = now();
  return new;
end $$;
revoke all on function public.social_connection_guard() from public,anon,authenticated;
create trigger social_connection_immutable before update on public.social_connections
for each row execute function public.social_connection_guard();

create function public.social_post_guard() returns trigger
language plpgsql set search_path = '' as $$
begin
  if old.id is distinct from new.id or old.user_id is distinct from new.user_id
    or old.kind is distinct from new.kind or old.created_at is distinct from new.created_at then
    raise exception 'Post ownership and identity cannot change' using errcode = '42501';
  end if;
  new.updated_at = now();
  return new;
end $$;
revoke all on function public.social_post_guard() from public,anon,authenticated;
create trigger social_post_immutable before update on public.social_posts
for each row execute function public.social_post_guard();

commit;