-- Phase 6b Stage 1 — Additive migration
-- ============================================================
-- Adds reference-table UUID keys, new tables (outlets, outlet_brands,
-- sales_verticals, back_office_subdepts, designations, user_brands,
-- user_sales_verticals, user_outlets, user_profiles), additive columns
-- on users / access_rules / quotations / vehicle_catalog / tiv_forecast_*,
-- and the singleton-admin partial unique index.
--
-- Strictly additive — no drops, no renames of FK-referenced objects.
-- Existing CHECK constraints (users_role_check, users_entity_check) remain
-- authoritative through Stage 1; AuthContext.ruleMatches still reads OLD
-- columns (users.role, users.vertical, etc.). Stage 2 switches the app
-- over; Stage 4 drops the legacy columns.
--
-- One-shot migration — re-running will fail on duplicate CREATE TABLE /
-- CREATE POLICY. All ADD COLUMNs use IF NOT EXISTS for partial recovery
-- safety, but the full file is expected to apply exactly once.

------------------------------------------------------------------------
-- SECTION 1. Reference tables — UUID ids, new columns, new ref tables
------------------------------------------------------------------------

-- 1.1 entities: add UUID id + optional GM pointers (nullable FK → users)
alter table public.entities
  add column if not exists id                    uuid not null unique default gen_random_uuid();
alter table public.entities
  add column if not exists gm_service_user_id    uuid references public.users(id) on delete set null;
alter table public.entities
  add column if not exists gm_spares_user_id     uuid references public.users(id) on delete set null;
alter table public.entities
  add column if not exists gm_backoffice_user_id uuid references public.users(id) on delete set null;

-- 1.2 brands: add UUID id (brand stays globally-coded in Stage 1 —
--     entity ownership modelled via user_brands + users.entity_id)
alter table public.brands
  add column if not exists id uuid not null unique default gen_random_uuid();

-- 1.3 departments: add UUID id + code; rename Spare Parts → Spares;
--     mark Admin inactive; insert Back Office + PDI
alter table public.departments
  add column if not exists id   uuid not null unique default gen_random_uuid();
alter table public.departments
  add column if not exists code text;

update public.departments set name = 'Spares'    where name = 'Spare Parts';
update public.departments set is_active = false  where name = 'Admin';

update public.departments set code = case name
  when 'HR'          then 'hr'
  when 'Admin'       then 'admin'
  when 'Service'     then 'service'
  when 'Spares'      then 'spares'
  when 'Sales'       then 'sales'
  when 'Accounts'    then 'accounts'
end
where code is null;

insert into public.departments (name, is_active, code) values
  ('Back Office', true, 'back_office'),
  ('PDI',         true, 'pdi')
on conflict (name) do nothing;

alter table public.departments alter column code set not null;
alter table public.departments add constraint departments_code_key unique (code);

-- 1.4 outlets — 8 physical facilities
create table public.outlets (
  id            uuid primary key default gen_random_uuid(),
  entity_id     uuid not null references public.entities(id) on delete restrict,
  city          text not null,
  state         text not null,
  label         text not null,
  facility_type text not null check (facility_type in ('3S','2S')),
  is_active     boolean not null default true,
  unique (entity_id, city)
);

insert into public.outlets (entity_id, city, state, label, facility_type) values
  ((select id from public.entities where code='PTB'), 'Ahmedabad',     'Gujarat', 'Ahmedabad',     '3S'),
  ((select id from public.entities where code='PTB'), 'Anand',         'Gujarat', 'Anand',         '3S'),
  ((select id from public.entities where code='PT'),  'Charkhi Dadri', 'Haryana', 'Charkhi Dadri', '3S'),
  ((select id from public.entities where code='PT'),  'Hisar',         'Haryana', 'Hisar',         '3S'),
  ((select id from public.entities where code='PT'),  'Jind',          'Haryana', 'Jind',          '3S'),
  ((select id from public.entities where code='PT'),  'Karnal',        'Haryana', 'Karnal',        '2S'),
  ((select id from public.entities where code='PT'),  'Rohtak',        'Haryana', 'Rohtak',        '3S'),
  ((select id from public.entities where code='PT'),  'Sirsa',         'Haryana', 'Sirsa',         '3S');

