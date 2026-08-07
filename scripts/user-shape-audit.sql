-- ═══════════════════════════════════════════════════════════════════════════════
-- USER-SHAPE COMPLETENESS AUDIT — portal (mmmxvjaavdtwlpcnjgzy)
--
-- READ-ONLY. Writes nothing. Safe to run on prod at any time.
--
-- Run either way:
--   psql "postgresql://postgres.mmmxvjaavdtwlpcnjgzy:<PW>@aws-<N>-<region>.pooler.supabase.com:5432/postgres" -f scripts/user-shape-audit.sql
--   ...or paste each block into the Supabase SQL editor (dashboard → SQL Editor).
--
-- Goal: every user, in every department, carries the same set of attributes.
-- Query 1 is the ACCEPTANCE TEST. Query 2 is the backfill worklist. Query 3 and 4
-- are pre-checks that gate the DB constraints.
--
-- Note on "the shape": the applicability matrix is inlined as a CTE here so this
-- runs BEFORE any schema change. Once department_attribute_policy exists, replace
-- the `policy` CTE with a read of that table (marked below).
-- ═══════════════════════════════════════════════════════════════════════════════


-- ───────────────────────────────────────────────────────────────────────────────
-- QUERY 1 — THE SHAPE GRID (acceptance test)
--
-- Every department must show the SAME shape. Done means:
--     missing    = 0 on every requirement='required' row
--     set_but_na = 0 on every requirement='not_applicable' row
--
-- set_but_na is not cosmetic: it catches the promoted-GM case, where a Back
-- Office manager promoted to GM keeps a sub-department the form hid but kept
-- submitting.
--
-- The (NO ENTITY) / (NO DEPARTMENT) buckets matter most. current_user_role()
-- returns NULL when department_id is NULL, so those users fail EVERY role-gated
-- RLS policy — they are not merely incomplete, they are locked out of the data
-- layer with no error message, and invisible to every entity-scoped query.
-- ───────────────────────────────────────────────────────────────────────────────
with
attrs(attribute) as (
  values ('entity'),('designation'),('permission_level'),
         ('primary_outlet'),('brands'),('sales_verticals'),('subdept')
),
dept_codes(dept_code) as (
  select code from public.departments
  union all select '(NO DEPARTMENT)'
),
entity_codes(entity_code) as (
  select code from public.entities
  union all select '(NO ENTITY)'
),

-- ══ THE SHAPE CONTRACT ══
-- Replace this entire CTE, once the policy table exists, with:
--   select d.code, p.attribute, p.requirement
--     from public.department_attribute_policy p
--     join public.departments d on d.id = p.department_id
policy(dept_code, attribute, requirement) as (
  select d.dept_code, a.attribute,
         case
           when a.attribute = 'sales_verticals' and d.dept_code <> 'sales'       then 'not_applicable'
           when a.attribute = 'subdept'         and d.dept_code <> 'back_office' then 'not_applicable'
           else 'required'
         end
  from dept_codes d cross join attrs a
),

u as (
  select
    x.id,
    coalesce(e.code, '(NO ENTITY)')     as entity_code,
    coalesce(d.code, '(NO DEPARTMENT)') as dept_code,
    x.entity_id, x.designation_id, x.permission_level,
    x.primary_outlet_id, x.subdept_id,
    (select count(*) from public.user_brands          ub where ub.user_id = x.id) as n_brands,
    (select count(*) from public.user_sales_verticals uv where uv.user_id = x.id) as n_verticals
  from public.users x
  left join public.entities    e on e.id = x.entity_id
  left join public.departments d on d.id = x.department_id
  where x.is_active
    -- The singleton admin is exempt from the shape: they sit outside the
    -- department tree (the `admin` department is inactive and has ZERO
    -- designations, so `designation ∈ department` is unsatisfiable for them).
    and x.permission_level <> 'admin'
),

state as (
  select u.entity_code, u.dept_code, a.attribute, u.id,
         case a.attribute
           when 'entity'           then u.entity_id         is not null
           when 'designation'      then u.designation_id    is not null
           when 'permission_level' then u.permission_level  is not null
           when 'primary_outlet'   then u.primary_outlet_id is not null
           when 'brands'           then u.n_brands    > 0
           when 'sales_verticals'  then u.n_verticals > 0
           when 'subdept'          then u.subdept_id  is not null
         end as has_value
  from u cross join attrs a
)

select
  e.entity_code as entity,
  d.dept_code   as department,
  a.attribute,
  p.requirement,
  count(s.id)                                                                   as users,
  count(s.id) filter (where p.requirement='required'       and not s.has_value) as missing,
  count(s.id) filter (where p.requirement='required'       and     s.has_value) as present,
  count(s.id) filter (where p.requirement='not_applicable' and     s.has_value) as set_but_na,
  count(s.id) filter (where p.requirement='not_applicable' and not s.has_value) as not_applicable
from entity_codes e
cross join dept_codes d
cross join attrs      a
join policy p on p.dept_code = d.dept_code and p.attribute = a.attribute
left join state s on s.entity_code = e.entity_code
                 and s.dept_code   = d.dept_code
                 and s.attribute   = a.attribute
