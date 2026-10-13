-- Only the reviewed publishing adapter can define a daily comparison pool.
-- Answer keys and individual answers never have client table grants.
create table public.academic_challenges (
  id uuid primary key default gen_random_uuid(),
  collection_id uuid not null references public.academic_collections,
  revision_id uuid not null references public.academic_revisions,
  day date not null,
  questions jsonb not null check(jsonb_typeof(questions)='array' and jsonb_array_length(questions) between 1 and 100),
  created_at timestamptz not null default now(),
  unique(collection_id,day)
);
create table public.academic_challenge_participants (
  challenge_id uuid not null references public.academic_challenges,
  user_id uuid not null references auth.users on delete cascade,
  alias text not null check(length(alias) between 2 and 32 and alias !~ '[[:cntrl:]]'),
  visible boolean not null default true,
  joined_at timestamptz not null default now(),
  primary key(challenge_id,user_id)
);
create table public.academic_challenge_attempts (
  user_id uuid not null references auth.users on delete cascade,
  question_key text not null,
  challenge_id uuid not null references public.academic_challenges,
  event_id uuid not null,
  answer_key text not null,
  assisted boolean not null,
  points smallint not null check(points between 0 and 1),
  received_at timestamptz not null default now(),
  primary key(user_id,question_key),
  unique(user_id,event_id),
  foreign key(challenge_id,user_id) references public.academic_challenge_participants
);
create index academic_challenge_scores on public.academic_challenge_attempts(challenge_id,user_id);
alter table public.academic_challenges enable row level security;
alter table public.academic_challenge_participants enable row level security;
alter table public.academic_challenge_attempts enable row level security;
revoke all on public.academic_challenges, public.academic_challenge_participants, public.academic_challenge_attempts from public,anon,authenticated;
grant all on public.academic_challenges, public.academic_challenge_participants, public.academic_challenge_attempts to service_role;

create function public.academic_challenge_access(challenge uuid) returns boolean
language sql stable security definer set search_path='' as $$
  select auth.uid() is not null and exists(select 1 from public.academic_challenges h
    join public.academic_collections c on c.id=h.collection_id
    join public.academic_revisions r on r.id=h.revision_id
    where h.id=challenge and not c.withdrawn and c.visibility<>'private'
      and r.approved_at is not null and r.status='ready' and public.academic_can_read(c.id));
$$;
revoke all on function public.academic_challenge_access(uuid) from public,anon;
grant execute on function public.academic_challenge_access(uuid) to authenticated;

-- Publisher supplies only source-reviewed, non-generated questions with exact
-- canonical bank/question identities and keys. No browser has this grant.
create function public.academic_publish_challenge(revision uuid, challenge_day date, pool jsonb) returns uuid
language plpgsql security definer set search_path='' as $$
declare cid uuid; result uuid; q jsonb;
begin
  select c.id into cid from public.academic_collections c join public.academic_revisions r on r.collection_id=c.id
    where r.id=revision and r.status='ready' and r.approved_at is not null and not c.withdrawn and c.visibility<>'private';
  if cid is null then raise exception 'An approved shared revision is required'; end if;
  if challenge_day is null or challenge_day < (now() at time zone 'UTC')::date or challenge_day > (now() at time zone 'UTC')::date+31
    or jsonb_typeof(pool) is distinct from 'array' or jsonb_array_length(pool) not between 1 and 100 then raise exception 'Invalid daily pool'; end if;
  for q in select * from jsonb_array_elements(pool) loop
    if jsonb_typeof(q) is distinct from 'object' or q->>'key' is null or length(q->>'key') not between 3 and 400
      or q->>'bankId' is null or length(q->>'bankId') not between 1 and 160
      or q->>'questionId' is null or length(q->>'questionId') not between 1 and 160
      or q->>'sourceChecksum' is null or q->>'sourceChecksum' !~ '^sha256:[a-f0-9]{64}$'
      or q->>'answerKey' is null or q->>'answerKey' !~ '^[A-J]$'
      or q->>'eligible' is distinct from 'true'
      or q->>'key' <> (q->>'bankId')||':'||(q->>'questionId') then raise exception 'Invalid eligible question'; end if;
  end loop;
  if (select count(distinct item->>'key') from jsonb_array_elements(pool) item) <> jsonb_array_length(pool) then raise exception 'Duplicate canonical questions'; end if;
  select id into result from public.academic_challenges where collection_id=cid and day=challenge_day;
  if result is not null then
    if exists(select 1 from public.academic_challenges where id=result and revision_id=revision and questions=pool) then return result; end if;
    raise exception 'A published daily pool is immutable';
  end if;
  insert into public.academic_challenges(collection_id,revision_id,day,questions) values(cid,revision,challenge_day,pool) returning id into result;
  return result;
end;
$$;
revoke all on function public.academic_publish_challenge(uuid,date,jsonb) from public,anon,authenticated;
grant execute on function public.academic_publish_challenge(uuid,date,jsonb) to service_role;

