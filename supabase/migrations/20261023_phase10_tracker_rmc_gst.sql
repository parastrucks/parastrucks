-- Phase 10 — Vehicle Tracker: RMC trucks are 18% GST on any date (owner, 2026-10-23: "only RMC always
-- at 18%").
--
-- The 2025-26 sheet agrees: every row with a real invoice date before 22 Sep 2025 billed at 18% is an
-- RMC chassis (63 rows, model "… R RMC", filed under segment TIPPER) except one tractor; one RMC row was
-- billed at 28% (scripts/phase10/gst_rmc.cjs). RMC is read from the model name as a whole word, any
-- case. Only vehicle_units_compute changes (one CASE branch); same signature, the trigger keeps using it.
-- Rows already stored keep their rate until they are next saved (the trigger recomputes on save).
-- Requires 20261021_phase10_tracker_foundation.sql.
--
-- Rollback: re-run the vehicle_units_compute definition from 20261021_phase10_tracker_foundation.sql.

begin;

create or replace function public.vehicle_units_compute() returns trigger
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

  -- RMC (transit-mixer) chassis are 18% on any date (owner, 2026-10-23); every other truck 28% on
  -- invoices before 22 Sep 2025, else 18% (unsold stock = 18%). An override wins.
  new.gst_rate := coalesce(new.gst_rate_override,
    case when coalesce(new.model, '') ~* '\mRMC\M' then 18
         when new.ptb_invoice_date is not null and new.ptb_invoice_date < date '2025-09-22' then 28
         else 18 end);
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

commit;
