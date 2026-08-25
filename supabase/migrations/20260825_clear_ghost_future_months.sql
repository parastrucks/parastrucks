-- Remove the all-zero future months written on 2026-08-21 by the pre-2026-08-25
-- parser, which read the workbook's pre-typed future Month column as
-- `Number('') || 0`. Owner approved 2026-08-25.
--
-- The predicate is "empty AND after the last month that carries real data",
-- computed from the data itself -- never "value is zero", because the six
-- all-zero PTB months in 2022 are GENUINE ramp-up zeros, verified cell by cell
-- in the source workbook. Those must survive.
DO $cleanup$
DECLARE
  v_cutoff  integer;
  v_snap    bigint;
  v_tiv     integer;
  v_ptb     integer;
  v_entity  uuid;
  v_brand   uuid;
BEGIN
  SELECT max(month_index) INTO v_cutoff
  FROM public.tiv_forecast_tiv_actuals
  WHERE (bus_pvt + haulage + mav + tractor + tipper + icv_trucks) > 0;

  IF v_cutoff IS NULL THEN
    RAISE EXCEPTION 'refusing to run: no month with real data found';
  END IF;

  SELECT entity_id, brand_id INTO v_entity, v_brand
  FROM public.tiv_forecast_tiv_actuals LIMIT 1;

  -- Full copy of both tables before touching anything, in the same transaction.
  INSERT INTO public.tiv_forecast_snapshots (entity_id, brand_id, taken_by, reason, payload)
  VALUES (
    v_entity, v_brand, NULL, 'pre-ghost-cleanup',
    jsonb_build_object(
      'cutoff_month_index', v_cutoff,
      'tiv_actuals', (SELECT coalesce(jsonb_agg(to_jsonb(x)), '[]'::jsonb) FROM public.tiv_forecast_tiv_actuals x),
      'ptb_actuals', (SELECT coalesce(jsonb_agg(to_jsonb(x)), '[]'::jsonb) FROM public.tiv_forecast_ptb_actuals x)
    )
  )
  RETURNING id INTO v_snap;

  DELETE FROM public.tiv_forecast_tiv_actuals
  WHERE month_index > v_cutoff
    AND (bus_pvt + haulage + mav + tractor + tipper + icv_trucks) = 0;
  GET DIAGNOSTICS v_tiv = ROW_COUNT;

  DELETE FROM public.tiv_forecast_ptb_actuals
  WHERE month_index > v_cutoff
    AND (bus_pvt + haulage + mav + tractor + tipper + icv_trucks) = 0;
  GET DIAGNOSTICS v_ptb = ROW_COUNT;

  IF v_tiv > 12 OR v_ptb > 12 THEN
    RAISE EXCEPTION 'refusing to run: would delete % tiv and % ptb rows, far more than the 8+8 expected', v_tiv, v_ptb;
  END IF;

  RAISE NOTICE 'cutoff=% snapshot=% deleted tiv=% ptb=%', v_cutoff, v_snap, v_tiv, v_ptb;
END
$cleanup$;
