-- Phase 10 — Vehicle Tracker: an "Endhan Date" column (owner, 2026-10-23: the dates written beside
-- ENDHAN in column AL of the 2025-26 sheet are, he believes, the day the Endhan was given).
--
-- Adds vehicle_units.endhan_date (date, nullable, typed by people) and puts it on tracker_apply_changes's
-- editable list. Nothing else in the function changes (the body is 20261022_phase10_tracker_numeric_before.sql
-- with one more name in the list). Same signature, so grants stay as they are. The audit trigger logs it like
-- any other input column; the compute trigger does not use it.
-- Requires 20261021_phase10_tracker_foundation.sql and 20261022_phase10_tracker_numeric_before.sql.
--
-- Rollback: re-run 20261022_phase10_tracker_numeric_before.sql, then (owner approval — it deletes data)
--   alter table public.vehicle_units drop column endhan_date;

begin;

alter table public.vehicle_units add column endhan_date date;   -- the day the Endhan was given

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
    'purchase_source','oem_gatepass_no','oem_gatepass_date','odn_no','ctc','ctd','ctc_basis','amc_to_al',
    'dsa','ad_blue','al_payment_status','al_payment_date','ptb_invoice_date','gst_rate_override',
    'supplier_invoice_no','supplier_invoice_date','supplier_invoice_amount','parts_pkg','dse',
    'delivery_location','finance_bank','do_date','do_amount','mrp','tally_bill','amc_charged_to_customer',
    'margin_money','finance_recd','finance_paymt_recd_date','subvention','insurance','cretem','road_tax_pct',
    'full_tax_override','refund_status','delivery_status','ad_blu_given','endhan','endhan_date','dsm','date_of_retail',
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