create function public.academic_daily_challenges() returns jsonb
language sql stable security definer set search_path='' as $$
  select coalesce(jsonb_agg(item order by module,id),'[]'::jsonb) from (
    select h.id,c.module,jsonb_build_object('id',h.id,'collectionId',h.collection_id,'revisionId',h.revision_id,
      'module',c.module,'day',h.day,'questionCount',jsonb_array_length(h.questions),
      'questions',(select jsonb_agg(jsonb_build_object('key',q->>'key','bankId',q->>'bankId','questionId',q->>'questionId','sourceChecksum',q->>'sourceChecksum')) from jsonb_array_elements(h.questions) q),
      'participation',(select jsonb_build_object('alias',p.alias,'visible',p.visible) from public.academic_challenge_participants p where p.challenge_id=h.id and p.user_id=auth.uid())) item
    from public.academic_challenges h join public.academic_collections c on c.id=h.collection_id
    where h.day=(now() at time zone 'UTC')::date and public.academic_challenge_access(h.id)
    order by c.module,h.id limit 24
  ) page;
$$;

create function public.academic_join_challenge(challenge uuid, display_alias text, participate boolean) returns void
language plpgsql security definer set search_path='' as $$
begin
  if auth.uid() is null then raise exception 'Sign in first' using errcode='42501'; end if;
  if participate=false then
    update public.academic_challenge_participants set visible=false where challenge_id=challenge and user_id=auth.uid();
    return;
  end if;
  if not public.academic_challenge_access(challenge) then raise exception 'Challenge unavailable' using errcode='42501'; end if;
  if participate is null or display_alias is null or length(trim(display_alias)) not between 2 and 32 or display_alias ~ '[[:cntrl:]]' then raise exception 'Use a display alias of 2 to 32 characters'; end if;
  insert into public.academic_challenge_participants(challenge_id,user_id,alias,visible) values(challenge,auth.uid(),trim(display_alias),participate)
    on conflict(challenge_id,user_id) do update set alias=excluded.alias,visible=excluded.visible;
end;
$$;

create function public.academic_submit_challenge(challenge uuid, question_key text, answer_key text, assisted boolean, event_id uuid) returns jsonb
language plpgsql security definer set search_path='' as $$
declare previous public.academic_challenge_attempts; h public.academic_challenges; q jsonb; award smallint;
begin
  if not public.academic_challenge_access(challenge) then raise exception 'Challenge unavailable' using errcode='42501'; end if;
  if not exists(select 1 from public.academic_challenge_participants where challenge_id=challenge and user_id=auth.uid() and visible) then raise exception 'Opt in before competing' using errcode='42501'; end if;
  if event_id is null or assisted is null or answer_key is null or answer_key !~ '^[A-J]$' then raise exception 'Invalid attempt'; end if;
  select * into previous from public.academic_challenge_attempts a where a.user_id=auth.uid() and a.event_id=academic_submit_challenge.event_id;
  if found then
    if previous.challenge_id<>challenge or previous.question_key<>academic_submit_challenge.question_key or previous.answer_key<>academic_submit_challenge.answer_key or previous.assisted<>academic_submit_challenge.assisted then raise exception 'Attempt identity cannot be reused'; end if;
    return jsonb_build_object('accepted',true,'points',previous.points,'replayed',true);
  end if;
  select * into h from public.academic_challenges where id=challenge;
  if h.day<>(now() at time zone 'UTC')::date then raise exception 'This daily challenge is closed'; end if;
  select item into q from jsonb_array_elements(h.questions) item where item->>'key'=question_key;
  if q is null then raise exception 'Question outside this challenge'; end if;
  award=case when not assisted and q->>'answerKey'=answer_key then 1 else 0 end;
  insert into public.academic_challenge_attempts(user_id,question_key,challenge_id,event_id,answer_key,assisted,points)
    values(auth.uid(),question_key,challenge,event_id,answer_key,assisted,award) on conflict on constraint academic_challenge_attempts_pkey do nothing;
  if not found then return jsonb_build_object('accepted',false,'points',0,'reason','already-attempted'); end if;
  return jsonb_build_object('accepted',true,'points',award,'replayed',false);
end;
$$;

create function public.academic_challenge_standings(challenge uuid) returns jsonb
language plpgsql stable security definer set search_path='' as $$
declare result jsonb;
begin
  if not public.academic_challenge_access(challenge) then raise exception 'Challenge unavailable' using errcode='42501'; end if;
  with scores as (
    select p.user_id,p.alias,coalesce(sum(a.points),0)::integer points,count(a.event_id)::integer answered
    from public.academic_challenge_participants p left join public.academic_challenge_attempts a on a.challenge_id=p.challenge_id and a.user_id=p.user_id
    where p.challenge_id=challenge and p.visible group by p.user_id,p.alias
  ), ranked as (select *,dense_rank() over(order by points desc) rank from scores), bounded as (
    select * from ranked order by rank,alias,user_id limit 100
  ) select jsonb_build_object('rows',coalesce((select jsonb_agg(jsonb_build_object('alias',alias,'points',points,'answered',answered,'rank',rank,'you',user_id=auth.uid()) order by rank,alias) from bounded),'[]'::jsonb),
    'yourRank',(select rank from ranked where user_id=auth.uid()),'participants',(select count(*) from scores)) into result;
  return result;
end;
$$;
revoke all on function public.academic_daily_challenges(), public.academic_join_challenge(uuid,text,boolean),
  public.academic_submit_challenge(uuid,text,text,boolean,uuid), public.academic_challenge_standings(uuid) from public,anon;
grant execute on function public.academic_daily_challenges(), public.academic_join_challenge(uuid,text,boolean),
  public.academic_submit_challenge(uuid,text,text,boolean,uuid), public.academic_challenge_standings(uuid) to authenticated;
