-- Phase 10 Stage 2 — probe for 20261022_phase10_tracker_numeric_before.sql.
-- SELF-ABORTING: a green run ENDS IN AN ERROR that reads "PROBE COMPLETE: N passed, 0 failed".
-- Everything it writes is rolled back with that error.
do $probe$
declare
  pass int := 0; fail int := 0; msgs text := '';
  me uuid := gen_random_uuid();
  u uuid; res jsonb;
begin
  u := public.tracker_create_unit(me, gen_random_uuid(),
         '{"chassis_no":"MB1PROBENUM000001","ctc":1310.50,"engine_no":"1"}'::jsonb);
  if (select ctc::text from public.vehicle_units where id = u) = '1310.50' then pass := pass + 1;
    else fail := fail + 1; msgs := msgs || ' |0 setup: ctc not stored as 1310.50'; end if;

  -- 1. the browser sends 1310.5 (read as JSON) → NOT a conflict
  res := public.tracker_apply_changes(me, gen_random_uuid(),
           ('[{"unit_id":"' || u || '","column":"ctc","before":1310.5,"after":1400}]')::jsonb, gen_random_uuid()::text, 'typed');
  if (res ->> 'ok')::boolean then pass := pass + 1; else fail := fail + 1; msgs := msgs || ' |1 1310.5 vs 1310.50 = conflict ' || res; end if;

  -- 2. a stale number → still a conflict
  res := public.tracker_apply_changes(me, gen_random_uuid(),
           ('[{"unit_id":"' || u || '","column":"ctc","before":1310.5,"after":1500}]')::jsonb, gen_random_uuid()::text, 'typed');
  if not (res ->> 'ok')::boolean and jsonb_array_length(res -> 'conflicts') = 1 then pass := pass + 1;
    else fail := fail + 1; msgs := msgs || ' |2 stale value applied ' || res; end if;

  -- 3. the text rule still holds: "1" where the row holds 1400 is a conflict; "1400" is not
  res := public.tracker_apply_changes(me, gen_random_uuid(),
           ('[{"unit_id":"' || u || '","column":"ctc","before":"1400","after":1600}]')::jsonb, gen_random_uuid()::text, 'typed');
  if (res ->> 'ok')::boolean then pass := pass + 1; else fail := fail + 1; msgs := msgs || ' |3 "1400" vs 1400 = conflict'; end if;

  -- 4. undo hands back a number for a text cell (engine_no "1" → 1) → NOT a conflict
  res := public.tracker_apply_changes(me, gen_random_uuid(),
           ('[{"unit_id":"' || u || '","column":"engine_no","before":1,"after":"E2"}]')::jsonb, gen_random_uuid()::text, 'undo');
  if (res ->> 'ok')::boolean then pass := pass + 1; else fail := fail + 1; msgs := msgs || ' |4 1 vs "1" = conflict'; end if;

  -- 5. blank: no before against an empty cell → fine; 0 against an empty cell → conflict
  res := public.tracker_apply_changes(me, gen_random_uuid(),
           ('[{"unit_id":"' || u || '","column":"dsa","after":100}]')::jsonb, gen_random_uuid()::text, 'typed');
  if (res ->> 'ok')::boolean then pass := pass + 1; else fail := fail + 1; msgs := msgs || ' |5a missing before vs null'; end if;
  res := public.tracker_apply_changes(me, gen_random_uuid(),
           ('[{"unit_id":"' || u || '","column":"ad_blue","before":0,"after":100}]')::jsonb, gen_random_uuid()::text, 'typed');
  if not (res ->> 'ok')::boolean then pass := pass + 1; else fail := fail + 1; msgs := msgs || ' |5b 0 vs null applied'; end if;

  -- 6. a different decimal is a conflict (1600.01 vs 1600)
  res := public.tracker_apply_changes(me, gen_random_uuid(),
           ('[{"unit_id":"' || u || '","column":"ctc","before":1600.01,"after":1700}]')::jsonb, gen_random_uuid()::text, 'typed');
  if not (res ->> 'ok')::boolean then pass := pass + 1; else fail := fail + 1; msgs := msgs || ' |6 1600.01 vs 1600 applied'; end if;

  if (select ctc from public.vehicle_units where id = u) = 1600 then pass := pass + 1;
    else fail := fail + 1; msgs := msgs || ' |7 final ctc wrong'; end if;

  raise exception 'PROBE COMPLETE: % passed, % failed%', pass, fail, case when fail > 0 then ' —' || msgs else '' end;
end;
$probe$;
