-- AXOM operator console. Server-enforced roles; no user metadata or display-name grants.
-- A verified, immutable auth.users.id must be bootstrapped as 'owner' out of band.
-- No user, including an operator, receives access to private workspace snapshots.
begin;

create table public.axom_operator_roles (
  user_id uuid primary key references auth.users(id) on delete cascade,
  role text not null check (role in ('owner','admin','moderator')),
  granted_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create table public.axom_operator_audit (
  id uuid primary key default gen_random_uuid(),
  actor_id uuid references auth.users(id) on delete set null,
  action text not null check (length(action) between 3 and 80),
  target_id uuid,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);
create index axom_operator_audit_recent on public.axom_operator_audit(created_at desc);
create table public.axom_ai_entitlements (
  user_id uuid primary key references auth.users(id) on delete cascade,
  enabled boolean not null default true,
  daily_limit integer not null default 60 check (daily_limit between 0 and 1000),
  updated_by uuid references auth.users(id) on delete set null,
  updated_at timestamptz not null default now()
);
create table public.social_post_reports (
  post_id uuid not null references public.social_posts(id) on delete cascade,
  reporter_id uuid not null references public.social_profiles(user_id) on delete cascade,
  reason text not null check (reason in ('spam','harassment','copyright','inaccurate','other')),
  note text not null default '' check (length(note) <= 240),
  created_at timestamptz not null default now(),
  primary key(post_id, reporter_id)
);
create index social_reports_post on public.social_post_reports(post_id);

alter table public.axom_operator_roles enable row level security;
alter table public.axom_operator_audit enable row level security;
alter table public.axom_ai_entitlements enable row level security;
alter table public.social_post_reports enable row level security;
revoke all on public.axom_operator_roles, public.axom_operator_audit,
  public.axom_ai_entitlements, public.social_post_reports from public,anon,authenticated;
grant select on public.axom_operator_roles, public.axom_operator_audit, public.axom_ai_entitlements to authenticated;
grant select,insert,delete on public.social_post_reports to authenticated;
grant all on public.axom_operator_roles, public.axom_operator_audit,public.axom_ai_entitlements,public.social_post_reports to service_role;

create trigger social_report_privacy_barrier before insert or update or delete on public.social_post_reports
for each row execute function private.social_write_guard();

create function public.axom_operator_role() returns text
language sql stable security definer set search_path = '' as $$
  select role from public.axom_operator_roles where user_id = (select auth.uid());
$$;
revoke all on function public.axom_operator_role() from public,anon,authenticated;
grant execute on function public.axom_operator_role() to authenticated;

create policy axom_operator_role_self on public.axom_operator_roles for select to authenticated
using (user_id = (select auth.uid()) or public.axom_operator_role() = 'owner');
create policy axom_operator_audit_owner on public.axom_operator_audit for select to authenticated
using (public.axom_operator_role() = 'owner');
create policy axom_ai_entitlements_read on public.axom_ai_entitlements for select to authenticated
using (user_id = (select auth.uid()) or public.axom_operator_role() = 'owner');
create policy social_reports_own on public.social_post_reports for select to authenticated
using (reporter_id = (select auth.uid()));
create policy social_reports_create on public.social_post_reports for insert to authenticated
with check (reporter_id = (select auth.uid())
  and exists (select 1 from public.social_posts p where p.id = post_id));
create policy social_reports_retract on public.social_post_reports for delete to authenticated
using (reporter_id = (select auth.uid()));

-- Server authoritative quota overrides. Default remains 60; users cannot set
-- their own limit or send a client-selected allowance.
create or replace function public.consume_ai_quota()
returns integer language plpgsql security definer set search_path = '' as $$
declare
  v_user uuid := auth.uid();
  v_limit integer := 60;
  v_enabled boolean := true;
  v_used integer;
begin
  if v_user is null then raise exception 'not authenticated' using errcode = '28000'; end if;
  perform private.require_account_write_access();
  select e.daily_limit, e.enabled into v_limit, v_enabled
    from public.axom_ai_entitlements e where e.user_id = v_user;
  if not found then v_limit := 60; v_enabled := true; end if;
  if not v_enabled or v_limit < 1 then return -1; end if;
  insert into public.ai_usage as u (user_id,day,requests)
  values (v_user,(now() at time zone 'utc')::date,1)
  on conflict (user_id,day) do update set requests = u.requests + 1
    where u.requests < v_limit
  returning requests into v_used;
  if v_used is null then return -1; end if;
  return v_limit - v_used;
end $$;
revoke all on function public.consume_ai_quota() from public,anon,authenticated;
grant execute on function public.consume_ai_quota() to authenticated;

create function public.axom_operator_overview() returns jsonb
language plpgsql stable security definer set search_path = '' as $$
declare
  v_role text := public.axom_operator_role();
begin
  if v_role is null then raise exception 'Operator access required' using errcode = '42501'; end if;
  return jsonb_build_object(
    'role',v_role,
    'registered_accounts',case when v_role in ('owner','admin') then (select count(*) from auth.users) else null end,
    'shared_profiles',(select count(*) from public.social_profiles where discoverable),
    'shared_posts',(select count(*) from public.social_posts),
    'reports_pending',(select count(*) from public.social_post_reports),
    'academic_review_pending',(select count(*) from public.academic_collections
      where visibility <> 'private' and review_status = 'pending' and not withdrawn and current_revision_id is not null),
    'academic_approved',(select count(*) from public.academic_collections
      where visibility <> 'private' and review_status = 'approved' and not withdrawn),
    'ai_requests_7d',case when v_role in ('owner','admin') then
      (select coalesce(sum(requests),0) from public.ai_usage where day >= (now() at time zone 'utc')::date - 6)
      else null end
  );
end $$;
revoke all on function public.axom_operator_overview() from public,anon,authenticated;
grant execute on function public.axom_operator_overview() to authenticated;

create function public.axom_operator_accounts(query_text text default '')
returns table (user_id uuid, email text, display_name text, role text, created_at timestamptz,
  last_sign_in_at timestamptz, ai_enabled boolean, ai_daily_limit integer, ai_used_today integer)
language plpgsql stable security definer set search_path = '' as $$
begin
  if coalesce(public.axom_operator_role(),'none') not in ('owner','admin') then
    raise exception 'Account management access required' using errcode = '42501';
  end if;
  if length(query_text) > 100 then raise exception 'Search is too long'; end if;
  return query
    select u.id,u.email,p.display_name,r.role,u.created_at,u.last_sign_in_at,
      coalesce(e.enabled,true),coalesce(e.daily_limit,60),
      coalesce(a.requests,0)
    from auth.users u
    left join public.account_profiles p on p.user_id = u.id
    left join public.axom_operator_roles r on r.user_id = u.id
    left join public.axom_ai_entitlements e on e.user_id = u.id
    left join public.ai_usage a on a.user_id = u.id and a.day = (now() at time zone 'utc')::date
    where coalesce(query_text,'') = ''
      or u.email ilike '%' || query_text || '%'
      or p.display_name ilike '%' || query_text || '%'
    order by u.created_at desc limit 100;
end $$;
revoke all on function public.axom_operator_accounts(text) from public,anon,authenticated;
grant execute on function public.axom_operator_accounts(text) to authenticated;

create function public.axom_operator_review_queue()
returns table(collection_id uuid, title text, module text, term text, owner_id uuid, visibility text,
  ready_questions integer, review_questions integer, updated_at timestamptz)
language plpgsql stable security definer set search_path = '' as $$
begin
  if public.axom_operator_role() is null then
    raise exception 'Operator access required' using errcode = '42501';
  end if;
  return query
    select c.id,c.title,c.module,c.term,c.owner_id,c.visibility,
      r.ready_questions,r.review_questions,c.updated_at
    from public.academic_collections c
    join public.academic_revisions r on r.id=c.current_revision_id
    where c.visibility <> 'private' and c.review_status='pending' and not c.withdrawn
    order by c.updated_at desc limit 100;
end $$;
revoke all on function public.axom_operator_review_queue() from public,anon,authenticated;
grant execute on function public.axom_operator_review_queue() to authenticated;

create function public.axom_operator_reports()
returns table(post_id uuid, author_handle text, post_kind text, reason text, note text, reports bigint, latest_at timestamptz)
language plpgsql stable security definer set search_path = '' as $$
begin
  if public.axom_operator_role() is null then
    raise exception 'Operator access required' using errcode='42501';
  end if;
  return query
    select p.id,pr.handle,p.kind,min(r.reason),left(string_agg(r.note,'; '),240),
      count(*),max(r.created_at)
    from public.social_post_reports r
    join public.social_posts p on p.id = r.post_id
    join public.social_profiles pr on pr.user_id = p.user_id
    group by p.id,pr.handle,p.kind
    order by max(r.created_at) desc limit 100;
end $$;
revoke all on function public.axom_operator_reports() from public,anon,authenticated;
grant execute on function public.axom_operator_reports() to authenticated;

create function public.axom_operator_set_role(target uuid, wanted text, reason text)
returns void language plpgsql security definer set search_path = '' as $$
declare actor uuid := auth.uid();
begin
  if public.axom_operator_role() is distinct from 'owner' then
    raise exception 'Only the verified owner may assign roles' using errcode='42501';
  end if;
  perform private.require_account_write_access();
  if reason is null or length(trim(reason)) not between 8 and 500 then raise exception 'Give a reason of 8 to 500 characters' using errcode='22023'; end if;
  if target is null or target = actor or wanted is null or wanted not in ('admin','moderator','member')
    or not exists (select 1 from auth.users where id=target)
    or exists (select 1 from public.axom_operator_roles where user_id=target and role='owner') then
    raise exception 'Invalid role change' using errcode='42501';
  end if;
  if wanted = 'member' then delete from public.axom_operator_roles where user_id=target;
  else
    insert into public.axom_operator_roles(user_id,role,granted_by)
    values(target,wanted,actor)
    on conflict(user_id) do update set role=excluded.role,granted_by=actor,updated_at=now();
  end if;
  insert into public.axom_operator_audit(actor_id,action,target_id,metadata)
    values(actor,'account.role',target,jsonb_build_object('assigned',wanted,'reason',trim(reason)));
end $$;
revoke all on function public.axom_operator_set_role(uuid,text,text) from public,anon,authenticated;
grant execute on function public.axom_operator_set_role(uuid,text,text) to authenticated;

create function public.axom_operator_set_ai(target uuid, permitted boolean, requested_limit integer, reason text)
returns void language plpgsql security definer set search_path = '' as $$
declare actor uuid := auth.uid();
begin
  if public.axom_operator_role() is distinct from 'owner' then
    raise exception 'Only the verified owner may manage AI limits' using errcode='42501';
  end if;
  perform private.require_account_write_access();
  if reason is null or length(trim(reason)) not between 8 and 500 then raise exception 'Give a reason of 8 to 500 characters' using errcode='22023'; end if;
  if target is null or permitted is null or requested_limit is null or requested_limit not between 0 and 1000
    or not exists (select 1 from auth.users where id = target) then
    raise exception 'Invalid AI policy' using errcode='22023';
  end if;
  insert into public.axom_ai_entitlements(user_id,enabled,daily_limit,updated_by)
    values(target,permitted,requested_limit,actor)
  on conflict(user_id) do update set enabled=excluded.enabled,daily_limit=excluded.daily_limit,
    updated_by=actor,updated_at=now();
  insert into public.axom_operator_audit(actor_id,action,target_id,metadata)
    values(actor,'ai.policy',target,jsonb_build_object('enabled',permitted,'daily_limit',requested_limit,'reason',trim(reason)));
end $$;
revoke all on function public.axom_operator_set_ai(uuid,boolean,integer,text) from public,anon,authenticated;
grant execute on function public.axom_operator_set_ai(uuid,boolean,integer,text) to authenticated;

create function public.axom_operator_resolve_report(target uuid, resolution text)
returns void language plpgsql security definer set search_path = '' as $$
declare actor uuid := auth.uid(); affected integer;
begin
  if public.axom_operator_role() is null then
    raise exception 'Operator access required' using errcode='42501';
  end if;
  perform private.require_account_write_access();
  if resolution is null or resolution not in ('dismiss','remove') then raise exception 'Invalid resolution'; end if;
  if not exists (select 1 from public.social_post_reports where post_id=target) then
    raise exception 'Report no longer exists';
  end if;
  if resolution='remove' then
    delete from public.social_posts where id=target;
    get diagnostics affected = row_count;
  else
    delete from public.social_post_reports where post_id=target;
    get diagnostics affected = row_count;
  end if;
  if affected < 1 then raise exception 'No report changed'; end if;
  insert into public.axom_operator_audit(actor_id,action,target_id,metadata)
    values(actor,'social.report.' || resolution,target,jsonb_build_object('affected',affected));
end $$;
revoke all on function public.axom_operator_resolve_report(uuid,text) from public,anon,authenticated;
grant execute on function public.axom_operator_resolve_report(uuid,text) to authenticated;

commit;