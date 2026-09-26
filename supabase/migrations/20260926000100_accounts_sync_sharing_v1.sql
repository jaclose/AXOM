-- AXOM Accounts, versioned workspace protection, and private Question Set shares.
-- Apply through Supabase migrations. All private rows are protected by RLS.
create extension if not exists pgcrypto;

create table if not exists public.account_profiles (
  user_id uuid primary key references auth.users(id) on delete cascade,
  display_name text not null check (char_length(display_name) between 1 and 80),
  created_at timestamptz not null default now(), updated_at timestamptz not null default now()
);
create table if not exists public.workspaces (
  id uuid primary key default gen_random_uuid(), user_id uuid not null references auth.users(id) on delete cascade,
  current_revision bigint not null default 0, current_hash text, created_at timestamptz not null default now(), updated_at timestamptz not null default now(),
  unique(user_id)
);
create table if not exists public.workspace_revisions (
  id uuid primary key default gen_random_uuid(), workspace_id uuid not null references public.workspaces(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade, revision bigint not null,
  base_revision bigint not null, schema_version integer not null, content_hash text not null,
  snapshot_payload jsonb not null, device_id uuid not null, idempotency_key uuid not null,
  reason text not null default 'automatic' check(reason in ('foundation','automatic','manual','pre_restore','restore','conflict')),
  created_at timestamptz not null default now(), unique(user_id,idempotency_key)
);
create index if not exists workspace_revisions_history on public.workspace_revisions(workspace_id,revision desc);
create unique index if not exists workspace_revisions_canonical on public.workspace_revisions(workspace_id,revision) where reason<>'conflict';
create table if not exists public.sync_conflicts (
  id uuid primary key default gen_random_uuid(), workspace_id uuid not null references public.workspaces(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade, attempted_base_revision bigint not null,
  server_revision bigint not null, preserved_revision_id uuid references public.workspace_revisions(id), resolved_at timestamptz,
  created_at timestamptz not null default now()
);
create table if not exists public.question_set_shares (
  id uuid primary key default gen_random_uuid(), owner_user_id uuid not null references auth.users(id) on delete cascade,
  source_question_set_id text not null, share_token text not null unique default encode(gen_random_bytes(24),'hex'),
  share_format_version integer not null default 1, title text not null, question_count integer not null check(question_count>=0),
  snapshot_payload jsonb not null, created_at timestamptz not null default now(), revoked_at timestamptz, expires_at timestamptz
);
create index if not exists question_set_shares_owner on public.question_set_shares(owner_user_id,created_at desc);

alter table public.account_profiles enable row level security; alter table public.workspaces enable row level security;
alter table public.workspace_revisions enable row level security; alter table public.sync_conflicts enable row level security;
alter table public.question_set_shares enable row level security;
create policy "profiles own rows" on public.account_profiles for all using(auth.uid()=user_id) with check(auth.uid()=user_id);
create policy "workspaces own rows" on public.workspaces for all using(auth.uid()=user_id) with check(auth.uid()=user_id);
create policy "revisions own rows" on public.workspace_revisions for select using(auth.uid()=user_id);
create policy "conflicts own rows" on public.sync_conflicts for select using(auth.uid()=user_id);
create policy "share owners read" on public.question_set_shares for select using(auth.uid()=owner_user_id);
create policy "share owners revoke" on public.question_set_shares for update using(auth.uid()=owner_user_id) with check(auth.uid()=owner_user_id);
create policy "share owners delete" on public.question_set_shares for delete using(auth.uid()=owner_user_id);

create or replace function public.push_workspace_revision(
  p_base_revision bigint,p_schema_version integer,p_content_hash text,p_snapshot_payload jsonb,p_device_id uuid,p_idempotency_key uuid,p_reason text default 'automatic'
) returns jsonb language plpgsql security definer set search_path=public as $$
declare w public.workspaces; r public.workspace_revisions;
begin
  if auth.uid() is null then raise exception 'authentication required' using errcode='42501'; end if;
  if p_schema_version<1 or p_schema_version>10000 or p_content_hash !~ '^[0-9a-f]{64}$' then raise exception 'invalid snapshot metadata'; end if;
  if octet_length(p_snapshot_payload::text)>15000000 then raise exception 'snapshot payload too large'; end if;
  if p_reason not in ('foundation','automatic','manual','pre_restore','restore') then raise exception 'invalid revision reason'; end if;
  insert into workspaces(user_id) values(auth.uid()) on conflict(user_id) do nothing;
  select * into w from workspaces where user_id=auth.uid() for update;
  select * into r from workspace_revisions where user_id=auth.uid() and idempotency_key=p_idempotency_key;
  if found then return jsonb_build_object('status','accepted','revision',r.revision,'revision_id',r.id,'idempotent',true); end if;
  if w.current_revision<>p_base_revision then
    insert into workspace_revisions(workspace_id,user_id,revision,base_revision,schema_version,content_hash,snapshot_payload,device_id,idempotency_key,reason)
      values(w.id,auth.uid(),p_base_revision,p_base_revision,p_schema_version,p_content_hash,p_snapshot_payload,p_device_id,p_idempotency_key,'conflict') returning * into r;
    insert into sync_conflicts(workspace_id,user_id,attempted_base_revision,server_revision,preserved_revision_id) values(w.id,auth.uid(),p_base_revision,w.current_revision,r.id);
    return jsonb_build_object('status','conflict','server_revision',w.current_revision,'preserved_revision_id',r.id);
  end if;
  insert into workspace_revisions(workspace_id,user_id,revision,base_revision,schema_version,content_hash,snapshot_payload,device_id,idempotency_key,reason)
    values(w.id,auth.uid(),w.current_revision+1,p_base_revision,p_schema_version,p_content_hash,p_snapshot_payload,p_device_id,p_idempotency_key,p_reason) returning * into r;
  update workspaces set current_revision=r.revision,current_hash=p_content_hash,updated_at=now() where id=w.id;
  delete from workspace_revisions where id in (select id from workspace_revisions where workspace_id=w.id and reason<>'conflict' order by revision desc offset 60);
  return jsonb_build_object('status','accepted','revision',r.revision,'revision_id',r.id,'idempotent',false);
end $$;
revoke all on function public.push_workspace_revision(bigint,integer,text,jsonb,uuid,uuid,text) from public;
grant execute on function public.push_workspace_revision(bigint,integer,text,jsonb,uuid,uuid,text) to authenticated;

create or replace function public.resolve_question_set_share(p_token text) returns table(id uuid,title text,question_count integer,share_format_version integer,snapshot_payload jsonb)
language sql security definer set search_path=public as $$ select id,title,question_count,share_format_version,snapshot_payload from question_set_shares where share_token=p_token and revoked_at is null and (expires_at is null or expires_at>now()) limit 1 $$;
grant execute on function public.resolve_question_set_share(text) to anon,authenticated;

create or replace function public.handle_new_account() returns trigger language plpgsql security definer set search_path=public as $$
begin insert into account_profiles(user_id,display_name) values(new.id,left(coalesce(new.raw_user_meta_data->>'display_name',split_part(new.email,'@',1),'Learner'),80)) on conflict(user_id) do nothing; return new; end $$;
drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created after insert on auth.users for each row execute function public.handle_new_account();

create or replace function public.create_question_set_share(p_source_id text,p_snapshot jsonb) returns jsonb
language plpgsql security definer set search_path=public as $$
declare row question_set_shares;
begin
 if auth.uid() is null then raise exception 'authentication required' using errcode='42501'; end if;
 if octet_length(p_snapshot::text)>5000000 then raise exception 'share payload too large'; end if;
 if (p_snapshot->>'shareFormatVersion')::integer<>1 or jsonb_typeof(p_snapshot->'questions')<>'array' then raise exception 'invalid share format'; end if;
 insert into question_set_shares(owner_user_id,source_question_set_id,title,question_count,share_format_version,snapshot_payload)
 values(auth.uid(),left(p_source_id,200),left(p_snapshot->>'title',200),jsonb_array_length(p_snapshot->'questions'),1,p_snapshot) returning * into row;
 return jsonb_build_object('id',row.id,'share_token',row.share_token);
end $$;
revoke all on function public.create_question_set_share(text,jsonb) from public;
grant execute on function public.create_question_set_share(text,jsonb) to authenticated;