group by 1,2,3,4
having count(s.id) > 0          -- drop empty entity×department combinations
order by 1,2,3;


-- ───────────────────────────────────────────────────────────────────────────────
-- QUERY 2 — PER-USER GAPS = THE BACKFILL WORKLIST
--
-- One row per PERSON (the owner fills a person in one pass), not per attribute.
--
-- ⚠️ READ would_enter_erp_if_given_hdh FIRST. Assigning `hdh` to a PT user in
-- service/spares/accounts/sales does not just fix portal data — the next sync
-- CREATES AN ERP AUTH USER AND PROFILE for them. Treat it as an access grant.
--
-- ⚠️ Assigning ANY brand is a portal authorization grant too. user_brands gates
-- quotations_select, proforma_invoices_select, financier_copies_select, all seven
-- tiv_forecast_*_select, and vehicle_catalog_select — i.e. customer names,
-- mobiles, GSTINs, chassis/engine numbers and pricing for that brand+entity.
-- access_rules does NOT protect these: it is evaluated client-side only.
-- ───────────────────────────────────────────────────────────────────────────────
with attrs(attribute) as (
  values ('entity'),('designation'),('permission_level'),
         ('primary_outlet'),('brands'),('sales_verticals'),('subdept')
),
u as (
  select x.id, x.full_name, x.email, x.location, x.permission_level,
         coalesce(e.code,'(NO ENTITY)')     as entity_code,
         coalesce(d.code,'(NO DEPARTMENT)') as dept_code,
         x.entity_id, x.designation_id, x.primary_outlet_id, x.subdept_id,
         (select count(*) from public.user_brands          ub where ub.user_id=x.id) as n_brands,
         (select count(*) from public.user_sales_verticals uv where uv.user_id=x.id) as n_verticals
  from public.users x
  left join public.entities    e on e.id = x.entity_id
  left join public.departments d on d.id = x.department_id
  where x.is_active and x.permission_level <> 'admin'
),
gaps as (
  select u.*, a.attribute
  from u cross join attrs a
  where case a.attribute
          when 'entity'           then u.entity_id         is null
          when 'designation'      then u.designation_id    is null
          when 'permission_level' then u.permission_level  is null
          when 'primary_outlet'   then u.primary_outlet_id is null
          when 'brands'           then u.n_brands    = 0
          when 'sales_verticals'  then u.n_verticals = 0 and u.dept_code = 'sales'
          when 'subdept'          then u.subdept_id  is null and u.dept_code = 'back_office'
        end
)
select
  g.id                              as user_id,
  g.full_name,
  g.email,
  g.entity_code                     as entity,
  g.dept_code                       as department,
  g.permission_level,
  string_agg(g.attribute, ', ' order by g.attribute) as missing,
  g.location                        as legacy_location,

  -- Suggested, never auto-applied: `location` is already an outlet city.
  (select o.city from public.outlets o
    where o.entity_id = g.entity_id and o.city = g.location and o.is_active
    limit 1)                        as suggested_primary_outlet,

  -- What they CAN legally be given (brands actually sold at their entity).
  -- Karnal is hdh-only; Jind and Sirsa have no hdh; every PTB outlet is al-only.
  (select string_agg(distinct b.code, ';' order by b.code)
     from public.outlet_brands ob
     join public.outlets o on o.id = ob.outlet_id
     join public.brands  b on b.id = ob.brand_id
    where o.entity_id = g.entity_id) as brands_sold_at_entity,

  -- ⚠️ TRUE = giving this person `hdh` CREATES AN ERP ACCOUNT for them.
  -- Computed honestly: branch-less tiers (gm/sales) always resolve; a
  -- manager/executive must ALSO sit at a city the sync can map to an ERP branch,
  -- otherwise they enter scope and are skipped forever. NOTE: Jind is an active
  -- PT outlet that is NOT in the sync's BRANCH_BY_CITY map.
  (g.entity_code = 'PT'
   and g.dept_code in ('service','spares','accounts','sales')
   and (g.dept_code = 'sales'
        or g.permission_level = 'gm'
        or lower(coalesce((select o.city from public.outlets o where o.id = g.primary_outlet_id),
                          g.location, ''))
           in ('hisar','hissar','karnal','rohtak','charkhi dadri','dadri','sirsa'))
  )                                 as would_enter_erp_if_given_hdh,

  -- Owner fills these in:
  null::text as "-> primary_outlet",
  null::text as "-> brands (al;switch;hdh)",
  null::text as "-> sales_verticals (or N/A)",
  null::text as "-> subdept (or N/A)",
  null::text as "-> waiver_reason (if genuinely inapplicable)"
from gaps g
group by g.id, g.full_name, g.email, g.entity_code, g.dept_code,
         g.permission_level, g.location, g.entity_id, g.primary_outlet_id
order by g.entity_code, g.dept_code, g.full_name;


