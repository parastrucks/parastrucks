-- Phase 10 Stage 2 slice 3 — probe for 20261022_phase10_tracker_create_units.sql.
-- SELF-ABORTING: a green run ENDS IN AN ERROR that reads "PROBE COMPLETE: N passed, 0 failed".
-- Everything it writes is rolled back with that error.
do $probe$
declare
  pass int := 0; fail int := 0; msgs text := '';
  me uuid := gen_random_uuid();
  b  uuid := gen_random_uuid();
  req text := 'probe-' || gen_random_uuid();
  res jsonb; res2 jsonb; n int; err text;
  big jsonb := '[]'::jsonb;
begin
  -- 1. four rows: a good one, the SAME chassis again, a value the table refuses, another good one
  res := public.tracker_create_units(me, b, '[
      {"chassis_no":" MB1PROBECRE00001 ","model":"PROBE"},
      {"chassis_no":"MB1PROBECRE00001"},
      {"chassis_no":"MB1PROBECRE00002","qty":-1},
      {"chassis_no":"MB1PROBECRE00003","ctc":2800000,"ctd":2600000}
    ]'::jsonb, req);
  if (res ->> 'ok')::boolean and jsonb_array_length(res -> 'results') = 4 then pass := pass + 1;
    else fail := fail + 1; msgs := msgs || ' |1 shape ' || res; end if;
  if (res #>> '{results,0,ok}')::boolean and (res #>> '{results,3,ok}')::boolean then pass := pass + 1;
    else fail := fail + 1; msgs := msgs || ' |1b good rows not created ' || res; end if;
  if not (res #>> '{results,1,ok}')::boolean and res #>> '{results,1,reason}' like '%already in the book%' then pass := pass + 1;
    else fail := fail + 1; msgs := msgs || ' |1c duplicate in the same call ' || res; end if;
  if not (res #>> '{results,2,ok}')::boolean then pass := pass + 1;
    else fail := fail + 1; msgs := msgs || ' |1d qty -1 created'; end if;

  -- 2. exactly the two good rows exist; the failed ones left nothing, not even an audit row
  select count(*) into n from public.vehicle_units where chassis_no like 'MB1PROBECRE%';
  if n = 2 then pass := pass + 1; else fail := fail + 1; msgs := msgs || ' |2 rows=' || n; end if;
  select count(*) into n from public.tracker_audit where batch_id = b and column_key = '*' and source = 'create' and actor = me;
  if n = 2 then pass := pass + 1; else fail := fail + 1; msgs := msgs || ' |2b create audit rows=' || n; end if;
  select count(*) into n from public.tracker_audit where batch_id = b;
  if n = 2 then pass := pass + 1; else fail := fail + 1; msgs := msgs || ' |2c audit rows in batch=' || n; end if;

  -- 3. trimmed chassis, the table's defaults, the formulas worked out
  if exists (select 1 from public.vehicle_units where id = (res #>> '{results,0,id}')::uuid
             and chassis_no = 'MB1PROBECRE00001' and qty = 1 and purchase_source = 'al' and road_tax_pct = 6
             and created_by = me) then pass := pass + 1;
    else fail := fail + 1; msgs := msgs || ' |3 trim/defaults/created_by'; end if;
  if (select retention_dealer is not null from public.vehicle_units where id = (res #>> '{results,3,id}')::uuid) then pass := pass + 1;
    else fail := fail + 1; msgs := msgs || ' |3b ctc given but retention not worked out'; end if;

  -- 4. the same request again → the same answer, marked replayed, nothing new
  res2 := public.tracker_create_units(me, gen_random_uuid(), '[{"chassis_no":"MB1PROBECRE00009"}]'::jsonb, req);
  if (res2 ->> 'replayed')::boolean and res2 -> 'results' = res -> 'results' then pass := pass + 1;
    else fail := fail + 1; msgs := msgs || ' |4 replay ' || res2; end if;
  select count(*) into n from public.vehicle_units where chassis_no like 'MB1PROBECRE%';
  if n = 2 then pass := pass + 1; else fail := fail + 1; msgs := msgs || ' |4b replay created rows: ' || n; end if;

  -- 5. a NEW request with a chassis already in the book → that row fails, by name
  res := public.tracker_create_units(me, gen_random_uuid(), '[{"chassis_no":"MB1PROBECRE00003"},{"chassis_no":"MB1PROBECRE00004"}]'::jsonb, 'probe-' || gen_random_uuid());
  if not (res #>> '{results,0,ok}')::boolean and res #>> '{results,0,reason}' = 'chassis MB1PROBECRE00003 is already in the book'
     and (res #>> '{results,1,ok}')::boolean then pass := pass + 1;
    else fail := fail + 1; msgs := msgs || ' |5 ' || res; end if;

  -- 6. a row that is not an object, or has no chassis, fails alone
  res := public.tracker_create_units(me, gen_random_uuid(), '[42, {"model":"no chassis"}, {"chassis_no":"MB1PROBECRE00005"}]'::jsonb, 'probe-' || gen_random_uuid());
  if not (res #>> '{results,0,ok}')::boolean and not (res #>> '{results,1,ok}')::boolean and (res #>> '{results,2,ok}')::boolean then pass := pass + 1;
    else fail := fail + 1; msgs := msgs || ' |6 ' || res; end if;

  -- 7. the whole call is refused: empty list, over 200 rows, no request id
  begin perform public.tracker_create_units(me, b, '[]'::jsonb, 'probe-' || gen_random_uuid());
    fail := fail + 1; msgs := msgs || ' |7a empty accepted';
  exception when others then pass := pass + 1; end;
  for i in 1..201 loop big := big || jsonb_build_array(jsonb_build_object('chassis_no', 'MB1PROBEBIG' || i)); end loop;
  begin perform public.tracker_create_units(me, b, big, 'probe-' || gen_random_uuid());
    fail := fail + 1; msgs := msgs || ' |7b 201 accepted';
  exception when others then pass := pass + 1; end;
  begin perform public.tracker_create_units(me, b, '[{"chassis_no":"MB1PROBECRE00006"}]'::jsonb, ' ');
    fail := fail + 1; msgs := msgs || ' |7c blank request id accepted';
  exception when others then pass := pass + 1; end;
  select count(*) into n from public.vehicle_units where chassis_no like 'MB1PROBEBIG%' or chassis_no = 'MB1PROBECRE00006';
  if n = 0 then pass := pass + 1; else fail := fail + 1; msgs := msgs || ' |7d refused calls wrote ' || n; end if;

  -- 8. only the service role may call it
  if not has_function_privilege('authenticated', 'public.tracker_create_units(uuid, uuid, jsonb, text)', 'execute')
     and not has_function_privilege('anon', 'public.tracker_create_units(uuid, uuid, jsonb, text)', 'execute') then pass := pass + 1;
    else fail := fail + 1; msgs := msgs || ' |8 API roles can execute'; end if;

  raise exception 'PROBE COMPLETE: % passed, % failed%', pass, fail, case when fail > 0 then ' —' || msgs else '' end;
end;
$probe$;
