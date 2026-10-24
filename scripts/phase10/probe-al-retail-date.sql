-- Phase 10 — probe for 20261024_phase10_tracker_al_retail_date.sql (the AL Retail Date column).
-- SELF-ABORTING: a green run ENDS IN AN ERROR that reads "PROBE COMPLETE: N passed, 0 failed".
-- Everything it writes is rolled back with that error.
do $probe$
declare
  pass int := 0; fail int := 0; msgs text := '';
  me uuid := gen_random_uuid();
  u uuid; res jsonb; n int;
begin
  -- 1. the column exists and is a date
  if (select data_type from information_schema.columns
       where table_schema = 'public' and table_name = 'vehicle_units' and column_name = 'al_retail_date') = 'date'
    then pass := pass + 1; else fail := fail + 1; msgs := msgs || ' |1 no date column'; end if;

  -- 2. a new row can carry it
  u := public.tracker_create_unit(me, gen_random_uuid(),
         '{"chassis_no":"MB1PROBEALR000001","date_of_retail":"2025-10-30","al_retail_date":"2025-11-04"}'::jsonb);
  if (select al_retail_date from public.vehicle_units where id = u) = date '2025-11-04' then pass := pass + 1;
    else fail := fail + 1; msgs := msgs || ' |2 not stored on create'; end if;

  -- 3. a person can type it (it is on the editable list), and the edit is audited
  res := public.tracker_apply_changes(me, gen_random_uuid(),
           ('[{"unit_id":"' || u || '","column":"al_retail_date","before":"2025-11-04","after":"2025-11-06"}]')::jsonb,
           gen_random_uuid()::text, 'typed');
  if (res ->> 'ok')::boolean and (select al_retail_date from public.vehicle_units where id = u) = date '2025-11-06'
    then pass := pass + 1; else fail := fail + 1; msgs := msgs || ' |3 edit refused ' || res; end if;
  select count(*) into n from public.tracker_audit where unit_id = u and column_key = 'al_retail_date'
     and old_value = '2025-11-04' and new_value = '2025-11-06';
  if n = 1 then pass := pass + 1; else fail := fail + 1; msgs := msgs || ' |3b audit rows ' || n; end if;

  -- 4. cleared back to empty
  res := public.tracker_apply_changes(me, gen_random_uuid(),
           ('[{"unit_id":"' || u || '","column":"al_retail_date","before":"2025-11-06","after":null}]')::jsonb,
           gen_random_uuid()::text, 'typed');
  if (res ->> 'ok')::boolean and (select al_retail_date from public.vehicle_units where id = u) is null
    then pass := pass + 1; else fail := fail + 1; msgs := msgs || ' |4 clear ' || res; end if;

  -- 5. the internal retail date is its own column, untouched and still editable
  res := public.tracker_apply_changes(me, gen_random_uuid(),
           ('[{"unit_id":"' || u || '","column":"date_of_retail","before":"2025-10-30","after":"2025-10-31"}]')::jsonb,
           gen_random_uuid()::text, 'typed');
  if (res ->> 'ok')::boolean then pass := pass + 1; else fail := fail + 1; msgs := msgs || ' |5 date_of_retail ' || res; end if;

  raise exception 'PROBE COMPLETE: % passed, % failed%', pass, fail, case when fail > 0 then ' —' || msgs else '' end;
end;
$probe$;
