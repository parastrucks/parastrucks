-- Phase 10 import — the RECOMPUTE-AND-DIFF per financial year (of the PTB invoice date; 'none' = not sold).
-- Same idea as recompute-diff.sql, split by year, to show whether the database's rules hold for older years.
-- SELF-ABORTING, counts only: it ends in an error reading "RECOMPUTE-BY-YEAR: …" and rolls everything back.
do $diff$
declare
  b uuid := (select id from public.tracker_import_batches order by created_at desc limit 1);
  n int; out text := ''; col text; y text;
  money text[] := array['retention_dealer','payment_amount','tds','total_payment_to_al','diff_base',
    'tcs','total','full_tax','total_receivable','net_refund','retention_internal','app_amt','dealer_net_payable'];
begin
  create temp table hist on commit drop as select * from public.vehicle_units where import_batch_id = b;
  update public.vehicle_units set recompute = true where import_batch_id = b;
  for y in select distinct coalesce(case when extract(month from ptb_invoice_date) >= 4 then extract(year from ptb_invoice_date)::int
             else extract(year from ptb_invoice_date)::int - 1 end::text, 'none') from hist order by 1 loop
    select count(*) into n from hist h where coalesce(case when extract(month from h.ptb_invoice_date) >= 4 then extract(year from h.ptb_invoice_date)::int
             else extract(year from h.ptb_invoice_date)::int - 1 end::text, 'none') = y;
    out := out || format(E'\nFY %s (%s rows):', y, n);
    foreach col in array money loop
      execute format(
        'select count(*) from public.vehicle_units v join hist h using (id)
          where coalesce(case when extract(month from h.ptb_invoice_date) >= 4 then extract(year from h.ptb_invoice_date)::int
                else extract(year from h.ptb_invoice_date)::int - 1 end::text, ''none'') = $1
            and h.%1$I is not null and abs(coalesce(v.%1$I, 0) - h.%1$I) >= 1', col) into n using y;
      if n > 0 then out := out || format(' %s %s', col, n); end if;
    end loop;
  end loop;
  raise exception 'RECOMPUTE-BY-YEAR: %', out;
end;
$diff$;