-- 1.5 outlet_brands — mirror operating_units (16 rows)
create table public.outlet_brands (
  outlet_id uuid not null references public.outlets(id) on delete cascade,
  brand_id  uuid not null references public.brands(id)  on delete cascade,
  primary key (outlet_id, brand_id)
);

insert into public.outlet_brands (outlet_id, brand_id)
select o.id, b.id
from public.operating_units ou
join public.outlets o
  on o.city      = ou.location
 and o.entity_id = (select id from public.entities where code = ou.entity_code)
join public.brands b
  on b.code = ou.brand
where ou.is_active = true
on conflict do nothing;

-- 1.6 sales_verticals — 8 rows (AL 5, HDH 2, Switch 1)
create table public.sales_verticals (
  id        uuid primary key default gen_random_uuid(),
  brand_id  uuid not null references public.brands(id) on delete cascade,
  code      text not null,
  name      text not null,
  is_active boolean not null default true,
  unique (brand_id, code)
);

insert into public.sales_verticals (brand_id, code, name) values
  ((select id from public.brands where code='al'),     'long_haulage', 'Long Haulage'),
  ((select id from public.brands where code='al'),     'tipper',       'Tipper'),
  ((select id from public.brands where code='al'),     'icv_trucks',   'ICV Trucks'),
  ((select id from public.brands where code='al'),     'buses',        'Buses'),
  ((select id from public.brands where code='al'),     'lcv_trucks',   'LCV Trucks'),
  ((select id from public.brands where code='hdh'),    'excavators',   'Excavators'),
  ((select id from public.brands where code='hdh'),    'backhoe',      'Backhoe Loader'),
  ((select id from public.brands where code='switch'), 'elcv',         'eLCV');

-- 1.7 back_office_subdepts — 3 rows
create table public.back_office_subdepts (
  id        uuid primary key default gen_random_uuid(),
  code      text not null unique,
  name      text not null,
  is_active boolean not null default true
);

insert into public.back_office_subdepts (code, name) values
  ('edp', 'EDP'),
  ('rto', 'RTO'),
  ('crm', 'CRM');

-- 1.8 designations — 33 rows
create table public.designations (
  id                      uuid primary key default gen_random_uuid(),
  department_id           uuid not null references public.departments(id) on delete restrict,
  code                    text not null,
  name                    text not null,
  default_permission_tier text not null check (default_permission_tier in ('gm','manager','executive')),
  is_active               boolean not null default true,
  unique (department_id, code)
);

