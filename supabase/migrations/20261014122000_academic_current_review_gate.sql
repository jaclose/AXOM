-- Public/group academic access must be coupled to the CURRENT revision's
-- explicit review approval. An earlier approved version cannot keep a
-- rejected/replaced private collection available to unrelated students.
-- The account owner keeps recovery access to every own revision.
-- Additive permission tightening: no content, progress or history is removed.
create or replace function public.academic_can_read(collection uuid) returns boolean
language sql stable security definer set search_path = '' as $$
  select exists(
    select 1
      from public.academic_collections c
     where c.id = collection and
       (
         (c.owner_id = auth.uid())
         or (
           auth.uid() is not null
           and not c.withdrawn
           and c.review_status = 'approved'
           and c.current_revision_id is not null
           and exists(
             select 1 from public.academic_revisions r
             where r.id = c.current_revision_id
               and r.collection_id = c.id
               and r.status = 'ready'
               and r.approved_at is not null
           )
           and (
             c.visibility = 'shared'
             or (
               c.visibility = 'group'
               and exists(
                 select 1 from public.academic_group_members m
                 where m.group_id = c.group_id and m.user_id = auth.uid()
               )
             )
           )
         )
       )
  );
$$;
revoke all on function public.academic_can_read(uuid) from public, anon;
grant execute on function public.academic_can_read(uuid) to authenticated;
