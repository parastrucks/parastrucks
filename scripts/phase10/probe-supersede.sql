-- Phase 10 Stage 1 step 3 — probe for 20261021_phase10_tracker_supersede.sql.
-- SELF-ABORTING: a green run ENDS IN AN ERROR that reads "PROBE COMPLETE: N passed, 0 failed".
-- Everything it writes is rolled back with that error, so it leaves no residue.
do $probe$
declare
  pass int := 0; fail int := 0; msgs text := '';
  me uuid := gen_random_uuid();
  a uuid; b uuid; c uuid; d uuid; n int; t text;
  r public.vehicle_units%rowtype;
begin
  ------------------------------------------------------------------------------------------------
  -- 1. Rebill on the SAME chassis (re-billed to another customer)
  a := public.tracker_create_unit(me, gen_random_uuid(),
         '{"chassis_no":"MB1PROBESUP000001","customer_name":"FIRST BUYER","tally_bill":3000000,"ptb_invoice_date":"2025-10-01"}');
  b := public.tracker_supersede_unit(me, a, '{"customer_name":"SECOND BUYER","tally_bill":3100000}');
  select * into r from public.vehicle_units where id = a;
  if r.superseded_at is not null and r.superseded_by_id = b then pass := pass + 1;
    else fail := fail + 1; msgs := msgs || ' |1a old row not closed/linked'; end if;
  if r.customer_name = 'FIRST BUYER' then pass := pass + 1; else fail := fail + 1; msgs := msgs || ' |1b old row changed'; end if;
  select * into r from public.vehicle_units where id = b;
  if r.chassis_no = 'MB1PROBESUP000001' and r.customer_name = 'SECOND BUYER' and r.superseded_at is null then pass := pass + 1;
    else fail := fail + 1; msgs := msgs || ' |1c new row ' || coalesce(r.chassis_no,'null') || '/' || coalesce(r.customer_name,'null'); end if;
  -- nothing carried over except the chassis
  if r.ptb_invoice_date is null then pass := pass + 1; else fail := fail + 1; msgs := msgs || ' |1d copied a field'; end if;
  -- the trigger computed the new row (TCS = 1% of the bill)
  if r.tcs = 31000 then pass := pass + 1; else fail := fail + 1; msgs := msgs || ' |1e tcs=' || coalesce(r.tcs::text,'null'); end if;
  select count(*) into n from public.vehicle_units where chassis_no = 'MB1PROBESUP000001' and superseded_at is null;
  if n = 1 then pass := pass + 1; else fail := fail + 1; msgs := msgs || ' |1f live rows=' || n; end if;

  -- audit: old row's close is 'supersede', new row's '*' is 'create', both in ONE batch
  select count(*) into n from public.tracker_audit
   where unit_id = a and column_key = 'superseded_at' and source = 'supersede' and actor = me;
  if n = 1 then pass := pass + 1; else fail := fail + 1; msgs := msgs || ' |1g supersede audit=' || n; end if;
  select count(*) into n from public.tracker_audit
   where unit_id = a and column_key = 'superseded_by_id' and source = 'supersede' and new_value = b::text;
  if n = 1 then pass := pass + 1; else fail := fail + 1; msgs := msgs || ' |1h link audit=' || n; end if;
  select count(distinct batch_id) into n from public.tracker_audit where unit_id in (a, b);
  if n = 2 then pass := pass + 1; else fail := fail + 1; msgs := msgs || ' |1i batches=' || n; end if;
  -- (2 batches: a's own create, and the rebill batch shared by a's close and b's create)
  select count(*) into n from public.tracker_audit x
   where x.unit_id = b and x.column_key = '*' and x.source = 'create'
     and x.batch_id = (select batch_id from public.tracker_audit where unit_id = a and column_key = 'superseded_at');
  if n = 1 then pass := pass + 1; else fail := fail + 1; msgs := msgs || ' |1j new row not in the rebill batch'; end if;

  ------------------------------------------------------------------------------------------------
  -- 2. Rebill to a NEW chassis
  c := public.tracker_supersede_unit(me, b, '{"chassis_no":"MB1PROBESUP000002"}');
  select * into r from public.vehicle_units where id = c;
  if r.chassis_no = 'MB1PROBESUP000002' then pass := pass + 1; else fail := fail + 1; msgs := msgs || ' |2a chassis=' || r.chassis_no; end if;
  select count(*) into n from public.vehicle_units where chassis_no = 'MB1PROBESUP000001' and superseded_at is null;
  if n = 0 then pass := pass + 1; else fail := fail + 1; msgs := msgs || ' |2b old chassis still live'; end if;

  ------------------------------------------------------------------------------------------------
  -- 3. Refusals, each leaving everything as it was
  begin
    perform public.tracker_supersede_unit(me, a, '{}');
    fail := fail + 1; msgs := msgs || ' |3a rebilled an already-rebilled row';
  exception when others then
    if sqlerrm like '%already rebilled%' then pass := pass + 1; else fail := fail + 1; msgs := msgs || ' |3a msg=' || sqlerrm; end if;
  end;
  begin
    perform public.tracker_supersede_unit(me, gen_random_uuid(), '{}');
    fail := fail + 1; msgs := msgs || ' |3b rebilled a missing row';
  exception when others then
    if sqlerrm like '%no such row%' then pass := pass + 1; else fail := fail + 1; msgs := msgs || ' |3b msg=' || sqlerrm; end if;
  end;
  -- a new chassis that clashes with another live row: the whole rebill rolls back
  d := public.tracker_create_unit(me, gen_random_uuid(), '{"chassis_no":"MB1PROBESUP000003"}');
  begin
    perform public.tracker_supersede_unit(me, c, '{"chassis_no":"MB1PROBESUP000003"}');
    fail := fail + 1; msgs := msgs || ' |3c rebilled onto a live chassis';
  exception when unique_violation then
    pass := pass + 1;
  end;
  select * into r from public.vehicle_units where id = c;
  if r.superseded_at is null and r.superseded_by_id is null then pass := pass + 1;
    else fail := fail + 1; msgs := msgs || ' |3d failed rebill left the old row closed'; end if;
  -- a bad value in the new row also rolls the close back
  begin
    perform public.tracker_supersede_unit(me, c, '{"ptb_invoice_date":"not a date"}');
    fail := fail + 1; msgs := msgs || ' |3e accepted a bad date';
  exception when others then
    pass := pass + 1;
  end;
  select superseded_at::text into t from public.vehicle_units where id = c;
  if t is null then pass := pass + 1; else fail := fail + 1; msgs := msgs || ' |3f bad-date rebill left the old row closed'; end if;

  ------------------------------------------------------------------------------------------------
  -- 4. Access: API roles cannot run it
  if not has_function_privilege('anon', 'public.tracker_supersede_unit(uuid, uuid, jsonb)', 'execute')
     and not has_function_privilege('authenticated', 'public.tracker_supersede_unit(uuid, uuid, jsonb)', 'execute')
     and has_function_privilege('service_role', 'public.tracker_supersede_unit(uuid, uuid, jsonb)', 'execute')
  then pass := pass + 1; else fail := fail + 1; msgs := msgs || ' |4a grants'; end if;

  raise exception 'PROBE COMPLETE: % passed, % failed%', pass, fail, case when fail > 0 then ' —' || msgs else '' end;
end;
$probe$;
