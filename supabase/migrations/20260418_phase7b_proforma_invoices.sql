-- Phase 7b: Proforma Invoice — table, numbering RPC, RLS, access rules
-- ============================================================
-- One PI = one physical vehicle (chassis_no + engine_no). Qty always 1.
-- Numbering: PI-PTB-2026-0001 (prefix + entity code + calendar year + 4-digit seq).
-- Separate counter per entity; does NOT share serial_counter with quotations.
-- RLS mirrors Phase 6c quotations policies 1:1 (admin bypass, own-row, entity+brand).
-- Access: Back Office only (no Sales). 18 rows added (3 routes × 3 tiers × 2 entities).

begin;

-- ── 1. PI counter columns on entities ─────────────────────────────────────
-- Kept separate from serial_counter + fy_start (which belong to quotation numbering).
alter table public.entities
  add column if not exists pi_serial_counter integer not null default 0,
  add column if not exists pi_counter_year   integer not null default 0;

-- ── 2. proforma_invoices table ────────────────────────────────────────────
create table if not exists public.proforma_invoices (
  id               uuid        primary key default gen_random_uuid(),
  pi_number        text        unique not null,
  entity_id        uuid        not null references public.entities(id) on delete restrict,
  brand_id         uuid        not null references public.brands(id)   on delete restrict,
  created_by       uuid        not null references public.users(id)    on delete restrict,
  chassis_no       text        not null,
  engine_no        text        not null,
  customer_name    text        not null,
  customer_address text,
  customer_mobile  text,
  customer_gstin   text,
  hypothecation    text,
  valid_until      date,
  line_items       jsonb       not null default '[]'::jsonb,
  tcs_rate         numeric(5,2) not null default 1,
  tcs_amount       integer,
  rto_tax          integer,
  insurance        integer,
  grand_total      integer,
  created_at       timestamptz not null default now()
);

-- ── 3. RLS ────────────────────────────────────────────────────────────────
alter table public.proforma_invoices enable row level security;

create policy proforma_invoices_select on public.proforma_invoices
  for select to authenticated
  using (
    public.current_user_role() = 'admin'
    or created_by = auth.uid()
    or (
      proforma_invoices.entity_id = (select entity_id from public.users where id = auth.uid())
      and public.has_user_brand(proforma_invoices.brand_id)
    )
  );

-- INSERT restricted to admin + back_office (no Sales access to proformas)
create policy proforma_invoices_insert on public.proforma_invoices
  for insert to authenticated
  with check (
    created_by = auth.uid()
    and public.current_user_role() in ('admin', 'back_office')
  );

create policy proforma_invoices_update on public.proforma_invoices
  for update to authenticated
  using      (public.current_user_role() = 'admin')
  with check (public.current_user_role() = 'admin');

create policy proforma_invoices_delete on public.proforma_invoices
  for delete to authenticated
  using (public.current_user_role() = 'admin');

-- ── 4. next_proforma_number(p_entity_id uuid) ────────────────────────────
-- Uses calendar year (not FY) — PIs are point-in-time documents.
-- Format: PI-{entityCode}-{calendarYear}-{0001}
create or replace function public.next_proforma_number(p_entity_id uuid)
returns text language plpgsql security definer set search_path = public as $$
declare
  v_counter integer;
  v_year    integer;
  v_code    text;
begin
  v_year := extract(year from now())::integer;

  update public.entities
  set pi_serial_counter = case
                            when pi_counter_year = v_year then pi_serial_counter + 1
                            else 1
                          end,
      pi_counter_year   = v_year
  where id = p_entity_id
  returning pi_serial_counter, code into v_counter, v_code;

  if not found then
    raise exception 'Entity % not found', p_entity_id;
  end if;

  return 'PI-' || v_code || '-' || v_year::text || '-' || lpad(v_counter::text, 4, '0');
end;
$$;

-- ── 5. access_rules — proforma routes (BO only, 3 tiers × 2 entities) ────
-- /proforma-invoice: 6, /my-proformas: 6, /proforma-log: 6 = 18 new rows.
-- Total access_rules after: 62 + 18 = 80 rows.
with refs as (
  select
    (select id from public.entities    where code = 'PT')          as pt_id,
    (select id from public.entities    where code = 'PTB')         as ptb_id,
    (select id from public.departments where code = 'back_office') as bo_id
),
new_rows(route, tier, entity) as (values
  ('/proforma-invoice', 'executive', 'PT'),
  ('/proforma-invoice', 'manager',   'PT'),
  ('/proforma-invoice', 'gm',        'PT'),
  ('/proforma-invoice', 'executive', 'PTB'),
  ('/proforma-invoice', 'manager',   'PTB'),
  ('/proforma-invoice', 'gm',        'PTB'),

  ('/my-proformas',     'executive', 'PT'),
  ('/my-proformas',     'manager',   'PT'),
  ('/my-proformas',     'gm',        'PT'),
  ('/my-proformas',     'executive', 'PTB'),
  ('/my-proformas',     'manager',   'PTB'),
  ('/my-proformas',     'gm',        'PTB'),

  ('/proforma-log',     'executive', 'PT'),
  ('/proforma-log',     'manager',   'PT'),
  ('/proforma-log',     'gm',        'PT'),
  ('/proforma-log',     'executive', 'PTB'),
  ('/proforma-log',     'manager',   'PTB'),
  ('/proforma-log',     'gm',        'PTB')
)
insert into public.access_rules (route, permission_level, entity_id, department_id, designation_id)
select
  r.route,
  r.tier,
  case r.entity when 'PT' then refs.pt_id when 'PTB' then refs.ptb_id end,
  refs.bo_id,
  null::uuid
from new_rows r cross join refs;

-- ── 6. Post-seed invariants ───────────────────────────────────────────────
do $$
declare
  n_pi_invoice int;
  n_my_proformas int;
  n_pi_log int;
begin
  select count(*) into n_pi_invoice  from public.access_rules where route = '/proforma-invoice';
  select count(*) into n_my_proformas from public.access_rules where route = '/my-proformas';
  select count(*) into n_pi_log      from public.access_rules where route = '/proforma-log';

  if n_pi_invoice  != 6 then raise exception '/proforma-invoice expected 6 rows, got %', n_pi_invoice;  end if;
  if n_my_proformas != 6 then raise exception '/my-proformas expected 6 rows, got %', n_my_proformas;   end if;
  if n_pi_log      != 6 then raise exception '/proforma-log expected 6 rows, got %',   n_pi_log;        end if;
end $$;

commit;