insert into public.designations (department_id, code, name, default_permission_tier) values
  -- Sales (3)
  ((select id from public.departments where code='sales'),       'gm_sales',           'GM Sales',          'gm'),
  ((select id from public.departments where code='sales'),       'dsm',                'DSM',               'manager'),
  ((select id from public.departments where code='sales'),       'dse',                'DSE',               'executive'),
  -- Service (14)
  ((select id from public.departments where code='service'),     'gm_service',         'GM Service',        'gm'),
  ((select id from public.departments where code='service'),     'wm',                 'WM',                'manager'),
  ((select id from public.departments where code='service'),     'awm',                'AWM',               'executive'),
  ((select id from public.departments where code='service'),     'ta',                 'TA',                'executive'),
  ((select id from public.departments where code='service'),     'sa',                 'SA',                'executive'),
  ((select id from public.departments where code='service'),     'fs',                 'FS',                'executive'),
  ((select id from public.departments where code='service'),     'breakdown_incharge', 'Breakdown Incharge','executive'),
  ((select id from public.departments where code='service'),     'dbmo',               'DBMO',              'executive'),
  ((select id from public.departments where code='service'),     'foreman',            'Foreman',           'executive'),
  ((select id from public.departments where code='service'),     'mechanic',           'Mechanic',          'executive'),
  ((select id from public.departments where code='service'),     'helper',             'Helper',            'executive'),
  ((select id from public.departments where code='service'),     'electrician',        'Electrician',       'executive'),
  ((select id from public.departments where code='service'),     'bodyshop_manager',   'Bodyshop Manager',  'executive'),
  ((select id from public.departments where code='service'),     'bodyshop_mechanic',  'Bodyshop Mechanic', 'executive'),
  -- Spares (4)
  ((select id from public.departments where code='spares'),      'gm_spares',          'GM Spares',         'gm'),
  ((select id from public.departments where code='spares'),      'spm',                'SPM',               'manager'),
  ((select id from public.departments where code='spares'),      'spe',                'SPE',               'executive'),
  ((select id from public.departments where code='spares'),      'picker',             'Picker',            'executive'),
  -- Back Office (3)
  ((select id from public.departments where code='back_office'), 'gm_back_office',     'GM Back Office',    'gm'),
  ((select id from public.departments where code='back_office'), 'manager',            'Manager',           'manager'),
  ((select id from public.departments where code='back_office'), 'executive',          'Executive',         'executive'),
  -- Accounts (2)
  ((select id from public.departments where code='accounts'),    'manager',            'Manager',           'manager'),
  ((select id from public.departments where code='accounts'),    'executive',          'Executive',         'executive'),
  -- HR (2)
  ((select id from public.departments where code='hr'),          'manager',            'Manager',           'manager'),
  ((select id from public.departments where code='hr'),          'executive',          'Executive',         'executive'),
  -- PDI (5)
  ((select id from public.departments where code='pdi'),         'manager',            'Manager',           'manager'),
  ((select id from public.departments where code='pdi'),         'driver',             'Driver',            'executive'),
  ((select id from public.departments where code='pdi'),         'mechanic',           'Mechanic',          'executive'),
  ((select id from public.departments where code='pdi'),         'washer',             'Washer',            'executive'),
  ((select id from public.departments where code='pdi'),         'dbmo',               'DBMO',              'executive');

-- 1.9 RLS on new reference tables — read-any-authenticated,
--     write-admin/back_office (same pattern as other ref tables)
alter table public.outlets              enable row level security;
alter table public.outlet_brands        enable row level security;
alter table public.sales_verticals      enable row level security;
alter table public.back_office_subdepts enable row level security;
alter table public.designations         enable row level security;

create policy outlets_select_all    on public.outlets              for select to authenticated using (true);
create policy outlets_write         on public.outlets              for all    to authenticated
  using      (public.current_user_role() = any (array['admin','back_office']))
  with check (public.current_user_role() = any (array['admin','back_office']));

create policy ob_select_all         on public.outlet_brands        for select to authenticated using (true);
create policy ob_write              on public.outlet_brands        for all    to authenticated
  using      (public.current_user_role() = any (array['admin','back_office']))
  with check (public.current_user_role() = any (array['admin','back_office']));

create policy sv_select_all         on public.sales_verticals      for select to authenticated using (true);
create policy sv_write              on public.sales_verticals      for all    to authenticated
  using      (public.current_user_role() = any (array['admin','back_office']))
  with check (public.current_user_role() = any (array['admin','back_office']));

create policy bos_select_all        on public.back_office_subdepts for select to authenticated using (true);
create policy bos_write             on public.back_office_subdepts for all    to authenticated
  using      (public.current_user_role() = any (array['admin','back_office']))
  with check (public.current_user_role() = any (array['admin','back_office']));

create policy desig_select_all      on public.designations         for select to authenticated using (true);
create policy desig_write           on public.designations         for all    to authenticated
  using      (public.current_user_role() = any (array['admin','back_office']))
  with check (public.current_user_role() = any (array['admin','back_office']));

------------------------------------------------------------------------
-- SECTION 2. users — additive columns + admin backfill + singleton index
------------------------------------------------------------------------

