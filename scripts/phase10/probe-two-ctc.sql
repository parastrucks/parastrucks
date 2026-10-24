-- Phase 10 — probe for 20261024_phase10_tracker_two_ctc.sql (two CTCs: PTB CTC and AL CTC).
-- SELF-ABORTING: a green run ENDS IN AN ERROR that reads "PROBE COMPLETE: N passed, 0 failed".
-- Everything it writes is rolled back with that error.
do $probe$
declare
  pass int := 0; fail int := 0; msgs text := '';
  me uuid := gen_random_uuid();
  u uuid; b uuid; res jsonb; n int; v record;
begin
  -- 1. the column exists and is numeric
  if (select data_type from information_schema.columns
       where table_schema = 'public' and table_name = 'vehicle_units' and column_name = 'al_ctc') = 'numeric'
    then pass := pass + 1; else fail := fail + 1; msgs := msgs || ' |1 no numeric al_ctc'; end if;

  -- 2. PTB CTC 28,50,000 · AL CTC 28,00,000 · CTD 26,00,000 · AL claim 3,00,000
  u := public.tracker_create_unit(me, gen_random_uuid(),
         '{"chassis_no":"MB1PROBECTC000001","ctc":2850000,"al_ctc":2800000,"ctd":2600000,"retention_al_claim":300000}'::jsonb);
  select * into v from public.vehicle_units where id = u;
  -- the AL side works on AL CTC
  if v.retention_dealer = 200000 then pass := pass + 1; else fail := fail + 1; msgs := msgs || ' |2a retention_dealer ' || v.retention_dealer; end if;
  if v.app_amt = 100000 then pass := pass + 1; else fail := fail + 1; msgs := msgs || ' |2b app_amt ' || v.app_amt; end if;
  -- the internal side works on PTB CTC
  if v.retention_internal = 250000 then pass := pass + 1; else fail := fail + 1; msgs := msgs || ' |2c retention_internal ' || v.retention_internal; end if;
  if v.total = 2850000 then pass := pass + 1; else fail := fail + 1; msgs := msgs || ' |2d total ' || v.total; end if;

  -- 3. a blank AL CTC = AL was told the PTB figure
  b := public.tracker_create_unit(me, gen_random_uuid(),
         '{"chassis_no":"MB1PROBECTC000002","ctc":2850000,"ctd":2600000,"retention_al_claim":300000}'::jsonb);
  select * into v from public.vehicle_units where id = b;
  if v.retention_dealer = 250000 and v.app_amt = 50000 and v.retention_internal = 250000
    then pass := pass + 1; else fail := fail + 1; msgs := msgs || ' |3 blank al_ctc ' || v.retention_dealer || '/' || v.app_amt; end if;

  -- 4. a person can type AL CTC; the row is reworked and the edit audited
  res := public.tracker_apply_changes(me, gen_random_uuid(),
           ('[{"unit_id":"' || b || '","column":"al_ctc","before":null,"after":2750000}]')::jsonb,
           gen_random_uuid()::text, 'typed');
  select * into v from public.vehicle_units where id = b;
  if (res ->> 'ok')::boolean and v.retention_dealer = 150000 and v.app_amt = 150000 and v.retention_internal = 250000
    then pass := pass + 1; else fail := fail + 1; msgs := msgs || ' |4 edit ' || res || ' ' || coalesce(v.retention_dealer::text, '-'); end if;
  select count(*) into n from public.tracker_audit where unit_id = b and column_key = 'al_ctc' and new_value = '2750000';
  if n = 1 then pass := pass + 1; else fail := fail + 1; msgs := msgs || ' |4b audit rows ' || n; end if;

  -- 5. editing PTB CTC leaves the AL side alone
  res := public.tracker_apply_changes(me, gen_random_uuid(),
           ('[{"unit_id":"' || u || '","column":"ctc","before":2850000,"after":2900000}]')::jsonb,
           gen_random_uuid()::text, 'typed');
  select * into v from public.vehicle_units where id = u;
  if (res ->> 'ok')::boolean and v.retention_dealer = 200000 and v.app_amt = 100000 and v.retention_internal = 300000
    then pass := pass + 1; else fail := fail + 1; msgs := msgs || ' |5 ptb edit ' || res; end if;

  raise exception 'PROBE COMPLETE: % passed, % failed%', pass, fail, case when fail > 0 then ' —' || msgs else '' end;
end;
$probe$;
