-- Fix infinite recursion in users_select policy.
-- The previous fix used a raw subquery against public.users inside the policy,
-- which re-triggers the same policy → infinite recursion → 500 on every users query.
-- Solution: wrap the self-lookup in a SECURITY DEFINER function so it bypasses RLS.

create or replace function public.get_my_entity_id()
returns uuid language sql stable security definer set search_path = public as $$
  select entity_id from public.users where id = auth.uid()
$$;

drop policy if exists users_select on public.users;
create policy users_select on public.users
  for select to authenticated
  using (
    public.current_user_role() = 'admin'
    or id = auth.uid()
    or public.is_hr_same_entity(entity_id)
    or (
      entity_id is not null
      and entity_id = public.get_my_entity_id()
    )
  );
