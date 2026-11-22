-- Tracker-only review is separate from answer/explanation review. Do not change
-- either academic_review overload or the community positive-question gates.
-- SQL verifies metadata, stored plan shape and the exact immutable revision.
-- The authenticated reviewer client separately reads catalog/template bytes;
-- this is not a SQL claim to have inspected private Storage JSON or its facts.
create table public.academic_tracker_reviews (
  revision_id uuid primary key references public.academic_revisions(id) on delete cascade,
  collection_id uuid not null references public.academic_collections(id) on delete cascade,
  content_hash text not null check (content_hash ~ '^[a-f0-9]{64}$'),
  template_hash text not null check (template_hash ~ '^[a-f0-9]{64}$'),
  manifest_hash text not null check (manifest_hash ~ '^[a-f0-9]{64}$'),
  activity_count integer not null check (activity_count between 1 and 10000),
  stated_week_activity_count integer not null check (stated_week_activity_count >= 0),
  unstated_week_activity_count integer not null check (unstated_week_activity_count >= 0),
  reviewer_id uuid references auth.users(id) on delete set null,
  reviewed_at timestamptz not null default now(),
  check (stated_week_activity_count + unstated_week_activity_count = activity_count)
);
alter table public.academic_tracker_reviews enable row level security;
revoke all on public.academic_tracker_reviews from public, anon, authenticated;
grant all on public.academic_tracker_reviews to service_role;
comment on table public.academic_tracker_reviews is
  'Exact-revision tracker source/plan review. Named weeks are observations, not certified schedule assignments. Reviewer deletion retains hashes and time with a null identity.';

-- Conservative counterpart to the existing plain-text template parser. Every
-- section needs a heading and at least one readable activity. No week is inferred.
create function public.academic_tracker_plan_shape(plan_text text) returns jsonb
language plpgsql immutable set search_path = '' as $$
declare
  section text; raw_line text; line text; heading boolean; section_count integer := 0;
  section_items integer; activity_count integer := 0; stated_count integer := 0;
  headed_week integer; item_week integer; matched text[]; week_dates jsonb; week_key text;
begin
  if plan_text is null or octet_length(plan_text) not between 1 and 262144
    or btrim(plan_text) = '' then raise exception 'A readable tracker plan is required' using errcode = '22023'; end if;
  foreach section in array string_to_array(plan_text, E'\n@@ AXOM course plan section @@\n') loop
    section_count := section_count + 1;
    if section_count > 24 then raise exception 'Too many tracker plan sections' using errcode = '22023'; end if;
    heading := false; section_items := 0; headed_week := null; week_dates := '{}'::jsonb;
    foreach raw_line in array string_to_array(section, E'\n') loop
      line := btrim(replace(raw_line, E'\r', ''), E' \t' || chr(65279));
      if line = '' then continue; end if;
      if line ~ '[[:cntrl:]]' then raise exception 'Invalid tracker plan characters' using errcode = '22023'; end if;
      if left(line, 1) = '@' then
        matched := regexp_match(line, '^@(academic-term|cohort|source-revision|authority|week-policy|source|week[[:space:]]+[0-9]+):[[:space:]]*(.+)$', 'i');
        if matched is null then raise exception 'Unrecognized tracker source metadata' using errcode = '22023'; end if;
        if lower(matched[1]) = 'authority' and matched[2] <> 'reviewed'
          or lower(matched[1]) = 'week-policy' and matched[2] <> 'explicit'
          or lower(matched[1]) = 'source-revision' and matched[2] !~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}$'
          then raise exception 'Invalid tracker source metadata' using errcode = '22023'; end if;
        if lower(matched[1]) ~ '^week[[:space:]]+[0-9]+$' then
          week_key := substring(matched[1] from '[0-9]+');
          if length(week_key) > 2 or week_key::integer not between 1 and 60 then
            raise exception 'Tracker source weeks must be 1 through 60' using errcode = '22023'; end if;
          week_key := week_key::integer::text;
          if week_dates ? week_key and week_dates ->> week_key <> matched[2] then
            raise exception 'Conflicting tracker source dates' using errcode = '22023'; end if;
          week_dates := week_dates || jsonb_build_object(week_key, matched[2]);
        end if;
        continue;
      end if;
      if not heading then
        -- The module and section title are both required. An activity or a
        -- standalone Week/Unscheduled line cannot masquerade as the heading.
        if line ~ '[\[\]]' or line !~ '[[:space:]]+[-–][[:space:]]+'
          or line ~* '^(week|wk|unscheduled)([[:space:]:]|$)'
          or btrim(regexp_replace(line, '^.*[[:space:]]+[-–][[:space:]]+', ''), ' :') = '' then
          raise exception 'A module and section heading are required' using errcode = '22023'; end if;
        heading := true; continue;
      end if;
      matched := regexp_match(line, '^(week|wk)[[:space:]]*0*([0-9]+)[[:space:]]*:?[[:space:]]*$', 'i');
      if matched is not null then
        if length(matched[2]) > 2 or matched[2]::integer not between 1 and 60 then
          raise exception 'Tracker weeks must be 1 through 60' using errcode = '22023'; end if;
        headed_week := matched[2]::integer; continue;
      end if;
      if line ~* '^Unscheduled[[:space:]]*:[[:space:]]*$' then headed_week := null; continue; end if;
      matched := regexp_match(line, '^(.+)[[:space:]]*\[([^\[\]]+)\][[:space:]]*$');
      if matched is null or btrim(matched[1]) = '' or lower(btrim(matched[2])) not in
        ('lecture','flipped lecture','flipped classroom','dla','small group','sg','imcq','esoft','examsoft','pq','practice questions','lab','case','review','assessment','exam','quiz','assignment') then
        raise exception 'Every tracker activity needs a recognized kind' using errcode = '22023'; end if;
      matched := regexp_match(matched[1], '(^|[^a-z0-9])(week|wk)[[:space:]]*0*([0-9]+)([^0-9]|$)', 'i');
      item_week := headed_week;
      if matched is not null then
        if length(matched[3]) > 2 or matched[3]::integer not between 1 and 60 then
          raise exception 'Tracker activity weeks must be 1 through 60' using errcode = '22023'; end if;
        item_week := matched[3]::integer;
      end if;
      section_items := section_items + 1; activity_count := activity_count + 1;
      if activity_count > 10000 then raise exception 'Too many tracker activities' using errcode = '22023'; end if;
      if item_week is not null then stated_count := stated_count + 1; end if;
    end loop;
    if not heading or section_items = 0 then
      raise exception 'Every tracker section needs readable activities' using errcode = '22023'; end if;
  end loop;
  return jsonb_build_object('activities', activity_count, 'stated_week_activities', stated_count,
    'unstated_week_activities', activity_count - stated_count, 'sections', section_count);
