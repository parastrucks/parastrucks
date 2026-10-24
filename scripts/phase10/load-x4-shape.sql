-- Phase 10 — make the 4× LOAD TEST rows (load-x4.sql) look like years of real history. STAGING ONLY, DUMMY rows.
--
-- load-x4.sql copied the DEMO seed 11 times, so every copy carries the seed's 2025-26 dates and its random
-- statuses (75% "still open"). Real history is spread over years and mostly closed: in the real 2022-26 files
-- 1,491 of 5,832 older trucks are still open (26%). This script:
--   · copy 1 (DEMO-L1-…) moves ONE year forward → the current financial year at the 4× size (~2,050 trucks);
--   · copies 2–11 move back (k − 1) years → ten past years of ~2,050 each;
--   · of those past copies, a share :open keeps its statuses (seed: ~75% open → share 0.35 ≈ 26% open, the
--     real proportion — the PESSIMISTIC case, nothing old ever closed); the rest are CLOSED (AL paid, delivered,
--     refunded, finance received, invoiced). share 0 = the STEADY case (only the seed's own ~1,500 open
--     older trucks stay open — about today's real count).
-- The audit trigger is switched off for the one update (this is test shaping, not a person's edit) and on again.
-- Run with psql-style variable substitution not available in db query, so the share is the literal below.
begin;
alter table public.vehicle_units disable trigger vehicle_units_audit;
do $shape$
declare
  share numeric := 0.35;   -- ← 0.35 pessimistic · 0 steady
  b uuid := (select id from public.tracker_import_batches where source_file = 'DEMO LOAD x4');
  sets text;
begin
  if b is null then raise exception 'no DEMO LOAD x4 batch'; end if;
  select string_agg(format('%1$I = %1$I + make_interval(years => y.shift)', column_name), ', ') into sets
    from information_schema.columns where table_schema = 'public' and table_name = 'vehicle_units' and data_type = 'date';
  -- dates: copy k → shift (k = 1: +1 year, k ≥ 2: −(k − 1) years), counted from the original seed row
  execute format($u$
    update public.vehicle_units v set %s
      from (select id, case when k = 1 then 1 else 1 - k end as shift
              from (select id, substring(chassis_no from '^DEMO-L(\d+)-')::int as k from public.vehicle_units where import_batch_id = $1) q) y
     where v.id = y.id and v.source_file = 'DEMO LOAD x4' and v.updated_at = v.created_at$u$, sets) using b;
  -- statuses: past copies closed except a share (by a stable hash of the id)
  update public.vehicle_units v set
         al_payment_status = 'Cash Invoiced', delivery_status = 'DELIVERED', refund_status = 'REFUNDED',
         ptb_invoice_date = coalesce(ptb_invoice_date, oem_gatepass_date + 30, date '2020-01-01'),
         date_of_retail = coalesce(date_of_retail, ptb_invoice_date, oem_gatepass_date + 30, date '2020-01-01'),
         finance_paymt_recd_date = case when finance_bank is not null then coalesce(finance_paymt_recd_date, ptb_invoice_date, oem_gatepass_date + 40) end
   where v.import_batch_id = b and substring(chassis_no from '^DEMO-L(\d+)-')::int >= 2
     and ('x' || substr(md5(v.id::text), 1, 8))::bit(32)::bigint / 4294967296.0 >= share;
  update public.vehicle_units set updated_at = now() where import_batch_id = b;   -- marks the rows as shaped (the date shift runs once)
end;
$shape$;
alter table public.vehicle_units enable trigger vehicle_units_audit;
select count(*) filter (where public.tracker_still_open(v.superseded_at, v.ptb_invoice_date, v.date_of_retail, v.delivery_status, v.al_payment_status, v.refund_status, v.finance_bank, v.finance_paymt_recd_date)) open_now, count(*) total from public.vehicle_units v;
commit;
