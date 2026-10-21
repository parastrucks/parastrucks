-- Phase 10 — Vehicle Tracker, Stage 1 step 2: the foundation schema.
--
-- One row = one chassis. Columns, roles and formulas come from
-- docs/backlog/phase10-column-map.md (built from the real workbook headers and signed off by the
-- owner 2026-10-21). Every formula below is the workbook's own, read from row 2 of its sheet.
--
-- ACCESS MODEL — stricter than the plan, on purpose:
--   * No grant to anon or authenticated on ANY tracker table or function. The browser never reads
--     these tables; every read and write goes through the admin-vehicle-units Edge Function
--     (service role), which checks the per-user tracker_access flag on every call. Row-level
--     security cannot hide COLUMNS, so a direct SELECT grant would have exposed the incentive
--     figures to every tracker user.
--   * Incentives live in their own table (vehicle_unit_incentives) as defence in depth: a grant
--     added by mistake to vehicle_units still does not reach them.
--   * RLS is enabled on every table with no permissive policy: API roles see nothing even if a
--     grant appears. service_role bypasses RLS.
--
-- WRITES go through tracker_apply_changes() only: one call = one transaction = one paste or fill.
-- It checks each cell's before-value (a stale value is a conflict, never an overwrite), records
-- field-level audit rows, and replays a repeated client_request_id instead of applying it twice.
--
-- Rollback (nothing else depends on these yet):
--   drop function if exists public.tracker_apply_changes(uuid, uuid, jsonb, text, text);
--   drop function if exists public.tracker_create_unit(uuid, uuid, jsonb);
--   drop table if exists public.tracker_audit, public.tracker_views, public.unit_cell_formats,
--     public.unit_cell_notes, public.vehicle_unit_incentives, public.tracker_requests,
--     public.vehicle_units, public.tracker_import_batches cascade;
--   drop function if exists public.vehicle_units_compute(), public.vehicle_units_audit(),
--     public.tracker_make_year(text);
-- Apply to STAGING (klpnhpnlotcbbovwswmq) first and run scripts/phase10/probe-foundation.sql.

begin;

-- ── Import batches (so a whole import can be reverted — F2) ─────────────────────────────────
create table public.tracker_import_batches (
  id           uuid primary key default gen_random_uuid(),
  source_file  text not null,
  row_count    integer not null default 0,
  actor        uuid not null,
  created_at   timestamptz not null default now(),
  reverted_at  timestamptz,
  reverted_by  uuid
);

