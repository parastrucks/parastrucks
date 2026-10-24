-- Phase 10 — Vehicle Tracker: two CTCs (owner, 2026-10-24).
--
-- Owner: "the difference in CTC is supposed to be recorded as two different CTCs. One is AL CTC, which is
-- the CTC told to AL, and the next is PTB CTC, which is the one that is used for internal calculation
-- purposes … AL gives us retention based on the CTC we inform them."
-- Measured on the 2025-26 files (counts only): the purchase file agrees with the AL retention file
-- (1,634 of 1,860), the sales lists with the internal retention file (1,938 of 2,087); where internal and
-- AL differ (275), the internal figure is the higher on 240. And the files' own formulas: the purchase
-- file's Retention and the AL file's "Diff between CTC and CTD" / App Amt are worked on THEIR CTC, the
-- internal retention on its own.
--
-- So: vehicle_units.ctc stays and is now shown as "PTB CTC" (no rename — nothing that reads it breaks);
-- new vehicle_units.al_ctc = "AL CTC". A blank AL CTC means AL was told the same figure as PTB CTC.
--   on AL CTC:  retention_dealer, app_amt
--   on PTB CTC: total (→ total receivable, net refund), retention_internal
-- vehicle_units_compute is 20261023_phase10_tracker_rmc_gst.sql's with those two changes;
-- tracker_apply_changes is 20261024_phase10_tracker_al_retail_date.sql's with 'al_ctc' added.
-- Rows already stored keep their figures until next saved (the trigger recomputes on save).
-- Requires 20261024_phase10_tracker_al_retail_date.sql.
--
-- Rollback: re-run 20261023_phase10_tracker_rmc_gst.sql and 20261024_phase10_tracker_al_retail_date.sql,
-- then (owner approval — it deletes data) alter table public.vehicle_units drop column al_ctc;

begin;

alter table public.vehicle_units add column al_ctc numeric;

create or replace function public.vehicle_units_compute() returns trigger
language plpgsql
set search_path = ''
as $$
declare
  g      numeric;   -- GST as a fraction
  ctc    numeric := coalesce(new.ctc, 0);                -- PTB CTC: the internal figure
  al_ctc numeric := coalesce(new.al_ctc, new.ctc, 0);    -- AL CTC: what AL was told (blank = same as PTB CTC)
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

  -- RMC (transit-mixer) chassis are 18% on any date (owner, 2026-10-23); every other truck 28% on
  -- invoices before 22 Sep 2025, else 18% (unsold stock = 18%). An override wins.
  new.gst_rate := coalesce(new.gst_rate_override,
    case when coalesce(new.model, '') ~* '\mRMC\M' then 18
         when new.ptb_invoice_date is not null and new.ptb_invoice_date < date '2025-09-22' then 28
         else 18 end);
  g := new.gst_rate / 100;

  -- B · INVOICE TRACKER R, S, T, U, AC–AG
  -- the purchase file's Retention is worked on the CTC told to AL
  new.retention_dealer    := case when al_ctc = 0 then 0
                               else al_ctc - ctd - coalesce(new.amc_to_al, 0) - coalesce(new.dsa, 0) - coalesce(new.ad_blue, 0) end;
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

  -- D · RETENTION TRACKER internal O (on PTB CTC), AL R (the AL file's own "Diff between CTC and CTD" is
  -- worked on the CTC told to AL: App Amt = Retention − (AL CTC − CTD − other deductions))
  new.retention_internal := ctc - ctd - coalesce(new.other_deductions, 0);
  new.app_amt            := case when new.retention_al_claim is null then null
                                 else new.retention_al_claim - (al_ctc - ctd - coalesce(new.other_deductions, 0)) end;

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

create or replace function public.tracker_apply_changes(
  p_actor uuid, p_batch uuid, p_changes jsonb, p_request_id text, p_source text default 'typed'
) returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  editable constant text[] := array[
    'chassis_no','engine_no','model','vpart_no','hsn_code','mfrs_year','segment','customer_name','qty',
    'purchase_source','oem_gatepass_no','oem_gatepass_date','odn_no','ctc','al_ctc','ctd','ctc_basis','amc_to_al',
    'dsa','ad_blue','al_payment_status','mto_advance','al_payment_date','ptb_invoice_date','gst_rate_override',
    'supplier_invoice_no','supplier_invoice_date','supplier_invoice_amount','parts_pkg','dse',
    'delivery_location','finance_bank','do_date','do_amount','mrp','tally_bill','amc_charged_to_customer',
    'margin_money','finance_recd','finance_paymt_recd_date','subvention','insurance','cretem','road_tax_pct',
    'full_tax_override','refund_status','delivery_status','ad_blu_given','endhan','endhan_date','dsm','date_of_retail','al_retail_date',
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
    -- A conflict only when the values differ BOTH as text and as JSON values:
    --   text  — the client may send 1 where the row holds "1" (undo changes a cell's type, measured);
    --   value — the row may hold 1310.50 where the client, having read it as JSON, sends 1310.5.
    if coalesce(v_current #>> '{}', '') is distinct from coalesce(c -> 'before' #>> '{}', '')
       and v_current is distinct from coalesce(c -> 'before', 'null'::jsonb) then
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

commit;
