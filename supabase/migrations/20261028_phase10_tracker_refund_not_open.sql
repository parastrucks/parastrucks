-- Phase 10 — Vehicle Tracker: a pending refund no longer keeps an OLDER truck in the working set.
--
-- Owner, 2026-10-28: "No refunds that old will be pending. Refunds are generally pending only from the current
-- month." After the all-years load (2026-10-27) 1,362 trucks from earlier years stayed in the working set ONLY
-- because their refund column still read Pending / To collect / P / TO — a column nobody closed once the money
-- went out (2022-23 36 · 2023-24 160 · 2024-25 258 · 2025-26 908). A refund that really is pending belongs to a
-- truck of the current month, which the working set already holds by its date (this financial year), so the
-- refund test is dropped from "still open" — and from nothing else: the refund column keeps exactly what the
-- books say, and the screen still shows it.
--
-- tracker_still_open keeps its arguments (tracker_book calls it with them, and the partial index is built on
-- them); p_refund is no longer read. Postgres lets an IMMUTABLE function be replaced under an index without
-- rebuilding it — the index would then keep the OLD answers — so the index is dropped and built again here.
-- Sorts after 20261024_phase10_tracker_working_set.sql, the last migration that defined the function.
-- Rollback: re-run the tracker_still_open + vehicle_units_still_open block of 20261024_phase10_tracker_working_set.sql
--           (drop the index first, as here).

begin;

drop index if exists public.vehicle_units_still_open;

create or replace function public.tracker_still_open(
  p_superseded_at timestamptz, p_invoice date, p_retail date, p_delivery text, p_al_status text,
  p_refund text, p_finance_bank text, p_finance_recd date
) returns boolean
language sql immutable
set search_path = ''
as $$
  select p_superseded_at is null and (
       (p_invoice is null and p_retail is null and lower(btrim(coalesce(p_delivery, ''))) !~ 'deliver')
    or (btrim(coalesce(p_al_status, '')) <> ''
          and lower(btrim(p_al_status)) not in ('cash invoiced', 'fresh offtake'))
    or lower(btrim(coalesce(p_delivery, ''))) in ('pending', 'stock')
    or (btrim(coalesce(p_finance_bank, '')) <> '' and p_finance_bank !~* 'cash'
          and p_finance_recd is null and p_invoice is not null))
$$;

create index vehicle_units_still_open on public.vehicle_units (created_at, id)
  where public.tracker_still_open(superseded_at, ptb_invoice_date, date_of_retail, delivery_status, al_payment_status,
                                  refund_status, finance_bank, finance_paymt_recd_date);

revoke all on function public.tracker_still_open(timestamptz, date, date, text, text, text, text, date) from public, anon, authenticated;
grant execute on function public.tracker_still_open(timestamptz, date, date, text, text, text, text, date) to service_role;

commit;