-- ── The book ────────────────────────────────────────────────────────────────────────────────
create table public.vehicle_units (
  id                        uuid primary key default gen_random_uuid(),

  -- A · identity
  chassis_no                text not null,
  engine_no                 text,
  model                     text,
  vpart_no                  text,
  hsn_code                  text,
  make_year                 integer,                 -- computed: VIN position 10
  mfrs_year                 integer,
  segment                   text,
  customer_name             text,
  qty                       integer not null default 1 check (qty >= 0),

  -- B · purchase from Ashok Leyland
  purchase_source           text not null default 'al' check (purchase_source in ('al','other_dealer')),
  oem_gatepass_no           text,
  oem_gatepass_date         date,
  odn_no                    text,
  ctc                       numeric,
  ctd                       numeric,
  ctc_basis                 text check (ctc_basis in ('inclusive','exclusive')),
  amc_to_al                 numeric,
  dsa                       numeric,
  ad_blue                   numeric,
  retention_dealer          numeric,                 -- computed
  payment_amount            numeric,                 -- computed
  tds                       numeric,                 -- computed
  total_payment_to_al       numeric,                 -- computed
  al_payment_status         text,
  al_payment_date           date,
  ptb_invoice_date          date,
  gst_rate                  numeric,                 -- computed (percent)
  gst_rate_override         numeric check (gst_rate_override in (5, 12, 18, 28)),
  supplier_invoice_no       text,
  supplier_invoice_date     date,
  supplier_invoice_amount   numeric,
  diff_amount               numeric,                 -- computed
  diff_base                 numeric,                 -- computed
  diff_gst                  numeric,                 -- computed
  diff_tds                  numeric,                 -- computed
  total_difference          numeric,                 -- computed
  parts_pkg                 text,                    -- money written as text

  -- C · retail sale, finance, delivery, refund
  dse                       text,
  delivery_location         text,
  finance_bank              text,
  do_date                   date,
  do_amount                 numeric,
  mrp                       numeric,
  tally_bill                numeric,
  amc_charged_to_customer   text,                    -- money written as text
  tcs                       numeric,                 -- computed
  total                     numeric,                 -- computed
  margin_money              numeric,
  finance_recd              numeric,
  finance_paymt_recd_date   date,
  subvention                numeric,
  total_recd                numeric,                 -- computed
  insurance                 numeric,
  cretem                    numeric,
  road_tax_pct              numeric not null default 6 check (road_tax_pct >= 0 and road_tax_pct <= 20),
  full_tax                  numeric,                 -- computed (or the override)
  full_tax_override         numeric,
  total_receivable          numeric,                 -- computed
  net_refund                numeric,                 -- computed
  refund_status             text,
  delivery_status           text,
  payment_status            text,                    -- computed
  ad_blu_given              text,                    -- money written as text
  endhan                    text,                    -- money written as text

  -- D · retention (incentives are in vehicle_unit_incentives)
  dsm                       text,
  date_of_retail            date,
  date_of_delivery          date,
  other_deductions          numeric,
  retention_internal        numeric,                 -- computed
  retention_al_claim        numeric,
  app_amt                   numeric,                 -- computed
  retention_remarks         text,
  sale_category             text,
  al_invoice_no             text,
  dealer_invoice_no         text,
  al_claim_age              integer,
  al_claim_interest         numeric,

  -- E · inter-dealer, cancel/rebill
  sold_to_dealer            text,
  dealer_basic_value        numeric,                 -- computed
  dealer_tds                numeric,                 -- computed
  dealer_net_payable        numeric,                 -- computed
  vehicle_location          text,
  actual_delivery           text,
  rebill_delivery_date      date,

  -- F · system
  superseded_at             timestamptz,
  superseded_by_id          uuid references public.vehicle_units(id),
  notes                     text,
  user_field_1              text,
  user_field_2              text,
  user_field_3              text,
  user_field_4              text,
  user_field_5              text,
  source_file               text,
  source_row                integer,
  import_batch_id           uuid references public.tracker_import_batches(id),
  recompute                 boolean not null default true,  -- false ONLY while the importer writes history (R2-25)
  created_at                timestamptz not null default now(),
  created_by                uuid,
  updated_at                timestamptz not null default now(),
  updated_by                uuid,

  constraint chassis_not_blank check (btrim(chassis_no) <> '')
);

create unique index vehicle_units_chassis_active on public.vehicle_units (chassis_no) where superseded_at is null;
create index vehicle_units_chassis_last6  on public.vehicle_units (right(chassis_no, 6));
create index vehicle_units_gatepass_last6 on public.vehicle_units (right(oem_gatepass_no, 6));
create index vehicle_units_retail_date    on public.vehicle_units (date_of_retail);
create index vehicle_units_gatepass_date  on public.vehicle_units (oem_gatepass_date);
create index vehicle_units_import_batch   on public.vehicle_units (import_batch_id) where import_batch_id is not null;

-- ── VIN position 10 → model year (ISO 3779 letters; the book uses N..T) ──────────────────────
create function public.tracker_make_year(p_chassis text) returns integer
language sql immutable
set search_path = ''
as $$
  select case upper(substr(p_chassis, 10, 1))
    when 'L' then 2020 when 'M' then 2021 when 'N' then 2022 when 'P' then 2023
    when 'R' then 2024 when 'S' then 2025 when 'T' then 2026 when 'V' then 2027
    when 'W' then 2028 when 'X' then 2029 when 'Y' then 2030
    else null end
$$;

-- ── The derived columns: every formula is the workbook's own ────────────────────────────────
-- Blank inputs count as 0, as in Excel. Rates and switch dates (owner, 2026-10-21):
--   GST 28% on invoices before 22 Sep 2025, else 18% (unsold stock = 18%); an override wins.
--   Road tax on the bill value for invoices before 1 Aug 2025, on MRP from then (date found in the
--   2025-26 sheet: every row to 31 Jul uses the bill, every row from 2 Aug uses MRP).
create function public.vehicle_units_compute() returns trigger
language plpgsql
set search_path = ''
as $$
declare
  g      numeric;   -- GST as a fraction
  ctc    numeric := coalesce(new.ctc, 0);
  ctd    numeric := coalesce(new.ctd, 0);
  pay    numeric;
  sup    numeric := coalesce(new.supplier_invoice_amount, 0);
  basic  numeric;
