-- Phase 10 Stage 1 — probe for 20261021_phase10_tracker_foundation.sql.
-- SELF-ABORTING: a green run ENDS IN AN ERROR that reads "PROBE COMPLETE: N passed, 0 failed".
-- Everything it writes is rolled back with that error, so it leaves no residue.
-- Expected values are worked out by hand from the workbook formulas, never from the trigger.
do $probe$
declare
  pass int := 0; fail int := 0; msgs text := '';
  me uuid := gen_random_uuid();
  a uuid; b uuid; c uuid; d uuid;
  r public.vehicle_units%rowtype;
  res jsonb; n int; n2 int;
  base jsonb := jsonb_build_object(
    'ctc', 3000000, 'ctd', 2800000, 'amc_to_al', 10000, 'dsa', 5000, 'ad_blue', 2000, 'qty', 1,
    'supplier_invoice_amount', 2805000, 'tally_bill', 3050000, 'mrp', 3500000,
    'margin_money', 500000, 'finance_recd', 2600000, 'subvention', 0, 'insurance', 40000,
    'cretem', 7000, 'other_deductions', 15000, 'retention_al_claim', 200000,
    'delivery_status', 'DELIVERED', 'finance_paymt_recd_date', '2025-08-10');
begin
  ------------------------------------------------------------------------------------------------
  -- 1. Formulas BEFORE both switches (invoice 15 Jul 2025): GST 28%, road tax on the bill value
  a := public.tracker_create_unit(me, gen_random_uuid(),
         base || jsonb_build_object('chassis_no', 'MB1AAAAAAS0000001', 'ptb_invoice_date', '2025-07-15'));
  select * into r from public.vehicle_units where id = a;
  if r.make_year = 2025 then pass := pass + 1; else fail := fail + 1; msgs := msgs || ' |1a make_year=' || coalesce(r.make_year::text,'null'); end if;
  if r.gst_rate = 28 then pass := pass + 1; else fail := fail + 1; msgs := msgs || ' |1b gst=' || r.gst_rate; end if;
  if r.retention_dealer = 183000 then pass := pass + 1; else fail := fail + 1; msgs := msgs || ' |1c retention=' || r.retention_dealer; end if;
  if r.payment_amount = 2810000 and r.tds = 2810 and r.total_payment_to_al = 2807190 then pass := pass + 1;
    else fail := fail + 1; msgs := msgs || ' |1d payment chain ' || r.payment_amount || '/' || r.tds || '/' || r.total_payment_to_al; end if;
  if r.diff_amount = 5000 and round(r.diff_base, 2) = 3906.25 and round(r.diff_gst, 2) = 1093.75
     and r.diff_tds = 5 and round(r.total_difference, 2) = 5005 then pass := pass + 1;
    else fail := fail + 1; msgs := msgs || ' |1e diffs ' || r.diff_amount || '/' || r.diff_base || '/' || r.diff_gst || '/' || r.total_difference; end if;
  if r.tcs = 30500 and r.total = 3030500 and r.total_recd = 3100000 then pass := pass + 1;
    else fail := fail + 1; msgs := msgs || ' |1f tcs/total/recd ' || r.tcs || '/' || r.total || '/' || r.total_recd; end if;
  -- road tax on the BILL: 3,050,000 / 1.28 × 6% = 142,968.75
  if round(r.full_tax, 2) = 142968.75 then pass := pass + 1; else fail := fail + 1; msgs := msgs || ' |1g full_tax=' || r.full_tax; end if;
  if round(r.total_receivable, 2) = 3220468.75 and round(r.net_refund, 2) = -120468.75 then pass := pass + 1;
    else fail := fail + 1; msgs := msgs || ' |1h receivable/refund ' || r.total_receivable || '/' || r.net_refund; end if;
  if r.payment_status = 'Payment Recd' then pass := pass + 1; else fail := fail + 1; msgs := msgs || ' |1i status=' || r.payment_status; end if;
  if r.retention_internal = 185000 and r.app_amt = 15000 then pass := pass + 1;
    else fail := fail + 1; msgs := msgs || ' |1j retention_internal/app ' || r.retention_internal || '/' || r.app_amt; end if;
  if r.dealer_basic_value is null and r.dealer_net_payable is null then pass := pass + 1; else fail := fail + 1; msgs := msgs || ' |1k dealer cols on a retail row'; end if;

  ------------------------------------------------------------------------------------------------
  -- 2. AFTER both switches (invoice 1 Oct 2025): GST 18%, road tax on MRP; sold to a dealer
  b := public.tracker_create_unit(me, gen_random_uuid(),
         base || jsonb_build_object('chassis_no', 'MB1AAAAAAT0000002', 'ptb_invoice_date', '2025-10-01',
                                    'sold_to_dealer', 'PROBE DEALER'));
  select * into r from public.vehicle_units where id = b;
  if r.make_year = 2026 and r.gst_rate = 18 then pass := pass + 1; else fail := fail + 1; msgs := msgs || ' |2a year/gst ' || r.make_year || '/' || r.gst_rate; end if;
  -- 5000 / 1.18 = 4237.29 ; 5000 × 0.18 / 1.18 = 762.71
  if round(r.diff_base, 2) = 4237.29 and round(r.diff_gst, 2) = 762.71 then pass := pass + 1;
    else fail := fail + 1; msgs := msgs || ' |2b diffs at 18% ' || r.diff_base || '/' || r.diff_gst; end if;
  -- road tax on MRP: 3,500,000 / 1.18 × 6% = 177,966.10
  if round(r.full_tax, 2) = 177966.10 then pass := pass + 1; else fail := fail + 1; msgs := msgs || ' |2c full_tax=' || r.full_tax; end if;
  -- dealer: 2,800,000 / 1.18 = 2,372,881.36 ; tds 0.1% = 2,372.88 ; net = 2,797,627.12
  if round(r.dealer_basic_value, 2) = 2372881.36 and round(r.dealer_tds, 2) = 2372.88
     and round(r.dealer_net_payable, 2) = 2797627.12 then pass := pass + 1;
    else fail := fail + 1; msgs := msgs || ' |2d dealer ' || r.dealer_basic_value || '/' || r.dealer_tds || '/' || r.dealer_net_payable; end if;

  ------------------------------------------------------------------------------------------------
  -- 3. Edge cases: unsold stock, ctc = 0, the 21 Sep / 22 Sep and 31 Jul / 1 Aug boundaries
  c := public.tracker_create_unit(me, gen_random_uuid(), jsonb_build_object(
         'chassis_no', 'MB1AAAAAAZ0000003', 'ctc', 0, 'ctd', 100, 'mrp', 1180000, 'delivery_status', ' stock '));
  select * into r from public.vehicle_units where id = c;
  if r.make_year is null and r.gst_rate = 18 and r.retention_dealer = 0 and r.payment_status = 'Stock'
     and round(r.full_tax, 2) = 60000 and r.qty = 1 and r.road_tax_pct = 6 and r.purchase_source = 'al' then pass := pass + 1;
    else fail := fail + 1; msgs := msgs || ' |3a stock row ' || coalesce(r.make_year::text,'∅') || '/' || r.gst_rate || '/' || r.retention_dealer || '/' || r.payment_status || '/' || r.full_tax; end if;
  if r.app_amt is null then pass := pass + 1; else fail := fail + 1; msgs := msgs || ' |3b app_amt without a claim=' || r.app_amt; end if;

  update public.vehicle_units set ptb_invoice_date = '2025-09-21' where id = c;
  select * into r from public.vehicle_units where id = c;
  if r.gst_rate = 28 then pass := pass + 1; else fail := fail + 1; msgs := msgs || ' |3c 21 Sep gst=' || r.gst_rate; end if;
  update public.vehicle_units set ptb_invoice_date = '2025-09-22' where id = c;
  select * into r from public.vehicle_units where id = c;
  if r.gst_rate = 18 then pass := pass + 1; else fail := fail + 1; msgs := msgs || ' |3d 22 Sep gst=' || r.gst_rate; end if;
  update public.vehicle_units set ptb_invoice_date = '2025-07-31', tally_bill = 2360000 where id = c;
  select * into r from public.vehicle_units where id = c;   -- 31 Jul: the bill, at 28%: 2,360,000 / 1.28 × 6% = 110,625
  if round(r.full_tax, 2) = 110625 then pass := pass + 1; else fail := fail + 1; msgs := msgs || ' |3e 31 Jul full_tax=' || r.full_tax; end if;
  update public.vehicle_units set ptb_invoice_date = '2025-08-01' where id = c;
  select * into r from public.vehicle_units where id = c;   -- 1 Aug: MRP, at 28%: 1,180,000 / 1.28 × 6% = 55,312.50
  if round(r.full_tax, 2) = 55312.50 then pass := pass + 1; else fail := fail + 1; msgs := msgs || ' |3f 1 Aug full_tax=' || r.full_tax; end if;

  -- overrides
  update public.vehicle_units set gst_rate_override = 28, ptb_invoice_date = '2025-12-01' where id = c;
  select * into r from public.vehicle_units where id = c;
  if r.gst_rate = 28 then pass := pass + 1; else fail := fail + 1; msgs := msgs || ' |3g gst override=' || r.gst_rate; end if;
  update public.vehicle_units set road_tax_pct = 0, gst_rate_override = null where id = c;
  select * into r from public.vehicle_units where id = c;
  if r.full_tax = 0 then pass := pass + 1; else fail := fail + 1; msgs := msgs || ' |3h road_tax_pct 0 → ' || r.full_tax; end if;
  update public.vehicle_units set full_tax_override = 12345 where id = c;
  select * into r from public.vehicle_units where id = c;
  if r.full_tax = 12345 then pass := pass + 1; else fail := fail + 1; msgs := msgs || ' |3i full_tax override=' || r.full_tax; end if;

  ------------------------------------------------------------------------------------------------
  -- 4. The write path: apply, audit, conflict, reject, atomic, replay
  select count(*) into n from public.tracker_audit where unit_id = a;
  if n = 1 then pass := pass + 1; else fail := fail + 1; msgs := msgs || ' |4a audit rows after create=' || n; end if;

  res := public.tracker_apply_changes(me, gen_random_uuid(),
           jsonb_build_array(jsonb_build_object('unit_id', a, 'column', 'ctc', 'before', 3000000, 'after', 3100000)), 'probe-req-1');
  select * into r from public.vehicle_units where id = a;
  if (res ->> 'ok')::boolean and r.ctc = 3100000 and r.retention_dealer = 283000 and r.updated_by = me then pass := pass + 1;
    else fail := fail + 1; msgs := msgs || ' |4b apply ' || res::text || ' retention=' || r.retention_dealer; end if;
  select count(*) into n from public.tracker_audit where unit_id = a and column_key = 'ctc' and old_value = '3000000' and new_value = '3100000' and actor = me and source = 'typed';
  select count(*) into n2 from public.tracker_audit where unit_id = a and column_key in ('retention_dealer','total','net_refund','updated_at');
  if n = 1 and n2 = 0 then pass := pass + 1; else fail := fail + 1; msgs := msgs || ' |4c audit ctc=' || n || ' computed logged=' || n2; end if;

  -- replay: same request id → same answer, nothing applied twice
  res := public.tracker_apply_changes(me, gen_random_uuid(),
           jsonb_build_array(jsonb_build_object('unit_id', a, 'column', 'ctc', 'before', 3000000, 'after', 3100000)), 'probe-req-1');
  select count(*) into n from public.tracker_audit where unit_id = a and column_key = 'ctc';
  if (res ->> 'replayed')::boolean and n = 1 then pass := pass + 1; else fail := fail + 1; msgs := msgs || ' |4d replay ' || res::text || ' audit=' || n; end if;

  -- stale before-value → conflict, nothing written
  res := public.tracker_apply_changes(me, gen_random_uuid(),
           jsonb_build_array(jsonb_build_object('unit_id', a, 'column', 'ctc', 'before', 3000000, 'after', 1)), 'probe-req-2');
  select * into r from public.vehicle_units where id = a;
  if not (res ->> 'ok')::boolean and jsonb_array_length(res -> 'conflicts') = 1 and r.ctc = 3100000 then pass := pass + 1;
    else fail := fail + 1; msgs := msgs || ' |4e conflict ' || res::text; end if;

  -- a computed or system column → rejected
  res := public.tracker_apply_changes(me, gen_random_uuid(), jsonb_build_array(
           jsonb_build_object('unit_id', a, 'column', 'net_refund', 'before', null, 'after', 0),
           jsonb_build_object('unit_id', a, 'column', 'created_by', 'before', null, 'after', null),
           jsonb_build_object('unit_id', a, 'column', 'recompute', 'before', true, 'after', false)), 'probe-req-3');
  if not (res ->> 'ok')::boolean and jsonb_array_length(res -> 'rejected') = 3 then pass := pass + 1;
    else fail := fail + 1; msgs := msgs || ' |4f reject ' || res::text; end if;

  -- all or nothing: one good change + one stale change → neither lands
  res := public.tracker_apply_changes(me, gen_random_uuid(), jsonb_build_array(
           jsonb_build_object('unit_id', a, 'column', 'dse', 'before', null, 'after', 'PROBE DSE'),
           jsonb_build_object('unit_id', b, 'column', 'ctc', 'before', 999, 'after', 1)), 'probe-req-4');
  select * into r from public.vehicle_units where id = a;
  if not (res ->> 'ok')::boolean and r.dse is null then pass := pass + 1; else fail := fail + 1; msgs := msgs || ' |4g atomic dse=' || coalesce(r.dse,'∅'); end if;

  -- a number sent as text, a text before-value for a number column (spike: undo turned "1" into 1)
  res := public.tracker_apply_changes(me, gen_random_uuid(), jsonb_build_array(
           jsonb_build_object('unit_id', a, 'column', 'qty', 'before', '1', 'after', 2),
           jsonb_build_object('unit_id', a, 'column', 'ptb_invoice_date', 'before', '2025-07-15', 'after', '2025-10-01')), 'probe-req-5');
  select * into r from public.vehicle_units where id = a;
  if (res ->> 'ok')::boolean and r.qty = 2 and r.gst_rate = 18 and r.payment_amount = 5620000 then pass := pass + 1;
    else fail := fail + 1; msgs := msgs || ' |4h types ' || res::text || ' qty=' || r.qty || ' pay=' || r.payment_amount; end if;

  -- a bad value raises and writes nothing
  begin
    perform public.tracker_apply_changes(me, gen_random_uuid(), jsonb_build_array(
      jsonb_build_object('unit_id', b, 'column', 'dse', 'before', null, 'after', 'SHOULD NOT LAND'),
      jsonb_build_object('unit_id', b, 'column', 'ctc', 'before', 3000000, 'after', 'abc')), 'probe-req-6');
    fail := fail + 1; msgs := msgs || ' |4i bad number accepted';
  exception when others then
    select * into r from public.vehicle_units where id = b;
    if r.dse is null and r.ctc = 3000000 then pass := pass + 1; else fail := fail + 1; msgs := msgs || ' |4i partial write on error'; end if;
  end;

  ------------------------------------------------------------------------------------------------
  -- 5. Identity rules
  begin
    perform public.tracker_create_unit(me, null, jsonb_build_object('chassis_no', ' MB1AAAAAAS0000001 '));
    fail := fail + 1; msgs := msgs || ' |5a duplicate active chassis accepted';
  exception when unique_violation then pass := pass + 1;
  end;
  update public.vehicle_units set superseded_at = now() where id = a;
  d := public.tracker_create_unit(me, null, jsonb_build_object('chassis_no', 'MB1AAAAAAS0000001'));
  if d is not null then pass := pass + 1; else fail := fail + 1; msgs := msgs || ' |5b rebill after supersede'; end if;
  begin
    perform public.tracker_create_unit(me, null, jsonb_build_object('chassis_no', '   '));
    fail := fail + 1; msgs := msgs || ' |5c blank chassis accepted';
  exception when others then pass := pass + 1;
  end;

  -- 6. The importer writes history as-is (recompute = false); the next edit recomputes
  insert into public.vehicle_units (chassis_no, ctc, ctd, retention_dealer, tcs, recompute)
  values ('MB1AAAAAAS0000009', 100, 50, 777, 1, false) returning id into d;
  select * into r from public.vehicle_units where id = d;
  if r.retention_dealer = 777 and r.tcs = 1 and r.make_year = 2025 then pass := pass + 1; else fail := fail + 1; msgs := msgs || ' |6a import kept=' || r.retention_dealer; end if;
  res := public.tracker_apply_changes(me, gen_random_uuid(),
           jsonb_build_array(jsonb_build_object('unit_id', d, 'column', 'ctd', 'before', 50, 'after', 40)), 'probe-req-7');
  select * into r from public.vehicle_units where id = d;
  if r.retention_dealer = 60 and r.recompute then pass := pass + 1; else fail := fail + 1; msgs := msgs || ' |6b recompute after edit=' || r.retention_dealer; end if;

  ------------------------------------------------------------------------------------------------
  -- 7. Nobody but service_role can touch any of it; RLS on every table
  select count(*) into n from unnest(array['tracker_import_batches','vehicle_units','vehicle_unit_incentives',
    'unit_cell_notes','unit_cell_formats','tracker_views','tracker_audit','tracker_requests']) t(name)
   where has_table_privilege('anon', 'public.' || t.name, 'select') or has_table_privilege('authenticated', 'public.' || t.name, 'select')
      or has_table_privilege('authenticated', 'public.' || t.name, 'insert') or has_table_privilege('authenticated', 'public.' || t.name, 'update');
  if n = 0 then pass := pass + 1; else fail := fail + 1; msgs := msgs || ' |7a API roles can reach ' || n || ' tables'; end if;
  select count(*) into n from pg_class where relnamespace = 'public'::regnamespace and relrowsecurity
     and relname in ('tracker_import_batches','vehicle_units','vehicle_unit_incentives','unit_cell_notes','unit_cell_formats','tracker_views','tracker_audit','tracker_requests');
  if n = 8 then pass := pass + 1; else fail := fail + 1; msgs := msgs || ' |7b RLS on ' || n || '/8'; end if;
  if not has_function_privilege('authenticated', 'public.tracker_apply_changes(uuid,uuid,jsonb,text,text)', 'execute')
     and not has_function_privilege('anon', 'public.tracker_apply_changes(uuid,uuid,jsonb,text,text)', 'execute')
     and not has_function_privilege('authenticated', 'public.tracker_create_unit(uuid,uuid,jsonb)', 'execute')
     and has_function_privilege('service_role', 'public.tracker_apply_changes(uuid,uuid,jsonb,text,text)', 'execute') then pass := pass + 1;
    else fail := fail + 1; msgs := msgs || ' |7c function grants wrong'; end if;

  ------------------------------------------------------------------------------------------------
  -- 8. The TCS checks separate the right basis (tally bill) from round 1's wrong one (ctc × 1%)
  create or replace function pg_temp.wrong_tcs(p public.vehicle_units) returns numeric language sql as $$ select coalesce(p.ctc,0) * 0.01 $$;
  select * into r from public.vehicle_units where id = b;
  if pg_temp.wrong_tcs(r) <> 30500 and r.tcs = 30500 then pass := pass + 1; else fail := fail + 1; msgs := msgs || ' |8 negative control did not separate'; end if;

  raise exception 'PROBE COMPLETE: % passed, % failed%', pass, fail, case when fail > 0 then ' —' || msgs else '' end;
end
$probe$;