alter table public.users
  add column if not exists permission_level  text,
  add column if not exists entity_id         uuid references public.entities(id)             on delete restrict,
  add column if not exists department_id     uuid references public.departments(id)          on delete restrict,
  add column if not exists designation_id    uuid references public.designations(id)         on delete restrict,
  add column if not exists primary_outlet_id uuid references public.outlets(id)              on delete restrict,
  add column if not exists subdept_id        uuid references public.back_office_subdepts(id) on delete restrict;

alter table public.users
  add constraint users_permission_level_check
  check (permission_level is null or permission_level in ('admin','gm','manager','executive'));

-- Backfill admin's permission_level (other non-admin users were purged in Stage 0)
update public.users
   set permission_level = 'admin'
 where role = 'admin';

-- Singleton-admin partial unique index
create unique index users_single_admin
  on public.users (permission_level)
  where permission_level = 'admin' and is_active = true;

------------------------------------------------------------------------
-- SECTION 3. Empty join tables — populated during Stage 2 onboarding
------------------------------------------------------------------------

create table public.user_brands (
  user_id  uuid not null references public.users(id)  on delete cascade,
  brand_id uuid not null references public.brands(id) on delete restrict,
  primary key (user_id, brand_id)
);

create table public.user_sales_verticals (
  user_id     uuid not null references public.users(id)           on delete cascade,
  vertical_id uuid not null references public.sales_verticals(id) on delete restrict,
  primary key (user_id, vertical_id)
);

create table public.user_outlets (
  user_id   uuid not null references public.users(id)   on delete cascade,
  outlet_id uuid not null references public.outlets(id) on delete restrict,
  primary key (user_id, outlet_id)
);

create table public.user_profiles (
  user_id              uuid primary key references public.users(id) on delete cascade,
  dob                  date,
  joining_date         date,
  aadhar_number        text,
  pan_number           text,
  blood_group          text,
  emergency_contact    text,
  permanent_address    text,
  current_address      text,
  bank_account_number  text,
  bank_ifsc            text,
  bank_name            text,
  personal_email       text,
  personal_phone       text,
  created_at           timestamptz not null default now(),
  updated_at           timestamptz not null default now()
);

create trigger user_profiles_updated_at
  before update on public.user_profiles
  for each row execute function public.set_updated_at();

-- RLS — provisional Stage 1 policies (refined in Stage 2 with new tiers)
alter table public.user_brands          enable row level security;
alter table public.user_sales_verticals enable row level security;
alter table public.user_outlets         enable row level security;
alter table public.user_profiles        enable row level security;

create policy ub_select_self_or_privileged  on public.user_brands for select to authenticated
  using (user_id = auth.uid() or public.current_user_role() = any (array['admin','hr','back_office']));
create policy ub_write_privileged           on public.user_brands for all    to authenticated
  using      (public.current_user_role() = any (array['admin','hr','back_office']))
  with check (public.current_user_role() = any (array['admin','hr','back_office']));

create policy usv_select_self_or_privileged on public.user_sales_verticals for select to authenticated
  using (user_id = auth.uid() or public.current_user_role() = any (array['admin','hr','back_office']));
create policy usv_write_privileged          on public.user_sales_verticals for all    to authenticated
  using      (public.current_user_role() = any (array['admin','hr','back_office']))
  with check (public.current_user_role() = any (array['admin','hr','back_office']));

create policy uo_select_self_or_privileged  on public.user_outlets for select to authenticated
  using (user_id = auth.uid() or public.current_user_role() = any (array['admin','hr','back_office']));
create policy uo_write_privileged           on public.user_outlets for all    to authenticated
  using      (public.current_user_role() = any (array['admin','hr','back_office']))
  with check (public.current_user_role() = any (array['admin','hr','back_office']));

create policy up_select_self_or_hr on public.user_profiles for select to authenticated
  using (user_id = auth.uid() or public.current_user_role() = any (array['admin','hr']));