begin
  new.chassis_no := btrim(new.chassis_no);
  new.make_year  := public.tracker_make_year(new.chassis_no);

  if not new.recompute then
    return new;   -- the importer is writing history exactly as the workbook holds it
  end if;

  new.gst_rate := coalesce(new.gst_rate_override,
    case when new.ptb_invoice_date is not null and new.ptb_invoice_date < date '2025-09-22' then 28 else 18 end);
  g := new.gst_rate / 100;

  -- B · INVOICE TRACKER R, S, T, U, AC–AG
  new.retention_dealer    := case when ctc = 0 then 0
                               else ctc - ctd - coalesce(new.amc_to_al, 0) - coalesce(new.dsa, 0) - coalesce(new.ad_blue, 0) end;
  pay                     := (ctd + coalesce(new.amc_to_al, 0)) * new.qty;
  new.payment_amount      := pay;
  new.tds                 := pay * 0.001;
  new.total_payment_to_al := pay - pay * 0.001;
  if sup = 0 or pay = 0 then
    new.diff_amount := 0; new.diff_base := 0; new.diff_gst := 0; new.diff_tds := 0;
  else
    new.diff_amount := pay - sup;
    new.diff_base   := (pay - sup) / (1 + g);
    new.diff_gst    := (pay - sup) * g / (1 + g);
    new.diff_tds    := (pay - sup) * 0.001;
  end if;
  new.total_difference := case when sup = 0 then 0 else new.diff_base + new.diff_gst + new.diff_tds end;

  -- C · PTB RETAIL S, T, Y, AB, AC, AD, AH
  new.tcs        := coalesce(new.tally_bill, 0) * 0.01;          -- tally bill, NOT ctc (R2-14)
  new.total      := ctc + new.tcs;
  new.total_recd := coalesce(new.margin_money, 0) + coalesce(new.finance_recd, 0) + coalesce(new.subvention, 0);
  basic := case when new.ptb_invoice_date is not null and new.ptb_invoice_date < date '2025-08-01'
                then coalesce(new.tally_bill, 0) else coalesce(new.mrp, 0) end / (1 + g);
  new.full_tax := coalesce(new.full_tax_override, basic * new.road_tax_pct / 100);
  new.total_receivable := new.total + coalesce(new.insurance, 0) + coalesce(new.cretem, 0) + new.full_tax;
  new.net_refund       := new.total_recd - new.total_receivable;
  new.payment_status   := case when lower(btrim(coalesce(new.delivery_status, ''))) = 'stock' then 'Stock'
                               when new.finance_paymt_recd_date is null then 'Pending'
                               else 'Payment Recd' end;

  -- D · RETENTION TRACKER internal O, AL R
  new.retention_internal := ctc - ctd - coalesce(new.other_deductions, 0);
  new.app_amt            := case when new.retention_al_claim is null then null
                                 else new.retention_al_claim - new.retention_internal end;

  -- E · DEALERS G, H, I (only on rows sold to a dealer)
  if new.sold_to_dealer is null or btrim(new.sold_to_dealer) = '' then
    new.dealer_basic_value := null; new.dealer_tds := null; new.dealer_net_payable := null;
  else
    new.dealer_basic_value := ctd / (1 + g);
    new.dealer_tds         := new.dealer_basic_value * 0.001;
    new.dealer_net_payable := ctd - new.dealer_tds;
  end if;

  return new;
end;
$$;

create trigger vehicle_units_compute
  before insert or update on public.vehicle_units
  for each row execute function public.vehicle_units_compute();

-- ── Incentives: hidden from everyone but admin + HR (owner, 2026-08-11) ──────────────────────
create table public.vehicle_unit_incentives (
  unit_id                 uuid primary key references public.vehicle_units(id) on delete cascade,
  dse_incentive_override  numeric,       -- the slab is computed on screen; this overrides it (SRS rows)
  dsm_incentive           numeric,
  gm_incentive            numeric,
  updated_at              timestamptz not null default now(),
  updated_by              uuid
);

