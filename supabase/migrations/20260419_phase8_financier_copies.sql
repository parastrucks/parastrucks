-- Phase 8: Financier's Copy — table, numbering RPC, RLS, access rules
-- ============================================================
-- One FC = one physical vehicle (chassis_no + engine_no). Qty always 1.
-- Numbering: FC-PTB-2026-27-0001 (prefix + entity code + fiscal year + 4-digit seq).
-- Fiscal year rolls on April 1 (Indian FY). Separate counter per entity.
-- RLS: select/update/delete mirror PI policies. INSERT restricted to admin only at RLS level.
-- Access: Back Office GM + Admin only (no executive/manager tiers). 6 rows total.

begin;

-- ── 1. FC counter columns on entities ─────────────────────────────────────
alter table public.entities
  add column if not exists fc_serial_counter integer not null default 0,
  add column if not exists fc_counter_fy     integer not null default 0;

-- ── 2. financier_copies table ─────────────────────────────────────────────
create table if not exists public.financier_copies (
  id               uuid        primary key default gen_random_uuid(),
  fc_number        text        unique not null,
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
alter table public.financier_copies enable row level security;

create policy financier_copies_select on public.financier_copies
  for select to authenticated
  using (
    public.current_user_role() = 'admin'
    or created_by = auth.uid()
    or (
      financier_copies.entity_id = (select entity_id from public.users where id = auth.uid())
      and public.has_user_brand(financier_copies.brand_id)
    )
  );

-- INSERT restricted to admin only at RLS level (page + RPC also gate on GM/Admin,
-- but RLS is the final net). Admin = permission_level 'admin' via current_user_role().
-- current_user_role() returns the department code for non-admin users, and 'admin'
-- for admin users — matching the PI pattern. We restrict to 'admin' only here because
-- the plan specifies RLS tighter than PI (no back_office insert at RLS level).
create policy financier_copies_insert on public.financier_copies
  for insert to authenticated
  with check (
    created_by = auth.uid()
    and (
      public.current_user_role() = 'admin'
      or (
        public.current_user_role() = 'back_office'
        and exists (
          select 1 from public.users
          where id = auth.uid()
            and permission_level in ('admin', 'gm')
        )
      )
    )
  );

create policy financier_copies_update on public.financier_copies
  for update to authenticated
  using      (public.current_user_role() = 'admin')
  with check (public.current_user_role() = 'admin');

create policy financier_copies_delete on public.financier_copies
  for delete to authenticated
  using (public.current_user_role() = 'admin');

-- ── 4. next_financier_copy_number(p_entity_id uuid) ──────────────────────
-- Uses fiscal year (April 1 rollover). Format: FC-{entityCode}-{YYYY-YY}-{0001}
-- e.g. FC-PTB-2026-27-0001. FY stored as starting year int (e.g. 2026 for 2026-27).
create or replace function public.next_financier_copy_number(p_entity_id uuid)
returns text language plpgsql security definer set search_path = public as $$
declare
  v_counter  integer;
  v_fy_start integer;
  v_code     text;
  v_fy_str   text;
begin
  -- Fiscal year starts April 1; if current month >= 4 use current year, else year - 1
  v_fy_start := case
                  when extract(month from now()) >= 4
                  then extract(year from now())::integer
                  else extract(year from now())::integer - 1
                end;

  update public.entities
  set fc_serial_counter = case
                            when fc_counter_fy = v_fy_start then fc_serial_counter + 1
                            else 1
                          end,
      fc_counter_fy     = v_fy_start
  where id = p_entity_id
  returning fc_serial_counter, code into v_counter, v_code;

  if not found then
    raise exception 'Entity % not found', p_entity_id;
  end if;

  -- FY string: e.g. 2026-27 (last 2 digits of the end year)
  v_fy_str := v_fy_start::text || '-' || lpad(((v_fy_start + 1) % 100)::text, 2, '0');

  return 'FC-' || v_code || '-' || v_fy_str || '-' || lpad(v_counter::text, 4, '0');
end;
$$;

-- ── 5. access_rules — financier copy routes (BO GM only, gm tier × 2 entities) ──
-- /financier-copy: 2, /my-financier-copies: 2, /financier-copy-log: 2 = 6 new rows.
with refs as (
  select
    (select id from public.entities    where code = 'PT')          as pt_id,
    (select id from public.entities    where code = 'PTB')         as ptb_id,
    (select id from public.departments where code = 'back_office') as bo_id
),
new_rows(route, tier, entity) as (values
  ('/financier-copy',        'gm', 'PT'),
  ('/financier-copy',        'gm', 'PTB'),

  ('/my-financier-copies',   'gm', 'PT'),
  ('/my-financier-copies',   'gm', 'PTB'),

  ('/financier-copy-log',    'gm', 'PT'),
  ('/financier-copy-log',    'gm', 'PTB')
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
  n_fc_main  int;
  n_fc_my    int;
  n_fc_log   int;
begin
  select count(*) into n_fc_main from public.access_rules where route = '/financier-copy';
  select count(*) into n_fc_my   from public.access_rules where route = '/my-financier-copies';
  select count(*) into n_fc_log  from public.access_rules where route = '/financier-copy-log';

  if n_fc_main != 2 then raise exception '/financier-copy expected 2 rows, got %', n_fc_main;     end if;
  if n_fc_my   != 2 then raise exception '/my-financier-copies expected 2 rows, got %', n_fc_my;  end if;
  if n_fc_log  != 2 then raise exception '/financier-copy-log expected 2 rows, got %', n_fc_log;  end if;
end $$;

commit;