create policy up_write_hr          on public.user_profiles for all    to authenticated
  using      (public.current_user_role() = any (array['admin','hr']))
  with check (public.current_user_role() = any (array['admin','hr']));

------------------------------------------------------------------------
-- SECTION 4. access_rules — additive columns (nullable through Stage 1)
------------------------------------------------------------------------

alter table public.access_rules
  add column if not exists entity_id      uuid references public.entities(id)     on delete cascade,
  add column if not exists department_id  uuid references public.departments(id)  on delete cascade,
  add column if not exists designation_id uuid references public.designations(id) on delete set null;

------------------------------------------------------------------------
-- SECTION 5. quotations — brand_id NOT NULL (after backfill)
------------------------------------------------------------------------

alter table public.quotations
  add column if not exists brand_id uuid references public.brands(id) on delete restrict;

-- Backfill: all 12 quotations are admin-created PTB quotes for AL (only AL
-- is sold at PTB; brand_id=al is unambiguous here).
update public.quotations
   set brand_id = (select id from public.brands where code = 'al')
 where brand_id is null;

alter table public.quotations alter column brand_id set not null;

------------------------------------------------------------------------
-- SECTION 6. vehicle_catalog — brand_id NOT NULL + sales_vertical_id
------------------------------------------------------------------------

alter table public.vehicle_catalog
  add column if not exists brand_id          uuid references public.brands(id)          on delete restrict,
  add column if not exists sales_vertical_id uuid references public.sales_verticals(id) on delete set null;

-- Backfill brand_id from existing text `brand` column (all 906 rows are 'al')
update public.vehicle_catalog vc
   set brand_id = b.id
  from public.brands b
 where b.code = vc.brand
   and vc.brand_id is null;

alter table public.vehicle_catalog alter column brand_id set not null;

-- Backfill sales_vertical_id via VERTICAL_SEGMENTS mapping (AL brand)
update public.vehicle_catalog vc
   set sales_vertical_id = sv.id
  from public.sales_verticals sv
  join public.brands b on b.id = sv.brand_id and b.code = 'al'
 where vc.sales_vertical_id is null
   and (
        (sv.code = 'buses'        and vc.segment in ('Bus – ICV','Bus – MCV')) or
        (sv.code = 'tipper'       and vc.segment in ('Tipper','RMC / Boom Pump')) or
        (sv.code = 'icv_trucks'   and vc.segment = 'ICV Truck') or
        (sv.code = 'long_haulage' and vc.segment = 'MBP Truck')
       );

------------------------------------------------------------------------
-- SECTION 7. tiv_forecast_* — entity_id + brand_id on 7 core tables
------------------------------------------------------------------------
-- Skipped: tiv_forecast_trigger_state (per-user state) and
-- tiv_forecast_upload_history (audit log — user-scoped, no brand/entity
-- semantics). These stay as-is.

do $$
declare
  t      text;
  ptb_id uuid;
  al_id  uuid;
begin
  select id into ptb_id from public.entities where code = 'PTB';
  select id into al_id  from public.brands   where code = 'al';

  foreach t in array array[
    'tiv_forecast_tiv_actuals',
    'tiv_forecast_ptb_actuals',
    'tiv_forecast_al_actuals',
    'tiv_forecast_judgment_tiv',
    'tiv_forecast_judgment_ptb',
    'tiv_forecast_raw_data',
    'tiv_forecast_model_params'
  ]
  loop
    execute format('alter table public.%I add column if not exists entity_id uuid references public.entities(id) on delete restrict', t);
    execute format('alter table public.%I add column if not exists brand_id  uuid references public.brands(id)   on delete restrict', t);
    execute format('update public.%I set entity_id = %L, brand_id = %L where entity_id is null or brand_id is null', t, ptb_id, al_id);
    execute format('alter table public.%I alter column entity_id set not null', t);
    execute format('alter table public.%I alter column brand_id  set not null', t);
  end loop;
end $$;
