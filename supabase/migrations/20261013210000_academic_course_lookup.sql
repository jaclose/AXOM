-- A deep link must not depend on a course appearing in the first catalog page.
create function public.academic_course(collection uuid) returns jsonb
language sql stable security definer set search_path='' as $$
  select jsonb_build_object('id',c.id,'title',c.title,'module',c.module,'term',c.term,
    'academic_term',c.academic_term,'cohort',c.cohort,'visibility',c.visibility,'review_status',c.review_status,
    'current_revision_id',c.current_revision_id,'owned',c.owner_id=auth.uid(),
    'ready_questions',r.ready_questions,'review_questions',r.review_questions)
  from public.academic_collections c join public.academic_revisions r on r.id=c.current_revision_id
  where c.id=collection and auth.uid() is not null and public.academic_can_read(c.id) and not c.withdrawn
    and (c.owner_id=auth.uid() or r.approved_at is not null);
$$;
revoke all on function public.academic_course(uuid) from public,anon;
grant execute on function public.academic_course(uuid) to authenticated;
