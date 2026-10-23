-- Phase 10 import — the full RECOMPUTE-AND-DIFF of every worked-out column on every imported row (A5/R2-22).
-- SELF-ABORTING: it ends in an error that reads "RECOMPUTE-DIFF: …" and everything it did is rolled back,
-- so the imported history stays exactly as the workbooks hold it. Prints COUNTS only.
--
-- For each worked-out column: how many imported rows the database's own rule would give a different
-- figure (more than ₹1 apart; text for payment status). A difference is not an error by itself — the
-- home-file rule takes inputs (CTC from retail) that the purchase file's own formula never saw.
do $diff$
declare
  b uuid := (select id from public.tracker_import_batches order by created_at desc limit 1);
  n int; out text := ''; col text;
  money text[] := array['retention_dealer','payment_amount','tds','total_payment_to_al','diff_amount','diff_base',
    'diff_gst','diff_tds','total_difference','tcs','total','total_recd','full_tax','total_receivable','net_refund',
    'retention_internal','app_amt','dealer_basic_value','dealer_tds','dealer_net_payable'];
begin
  if b is null then raise exception 'RECOMPUTE-DIFF: no import batch'; end if;
  create temp table hist on commit drop as select * from public.vehicle_units where import_batch_id = b;
  update public.vehicle_units set recompute = true where import_batch_id = b;
  select count(*) into n from hist;
  out := format('%s rows', n);
  foreach col in array money loop
    execute format(
      'select count(*) from public.vehicle_units v join hist h using (id)
        where h.%1$I is not null and abs(coalesce(v.%1$I, 0) - h.%1$I) >= 1', col) into n;
    out := out || format(' · %s %s', col, n);
  end loop;
  select count(*) into n from public.vehicle_units v join hist h using (id)
   where h.payment_status is not null and v.payment_status is distinct from h.payment_status;
  out := out || format(' · payment_status %s', n);
  -- history the workbook did not have (a worked-out column left empty there, e.g. a truck not yet sold)
  select count(*) into n from public.vehicle_units v join hist h using (id) where h.tcs is null and coalesce(v.tcs, 0) <> 0;
  out := out || format(' · (tcs filled where the workbook had none: %s)', n);
  raise exception 'RECOMPUTE-DIFF: %', out;
end;
$diff$;
