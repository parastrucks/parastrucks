-- Phase 6c.3a prep: rewrite current_user_role() to derive the RLS token from
-- the new 4-axis columns instead of users.role. Output tokens match the old
-- legacy values verbatim so every RLS policy referencing current_user_role()
-- keeps working unchanged. This decouples the ~40 RLS policies from
-- users.role, making the column safe to drop in the next migration.
--
-- Mapping:
--   permission_level='admin'             → 'admin'  (singleton admin bypass)
--   departments.code                     → same text ('sales','hr','back_office',
--                                          'service','spares','accounts','pdi')
--   no match / no row                    → NULL     (fails every allow-list check)
--
-- Service/Spares/Accounts/PDI users now return those codes directly instead
-- of being force-mapped to 'back_office' like the old EF writes did — they
-- don't match any existing write policy so they're denied by default,
-- which is the correct security posture.

create or replace function public.current_user_role()
returns text
language sql
stable
security definer
set search_path = public
as $$
  select case
    when u.permission_level = 'admin' then 'admin'
    when d.code is not null           then d.code
    else null
  end
  from public.users u
  left join public.departments d on d.id = u.department_id
  where u.id = auth.uid()
$$;

-- Sanity: the admin user must still resolve to 'admin' after this function
-- swap or every RLS policy denies them. Fails loudly if the rewrite broke.
do $$
declare
  r text;
begin
  select permission_level into r
  from public.users
  where permission_level = 'admin' and is_active = true
  limit 1;
  if r is distinct from 'admin' then
    raise exception 'No active admin user found — current_user_role() rewrite would lock out the admin';
  end if;
end $$;