-- ───────────────────────────────────────────────────────────────────────────────
-- QUERY 3 — CROSS-REFERENCE INTEGRITY (pre-check for the composite FKs)
--
-- Every row returned here would BLOCK the corresponding constraint in the
-- schema-hardening step. Must be empty (or explained) before adding:
--   users_designation_in_department  (designation_id, department_id)
--   users_outlet_in_entity           (primary_outlet_id, entity_id)
-- ───────────────────────────────────────────────────────────────────────────────
select 'designation does not belong to department' as problem, u.id, u.full_name
  from public.users u join public.designations dg on dg.id = u.designation_id
 where dg.department_id is distinct from u.department_id
union all
select 'primary outlet does not belong to entity', u.id, u.full_name
  from public.users u join public.outlets o on o.id = u.primary_outlet_id
 where o.entity_id is distinct from u.entity_id
union all
select 'brand not sold at entity: ' || b.code, u.id, u.full_name
  from public.users u
  join public.user_brands ub on ub.user_id = u.id
  join public.brands b       on b.id = ub.brand_id
 where not exists (select 1 from public.outlet_brands ob
                     join public.outlets o on o.id = ob.outlet_id
                    where ob.brand_id = ub.brand_id and o.entity_id = u.entity_id)
union all
select 'sales vertical whose brand the user does not hold: ' || sv.code, u.id, u.full_name
  from public.users u
  join public.user_sales_verticals uv on uv.user_id = u.id
  join public.sales_verticals sv      on sv.id = uv.vertical_id
 where not exists (select 1 from public.user_brands ub
                    where ub.user_id = u.id and ub.brand_id = sv.brand_id)
union all
-- Catches the promoted-GM case: control hidden, value still submitted.
select 'subdept set but department is not back_office', u.id, u.full_name
  from public.users u left join public.departments d on d.id = u.department_id
 where u.subdept_id is not null and d.code is distinct from 'back_office'
union all
select 'holds a DEACTIVATED designation (unselectable in the form)', u.id, u.full_name
  from public.users u join public.designations dg on dg.id = u.designation_id
 where dg.is_active = false
union all
select 'residual user_outlets row (form no longer writes this table)', u.id, u.full_name
  from public.users u
 where exists (select 1 from public.user_outlets uo where uo.user_id = u.id)
order by 1, 3;


-- ───────────────────────────────────────────────────────────────────────────────
-- QUERY 4 — IDENTITY & ADMIN FACTS (needed before any constraint decision)
--
-- (a) EMAIL DRIFT. This is the one check that CANNOT become a PostgREST view:
--     it reads auth.users, which the invoker role has no grant on. Run via psql.
--     It matters because identity is split — sync-erp-users and erp-sso key on
--     the AUTH email, while the audit and the worklist read public.users.email.
--     Drift makes the worklist name a person by an address that identifies
--     nobody, and public.users.username is set once at create and never updated.
--
-- (b) THE ADMIN ROW. Confirms the singleton admin's actual entity/department, to
--     decide whether department_id can take a plain NOT NULL or needs the
--     `OR permission_level='admin'` carve-out.
--
-- (c) ⚠️ ERP SUPER-ADMIN EXPOSURE. Lists any portal user whose email matches a
--     hand-made ERP admin. The sync matches by EMAIL with no source filter, and
--     what currently protects those rows is precisely that they have no
--     department or no brand — which this whole project removes. Any name
--     appearing here must be excluded from the backfill until role_overridden
--     is set on the ERP side.
-- ───────────────────────────────────────────────────────────────────────────────
select 'EMAIL DRIFT: public.users.email <> auth.users.email' as fact,
       u.id::text, u.full_name, u.email as portal_users_email, au.email as auth_email
  from public.users u join auth.users au on au.id = u.id
 where lower(coalesce(u.email,'')) is distinct from lower(coalesce(au.email,''))
union all
select 'EMAIL MISSING on public.users', u.id::text, u.full_name, u.email, au.email
  from public.users u join auth.users au on au.id = u.id
 where u.email is null or btrim(u.email) = ''
union all
select 'ADMIN ROW (shape-exempt)', u.id::text, u.full_name,
       coalesce(e.code,'<NULL entity>'), coalesce(d.code,'<NULL department>')
  from public.users u
  left join public.entities e    on e.id = u.entity_id
  left join public.departments d on d.id = u.department_id
 where u.permission_level = 'admin'
union all
select '⚠️ ERP-ADMIN EMAIL PRESENT AS PORTAL USER — exclude from backfill',
       u.id::text, u.full_name, u.email, coalesce(d.code,'<NULL department>')
  from public.users u
  left join public.departments d on d.id = u.department_id
 where lower(u.email) in ('ceo@parastrucks.in','ceo.hr@parastrucks.in')
union all
select 'SUNIL (ERP local profile, role_overridden) — verify auth email matches',
       u.id::text, u.full_name, u.email, coalesce(d.code,'<NULL department>')
  from public.users u
  left join public.departments d on d.id = u.department_id
 where lower(u.email) = 'acparastrucks@gmail.com'
order by 1, 3;