end;
$$;
revoke all on function public.academic_tracker_plan_shape(text) from public, anon, authenticated;

-- The deliberately narrow path accepts only catalog.json and plain-text
-- templates. It cannot approve declared question-bank metadata or extra JSON.
-- Original-source links and uncertainty remain in the exact template text.
create function public.academic_tracker_manifest_hash(revision uuid) returns text
language plpgsql stable security definer set search_path = '' as $$
declare manifest text; file_count integer; template_count integer;
begin
  select count(*), count(*) filter (where f.path <> 'catalog.json')
    into file_count, template_count from public.academic_files f where f.revision_id = revision;
  if file_count not between 2 and 25 or template_count not between 1 and 24
    or not exists(select 1 from public.academic_files f where f.revision_id = revision
      and f.path = 'catalog.json' and f.mime_type = 'application/json')
    or exists(select 1 from public.academic_files f join public.academic_revisions r on r.id = f.revision_id
      where f.revision_id = revision and (
        f.path ~ '[[:cntrl:]]' or f.object_path <> r.collection_id::text || '/' || f.sha256
        or f.byte_size > 262144
        or (f.path <> 'catalog.json' and (f.path !~ '^templates/.+\.txt$' or f.mime_type <> 'text/plain'))
        or not exists(select 1 from storage.objects o where o.bucket_id = 'academic-content'
          and o.name = f.object_path and (o.metadata ->> 'size')::bigint = f.byte_size)
      )) then raise exception 'A tracker-only catalog and template manifest are required' using errcode = '22023'; end if;
  select string_agg(f.path || E'\n' || f.sha256 || E'\n' || f.byte_size::text || E'\n'
    || f.mime_type || E'\n' || f.object_path || E'\n', '' order by f.path collate "C")
    into manifest from public.academic_files f where f.revision_id = revision;
  return encode(sha256(convert_to(manifest, 'UTF8')), 'hex');
end;
$$;
revoke all on function public.academic_tracker_manifest_hash(uuid) from public, anon, authenticated;

create function public.academic_tracker_review_target(collection uuid, revision uuid) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare current_revision public.academic_revisions%rowtype; course public.academic_collections%rowtype;
  shape jsonb; manifest_hash text;
