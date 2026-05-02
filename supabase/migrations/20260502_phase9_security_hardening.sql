-- Phase 9d — Security hardening: is_active gates + reference-table scoping +
-- security_audit_log table.
--
-- Goal: deactivated users (`users.is_active = false`) lose all data access at
-- the database boundary, not just at the EF layer. The EF `verify()` already
-- blocks them, but anything the client does directly via supabase-js
-- (`supabase.from('quotations').select()`) only hits RLS — that's the gap.
--
-- Strategy:
--   1. Add `is_active_user()` SECURITY DEFINER helper.
--   2. Modify `current_user_role()` to return NULL when caller is inactive.
--      Cascades through ~40 existing policies that gate on the role token.
--   3. Add a single RESTRICTIVE policy `is_active_user()` to each table whose
--      existing policies grant access via `auth.uid()` self-clauses — those
--      are the paths that bypass current_user_role(). RESTRICTIVE is ANDed
--      with every permissive policy, so this is one new line per table
--      instead of rewriting every existing policy.
--   4. Tighten reference-table SELECT for `outlets` and `outlet_brands` from
--      `using (true)` to entity-scoped. `sales_verticals` and
--      `back_office_subdepts` cannot be entity-scoped (no entity_id column,
--      not entity-specific data) — left as-is and noted below.
--   5. New `security_audit_log` table for privilege-mutation logging (M3).
--
-- Plan deviations (verified against actual schema):
--   • Plan body referenced `customers` and `leads` tables — they do NOT exist
--     in this schema. Real user-data tables: quotations, proforma_invoices,
--     financier_copies, vehicle_catalog, tiv_forecast_*, users, error_log,
--     plus join tables user_brands/user_sales_verticals/user_outlets/
--     user_profiles.
--   • Plan asked to entity-scope sales_verticals + back_office_subdepts —
--     impossible, those tables have no entity_id column and represent global
--     reference data (8 brand-keyed verticals, 3 global subdepts). Skipped
--     with explicit reasoning below.

-- ============================================================
-- 1. is_active_user() helper
-- ============================================================
create or replace function public.is_active_user()
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select coalesce(
    (select is_active from public.users where id = auth.uid()),
    false
  )
$$;

comment on function public.is_active_user() is
  'Phase 9d — true iff caller is logged in AND users.is_active = true. Used as RLS RESTRICTIVE predicate on user-data tables to deny deactivated users.';

-- ============================================================
-- 2. current_user_role() — return NULL for inactive callers
-- ============================================================
-- Adds an is_active gate to the existing function from Phase 6c.3a. Output is
-- otherwise unchanged: 'admin' | department.code | NULL. Every existing RLS
-- policy that gates on current_user_role() now denies inactive users for free.
create or replace function public.current_user_role()
returns text
language sql
stable
security definer
set search_path = public
as $$
  select case
    when u.is_active = false           then null
    when u.permission_level = 'admin'  then 'admin'
    when d.code is not null            then d.code
    else null
  end
  from public.users u
  left join public.departments d on d.id = u.department_id
  where u.id = auth.uid()
$$;

-- Sanity: the admin user must still resolve to 'admin' after this rewrite.
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

-- ============================================================
-- 3. RESTRICTIVE is_active_user() predicates
-- ============================================================
-- Tables here have at least one policy that grants access via an `auth.uid()`
-- self-clause (created_by, user_id, id) without going through
-- current_user_role(). Inactive users could otherwise reach their own rows.
--
-- A RESTRICTIVE policy is ANDed with every permissive policy on the table —
-- so the resulting effective rule is "(any existing permissive grants access)
-- AND (caller is_active)". Drop + recreate keeps the migration idempotent.

do $$
declare
  t text;
begin
  foreach t in array array[
    'quotations',
    'proforma_invoices',
    'financier_copies',
    'users',
    'user_brands',
    'user_sales_verticals',
    'user_outlets',
    'user_profiles',
    'tiv_forecast_tiv_actuals',
    'tiv_forecast_ptb_actuals',
    'tiv_forecast_al_actuals',
    'tiv_forecast_judgment_tiv',
    'tiv_forecast_judgment_ptb',
    'tiv_forecast_raw_data',
    'tiv_forecast_model_params',
    'error_log'
  ] loop
    execute format('drop policy if exists %I on public.%I', t || '_active_only', t);
    execute format($q$
      create policy %I on public.%I
        as restrictive
        for all
        to authenticated
        using      (public.is_active_user())
        with check (public.is_active_user())
    $q$, t || '_active_only', t);
  end loop;
