-- Clear ghost judgment months: rows the pre-fix parser (2026-08-21) invented by
-- coercing blank cells to 0. Both prediction sheets in the workbook stop at Sep-26
-- (14 rows); the DB held 20. The extra Oct-26..Mar-27 rows are all-zero fabrications.
-- Owner approved 2026-08-25.
--
-- The cutoff is COMPUTED from the data, never hardcoded: the last judgment month that
-- carries any non-zero value. Only all-zero rows AFTER that cutoff are removed, so a
-- genuine zero inside the series can never be hit (the rule that saved the six real
-- 2022 PTB ramp-up months). The block self-aborts if the blast radius exceeds 6 per
-- table or if the cutoff is not the expected Sep-26.
do $$
declare
  v_entity uuid; v_brand uuid;
  v_cut_t date; v_cut_p date;
  v_t int; v_p int;
  v_snap jsonb;
begin
  select entity_id, brand_id into v_entity, v_brand
    from public.tiv_forecast_judgment_tiv limit 1;

  select max(to_date(month_label,'Mon-YY')) into v_cut_t
    from public.tiv_forecast_judgment_tiv
   where (coalesce(bus_pvt,0)+coalesce(haulage,0)+coalesce(mav,0)+coalesce(tractor,0)+coalesce(tipper,0)+coalesce(icv_trucks,0)) > 0;
  select max(to_date(month_label,'Mon-YY')) into v_cut_p
    from public.tiv_forecast_judgment_ptb
   where (coalesce(bus_pvt,0)+coalesce(haulage,0)+coalesce(mav,0)+coalesce(tractor,0)+coalesce(tipper,0)+coalesce(icv_trucks,0)) > 0;

  if v_cut_t is distinct from date '2026-09-01' or v_cut_p is distinct from date '2026-09-01' then
    raise exception 'refusing to run: unexpected cutoff tiv=% ptb=% (expected 2026-09-01)', v_cut_t, v_cut_p;
  end if;

  select count(*) into v_t from public.tiv_forecast_judgment_tiv
   where to_date(month_label,'Mon-YY') > v_cut_t
     and (coalesce(bus_pvt,0)+coalesce(haulage,0)+coalesce(mav,0)+coalesce(tractor,0)+coalesce(tipper,0)+coalesce(icv_trucks,0)) = 0;
  select count(*) into v_p from public.tiv_forecast_judgment_ptb
   where to_date(month_label,'Mon-YY') > v_cut_p
     and (coalesce(bus_pvt,0)+coalesce(haulage,0)+coalesce(mav,0)+coalesce(tractor,0)+coalesce(tipper,0)+coalesce(icv_trucks,0)) = 0;

  if v_t > 6 or v_p > 6 then
    raise exception 'refusing to run: blast radius too large (tiv=%, ptb=%)', v_t, v_p;
  end if;

  -- Snapshot BOTH tables whole, so the delete is revertible from the row itself.
  select jsonb_build_object(
           'judgment_tiv', (select jsonb_agg(to_jsonb(t)) from public.tiv_forecast_judgment_tiv t),
           'judgment_ptb', (select jsonb_agg(p)  from (select to_jsonb(x) p from public.tiv_forecast_judgment_ptb x) s),
           'cutoff', v_cut_t,
           'to_delete_tiv', v_t,
           'to_delete_ptb', v_p)
    into v_snap;

  insert into public.tiv_forecast_snapshots (entity_id, brand_id, reason, payload)
  values (v_entity, v_brand, 'pre-clear-ghost-judgment-months', v_snap);

  delete from public.tiv_forecast_judgment_tiv
   where to_date(month_label,'Mon-YY') > v_cut_t
     and (coalesce(bus_pvt,0)+coalesce(haulage,0)+coalesce(mav,0)+coalesce(tractor,0)+coalesce(tipper,0)+coalesce(icv_trucks,0)) = 0;

  delete from public.tiv_forecast_judgment_ptb
   where to_date(month_label,'Mon-YY') > v_cut_p
     and (coalesce(bus_pvt,0)+coalesce(haulage,0)+coalesce(mav,0)+coalesce(tractor,0)+coalesce(tipper,0)+coalesce(icv_trucks,0)) = 0;

  raise notice 'cleared % tiv + % ptb ghost judgment months (cutoff %)', v_t, v_p, v_cut_t;
end $$;
