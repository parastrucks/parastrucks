-- Phase 10 — Vehicle Tracker: the AL Balance Sheet review on a COLD database.
--
-- After 20261028_phase10_tracker_al_review_fast.sql the review ran 2.3–4.2 s through the API when warm — but the
-- FIRST call after a quiet spell still failed (> PostgREST's 8 s), twice on 2026-10-28, and the next took 6.4 s.
-- The panel is opened about once a month, so it is nearly always cold. Measured (EXPLAIN ANALYZE, BUFFERS):
--   · the review's `units` reads 7 columns of every current truck — a Seq Scan of the whole of vehicle_units
--     (55 MB, 6,997 pages; 1.1–1.2 s even with every page in memory, all of it from disk when cold);
--   · it spilled to temp files (work_mem 2 MB here: the 31,860-truck list does not fit).
-- This adds a narrow covering index with exactly those 7 columns, so the scan becomes an Index Only Scan
-- (measured in a rolled-back try: 0.07 s instead of 1.1 s; pages touched 1,208 instead of 7,383, 441 of them read
-- from disk; the whole review 2.3 s → 1.1 s), and gives the review its own work_mem so it no longer spills.
-- The function itself is unchanged. Cost: tracker edits to these 7 columns update one more index.
-- Rollback: drop index public.vehicle_units_al_review; alter function public.tracker_al_review() reset work_mem;

begin;

create index vehicle_units_al_review on public.vehicle_units (chassis_no)
  include (id, ctd, ptb_invoice_date, al_payment_status, al_payment_date, mto_advance, vpart_no)
  where superseded_at is null;

alter function public.tracker_al_review() set work_mem = '16MB';

commit;

analyze public.vehicle_units;
