-- Phase 10 — probe for 20261023_phase10_tracker_mto_advance.sql (the MTO Advance yes/no column).
-- SELF-ABORTING: a green run ENDS IN AN ERROR that reads "PROBE COMPLETE: N passed, 0 failed".
-- Everything it writes is rolled back with that error.
do $probe$
declare
  pass int := 0; fail int := 0; msgs text := '';
  me uuid := gen_random_uuid();
  u uuid; res jsonb; err text;
begin
  -- 1. a new truck is not make-to-order unless said so
  u := public.tracker_create_unit(me, gen_random_uuid(), '{"chassis_no":"MB1PROBEMTO000001"}'::jsonb);
  if (select mto_advance from public.vehicle_units where id = u) is null then pass := pass + 1;
    else fail := fail + 1; msgs := msgs || ' |1 default not empty'; end if;

  -- 2. typed Yes, then No, then cleared — each saved and audited
  res := public.tracker_apply_changes(me, gen_random_uuid(),
           ('[{"unit_id":"' || u || '","column":"mto_advance","before":null,"after":"Yes"}]')::jsonb, gen_random_uuid()::text, 'typed');
  if (res ->> 'ok')::boolean and (select mto_advance from public.vehicle_units where id = u) = 'Yes' then pass := pass + 1;
    else fail := fail + 1; msgs := msgs || ' |2 yes ' || res; end if;
  res := public.tracker_apply_changes(me, gen_random_uuid(),
           ('[{"unit_id":"' || u || '","column":"mto_advance","before":"Yes","after":"No"}]')::jsonb, gen_random_uuid()::text, 'typed');
  if (res ->> 'ok')::boolean and (select mto_advance from public.vehicle_units where id = u) = 'No' then pass := pass + 1;
    else fail := fail + 1; msgs := msgs || ' |2b no ' || res; end if;
  res := public.tracker_apply_changes(me, gen_random_uuid(),
           ('[{"unit_id":"' || u || '","column":"mto_advance","before":"No","after":null}]')::jsonb, gen_random_uuid()::text, 'typed');
  if (res ->> 'ok')::boolean and (select mto_advance from public.vehicle_units where id = u) is null then pass := pass + 1;
    else fail := fail + 1; msgs := msgs || ' |2c clear ' || res; end if;
  if (select count(*) from public.tracker_audit where unit_id = u and column_key = 'mto_advance') = 3 then pass := pass + 1;
    else fail := fail + 1; msgs := msgs || ' |2d audit'; end if;

  -- 3. the table itself refuses anything but Yes / No (even if a caller skipped the Edge Function's check)
  begin
    update public.vehicle_units set mto_advance = 'yes' where id = u;
    fail := fail + 1; msgs := msgs || ' |3 lower-case yes stored';
  exception when check_violation then pass := pass + 1;
  end;

  raise exception 'PROBE COMPLETE: % passed, % failed%', pass, fail, case when fail > 0 then ' —' || msgs else '' end;
end;
$probe$;