end $$;

-- ============================================================
-- 4. Tighten reference-table SELECT (M2)
-- ============================================================
-- outlets: was `using (true)` for authenticated. Now scoped to caller's entity
-- (admin sees all). Existing app code already filters by entity_id on the
-- client side; this is the RLS-side belt-and-braces.
drop policy if exists outlets_select_all on public.outlets;
create policy outlets_select on public.outlets
  for select to authenticated
  using (
    public.current_user_role() = 'admin'
    or entity_id = public.get_my_entity_id()
  );

-- outlet_brands has no entity_id column; scope via join to outlets.
drop policy if exists ob_select_all on public.outlet_brands;
create policy outlet_brands_select on public.outlet_brands
  for select to authenticated
  using (
    public.current_user_role() = 'admin'
    or exists (
      select 1 from public.outlets o
      where o.id = outlet_brands.outlet_id
        and o.entity_id = public.get_my_entity_id()
    )
  );

-- sales_verticals + back_office_subdepts: NOT entity-scoped because they have
-- no entity_id column and represent global reference data (8 brand-keyed
-- verticals shared across entities; 3 global subdepts). Plan body asked to
-- scope these but the underlying data model doesn't support it. Left
-- unchanged (still `select_all using (true)` for authenticated). If brand- or
-- user_brands-based scoping is wanted later, that's a separate change.

-- ============================================================
-- 5. security_audit_log (M3)
-- ============================================================
create table if not exists public.security_audit_log (
  id          uuid primary key default gen_random_uuid(),
  created_at  timestamptz not null default now(),
  actor_id    uuid references auth.users(id) on delete set null,
  action      text not null,
  target_id   uuid,
  before_jsonb jsonb,
  after_jsonb  jsonb
);

create index if not exists security_audit_log_created_at_idx
  on public.security_audit_log (created_at desc);
create index if not exists security_audit_log_actor_idx
  on public.security_audit_log (actor_id, created_at desc);
create index if not exists security_audit_log_action_idx
  on public.security_audit_log (action, created_at desc);

alter table public.security_audit_log enable row level security;

-- Read: admin only. Writes: only via service-role (EFs); no permissive INSERT
-- policy means authenticated callers cannot write directly.
drop policy if exists security_audit_log_select on public.security_audit_log;
create policy security_audit_log_select on public.security_audit_log
  for select to authenticated
  using (public.current_user_role() = 'admin');

comment on table public.security_audit_log is
  'Phase 9d (M3) — append-only log of privilege mutations. Written by admin EFs via service-role; readable only by admin tier.';

-- ============================================================
-- Rollback recipe (manual — run interactively if 9d needs reverting)
-- ============================================================
-- 1. Drop all `*_active_only` RESTRICTIVE policies:
--      do $$ declare t text; begin
--        foreach t in array array['quotations','proforma_invoices',
--          'financier_copies','users','user_brands','user_sales_verticals',
--          'user_outlets','user_profiles','tiv_forecast_tiv_actuals',
--          'tiv_forecast_ptb_actuals','tiv_forecast_al_actuals',
--          'tiv_forecast_judgment_tiv','tiv_forecast_judgment_ptb',
--          'tiv_forecast_raw_data','tiv_forecast_model_params','error_log']
--        loop
--          execute format('drop policy if exists %I on public.%I',
--            t || '_active_only', t);
--        end loop; end $$;
-- 2. Restore reference-table policies to `select_all using (true)`:
--      drop policy if exists outlets_select on public.outlets;
--      create policy outlets_select_all on public.outlets
--        for select to authenticated using (true);
--      drop policy if exists outlet_brands_select on public.outlet_brands;
--      create policy ob_select_all on public.outlet_brands
--        for select to authenticated using (true);
-- 3. Re-deploy the Phase 6c.3a current_user_role() definition (remove the
--    is_active CASE branch). See migrations/20260416_phase6c3a_*.sql.
-- 4. Drop function public.is_active_user();
-- 5. Drop table public.security_audit_log;