begin
  if auth.uid() is null or not exists(select 1 from public.academic_reviewers where user_id = auth.uid()) then
    raise exception 'Reviewer access required' using errcode = '42501'; end if;
  select c.* into course from public.academic_collections c
    where c.id = collection and c.current_revision_id = revision and c.visibility = 'shared'
      and c.group_id is null and c.review_status = 'pending' and not c.withdrawn;
  if not found then return null; end if;
  select r.* into current_revision from public.academic_revisions r
    where r.id = revision and r.collection_id = collection and r.status = 'ready'
      and r.ready_questions = 0 and r.review_questions = 0;
  if not found or exists(select 1 from public.academic_community_submissions s
    where s.collection_id = collection and s.revision_id = revision) then return null; end if;
  shape := public.academic_tracker_plan_shape(current_revision.template_text);
  manifest_hash := public.academic_tracker_manifest_hash(revision);
  return jsonb_build_object('collection_id', collection, 'revision_id', revision,
    'reviewer_id', auth.uid(),
    'content_hash', current_revision.content_hash, 'template_text', current_revision.template_text,
    'template_hash', encode(sha256(convert_to(current_revision.template_text, 'UTF8')), 'hex'),
    'manifest_hash', manifest_hash, 'module', course.module, 'term', course.term,
    'ready_questions', 0, 'review_questions', 0, 'shape', shape);
end;
$$;
revoke all on function public.academic_tracker_review_target(uuid,uuid) from public, anon;
grant execute on function public.academic_tracker_review_target(uuid,uuid) to authenticated;

-- One transaction records the real reviewer and approves the same locked
-- current revision. There is no reusable attestation from a different reviewer.
create function public.academic_approve_tracker(
  collection uuid, revision uuid, content_hash text, template_hash text, manifest_hash text,
  observed_activities integer, observed_stated_week_activities integer, plan_reviewed boolean
) returns jsonb language plpgsql security definer set search_path = '' as $$
declare target jsonb; reviewed_time timestamptz := now();
begin
  if auth.uid() is null or not exists(select 1 from public.academic_reviewers where user_id = auth.uid()) then
    raise exception 'Reviewer access required' using errcode = '42501'; end if;
  if plan_reviewed is distinct from true then raise exception 'Tracker source and plan review required' using errcode = '22023'; end if;
  perform 1 from public.academic_collections c join public.academic_revisions r
    on r.id = c.current_revision_id and r.collection_id = c.id
    where c.id = collection and r.id = revision and c.visibility = 'shared' and c.group_id is null
      and c.review_status = 'pending' and not c.withdrawn and r.status = 'ready'
    for update of c, r;
  if not found then raise exception 'The tracker submission changed. Open its current revision.' using errcode = '40001'; end if;
  target := public.academic_tracker_review_target(collection, revision);
  if target is null then raise exception 'A tracker-only pending revision is required' using errcode = '22023'; end if;
  if target ->> 'content_hash' is distinct from content_hash
    or target ->> 'template_hash' is distinct from template_hash
    or target ->> 'manifest_hash' is distinct from manifest_hash then
    raise exception 'The tracker content changed. Check its stored plan again.' using errcode = '40001'; end if;
  if (target #>> '{shape,activities}')::integer is distinct from observed_activities
    or (target #>> '{shape,stated_week_activities}')::integer is distinct from observed_stated_week_activities then
    raise exception 'The tracker plan observations differ from this revision' using errcode = '22023'; end if;
  insert into public.academic_tracker_reviews(revision_id,collection_id,content_hash,template_hash,manifest_hash,
    activity_count,stated_week_activity_count,unstated_week_activity_count,reviewer_id,reviewed_at)
    values(revision,collection,content_hash,template_hash,manifest_hash,observed_activities,
      observed_stated_week_activities,observed_activities - observed_stated_week_activities,auth.uid(),reviewed_time);
  update public.academic_revisions r set approved_at = reviewed_time where r.id = revision;
  update public.academic_collections c set review_status = 'approved', updated_at = reviewed_time where c.id = collection;
  return jsonb_build_object('collection_id',collection,'revision_id',revision,'reviewer_id',auth.uid(),
    'content_hash',content_hash,'template_hash',template_hash,'manifest_hash',manifest_hash,'reviewed_at',reviewed_time);
end;
$$;
revoke all on function public.academic_approve_tracker(uuid,uuid,text,text,text,integer,integer,boolean) from public, anon;
grant execute on function public.academic_approve_tracker(uuid,uuid,text,text,text,integer,integer,boolean) to authenticated;
