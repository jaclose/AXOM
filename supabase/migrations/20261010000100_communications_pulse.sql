-- Additive communications state. Workspace schema 34 and auth flows are unchanged.
create table public.communication_preferences (
 user_id uuid not null references auth.users(id) on delete cascade,
 category text not null check(category in ('daily_learning','daily_games','weekly_report','monthly_report','exam_reminders','annual_pulse','essays_from_jafar','product_updates','research_news','marketing')),
 enabled boolean not null default false, time text not null default '08:00' check(time ~ '^([01][0-9]|2[0-3]):[0-5][0-9]$'),
 weekday smallint not null default 0 check(weekday between 0 and 6), timezone text not null default 'UTC',
 consent_at timestamptz, updated_at timestamptz not null default now(), primary key(user_id,category)
);
-- Email presentation mirrors the existing device accent; it is not an app theme store.
create table public.communication_identity (
 user_id uuid primary key references auth.users(id) on delete cascade,
 accent text not null default '#c8a96a' check(accent ~ '^#[0-9a-fA-F]{6}$'), theme text not null default 'dark' check(theme in ('dark','light')),
 locale text not null default 'en', contact_id text unique, topics_dirty boolean not null default true, topics_error text, updated_at timestamptz not null default now()
);
create table public.pulse_snapshots (
 id uuid primary key default gen_random_uuid(), user_id uuid not null references auth.users(id) on delete cascade,
 period_key text not null, scope text not null, source_hash text, payload jsonb not null, created_at timestamptz not null default now(), unique(user_id,period_key,scope)
);
create table public.email_campaigns (
 id uuid primary key default gen_random_uuid(), created_by uuid references auth.users(id) on delete set null,
 type text not null check(type in ('essay','product_update','research','marketing')), content jsonb not null,
 audience jsonb not null default '{"kind":"subscribers"}', status text not null default 'draft' check(status in ('draft','scheduled','queued','completed','cancelled')),
 scheduled_for timestamptz, recipient_count integer not null default 0, cursor uuid, created_at timestamptz not null default now()
);
create table public.axom_articles (
 id uuid primary key default gen_random_uuid(), campaign_id uuid unique references public.email_campaigns(id) on delete set null,
 title text not null, excerpt text not null, body text not null, reading_minutes integer, published_at timestamptz
);
create table public.email_jobs (
 id uuid primary key default gen_random_uuid(), user_id uuid references auth.users(id) on delete cascade,
 type text not null, category text not null, idempotency_key text not null unique,
 variables jsonb not null default '{}', snapshot_id uuid references public.pulse_snapshots(id) on delete set null,
 campaign_id uuid references public.email_campaigns(id) on delete set null,
 status text not null default 'queued' check(status in ('queued','scheduled','processing','sent','delivered','suppressed','failed','bounced','complained','cancelled')),
 scheduled_for timestamptz not null default now(), locked_at timestamptz, attempts integer not null default 0,
 delivery_payload jsonb, first_attempt_at timestamptz, provider_id text unique, failure_code text, sent_at timestamptz, created_at timestamptz not null default now()
);
create index email_jobs_due on public.email_jobs(status,scheduled_for);
create table public.email_send_log (
 id uuid primary key default gen_random_uuid(), job_id uuid not null references public.email_jobs(id) on delete cascade,
 attempt integer not null, outcome text not null, provider_id text, created_at timestamptz not null default now(), unique(job_id,attempt)
);
create table public.email_events (
 provider_event_id text primary key, provider_id text, type text not null, event_at timestamptz not null,
 payload jsonb not null, processed_at timestamptz, created_at timestamptz not null default now()
);
-- Address-bound suppression also protects an address after account deletion/recreation.
create table public.email_suppressions (
 email text primary key check(email=lower(email)), reason text not null, created_at timestamptz not null default now()
);
create table public.communication_tokens (
 token_hash text primary key, user_id uuid not null references auth.users(id) on delete cascade,
 category text not null, expires_at timestamptz not null, created_at timestamptz not null default now()
);
create table public.privacy_requests (
 id uuid primary key default gen_random_uuid(), user_id uuid references auth.users(id) on delete set null,
 kind text not null check(kind in ('export','deletion')), status text not null default 'requested' check(status in ('requested','processing','ready','scheduled','cancelled','completed','failed')),
 processing_at timestamptz, scheduled_for timestamptz, object_path text, expires_at timestamptz, failure_code text,
 completion_payload jsonb, completion_attempt_at timestamptz, completion_attempts integer not null default 0, completion_retry_at timestamptz not null default now(), notification_email text, completed_email_sent boolean not null default false, created_at timestamptz not null default now()
);
create unique index privacy_one_active on public.privacy_requests(user_id,kind) where status in ('requested','processing','scheduled');
create table public.communication_rate_limits (key text primary key, window_start timestamptz not null, count integer not null);
create table public.communication_worker_state (id integer primary key check(id=1), lease uuid, expires_at timestamptz not null default now(), schedule_offset integer not null default 0);
insert into public.communication_worker_state(id) values(1);

