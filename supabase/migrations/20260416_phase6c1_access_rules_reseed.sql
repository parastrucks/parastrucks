-- Phase 6c.1 — access_rules 61-row re-seed
-- ============================================================
-- Wipes the 20 legacy `access_rules` rows (which encoded old 5-axis
-- nullable-wildcard semantics where the DB column `role` meant vertical
-- and `permission_level` meant today's users.role) and seeds the new
-- 4-axis model: permission_level × entity × department × designation.
--
-- Counts per route: 10 (/quotation) + 10 (/my-quotations) + 10 (/quotation-log)
--                 + 12 (/catalog) + 8 (/bus-calculator) + 3 (/employees)
--                 + 8 (/tiv-forecast)
--                 = 61 rows total.
--
-- New values for access_rules.permission_level: admin/gm/manager/executive.
-- The legacy text columns (brand, location, department, role) are left NULL
-- on every new row — they become dead fields read by nothing after this PR's
-- AuthContext update, and are dropped in Phase 6c.3 cleanup.
--
-- Admin bypass (permission_level='admin') lives in AuthContext.canAccess —
-- there are intentionally ZERO access_rules rows for /access-rules or any
-- `admin` tier. This is the escape hatch that prevents the admin from
-- locking themselves out by deleting their own rule.
--
-- Safe to apply: only one user (the admin) exists in prod post-Stage-0 purge,
-- and admin bypasses rule evaluation entirely. No non-admin traffic is gated
-- by this table until HR Manager onboarding lands in a subsequent PR.

begin;

-- 1. Clear legacy rules
delete from public.access_rules;

-- 2. Seed 61 rules via a lateral lookup CTE so each row references ref-table
--    ids by code rather than hard-coded UUIDs.
with refs as (
  select
    (select id from public.entities    where code = 'PT')          as pt_id,
    (select id from public.entities    where code = 'PTB')         as ptb_id,
    (select id from public.departments where code = 'sales')       as sales_id,
    (select id from public.departments where code = 'back_office') as bo_id,
    (select id from public.departments where code = 'hr')          as hr_id
),
rows(route, tier, entity, dept) as (values
  -- /quotation (10) — Sales (3 tiers) × 2 entities + Back Office (2 tiers) × 2 entities
  ('/quotation',     'executive', 'PT',  'sales'),
  ('/quotation',     'manager',   'PT',  'sales'),
  ('/quotation',     'gm',        'PT',  'sales'),
  ('/quotation',     'executive', 'PTB', 'sales'),
  ('/quotation',     'manager',   'PTB', 'sales'),
  ('/quotation',     'gm',        'PTB', 'sales'),
  ('/quotation',     'executive', 'PT',  'back_office'),
  ('/quotation',     'manager',   'PT',  'back_office'),
  ('/quotation',     'executive', 'PTB', 'back_office'),
  ('/quotation',     'manager',   'PTB', 'back_office'),

  -- /my-quotations (10) — identical gate to /quotation; DSE-own-rows filter lives in RLS
  ('/my-quotations', 'executive', 'PT',  'sales'),
  ('/my-quotations', 'manager',   'PT',  'sales'),
  ('/my-quotations', 'gm',        'PT',  'sales'),
  ('/my-quotations', 'executive', 'PTB', 'sales'),
  ('/my-quotations', 'manager',   'PTB', 'sales'),
  ('/my-quotations', 'gm',        'PTB', 'sales'),
  ('/my-quotations', 'executive', 'PT',  'back_office'),
  ('/my-quotations', 'manager',   'PT',  'back_office'),
  ('/my-quotations', 'executive', 'PTB', 'back_office'),
  ('/my-quotations', 'manager',   'PTB', 'back_office'),

  -- /quotation-log (10) — DSE excluded (Sales manager+gm only); BO all tiers
  ('/quotation-log', 'manager',   'PT',  'sales'),
  ('/quotation-log', 'gm',        'PT',  'sales'),
  ('/quotation-log', 'manager',   'PTB', 'sales'),
  ('/quotation-log', 'gm',        'PTB', 'sales'),
  ('/quotation-log', 'executive', 'PT',  'back_office'),
  ('/quotation-log', 'manager',   'PT',  'back_office'),
  ('/quotation-log', 'gm',        'PT',  'back_office'),
  ('/quotation-log', 'executive', 'PTB', 'back_office'),
  ('/quotation-log', 'manager',   'PTB', 'back_office'),
  ('/quotation-log', 'gm',        'PTB', 'back_office'),

  -- /catalog (12) — Sales read (RLS enforces user_brands ∩ user_sales_verticals);
  --                Back Office CRUD (RLS enforces user_brands)
  ('/catalog',       'executive', 'PT',  'sales'),
  ('/catalog',       'manager',   'PT',  'sales'),
  ('/catalog',       'gm',        'PT',  'sales'),
  ('/catalog',       'executive', 'PTB', 'sales'),
  ('/catalog',       'manager',   'PTB', 'sales'),
  ('/catalog',       'gm',        'PTB', 'sales'),
  ('/catalog',       'executive', 'PT',  'back_office'),
  ('/catalog',       'manager',   'PT',  'back_office'),
  ('/catalog',       'gm',        'PT',  'back_office'),
  ('/catalog',       'executive', 'PTB', 'back_office'),
  ('/catalog',       'manager',   'PTB', 'back_office'),
  ('/catalog',       'gm',        'PTB', 'back_office'),

  -- /bus-calculator (8) — Sales (all tiers) × 2 entities + BO executive × 2 entities
  ('/bus-calculator','executive', 'PT',  'sales'),
  ('/bus-calculator','manager',   'PT',  'sales'),
  ('/bus-calculator','gm',        'PT',  'sales'),
  ('/bus-calculator','executive', 'PTB', 'sales'),
  ('/bus-calculator','manager',   'PTB', 'sales'),
  ('/bus-calculator','gm',        'PTB', 'sales'),
  ('/bus-calculator','executive', 'PT',  'back_office'),
  ('/bus-calculator','executive', 'PTB', 'back_office'),

  -- /employees (3) — HR only (own entity). PTB-HR-Manager not seeded until staffed.
  ('/employees',     'executive', 'PT',  'hr'),
  ('/employees',     'manager',   'PT',  'hr'),
  ('/employees',     'executive', 'PTB', 'hr'),

  -- /tiv-forecast (8) — GM Sales + GM/Mgr/Exec BO × 2 entities. PT seeded for future-readiness.
  ('/tiv-forecast',  'gm',        'PT',  'sales'),
  ('/tiv-forecast',  'gm',        'PTB', 'sales'),
  ('/tiv-forecast',  'gm',        'PT',  'back_office'),
  ('/tiv-forecast',  'gm',        'PTB', 'back_office'),
  ('/tiv-forecast',  'manager',   'PT',  'back_office'),
  ('/tiv-forecast',  'manager',   'PTB', 'back_office'),
  ('/tiv-forecast',  'executive', 'PT',  'back_office'),
  ('/tiv-forecast',  'executive', 'PTB', 'back_office')
)
insert into public.access_rules (route, permission_level, entity_id, department_id, designation_id)
select
  r.route,
  r.tier,
  case r.entity when 'PT'  then refs.pt_id  when 'PTB' then refs.ptb_id end,
  case r.dept
    when 'sales'       then refs.sales_id
    when 'back_office' then refs.bo_id
    when 'hr'          then refs.hr_id
  end,
  null::uuid  -- no current rule constrains to a specific designation; NULL = any
from rows r cross join refs;

-- 3. Post-seed invariants — fail loudly if counts drift
do $$
declare
  n_total int;
  n_quotation int;
  n_my_quotations int;
  n_quotation_log int;
  n_catalog int;
  n_bus_calc int;
  n_employees int;
  n_tiv int;
  n_null_entity int;
  n_null_dept int;
  n_bad_tier int;
begin
  select count(*) into n_total         from public.access_rules;
  select count(*) into n_quotation     from public.access_rules where route = '/quotation';
  select count(*) into n_my_quotations from public.access_rules where route = '/my-quotations';
  select count(*) into n_quotation_log from public.access_rules where route = '/quotation-log';
  select count(*) into n_catalog       from public.access_rules where route = '/catalog';
  select count(*) into n_bus_calc      from public.access_rules where route = '/bus-calculator';
  select count(*) into n_employees     from public.access_rules where route = '/employees';
  select count(*) into n_tiv           from public.access_rules where route = '/tiv-forecast';
  select count(*) into n_null_entity   from public.access_rules where entity_id is null;
  select count(*) into n_null_dept     from public.access_rules where department_id is null;
  select count(*) into n_bad_tier      from public.access_rules
    where permission_level not in ('admin','gm','manager','executive');

  if n_total         <> 61 then raise exception 'Expected 61 rules total, got %',            n_total;         end if;
  if n_quotation     <> 10 then raise exception 'Expected 10 /quotation rules, got %',        n_quotation;     end if;
  if n_my_quotations <> 10 then raise exception 'Expected 10 /my-quotations rules, got %',    n_my_quotations; end if;
  if n_quotation_log <> 10 then raise exception 'Expected 10 /quotation-log rules, got %',    n_quotation_log; end if;
  if n_catalog       <> 12 then raise exception 'Expected 12 /catalog rules, got %',          n_catalog;       end if;
  if n_bus_calc      <>  8 then raise exception 'Expected 8 /bus-calculator rules, got %',    n_bus_calc;      end if;
  if n_employees     <>  3 then raise exception 'Expected 3 /employees rules, got %',         n_employees;     end if;
  if n_tiv           <>  8 then raise exception 'Expected 8 /tiv-forecast rules, got %',      n_tiv;           end if;
  if n_null_entity   <>  0 then raise exception '% rules have NULL entity_id',                n_null_entity;   end if;
  if n_null_dept     <>  0 then raise exception '% rules have NULL department_id',            n_null_dept;     end if;
  if n_bad_tier      <>  0 then raise exception '% rules have unknown permission_level',      n_bad_tier;      end if;
end $$;

commit;