-- ── Cell notes (the 124 Excel comments + new ones) ──────────────────────────────────────────
create table public.unit_cell_notes (
  id          uuid primary key default gen_random_uuid(),
  unit_id     uuid not null references public.vehicle_units(id) on delete cascade,
  column_key  text not null,
  body        text not null check (btrim(body) <> ''),
  author_id   uuid,
  source      text not null default 'portal' check (source in ('portal','excel_comment','excel_formula')),
  created_at  timestamptz not null default now()
);
create index unit_cell_notes_unit on public.unit_cell_notes (unit_id);

-- ── Cell formatting (the ~148 Excel highlights, then Univer's bold/colours/borders) ──────────
create table public.unit_cell_formats (
  unit_id     uuid not null references public.vehicle_units(id) on delete cascade,
  column_key  text not null,
  format      jsonb not null check (jsonb_typeof(format) = 'object'),
  updated_at  timestamptz not null default now(),
  updated_by  uuid,
  primary key (unit_id, column_key)
);

-- ── Saved layouts (personal, or admin-published shared) ─────────────────────────────────────
create table public.tracker_views (
  id          uuid primary key default gen_random_uuid(),
  owner_id    uuid,                              -- null = shared layout
  name        text not null check (btrim(name) <> ''),
  columns     jsonb not null check (jsonb_typeof(columns) = 'array'),
  filters     jsonb not null default '{}'::jsonb,
  anchor_col  text,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);
create unique index tracker_views_name on public.tracker_views (coalesce(owner_id, '00000000-0000-0000-0000-000000000000'::uuid), lower(name));

-- ── The change log: slim, field-level (never to_jsonb(OLD/NEW) — E8, D1) ─────────────────────
create table public.tracker_audit (
  id                bigint generated always as identity primary key,
  unit_id           uuid not null,
  column_key        text not null,             -- '*' = the row was created
  old_value         text,
  new_value         text,
  actor             uuid,
  source            text not null,             -- typed | paste | fill | undo | redo | delete | import | create | revert
  batch_id          uuid,                      -- one paste = one batch = one Ctrl+Z
  import_batch_id   uuid,
  created_at        timestamptz not null default now()
);
create index tracker_audit_unit  on public.tracker_audit (unit_id, created_at desc);
create index tracker_audit_batch on public.tracker_audit (batch_id) where batch_id is not null;

-- One request id = one applied batch. A repeat replays the stored result.
create table public.tracker_requests (
  client_request_id  text primary key,
  batch_id           uuid not null,
  actor              uuid not null,
  result             jsonb not null,
  created_at         timestamptz not null default now()
);

-- Audit: every changed INPUT column on update; one '*' row on insert. Computed columns are not
-- logged (they follow from the inputs). Actor, source and batch come from transaction-local
-- settings set by tracker_apply_changes / tracker_create_unit.
create function public.vehicle_units_audit() returns trigger
language plpgsql
set search_path = ''
as $$
declare
  k        text;
  o        jsonb;
  n        jsonb;
  v_actor  uuid := nullif(current_setting('tracker.actor', true), '')::uuid;
  v_source text := coalesce(nullif(current_setting('tracker.source', true), ''), 'unknown');
  v_batch  uuid := nullif(current_setting('tracker.batch', true), '')::uuid;
begin
  if tg_op = 'INSERT' then
    insert into public.tracker_audit (unit_id, column_key, old_value, new_value, actor, source, batch_id, import_batch_id)
    values (new.id, '*', null, new.chassis_no, v_actor, v_source, v_batch, new.import_batch_id);
    return new;
  end if;
  o := to_jsonb(old); n := to_jsonb(new);
  for k in select key from jsonb_object_keys(n) as t(key) loop
    continue when k in ('id','created_at','created_by','updated_at','updated_by','recompute','make_year',
      'retention_dealer','payment_amount','tds','total_payment_to_al','gst_rate','diff_amount','diff_base',
      'diff_gst','diff_tds','total_difference','tcs','total','total_recd','full_tax','total_receivable',
      'net_refund','payment_status','retention_internal','app_amt','dealer_basic_value','dealer_tds',
      'dealer_net_payable');
    if o -> k is distinct from n -> k then
      insert into public.tracker_audit (unit_id, column_key, old_value, new_value, actor, source, batch_id, import_batch_id)
      values (new.id, k, o ->> k, n ->> k, v_actor, v_source, v_batch, new.import_batch_id);
    end if;
  end loop;
  return new;
end;
$$;

create trigger vehicle_units_audit
  after insert or update on public.vehicle_units
  for each row execute function public.vehicle_units_audit();

-- ── The only write path for cells ───────────────────────────────────────────────────────────
-- p_changes: [{ "unit_id": uuid, "column": text, "before": any, "after": any }, ...]
-- All or nothing. Returns { ok, applied, conflicts:[…], rejected:[…], batch_id, replayed }.
-- A conflict (the cell is no longer what the client saw) or a rejected column stops the whole
-- batch: nothing is written and the caller is told which cells.
create function public.tracker_apply_changes(
  p_actor uuid, p_batch uuid, p_changes jsonb, p_request_id text, p_source text default 'typed'
) returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  editable constant text[] := array[
    'chassis_no','engine_no','model','vpart_no','hsn_code','mfrs_year','segment','customer_name','qty',
    'purchase_source','oem_gatepass_no','oem_gatepass_date','odn_no','ctc','ctd','ctc_basis','amc_to_al',
    'dsa','ad_blue','al_payment_status','al_payment_date','ptb_invoice_date','gst_rate_override',
    'supplier_invoice_no','supplier_invoice_date','supplier_invoice_amount','parts_pkg','dse',
    'delivery_location','finance_bank','do_date','do_amount','mrp','tally_bill','amc_charged_to_customer',
    'margin_money','finance_recd','finance_paymt_recd_date','subvention','insurance','cretem','road_tax_pct',
    'full_tax_override','refund_status','delivery_status','ad_blu_given','endhan','dsm','date_of_retail',
    'date_of_delivery','other_deductions','retention_al_claim','retention_remarks','sale_category',
    'al_invoice_no','dealer_invoice_no','al_claim_age','al_claim_interest','sold_to_dealer',
    'vehicle_location','actual_delivery','rebill_delivery_date','notes','user_field_1','user_field_2',
    'user_field_3','user_field_4','user_field_5'];
  c          jsonb;
  v_col      text;
  v_unit     uuid;
  v_current  jsonb;
  v_prior    jsonb;
  conflicts  jsonb := '[]'::jsonb;
  rejected   jsonb := '[]'::jsonb;
  applied    integer := 0;
  v_result   jsonb;
begin
  if p_actor is null or p_batch is null or p_request_id is null or btrim(p_request_id) = '' then
    raise exception 'actor, batch and request id are required';
  end if;
  if p_source is null or not (p_source = any (array['typed','paste','fill','undo','redo','delete','revert'])) then
    raise exception 'unknown edit source %', p_source;
  end if;
  if jsonb_typeof(p_changes) <> 'array' or jsonb_array_length(p_changes) = 0 then
    raise exception 'changes must be a non-empty array';
  end if;
  if jsonb_array_length(p_changes) > 5000 then
    raise exception 'too many changes in one batch (% > 5000)', jsonb_array_length(p_changes);
  end if;

  -- idempotency: a repeated request returns what the first one did
  perform pg_advisory_xact_lock(hashtext('tracker_request:' || p_request_id));
  select result into v_prior from public.tracker_requests where client_request_id = p_request_id;
  if found then
    return v_prior || jsonb_build_object('replayed', true);
  end if;

  -- validate every change before writing any
  for c in select * from jsonb_array_elements(p_changes) loop
    v_col  := c ->> 'column';
    v_unit := (c ->> 'unit_id')::uuid;
    if v_col is null or not (v_col = any (editable)) then
      rejected := rejected || jsonb_build_object('unit_id', v_unit, 'column', v_col, 'reason', 'not an editable column');
      continue;
    end if;
    select to_jsonb(u) -> v_col into v_current from public.vehicle_units u where u.id = v_unit for update;
    if not found then
      rejected := rejected || jsonb_build_object('unit_id', v_unit, 'column', v_col, 'reason', 'no such row');
      continue;
    end if;
    -- compare as text: the client may send 1 where the row holds "1" (measured in the spike)
    if coalesce(v_current #>> '{}', '') is distinct from coalesce(c -> 'before' #>> '{}', '') then
      conflicts := conflicts || jsonb_build_object('unit_id', v_unit, 'column', v_col,
                     'expected', c -> 'before', 'actual', v_current);
    end if;
  end loop;

  if jsonb_array_length(rejected) > 0 or jsonb_array_length(conflicts) > 0 then
    return jsonb_build_object('ok', false, 'applied', 0, 'conflicts', conflicts, 'rejected', rejected,
                              'batch_id', p_batch, 'replayed', false);
  end if;

  perform set_config('tracker.actor',  p_actor::text, true);
  perform set_config('tracker.source', p_source, true);
  perform set_config('tracker.batch',  p_batch::text, true);

  for c in select * from jsonb_array_elements(p_changes) loop
    v_col  := c ->> 'column';
    v_unit := (c ->> 'unit_id')::uuid;
    -- jsonb_populate_record does the type conversion: a bad date or number raises and aborts the batch
    execute format(
      'update public.vehicle_units u set %1$I = (jsonb_populate_record(null::public.vehicle_units, $1)).%1$I,
              recompute = true, updated_at = now(), updated_by = $2
        where u.id = $3', v_col)
      using jsonb_build_object(v_col, c -> 'after'), p_actor, v_unit;
    applied := applied + 1;
  end loop;

  v_result := jsonb_build_object('ok', true, 'applied', applied, 'conflicts', '[]'::jsonb,
                                 'rejected', '[]'::jsonb, 'batch_id', p_batch, 'replayed', false);
  insert into public.tracker_requests (client_request_id, batch_id, actor, result)
  values (p_request_id, p_batch, p_actor, v_result);
  return v_result;
end;
$$;

-- Quick entry (F1): one new row. p_values uses the same editable columns.
create function public.tracker_create_unit(p_actor uuid, p_batch uuid, p_values jsonb) returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_id uuid;
begin
  if p_actor is null then raise exception 'actor is required'; end if;
  if coalesce(btrim(p_values ->> 'chassis_no'), '') = '' then raise exception 'chassis number is required'; end if;
  perform set_config('tracker.actor',  p_actor::text, true);
  perform set_config('tracker.source', 'create', true);
  perform set_config('tracker.batch',  coalesce(p_batch, gen_random_uuid())::text, true);
  insert into public.vehicle_units
  select (jsonb_populate_record(null::public.vehicle_units,
           p_values - array['id','created_at','updated_at','recompute','import_batch_id','superseded_at','superseded_by_id']
           || jsonb_build_object('id', gen_random_uuid(), 'created_by', p_actor, 'updated_by', p_actor,
                                 'created_at', now(), 'updated_at', now(), 'recompute', true,
                                 'qty', coalesce(p_values -> 'qty', '1'::jsonb),
                                 'purchase_source', coalesce(p_values -> 'purchase_source', '"al"'::jsonb),
                                 'road_tax_pct', coalesce(p_values -> 'road_tax_pct', '6'::jsonb)))).*
  returning id into v_id;
  return v_id;
end;
$$;

-- ── Lock everything to service_role ─────────────────────────────────────────────────────────
alter table public.tracker_import_batches  enable row level security;
alter table public.vehicle_units           enable row level security;
alter table public.vehicle_unit_incentives enable row level security;
alter table public.unit_cell_notes         enable row level security;
alter table public.unit_cell_formats       enable row level security;
alter table public.tracker_views           enable row level security;
alter table public.tracker_audit           enable row level security;
alter table public.tracker_requests        enable row level security;

revoke all on public.tracker_import_batches, public.vehicle_units, public.vehicle_unit_incentives,
  public.unit_cell_notes, public.unit_cell_formats, public.tracker_views, public.tracker_audit,
  public.tracker_requests from anon, authenticated, public;
grant all on public.tracker_import_batches, public.vehicle_units, public.vehicle_unit_incentives,
  public.unit_cell_notes, public.unit_cell_formats, public.tracker_views, public.tracker_audit,
  public.tracker_requests to service_role;

revoke all on function public.tracker_apply_changes(uuid, uuid, jsonb, text, text) from public, anon, authenticated;
revoke all on function public.tracker_create_unit(uuid, uuid, jsonb)          from public, anon, authenticated;
revoke all on function public.tracker_make_year(text)                         from public, anon, authenticated;
grant execute on function public.tracker_apply_changes(uuid, uuid, jsonb, text, text) to service_role;
grant execute on function public.tracker_create_unit(uuid, uuid, jsonb)          to service_role;
grant execute on function public.tracker_make_year(text)                         to service_role;

commit;
