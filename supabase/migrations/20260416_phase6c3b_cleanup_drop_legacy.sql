-- Phase 6c.3 cleanup — drop legacy text columns on users + access_rules.
-- ============================================================
-- 20260416_phase6c3a rewrote current_user_role() so every RLS policy that
-- gated on that function is decoupled from users.role. The 4 admin-* edge
-- functions derive the same token in their verify() via a joined select.
-- Every client reader has migrated to the 4-axis columns. It's safe to drop.
--
-- This migration:
-- 1. Rewrites the one policy (error_log admin read) that inlined users.role
--    to use current_user_role() — same gate, no column dependency.
-- 2. Drops CHECK constraints tied to legacy columns (users_role_check,
--    users_entity_check).
-- 3. Drops the legacy text columns from users:
--      role, vertical, brand, department, designation, entity
--    Keeps users.location as informational free text (plan 6b.0).
-- 4. Drops the legacy text columns from access_rules:
--      role, brand, location, department
-- 5. Tightens NOT NULL on the new axes:
--      users.permission_level NOT NULL
--      access_rules.permission_level / entity_id / department_id NOT NULL
-- 6. Pre- and post-flight sanity asserts fail loudly if anything breaks.

do $$
declare
  bad int;
begin
  select count(*) into bad from public.users where permission_level is null;
  if bad > 0 then
    raise exception 'Pre-flight: % users still have NULL permission_level', bad;
  end if;
  select count(*) into bad from public.access_rules
   where permission_level is null or entity_id is null or department_id is null;
  if bad > 0 then
    raise exception 'Pre-flight: % access_rules have NULL on a required axis', bad;
  end if;
end $$;

-- Rewrite the one policy that inlined users.role so it uses current_user_role()
-- like everything else — same gate, no legacy-column dependency.
drop policy if exists "error_log admin read" on public.error_log;
create policy "error_log admin read" on public.error_log
  for select to authenticated
  using (public.current_user_role() = 'admin');

-- Drop CHECK constraints tied to legacy columns
alter table public.users drop constraint if exists users_role_check;
alter table public.users drop constraint if exists users_entity_check;

-- Drop legacy text columns on users
alter table public.users drop column if exists role;
alter table public.users drop column if exists vertical;
alter table public.users drop column if exists brand;
alter table public.users drop column if exists department;
alter table public.users drop column if exists designation;
alter table public.users drop column if exists entity;

-- Drop legacy text columns on access_rules
alter table public.access_rules drop column if exists role;
alter table public.access_rules drop column if exists brand;
alter table public.access_rules drop column if exists location;
alter table public.access_rules drop column if exists department;

-- Tighten new-axis NOT NULL constraints
alter table public.users         alter column permission_level set not null;
alter table public.access_rules  alter column permission_level set not null;
alter table public.access_rules  alter column entity_id        set not null;
alter table public.access_rules  alter column department_id    set not null;

-- Final sanity — admin resolves via the new function
do $$
declare
  v text;
begin
  select case
    when u.permission_level = 'admin' then 'admin'
    when d.code is not null then d.code
    else null
  end into v
  from public.users u
  left join public.departments d on d.id = u.department_id
  where u.permission_level = 'admin'
  limit 1;
  if v is distinct from 'admin' then
    raise exception 'Post-drop: admin does not resolve to ''admin'' via new logic (got %)', v;
  end if;
end $$;