do $$ declare name text; begin
 foreach name in array array['communication_preferences','communication_identity','pulse_snapshots','email_campaigns','axom_articles','email_jobs','email_send_log','email_events','email_suppressions','communication_tokens','privacy_requests','communication_rate_limits','communication_worker_state'] loop
  execute format('alter table public.%I enable row level security',name);
  execute format('revoke all on public.%I from anon, authenticated',name);
  execute format('grant all on public.%I to service_role',name);
 end loop;
end $$;
grant select on public.communication_preferences,public.communication_identity,public.pulse_snapshots,public.email_jobs,public.privacy_requests to authenticated;
create policy "communication preferences owner" on public.communication_preferences for select to authenticated using((select auth.uid())=user_id);
create policy "communication identity owner" on public.communication_identity for select to authenticated using((select auth.uid())=user_id);
create policy "pulse owner" on public.pulse_snapshots for select to authenticated using((select auth.uid())=user_id);
create policy "email history owner" on public.email_jobs for select to authenticated using((select auth.uid())=user_id);
create policy "privacy requests owner" on public.privacy_requests for select to authenticated using((select auth.uid())=user_id);
-- Published article reads are public; drafts and all writes remain service-only.
grant select on public.axom_articles to anon,authenticated;
create policy "published articles" on public.axom_articles for select to anon,authenticated using(published_at is not null and published_at<=now());

create function public.claim_axom_email_jobs(p_limit integer default 20) returns setof public.email_jobs
language plpgsql security invoker set search_path=public as $$
begin
 update email_jobs set status='failed',failure_code='delivery-reconciliation-required'
 where status='processing' and attempts>=5 and locked_at<now()-interval '10 minutes';
 return query update email_jobs set status='processing',locked_at=now(),attempts=attempts+1
 where id in (select id from email_jobs where scheduled_for<=now() and attempts<5 and
  (status in ('queued','scheduled') or (status='processing' and locked_at<now()-interval '10 minutes'))
  order by scheduled_for for update skip locked limit least(greatest(p_limit,1),50)) returning *;
end $$;
revoke all on function public.claim_axom_email_jobs(integer) from public,anon,authenticated;
grant execute on function public.claim_axom_email_jobs(integer) to service_role;

create function public.consume_communication_limit(p_key text,p_limit integer,p_seconds integer) returns boolean
language plpgsql security invoker set search_path=public as $$
declare n integer; begin
 insert into communication_rate_limits values(p_key,now(),1) on conflict(key) do update
 set count=case when communication_rate_limits.window_start<now()-make_interval(secs=>p_seconds) then 1 else communication_rate_limits.count+1 end,
 window_start=case when communication_rate_limits.window_start<now()-make_interval(secs=>p_seconds) then now() else communication_rate_limits.window_start end returning count into n;
 return n<=p_limit;
end $$;
revoke all on function public.consume_communication_limit(text,integer,integer) from public,anon,authenticated;
grant execute on function public.consume_communication_limit(text,integer,integer) to service_role;

create function public.acquire_communication_worker() returns uuid language sql security invoker set search_path=public as $$
 update communication_worker_state set lease=gen_random_uuid(),expires_at=now()+interval '10 minutes' where id=1 and expires_at<now() returning lease
$$;
revoke all on function public.acquire_communication_worker() from public,anon,authenticated;
grant execute on function public.acquire_communication_worker() to service_role;

create function public.queue_axom_welcome() returns trigger language plpgsql security definer set search_path=pg_catalog, public, pg_temp as $$
begin
 insert into email_jobs(user_id,type,category,idempotency_key) values(new.user_id,'welcome','account',new.user_id::text||':welcome') on conflict(idempotency_key) do nothing;
 return new;
end $$;
revoke all on function public.queue_axom_welcome() from public,anon,authenticated;
create trigger axom_account_welcome after insert on public.account_profiles for each row execute function public.queue_axom_welcome();

-- Private bucket only. No anonymous/object listing policy or predictable public download.
do $$ begin
 if to_regclass('storage.buckets') is not null then
  insert into storage.buckets(id,name,public,file_size_limit,allowed_mime_types)
  values('communications-exports','communications-exports',false,25000000,array['application/json']) on conflict(id) do nothing;
  if exists(select 1 from storage.buckets where id='communications-exports' and public) then
   raise exception 'communications-exports must be a private bucket';
  end if;
 end if;
 if to_regclass('storage.objects') is not null then
  execute $policy$create policy "private communications exports" on storage.objects as restrictive for all to anon,authenticated using(bucket_id <> 'communications-exports') with check(bucket_id <> 'communications-exports')$policy$;
 end if;
end $$;

-- Atomically publish the canonical article and schedule its delivery.
create function public.schedule_axom_campaign(p_id uuid, p_at timestamptz) returns boolean
language plpgsql security invoker set search_path=public as $$
begin
 if p_at < now() + interval '1 minute' then return false; end if;
 update public.email_campaigns set status='scheduled', scheduled_for=p_at where id=p_id and status='draft';
 if not found then return false; end if;
 update public.axom_articles set published_at=p_at where campaign_id=p_id;
 return true;
end $$;
revoke all on function public.schedule_axom_campaign(uuid,timestamptz) from public, anon, authenticated;
grant execute on function public.schedule_axom_campaign(uuid,timestamptz) to service_role;
