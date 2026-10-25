-- Phase 10 — how long tracker_al_review takes with a year of sheets on the whole book. SELF-ABORTING
-- (ends in an error reading "TIMING …"; everything is rolled back). STAGING: uses the trucks already there.
-- 12 months (2099-01 … 12) × 250 truck lines on real rows of the book + 60 money lines a month — about a
-- year of the real 2025-26 sheets (2,006 truck lines, 609 money lines). The Edge Function calls the review
-- through PostgREST, so it must finish well inside the authenticator's 8 s statement_timeout.
do $t$
declare
  me uuid := gen_random_uuid(); m int; lines jsonb; t0 timestamptz; t1 timestamptz; r jsonb; trucks int;
begin
  select count(*) into trucks from public.vehicle_units where superseded_at is null;
  for m in 1 .. 12 loop
    select jsonb_agg(x order by (x ->> 'row_no')::int) into lines from (
      select jsonb_build_object('row_no', 1 + row_number() over (order by v.id), 'line_date', make_date(2099, m, 5),
             'details', 'probe', 'chassis_no', v.chassis_no, 'offtake_mode', case when v.id::text < '8' then 'FRESH OFFTAKE' else 'IBND' end,
             'ctd', coalesce(v.ctd, 1000), 'credit', round(coalesce(v.ctd, 1000) * 0.999, 2), 'credit_is_formula', true) x
        from (select * from public.vehicle_units where superseded_at is null order by id offset (m - 1) * 250 limit 250) v
      union all
      select jsonb_build_object('row_no', 300 + g, 'line_date', make_date(2099, m, 6), 'details', 'INDENT', 'debit', 1000)
        from generate_series(1, 60) g) q;
    perform public.tracker_al_upload(me, make_date(2099, m, 1), 'time-' || m, md5(m::text) || md5(m::text), false, lines);
  end loop;
  t0 := clock_timestamp();
  r := public.tracker_al_review();
  t1 := clock_timestamp();
  raise exception 'TIMING: review % ms · % issues · % months · % trucks in the book',
    round(extract(epoch from t1 - t0) * 1000), jsonb_array_length(r -> 'issues'), jsonb_array_length(r -> 'months'), trucks;
end;
$t$;
